import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type * as z from "zod/v4";
import { prisma } from "./prisma";
import { CLAUDE_MODEL, claudeApiKey, documentBlock, isReadableType, MAX_DOCUMENT_BYTES } from "./lector-documentos";
import { InvoiceSchema, PackingSchema, type InvoiceData, type PackingData } from "./receipts";

/**
 * Lectura con Claude de los documentos de un ingreso de mercancía: la factura
 * del proveedor y las fotos de las etiquetas que certifican lo recibido.
 *
 * Como en el RUT, lo leído nunca entra a ciegas: el formulario lo muestra para
 * corregirlo y el cuadre contra la factura se recalcula aparte.
 */

const SYSTEM_FACTURA = `Lees facturas de proveedores de una comercializadora mayorista colombiana de suplementos y alimentos, para registrar la mercancía que va a entrar a bodega.

La factura puede ser electrónica de la DIAN (PDF con CUFE y código QR), una factura impresa o una foto. Extrae el emisor (el proveedor que vende, no el comprador), el número con su prefijo, la fecha de expedición y un elemento por cada renglón de producto.

Copia códigos y descripciones tal como aparecen, sin corregirlos. Las cantidades van en unidades: si el renglón factura cajas o displays e indica cuántas unidades trae cada uno, multiplícalo. El valor unitario es antes de IVA. No incluyas fletes, descuentos globales, retenciones ni impuestos como renglones. Si un dato no aparece, devuelve null.`;

const SYSTEM_ETIQUETAS = `Lees fotos tomadas con el celular en el muelle de una bodega, al recibir mercancía de un proveedor. La foto puede ser la etiqueta de un producto, el rótulo de una caja o corrugado, varias unidades sobre una estiba, o el packing list impreso del proveedor.

De cada producto y lote visible extrae el lote, la fecha de vencimiento y la cantidad. Recibes la lista de productos que se esperan en este ingreso, con su SKU, nombre, código de barras y unidades por caja: identifica cada producto de la foto con el SKU de esa lista cuando el código de barras o el nombre coincidan con certeza.

Copia el lote exactamente como está impreso, con letras, guiones y ceros. Las fechas impresas suelen ir como DD/MM/AAAA, MM/AAAA o con el mes en letras; devuélvelas en AAAA-MM-DD. Si no se lee un dato con seguridad, devuelve null en lugar de suponerlo.`;

type Lectura<T> = { data?: T; error?: string };

async function leer<T>(apiKey: string, system: string, schema: z.ZodType<T>, content: Anthropic.Beta.BetaContentBlockParam[]): Promise<Lectura<T>> {
  const client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 });
  try {
    const res = await client.beta.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      // Si el modelo declina por política, el servidor reintenta con su alternativa por defecto.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      output_config: { format: betaZodOutputFormat(schema) },
      messages: [{ role: "user", content }],
    });
    if (res.stop_reason === "refusal") return { error: "Claude no procesó el archivo." };
    if (res.stop_reason === "max_tokens" || !res.parsed_output) return { error: "La lectura quedó incompleta; intenta de nuevo." };
    return { data: res.parsed_output as T };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { error: "Claude rechazó la API key: revísala en Conexiones API." };
    if (e instanceof Anthropic.RateLimitError) return { error: "Claude está limitando las peticiones; intenta en un minuto." };
    if (e instanceof Anthropic.BadRequestError) return { error: `Claude no aceptó el archivo: ${e.message}` };
    if (e instanceof Anthropic.APIError) return { error: `Claude respondió ${e.status ?? "con error"}: ${e.message}` };
    return { error: `No se pudo leer el archivo: ${e instanceof Error ? e.message : "fallo desconocido"}` };
  }
}

/** Valida el archivo del formulario y lo devuelve en base64, o el motivo por el que no sirve. */
async function archivo(file: FormDataEntryValue | null, missing: string, soloFoto: boolean) {
  if (!(file instanceof File) || !file.size) return { error: missing };
  if (file.size > MAX_DOCUMENT_BYTES) return { error: "El archivo pesa más de 8 MB; sube uno más liviano." };
  if (!isReadableType(file.type) || (soloFoto && file.type === "application/pdf")) {
    return { error: soloFoto ? "Sube una foto (JPG, PNG o WebP)." : "Sube un PDF o una foto (JPG, PNG o WebP)." };
  }
  const apiKey = await claudeApiKey();
  if (!apiKey) return { error: "La lectura de documentos no está conectada: carga la API key de Claude en Conexiones API." };
  return { apiKey, block: documentBlock(Buffer.from(await file.arrayBuffer()).toString("base64"), file.type) };
}

/** Deja la lectura en la bitácora de la conexión con Claude. */
async function bitacora(action: string, ok: boolean, detail: string | null, userId: string, inicio: number) {
  const conexion = await prisma.apiConnection.findUnique({ where: { provider: "CLAUDE" }, select: { id: true } });
  if (!conexion) return;
  await prisma.apiConnectionEvent.create({
    data: { connectionId: conexion.id, action, result: ok ? "OK" : "FALLO", detail, userId, durationMs: Date.now() - inicio },
  });
}

/** Lee la factura subida en el formulario. No guarda nada: quien la pide cruza los renglones con el catálogo. */
export async function readSupplierInvoice(file: FormDataEntryValue | null, userId: string): Promise<Lectura<InvoiceData>> {
  const a = await archivo(file, "Elige el PDF o la foto de la factura.", false);
  if ("error" in a) return { error: a.error };
  const inicio = Date.now();
  const r = await leer(a.apiKey, SYSTEM_FACTURA, InvoiceSchema, [a.block, { type: "text", text: "Extrae los datos de esta factura de proveedor." }]);
  if (r.data?.documentType === "OTRO") r.error = "El archivo no parece una factura de proveedor.";
  const d = r.error ? undefined : r.data;
  await bitacora("Lectura de factura", Boolean(d), d ? `Factura ${d.invoiceNumber} de ${d.supplierName} · ${d.lines.length} renglones` : (r.error ?? null), userId, inicio);
  return d ? { data: d } : { error: r.error };
}

export type ExpectedProduct = { sku: string; name: string; barcode: string | null; unitsPerCase: number };

/** Lee la foto de etiquetas contra los productos que se esperan en el ingreso. */
export async function readPackingPhoto(file: FormDataEntryValue | null, expected: ExpectedProduct[], userId: string): Promise<Lectura<PackingData>> {
  const a = await archivo(file, "Toma o elige la foto de la etiqueta.", true);
  if ("error" in a) return { error: a.error };
  const lista = expected.map((p) => `- SKU ${p.sku} · ${p.name}${p.barcode ? ` · código de barras ${p.barcode}` : ""} · ${p.unitsPerCase} unidades por caja`).join("\n");
  const inicio = Date.now();
  const r = await leer(a.apiKey, SYSTEM_ETIQUETAS, PackingSchema, [
    a.block,
    { type: "text", text: `Productos esperados en este ingreso:\n${lista}\n\nExtrae lote, vencimiento y cantidad de cada producto de la foto.` },
  ]);
  const d = r.data;
  await bitacora("Lectura de etiquetas", Boolean(d), d ? `${d.items.length} lotes leídos de la foto` : (r.error ?? null), userId, inicio);
  return r;
}
