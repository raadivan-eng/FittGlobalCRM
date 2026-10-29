import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { startOfMonth, fieldKpis } from "@/lib/analytics";
import { VISIT_STATUS } from "@/lib/enums";
import { fmtDate, fmtNumber, fmtTime } from "@/lib/format";
import { registrarCheckIn, registrarCheckOut } from "@/lib/actions-field";
import { anyOf, flatten, many, one, pageCount, pagination, type SearchParams } from "@/lib/params";
import { Card, EmptyState, EnumBadge, PageHeader, StatTile } from "@/components/ui";
import { Filters } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import { IconCheck, IconClock, IconPin, IconTarget, IconVisit } from "@/components/icons";

export const metadata = { title: "Visitas" };
export const dynamic = "force-dynamic";

export default async function VisitasPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireSection("visitas");
  const sp = await searchParams;
  const statuses = many(sp.estado);
  const merchIds = many(sp.mercaderista);
  const range = one(sp.rango) || "MES";
  const { page, pageSize, skip, take } = pagination(sp.page, 25);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const bounds =
    range === "HOY"
      ? { gte: todayStart, lt: new Date(todayStart.getTime() + 86_400_000) }
      : range === "SEMANA"
        ? { gte: new Date(todayStart.getTime() - 3 * 86_400_000), lt: new Date(todayStart.getTime() + 8 * 86_400_000) }
        : range === "PROXIMAS"
          ? { gte: todayStart }
          : { gte: startOfMonth(0, now), lt: startOfMonth(1, now) };

  const isField = user.role === "MERCADERISTA";
  const where = {
    plannedDate: bounds,
    // Un mercaderista sólo ve su propia agenda, aunque la URL traiga otro filtro.
    ...(isField ? { userId: user.id } : merchIds.length ? { userId: anyOf(merchIds) } : {}),
    ...(statuses.length ? { status: anyOf(statuses) } : {}),
  };

  const [visits, total, team, kpis] = await Promise.all([
    prisma.visit.findMany({
      where,
      orderBy: [{ plannedDate: "desc" }, { sequence: "asc" }],
      skip,
      take,
      include: {
        store: { select: { id: true, name: true, zone: true, company: { select: { name: true } } } },
        user: { select: { name: true } },
        _count: { select: { shelfReports: true, incidents: true } },
      },
    }),
    prisma.visit.count({ where }),
    prisma.user.findMany({ where: { role: "MERCADERISTA", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    fieldKpis(startOfMonth(0, now), startOfMonth(1, now), isField ? user.id : merchIds),
  ]);

  return (
    <>
      <PageHeader
        title="Visitas"
        subtitle="Ejecución de la ruta en el punto de venta: agenda, check-in, duración real y lo que se levantó en góndola."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Planificadas este mes" value={fmtNumber(kpis.planned)} icon={<IconVisit size={15} />} />
        <StatTile label="Completadas" value={fmtNumber(kpis.completed)} hint={`${kpis.compliance.toFixed(0)}% de cumplimiento`} icon={<IconCheck size={15} />} />
        <StatTile label="No realizadas" value={fmtNumber(kpis.missed)} hint="Punto cerrado, sin acceso o reprogramada" icon={<IconPin size={15} />} />
        <StatTile label="Duración media" value={`${kpis.avgDuration} min`} hint={`${fmtNumber(kpis.skusAudited)} SKU auditados`} icon={<IconClock size={15} />} />
      </div>

      <div className="mt-5">
        <Filters
          fields={[
            {
              type: "select", name: "rango", label: "Período",
              options: [
                { value: "HOY", label: "Hoy" },
                { value: "SEMANA", label: "Esta semana" },
                { value: "MES", label: "Mes en curso" },
                { value: "PROXIMAS", label: "Próximas" },
              ],
            },
            { type: "select", name: "estado", label: "Estado", options: VISIT_STATUS.options.map((o) => ({ value: o.value, label: o.label })), multi: true },
            ...(isField ? [] : [{ type: "select" as const, name: "mercaderista", label: "Mercaderista", options: team.map((t) => ({ value: t.id, label: t.name })), width: "w-48", multi: true }]),
          ]}
        />

        <Card>
          {visits.length === 0 ? (
            <EmptyState icon={<IconVisit size={26} />} title="Sin visitas en este período" description="Cambia el rango o genera una ruta desde el planificador." action={<Link href="/rutas" className="btn btn-primary">Ir al planificador</Link>} />
          ) : (
            <>
              <div className="scroll-x">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Tienda</th>
                      <th>Cliente</th>
                      <th>Mercaderista</th>
                      <th>Estado</th>
                      <th className="num">Check-in</th>
                      <th className="num">Duración</th>
                      <th className="num">SKU / Nov.</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visits.map((v) => {
                      const mine = v.userId === user.id;
                      const isToday = v.plannedDate >= todayStart && v.plannedDate < new Date(todayStart.getTime() + 86_400_000);
                      return (
                        <tr key={v.id}>
                          <td className="whitespace-nowrap">
                            {fmtDate(v.plannedDate)}
                            {v.sequence && <span className="ml-1.5 badge badge-neutral">#{v.sequence}</span>}
                          </td>
                          <td>
                            <Link href={`/tiendas/${v.store.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                              {v.store.name}
                            </Link>
                            <p className="text-[11.5px] text-[var(--text-muted)]">{v.store.zone}</p>
                          </td>
                          <td className="text-[var(--text-secondary)]">{v.store.company.name}</td>
                          <td className="text-[var(--text-secondary)]">{v.user.name}</td>
                          <td><EnumBadge option={VISIT_STATUS.get(v.status)} dot /></td>
                          <td className="num text-[var(--text-secondary)]">{fmtTime(v.checkInAt)}</td>
                          <td className="num text-[var(--text-secondary)]">{v.durationMinutes ? `${v.durationMinutes} min` : "—"}</td>
                          <td className="num text-[var(--text-secondary)]">
                            {v._count.shelfReports || "—"} / {v._count.incidents || "—"}
                          </td>
                          <td>
                            {mine && isToday && v.status === "PLANIFICADA" && (
                              <form action={registrarCheckIn}>
                                <input type="hidden" name="id" value={v.id} />
                                <button className="btn btn-secondary !px-2 !py-0.5 text-[12px]">Check-in</button>
                              </form>
                            )}
                            {mine && v.status === "EN_CURSO" && (
                              <form action={registrarCheckOut}>
                                <input type="hidden" name="id" value={v.id} />
                                <button className="btn btn-primary !px-2 !py-0.5 text-[12px]">Cerrar visita</button>
                              </form>
                            )}
                            {(!mine || !["PLANIFICADA", "EN_CURSO"].includes(v.status) || (!isToday && v.status === "PLANIFICADA")) && (
                              <span className="text-[var(--text-muted)]">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageCount={pageCount(total, pageSize)} total={total} params={flatten(sp)} basePath="/visitas" />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
