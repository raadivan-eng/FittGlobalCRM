import "server-only";

/**
 * Llamadas HTTP a proveedores externos. Lo usan la prueba de conexiones y los
 * adaptadores de transportadoras, para que todos fallen igual: con tope de
 * tiempo y con el mensaje tal cual lo dio el proveedor.
 */

/** La llamada habla de verdad con el proveedor; sin tope, un host caído cuelga la acción. */
export const TIMEOUT_MS = 12_000;

export type Json = Record<string, unknown>;

export const asRecord = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
export const asText = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

export async function pedir(url: string, init: RequestInit) {
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
export function mensajeDeError(body: Json, texto: string) {
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
