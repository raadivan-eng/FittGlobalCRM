import "server-only";
import crypto from "node:crypto";

/**
 * Cifrado de las credenciales de las conexiones externas.
 *
 * La clave se deriva de SESSION_SECRET, así que rotar ese secreto invalida las
 * credenciales guardadas: hay que volver a cargarlas. Es el precio de no meter
 * un gestor de secretos en un portal que corre sobre SQLite.
 */

/**
 * En Cloudflare Workers las variables llegan con cada request, no al cargar el
 * módulo: por eso se leen tarde. En producción, sin secreto no se arranca.
 */
export function sessionSecret() {
  const value = process.env.SESSION_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error("Falta SESSION_SECRET");
  return "fitt-global-crm-insecure-fallback";
}

let key: Buffer | undefined;
const KEY = () => (key ??= crypto.scryptSync(sessionSecret(), "fitt-api-connections", 32));

/** Devuelve `iv.tag.ciphertext` en base64url. */
export function encryptJson(value: Record<string, string>) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

/**
 * Sello de un texto generado en el servidor (los datos leídos de un RUT), para
 * aceptarlo de vuelta desde el formulario sin que se pueda fabricar en el navegador.
 */
export function seal(text: string) {
  return crypto.createHmac("sha256", KEY()).update(text).digest("base64url");
}

export function sealMatches(text: string, mark: string) {
  const a = Buffer.from(seal(text));
  const b = Buffer.from(mark);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** `null` si el paquete está corrupto o la clave cambió: nunca lanza. */
export function decryptJson(packed: string | null | undefined): Record<string, string> | null {
  if (!packed) return null;
  const [iv, tag, body] = packed.split(".");
  if (!iv || !tag || !body) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const plain = Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]);
    return JSON.parse(plain.toString("utf8")) as Record<string, string>;
  } catch {
    return null;
  }
}
