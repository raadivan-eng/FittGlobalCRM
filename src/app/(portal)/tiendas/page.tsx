import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { GEO_STATUS, STORE_FORMATS, TIERS } from "@/lib/enums";
import { fmtNumber, relativeDays } from "@/lib/format";
import { flatten, one, pageCount, pagination, type SearchParams } from "@/lib/params";
import { Card, EmptyState, EnumBadge, PageHeader } from "@/components/ui";
import { Filters } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import { IconPin, IconPlus, IconSearch, IconStore } from "@/components/icons";

export const metadata = { title: "Tiendas" };
export const dynamic = "force-dynamic";

export default async function TiendasPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireSection("tiendas");
  const sp = await searchParams;
  const q = one(sp.q);
  const zone = one(sp.zona);
  const format = one(sp.formato);
  const tier = one(sp.tier);
  const companyId = one(sp.cliente);
  const estado = one(sp.estado);
  const ubicacion = one(sp.ubicacion);
  const { page, pageSize, skip, take } = pagination(sp.page, 25);

  // Un mercaderista sólo ve su propia cartera de puntos de venta.
  const scopedToUser = user.role === "MERCADERISTA" ? { assignments: { some: { userId: user.id } } } : {};

  const where = {
    active: estado !== "inactivas",
    ...scopedToUser,
    ...(q ? { OR: [{ name: { contains: q } }, { code: { contains: q } }, { address: { contains: q } }] } : {}),
    ...(zone ? { zone } : {}),
    ...(format ? { format } : {}),
    ...(tier ? { tier } : {}),
    ...(companyId ? { companyId } : {}),
    ...(ubicacion === "sin" ? { lat: null } : ubicacion === "con" ? { lat: { not: null } } : {}),
  };
  const canImport = ["ADMIN", "SUPERVISOR"].includes(user.role);

  const [stores, total, zones, companies] = await Promise.all([
    prisma.store.findMany({
      where,
      orderBy: [{ zone: "asc" }, { name: "asc" }],
      skip,
      take,
      include: {
        company: { select: { id: true, name: true } },
        assignments: { include: { user: { select: { name: true } } } },
        _count: { select: { incidents: { where: { status: { in: ["ABIERTA", "EN_PROCESO"] } } } } },
      },
    }),
    prisma.store.count({ where }),
    prisma.store.findMany({ where: { active: true }, select: { zone: true }, distinct: ["zone"], orderBy: { zone: "asc" } }),
    prisma.company.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const lastVisits = await prisma.visit.findMany({
    where: { storeId: { in: stores.map((s) => s.id) }, status: "COMPLETADA" },
    orderBy: { plannedDate: "desc" },
    select: { storeId: true, plannedDate: true },
  });
  const lastByStore = new Map<string, Date>();
  for (const v of lastVisits) if (!lastByStore.has(v.storeId)) lastByStore.set(v.storeId, v.plannedDate);

  const today = new Date();

  return (
    <>
      <PageHeader
        title="Tiendas"
        subtitle="Puntos de venta donde el producto llega a la góndola. Cada uno pertenece a un cliente y tiene una frecuencia de visita comprometida."
        actions={
          <>
            <span className="badge badge-neutral">{fmtNumber(total)} {estado === "inactivas" ? "no visitables" : "activas"}</span>
            {canImport && (
              <>
                <Link href="/tiendas/ubicar" className="btn btn-secondary">
                  <IconPin size={14} /> Ubicar en el mapa
                </Link>
                <Link href="/tiendas/descubiertas" className="btn btn-secondary">
                  <IconSearch size={14} /> Descubiertas en Maps
                </Link>
                <Link href="/tiendas/importar" className="btn btn-secondary">
                  <IconPlus size={14} /> Importar desde Excel
                </Link>
              </>
            )}
          </>
        }
      />

      <Filters
        fields={[
          { type: "search", name: "q", placeholder: "Nombre, código o dirección…" },
          { type: "select", name: "zona", label: "Zona", options: zones.map((z) => ({ value: z.zone, label: z.zone })) },
          { type: "select", name: "formato", label: "Formato", options: STORE_FORMATS.options.map((o) => ({ value: o.value, label: o.label })) },
          { type: "select", name: "tier", label: "ABC", options: TIERS.options.map((o) => ({ value: o.value, label: o.label })) },
          { type: "select", name: "cliente", label: "Cliente", options: companies.map((c) => ({ value: c.id, label: c.name })), width: "w-52" },
          { type: "select", name: "ubicacion", label: "Ubicación", options: [{ value: "con", label: "Con coordenadas" }, { value: "sin", label: "Sin ubicar" }] },
          { type: "select", name: "estado", label: "Estado", options: [{ value: "inactivas", label: "No visitables" }] },
        ]}
      />

      <Card>
        {stores.length === 0 ? (
          <EmptyState icon={<IconStore size={26} />} title="Sin tiendas" description="Ajusta los filtros para ver otros puntos de venta." />
        ) : (
          <>
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Punto de venta</th>
                    <th>Cliente</th>
                    <th>Zona</th>
                    <th>Formato</th>
                    <th>ABC</th>
                    <th className="num">Frecuencia</th>
                    <th>Última visita</th>
                    <th className="num">Novedades</th>
                    <th>Mercaderista</th>
                  </tr>
                </thead>
                <tbody>
                  {stores.map((s) => {
                    const last = lastByStore.get(s.id);
                    const targetDays = Math.round(30 / Math.max(1, s.visitsPerMonth));
                    const days = last ? Math.floor((today.getTime() - last.getTime()) / 86_400_000) : null;
                    const overdue = days == null || days > targetDays;
                    return (
                      <tr key={s.id}>
                        <td>
                          <Link href={`/tiendas/${s.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                            {s.name}
                          </Link>
                          <p className="text-[11.5px] text-[var(--text-muted)]">
                            {s.code} · {s.city}
                            {s.inactiveReason ? ` · ${s.inactiveReason}` : s.lat == null ? ` · ${GEO_STATUS.label(s.geoStatus).toLowerCase()}` : ""}
                          </p>
                        </td>
                        <td>
                          <Link href={`/clientes/${s.company.id}`} className="text-[var(--text-secondary)] hover:text-[var(--brand)] hover:underline">
                            {s.company.name}
                          </Link>
                        </td>
                        <td className="text-[var(--text-secondary)]">{s.zone}</td>
                        <td className="text-[var(--text-secondary)]">{STORE_FORMATS.label(s.format)}</td>
                        <td><EnumBadge option={TIERS.get(s.tier)} /></td>
                        <td className="num text-[var(--text-secondary)]">{s.visitsPerMonth}×/mes</td>
                        <td className={overdue ? "font-medium text-[var(--critical)]" : "text-[var(--text-secondary)]"}>
                          {days == null ? "Nunca" : relativeDays(days)}
                        </td>
                        <td className="num">
                          {s._count.incidents > 0 ? <span className="badge badge-danger">{s._count.incidents}</span> : <span className="text-[var(--text-muted)]">—</span>}
                        </td>
                        <td className="text-[var(--text-secondary)]">{s.assignments[0]?.user.name ?? "Sin asignar"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageCount={pageCount(total, pageSize)} total={total} params={flatten(sp)} basePath="/tiendas" />
          </>
        )}
      </Card>
    </>
  );
}
