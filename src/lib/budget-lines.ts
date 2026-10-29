/**
 * Rubros y criterios del presupuesto. Es lógica pura, sin base de datos, para
 * que el servidor y los editores del navegador clasifiquen y sumen igual.
 *
 * Un rubro agrupa cuentas del PUC por prefijo (gana el prefijo más largo), cae
 * en un bloque del estado de resultados —que decide su signo y en qué
 * subtotal entra— y dice cómo se mide lo real de cada cliente: con lo que el
 * CRM sabe de él (ventas, costo, fletes, trade) o repartiendo lo que reporta
 * la contabilidad. Los rubros se editan en Presupuesto → Configuración; sin
 * configuración guardada rigen DEFAULT_RUBROS.
 */

/** Bloques del estado de resultados, en su orden. `sign` es cómo suman a la ganancia. */
export const BLOCKS = [
  { key: "INGRESOS", label: "Ingresos", sign: 1 },
  { key: "COSTO", label: "Costo de ventas", sign: -1 },
  { key: "COMERCIAL", label: "Gastos comerciales atribuibles", sign: -1 },
  { key: "OTROS_INGRESOS", label: "Otros ingresos", sign: 1 },
  { key: "OPERATIVO", label: "Gastos operativos", sign: -1 },
  { key: "FINANCIEROS", label: "Gastos financieros", sign: -1 },
  { key: "IMPUESTOS", label: "Impuestos", sign: -1 },
] as const;
export type BlockKey = (typeof BLOCKS)[number]["key"];

/** Cómo se mide lo real de un rubro en cada cliente. */
export const SOURCES = [
  { key: "VENTAS", label: "Venta facturada en Siigo" },
  { key: "COSTO", label: "Costo de lo vendido" },
  { key: "FLETES", label: "Fletes de las guías de envío" },
  { key: "TRADE", label: "Inversión en actividades de trade" },
  { key: "REPARTIDO", label: "Repartido del estado de resultados" },
] as const;
export type SourceKey = (typeof SOURCES)[number]["key"];

export type Rubro = { key: string; label: string; prefixes: string[]; block: BlockKey; source: SourceKey };

/** Los rubros de siempre: reproducen los grupos del estado de resultados, con fletes y publicidad aparte. */
export const DEFAULT_RUBROS: Rubro[] = [
  { key: "INGRESOS", label: "Ingresos netos", prefixes: ["41"], block: "INGRESOS", source: "VENTAS" },
  { key: "COSTO", label: "Costo de ventas", prefixes: ["6", "7"], block: "COSTO", source: "COSTO" },
  { key: "FLETES", label: "Transportes, fletes y acarreos", prefixes: ["523550"], block: "COMERCIAL", source: "FLETES" },
  { key: "PROMOCION", label: "Publicidad, propaganda y promoción", prefixes: ["523560"], block: "COMERCIAL", source: "TRADE" },
  { key: "OTROS_INGRESOS", label: "Otros ingresos", prefixes: ["4"], block: "OTROS_INGRESOS", source: "REPARTIDO" },
  { key: "PERSONAL", label: "Gastos de administración", prefixes: ["5105", "5205"], block: "OPERATIVO", source: "REPARTIDO" },
  { key: "OTROS_GASTOS", label: "Otros gastos", prefixes: ["5"], block: "OPERATIVO", source: "REPARTIDO" },
  { key: "FINANCIEROS", label: "Gastos financieros", prefixes: ["53"], block: "FINANCIEROS", source: "REPARTIDO" },
  { key: "IMPUESTOS", label: "Impuestos", prefixes: ["5115", "54"], block: "IMPUESTOS", source: "REPARTIDO" },
];

const blockOf = (key: BlockKey) => BLOCKS.find((b) => b.key === key)!;
export const blockIndex = (key: BlockKey) => BLOCKS.findIndex((b) => b.key === key);
export const isExpense = (r: Rubro) => blockOf(r.block).sign < 0;
/** El rubro que manda la participación base: el de la venta. */
export const salesRubro = (rubros: Rubro[]) => rubros.find((r) => r.source === "VENTAS") ?? rubros.find((r) => r.block === "INGRESOS");

/** Rubro de una cuenta PUC: el del prefijo más largo que la cubra; null si ninguno. */
export function rubroOf(code: string, rubros: Rubro[]): Rubro | null {
  let best: Rubro | null = null;
  let length = 0;
  for (const r of rubros)
    for (const p of r.prefixes)
      if (code.startsWith(p) && p.length > length) {
        best = r;
        length = p.length;
      }
  return best;
}

/** Montos por clave de rubro. Una clave ausente vale cero. */
export type Lines = Record<string, number>;

export const val = (l: Lines | undefined, key: string) => l?.[key] ?? 0;

export function addLines(into: Lines, l: Lines | undefined, factor = 1) {
  if (l) for (const k of Object.keys(l)) into[k] = (into[k] ?? 0) + l[k] * factor;
  return into;
}

export const sumLines = (ls: Iterable<Lines | undefined>) => {
  const t: Lines = {};
  for (const l of ls) addLines(t, l);
  return t;
};

/** Subtotales del estado según el bloque de cada rubro. */
export function subtotals(l: Lines, rubros: Rubro[]) {
  const by = Object.fromEntries(BLOCKS.map((b) => [b.key, 0])) as Record<BlockKey, number>;
  for (const r of rubros) by[r.block] += val(l, r.key);
  const grossProfit = by.INGRESOS - by.COSTO;
  const contribution = grossProfit - by.COMERCIAL;
  const beforeFinancial = contribution + by.OTROS_INGRESOS - by.OPERATIVO;
  const beforeTax = beforeFinancial - by.FINANCIEROS;
  return { sales: by.INGRESOS, grossProfit, contribution, beforeFinancial, beforeTax, net: beforeTax - by.IMPUESTOS };
}
export type Subtotals = ReturnType<typeof subtotals>;

/** El subtotal que cierra cada bloque, como en el reporte contable. */
const CLOSES: Partial<Record<BlockKey, { key: keyof Subtotals; label: string }>> = {
  COSTO: { key: "grossProfit", label: "Ganancia bruta" },
  COMERCIAL: { key: "contribution", label: "Contribución" },
  OPERATIVO: { key: "beforeFinancial", label: "Ganancia antes de financieros" },
  FINANCIEROS: { key: "beforeTax", label: "Ganancia antes de impuestos" },
  IMPUESTOS: { key: "net", label: "Ganancia (pérdida)" },
};

export type StatementRow = { kind: "rubro"; rubro: Rubro } | { kind: "subtotal"; key: keyof Subtotals; label: string };

/** Filas del estado: los rubros en el orden de su bloque, con los subtotales intercalados. */
export function statementRows(rubros: Rubro[]): StatementRow[] {
  const rows: StatementRow[] = [];
  for (const b of BLOCKS) {
    for (const r of rubros) if (r.block === b.key) rows.push({ kind: "rubro", rubro: r });
    const close = CLOSES[b.key];
    if (close) rows.push({ kind: "subtotal", ...close });
  }
  return rows;
}

/** Clave estable para un rubro nuevo a partir de su nombre: «Comisiones de venta» → COMISIONES_DE_VENTA. */
export const rubroKey = (label: string) =>
  label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);

/* ─────────────────────────────  Criterios  ─────────────────────────────── */

export const ALLOCATION_BASES = [
  { key: "VENTAS", label: "Peso del cliente en la venta del mes" },
  { key: "GANANCIA_BRUTA", label: "Peso del cliente en la ganancia bruta del mes" },
  { key: "PAREJO", label: "Partes iguales entre los clientes que compraron en el mes" },
] as const;
export type AllocationBasis = (typeof ALLOCATION_BASES)[number]["key"];

export type BudgetSettings = {
  /** Con qué se reparten a cada cliente los rubros «repartidos». */
  allocation: AllocationBasis;
  /** Las notas crédito restan de la venta del cliente en su propia fecha. */
  creditNotes: boolean;
  /** Meses cerrados que sirven de referencia para proponer el general y las participaciones. */
  referenceMonths: number;
  /** Cómo se reparte en meses un total anual escrito en el presupuesto general. */
  spread: "ESTACIONAL" | "PAREJO";
  /** Semáforo de cumplimiento en ingresos y ganancias: verde desde 100 %, ámbar desde `warnPct`. */
  warnPct: number;
  /** En gastos: verde hasta 100 %, ámbar hasta `expenseTolerancePct`. */
  expenseTolerancePct: number;
  /** Período con que abre la vista de resultados. */
  defaultPeriod: "ACUMULADO" | "ANIO";
};

export const DEFAULT_SETTINGS: BudgetSettings = {
  allocation: "VENTAS",
  creditNotes: true,
  referenceMonths: 12,
  spread: "ESTACIONAL",
  warnPct: 90,
  expenseTolerancePct: 110,
  defaultPeriod: "ACUMULADO",
};

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T) => (options.includes(v as T) ? (v as T) : fallback);

/** Lleva cualquier entrada (formulario o fila de la base) a criterios válidos. */
export function normalizeSettings(raw: Partial<Record<keyof BudgetSettings, unknown>>): BudgetSettings {
  const d = DEFAULT_SETTINGS;
  return {
    allocation: oneOf(raw.allocation, ALLOCATION_BASES.map((a) => a.key), d.allocation),
    creditNotes: typeof raw.creditNotes === "boolean" ? raw.creditNotes : d.creditNotes,
    referenceMonths: Math.round(clamp(raw.referenceMonths, 3, 24, d.referenceMonths)),
    spread: oneOf(raw.spread, ["ESTACIONAL", "PAREJO"] as const, d.spread),
    warnPct: clamp(raw.warnPct, 50, 99, d.warnPct),
    expenseTolerancePct: clamp(raw.expenseTolerancePct, 101, 200, d.expenseTolerancePct),
    defaultPeriod: oneOf(raw.defaultPeriod, ["ACUMULADO", "ANIO"] as const, d.defaultPeriod),
  };
}
