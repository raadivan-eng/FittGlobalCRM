import "server-only";
import { prisma } from "./prisma";
import { NOT_VOID } from "./analytics";
import type { StoreForRouting } from "./routing";

/**
 * Reúne, para cada tienda asignada, las señales que alimentan el score de visita.
 *
 * El valor comercial de una tienda se toma del pedido directo cuando existe; si
 * el cliente factura centralizado (caso típico de cadena), se reparte la
 * facturación de la empresa entre sus puntos de venta activos, ponderando por
 * tier. Sin ese reparto las tiendas de cadena puntuarían cero en valor y la
 * ruta se sesgaría hacia el canal tradicional.
 */
export async function loadStoresForRouting(
  opts: { userId?: string; storeIds?: string[] } = {},
): Promise<StoreForRouting[]> {
  const since90 = new Date(Date.now() - 90 * 86_400_000);

  const assignments = await prisma.storeAssignment.findMany({
    where: {
      ...(opts.userId ? { userId: opts.userId } : {}),
      store: { active: true, ...(opts.storeIds ? { id: { in: opts.storeIds } } : {}) },
    },
    include: { store: { include: { company: { select: { id: true, name: true } } } } },
  });
  if (!assignments.length) return [];

  const stores = assignments.map((a) => a.store);
  const storeIds = stores.map((s) => s.id);
  const companyIds = [...new Set(stores.map((s) => s.companyId))];

  const [lastVisits, openIncidents, directSales, companySales, storesPerCompany] = await Promise.all([
    prisma.visit.findMany({
      where: { storeId: { in: storeIds }, status: "COMPLETADA" },
      orderBy: { plannedDate: "desc" },
      select: { id: true, storeId: true, plannedDate: true },
    }),
    prisma.incident.findMany({
      where: { storeId: { in: storeIds }, status: { in: ["ABIERTA", "EN_PROCESO"] } },
      select: { storeId: true, severity: true },
    }),
    prisma.salesOrder.groupBy({
      by: ["storeId"],
      where: { storeId: { in: storeIds }, date: { gte: since90 }, status: NOT_VOID },
      _sum: { total: true },
    }),
    prisma.invoice.groupBy({
      by: ["companyId"],
      where: { companyId: { in: companyIds }, issueDate: { gte: since90 }, status: NOT_VOID },
      _sum: { total: true },
    }),
    prisma.store.groupBy({ by: ["companyId"], where: { companyId: { in: companyIds }, active: true }, _count: true }),
  ]);

  // Primera aparición = visita más reciente, porque la consulta viene ordenada.
  const lastVisitByStore = new Map<string, { id: string; plannedDate: Date }>();
  for (const v of lastVisits) {
    if (!lastVisitByStore.has(v.storeId)) lastVisitByStore.set(v.storeId, { id: v.id, plannedDate: v.plannedDate });
  }

  const lastVisitIds = [...lastVisitByStore.values()].map((v) => v.id);
  const shelfOfLastVisit = lastVisitIds.length
    ? await prisma.shelfReport.findMany({
        where: { visitId: { in: lastVisitIds } },
        select: { visitId: true, outOfStock: true, nearExpiryUnits: true },
      })
    : [];

  const shelfByVisit = new Map<string, { oos: number; nearExpiry: number }>();
  for (const r of shelfOfLastVisit) {
    const acc = shelfByVisit.get(r.visitId) ?? { oos: 0, nearExpiry: 0 };
    if (r.outOfStock) acc.oos += 1;
    acc.nearExpiry += r.nearExpiryUnits;
    shelfByVisit.set(r.visitId, acc);
  }

  const incidentsByStore = new Map<string, { severity: string }[]>();
  for (const i of openIncidents) {
    const list = incidentsByStore.get(i.storeId) ?? [];
    list.push({ severity: i.severity });
    incidentsByStore.set(i.storeId, list);
  }

  const directByStore = new Map<string, number>();
  for (const d of directSales) if (d.storeId) directByStore.set(d.storeId, d._sum.total ?? 0);

  const companyTotal = new Map(companySales.map((c) => [c.companyId, c._sum.total ?? 0]));
  const companyStoreCount = new Map(storesPerCompany.map((c) => [c.companyId, c._count]));
  const tierWeight: Record<string, number> = { A: 1.6, B: 1, C: 0.6 };

  return stores.map((store) => {
    const last = lastVisitByStore.get(store.id);
    const shelf = last ? shelfByVisit.get(last.id) : undefined;
    const direct = directByStore.get(store.id) ?? 0;
    const shared =
      (companyTotal.get(store.companyId) ?? 0) / Math.max(1, companyStoreCount.get(store.companyId) ?? 1);

    return {
      id: store.id,
      code: store.code,
      name: store.name,
      companyName: store.company.name,
      lat: store.lat,
      lng: store.lng,
      zone: store.zone,
      city: store.city,
      tier: store.tier,
      format: store.format,
      visitsPerMonth: store.visitsPerMonth,
      avgVisitMinutes: store.avgVisitMinutes,
      lastVisitAt: last?.plannedDate ?? null,
      openIncidents: incidentsByStore.get(store.id) ?? [],
      outOfStockSkus: shelf?.oos ?? 0,
      nearExpiryUnits: shelf?.nearExpiry ?? 0,
      sales90d: Math.max(direct, shared * (tierWeight[store.tier] ?? 1)),
    } satisfies StoreForRouting;
  });
}

/** Centroide de las tiendas asignadas: punto de partida por defecto de la ruta. */
export function centroid(points: { lat: number; lng: number }[]) {
  if (!points.length) return { lat: 4.6533, lng: -74.0836 };
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
  };
}
