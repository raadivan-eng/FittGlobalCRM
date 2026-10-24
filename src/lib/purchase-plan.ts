import "server-only";
import { prisma } from "./prisma";
import { periodKey, startOfMonth } from "./analytics";
import { HISTORY_MONTHS, monthlyStats, planSku, preferredCondition, type PlanResult, type SupplyCondition } from "./purchasing";

/** Pedidos que cuentan como venta para la demanda: los confirmados en adelante. */
const SOLD = ["CONFIRMADO", "DESPACHADO", "FACTURADO"];

/** Meses hacia adelante cuyo forecast por producto manda sobre el histórico. */
export const FORECAST_MONTHS = 3;

export type PlanRow = {
  product: { id: string; sku: string; name: string; brand: string; category: string; imageEmoji: string; unitsPerCase: number; shelfLifeDays: number; unitCost: number };
  condition: SupplyCondition | null;
  /** Proveedores con condiciones para el SKU, incluido el elegido. */
  suppliers: number;
  demand: {
    source: "HISTORICO" | "FORECAST";
    monthly: number;
    /** Promedio de los meses cerrados de referencia, aunque mande el forecast. */
    history: number;
    /** Unidades mensuales del forecast cargado, si lo hay. */
    forecast: number | null;
    months: { period: string; units: number }[];
  };
  plan: PlanResult;
};

/** Los meses que se promedian: los `HISTORY_MONTHS` cerrados, sin los marcados como extraordinarios. */
function historyPeriods(now: Date) {
  return Array.from({ length: HISTORY_MONTHS }, (_, i) => periodKey(startOfMonth(i - HISTORY_MONTHS, now)));
}

export function forecastPeriods(now = new Date()) {
  return Array.from({ length: FORECAST_MONTHS }, (_, i) => periodKey(startOfMonth(i, now)));
}

/**
 * Plan de compras de todo el catálogo activo. La demanda es el forecast por
 * producto de los próximos meses cuando está cargado; si no, el promedio de lo
 * vendido en los meses cerrados de referencia. Lo que viene en camino son las
 * órdenes emitidas y las facturas por recibir: si de un mismo proveedor hay de
 * las dos, se asume que la factura es de la orden y se cuenta la mayor.
 */
export async function purchasePlan({ reviewDays, z, now = new Date() }: { reviewDays: number; z: number; now?: Date }): Promise<PlanRow[]> {
  const periods = historyPeriods(now);
  const upcoming = forecastPeriods(now);
  const from = startOfMonth(-HISTORY_MONTHS, now);
  const to = startOfMonth(0, now);

  const [products, sales, exclusions, forecasts, lots, conditions, ordered, invoiced] = await Promise.all([
    prisma.product.findMany({
      where: { active: true },
      orderBy: { sku: "asc" },
      select: { id: true, sku: true, name: true, brand: true, category: true, imageEmoji: true, unitsPerCase: true, shelfLifeDays: true, unitCost: true, minStock: true },
    }),
    prisma.salesOrderLine.findMany({
      where: { order: { date: { gte: from, lt: to }, status: { in: SOLD } } },
      select: { productId: true, quantity: true, order: { select: { date: true } } },
    }),
    prisma.forecastExclusion.findMany({ where: { period: { in: periods }, companyId: null }, select: { period: true } }),
    prisma.forecast.findMany({
      where: { period: { in: upcoming }, productId: { not: null }, companyId: null, units: { gt: 0 } },
      select: { productId: true, units: true },
    }),
    prisma.inventoryLot.findMany({
      where: { status: "DISPONIBLE", quantity: { gt: 0 } },
      select: { productId: true, quantity: true, expiryDate: true },
    }),
    prisma.supplierProduct.findMany({
      where: { productId: { not: null }, supplier: { active: true } },
      select: {
        productId: true, minOrderQty: true, unitCost: true, productionLeadDays: true, transitDays: true,
        supplier: { select: { id: true, name: true } },
      },
    }),
    prisma.purchaseOrderLine.findMany({
      where: { order: { status: "EMITIDA" } },
      select: { productId: true, quantity: true, expectedAt: true, order: { select: { supplierId: true } } },
    }),
    prisma.goodsReceiptLine.findMany({
      where: { receipt: { status: "POR_RECIBIR" } },
      select: { productId: true, quantity: true, receipt: { select: { supplierId: true } } },
    }),
  ]);

  const excluded = new Set(exclusions.map((e) => e.period));
  const counted = periods.filter((p) => !excluded.has(p));

  const sold = new Map<string, Map<string, number>>();
  for (const l of sales) {
    const byMonth = sold.get(l.productId) ?? sold.set(l.productId, new Map()).get(l.productId)!;
    const k = periodKey(l.order.date);
    byMonth.set(k, (byMonth.get(k) ?? 0) + l.quantity);
  }

  const forecastUnits = new Map<string, number[]>();
  for (const f of forecasts) (forecastUnits.get(f.productId!) ?? forecastUnits.set(f.productId!, []).get(f.productId!)!).push(f.units);

  const lotsBy = new Map<string, { quantity: number; expiryDate: Date }[]>();
  for (const l of lots) (lotsBy.get(l.productId) ?? lotsBy.set(l.productId, []).get(l.productId)!).push(l);

  const conditionsBy = new Map<string, SupplyCondition[]>();
  for (const c of conditions) {
    (conditionsBy.get(c.productId!) ?? conditionsBy.set(c.productId!, []).get(c.productId!)!).push({
      supplierId: c.supplier.id,
      supplierName: c.supplier.name,
      minOrderQty: c.minOrderQty,
      unitCost: c.unitCost,
      productionLeadDays: c.productionLeadDays,
      transitDays: c.transitDays,
    });
  }

  // Por proveedor y SKU: si hay orden emitida y factura por recibir, se asume
  // que la factura es de la orden. La factura es mercancía ya despachada y
  // cuenta como llegando hoy; lo que falte de la orden, en su fecha prevista.
  const DAY = 86_400_000;
  const incoming = new Map<string, { productId: string; ordered: number; invoiced: number; firstDays: number }>();
  const bucket = (productId: string, supplierId: string | null) => {
    const k = `${productId}|${supplierId ?? ""}`;
    return incoming.get(k) ?? incoming.set(k, { productId, ordered: 0, invoiced: 0, firstDays: Infinity }).get(k)!;
  };
  for (const l of ordered) {
    const b = bucket(l.productId, l.order.supplierId);
    b.ordered += l.quantity;
    b.firstDays = Math.min(b.firstDays, l.expectedAt ? Math.max(0, (l.expectedAt.getTime() - now.getTime()) / DAY) : 0);
  }
  for (const l of invoiced) bucket(l.productId, l.receipt.supplierId).invoiced += l.quantity;
  const arrivals = new Map<string, { days: number; quantity: number }[]>();
  for (const b of incoming.values()) {
    const list = arrivals.get(b.productId) ?? arrivals.set(b.productId, []).get(b.productId)!;
    if (b.invoiced > 0) list.push({ days: 0, quantity: b.invoiced });
    if (b.ordered > b.invoiced) list.push({ days: b.firstDays, quantity: b.ordered - b.invoiced });
  }

  return products.map((p) => {
    const months = counted.map((period) => ({ period, units: sold.get(p.id)?.get(period) ?? 0 }));
    const stats = monthlyStats(months.map((m) => m.units));
    const fc = forecastUnits.get(p.id);
    const forecast = fc?.length ? fc.reduce((s, u) => s + u, 0) / fc.length : null;
    const monthly = forecast ?? stats.mean;
    const options = conditionsBy.get(p.id) ?? [];
    const condition = preferredCondition(options);

    const plan = planSku({
      monthlyDemand: monthly,
      // Con forecast, la incertidumbre se toma relativa: el mismo coeficiente
      // de variación que mostró la historia.
      monthlyStdev: forecast != null && stats.mean > 0 ? (stats.stdev / stats.mean) * forecast : stats.stdev,
      shelfLifeDays: p.shelfLifeDays,
      unitsPerCase: p.unitsPerCase,
      minStock: p.minStock,
      lots: lotsBy.get(p.id) ?? [],
      arrivals: arrivals.get(p.id) ?? [],
      condition,
      reviewDays,
      z,
      today: now,
    });

    const { minStock: _minStock, ...product } = p;
    return {
      product,
      condition,
      suppliers: options.length,
      demand: { source: forecast != null ? "FORECAST" : "HISTORICO", monthly: Math.round(monthly), history: Math.round(stats.mean), forecast: forecast != null ? Math.round(forecast) : null, months },
      plan,
    };
  });
}
