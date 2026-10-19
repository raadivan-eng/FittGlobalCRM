/**
 * Datos tributarios de un cliente tal como salen de su RUT o de su certificado
 * de Cámara de Comercio.
 *
 * Es dato puro —sin prisma ni red— porque el formulario de conversión es un
 * componente de cliente y muestra lo leído antes de crear el cliente. La lectura
 * del documento vive en src/lib/lector-documentos.ts y el alta en Siigo en
 * src/lib/siigo-clientes.ts.
 */

import * as z from "zod/v4";

export const TaxDataSchema = z.object({
  documentType: z
    .enum(["RUT", "CAMARA_COMERCIO", "OTRO"])
    .describe("RUT de la DIAN, certificado de existencia y representación legal (o matrícula mercantil) de una Cámara de Comercio, u OTRO si no es ninguno"),
  personType: z.enum(["JURIDICA", "NATURAL"]).describe("Persona jurídica o persona natural (casilla 24 del RUT)"),
  idType: z
    .enum(["NIT", "CC", "CE"])
    .describe("NIT para persona jurídica; para persona natural, el tipo de documento de identidad (casilla 25 del RUT: 13 = CC, 22 = CE)"),
  idNumber: z.string().describe("Número de identificación sólo con dígitos, sin dígito de verificación ni puntos (casilla 5 del RUT)"),
  checkDigit: z.string().nullable().describe("Dígito de verificación del NIT (casilla 6 del RUT), o null si no aparece"),
  legalName: z.string().describe("Razón social (casilla 35) o, para persona natural, nombres y apellidos completos"),
  firstNames: z.string().nullable().describe("Primer y otros nombres de la persona natural (casillas 33 y 34); null si es jurídica"),
  lastNames: z.string().nullable().describe("Primer y segundo apellido de la persona natural (casillas 31 y 32); null si es jurídica"),
  tradeName: z.string().nullable().describe("Nombre comercial o de la sigla (casilla 36 del RUT, o el del establecimiento en la Cámara)"),
  address: z.string().nullable().describe("Dirección principal (casilla 41) o dirección comercial del certificado"),
  department: z.string().nullable().describe("Nombre del departamento"),
  departmentCode: z.string().nullable().describe("Código DANE de dos dígitos del departamento (casilla 39 del RUT)"),
  city: z.string().nullable().describe("Nombre del municipio"),
  cityCode: z
    .string()
    .nullable()
    .describe("Código DANE de cinco dígitos del municipio: departamento + municipio (casillas 39 y 40 del RUT, p. ej. 11 y 001 → 11001)"),
  email: z.string().nullable().describe("Correo electrónico (casilla 42) o correo comercial del certificado"),
  phone: z.string().nullable().describe("Teléfono principal sólo con dígitos (casilla 44)"),
  responsibilities: z
    .array(z.string())
    .describe("Códigos de responsabilidades de la casilla 53 del RUT, de dos dígitos (\"05\", \"48\"…). Vacío si el documento no los trae"),
  legalRepresentative: z.string().nullable().describe("Nombre completo del representante legal principal, si aparece"),
  economicActivity: z.string().nullable().describe("Código CIIU de la actividad económica principal (casilla 46)"),
  issuedAt: z.string().nullable().describe("Fecha de generación o expedición del documento, AAAA-MM-DD"),
});

export type TaxData = z.infer<typeof TaxDataSchema>;

/**
 * Lo que devuelve la lectura: los datos, lo que conviene revisar antes de crear
 * el cliente y el sello del servidor sobre `raw`, que es lo que vuelve con el formulario.
 */
export type TaxReading = { data?: TaxData; raw?: string; seal?: string; warnings?: string[]; error?: string };

/** Dígito de verificación de la DIAN (módulo 11 con los pesos oficiales). */
export function nitCheckDigit(nit: string) {
  const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const digitos = nit.replace(/\D/g, "").split("").reverse();
  const suma = digitos.reduce((s, d, i) => s + Number(d) * (pesos[i] ?? 0), 0);
  const r = suma % 11;
  return String(r > 1 ? 11 - r : r);
}

/** «900123456-7» si hay dígito de verificación; si no, sólo el número. */
export const formatTaxId = (d: Pick<TaxData, "idNumber" | "checkDigit">) => (d.checkDigit ? `${d.idNumber}-${d.checkDigit}` : d.idNumber);

/**
 * Responsabilidades del RUT que la facturación electrónica reconoce, con el
 * código que pide Siigo. Las demás (05, 07, 42…) no van al tercero; si no hay
 * ninguna de estas, el tercero es «R-99-PN · No aplica».
 */
export const FISCAL_RESPONSIBILITIES: Record<string, { siigo: string; label: string }> = {
  "13": { siigo: "O-13", label: "Gran contribuyente" },
  "15": { siigo: "O-15", label: "Autorretenedor" },
  "23": { siigo: "O-23", label: "Agente de retención en el IVA" },
  "47": { siigo: "O-47", label: "Régimen simple de tributación" },
};

/** Responsable de IVA: casilla 53 con el código 48. */
export const vatResponsible = (d: Pick<TaxData, "responsibilities">) => d.responsibilities.includes("48");

/** Resumen legible de la situación tributaria, para el formulario y la ficha. */
export function taxSummary(d: Pick<TaxData, "responsibilities">) {
  const partes = d.responsibilities.filter((c) => FISCAL_RESPONSIBILITIES[c]).map((c) => FISCAL_RESPONSIBILITIES[c].label);
  partes.push(vatResponsible(d) ? "Responsable de IVA" : d.responsibilities.includes("49") ? "No responsable de IVA" : "IVA sin dato");
  return partes.join(" · ");
}

/** Lee el JSON guardado en `Company.fiscalData` o enviado por el formulario; null si no es válido. */
export function parseTaxData(raw: string | null | undefined): TaxData | null {
  if (!raw) return null;
  try {
    const r = TaxDataSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/**
 * Lo que hay que mirar antes de confiar en la lectura. El dígito de
 * verificación se recalcula: si no cuadra, el NIT o el DV se leyeron mal.
 */
export function taxWarnings(d: TaxData) {
  const avisos: string[] = [];
  if (d.idType === "NIT" && d.checkDigit && nitCheckDigit(d.idNumber) !== d.checkDigit) {
    avisos.push(`El dígito de verificación leído (${d.checkDigit}) no corresponde al NIT ${d.idNumber}: revisa el número contra el documento.`);
  }
  if (!d.cityCode || !/^\d{5}$/.test(d.cityCode)) avisos.push("No se identificó el código DANE del municipio: Siigo lo exige para crear el tercero.");
  if (!d.address) avisos.push("El documento no trae dirección: Siigo la exige para crear el tercero.");
  return avisos;
}
