/**
 * Reglas de las condiciones de compra por SKU, compartidas por la cotización y
 * el proveedor. Es dato puro —sin prisma— porque los formularios de cliente
 * también las usan para avisar qué falta.
 */

/** Las cuatro respuestas que se le piden al proveedor por cada SKU, además del SKU. */
export type ConditionAnswers = {
  minOrderQty: number | null;
  unitCost: number | null;
  productionLeadDays: number | null;
  transitDays: number | null;
};

export const lineComplete = (l: ConditionAnswers) =>
  l.minOrderQty != null && l.unitCost != null && l.productionLeadDays != null && l.transitDays != null;

/** Días desde que se emite la orden hasta que la mercancía llega: producción más tránsito. */
export const totalLeadDays = (l: Pick<ConditionAnswers, "productionLeadDays" | "transitDays">) =>
  l.productionLeadDays != null && l.transitDays != null ? l.productionLeadDays + l.transitDays : null;

/** Lo que cuesta la compra mínima de un SKU. */
export const minOrderValue = (l: Pick<ConditionAnswers, "minOrderQty" | "unitCost">) =>
  l.minOrderQty != null && l.unitCost != null ? l.minOrderQty * l.unitCost : null;

/** Un certificado de Cámara de Comercio con más de estos días se pide de nuevo. */
export const CHAMBER_MAX_AGE_DAYS = 30;

/** Plazo en días sacado del texto de las condiciones («Pago a 30 días» → 30, «Contado» → 0). */
export function termDaysFrom(text: string | null | undefined) {
  if (!text) return null;
  if (/contado|anticipad|anticipo/i.test(text) && !/\d/.test(text)) return 0;
  const m = text.match(/(\d{1,3})\s*d[ií]as?/i) ?? text.match(/\b(\d{1,3})\b/);
  return m ? Number(m[1]) : null;
}
