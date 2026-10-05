"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireRole } from "./auth";
import { decryptJson, encryptJson } from "./secrets";
import { isCarrier, providerByKey, secretHint, type Credentials, type ProviderKey } from "./integrations";
import { asText, mensajeDeError, pedir } from "./http";
import { carrierAdapter } from "./carriers";

/** Versión fijada de la Graph API: subirla es cambiar esta línea. */
const GRAPH_VERSION = "v21.0";

export type ConnectionState = { error?: string; ok?: string };

/**
 * Prueba real contra el proveedor: pide un token (Siigo, Google) o consulta la
 * cuenta del token (Meta). Devuelve la descripción de lo que respondió; si algo
 * falla, lanza con el mensaje tal cual lo dio el proveedor.
 */
async function saludar(provider: ProviderKey, c: Credentials): Promise<string> {
  if (isCarrier(provider)) {
    const adapter = carrierAdapter(provider);
    if (!adapter) throw new Error("La integración con esta transportadora todavía no está habilitada en el portal.");
    return adapter.autenticar(c);
  }

  if (provider === "SIIGO") {
    const { res, body, text } = await pedir("https://api.siigo.com/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Partner-Id": c.extra },
      body: JSON.stringify({ username: c.account, access_key: c.secret }),
    });
    if (!res.ok) throw new Error(`${res.status} · ${mensajeDeError(body, text)}`);
    const horas = Math.round(Number(body.expires_in ?? 0) / 3600);
    return `Autenticado como ${c.account}${horas ? ` · token vigente ${horas} h` : ""}`;
  }

  if (provider === "META") {
    const { res, body, text } = await pedir(`https://graph.facebook.com/${GRAPH_VERSION}/me?fields=id,name`, {
      headers: { Authorization: `Bearer ${c.secret}` },
    });
    if (!res.ok) throw new Error(`${res.status} · ${mensajeDeError(body, text)}`);
    const nombre = asText(body.name) || "la cuenta";
    const id = asText(body.id);
    return `Token válido para ${nombre}${id ? ` (id ${id})` : ""}`;
  }

  if (provider === "MAPS") {
    // Geocoding responde 200 incluso cuando rechaza la clave: el veredicto va en `status`.
    const url = `https://maps.googleapis.com/maps/api/geocode/json?${new URLSearchParams({
      address: "Carrera 7 # 32-16, Bogotá",
      components: "country:CO",
      key: c.secret,
    })}`;
    const { res, body, text } = await pedir(url, {});
    const status = asText(body.status);
    if (!res.ok || (status !== "OK" && status !== "ZERO_RESULTS")) {
      throw new Error(`Geocoding API · ${status || res.status} · ${asText(body.error_message) || mensajeDeError(body, text)}`);
    }

    // Places es opcional: sin ella sólo se ubican las tiendas que tienen dirección.
    const places = await pedir("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": c.secret, "X-Goog-FieldMask": "places.id" },
      body: JSON.stringify({ textQuery: "Droguería Colsubsidio Calle 67 Bogotá", regionCode: "CO" }),
    });
    const placesOk = places.res.ok;
    return placesOk
      ? "Geocoding y Places responden: se pueden ubicar tiendas por dirección y por nombre"
      : `Geocoding responde. Places no (${places.res.status} · ${mensajeDeError(places.body, places.text)}): las tiendas sin dirección no se podrán buscar por nombre`;
  }

  const { res, body, text } = await pedir("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.account,
      client_secret: c.secret,
      refresh_token: c.extra,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) throw new Error(`${res.status} · ${mensajeDeError(body, text)}`);
  const permisos = asText(body.scope).split(" ").filter(Boolean).length;
  const minutos = Math.round(Number(body.expires_in ?? 0) / 60);
  return `Token renovado · ${permisos} permiso${permisos === 1 ? "" : "s"} concedido${permisos === 1 ? "" : "s"}${minutos ? ` · vigente ${minutos} min` : ""}`;
}

async function registrar(
  connectionId: string,
  action: string,
  result: "OK" | "FALLO" | "INFO",
  detail: string | null,
  userId: string,
  durationMs?: number,
) {
  await prisma.apiConnectionEvent.create({ data: { connectionId, action, result, detail, userId, durationMs } });
}

/**
 * Guarda las credenciales cifradas. Un campo secreto vacío significa «conserva
 * el que ya estaba», porque la interfaz nunca los devuelve para reeditar.
 */
export async function guardarConexion(_prev: ConnectionState, formData: FormData): Promise<ConnectionState> {
  const user = await requireRole(["ADMIN"]);
  const provider = String(formData.get("provider") ?? "");
  const descriptor = providerByKey(provider);
  if (!descriptor) return { error: "Proveedor desconocido." };

  const existing = await prisma.apiConnection.findUnique({ where: { provider } });
  const previos = decryptJson(existing?.secretCipher) ?? {};

  const account = String(formData.get("account") ?? "").trim();
  const secretos: Record<string, string> = {};
  const faltantes: string[] = [];

  for (const field of descriptor.fields) {
    if (field.name === "account") {
      if (!account) faltantes.push(field.label);
      continue;
    }
    const valor = String(formData.get(field.name) ?? "").trim() || previos[field.name] || "";
    if (valor) secretos[field.name] = valor;
    else if (!field.optional) faltantes.push(field.label);
  }

  if (faltantes.length) return { error: `Falta completar: ${faltantes.join(", ")}.` };

  const data = {
    account,
    secretCipher: encryptJson(secretos),
    secretHint: secretHint(secretos.secret ?? ""),
    // Las credenciales cambiaron: lo que respondió el proveedor antes ya no vale.
    status: "PENDIENTE",
    lastDetail: null,
    lastError: null,
  };

  const row = await prisma.apiConnection.upsert({
    where: { provider },
    create: { provider, ...data },
    update: data,
  });

  await registrar(row.id, "Credenciales actualizadas", "INFO", `Cuenta ${account}`, user.id);
  revalidatePath("/conexiones");
  return {
    ok:
      isCarrier(provider) && !carrierAdapter(provider)
        ? "Credenciales guardadas. Quedan listas para cuando se habilite la integración."
        : "Credenciales guardadas. Prueba la conexión para verificarlas.",
  };
}

/** Consulta al proveedor con las credenciales guardadas y anota el resultado. */
export async function probarConexion(formData: FormData) {
  const user = await requireRole(["ADMIN"]);
  const provider = String(formData.get("provider") ?? "");
  const descriptor = providerByKey(provider);
  if (!descriptor) return;

  // Sin adaptador no hay contra qué probar: la conexión queda «sin verificar».
  if (isCarrier(provider) && !carrierAdapter(provider)) return;

  const row = await prisma.apiConnection.findUnique({ where: { provider } });
  const secretos = decryptJson(row?.secretCipher);
  if (!row || !secretos) return;

  const creds: Credentials = {
    account: row.account ?? "",
    secret: secretos.secret ?? "",
    extra: secretos.extra ?? "",
  };

  const inicio = Date.now();
  try {
    const detalle = await saludar(descriptor.key, creds);
    const durationMs = Date.now() - inicio;
    await prisma.apiConnection.update({
      where: { id: row.id },
      data: { status: "CONECTADA", lastCheckAt: new Date(), lastDetail: detalle, lastError: null },
    });
    await registrar(row.id, "Prueba de conexión", "OK", detalle, user.id, durationMs);
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : "Fallo desconocido";
    await prisma.apiConnection.update({
      where: { id: row.id },
      data: { status: "ERROR", lastCheckAt: new Date(), lastError: mensaje },
    });
    await registrar(row.id, "Prueba de conexión", "FALLO", mensaje, user.id, Date.now() - inicio);
  }

  revalidatePath("/conexiones");
  revalidatePath("/guias");
}

/** Borra las credenciales guardadas y deja la conexión sin configurar. */
export async function desconectarConexion(formData: FormData) {
  const user = await requireRole(["ADMIN"]);
  const provider = String(formData.get("provider") ?? "");
  if (!providerByKey(provider)) return;

  const row = await prisma.apiConnection.findUnique({ where: { provider } });
  if (!row) return;

  await prisma.apiConnection.update({
    where: { id: row.id },
    data: {
      status: "SIN_CONFIGURAR",
      account: null,
      secretCipher: null,
      secretHint: null,
      lastDetail: null,
      lastError: null,
      lastCheckAt: null,
    },
  });
  await registrar(row.id, "Conexión desconectada", "INFO", "Se borraron las credenciales guardadas", user.id);
  revalidatePath("/conexiones");
  revalidatePath("/guias");
}
