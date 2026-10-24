import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { prisma } from "./prisma";
import { decryptJson } from "./secrets";
import { formatTaxId, TaxDataSchema, taxWarnings, type TaxReading } from "./rut";

/**
 * Lectura del RUT o del certificado de Cámara de Comercio con Claude.
 *
 * Llegan como PDF descargado de la DIAN, como PDF escaneado o como foto, así
 * que no se parsea el texto: Claude lee el documento y devuelve los campos con
 * un esquema fijo. Lo leído nunca se usa a ciegas: el formulario lo muestra
 * para revisar y el dígito de verificación se recalcula aparte.
 */

export const CLAUDE_MODEL = "claude-opus-5-5";

/** Tope del archivo: un RUT pesa unos cientos de KB; una foto de celular, unos MB. */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

const SYSTEM = `Lees documentos tributarios colombianos para dar de alta clientes y proveedores en un ERP.

Recibes uno de dos documentos:
- El RUT (formulario 001 de la DIAN). Los datos están en casillas numeradas: 5 NIT, 6 DV, 24 tipo de contribuyente, 25 tipo de documento, 31 a 34 apellidos y nombres, 35 razón social, 36 nombre comercial, 39 departamento (código de dos dígitos), 40 municipio (código de tres dígitos), 41 dirección, 42 correo, 44 teléfono 1, 46 actividad principal y 53 responsabilidades (códigos de dos dígitos).
- El certificado de existencia y representación legal, o de matrícula mercantil, de una Cámara de Comercio. Trae razón social, NIT, domicilio, dirección y correo comercial y representante legal, pero no responsabilidades fiscales.

Copia los valores tal como aparecen, sin corregirlos ni completarlos con suposiciones. Si un dato no aparece, devuelve null (o una lista vacía). La única excepción es el código DANE del municipio en un certificado de Cámara: como no lo trae impreso, dalo a partir del municipio del domicilio sólo si lo conoces con certeza.`;

/** API key de Claude guardada en Conexiones; null si no está configurada. */
export async function claudeApiKey() {
  const row = await prisma.apiConnection.findUnique({ where: { provider: "CLAUDE" }, select: { secretCipher: true } });
  return decryptJson(row?.secretCipher)?.secret || null;
}

export function documentBlock(base64: string, mediaType: string): Anthropic.Beta.BetaContentBlockParam {
  if (mediaType === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } };
  }
  return { type: "image", source: { type: "base64", media_type: mediaType as ImageType, data: base64 } };
}

export const isReadableType = (mediaType: string) => mediaType === "application/pdf" || (IMAGE_TYPES as readonly string[]).includes(mediaType);

/** Lee el documento y devuelve sus datos tributarios, o el motivo por el que no se pudo. */
export async function readTaxDocument(apiKey: string, bytes: ArrayBuffer, mediaType: string): Promise<TaxReading> {
  const client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 });
  try {
    const res = await client.beta.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      // Si el modelo declina por política, el servidor reintenta con su alternativa por defecto.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: { format: betaZodOutputFormat(TaxDataSchema) },
      messages: [
        {
          role: "user",
          content: [documentBlock(Buffer.from(bytes).toString("base64"), mediaType), { type: "text", text: "Extrae los datos tributarios de este documento." }],
        },
      ],
    });

    if (res.stop_reason === "refusal") return { error: "Claude no procesó el documento. Revisa que sea un RUT o un certificado de Cámara de Comercio." };
    if (res.stop_reason === "max_tokens" || !res.parsed_output) return { error: "La lectura quedó incompleta; intenta de nuevo." };

    const data = res.parsed_output;
    if (data.documentType === "OTRO") return { error: "El archivo no parece un RUT ni un certificado de Cámara de Comercio." };
    data.idNumber = data.idNumber.replace(/\D/g, "");
    if (!data.idNumber) return { error: "No se pudo leer el número de identificación del documento." };
    data.checkDigit = data.checkDigit?.replace(/\D/g, "") || null;
    data.phone = data.phone?.replace(/\D/g, "") || null;
    data.email = data.email?.trim().toLowerCase() || null;
    return { data, warnings: taxWarnings(data) };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { error: "Claude rechazó la API key: revísala en Conexiones API." };
    if (e instanceof Anthropic.RateLimitError) return { error: "Claude está limitando las peticiones; intenta en un minuto." };
    if (e instanceof Anthropic.BadRequestError) return { error: `Claude no aceptó el archivo: ${e.message}` };
    if (e instanceof Anthropic.APIError) return { error: `Claude respondió ${e.status ?? "con error"}: ${e.message}` };
    return { error: `No se pudo leer el documento: ${e instanceof Error ? e.message : "fallo desconocido"}` };
  }
}

/**
 * Lectura desde un formulario: valida el archivo, lo lee y deja la lectura en
 * la bitácora de la conexión con Claude. No guarda nada más; quien la pide
 * decide qué documento esperaba y sella lo leído.
 */
export async function readUploadedDocument(file: FormDataEntryValue | null, userId: string, missing: string): Promise<TaxReading> {
  if (!(file instanceof File) || !file.size) return { error: missing };
  if (file.size > MAX_DOCUMENT_BYTES) return { error: "El archivo pesa más de 8 MB; sube el PDF original o una foto más liviana." };
  if (!isReadableType(file.type)) return { error: "Sube un PDF o una foto (JPG, PNG o WebP)." };

  const apiKey = await claudeApiKey();
  if (!apiKey) return { error: "La lectura de documentos no está conectada: carga la API key de Claude en Conexiones API." };

  const inicio = Date.now();
  const lectura = await readTaxDocument(apiKey, await file.arrayBuffer(), file.type);
  const conexion = await prisma.apiConnection.findUnique({ where: { provider: "CLAUDE" }, select: { id: true } });
  if (conexion) {
    const d = lectura.data;
    await prisma.apiConnectionEvent.create({
      data: {
        connectionId: conexion.id,
        action: "Lectura de documento",
        result: d ? "OK" : "FALLO",
        detail: d ? `${d.documentType === "RUT" ? "RUT" : "Cámara de Comercio"} de ${d.legalName} · ${d.idType} ${formatTaxId(d)}` : lectura.error ?? null,
        userId,
        durationMs: Date.now() - inicio,
      },
    });
  }
  return lectura;
}
