// Punto de entrada del Worker: el de OpenNext más los crons (localizador y
// sincronización con Siigo). wrangler lo empaqueta después de
// `opennextjs-cloudflare build`, cuando .open-next/worker.js ya existe.
import { createHmac } from "node:crypto";
// @ts-ignore: lo genera el build de OpenNext
import { default as handler } from "./.open-next/worker.js";

// @ts-ignore: lo genera el build de OpenNext
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

/**
 * Cada expresión de `triggers.crons` en wrangler.jsonc dispara un trabajo.
 * El tope de lotes respeta el de peticiones salientes por invocación.
 */
const JOBS: Record<string, { name: string; maxBatches: number; describe: (batch: Record<string, unknown>) => string; more: (batch: Record<string, unknown>) => boolean }> = {
  // 06:00 Bogotá
  "0 11 * * *": {
    name: "localizador",
    maxBatches: 15,
    describe: (b) => `${b.processed} búsquedas, ${b.found} tiendas nuevas, faltan ${b.remaining}`,
    more: (b) => Boolean(b.processed && b.remaining),
  },
  // 02:00 Bogotá. Lo que no alcance esta noche sigue mañana desde el mismo punto.
  "0 7 * * *": {
    name: "siigo",
    maxBatches: 40,
    describe: (b) => `página ${b.page} de ${b.pages}, ${b.nuevas} facturas nuevas, ${b.actualizadas} actualizadas`,
    // Si Siigo pidió una pausa, se sigue la noche siguiente.
    more: (b) => !b.done && !b.retryAfterSeconds,
  },
};

export default {
  fetch: handler.fetch,

  async scheduled(event: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    const job = JOBS[event.cron];
    if (!job) return;
    const token = createHmac("sha256", env.SESSION_SECRET).update(`cron:${job.name}`).digest("hex");
    ctx.waitUntil(
      (async () => {
        for (let i = 0; i < job.maxBatches; i++) {
          // Por la autorreferencia y no llamando a handler.fetch: así cada lote es una invocación nueva.
          const res = await env.WORKER_SELF_REFERENCE.fetch(`https://crm.fittglobal.com/api/cron/${job.name}`, {
            method: "POST",
            headers: { "x-cron-token": token },
          });
          if (!res.ok) {
            console.error(`${job.name}: ${res.status} ${await res.text()}`);
            return;
          }
          const batch = (await res.json()) as Record<string, unknown>;
          console.log(`${job.name}: ${job.describe(batch)}`);
          if (batch.error) console.error(`${job.name}: ${batch.error}`);
          if (batch.error || !job.more(batch)) return;
        }
      })(),
    );
  },
} satisfies ExportedHandler<CloudflareEnv>;
