/**
 * Ingresos de mercancía: lo que se lee de la factura del proveedor y de las
 * fotos del packing slip, y el cuadre entre lo facturado y lo recibido.
 *
 * Es dato puro —sin prisma ni red— porque los formularios son componentes de
 * cliente y muestran el cuadre mientras se cuenta. La lectura con Claude vive
 * en src/lib/lector-bodega.ts y las mutaciones en src/lib/actions-receipts.ts.
 */

import * as z from "zod/v4";

// ────────────────────────────────  Factura  ──────────────────────────────────

export const InvoiceSchema = z.object({
  documentType: z.enum(["FACTURA", "OTRO"]).describe("FACTURA si es una factura de venta (electrónica o no) de un proveedor; OTRO si es cualquier otra cosa"),
  supplierName: z.string().describe("Razón social del emisor de la factura (el proveedor que vende)"),
  supplierTaxId: z.string().nullable().describe("NIT del emisor sólo con dígitos, sin dígito de verificación ni puntos"),
  invoiceNumber: z.string().describe("Número de la factura con su prefijo, tal como aparece (p. ej. «FE-10234»)"),
  invoiceDate: z.string().nullable().describe("Fecha de expedición de la factura, AAAA-MM-DD"),
  lines: z
    .array(
      z.object({
        code: z.string().describe("Código, referencia o SKU del producto en el renglón; el código de barras si es lo único que trae; vacío si no hay"),
        description: z.string().describe("Descripción del producto tal como aparece"),
        quantity: z.number().describe("Cantidad facturada en unidades. Si el renglón factura cajas, display o paquetes y dice cuántas unidades trae cada uno, conviértelo a unidades"),
        unitCost: z.number().nullable().describe("Valor unitario antes de IVA y después de descuentos, en la moneda de la factura"),
      }),
    )
    .describe("Un elemento por renglón de producto. No incluyas fletes, descuentos globales, retenciones ni impuestos"),
});

export type InvoiceData = z.infer<typeof InvoiceSchema>;

/** Renglón de factura ya cruzado contra el catálogo: `productId` null si no se reconoció el código. */
export type InvoiceLineDraft = { sku: string; description: string; quantity: number; unitCost: number | null; productId: string | null };

export type InvoiceReading = {
  data?: Omit<InvoiceData, "lines" | "documentType"> & { supplierId: string | null; lines: InvoiceLineDraft[] };
  warnings?: string[];
  error?: string;
};

// ──────────────────────────────  Packing slip  ───────────────────────────────

export const PackingSchema = z.object({
  items: z
    .array(
      z.object({
        sku: z
          .string()
          .nullable()
          .describe("SKU del catálogo de la lista de productos esperados que corresponde a este producto; null si no se puede identificar con certeza"),
        printedCode: z.string().nullable().describe("Código de barras, referencia o SKU impreso en la etiqueta, tal como aparece"),
        description: z.string().describe("Nombre del producto como aparece en la etiqueta"),
        lotCode: z.string().nullable().describe("Número de lote (LOT, L., Lote, Batch) exactamente como está impreso; null si no se lee"),
        expiryDate: z
          .string()
          .nullable()
          .describe("Fecha de vencimiento (EXP, Vence, Best before, Consumir antes de) en AAAA-MM-DD. Si sólo trae mes y año, el último día de ese mes. Null si no se lee"),
        quantity: z.number().nullable().describe("Cantidad que indica la etiqueta o la que se ve contada en la foto; null si no se puede saber"),
        unit: z.enum(["UNIDAD", "CAJA"]).describe("CAJA si la cantidad está en cajas, corrugados o displays; UNIDAD si son unidades sueltas"),
      }),
    )
    .describe("Un elemento por combinación de producto y lote visible en la foto"),
});

export type PackingData = z.infer<typeof PackingSchema>;

/** Renglón del packing slip en el formulario: un lote de un producto. */
export type PackingRow = {
  key: string;
  productId: string;
  lotCode: string;
  expiryDate: string; // AAAA-MM-DD
  quantity: string; // texto del campo; se valida al guardar
  source: "LECTURA" | "MANUAL";
};

export type PackingReading = { rows?: Omit<PackingRow, "key">[]; warnings?: string[]; error?: string };

// ────────────────────────────────  Cuadre  ───────────────────────────────────

/** Un vencimiento a menos de estos días se recibe con advertencia: cae en las bandas de riesgo del inventario. */
export const SHORT_EXPIRY_DAYS = 90;

export type Reconciliation = { productId: string; invoiced: number; received: number; diff: number };

/**
 * Lo facturado contra lo contado, por producto. Los productos que llegaron sin
 * estar en la factura también aparecen, con facturado en cero.
 */
export function reconcile(lines: { productId: string; quantity: number }[], lots: { productId: string; quantity: number }[]): Reconciliation[] {
  const rows = new Map<string, Reconciliation>();
  const row = (productId: string) => rows.get(productId) ?? rows.set(productId, { productId, invoiced: 0, received: 0, diff: 0 }).get(productId)!;
  for (const l of lines) row(l.productId).invoiced += l.quantity;
  for (const l of lots) row(l.productId).received += Number.isFinite(l.quantity) ? l.quantity : 0;
  for (const r of rows.values()) r.diff = r.received - r.invoiced;
  return [...rows.values()];
}

export const matches = (r: Reconciliation[]) => r.every((x) => x.diff === 0);

/** «2027-03-31» → mediodía en Bogotá, para que la fecha no cambie de día al pintarla. */
export function dateFromIso(iso: string | null | undefined) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T12:00:00-05:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const isoDate = (d: Date) => new Date(d.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);

export const daysUntil = (d: Date, from = new Date()) => Math.floor((d.getTime() - from.getTime()) / 86_400_000);
