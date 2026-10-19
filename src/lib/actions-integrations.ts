"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireRole } from "./auth";
import { decryptJson, encryptJson } from "./secrets";
import {
  isCarrier,
  moduleByKey,
  providerByKey,
  secretHint,
  type Credentials,
  type Provider,
  type ProviderKey,
} from "./integrations";
import { asRecord, asText, mensajeDeError, pedir } from "./http";
import { carrierAdapter } from "./carriers";
import { siigoAuth, siigoGet } from "./siigo";
import { siigoSyncBatch, type SiigoSyncBatch } from "./siigo-sync";
import { GRAPH_VERSION } from "./meta";
import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "./lector-documentos";


export type ConnectionState = { error?: string; ok?: string };

/**
 * Prueba real contra el proveedor: pide un token (Google) o consulta la cuenta
 * del token (Meta). Siigo, que tiene módulos, se prueba en probarSiigo. Devuelve la descripción de lo que respondió; si algo
 * falla, lanza con el mensaje tal cual lo dio el proveedor.
 */
async function saludar(provider: ProviderKey, c: Credentials): Promise<string> {
  if (isCarrier(provider)) {
    const adapter = carrierAdapter(provider);
    if (!adapter) throw new Error("La integración con esta transportadora todavía no está habilitada en el portal.");
    return adapter.autenticar(c);
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

  if (provider === "CLAUDE") {
    // Consulta el modelo con el que se leen los documentos: no consume tokens.
    try {
      const model = await new Anthropic({ apiKey: c.secret, timeout: 12_000, maxRetries: 0 }).models.retrieve(CLAUDE_MODEL);
      return `Clave válida · ${model.display_name} disponible para leer el RUT`;
    } catch (e) {
      if (e instanceof Anthropic.APIError) throw new Error(`${e.status ?? "Sin respuesta"} · ${e.message}`);
      throw e;
    }
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

  const modulos = (descriptor.modules ?? []).map((m) => ({
    module: m.key,
    partnerId: String(formData.get(`partnerId:${m.key}`) ?? "").trim() || null,
    enabled: formData.get(`enabled:${m.key}`) === "on",
  }));
  for (const m of modulos) {
    if (m.enabled && !m.partnerId) faltantes.push(`Partner-ID de ${moduleByKey(descriptor, m.module)!.name}`);
  }

  if (faltantes.length) return { error: `Falta completar: ${faltantes.join(", ")}.` };
  if (modulos.length && !modulos.some((m) => m.enabled)) return { error: "Activa al menos un módulo." };

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

  for (const m of modulos) {
    const estado = {
      partnerId: m.partnerId,
      enabled: m.enabled,
      status: m.partnerId ? "PENDIENTE" : "SIN_CONFIGURAR",
      lastDetail: null,
      lastError: null,
    };
    await prisma.apiConnectionModule.upsert({
      where: { connectionId_module: { connectionId: row.id, module: m.module } },
      create: { connectionId: row.id, module: m.module, ...estado },
      update: estado,
    });
  }

  const activos = modulos.filter((m) => m.enabled).map((m) => moduleByKey(descriptor, m.module)!.name);
  await registrar(
    row.id,
    "Credenciales actualizadas",
    "INFO",
    `Cuenta ${account}${activos.length ? ` · módulos: ${activos.join(", ")}` : ""}`,
    user.id,
  );
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

  if (descriptor.modules) {
    await probarSiigo(descriptor, row.id, creds, null, user.id);
    revalidatePath("/conexiones");
    return;
  }

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

/**
 * Prueba un solo módulo: pide el token con su Partner-ID y hace su consulta
 * mínima. Sirve para revisar un módulo sin volver a probar los demás.
 */
export async function probarModulo(formData: FormData) {
  const user = await requireRole(["ADMIN"]);
  const descriptor = providerByKey(String(formData.get("provider") ?? ""));
  const module = String(formData.get("module") ?? "");
  if (!descriptor || !moduleByKey(descriptor, module)) return;

  const row = await prisma.apiConnection.findUnique({ where: { provider: descriptor.key } });
  const secretos = decryptJson(row?.secretCipher);
  if (!row || !secretos) return;

  const creds: Credentials = { account: row.account ?? "", secret: secretos.secret ?? "", extra: secretos.extra ?? "" };
  await probarSiigo(descriptor, row.id, creds, module, user.id);
  revalidatePath("/conexiones");
}

/**
 * Siigo da un solo token por cuenta; cada módulo se presenta con su Partner-ID
 * y hace una consulta mínima a lo suyo. La conexión queda conectada sólo si
 * todos los módulos activos responden; si falla uno, los demás siguen sirviendo
 * y el error queda en el módulo.
 */
async function probarSiigo(
  descriptor: Provider,
  connectionId: string,
  creds: Credentials,
  soloModulo: string | null,
  userId: string,
) {
  let filas = await prisma.apiConnectionModule.findMany({ where: { connectionId } });

  // Antes de los módulos, el Partner-ID se guardaba cifrado junto a la clave:
  // si quedó así, pasa a ser el de Facturación.
  if (!filas.length && creds.extra) {
    await prisma.apiConnectionModule.create({
      data: { connectionId, module: "FACTURACION", partnerId: creds.extra, status: "PENDIENTE" },
    });
    filas = await prisma.apiConnectionModule.findMany({ where: { connectionId } });
  }

  const aProbar = filas.filter((f) => f.enabled && f.partnerId && (!soloModulo || f.module === soloModulo));
  const accion = soloModulo ? "Prueba de módulo" : "Prueba de conexión";
  const nombre = (key: string) => moduleByKey(descriptor, key)?.name ?? key;

  if (!aProbar.length) {
    const mensaje = "No hay módulos activos con Partner-ID: edita la conexión y configura al menos uno.";
    await prisma.apiConnection.update({
      where: { id: connectionId },
      data: { status: "ERROR", lastCheckAt: new Date(), lastError: mensaje },
    });
    await registrar(connectionId, accion, "FALLO", mensaje, userId);
    return;
  }

  const inicio = Date.now();
  let token: string;
  let autenticado: string;
  try {
    const auth = await siigoAuth(creds.account, creds.secret, aProbar[0].partnerId!);
    token = auth.token;
    const horas = Math.round(auth.expiresInSeconds / 3600);
    autenticado = `Autenticado como ${creds.account}${horas ? ` · token vigente ${horas} h` : ""}`;
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : "Fallo desconocido";
    const ahora = new Date();
    await prisma.apiConnection.update({
      where: { id: connectionId },
      data: { status: "ERROR", lastCheckAt: ahora, lastError: mensaje },
    });
    await prisma.apiConnectionModule.updateMany({
      where: { id: { in: aProbar.map((f) => f.id) } },
      data: { status: "ERROR", lastCheckAt: ahora, lastError: `No se pudo autenticar: ${mensaje}` },
    });
    await registrar(connectionId, accion, "FALLO", `Autenticación · ${mensaje}`, userId, Date.now() - inicio);
    return;
  }

  const resultados: string[] = [];
  let fallidos = 0;
  for (const fila of aProbar) {
    const def = moduleByKey(descriptor, fila.module);
    if (!def) continue;
    try {
      const body = await siigoGet(token, fila.partnerId!, def.probe.path, { page: "1", page_size: "1" });
      const total = asText(asRecord(body.pagination).total_results);
      const detalle = total ? `Responde · ${total} ${def.probe.noun} en Siigo` : "Responde";
      await prisma.apiConnectionModule.update({
        where: { id: fila.id },
        data: { status: "CONECTADA", lastCheckAt: new Date(), lastDetail: detalle, lastError: null },
      });
      resultados.push(`${def.name}: ok`);
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : "Fallo desconocido";
      await prisma.apiConnectionModule.update({
        where: { id: fila.id },
        data: { status: "ERROR", lastCheckAt: new Date(), lastError: mensaje },
      });
      resultados.push(`${def.name}: ${mensaje}`);
      fallidos++;
    }
  }

  // El estado de la conexión resume el de todos los módulos activos, no sólo los recién probados.
  const activos = (await prisma.apiConnectionModule.findMany({ where: { connectionId } })).filter((f) => f.enabled);
  const fallan = activos.filter((f) => f.status === "ERROR");
  const status = fallan.length ? "ERROR" : activos.every((f) => f.status === "CONECTADA") ? "CONECTADA" : "PENDIENTE";
  await prisma.apiConnection.update({
    where: { id: connectionId },
    data: {
      status,
      lastCheckAt: new Date(),
      lastDetail: autenticado,
      lastError: fallan.length ? `Credenciales válidas, pero falla: ${fallan.map((f) => nombre(f.module)).join(", ")}` : null,
    },
  });
  await registrar(
    connectionId,
    accion,
    fallidos ? "FALLO" : "OK",
    resultados.join(" · "),
    userId,
    Date.now() - inicio,
  );
}

/**
 * Un lote de la sincronización de facturas de Siigo. El botón la llama en
 * bucle hasta que `done`: cada llamada es una invocación con sus propios
 * límites, y si se corta, la siguiente sigue donde iba. A mano siempre se
 * repasa todo 2026, para refrescar saldos y vencimientos.
 */
export async function sincronizarSiigo(): Promise<SiigoSyncBatch> {
  const user = await requireRole(["ADMIN"]);
  const batch = await siigoSyncBatch({ userId: user.id, modo: "COMPLETA" });
  if (batch.done) revalidatePath("/", "layout");
  return batch;
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
  // Los Partner-ID no son secretos: se conservan para reconectar, sin estado.
  await prisma.apiConnectionModule.updateMany({
    where: { connectionId: row.id },
    data: { status: "SIN_CONFIGURAR", lastDetail: null, lastError: null, lastCheckAt: null },
  });
  await registrar(row.id, "Conexión desconectada", "INFO", "Se borraron las credenciales guardadas", user.id);
  revalidatePath("/conexiones");
  revalidatePath("/guias");
}
