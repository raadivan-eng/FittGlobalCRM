import "server-only";
import crypto from "node:crypto";
import { asRecord, asText, mensajeDeError, pedir, type Json } from "./http";
import { registerIncoming, type IncomingLead, type MetaCredentials } from "./leads";

/**
 * Leads que entran por Meta. Llegan de dos formas:
 *
 *   - Webhook (/api/webhooks/meta): Meta avisa en cuanto alguien llena un
 *     formulario de Lead Ads (objeto `page`, campo `leadgen`) o escribe a
 *     WhatsApp Business (objeto `whatsapp_business_account`, campo `messages`).
 *   - Sincronización: repasa los formularios de las páginas del negocio y trae
 *     lo que el webhook no entregó. WhatsApp no tiene equivalente: sus mensajes
 *     sólo existen como webhook.
 */

/** Versión fijada de la Graph API: subirla es cambiar esta línea. */
export const GRAPH_VERSION = "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Peticiones por sincronización: Workers limita las subpeticiones de cada invocación. */
const PRESUPUESTO_SYNC = 40;

async function graphGet(path: string, token: string, query: Record<string, string> = {}) {
  const qs = new URLSearchParams(query).toString();
  const { res, body, text } = await pedir(`${GRAPH}/${path}${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${res.status} · ${mensajeDeError(body, text)}`);
  return body;
}

/** Meta firma cada webhook con la App Secret; sin firma válida no se procesa nada. */
export function validSignature(rawBody: string, header: string | null, appSecret: string) {
  if (!header?.startsWith("sha256=") || !appSecret) return false;
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  return header.length === expected.length && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

// ────────────────────────────  Formularios (Lead Ads)  ─────────────────────────

/** Nombres con que suelen venir las preguntas de un formulario, en inglés o español. */
const CAMPOS = {
  company: ["company_name", "empresa", "nombre_de_la_empresa", "negocio", "nombre_del_negocio", "razon_social"],
  fullName: ["full_name", "nombre_completo", "nombre"],
  firstName: ["first_name"],
  lastName: ["last_name"],
  phone: ["phone_number", "telefono", "celular", "whatsapp"],
  email: ["email", "correo", "correo_electronico"],
  city: ["city", "ciudad"],
};

type FieldData = { name: string; values: string[] }[];

const campo = (data: FieldData, nombres: string[]) =>
  data.find((f) => nombres.includes(f.name.toLowerCase()))?.values?.[0]?.trim() || null;

/** Convierte un lead de la Graph API en lo que el portal registra. */
function fromLeadgen(lead: Json, formName?: string): IncomingLead {
  const data = ((lead.field_data as FieldData | undefined) ?? []).filter((f) => f?.name);
  const fullName =
    campo(data, CAMPOS.fullName) ?? ([campo(data, CAMPOS.firstName), campo(data, CAMPOS.lastName)].filter(Boolean).join(" ") || null);
  const company = campo(data, CAMPOS.company);
  const id = asText(lead.id);
  const detail = [asText(lead.campaign_name), asText(lead.ad_name), formName].filter(Boolean).join(" · ");
  return {
    // Meta marca con `platform` si el formulario se llenó en Instagram.
    source: asText(lead.platform).toLowerCase() === "ig" ? "INSTAGRAM" : "FACEBOOK",
    sourceDetail: detail || "Formulario de Lead Ads",
    externalId: id,
    eventId: `leadgen:${id}`,
    name: company ?? fullName ?? "",
    contactName: fullName,
    phone: campo(data, CAMPOS.phone),
    email: campo(data, CAMPOS.email),
    city: campo(data, CAMPOS.city),
    message: data.map((f) => `${f.name.replace(/_/g, " ")}: ${(f.values ?? []).join(", ")}`).join("\n") || "Formulario sin respuestas",
    occurredAt: lead.created_time ? new Date(asText(lead.created_time)) : undefined,
  };
}

const LEAD_FIELDS = "id,created_time,field_data,platform,ad_name,campaign_name,form_id";

// ───────────────────────────────  WhatsApp  ────────────────────────────────────

/** Texto legible de cualquier tipo de mensaje de WhatsApp. */
function messageText(m: Json) {
  const type = asText(m.type);
  if (type === "text") return asText(asRecord(m.text).body);
  if (type === "button") return asText(asRecord(m.button).text);
  if (type === "interactive") {
    const i = asRecord(m.interactive);
    return asText(asRecord(i.button_reply).title) || asText(asRecord(i.list_reply).title) || "[respuesta interactiva]";
  }
  const media: Record<string, string> = { image: "imagen", audio: "audio", video: "video", document: "documento", sticker: "sticker", location: "ubicación", contacts: "contacto" };
  const caption = asText(asRecord(m[type]).caption);
  return `[${media[type] ?? type}]${caption ? ` ${caption}` : ""}`;
}

/**
 * Un mensaje que viene de un anuncio «clic a WhatsApp» trae `referral`: ahí se
 * sabe si el anuncio corría en Facebook o en Instagram. Sin él, la persona
 * escribió directo y el origen es WhatsApp.
 */
function whatsappOrigin(m: Json): Pick<IncomingLead, "source" | "sourceDetail"> {
  const ref = asRecord(m.referral);
  const url = asText(ref.source_url).toLowerCase();
  if (!url && !ref.source_id) return { source: "WHATSAPP", sourceDetail: "Escribió directo a WhatsApp Business" };
  const what = asText(ref.source_type) === "post" ? "Publicación" : "Anuncio";
  const detail = `${what} que abre WhatsApp${asText(ref.headline) ? `: ${asText(ref.headline)}` : ""}`;
  if (url.includes("instagram")) return { source: "INSTAGRAM", sourceDetail: detail };
  if (url.includes("facebook") || url.includes("fb.me") || url.includes("fb.com")) return { source: "FACEBOOK", sourceDetail: detail };
  return { source: "WHATSAPP", sourceDetail: detail };
}

// ────────────────────────────────  Webhook  ────────────────────────────────────

export type WebhookResult = { nuevos: number; mensajes: number; repetidos: number; errores: string[] };

/** Procesa el cuerpo ya validado de un webhook de Meta. */
export async function processWebhook(payload: Json, creds: MetaCredentials): Promise<WebhookResult> {
  const result: WebhookResult = { nuevos: 0, mensajes: 0, repetidos: 0, errores: [] };
  const tally = (r: Awaited<ReturnType<typeof registerIncoming>>) => {
    if (!r) result.repetidos++;
    else if (r.created) result.nuevos++;
    else result.mensajes++;
  };

  const object = asText(payload.object);
  for (const entry of (payload.entry as Json[] | undefined) ?? []) {
    for (const change of (asRecord(entry).changes as Json[] | undefined) ?? []) {
      const field = asText(change.field);
      const value = asRecord(change.value);

      if (object === "page" && field === "leadgen") {
        // El aviso sólo trae el id: el contenido se pide a la Graph API.
        const leadgenId = asText(value.leadgen_id);
        if (!leadgenId) continue;
        try {
          tally(await registerIncoming(fromLeadgen(await graphGet(leadgenId, creds.token, { fields: LEAD_FIELDS }))));
        } catch (e) {
          result.errores.push(`Lead ${leadgenId}: ${e instanceof Error ? e.message : "fallo desconocido"}`);
        }
        continue;
      }

      if (object === "whatsapp_business_account" && field === "messages") {
        // Los acuses de entrega y lectura llegan por aquí también, sin `messages`.
        const contacts = (value.contacts as Json[] | undefined) ?? [];
        for (const m of (value.messages as Json[] | undefined) ?? []) {
          const from = asText(m.from);
          if (!from) continue;
          const contact = contacts.find((c) => asText(c.wa_id) === from);
          const profile = asText(asRecord(contact?.profile).name);
          tally(
            await registerIncoming({
              ...whatsappOrigin(m),
              externalId: `wa:${from}`,
              eventId: `wa:${asText(m.id)}`,
              name: profile || `+${from}`,
              contactName: profile || null,
              phone: from,
              message: messageText(m),
              occurredAt: m.timestamp ? new Date(Number(m.timestamp) * 1000) : undefined,
            }),
          );
        }
      }
    }
  }
  return result;
}

// ─────────────────────────────  Sincronización  ────────────────────────────────

export type MetaSyncResult = WebhookResult & { paginas: number; formularios: number; truncado: boolean };

/**
 * Repasa los formularios de las páginas del negocio y registra los leads de
 * los últimos `dias`. Lo que ya estaba se reconoce por su id y no se duplica.
 */
export async function syncLeadForms(creds: MetaCredentials, dias = 30): Promise<MetaSyncResult> {
  const result: MetaSyncResult = { nuevos: 0, mensajes: 0, repetidos: 0, errores: [], paginas: 0, formularios: 0, truncado: false };
  if (!creds.businessId) throw new Error("Falta el ID de la cuenta de negocio en la conexión de Meta.");

  let usadas = 0;
  const get = async (path: string, token: string, query: Record<string, string>) => {
    if (usadas >= PRESUPUESTO_SYNC) {
      result.truncado = true;
      return null;
    }
    usadas++;
    return graphGet(path, token, query);
  };

  const since = Math.floor((Date.now() - dias * 86_400_000) / 1000);
  const pages = await get(`${creds.businessId}/owned_pages`, creds.token, { fields: "id,name,access_token", limit: "50" });
  for (const page of (pages?.data as Json[] | undefined) ?? []) {
    result.paginas++;
    // Los leads se leen con el token de la página cuando Meta lo entrega.
    const pageToken = asText(page.access_token) || creds.token;
    let forms: Json | null;
    try {
      forms = await get(`${asText(page.id)}/leadgen_forms`, pageToken, { fields: "id,name,status", limit: "50" });
    } catch (e) {
      result.errores.push(`${asText(page.name)}: ${e instanceof Error ? e.message : "fallo desconocido"}`);
      continue;
    }
    for (const form of (forms?.data as Json[] | undefined) ?? []) {
      result.formularios++;
      try {
        const leads = await get(`${asText(form.id)}/leads`, pageToken, {
          fields: LEAD_FIELDS,
          limit: "100",
          filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: since }]),
        });
        for (const lead of (leads?.data as Json[] | undefined) ?? []) {
          const r = await registerIncoming(fromLeadgen(lead, asText(form.name)));
          if (!r) result.repetidos++;
          else if (r.created) result.nuevos++;
          else result.mensajes++;
        }
      } catch (e) {
        result.errores.push(`${asText(form.name)}: ${e instanceof Error ? e.message : "fallo desconocido"}`);
      }
    }
  }
  return result;
}
