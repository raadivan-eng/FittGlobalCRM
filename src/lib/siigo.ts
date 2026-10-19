import "server-only";

/**
 * Cliente mínimo de la API de Siigo. Las credenciales (usuario y access key)
 * son de la cuenta y dan un solo token; el Partner-ID va en la cabecera de cada
 * petición y dice qué módulo del portal la hizo.
 */

import { asText, mensajeDeError, pedir } from "./http";

const BASE = "https://api.siigo.com";

export type SiigoToken = { token: string; expiresInSeconds: number };

/**
 * Siigo admite unas 100 peticiones por minuto por empresa. Pasada la cuota no
 * es un fallo: quien sincroniza espera y sigue donde iba.
 */
export class SiigoLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`Siigo pidió una pausa de ${retryAfterSeconds} s por exceso de peticiones.`);
  }
}

function revisarCuota(res: Response) {
  if (res.status === 429) throw new SiigoLimitError(Number(res.headers.get("retry-after")) || 60);
}

export async function siigoAuth(username: string, accessKey: string, partnerId: string): Promise<SiigoToken> {
  const { res, body, text } = await pedir(`${BASE}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Partner-Id": partnerId },
    body: JSON.stringify({ username, access_key: accessKey }),
  });
  revisarCuota(res);
  if (!res.ok) throw new Error(`${res.status} · ${mensajeDeError(body, text)}`);
  const token = asText(body.access_token);
  if (!token) throw new Error("Siigo respondió sin token de acceso.");
  return { token, expiresInSeconds: Number(body.expires_in ?? 0) };
}

/** POST autenticado. Devuelve el recurso creado; si Siigo lo rechaza, lanza su mensaje. */
export async function siigoPost(token: string, partnerId: string, path: string, payload: unknown) {
  const { res, body, text } = await pedir(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Partner-Id": partnerId, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  revisarCuota(res);
  if (!res.ok) throw new Error(`${res.status} · ${mensajeDeError(body, text)}`);
  return body;
}

/** GET autenticado. Devuelve el cuerpo ya interpretado; si Siigo lo rechaza, lanza su mensaje. */
export async function siigoGet(token: string, partnerId: string, path: string, query: Record<string, string> = {}) {
  const qs = new URLSearchParams(query).toString();
  const { res, body, text } = await pedir(`${BASE}${path}${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}`, "Partner-Id": partnerId },
  });
  revisarCuota(res);
  if (!res.ok) throw new Error(`${res.status} · ${mensajeDeError(body, text)}`);
  return body;
}
