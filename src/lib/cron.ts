import "server-only";
import crypto from "node:crypto";
import { sessionSecret } from "./secrets";

/**
 * Las rutas de /api/cron las llama el cron del Worker (worker.ts), no una
 * persona. Se autentican con un token derivado de SESSION_SECRET y del nombre
 * del trabajo, que el cron calcula igual: no hay un secreto más que mantener.
 */
export function cronAutorizado(req: Request, trabajo: string) {
  const expected = crypto.createHmac("sha256", sessionSecret()).update(`cron:${trabajo}`).digest("hex");
  const got = req.headers.get("x-cron-token") ?? "";
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
