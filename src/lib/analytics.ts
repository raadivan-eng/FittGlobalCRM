import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { EXPIRY_BANDS, LEAD_OPEN, type ExpiryBandKey } from "./enums";
import { criteriaWindow, DEFAULT_CRITERIA, normalizeCriteria, project, shiftPeriod, type ForecastCriteria } from "./forecast-criteria";

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
    _sum: { net: true, paidAmount: true },
    _count: true,
  });
  return { total: r._sum.net ?? 0, paid: r._sum.paidAmount ?? 0, count: r._count };
}

/* ───────────────────────────────  Forecast  ────────────────────────────── */

/** El criterio guardado; sin fila rige el de siempre (promedio del año vigente). */
export async function getForecastCriteria(): Promise<ForecastCriteria> {
  const row = await prisma.forecastCriteria.findUnique({ where: { id: "default" } });
  return row ? normalizeCriteria(row) : DEFAULT_CRITERIA;
}

export type CompanyForecast = {
  /** Lo que se compara contra lo real: el manual si existe, si no lo que proyecta el criterio. */
  amount: number;
  source: "MANUAL" | "PROMEDIO";
  /** Proyección del criterio, aunque haya un manual encima. 0 si no hay historia. */
  baseline: number;
  /** Meses que entraron a la base. */
  months: number;
  /** Esos meses, para repartir el forecast entre productos con la misma mezcla. */
  span: string[];
  /** La base salió del mismo mes del año anterior. */
  seasonal: boolean;
  /** Sin compras recientes: el criterio lo proyecta en 0. */
  dormant: boolean;
  /** Cada mes de la ventana con lo facturado y si quedó fuera de la base. */
  history: { period: string; amount: number; excluded: "TODOS" | "CLIENTE" | null }[];
};

/**
 * Forecast por cliente para cada período pedido. Sin carga manual, la meta es
 * lo que proyecta el criterio (forecast-criteria.ts) sobre lo facturado en su
 * ventana. Los meses marcados como extraordinarios (ForecastExclusion) salen
 * de la suma y del conteo. Con `manual: false` se ignoran las cargas a mano:
 * así se mide qué tan bien habría acertado el criterio solo.
 */
export async function companyForecasts(
  periods: string[],
  companyId?: string,
  opts: { criteria?: ForecastCriteria; manual?: boolean } = {},
) {
  const criteria = opts.criteria ?? (await getForecastCriteria());
  const windows = periods.map((p) => ({ period: p, ...criteriaWindow(p, criteria) })).filter((w) => w.periods.length > 0);
  const from = windows.length ? new Date(Math.min(...windows.map((w) => w.from.getTime()))) : null;
  const to = windows.length ? new Date(Math.max(...windows.map((w) => w.to.getTime()))) : null;

  const windowPeriods = [...new Set(windows.flatMap((w) => w.periods))];

  const [invoices, manual, exclusions] = await Promise.all([
    from && to
      ? prisma.invoice.findMany({
          where: {
            issueDate: { gte: from, lt: to },
            status: NOT_VOID,
            company: { active: true },
            ...(companyId ? { companyId } : {}),
          },
          select: { companyId: true, issueDate: true, net: true },
        })
      : [],
    opts.manual === false
      ? []
      : prisma.forecast.findMany({
          where: { period: { in: periods }, productId: null, ...(companyId ? { companyId } : { companyId: { not: null } }) },
          select: { period: true, companyId: true, amount: true },
        }),
    prisma.forecastExclusion.findMany({
      where: {
        period: { in: windowPeriods },
        ...(companyId ? { OR: [{ companyId: null }, { companyId }] } : {}),
      },
      select: { period: true, companyId: true },
    }),
  ]);

  const excludedForAll = new Set(exclusions.filter((e) => !e.companyId).map((e) => e.period));
  const excludedFor = new Set(exclusions.filter((e) => e.companyId).map((e) => `${e.companyId}|${e.period}`));

  const billed = new Map<string, Map<string, number>>();
  for (const inv of invoices) {
    const months = billed.get(inv.companyId) ?? new Map<string, number>();
    const k = periodKey(inv.issueDate);
    months.set(k, (months.get(k) ?? 0) + inv.net);
    billed.set(inv.companyId, months);
  }

  const result = new Map<string, Map<string, CompanyForecast>>(periods.map((p) => [p, new Map()]));
  for (const w of windows) {
    const out = result.get(w.period)!;
    for (const [id, months] of billed) {
      const history = w.periods.map((p) => ({
        period: p,
        amount: months.get(p) ?? 0,
        excluded: excludedForAll.has(p) ? ("TODOS" as const) : excludedFor.has(`${id}|${p}`) ? ("CLIENTE" as const) : null,
      }));
      if (!history.some((h) => h.amount > 0)) continue;
      // Un cliente con todo excluido se queda en 0, pero conserva su historia
      // para poder deshacer el ajuste desde la pantalla.
      const p = project(history, w.period, criteria);
      out.set(id, { amount: p.value, source: "PROMEDIO", baseline: p.value, months: p.months, span: p.span, seasonal: p.seasonal, dormant: p.dormant, history });
    }
  }
  for (const f of manual) {
    const out = result.get(f.period)!;
    const auto = out.get(f.companyId!);
    out.set(f.companyId!, {
      amount: f.amount,
      source: "MANUAL",
      baseline: auto?.baseline ?? 0,
      months: auto?.months ?? 0,
      span: auto?.span ?? [],
      seasonal: auto?.seasonal ?? false,
      dormant: auto?.dormant ?? false,
      history: auto?.history ?? [],
    });
  }
  return result;
}

export function sumForecasts(byCompany: Map<string, CompanyForecast> | undefined) {
  let total = 0;
  for (const f of byCompany?.values() ?? []) total += f.amount;
  return total;
}

export type LeadForecast = {
  id: string;
  code: string;
  name: string;
  source: string;
  status: string;
  temperature: string;
  closePeriod: string;
  /** Lo que suma al mes: el valor esperado por el porcentaje de su temperatura. */
  amount: number;
  /** Valor esperado completo del lead. */
  expected: number;
  owner: string | null;
};

/**
 * Lo que aportan los leads al forecast: cada lead abierto con mes tentativo de
 * cierre y valor suma, según el criterio, un porcentaje de ese valor (uno para
 * los calientes, otro para los tibios) a su mes de cierre y a los siguientes
 * si el negocio nuevo aporta varios meses. Al ganarse deja de contar aquí
 * porque el valor pasa a ser forecast manual del cliente nuevo.
 */
export async function leadForecasts(periods: string[], criteria?: ForecastCriteria) {
  const c = criteria ?? (await getForecastCriteria());
  const result = new Map<string, { total: number; leads: LeadForecast[] }>(periods.map((p) => [p, { total: 0, leads: [] }]));
  const pct: Record<string, number> = { CALIENTE: c.hotLeadPct, TIBIO: c.warmLeadPct };
  const temperatures = Object.keys(pct).filter((t) => pct[t] > 0);
  if (!temperatures.length || !periods.length) return result;

  // Un lead que cerró unos meses antes todavía aporta si el negocio dura varios meses.
  const closing = [...new Set(periods.flatMap((p) => Array.from({ length: c.leadMonths }, (_, i) => shiftPeriod(p, -i))))];
  const leads = await prisma.lead.findMany({
    where: {
      temperature: { in: temperatures },
      status: { in: [...LEAD_OPEN] },
      closePeriod: { in: closing },
      expectedValue: { gt: 0 },
    },
    orderBy: { expectedValue: "desc" },
    select: { id: true, code: true, name: true, source: true, status: true, temperature: true, closePeriod: true, expectedValue: true, owner: { select: { name: true } } },
  });
  for (const l of leads) {
    const amount = (l.expectedValue! * pct[l.temperature]) / 100;
    for (let i = 0; i < c.leadMonths; i++) {
      const bucket = result.get(shiftPeriod(l.closePeriod!, i));
      if (!bucket) continue;
      bucket.total += amount;
      bucket.leads.push({
        id: l.id,
        code: l.code,
        name: l.name,
        source: l.source,
        status: l.status,
        temperature: l.temperature,
        closePeriod: l.closePeriod!,
        amount,
        expected: l.expectedValue!,
        owner: l.owner?.name ?? null,
      });
    }
  }
  for (const bucket of result.values()) bucket.leads.sort((a, b) => b.amount - a.amount);
  return result;
}

/**
 * Serie mensual de facturación real y forecast en la misma escala. El forecast
 * suma clientes, leads y los nuevos negocios sin identificar del criterio.
 */
export async function forecastVsBilling(months = 12) {
  const range = lastMonths(months);
  const from = range[0].start;
  const to = range[range.length - 1].end;
  const criteria = await getForecastCriteria();

  const [invoices, forecasts, leads] = await Promise.all([
    prisma.invoice.findMany({
      where: { issueDate: { gte: from, lt: to }, status: NOT_VOID },
      select: { issueDate: true, net: true },
    }),
    companyForecasts(range.map((r) => r.period), undefined, { criteria }),
    leadForecasts(range.map((r) => r.period), criteria),
  ]);

  const realByPeriod = new Map<string, number>();
  for (const inv of invoices) {
    const k = periodKey(inv.issueDate);
    realByPeriod.set(k, (realByPeriod.get(k) ?? 0) + inv.net);
  }
  const fcByPeriod = new Map(
    range.map((r) => [r.period, sumForecasts(forecasts.get(r.period)) + (leads.get(r.period)?.total ?? 0) + criteria.newBusiness]),
  );

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
    _sum: { net: true },
    orderBy: { _sum: { net: "desc" } },
    take: limit,
  });
  const companies = await prisma.company.findMany({
    where: { id: { in: rows.map((r) => r.companyId) } },
    select: { id: true, name: true, code: true, tier: true, channel: true },
  });
  const byId = new Map(companies.map((c) => [c.id, c]));
  return rows.flatMap((r) => {
    const company = byId.get(r.companyId);
    return company ? [{ company, revenue: r._sum.net ?? 0 }] : [];
  });
}

export async function topStores(from: Date, to: Date, limit = 8) {
  const rows = await prisma.salesOrder.groupBy({
    by: ["storeId"],
    where: { date: { gte: from, lt: to }, status: NOT_VOID, storeId: { not: null } },
    _sum: { net: true },
    orderBy: { _sum: { net: "desc" } },
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
    return store ? [{ store, revenue: r._sum.net ?? 0 }] : [];
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

export async function fieldKpis(from: Date, to: Date, userId?: string | string[]) {
  // Uno o varios mercaderistas; sin ninguno, todo el equipo.
  const ids = (Array.isArray(userId) ? userId : [userId]).filter((id): id is string => Boolean(id));
  const scope = ids.length ? { userId: { in: ids } } : {};

  const [planned, completed, missed, incidents, shelf, durations] = await Promise.all([
    prisma.visit.count({ where: { plannedDate: { gte: from, lt: to }, ...scope } }),
    prisma.visit.count({ where: { plannedDate: { gte: from, lt: to }, status: "COMPLETADA", ...scope } }),
    prisma.visit.count({ where: { plannedDate: { gte: from, lt: to }, status: "NO_REALIZADA", ...scope } }),
    prisma.incident.groupBy({
      by: ["severity"],
      where: { status: { in: ["ABIERTA", "EN_PROCESO"] }, ...(ids.length ? { reportedById: { in: ids } } : {}) },
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

export async function receivables(where: Prisma.InvoiceWhereInput = {}) {
  const rows = await prisma.invoice.findMany({
    where: { ...where, status: { in: ["EMITIDA", "PARCIAL", "VENCIDA"] } },
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
