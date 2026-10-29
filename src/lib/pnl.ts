/**
 * Grupos del estado de resultados y cómo se clasifica una cuenta PUC. Sin
 * dependencias de servidor: lo usan también los editores del navegador.
 */

export const GROUPS = [
  { key: "INGRESOS", label: "Ingresos de actividades ordinarias" },
  { key: "COSTO", label: "Costo de ventas" },
  { key: "OTROS_INGRESOS", label: "Otros ingresos" },
  { key: "PERSONAL", label: "Gastos de administración (personal)" },
  { key: "OTROS_GASTOS", label: "Otros gastos" },
  { key: "FINANCIEROS", label: "Gastos financieros" },
  { key: "IMPUESTOS", label: "Ingreso (gasto) por impuestos" },
] as const;

export type GroupKey = (typeof GROUPS)[number]["key"];

/** Grupo de una cuenta por su código PUC; null si es de balance y no va al estado. */
export function groupOf(code: string): GroupKey | null {
  if (code.startsWith("41")) return "INGRESOS";
  if (code.startsWith("4")) return "OTROS_INGRESOS";
  if (code.startsWith("6") || code.startsWith("7")) return "COSTO";
  if (code.startsWith("5105") || code.startsWith("5205")) return "PERSONAL";
  // 5115 es impuestos de administración (industria y comercio, predial…).
  if (code.startsWith("5115") || code.startsWith("54")) return "IMPUESTOS";
  if (code.startsWith("53")) return "FINANCIEROS";
  if (code.startsWith("5")) return "OTROS_GASTOS";
  return null;
}

export type Totals = Record<GroupKey, number> & {
  grossProfit: number;
  beforeFinancial: number;
  beforeTax: number;
  net: number;
};

/** Subtotales del estado a partir de lo que suma cada grupo. */
export function totalsOf(byGroup: Partial<Record<GroupKey, number>>): Totals {
  const g = Object.fromEntries(GROUPS.map((x) => [x.key, byGroup[x.key] ?? 0])) as Record<GroupKey, number>;
  const grossProfit = g.INGRESOS - g.COSTO;
  const beforeFinancial = grossProfit + g.OTROS_INGRESOS - g.PERSONAL - g.OTROS_GASTOS;
  const beforeTax = beforeFinancial - g.FINANCIEROS;
  return { ...g, grossProfit, beforeFinancial, beforeTax, net: beforeTax - g.IMPUESTOS };
}
