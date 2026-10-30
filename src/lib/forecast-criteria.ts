/**
 * Criterio del forecast: con qué historia se proyecta cada cliente y cuánto
 * suman los negocios nuevos. Es lógica pura, sin base de datos, para que el
 * servidor y el ajuste de meses en el navegador calculen exactamente lo mismo.
 */

export type ForecastMethod = "ANIO_VIGENTE" | "MOVIL" | "PONDERADO" | "ESTACIONAL";

export type ForecastCriteria = {
  method: ForecastMethod;
  /** Meses cerrados que miran el promedio móvil, el ponderado y el respaldo del estacional. */
  windowMonths: number;
  /** El promedio arranca en el primer mes con compra: un cliente nuevo no se diluye. */
  fromFirstPurchase: boolean;
  /** Crecimiento sobre la base histórica, en porcentaje (negativo para contraer). */
  growthPct: number;
  /** Los meses por encima de `outlierFactor` veces la mediana del cliente cuentan como ese tope. */
  capOutliers: boolean;
  outlierFactor: number;
  /** Meses cerrados seguidos sin compra para dar al cliente por inactivo y proyectarlo en 0. 0 lo apaga. */
  dormantMonths: number;
  /** Porcentaje del valor esperado que suma cada lead en su mes de cierre, según su temperatura. */
  hotLeadPct: number;
  warmLeadPct: number;
  coldLeadPct: number;
  /** Meses que aporta un negocio nuevo desde su mes de cierre. */
  leadMonths: number;
  /** Monto mensual de negocios que todavía no tienen lead. */
  newBusiness: number;
};

/**
 * Criterio de fábrica: promedio del año vigente, sin contar a quien lleva más
 * de seis meses sin comprar, y cada lead abierto con mes de cierre y valor suma
 * completo a ese mes, sea cual sea su temperatura.
 */
export const DEFAULT_CRITERIA: ForecastCriteria = {
  method: "ANIO_VIGENTE",
  windowMonths: 6,
  fromFirstPurchase: true,
  growthPct: 0,
  capOutliers: false,
  outlierFactor: 1.5,
  dormantMonths: 6,
  hotLeadPct: 100,
  warmLeadPct: 100,
  coldLeadPct: 100,
  leadMonths: 1,
  newBusiness: 0,
};

const METHODS: ForecastMethod[] = ["ANIO_VIGENTE", "MOVIL", "PONDERADO", "ESTACIONAL"];

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Lleva cualquier entrada (formulario, URL, fila de la base) a un criterio válido. */
export function normalizeCriteria(raw: Partial<Record<keyof ForecastCriteria, unknown>>): ForecastCriteria {
  const d = DEFAULT_CRITERIA;
  return {
    method: METHODS.includes(raw.method as ForecastMethod) ? (raw.method as ForecastMethod) : d.method,
    windowMonths: Math.round(clamp(raw.windowMonths, 2, 24, d.windowMonths)),
    fromFirstPurchase: typeof raw.fromFirstPurchase === "boolean" ? raw.fromFirstPurchase : d.fromFirstPurchase,
    growthPct: clamp(raw.growthPct, -90, 300, d.growthPct),
    capOutliers: typeof raw.capOutliers === "boolean" ? raw.capOutliers : d.capOutliers,
    outlierFactor: clamp(raw.outlierFactor, 1.1, 10, d.outlierFactor),
    dormantMonths: Math.round(clamp(raw.dormantMonths, 0, 12, d.dormantMonths)),
    hotLeadPct: clamp(raw.hotLeadPct, 0, 100, d.hotLeadPct),
    warmLeadPct: clamp(raw.warmLeadPct, 0, 100, d.warmLeadPct),
    coldLeadPct: clamp(raw.coldLeadPct, 0, 100, d.coldLeadPct),
    leadMonths: Math.round(clamp(raw.leadMonths, 1, 12, d.leadMonths)),
    newBusiness: clamp(raw.newBusiness, 0, 1e12, d.newBusiness),
  };
}

export const sameCriteria = (a: ForecastCriteria, b: ForecastCriteria) =>
  (Object.keys(DEFAULT_CRITERIA) as (keyof ForecastCriteria)[]).every((k) => a[k] === b[k]);

/** Porcentaje del valor esperado que un lead abierto suma a su mes de cierre. */
export const leadPct = (temperature: string, c: ForecastCriteria) =>
  temperature === "CALIENTE" ? c.hotLeadPct : temperature === "TIBIO" ? c.warmLeadPct : temperature === "FRIO" ? c.coldLeadPct : 0;

export const periodStart = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1);
};

export const periodOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export const shiftPeriod = (period: string, months: number) => {
  const d = periodStart(period);
  return periodOf(new Date(d.getFullYear(), d.getMonth() + months, 1));
};

/**
 * Meses cerrados que mira el criterio para proyectar un período, en orden. Nunca
 * entra el mes en curso ni el propio período: un mes pasado se proyecta con lo
 * que se sabía antes de él, así se puede medir qué tan bien habría acertado.
 */
export function criteriaWindow(period: string, c: ForecastCriteria, now = new Date()) {
  const start = periodStart(period);
  const current = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = start < current ? start : current;
  let from: Date;
  if (c.method === "ANIO_VIGENTE") {
    from = new Date(new Date(start.getFullYear(), start.getMonth() - 1, 1).getFullYear(), 0, 1);
  } else {
    from = new Date(to.getFullYear(), to.getMonth() - c.windowMonths, 1);
    // El estacional necesita alcanzar el mismo mes del año anterior.
    const lastYear = new Date(start.getFullYear() - 1, start.getMonth(), 1);
    if (c.method === "ESTACIONAL" && lastYear < from) from = lastYear;
  }
  const periods: string[] = [];
  for (let d = from; d < to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) periods.push(periodOf(d));
  return { from, to, periods };
}

export type HistoryMonth = {
  period: string;
  amount: number;
  excluded: "TODOS" | "CLIENTE" | null;
};

export type Projection = {
  /** Lo que proyecta el criterio, ya con crecimiento. */
  value: number;
  /** Meses que entraron a la base. */
  months: number;
  /** Esos meses: con ellos se reparte el forecast del cliente entre productos. */
  span: string[];
  /** Salió del mismo mes del año anterior y no de un promedio. */
  seasonal: boolean;
  /** Sin compras en los últimos `dormantMonths` meses: se proyecta en 0. */
  dormant: boolean;
  /** Meses recortados por pico. */
  capped: string[];
};

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};

/**
 * Proyección automática de un cliente para `period` con su historia en la
 * ventana del criterio (la de criteriaWindow). Los meses excluidos salen de la
 * suma y del conteo; los picos, si se recortan, cuentan como el tope.
 */
export function project(history: HistoryMonth[], period: string, c: ForecastCriteria): Projection {
  const empty = { value: 0, months: 0, span: [], seasonal: false, dormant: false, capped: [] };

  if (c.dormantMonths > 0 && history.length >= c.dormantMonths && history.slice(-c.dormantMonths).every((h) => h.amount <= 0))
    return { ...empty, dormant: true };

  const pool = c.method === "ANIO_VIGENTE" ? history : history.slice(-c.windowMonths);
  let counted = pool.filter((h) => !h.excluded);
  if (c.fromFirstPurchase) {
    const first = counted.findIndex((h) => h.amount > 0);
    counted = first < 0 ? [] : counted.slice(first);
  }

  const capped: string[] = [];
  const top = c.capOutliers ? median(counted.filter((h) => h.amount > 0).map((h) => h.amount)) * c.outlierFactor : Infinity;
  const amountOf = (h: HistoryMonth) => {
    if (h.amount > top) {
      capped.push(h.period);
      return top;
    }
    return h.amount;
  };

  const growth = 1 + c.growthPct / 100;
  const span = counted.map((h) => h.period);

  if (c.method === "ESTACIONAL") {
    const same = history.find((h) => h.period === shiftPeriod(period, -12));
    if (same && !same.excluded && same.amount > 0)
      return { value: Math.round(amountOf(same) * growth), months: 1, span: span.length ? span : [same.period], seasonal: true, dormant: false, capped };
  }

  if (!counted.length) return empty;
  const amounts = counted.map(amountOf);
  const base =
    c.method === "PONDERADO"
      ? amounts.reduce((s, a, i) => s + a * (i + 1), 0) / ((amounts.length * (amounts.length + 1)) / 2)
      : amounts.reduce((s, a) => s + a, 0) / amounts.length;
  return { value: Math.round(base * growth), months: counted.length, span, seasonal: false, dormant: false, capped };
}

/** Frase corta del criterio para los subtítulos. */
export function describeCriteria(c: ForecastCriteria) {
  const base = {
    ANIO_VIGENTE: "promedio de los meses cerrados del año vigente",
    MOVIL: `promedio de los últimos ${c.windowMonths} meses cerrados`,
    PONDERADO: `promedio ponderado de los últimos ${c.windowMonths} meses, con más peso a los recientes`,
    ESTACIONAL: `mismo mes del año anterior (o promedio de ${c.windowMonths} meses si no hubo compra)`,
  }[c.method];
  const parts = [base];
  if (c.fromFirstPurchase && c.method !== "ESTACIONAL") parts.push("desde la primera compra");
  if (c.growthPct) parts.push(`${c.growthPct > 0 ? "+" : "−"}${Math.abs(c.growthPct).toLocaleString("es-CO")}% de crecimiento`);
  if (c.capOutliers) parts.push(`picos recortados a ${c.outlierFactor.toLocaleString("es-CO")}× la mediana`);
  if (c.dormantMonths) parts.push(`inactivo tras ${c.dormantMonths} ${c.dormantMonths === 1 ? "mes" : "meses"} sin compra`);
  return parts.join(", ");
}

/** Cuánto suma cada temperatura de lead, para los subtítulos: «todos al 100%» o el detalle. */
export function describeLeads(c: ForecastCriteria) {
  const pcts = [c.hotLeadPct, c.warmLeadPct, c.coldLeadPct];
  if (pcts.every((p) => p === pcts[0])) return pcts[0] ? `todos al ${pcts[0].toLocaleString("es-CO")}% de su valor` : "ninguno";
  const parts = [
    ["calientes", c.hotLeadPct],
    ["tibios", c.warmLeadPct],
    ["fríos", c.coldLeadPct],
  ].filter(([, p]) => p) as [string, number][];
  return `${parts.map(([t, p]) => `${t} al ${p.toLocaleString("es-CO")}%`).join(", ")} de su valor`;
}

/**
 * Lee un criterio de un formulario o de la URL. Los nombres van en español
 * porque viajan en la query string de la simulación. Las casillas desmarcadas
 * no llegan, así que su ausencia es `false`.
 */
export function criteriaFromInput(get: (name: string) => string | null): ForecastCriteria {
  const num = (name: string) => {
    const raw = (get(name) ?? "").replace(/[^\d.,-]/g, "");
    // Los montos traen punto de miles; los porcentajes y factores, coma o punto decimal.
    const v = Number(name === "nuevos" ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(",", "."));
    return raw === "" ? undefined : v;
  };
  return normalizeCriteria({
    method: get("metodo"),
    windowMonths: num("ventana"),
    fromFirstPurchase: get("primeraCompra") != null,
    growthPct: num("crecimiento"),
    capOutliers: get("recortar") != null,
    outlierFactor: num("factor"),
    dormantMonths: num("inactivo"),
    hotLeadPct: num("caliente"),
    warmLeadPct: num("tibio"),
    coldLeadPct: num("frio"),
    leadMonths: num("mesesLead"),
    newBusiness: num("nuevos"),
  });
}
