import { revalidatePath } from "next/cache";
import { cronAutorizado } from "@/lib/cron";
import { siigoSyncBatch } from "@/lib/siigo-sync";

/**
 * Sincronización nocturna de facturas de Siigo. Cada llamada procesa una
 * página; el cron la repite mientras queden. Trae sólo lo modificado desde la
 * última pasada, o sigue la que haya quedado a medias.
 */
export async function POST(req: Request) {
  if (!cronAutorizado(req, "siigo")) return new Response("No autorizado", { status: 401 });

  const batch = await siigoSyncBatch({ userId: null, modo: "NOVEDADES" });
  if (batch.done) revalidatePath("/", "layout");
  return Response.json(batch);
}
