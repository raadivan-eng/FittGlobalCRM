/**
 * Forecast de compras: cuánto pedir de cada SKU y cuándo, a partir de la
 * demanda, el inventario con sus vencimientos, lo que ya viene en camino y las
 * condiciones del proveedor (mínimo, costo, producción y tránsito).
 *
 * Es dato puro —sin prisma— para poder razonarlo y probarlo aparte; la carga
 * de datos vive en src/lib/purchase-plan.ts.
 *
 * El modelo es de revisión periódica: cada `reviewDays` se revisa el plan y se
 * pide lo necesario para llegar al nivel objetivo, que cubre la demanda
 * mientras llega el pedido (lead time) más la de un ciclo de revisión, más un
 * stock de seguridad.
 */

/**
 * Regla del tercio: un lote deja de despacharse cuando le queda menos de este
 * tanto de su vida útil, porque las cadenas no lo reciben. Lo que no alcanza a
 * venderse antes de ese punto no cuenta como inventario disponible.
 */
export const MIN_REMAINING_LIFE = 1 / 3;

/**
 * Tope del margen en días: en productos de vida larga un tercio sería exigir
 * meses de sobra. Es el mismo umbral de vencimiento corto del ingreso de
 * mercancía y del semáforo de inventario.
 */
export const MAX_GUARD_DAYS = 90;

/** Días antes del vencimiento en que un lote deja de despacharse. */
export const shelfGuard = (shelfLifeDays: number) => Math.min(shelfLifeDays * MIN_REMAINING_LIFE, MAX_GUARD_DAYS);

/** Meses cerrados con que se promedia la demanda cuando no hay forecast. */
export const HISTORY_MONTHS = 6;

const DAYS_PER_MONTH = 30;

/** Cada cuántos días se revisa el plan de compras: es el ciclo que cubre cada pedido. */
export const REVIEW_OPTIONS = [15, 30, 45, 60] as const;
export const DEFAULT_REVIEW = 30;

/** Nivel de servicio → factor z de la normal: cuántas desviaciones cubre el stock de seguridad. */
export const SERVICE_LEVELS = [
  { value: "90", label: "90 %", z: 1.28 },
  { value: "95", label: "95 %", z: 1.65 },
  { value: "98", label: "98 %", z: 2.05 },
] as const;
export const DEFAULT_SERVICE = "95";

export type SupplyCondition = {
  supplierId: string;
  supplierName: string;
  minOrderQty: number;
  unitCost: number;
  productionLeadDays: number;
  transitDays: number;
};

export type PlanInput = {
  /** Unidades al mes con que se planea, y su desviación mes a mes. */
  monthlyDemand: number;
  monthlyStdev: number;
  shelfLifeDays: number;
  unitsPerCase: number;
  /** Piso del stock de seguridad: el stock mínimo de la ficha del producto. */
  minStock: number;
  /** Lotes despachables (DISPONIBLE), en cualquier orden. */
  lots: { quantity: number; expiryDate: Date }[];
  /** Lo que viene en camino —órdenes emitidas y facturas por recibir—, con los días que faltan para que llegue. */
  arrivals: { days: number; quantity: number }[];
  condition: SupplyCondition | null;
  reviewDays: number;
  z: number;
  today: Date;
};

export type PlanSignal = "QUIEBRE" | "PEDIR" | "PROGRAMAR" | "CUBIERTO" | "SIN_PROVEEDOR" | "SIN_DEMANDA";

export type PlanResult = {
  signal: PlanSignal;
  daily: number;
  /** Unidades que alcanzan a venderse antes de perder vida útil comercial. */
  usable: number;
  /** Unidades en bodega que no alcanzan a venderse a este ritmo antes de perder vida útil comercial. */
  unsellable: number;
  onOrder: number;
  leadDays: number | null;
  safetyStock: number;
  reorderPoint: number;
  targetLevel: number;
  /** Días que dura el inventario despachable al ritmo actual; null sin demanda. */
  coverageDays: number | null;
  stockoutAt: Date | null;
  /** Último día para emitir la orden sin romper el stock de seguridad. */
  orderBy: Date | null;
  /** Lo que haría falta pedir, antes de mínimos, cajas y vencimiento. */
  need: number;
  /** Lo que se sugiere pedir: múltiplo de caja, no menos que el mínimo del proveedor. */
  suggested: number;
  /** Lo máximo que alcanza a venderse con vida útil comercial, si llega en la fecha prevista. */
  sellableCap: number | null;
  /** El mínimo del proveedor supera lo que se vende antes de vencer: se pide el mínimo y se pierde una parte. */
  minOverCap: boolean;
  /** Se recortó lo necesario para no comprar más de lo que alcanza a venderse. */
  capped: boolean;
  value: number;
};

const DAY = 86_400_000;
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY);
const roundUp = (q: number, step: number) => (step > 1 ? Math.ceil(q / step) * step : Math.ceil(q));
const roundDown = (q: number, step: number) => (step > 1 ? Math.floor(q / step) * step : Math.floor(q));

/** Promedio y desviación estándar de una serie mensual. */
export function monthlyStats(values: number[]) {
  if (!values.length) return { mean: 0, stdev: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.length > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1) : 0;
  return { mean, stdev: Math.sqrt(variance) };
}

/**
 * Consume los lotes en orden de vencimiento (FEFO) al ritmo de la demanda: de
 * cada lote cuenta lo que se alcanza a vender antes de que entre en el margen
 * de `shelfGuard`; el resto se va a quedar en bodega.
 */
export function sellableStock(lots: PlanInput["lots"], daily: number, shelfLifeDays: number, today: Date) {
  const guard = shelfGuard(shelfLifeDays);
  let usable = 0;
  let unsellable = 0;
  let elapsed = 0;
  for (const lot of [...lots].sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime())) {
    const deadline = (lot.expiryDate.getTime() - today.getTime()) / DAY - guard;
    if (daily <= 0) {
      if (deadline > 0) usable += lot.quantity;
      else unsellable += lot.quantity;
      continue;
    }
    const sold = Math.max(0, Math.min(lot.quantity, (deadline - elapsed) * daily));
    usable += sold;
    unsellable += lot.quantity - sold;
    elapsed += sold / daily;
  }
  return { usable: Math.round(usable), unsellable: Math.round(unsellable) };
}

/**
 * Quiebre: el inventario despachable se acaba antes de que pueda reponerse.
 * Se recorre lo que viene en camino en orden de llegada hasta el lead time,
 * que es cuando llegaría una compra emitida hoy; lo que llega después no salva.
 */
export function runsOut(usable: number, daily: number, arrivals: PlanInput["arrivals"], leadDays: number) {
  let stock = usable;
  let t = 0;
  for (const a of [...arrivals].filter((x) => x.days < leadDays).sort((x, y) => x.days - y.days)) {
    stock -= daily * (a.days - t);
    if (stock < 0) return true;
    stock += a.quantity;
    t = a.days;
  }
  return stock - daily * (leadDays - t) < 0;
}

export function planSku(input: PlanInput): PlanResult {
  const { condition, reviewDays, z, today, unitsPerCase } = input;
  const daily = input.monthlyDemand / DAYS_PER_MONTH;
  const { usable, unsellable } = sellableStock(input.lots, daily, input.shelfLifeDays, today);
  const onOrder = input.arrivals.reduce((s, a) => s + a.quantity, 0);
  const position = usable + onOrder;

  const base = {
    daily,
    usable,
    unsellable,
    onOrder,
    coverageDays: daily > 0 ? usable / daily : null,
    stockoutAt: daily > 0 ? addDays(today, usable / daily) : null,
  };
  const idle = { safetyStock: 0, reorderPoint: 0, targetLevel: 0, orderBy: null, need: 0, suggested: 0, sellableCap: null, minOverCap: false, capped: false, value: 0 };

  if (!condition) return { ...base, ...idle, signal: daily > 0 ? "SIN_PROVEEDOR" : "SIN_DEMANDA", leadDays: null };
  const leadDays = condition.productionLeadDays + condition.transitDays;
  if (daily <= 0) return { ...base, ...idle, signal: "SIN_DEMANDA", leadDays };

  // La variabilidad mensual se lleva a días y se escala con la raíz del lead time.
  const dailyStdev = input.monthlyStdev / Math.sqrt(DAYS_PER_MONTH);
  const safetyStock = Math.round(Math.max(input.minStock, z * dailyStdev * Math.sqrt(leadDays)));
  const reorderPoint = Math.round(daily * leadDays + safetyStock);
  const targetLevel = Math.round(daily * (leadDays + reviewDays) + safetyStock);

  // Días que faltan para tocar el punto de reorden; negativo si ya se pasó.
  const daysToOrder = (position - reorderPoint) / daily;
  const orderBy = addDays(today, Math.max(0, daysToOrder));
  const timing: PlanSignal = daysToOrder <= 0 ? "PEDIR" : daysToOrder <= reviewDays ? "PROGRAMAR" : "CUBIERTO";
  const signal: PlanSignal = runsOut(usable, daily, input.arrivals, leadDays) ? "QUIEBRE" : timing;

  if (timing === "CUBIERTO") {
    return { ...base, ...idle, signal, leadDays, safetyStock, reorderPoint, targetLevel, orderBy };
  }

  // Lo necesario el día en que se emite: hasta entonces se sigue vendiendo.
  const wait = Math.max(0, daysToOrder);
  const need = Math.max(0, Math.round(targetLevel - (position - daily * wait)));

  // Lo que llega trae la vida útil menos el tránsito; se vende hasta entrar en
  // el margen, después de agotar lo que quede en bodega al llegar.
  const window = input.shelfLifeDays - condition.transitDays - shelfGuard(input.shelfLifeDays);
  const leftOnArrival = Math.max(0, position - daily * (wait + leadDays));
  const sellableCap = Math.max(0, Math.floor(daily * window - leftOnArrival));

  const minimum = roundUp(condition.minOrderQty, unitsPerCase);
  const uncapped = Math.max(roundUp(need, unitsPerCase), minimum);
  // No se compra más de lo que alcanza a venderse, salvo que el mínimo del
  // proveedor obligue: entonces se pide el mínimo y se avisa.
  const suggested = Math.min(uncapped, Math.max(roundDown(sellableCap, unitsPerCase), minimum));
  const capped = suggested < uncapped;
  const minOverCap = minimum > sellableCap;

  return {
    ...base,
    signal,
    leadDays,
    safetyStock,
    reorderPoint,
    targetLevel,
    orderBy,
    need,
    suggested,
    sellableCap,
    minOverCap,
    capped,
    value: suggested * condition.unitCost,
  };
}

/**
 * El proveedor con que se planea un SKU: el de menor costo y, a igual costo,
 * el que entrega antes.
 */
export function preferredCondition(conditions: SupplyCondition[]) {
  return [...conditions].sort(
    (a, b) => a.unitCost - b.unitCost || a.productionLeadDays + a.transitDays - (b.productionLeadDays + b.transitDays),
  )[0] ?? null;
}
