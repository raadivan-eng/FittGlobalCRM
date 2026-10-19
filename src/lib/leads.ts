import "server-only";
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { decryptJson, sessionSecret } from "./secrets";
import { notify } from "./notifications";
import { mapsFetch, mapsKey, MapsApiError } from "./geocoding";

/** Quiénes trabajan los leads: los ven, los editan y reciben los avisos de los nuevos. */
export const LEAD_ROLES = ["ADMIN", "COMERCIAL"];

/** Mensajes seguidos de un mismo lead dentro de este lapso no vuelven a avisar. */
const SILENCIO_AVISOS_MS = 30 * 60_000;

const esConflictoUnico = (e: unknown) => (e as { code?: string })?.code === "P2002";

// ───────────────────────────────  Teléfonos  ─────────────────────────────────

/**
 * Deja el número como +57XXXXXXXXXX. WhatsApp lo entrega sin «+», los
 * formularios con espacios y los comerciales como les sale: guardarlos iguales
 * es lo que permite reconocer que el que escribe hoy es el lead de ayer.
 */
export function normalizePhone(raw: string | null | undefined) {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  if (digits.length === 10 && digits.startsWith("3")) return `+57${digits}`;
  return `+${digits}`;
}

/** Los diez últimos dígitos: el número sin indicativo, para comparar. */
const phoneTail = (phone: string) => phone.replace(/\D/g, "").slice(-10);

// ──────────────────────────────  Consecutivo  ────────────────────────────────

/**
 * Crea el lead con el consecutivo LD-00001. Si dos se crean a la vez (un
 * webhook y una persona), el índice único decide y se reintenta con el siguiente.
 */
export async function createLeadWithCode(data: Omit<Prisma.LeadUncheckedCreateInput, "code">) {
  for (let intento = 0; intento < 6; intento++) {
    const total = await prisma.lead.count();
    const code = `LD-${String(total + 1 + intento).padStart(5, "0")}`;
    try {
      return await prisma.lead.create({ data: { ...data, code } });
    } catch (e) {
      if (!esConflictoUnico(e)) throw e;
    }
  }
  throw new Error("No se pudo asignar un consecutivo al lead; intenta de nuevo.");
}

// ─────────────────────────────  Canales de entrada  ──────────────────────────

/**
 * Token de cada canal externo, derivado de SESSION_SECRET como el de los crons:
 * no hay un secreto más que guardar. `meta` es el «verify token» del webhook;
 * `web` es la clave con que el sitio publica su formulario de contacto.
 */
export function channelToken(canal: "meta" | "web") {
  return crypto.createHmac("sha256", sessionSecret()).update(`webhook:${canal}`).digest("hex").slice(0, 40);
}

export function sameToken(got: string, expected: string) {
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

export type MetaCredentials = { businessId: string; token: string; appSecret: string };

/** Credenciales de Meta guardadas en Conexiones, aunque nadie las haya probado todavía. */
export async function metaCredentials(): Promise<MetaCredentials | null> {
  const row = await prisma.apiConnection.findUnique({ where: { provider: "META" } });
  const secretos = decryptJson(row?.secretCipher);
  if (!row || !secretos?.secret) return null;
  return { businessId: row.account ?? "", token: secretos.secret, appSecret: secretos.extra ?? "" };
}

// ────────────────────────────────  Entrantes  ────────────────────────────────

/** Lo que llega por una API: un formulario de Meta, un mensaje de WhatsApp o la web. */
export type IncomingLead = {
  source: "FACEBOOK" | "INSTAGRAM" | "WHATSAPP" | "WEB";
  sourceDetail?: string | null;
  /** id del lead en Meta o wa_id: identifica a la persona en su plataforma. */
  externalId?: string | null;
  /** id del mensaje o del envío: Meta reintenta los webhooks y así no se duplica. */
  eventId?: string | null;
  name: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  message: string;
  occurredAt?: Date;
};

export type IncomingResult = { leadId: string; created: boolean } | null;

/**
 * Registra lo que llegó por un medio. Si la persona ya es un lead —mismo id en
 * la plataforma, o el teléfono o el correo de uno de sus contactos— el mensaje
 * se suma a su bitácora; si no, nace un lead nuevo con una tienda provisional
 * (el nombre del negocio, sin ubicar) y quien escribió como contacto, y se
 * avisa al equipo comercial. Devuelve `null` si el envío ya se había registrado.
 */
export async function registerIncoming(input: IncomingLead): Promise<IncomingResult> {
  if (input.eventId && (await prisma.leadEvent.findUnique({ where: { externalId: input.eventId }, select: { id: true } }))) {
    return null;
  }

  const phone = normalizePhone(input.phone);
  const email = input.email?.trim().toLowerCase() || null;
  const when = input.occurredAt ?? new Date();

  const byContact = [...(phone ? [{ phone: { endsWith: phoneTail(phone) } }] : []), ...(email ? [{ email }] : [])];
  const match = [
    ...(input.externalId ? [{ externalId: input.externalId }] : []),
    ...(byContact.length ? [{ contacts: { some: { OR: byContact } } }] : []),
  ];
  const existing = match.length
    ? await prisma.lead.findFirst({
        where: { OR: match },
        orderBy: { lastActivityAt: "desc" },
        include: { contacts: { orderBy: { createdAt: "asc" } }, stores: { orderBy: { createdAt: "asc" }, take: 1 } },
      })
    : null;

  try {
    if (existing) {
      await prisma.leadEvent.create({
        data: { leadId: existing.id, type: "MENSAJE", body: input.message, source: "API", externalId: input.eventId, occurredAt: when },
      });
      // Completa lo que faltaba sin pisar lo que el comercial ya corrigió.
      await prisma.lead.update({
        where: { id: existing.id },
        data: {
          lastActivityAt: when > existing.lastActivityAt ? when : existing.lastActivityAt,
          externalId: existing.externalId ?? input.externalId ?? null,
        },
      });
      await completeContact(existing.id, existing.contacts, { name: input.contactName?.trim() || null, phone, email });
      const store = existing.stores[0];
      if (store && !store.city && input.city) await prisma.leadStore.update({ where: { id: store.id }, data: { city: input.city } });
      if (when.getTime() - existing.lastActivityAt.getTime() > SILENCIO_AVISOS_MS) {
        await notify({
          type: "LEAD_MENSAJE",
          title: `${existing.name} volvió a escribir`,
          body: input.message.slice(0, 160),
          href: `/leads/${existing.id}`,
          ...(existing.ownerId ? { userIds: [existing.ownerId] } : { roles: LEAD_ROLES }),
        });
      }
      return { leadId: existing.id, created: false };
    }

    const name = input.name.trim() || phone || email || "Sin nombre";
    const lead = await createLeadWithCode({
      entry: "INBOUND",
      source: input.source,
      sourceDetail: input.sourceDetail ?? null,
      externalId: input.externalId ?? null,
      name,
      lastActivityAt: when,
      createdAt: when,
    });
    await prisma.leadStore.create({ data: { leadId: lead.id, name, city: input.city ?? null, createdAt: when } });
    await prisma.leadContact.create({
      data: { leadId: lead.id, name: input.contactName?.trim() || phone || email || name, phone, email, createdAt: when },
    });
    await prisma.leadEvent.create({
      data: { leadId: lead.id, type: "CREADO", body: input.message, source: "API", externalId: input.eventId, occurredAt: when },
    });
    await notify({
      type: "LEAD_NUEVO",
      title: `Lead nuevo: ${lead.name}`,
      body: [input.sourceDetail, input.message.slice(0, 140)].filter(Boolean).join(" · "),
      href: `/leads/${lead.id}`,
      roles: LEAD_ROLES,
    });
    return { leadId: lead.id, created: true };
  } catch (e) {
    // Otro reintento del mismo envío ganó la carrera: ya quedó registrado.
    if (esConflictoUnico(e)) return null;
    throw e;
  }
}

type LeadContactRow = { id: string; name: string; phone: string | null; email: string | null };

/**
 * Suma a los contactos del lead lo que trajo el mensaje: completa el contacto
 * que tiene ese teléfono o correo (o el que todavía no tiene ninguno) y, si es
 * otra persona del mismo negocio, la agrega como contacto nuevo.
 */
async function completeContact(leadId: string, contacts: LeadContactRow[], got: { name: string | null; phone: string | null; email: string | null }) {
  if (!got.phone && !got.email) return;
  const same = contacts.find(
    (c) => (got.phone && c.phone && phoneTail(c.phone) === phoneTail(got.phone)) || (got.email && c.email === got.email),
  );
  const target = same ?? contacts.find((c) => !c.phone && !c.email);
  if (!target) {
    await prisma.leadContact.create({ data: { leadId, name: got.name ?? got.phone ?? got.email!, phone: got.phone, email: got.email } });
    return;
  }
  // El nombre provisional es el teléfono o el correo: se cambia por el real en cuanto llega.
  const provisional = target.name === target.phone || target.name === target.email;
  await prisma.leadContact.update({
    where: { id: target.id },
    data: {
      phone: target.phone ?? got.phone,
      email: target.email ?? got.email,
      ...(provisional && got.name ? { name: got.name } : {}),
    },
  });
}

// ──────────────────────────────  Sales hunt  ─────────────────────────────────

export type PlaceOption = {
  placeId: string;
  name: string;
  address: string | null;
  city: string | null;
  lat: number;
  lng: number;
  mapsUrl: string | null;
  /** Ya es tienda de un cliente: no es prospecto. */
  store: { id: string; name: string; company: string } | null;
  /** Ya hay un lead sobre este lugar. */
  lead: { id: string; code: string; status: string } | null;
};

type Json = Record<string, unknown>;

/**
 * Busca negocios en Google Maps para arrancar un sales hunt. Cada resultado
 * dice si ya es tienda de un cliente o si ya es lead, para no prospectar dos
 * veces el mismo punto.
 */
export async function searchPlaces(query: string): Promise<PlaceOption[]> {
  const key = await mapsKey();
  if (!key) throw new MapsApiError("Conecta Google Maps en Conexiones API para buscar tiendas.");

  const { res, body } = await mapsFetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.addressComponents",
    },
    body: JSON.stringify({ textQuery: query, regionCode: "CO", languageCode: "es", pageSize: 8 }),
  });
  if (res.status === 403) throw new MapsApiError("Places API (New) no está habilitada para la clave de Google Maps.");
  if (res.status === 429) throw new MapsApiError("Places API: cuota agotada, intenta más tarde.");
  if (!res.ok) throw new MapsApiError(`Places API: ${res.status} ${String((body.error as Json | undefined)?.message ?? "")}`.trim());

  const places = ((body.places as Json[] | undefined) ?? []).filter((p) => (p.location as Json | undefined)?.latitude != null);
  const ids = places.map((p) => String(p.id));
  const [stores, leads] = await Promise.all([
    prisma.store.findMany({ where: { placeId: { in: ids } }, select: { id: true, name: true, placeId: true, company: { select: { name: true } } } }),
    prisma.leadStore.findMany({
      where: { placeId: { in: ids } },
      orderBy: { createdAt: "desc" },
      select: { placeId: true, lead: { select: { id: true, code: true, status: true } } },
    }),
  ]);

  return places.map((p) => {
    const location = p.location as Json;
    const components = (p.addressComponents as Json[] | undefined) ?? [];
    const locality = components.find((c) => ((c.types as string[] | undefined) ?? []).includes("locality"));
    const store = stores.find((s) => s.placeId === p.id);
    const lead = leads.find((l) => l.placeId === p.id);
    return {
      placeId: String(p.id),
      name: String((p.displayName as Json | undefined)?.text ?? "Sin nombre"),
      address: (p.formattedAddress as string | undefined) ?? null,
      city: (locality?.longText as string | undefined) ?? null,
      lat: Number(location.latitude),
      lng: Number(location.longitude),
      mapsUrl: (p.googleMapsUri as string | undefined) ?? null,
      store: store ? { id: store.id, name: store.name, company: store.company.name } : null,
      lead: lead ? lead.lead : null,
    };
  });
}

// ───────────────────────────────  Períodos  ──────────────────────────────────

/** Meses que se ofrecen como cierre tentativo: el actual y los once siguientes. */
export function closePeriodOptions(ref = new Date()) {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(ref.getFullYear(), ref.getMonth() + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}
