import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * En desarrollo (`next dev`) se usa el archivo SQLite de DATABASE_URL, igual
 * que las seeds. Desplegado en Cloudflare, la base es D1 y su binding sólo
 * existe dentro de un request: por eso `prisma` es un proxy que resuelve el
 * cliente en cada uso, y el resto del código lo importa como siempre.
 *
 * Ojo: D1 no tiene transacciones. Prisma ejecuta cada `$transaction` como
 * consultas sueltas, sin atomicidad; lo que se escriba ahí debe poder repetirse.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const byBinding = new WeakMap<D1Database, PrismaClient>();

function client(): PrismaClient {
  if (process.env.NODE_ENV === "development") {
    return (globalForPrisma.prisma ??= new PrismaClient({ log: ["error", "warn"] }));
  }
  const db = getCloudflareContext().env.DB;
  let found = byBinding.get(db);
  if (!found) {
    found = new PrismaClient({ adapter: new PrismaD1(db), log: ["error"] });
    byBinding.set(db, found);
  }
  return found;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_, prop) {
    const target = client();
    const value = Reflect.get(target, prop);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
