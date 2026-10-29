import "server-only";
import { prisma } from "./prisma";

/**
 * Lectura del sell-out: lo que las cadenas venden al consumidor, mes a mes.
 *
 * La medida común es la unidad. El valor que reporta cada portal no se puede
 * sumar entre cadenas (unos con IVA, otros sin él, Farmatodo sin valor), así
 * que el dinero se expresa siempre «a precio de lista»: unidades × precio
 * mayorista del producto. Es comparable entre clientes y dice cuánto
 * reabastecimiento genera esa rotación.
 */

export function addMonths(period: string, delta: number) {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Los `count` meses que terminan en `last`, en orden cronológico. */
export function periodsUntil(last: string, count: number) {
  return Array.from({ length: count }, (_, i) => addMonths(last, i - (count - 1)));
}

export const periodLabel = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-CO", { month: "short" }).replace(".", "");
};

/** Variación en % o null si no hay base contra la cual comparar. */
export const change = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);

/** El último mes con sell-out cargado, del cliente o de todos. */
export async function latestPeriod(companyId?: string) {
  const row = await prisma.sellOut.findFirst({
    where: companyId ? { companyId } : {},
    orderBy: { period: "desc" },
    select: { period: true },
  });
  return row?.period ?? null;
}

export type CompanyMonth = { units: number; value: number; stores: number };

/**
 * Unidades, valor a precio de lista y tiendas con venta, por cliente y mes.
 * Las tiendas con venta salen de un conteo aparte: un groupBy por tienda y
 * producto multiplicaría las filas por el portafolio.
 */
export async function monthlyByCompany(periods: string[], companyIds: string[] = []) {
  const where = { period: { in: periods }, ...(companyIds.length ? { companyId: { in: companyIds } } : {}) };
  const [byProduct, byStore, products] = await Promise.all([
    prisma.sellOut.groupBy({ by: ["companyId", "period", "productId"], where, _sum: { units: true } }),
    prisma.sellOut.groupBy({ by: ["companyId", "period", "storeId"], where, _sum: { units: true } }),
    prisma.product.findMany({ select: { id: true, unitPrice: true } }),
  ]);
  const price = new Map(products.map((p) => [p.id, p.unitPrice]));

  const out = new Map<string, Map<string, CompanyMonth>>();
  const cell = (company: string, period: string) => {
    const months = out.get(company) ?? new Map<string, CompanyMonth>();
    out.set(company, months);
    const c = months.get(period) ?? { units: 0, value: 0, stores: 0 };
    months.set(period, c);
    return c;
  };
  for (const r of byProduct) {
    const c = cell(r.companyId, r.period);
    const units = r._sum.units ?? 0;
    c.units += units;
    c.value += units * (price.get(r.productId) ?? 0);
  }
  for (const r of byStore) if ((r._sum.units ?? 0) > 0) cell(r.companyId, r.period).stores++;
  return out;
}

/**
 * Unidades facturadas (sell-in) por cliente y mes de la factura. Es lo que la
 * cadena nos compró: contra el sell-out dice si el inventario se le acumula.
 */
export async function sellInUnits(periods: string[], companyIds: string[]) {
  if (!periods.length || !companyIds.length) return new Map<string, Map<string, number>>();
  const [y0, m0] = periods[0].split("-").map(Number);
  const [y1, m1] = periods[periods.length - 1].split("-").map(Number);
  const lines = await prisma.salesOrderLine.findMany({
    where: {
      order: {
        companyId: { in: companyIds },
        invoice: { is: { status: { not: "ANULADA" }, issueDate: { gte: new Date(y0, m0 - 1, 1), lt: new Date(y1, m1, 1) } } },
      },
    },
    select: { quantity: true, order: { select: { companyId: true, invoice: { select: { issueDate: true } } } } },
  });
  const out = new Map<string, Map<string, number>>();
  for (const l of lines) {
    const d = l.order.invoice?.issueDate;
    if (!d) continue;
    const p = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const months = out.get(l.order.companyId) ?? new Map<string, number>();
    months.set(p, (months.get(p) ?? 0) + l.quantity);
    out.set(l.order.companyId, months);
  }
  return out;
}

/** Cuántos meses hacia atrás se mira para decir que una tienda «rotaba». */
export const ROTATION_LOOKBACK = 3;

/**
 * Tiendas de uno o varios clientes en el mes: lo vendido, el mes anterior y el promedio de
 * los meses previos. Una tienda que vendía y este mes no vendió nada dejó de
 * rotar: casi siempre es quiebre, producto fuera de góndola o una devolución.
 */
export async function storePerformance(companyIds: string[], period: string) {
  const previous = periodsUntil(addMonths(period, -1), ROTATION_LOOKBACK);
  const rows = await prisma.sellOut.groupBy({
    by: ["storeId", "period"],
    where: { companyId: { in: companyIds }, period: { in: [...previous, period] } },
    _sum: { units: true },
  });

  const byStore = new Map<string, { units: number; prev: number; history: number }>();
  for (const r of rows) {
    const s = byStore.get(r.storeId) ?? { units: 0, prev: 0, history: 0 };
    const u = r._sum.units ?? 0;
    if (r.period === period) s.units += u;
    else s.history += u;
    if (r.period === previous[previous.length - 1]) s.prev += u;
    byStore.set(r.storeId, s);
  }

  const stores = await prisma.store.findMany({
    where: { id: { in: [...byStore.keys()] } },
    select: { id: true, name: true, code: true, city: true, active: true },
  });
  return stores
    .map((st) => {
      const s = byStore.get(st.id)!;
      return { ...st, units: s.units, prev: s.prev, average: s.history / ROTATION_LOOKBACK };
    })
    .sort((a, b) => b.units - a.units);
}

/** Productos del alcance en el mes y el anterior. */
export async function productPerformance(period: string, companyIds: string[] = []) {
  const rows = await prisma.sellOut.groupBy({
    by: ["productId", "period"],
    where: { period: { in: [addMonths(period, -1), period] }, ...(companyIds.length ? { companyId: { in: companyIds } } : {}) },
    _sum: { units: true },
  });
  const byProduct = new Map<string, { units: number; prev: number }>();
  for (const r of rows) {
    const p = byProduct.get(r.productId) ?? { units: 0, prev: 0 };
    if (r.period === period) p.units += r._sum.units ?? 0;
    else p.prev += r._sum.units ?? 0;
    byProduct.set(r.productId, p);
  }
  const products = await prisma.product.findMany({
    where: { id: { in: [...byProduct.keys()] } },
    select: { id: true, name: true, sku: true, imageEmoji: true, unitPrice: true },
  });
  return products
    .map((p) => ({ ...p, ...byProduct.get(p.id)! }))
    .filter((p) => p.units > 0 || p.prev > 0)
    .sort((a, b) => b.units - a.units);
}
