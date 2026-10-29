import "server-only";
import { prisma } from "./prisma";
import { NOT_VOID, lastMonths } from "./analytics";

/**
 * Margen bruto mínimo aceptable, en porcentaje sobre la venta neta. Por debajo
 * de él un cliente o un producto se marca en el tablero gerencial.
 */
export const MIN_MARGIN_PCT = 25;

/**
 * Costo unitario de cada producto: el promedio de sus lotes ponderado por las
 * unidades, que es lo que de verdad se pagó por la mercancía en bodega. Los
 * pedidos no guardan de qué lote salió cada unidad, así que no hay un costo
 * por venta; sin lotes se usa el costo de lista de la ficha.
 */
export async function productCosts() {
  const [products, lots] = await Promise.all([
    prisma.product.findMany({ select: { id: true, unitCost: true } }),
    prisma.inventoryLot.findMany({ where: { quantity: { gt: 0 } }, select: { productId: true, quantity: true, unitCost: true } }),
  ]);
  const acc = new Map<string, { units: number; value: number }>();
  for (const l of lots) {
    const a = acc.get(l.productId) ?? { units: 0, value: 0 };
    a.units += l.quantity;
    a.value += l.quantity * l.unitCost;
    acc.set(l.productId, a);
  }
  return new Map(products.map((p) => {
    const a = acc.get(p.id);
    return [p.id, a && a.units > 0 ? a.value / a.units : p.unitCost];
  }));
}

/** Un renglón facturado ya costeado: la venta es la parte que le toca del neto de la factura. */
export type MarginLine = {
  date: Date;
  companyId: string;
  productId: string;
  category: string;
  units: number;
  revenue: number;
  cost: number;
};

export type MarginTotals = { revenue: number; cost: number; credits: number; uncosted: number };

/**
 * Renglones facturados entre dos fechas con su costo, más las notas crédito y
 * la facturación sin pedido (que no se puede costear). Se reparte el neto de
 * cada factura entre sus renglones para que el descuento del pedido y los
 * ajustes de facturación queden dentro de la venta de cada producto.
 */
export async function marginFacts(from: Date, to: Date) {
  const [invoices, credits, costs] = await Promise.all([
    prisma.invoice.findMany({
      where: { issueDate: { gte: from, lt: to }, status: NOT_VOID },
      select: {
        issueDate: true,
        companyId: true,
        net: true,
        order: { select: { lines: { select: { productId: true, quantity: true, total: true, product: { select: { category: true } } } } } },
      },
    }),
    prisma.creditNote.findMany({ where: { issueDate: { gte: from, lt: to } }, select: { issueDate: true, companyId: true, net: true } }),
    productCosts(),
  ]);

  const lines: MarginLine[] = [];
  const uncosted: { date: Date; companyId: string; net: number }[] = [];
  for (const inv of invoices) {
    const orderLines = inv.order?.lines ?? [];
    const gross = orderLines.reduce((s, l) => s + l.total, 0);
    if (!orderLines.length || gross <= 0) {
      uncosted.push({ date: inv.issueDate, companyId: inv.companyId, net: inv.net });
      continue;
    }
    const share = inv.net / gross;
    for (const l of orderLines) {
      lines.push({
        date: inv.issueDate,
        companyId: inv.companyId,
        productId: l.productId,
        category: l.product.category,
        units: l.quantity,
        revenue: l.total * share,
        cost: l.quantity * (costs.get(l.productId) ?? 0),
      });
    }
  }
  return { lines, credits, uncosted };
}

export type MarginFacts = Awaited<ReturnType<typeof marginFacts>>;

const inRange = (d: Date, from: Date, to: Date) => d >= from && d < to;

/** Totales de un período. Las notas crédito restan venta y margen: no devuelven costo. */
export function totalsBetween(facts: MarginFacts, from: Date, to: Date): MarginTotals {
  const t = { revenue: 0, cost: 0, credits: 0, uncosted: 0 };
  for (const l of facts.lines) if (inRange(l.date, from, to)) { t.revenue += l.revenue; t.cost += l.cost; }
  for (const c of facts.credits) if (inRange(c.issueDate, from, to)) t.credits += c.net;
  for (const u of facts.uncosted) if (inRange(u.date, from, to)) t.uncosted += u.net;
  return t;
}

/** Venta neta: lo costeado más lo que no tiene pedido, menos notas crédito. */
export const netSales = (t: MarginTotals) => t.revenue + t.uncosted - t.credits;
/** Margen bruto sobre lo costeado. */
export const grossMargin = (t: MarginTotals) => t.revenue - t.cost - t.credits;
export const marginPct = (t: MarginTotals) => (t.revenue - t.credits > 0 ? (grossMargin(t) / (t.revenue - t.credits)) * 100 : 0);

/** Serie mensual de venta neta, margen bruto y su porcentaje. */
export function monthlyMargin(facts: MarginFacts, months: number) {
  return lastMonths(months).map((m) => {
    const t = totalsBetween(facts, m.start, m.end);
    return { label: m.label, period: m.period, sales: netSales(t), margin: grossMargin(t), pct: marginPct(t) };
  });
}

type Agg = { units: number; revenue: number; cost: number };

/** Agrupa los renglones de un período por la clave que se pida. */
export function groupLines(facts: MarginFacts, from: Date, to: Date, key: (l: MarginLine) => string) {
  const map = new Map<string, Agg>();
  for (const l of facts.lines) {
    if (!inRange(l.date, from, to)) continue;
    const k = key(l);
    const a = map.get(k) ?? { units: 0, revenue: 0, cost: 0 };
    a.units += l.units;
    a.revenue += l.revenue;
    a.cost += l.cost;
    map.set(k, a);
  }
  return map;
}

/**
 * Por qué cambió el margen bruto entre dos períodos:
 *  - Volumen: vender más o menos unidades con la misma mezcla y precios.
 *  - Precio: cobrar distinto por el mismo producto.
 *  - Mezcla: cambiar el peso de productos de margen alto frente a los de bajo,
 *    incluidos los que se vendieron en un período y no en el otro.
 *  - Notas crédito: lo que se devolvió o se rebajó después de facturar.
 * El costo es el promedio actual de lotes en ambos períodos, así que aquí
 * todavía no aparece el efecto de que el proveedor suba o baje precios.
 */
export function marginBridge(facts: MarginFacts, prev: { from: Date; to: Date }, curr: { from: Date; to: Date }) {
  const p0 = groupLines(facts, prev.from, prev.to, (l) => l.productId);
  const p1 = groupLines(facts, curr.from, curr.to, (l) => l.productId);
  const t0 = totalsBetween(facts, prev.from, prev.to);
  const t1 = totalsBetween(facts, curr.from, curr.to);

  const margin0 = t0.revenue - t0.cost;
  const margin1 = t1.revenue - t1.cost;

  // Volumen: el margen anterior escalado por cuánto creció la venta a precios anteriores.
  let revAtOldPrice = 0;
  let price = 0;
  for (const [id, a1] of p1) {
    const a0 = p0.get(id);
    if (!a0 || a0.units === 0) continue;
    const oldPrice = a0.revenue / a0.units;
    revAtOldPrice += a1.units * oldPrice;
    price += a1.revenue - a1.units * oldPrice;
  }
  const volume = t0.revenue > 0 ? margin0 * (revAtOldPrice / t0.revenue - 1) : 0;
  const mix = margin1 - margin0 - volume - price;
  const credits = -(t1.credits - t0.credits);

  return {
    before: grossMargin(t0),
    after: grossMargin(t1),
    steps: [
      { label: "Volumen", value: volume },
      { label: "Precio", value: price },
      { label: "Mezcla de productos", value: mix },
      { label: "Notas crédito", value: credits },
    ],
  };
}

/** Lo que cuesta atender a cada cliente fuera del producto: fletes e inversión en trade. */
export async function costToServe(from: Date, to: Date) {
  const [shipments, trade] = await Promise.all([
    prisma.shipment.findMany({
      where: { createdAt: { gte: from, lt: to }, status: { not: "ANULADA" }, shippingCost: { not: null }, companyId: { not: null } },
      select: { companyId: true, shippingCost: true },
    }),
    // La inversión de una actividad se reparte por los días que caen dentro del período.
    prisma.tradeActivity.findMany({
      where: { status: { in: ["APROBADA", "CERRADA"] }, startDate: { lt: to }, endDate: { gte: from } },
      select: { companyId: true, budget: true, startDate: true, endDate: true },
    }),
  ]);
  const freight = new Map<string, number>();
  for (const s of shipments) freight.set(s.companyId!, (freight.get(s.companyId!) ?? 0) + (s.shippingCost ?? 0));
  const tradeSpend = new Map<string, number>();
  for (const t of trade) {
    const span = Math.max(1, t.endDate.getTime() - t.startDate.getTime());
    const overlap = Math.max(0, Math.min(t.endDate.getTime(), to.getTime()) - Math.max(t.startDate.getTime(), from.getTime()));
    tradeSpend.set(t.companyId, (tradeSpend.get(t.companyId) ?? 0) + t.budget * Math.min(1, overlap / span));
  }
  return { freight, trade: tradeSpend };
}

/** Cartera abierta por días de mora, con saldo con IVA. */
export const AGING_BUCKETS = [
  { key: "AL_DIA", label: "Por vencer", maxDays: 0, color: "var(--good)" },
  { key: "D30", label: "1–30 días", maxDays: 30, color: "var(--warning)" },
  { key: "D60", label: "31–60 días", maxDays: 60, color: "var(--serious)" },
  { key: "D60_MAS", label: "Más de 60 días", maxDays: Infinity, color: "var(--critical)" },
] as const;

export async function receivablesAging() {
  const rows = await prisma.invoice.findMany({
    where: { status: { in: ["EMITIDA", "PARCIAL", "VENCIDA"] } },
    select: { total: true, paidAmount: true, dueDate: true, company: { select: { id: true, name: true } } },
  });
  const today = new Date();
  const buckets = new Map<string, number>(AGING_BUCKETS.map((b) => [b.key, 0]));
  const debtors = new Map<string, { id: string; name: string; overdue: number; oldestDays: number }>();
  for (const r of rows) {
    const pending = r.total - r.paidAmount;
    if (pending <= 0) continue;
    const days = Math.floor((today.getTime() - r.dueDate.getTime()) / 86_400_000);
    const bucket = AGING_BUCKETS.find((b) => days <= b.maxDays)!;
    buckets.set(bucket.key, buckets.get(bucket.key)! + pending);
    if (days > 0) {
      const d = debtors.get(r.company.id) ?? { ...r.company, overdue: 0, oldestDays: 0 };
      d.overdue += pending;
      d.oldestDays = Math.max(d.oldestDays, days);
      debtors.set(r.company.id, d);
    }
  }
  return { buckets, debtors: [...debtors.values()].sort((a, b) => b.overdue - a.overdue) };
}

/** Plata inmovilizada en bodega y la que ya está comprometida con proveedores. */
export async function workingCapital() {
  const [lots, openOrders] = await Promise.all([
    prisma.inventoryLot.findMany({ where: { quantity: { gt: 0 }, status: { not: "MERMA" } }, select: { quantity: true, unitCost: true } }),
    prisma.purchaseOrder.findMany({
      where: { status: "EMITIDA" },
      select: { expectedAt: true, lines: { select: { quantity: true, unitCost: true } } },
    }),
  ]);
  const today = new Date();
  let committed = 0;
  let late = 0;
  for (const o of openOrders) {
    committed += o.lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
    if (o.expectedAt && o.expectedAt < today) late += 1;
  }
  return {
    inventory: lots.reduce((s, l) => s + l.quantity * l.unitCost, 0),
    committed,
    openOrders: openOrders.length,
    lateOrders: late,
  };
}
