import "server-only";
import { prisma } from "./prisma";
import { NOT_VOID, periodKey, periodShort, startOfMonth } from "./analytics";
import {
  DEFAULT_RUBROS, DEFAULT_SETTINGS, SOURCES, normalizeSettings, rubroOf, sumLines, type BlockKey, type Lines, type Rubro, type SourceKey,
} from "./budget-lines";
import { productCosts } from "./management";

export * from "./budget-lines";

/* ────────────────────────────  Configuración  ───────────────────────────── */

/** Rubros y criterios vigentes: lo guardado en Configuración o, sin nada guardado, los de siempre. */
export async function budgetConfig() {
  const [rows, settings] = await Promise.all([
    prisma.budgetRubro.findMany({ orderBy: { position: "asc" } }),
    prisma.budgetSettings.findUnique({ where: { id: "default" } }),
  ]);
  const rubros: Rubro[] = rows.length
    ? rows.map((r) => ({
        key: r.key,
        label: r.label,
        prefixes: r.prefixes.split(",").map((p) => p.trim()).filter(Boolean),
        block: r.block as BlockKey,
        source: (SOURCES.some((s) => s.key === r.source) ? r.source : "REPARTIDO") as SourceKey,
      }))
    : DEFAULT_RUBROS;
  return {
    rubros,
    settings: settings ? normalizeSettings(settings) : DEFAULT_SETTINGS,
    customRubros: rows.length > 0,
    customSettings: !!settings,
    updatedAt: settings?.updatedAt ?? rows[0]?.updatedAt ?? null,
  };
}
export type BudgetConfig = Awaited<ReturnType<typeof budgetConfig>>;

/* ─────────────────────────────  Períodos  ───────────────────────────────── */

export function yearMonths(year: number) {
  return Array.from({ length: 12 }, (_, i) => {
    const start = new Date(year, i, 1);
    return { period: periodKey(start), mm: periodKey(start).slice(5), label: periodShort(start), start, end: new Date(year, i + 1, 1) };
  });
}

/**
 * Qué meses se comparan: el acumulado de los meses cerrados, el año completo o
 * un mes. Sin elección rige el período por defecto de la configuración. En el
 * año completo el real todavía no llega a diciembre: se lee como avance.
 */
export function selectionFor(year: number, raw: string, fallback: "ACUMULADO" | "ANIO", now = new Date()) {
  const months = yearMonths(year);
  const closed = months.filter((m) => m.end <= startOfMonth(0, now));
  const month = months.find((m) => m.period === raw);
  if (month) return { key: raw, kind: "MES" as const, periods: [month.period], label: `${month.label} ${year}` };
  if (raw === "anio" || (!raw && fallback === "ANIO")) return { key: "anio", kind: "ANIO" as const, periods: months.map((m) => m.period), label: `Año ${year}` };
  return {
    key: "acumulado",
    kind: "ACUMULADO" as const,
    periods: closed.map((m) => m.period),
    label: closed.length ? `Acumulado ene – ${closed.at(-1)!.label} ${year}` : `Sin meses cerrados de ${year}`,
  };
}

/** Años que se pueden planear: los que ya tienen presupuesto, el actual y el siguiente. */
export async function budgetYears(now = new Date()) {
  const rows = await prisma.budgetLine.findMany({ select: { period: true }, distinct: ["period"] });
  const years = new Set([now.getFullYear(), now.getFullYear() + 1, ...rows.map((r) => Number(r.period.slice(0, 4)))]);
  return [...years].sort((a, b) => b - a);
}

/* ─────────────────────────  Presupuesto general  ────────────────────────── */

export type BudgetAccount = { code: string; name: string; rubro: string | null; amounts: Map<string, number> };

/** El presupuesto general de un año: cada cuenta con su valor por mes, y los rubros de cada mes. */
export async function generalBudget(year: number, rubros: Rubro[]) {
  const rows = await prisma.budgetLine.findMany({
    where: { period: { gte: `${year}-01`, lte: `${year}-12` } },
    orderBy: { accountCode: "asc" },
  });
  const accounts = new Map<string, BudgetAccount>();
  const byPeriod = new Map<string, Lines>();
  const unmapped = new Set<string>();
  for (const r of rows) {
    const rubro = rubroOf(r.accountCode, rubros);
    const a = accounts.get(r.accountCode) ?? { code: r.accountCode, name: r.accountName, rubro: rubro?.key ?? null, amounts: new Map() };
    a.amounts.set(r.period, (a.amounts.get(r.period) ?? 0) + r.amount);
    accounts.set(r.accountCode, a);
    if (!rubro) {
      unmapped.add(r.accountCode);
      continue;
    }
    const l = byPeriod.get(r.period) ?? {};
    l[rubro.key] = (l[rubro.key] ?? 0) + r.amount;
    byPeriod.set(r.period, l);
  }
  return { accounts: [...accounts.values()], byPeriod, unmapped: [...unmapped] };
}

/** Lo que la contabilidad reporta por rubro en cada mes (estado de resultados cargado). */
export async function statementByRubro(periods: string[], rubros: Rubro[]) {
  const rows = await prisma.incomeStatementLine.findMany({ where: { period: { in: periods } }, select: { period: true, accountCode: true, amount: true } });
  const byPeriod = new Map<string, Lines>();
  for (const r of rows) {
    const rubro = rubroOf(r.accountCode, rubros);
    if (!rubro) continue;
    const l = byPeriod.get(r.period) ?? {};
    l[rubro.key] = (l[rubro.key] ?? 0) + r.amount;
    byPeriod.set(r.period, l);
  }
  return byPeriod;
}

/* ──────────────────────────────  Participación  ─────────────────────────── */

export type Share = { base: number; overrides: Record<string, number> };

export async function clientShares(year: number, companyId?: string) {
  const rows = await prisma.clientShare.findMany({ where: { year, ...(companyId ? { companyId } : {}) } });
  const map = new Map<string, Share>();
  for (const r of rows) {
    const s = map.get(r.companyId) ?? { base: 0, overrides: {} };
    if (r.line === "") s.base = r.pct;
    else s.overrides[r.line] = r.pct;
    map.set(r.companyId, s);
  }
  return map;
}

/** Porcentaje del cliente en un rubro: el ajuste si lo hay, si no su base. El rubro de la venta siempre va con la base. */
export const shareIn = (s: Share, rubro: Rubro) => (rubro.source === "VENTAS" ? s.base : (s.overrides[rubro.key] ?? s.base));

/** Presupuesto del cliente en esos meses: cada rubro del general por su participación. */
export function clientBudget(general: Map<string, Lines>, share: Share | undefined, periods: string[], rubros: Rubro[]) {
  const total = sumLines(periods.map((p) => general.get(p)));
  const out: Lines = {};
  if (!share) return out;
  for (const r of rubros) out[r.key] = ((total[r.key] ?? 0) * shareIn(share, r)) / 100;
  return out;
}

/* ─────────────────────────────  Real por cliente  ───────────────────────── */

/**
 * Lo que de verdad dejó cada cliente mes a mes, por rubro. Cada rubro se mide
 * según su fuente: venta facturada (menos notas crédito si así se configura),
 * costo de lo vendido al promedio de los lotes, fletes por guía o trade por
 * actividad (repartida por los días que caen en cada mes). Los rubros
 * «repartidos» toman el estado de resultados del mes y lo reparten con la base
 * configurada; un mes sin estado cargado los deja en cero y va en `missing`.
 */
export async function clientActuals(periods: string[], config: Pick<BudgetConfig, "rubros" | "settings">) {
  const { rubros, settings } = config;
  const sorted = [...periods].sort();
  const empty = { byClient: new Map<string, Map<string, Lines>>(), statement: new Map<string, Lines>(), missing: [] as string[], uncosted: 0 };
  if (!sorted.length) return empty;
  const [fy, fm] = sorted[0].split("-").map(Number);
  const [ty, tm] = sorted.at(-1)!.split("-").map(Number);
  const from = new Date(fy, fm - 1, 1);
  const to = new Date(ty, tm, 1);
  const wanted = new Set(periods);
  const keyFor = (source: SourceKey) => rubros.find((r) => r.source === source)?.key;
  const sales = keyFor("VENTAS");
  const cost = keyFor("COSTO");
  const freight = keyFor("FLETES");
  const trade = keyFor("TRADE");

  const [invoices, credits, costs, shipments, activities, statement] = await Promise.all([
    prisma.invoice.findMany({
      where: { issueDate: { gte: from, lt: to }, status: NOT_VOID },
      select: { companyId: true, issueDate: true, net: true, order: { select: { lines: { select: { productId: true, quantity: true } } } } },
    }),
    settings.creditNotes ? prisma.creditNote.findMany({ where: { issueDate: { gte: from, lt: to } }, select: { companyId: true, issueDate: true, net: true } }) : [],
    productCosts(),
    freight
      ? prisma.shipment.findMany({
          where: { createdAt: { gte: from, lt: to }, status: { not: "ANULADA" }, shippingCost: { not: null }, companyId: { not: null } },
          select: { companyId: true, createdAt: true, shippingCost: true },
        })
      : [],
    trade
      ? prisma.tradeActivity.findMany({
          where: { status: { in: ["APROBADA", "CERRADA"] }, startDate: { lt: to }, endDate: { gte: from } },
          select: { companyId: true, budget: true, startDate: true, endDate: true },
        })
      : [],
    statementByRubro(periods, rubros),
  ]);

  const byClient = new Map<string, Map<string, Lines>>();
  const add = (companyId: string, period: string, key: string | undefined, amount: number) => {
    if (!key || !wanted.has(period)) return;
    let months = byClient.get(companyId);
    if (!months) byClient.set(companyId, (months = new Map()));
    const l = months.get(period) ?? {};
    l[key] = (l[key] ?? 0) + amount;
    months.set(period, l);
  };
  // La venta y el costo de cada cliente se guardan aparte para repartir, aunque no tengan rubro propio.
  const weightSales = new Map<string, number>();
  const weightGross = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

  let uncosted = 0;
  for (const inv of invoices) {
    const period = periodKey(inv.issueDate);
    if (!wanted.has(period)) continue;
    add(inv.companyId, period, sales, inv.net);
    bump(weightSales, `${inv.companyId}|${period}`, inv.net);
    const lines = inv.order?.lines ?? [];
    if (!lines.length) uncosted += inv.net;
    const c = lines.reduce((s, ol) => s + ol.quantity * (costs.get(ol.productId) ?? 0), 0);
    add(inv.companyId, period, cost, c);
    bump(weightGross, `${inv.companyId}|${period}`, inv.net - c);
  }
  for (const c of credits) {
    const period = periodKey(c.issueDate);
    add(c.companyId, period, sales, -c.net);
    bump(weightSales, `${c.companyId}|${period}`, -c.net);
    bump(weightGross, `${c.companyId}|${period}`, -c.net);
  }
  for (const s of shipments) add(s.companyId!, periodKey(s.createdAt), freight, s.shippingCost ?? 0);
  for (const t of activities) {
    const span = Math.max(1, t.endDate.getTime() - t.startDate.getTime());
    for (let m = startOfMonth(0, t.startDate > from ? t.startDate : from); m < to && m <= t.endDate; m = startOfMonth(1, m)) {
      const overlap = Math.min(t.endDate.getTime(), startOfMonth(1, m).getTime(), to.getTime()) - Math.max(t.startDate.getTime(), m.getTime());
      if (overlap > 0) add(t.companyId, periodKey(m), trade, t.budget * Math.min(1, overlap / span));
    }
  }

  // Rubros repartidos: el estado del mes por el peso del cliente según la base configurada.
  const shared = rubros.filter((r) => r.source === "REPARTIDO");
  const missing: string[] = [];
  for (const period of periods) {
    const st = statement.get(period);
    if (!st) {
      missing.push(period);
      continue;
    }
    const weights = new Map<string, number>();
    for (const [key, v] of settings.allocation === "GANANCIA_BRUTA" ? weightGross : weightSales) {
      const [companyId, p] = key.split("|");
      if (p === period && v > 0) weights.set(companyId, settings.allocation === "PAREJO" ? 1 : v);
    }
    const total = [...weights.values()].reduce((s, v) => s + v, 0);
    if (total <= 0) continue;
    for (const [companyId, w] of weights) for (const r of shared) add(companyId, period, r.key, (st[r.key] ?? 0) * (w / total));
  }
  return { byClient, statement, missing, uncosted };
}

/** Peso de cada cliente en la venta neta de los meses de referencia: la base para proponer participaciones. */
export async function realSalesShare(months: number, creditNotes: boolean, now = new Date()) {
  const from = startOfMonth(-months, now);
  const to = startOfMonth(0, now);
  const [invoices, credits] = await Promise.all([
    prisma.invoice.groupBy({ by: ["companyId"], where: { issueDate: { gte: from, lt: to }, status: NOT_VOID }, _sum: { net: true } }),
    creditNotes ? prisma.creditNote.groupBy({ by: ["companyId"], where: { issueDate: { gte: from, lt: to } }, _sum: { net: true } }) : [],
  ]);
  const sales = new Map<string, number>();
  for (const i of invoices) sales.set(i.companyId, i._sum.net ?? 0);
  for (const c of credits) sales.set(c.companyId, (sales.get(c.companyId) ?? 0) - (c._sum.net ?? 0));
  const total = [...sales.values()].reduce((s, v) => s + Math.max(0, v), 0);
  const label = `${periodShort(from)} ${from.getFullYear()} – ${periodShort(startOfMonth(-1, now))} ${startOfMonth(-1, now).getFullYear()}`;
  return { share: new Map([...sales].map(([id, v]) => [id, total > 0 ? (Math.max(0, v) / total) * 100 : 0])), label };
}

/**
 * Referencia para el presupuesto general: lo que reportó la contabilidad en
 * cada cuenta durante los últimos doce meses cerrados, mes calendario contra
 * mes calendario (el enero de referencia es el enero más reciente).
 */
export async function statementReference(rubros: Rubro[], now = new Date()) {
  const from = startOfMonth(-12, now);
  const periods = Array.from({ length: 12 }, (_, i) => periodKey(startOfMonth(i - 12, now)));
  const rows = await prisma.incomeStatementLine.findMany({
    where: { period: { in: periods } },
    select: { period: true, accountCode: true, accountName: true, amount: true },
  });
  const accounts = new Map<string, { code: string; name: string; byMonth: Record<string, number> }>();
  for (const r of rows) {
    if (!/^[4-7]/.test(r.accountCode)) continue;
    const a = accounts.get(r.accountCode) ?? { code: r.accountCode, name: r.accountName, byMonth: {} };
    const mm = r.period.slice(5);
    a.byMonth[mm] = (a.byMonth[mm] ?? 0) + r.amount;
    accounts.set(r.accountCode, a);
  }
  const unmapped = [...accounts.values()].filter((a) => !rubroOf(a.code, rubros)).map((a) => a.code);
  const label = `${periodShort(from)} ${from.getFullYear()} – ${periodShort(startOfMonth(-1, now))} ${startOfMonth(-1, now).getFullYear()}`;
  return { accounts: [...accounts.values()], label, monthsWithData: new Set(rows.map((r) => r.period)).size, unmapped };
}

/** Todas las cuentas de resultados que se conocen —contabilidad y presupuesto— para validar los rubros. */
export async function knownAccounts() {
  const [statement, budget] = await Promise.all([
    prisma.incomeStatementLine.findMany({ select: { accountCode: true, accountName: true }, distinct: ["accountCode"] }),
    prisma.budgetLine.findMany({ select: { accountCode: true, accountName: true }, distinct: ["accountCode"] }),
  ]);
  const map = new Map<string, string>();
  for (const a of [...statement, ...budget]) if (/^[4-7]/.test(a.accountCode)) map.set(a.accountCode, a.accountName);
  return [...map].map(([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code));
}

