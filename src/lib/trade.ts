import "server-only";
import { prisma } from "./prisma";
import { addMonths, change, latestPeriod, periodsUntil } from "./sell-out";

/**
 * Actividades de trade: lo que se pacta con una cadena (promoción, activación,
 * exhibición…) y su comprobación tienda por tienda.
 *
 * Las fechas se guardan al mediodía de Bogotá, como el resto del portal, para
 * que el día no cambie al pintarlas en el servidor (UTC). Por eso la vigencia
 * se mide con medio día de holgura a cada lado.
 */

const HALF_DAY = 12 * 3_600_000;

export type TradePhase = "PROXIMA" | "VIGENTE" | "VENCIDA";

/** Dónde está en el calendario una actividad aprobada; null si no está aprobada. */
export function tradePhase(a: { status: string; startDate: Date; endDate: Date }, now = new Date()): TradePhase | null {
  if (a.status !== "APROBADA") return null;
  if (now.getTime() < a.startDate.getTime() - HALF_DAY) return "PROXIMA";
  if (now.getTime() > a.endDate.getTime() + HALF_DAY) return "VENCIDA";
  return "VIGENTE";
}

/** Filtro de Prisma para las aprobadas que hoy están en sus fechas. */
export function liveWhere(now = new Date()) {
  return {
    status: "APROBADA",
    startDate: { lte: new Date(now.getTime() + HALF_DAY) },
    endDate: { gte: new Date(now.getTime() - HALF_DAY) },
  };
}

export type Compliance = { total: number; implemented: number; partial: number; missing: number; pending: number; pct: number; checkedPct: number };

/**
 * Cumplimiento de implementación. Sólo cuenta lo comprobado como implementado:
 * lo parcial se muestra aparte porque una promoción a medias en góndola (sin
 * precio, sin material) no es la promoción que se pactó.
 */
export function compliance(counts: { status: string; n: number }[]): Compliance {
  const get = (s: string) => counts.filter((c) => c.status === s).reduce((t, c) => t + c.n, 0);
  const total = counts.reduce((t, c) => t + c.n, 0);
  const implemented = get("IMPLEMENTADA");
  const pending = get("PENDIENTE");
  return {
    total,
    implemented,
    partial: get("PARCIAL"),
    missing: get("NO_IMPLEMENTADA"),
    pending,
    pct: total ? (implemented / total) * 100 : 0,
    checkedPct: total ? ((total - pending) / total) * 100 : 0,
  };
}

/** Cumplimiento de varias actividades de una vez. */
export async function complianceByActivity(activityIds: string[]) {
  if (!activityIds.length) return new Map<string, Compliance>();
  const rows = await prisma.tradeExecution.groupBy({
    by: ["activityId", "status"],
    where: { activityId: { in: activityIds } },
    _count: true,
  });
  const grouped = new Map<string, { status: string; n: number }[]>();
  for (const r of rows) grouped.set(r.activityId, [...(grouped.get(r.activityId) ?? []), { status: r.status, n: r._count }]);
  return new Map(activityIds.map((id) => [id, compliance(grouped.get(id) ?? [])]));
}

const periodOf = (d: Date) => {
  // Mediodía de Bogotá: en UTC sigue siendo el mismo día.
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** Meses de referencia antes de que empiece la actividad. */
export const BASELINE_MONTHS = 3;

export type ImpactGroup = { stores: number; baseline: number; during: number; change: number | null };

export type TradeImpact = {
  periods: { period: string; during: boolean; implemented: number; rest: number }[];
  implemented: ImpactGroup;
  rest: ImpactGroup;
  /** Diferencia en puntos entre la variación de las que la implementaron y la del resto. */
  lift: number | null;
  /** Meses de la vigencia que ya tienen sell-out cargado. */
  monthsMeasured: number;
};

/**
 * ¿Vendió más donde sí se implementó? Compara las unidades por tienda y mes de
 * los productos de la actividad en dos grupos del mismo cliente:
 *
 *  - las tiendas donde quedó implementada (completa o parcial), y
 *  - el resto: donde no se implementó o que no entraron a la actividad.
 *
 * Las tiendas sin verificar no entran a ninguno: no se sabe qué tuvieron. Cada
 * grupo se mide contra sus propios meses previos, así que la diferencia entre
 * las dos variaciones descuenta lo que movió la temporada a todos por igual.
 */
export async function tradeImpact(activity: {
  id: string;
  companyId: string;
  startDate: Date;
  endDate: Date;
  productIds: string[];
}): Promise<TradeImpact | null> {
  const last = await latestPeriod(activity.companyId);
  const start = periodOf(activity.startDate);
  if (!last || last < start) return null;

  const end = periodOf(activity.endDate) < last ? periodOf(activity.endDate) : last;
  const baseline = periodsUntil(addMonths(start, -1), BASELINE_MONTHS);
  const during: string[] = [];
  for (let p = start; p <= end; p = addMonths(p, 1)) during.push(p);
  const periods = [...baseline, ...during];

  const [executions, stores, rows] = await Promise.all([
    prisma.tradeExecution.findMany({ where: { activityId: activity.id }, select: { storeId: true, status: true } }),
    prisma.store.findMany({ where: { companyId: activity.companyId, active: true }, select: { id: true } }),
    prisma.sellOut.groupBy({
      by: ["storeId", "period"],
      where: {
        companyId: activity.companyId,
        period: { in: periods },
        ...(activity.productIds.length ? { productId: { in: activity.productIds } } : {}),
      },
      _sum: { units: true },
    }),
  ]);

  const status = new Map(executions.map((e) => [e.storeId, e.status]));
  const groupOf = (storeId: string) => {
    const s = status.get(storeId);
    if (s === "IMPLEMENTADA" || s === "PARCIAL") return "implemented" as const;
    if (s === "PENDIENTE") return null;
    return "rest" as const;
  };
  const size = { implemented: 0, rest: 0 };
  for (const st of stores) {
    const g = groupOf(st.id);
    if (g) size[g]++;
  }

  const units = new Map<string, { implemented: number; rest: number }>(periods.map((p) => [p, { implemented: 0, rest: 0 }]));
  for (const r of rows) {
    const g = groupOf(r.storeId);
    const cell = units.get(r.period);
    if (g && cell) cell[g] += r._sum.units ?? 0;
  }

  const perStore = (v: number, n: number) => (n ? v / n : 0);
  const series = periods.map((p) => ({
    period: p,
    during: during.includes(p),
    implemented: perStore(units.get(p)!.implemented, size.implemented),
    rest: perStore(units.get(p)!.rest, size.rest),
  }));

  const avg = (list: number[]) => (list.length ? list.reduce((s, v) => s + v, 0) / list.length : 0);
  const group = (key: "implemented" | "rest"): ImpactGroup => {
    const b = avg(series.filter((s) => !s.during).map((s) => s[key]));
    const d = avg(series.filter((s) => s.during).map((s) => s[key]));
    return { stores: size[key], baseline: b, during: d, change: size[key] ? change(d, b) : null };
  };
  const implemented = group("implemented");
  const rest = group("rest");

  return {
    periods: series,
    implemented,
    rest,
    lift: implemented.change != null && rest.change != null ? implemented.change - rest.change : null,
    monthsMeasured: during.length,
  };
}
