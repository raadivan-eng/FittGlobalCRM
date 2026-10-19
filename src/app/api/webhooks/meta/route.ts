import { revalidatePath } from "next/cache";
import { channelToken, metaCredentials, sameToken } from "@/lib/leads";
import { processWebhook, validSignature } from "@/lib/meta";

/**
 * Webhook de Meta: formularios de Lead Ads de Facebook e Instagram y mensajes
 * de WhatsApp Business. Lo llama Meta, no una persona: por eso es ruta de API.
 * En la app de Meta se registra esta URL con el «verify token» que muestra la
 * página de Leads, y se suscriben los campos `leadgen` (página) y `messages`
 * (WhatsApp Business).
 */

/** Verificación de la suscripción: Meta pide de vuelta el `challenge` si el token coincide. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("hub.verify_token") ?? "";
  if (url.searchParams.get("hub.mode") === "subscribe" && sameToken(token, channelToken("meta"))) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Token de verificación inválido", { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  const creds = await metaCredentials();
  // Sin App Secret no hay cómo saber que el aviso lo manda Meta: no se acepta.
  if (!creds?.appSecret) return new Response("Falta la clave secreta de la app de Meta en Conexiones", { status: 503 });
  if (!validSignature(raw, req.headers.get("x-hub-signature-256"), creds.appSecret)) {
    return new Response("Firma inválida", { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Cuerpo inválido", { status: 400 });
  }

  const result = await processWebhook(payload, creds);
  if (result.errores.length) console.error(`webhook meta: ${result.errores.join(" | ")}`);
  if (result.nuevos || result.mensajes) revalidatePath("/", "layout");
  // Siempre 200: lo que falló al pedirlo a la Graph API lo recupera «Sincronizar formularios».
  return Response.json(result);
}
