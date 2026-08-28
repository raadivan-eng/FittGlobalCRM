import "server-only";
import { prisma } from "./prisma";
import { EXPIRY_BANDS, type ExpiryBandKey } from "./enums";

export const NOT_VOID = { not: "ANULADA" as const };

export function startOfMonth(offset = 0, ref = new Date()) {
  return new Date(ref.getFullYear(), ref.getMonth() + offset, 1);
}

export function periodKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function periodShort(d: Date) {
  return d.toLocaleDateString("es-CO", { month: "short" }).replace(".", "");
}

/** Los últimos `count` meses cerrados + el actual, en orden cronológico. */
export function lastMonths(count: number, ref = new Date()) {
  return Array.from({ length: count }, (_, i) => {
    const start = startOfMonth(-(count - 1 - i), ref);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return { start, end, period: periodKey(start), label: periodShort(start) };
  });
}

/* ─────────────────────────────  Facturación  ───────────────────────────── */

export async function billedBetween(from: Date, to: Date, companyId?: string) {
  const r = await prisma.invoice.aggregate({
    where: { issueDate: { gte: from, lt: to }, status: NOT_VOID, ...(companyId ? { companyId } : {}) },
    _sum: { total: true, paidAmount: true },
    _count: true,
  });
  return { total: r._sum.total ?? 0, paid: r._sum.paidAmount ?? 0, count: r._count };
}

/** Serie mensual de facturación real y forecast comprometido, en la misma escala. */
export async function forecastVsBilling(months = 12) {
  const range = lastMonths(months);
  const from = range[0].start;
  const to = range[range.length - 1].end;

  const [invoices, forecasts] = await Promise.all([
    prisma.invoice.findMany({
      where: { issueDate: { gte: from, lt: to }, status: NOT_VOID },
      select: { issueDate: true, total: true },
    }),
    prisma.forecast.findMany({
      where: { period: { in: range.map((r) => r.period) }, companyId: { not: null } },
      select: { period: true, amount: true },
    }),
  ]);

  const realByPeriod = new Map<string, number>();
  for (const inv of invoices) {
    const k = periodKey(inv.issueDate);
    realByPeriod.set(k, (realByPeriod.get(k) ?? 0) + inv.total);
  }
  const fcByPeriod = new Map<string, number>();
  for (const f of forecasts) fcByPeriod.set(f.period, (fcByPeriod.get(f.period) ?? 0) + f.amount);

  return range.map((r) => ({
    period: r.period,
    label: r.label,
    forecast: Math.round(fcByPeriod.get(r.period) ?? 0),
    real: Math.round(realByPeriod.get(r.period) ?? 0),
  }));
}

/* ────────────────────────────────  Rankings  ───────────────────────────── */

export async function topProducts(from: Date, to: Date, limit = 8) {
  const rows = await prisma.salesOrderLine.groupBy({
    by: ["productId"],
    where: { order: { date: { gte: from, lt: to }, status: NOT_VOID } },
    _sum: { total: true, quantity: true },
    orderBy: { _sum: { total: "desc" } },
    take: limit,
  });
  const products = await prisma.product.findMany({
    where: { id: { in: rows.map((r) => r.productId) } },
    select: { id: true, name: true, sku: true, brand: true, category: true, imageEmoji: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  return rows.flatMap((r) => {
    const product = byId.get(r.productId);
    return product ? [{ product, revenue: r._sum.total ?? 0, units: r._sum.quantity ?? 0 }] : [];
  });
}

export async function topCompanies(from: Date, to: Date, limit = 8) {
  const rows = await prisma.invoice.groupBy({
    by: ["companyId"],
    where: { issueDate: { gte: from, lt: to }, status: NOT_VOID },
    _sum: { total: true },
    orderBy: { _sum: { total: "desc" } },
    take: limit,
  });
  const companies = await prisma.company.findMany({
    where: { id: { in: rows.map((r) => r.companyId) } },
    select: { id: true, name: true, code: true, tier: true, channel: true },
  });
  const byId = new Map(companies.map((c) => [c.id, c]));
  return rows.flatMap((r) => {
    const company = byId.get(r.companyId);
    return company ? [{ company, revenue: r._sum.total ?? 0 }] : [];
  });
}

export async function topStores(from: Date, to: Date, limit = 8) {
  const rows = await prisma.salesOrder.groupBy({
    by: ["storeId"],
    where: { date: { gte: from, lt: to }, status: NOT_VOID, storeId: { not: null } },
    _sum: { total: true },
    orderBy: { _sum: { total: "desc" } },
    take: limit,
  });
  const ids = rows.map((r) => r.storeId).filter((x): x is string => !!x);
  const stores = await prisma.store.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, code: true, city: true, zone: true, tier: true, company: { select: { name: true } } },
  });
  const byId = new Map(stores.map((s) => [s.id, s]));
  return rows.flatMap((r) => {
    const store = r.storeId ? byId.get(r.storeId) : undefined;
    return store ? [{ store, revenue: r._sum.total ?? 0 }] : [];
  });
}

export async function topCategories(from: Date, to: Date) {
  const lines = await prisma.salesOrderLine.findMany({
    where: { order: { date: { gte: from, lt: to }, status: NOT_VOID } },
    select: { total: true, product: { select: { category: true } } },
  });
  const map = new Map<string, number>();
  for (const l of lines) map.set(l.product.category, (map.get(l.product.category) ?? 0) + l.total);
  return [...map.entries()].map(([category, revenue]) => ({ category, revenue })).sort((a, b) => b.revenue - a.revenue);
}

/* ──────────────────────  Inventario y vencimientos  ────────────────────── */

export type ExpiryRow = {
  id: string;
  lotCode: string;
  quantity: number;
  unitCost: number;
  expiryDate: Date;
  status: string;
  daysToExpiry: number;
  band: ExpiryBandKey;
  valueAtRisk: number;
  product: { id: string; sku: string; name: string; brand: string; category: string; imageEmoji: string; unitPrice: number };
  warehouse: { id: string; name: string; city: string };
};

export async function expiryReport(maxDays = 90) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const lots = await prisma.inventoryLot.findMany({
    where: { quantity: { gt: 0 }, status: { not: "MERMA" } },
    include: {
      product: { select: { id: true, sku: true, name: true, brand: true, category: true, imageEmoji: true, unitPrice: true } },
      warehouse: { select: { id: true, name: true, city: true } },
    },
    orderBy: { expiryDate: "asc" },
  });

  const rows: ExpiryRow[] = lots.map((l) => {
    const daysToExpiry = Math.floor((l.expiryDate.getTime() - today.getTime()) / 86_400_000);
    const band = (EXPIRY_BANDS.find((b) => daysToExpiry <= b.maxDays) ?? EXPIRY_BANDS[EXPIRY_BANDS.length - 1]).key;
    return {
      id: l.id,
      lotCode: l.lotCode,
      quantity: l.quantity,
      unitCost: l.unitCost,
      expiryDate: l.expiryDate,
      status: l.status,
      daysToExpiry,
      band,
      valueAtRisk: l.quantity * l.unitCost,
      product: l.product,
      warehouse: l.warehouse,
    };
  });

  const byBand = new Map<ExpiryBandKey, { units: number; value: number; lots: number }>();
  for (const b of EXPIRY_BANDS) byBand.set(b.key, { units: 0, value: 0, lots: 0 });
  for (const r of rows) {
    const acc = byBand.get(r.band)!;
    acc.units += r.quantity;
    acc.value += r.valueAtRisk;
    acc.lots += 1;
  }

  const atRisk = rows.filter((r) => r.daysToExpiry <= maxDays);
  return {
    rows,
    atRisk,
    byBand,
    totalValue: rows.reduce((s, r) => s + r.valueAtRisk, 0),
    riskValue: atRisk.reduce((s, r) => s + r.valueAtRisk, 0),
    totalUnits: rows.reduce((s, r) => s + r.quantity, 0),
  };
}

/* ────────────────────────  Operación en calle  ─────────────────────────── */

export async function fieldKpis(from: Date, to: Date, userId?: string) {
  const scope = userId ? { userId } : {};

  const [planned, completed, missed, incidents, shelf, durations] = await Promise.all([
    prisma.visit.count({ where: { plannedDate: { gte: from, lt: to }, ...scope } }),
    prisma.visit.count({ where: { plannedDate: { gte: from, lt: to }, status: "COMPLETADA", ...scope } }),
    prisma.visit.count({ where: { plannedDate: { gte: from, lt: to }, status: "NO_REALIZADA", ...scope } }),
    prisma.incident.groupBy({
      by: ["severity"],
      where: { status: { in: ["ABIERTA", "EN_PROCESO"] }, ...(userId ? { reportedById: userId } : {}) },
      _count: true,
    }),
    prisma.shelfReport.groupBy({
      by: ["outOfStock"],
      where: { visit: { plannedDate: { gte: from, lt: to }, status: "COMPLETADA", ...scope } },
      _count: true,
    }),
    prisma.visit.aggregate({
      where: { plannedDate: { gte: from, lt: to }, status: "COMPLETADA", durationMinutes: { not: null }, ...scope },
      _avg: { durationMinutes: true },
    }),
  ]);

  const oosTrue = shelf.find((s) => s.outOfStock)?._count ?? 0;
  const oosTotal = shelf.reduce((s, x) => s + x._count, 0);

  return {
    planned,
    completed,
    missed,
    compliance: planned ? (completed / planned) * 100 : 0,
    openIncidents: incidents.reduce((s, i) => s + i._count, 0),
    criticalIncidents: incidents.filter((i) => ["CRITICA", "ALTA"].includes(i.severity)).reduce((s, i) => s + i._count, 0),
    oosRate: oosTotal ? (oosTrue / oosTotal) * 100 : 0,
    skusAudited: oosTotal,
    avgDuration: Math.round(durations._avg.durationMinutes ?? 0),
  };
}

/** Cobertura: cuántas de las tiendas asignadas y activas recibieron al menos una visita. */
export async function coverage(from: Date, to: Date) {
  const [assigned, visited] = await Promise.all([
    prisma.storeAssignment.count({ where: { store: { active: true } } }),
    prisma.visit.findMany({
      where: { plannedDate: { gte: from, lt: to }, status: "COMPLETADA" },
      select: { storeId: true },
      distinct: ["storeId"],
    }),
  ]);
  return { assigned, visited: visited.length, pct: assigned ? (visited.length / assigned) * 100 : 0 };
}

/* ────────────────────────────────  Cartera  ────────────────────────────── */

export async function receivables() {
  const rows = await prisma.invoice.findMany({
    where: { status: { in: ["EMITIDA", "PARCIAL", "VENCIDA"] } },
    select: { total: true, paidAmount: true, dueDate: true, status: true },
  });
  const today = new Date();
  let open = 0;
  let overdue = 0;
  for (const r of rows) {
    const pending = r.total - r.paidAmount;
    open += pending;
    if (r.dueDate < today) overdue += pending;
  }
  return { open, overdue, count: rows.length };
}
