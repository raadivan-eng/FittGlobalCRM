import { revalidatePath } from "next/cache";
import { cronAutorizado } from "@/lib/cron";
import { locatorBatch } from "@/lib/store-locator";

/**
 * La llama el cron del Worker (worker.ts), no una persona: por eso es ruta de
 * API y no server action. Cada llamada corre un lote corto de búsquedas para
 * quedar dentro de los límites de una invocación; el cron la repite.
 */

const BATCH_SIZE = 4;
const WEEK_MS = 6.5 * 24 * 60 * 60 * 1000; // con cron diario, cada ciudad se repasa una vez por semana

export async function POST(req: Request) {
  if (!cronAutorizado(req, "localizador")) return new Response("No autorizado", { status: 401 });

  const batch = await locatorBatch({ size: BATCH_SIZE, before: new Date(Date.now() - WEEK_MS) });
  if (batch.processed) {
    revalidatePath("/tiendas", "layout");
    revalidatePath("/", "layout");
  }
  return Response.json(batch);
}
