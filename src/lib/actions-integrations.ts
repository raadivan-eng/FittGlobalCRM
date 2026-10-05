"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireRole } from "./auth";
import { decryptJson, encryptJson } from "./secrets";
import { providerByKey, secretHint, type ProviderKey } from "./integrations";

/** La prueba habla de verdad con el proveedor; sin tope, un host caído cuelga la acción. */
const TIMEOUT_MS = 12_000;
/** Versión fijada de la Graph API: subirla es cambiar esta línea. */
const GRAPH_VERSION = "v21.0";

export type ConnectionState = { error?: string; ok?: string };

type Credentials = { account: string; secret: string; extra: string };
type Json = Record<string, unknown>;

const asRecord = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const asText = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

async function pedir(url: string, init: RequestInit) {
  try {
    const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Algunos errores llegan como HTML; nos quedamos con el estado y el texto.
    }
    return { res, body: asRecord(data), text };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError") throw new Error(`El proveedor no respondió en ${TIMEOUT_MS / 1000} s.`);
    throw new Error(`No se pudo alcanzar el servicio: ${e instanceof Error ? e.message : "error de red"}`);
  }
}

/** Extrae el mensaje legible de las distintas formas de error de cada API. */
function mensajeDeError(body: Json, texto: string) {
  const lista = body.Errors ?? body.errors;
  if (Array.isArray(lista) && lista.length) {
    const first = asRecord(lista[0]);
    const msg = asText(first.Message ?? first.message ?? first.Detail);
    if (msg) return msg;
  }
  const anidado = asRecord(body.error);
  return (
    asText(body.error_description) ||
    asText(anidado.message) ||
    asText(body.message ?? body.Message) ||
    asText(body.error) ||
    texto.slice(0, 160) ||
    "credenciales rechazadas"
  );
}

/**
 * Prueba real contra el proveedor: pide un token (Siigo, Google) o consulta la
 * cuenta del token (Meta). Devuelve la descripción de lo que respondió; si algo
 * falla, lanza con el mensaje tal cual lo dio el proveedor.
 */
async function saludar(provider: ProviderKey, c: Credentials): Promise<string> {
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
    if (!valor) faltantes.push(field.label);
    else secretos[field.name] = valor;
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
  return { ok: "Credenciales guardadas. Prueba la conexión para verificarlas." };
}

/** Consulta al proveedor con las credenciales guardadas y anota el resultado. */
export async function probarConexion(formData: FormData) {
  const user = await requireRole(["ADMIN"]);
  const provider = String(formData.get("provider") ?? "");
  const descriptor = providerByKey(provider);
  if (!descriptor) return;

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
}
