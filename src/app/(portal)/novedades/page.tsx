import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { INCIDENT_STATUS, INCIDENT_TYPES, SEVERITIES } from "@/lib/enums";
import { fmtDate, fmtNumber } from "@/lib/format";
import { anyOf, flatten, many, one, pageCount, pagination, type SearchParams } from "@/lib/params";
import { Card, EmptyState, EnumBadge, PageHeader, StatTile } from "@/components/ui";
import { Filters } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import { IconAlert, IconCheck, IconClock } from "@/components/icons";
import { IncidentResolver } from "./incident-resolver";

export const metadata = { title: "Novedades" };
export const dynamic = "force-dynamic";

export default async function NovedadesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireSection("novedades");
  const sp = await searchParams;
  const status = one(sp.estado) || "PENDIENTES";
  const severities = many(sp.severidad);
  const types = many(sp.tipo);
  const storeId = one(sp.tienda);
  const { page, pageSize, skip, take } = pagination(sp.page, 20);

  const statusFilter =
    status === "PENDIENTES" ? { status: { in: ["ABIERTA", "EN_PROCESO"] } } : status === "TODAS" ? {} : { status };

  const where = {
    ...statusFilter,
    ...(severities.length ? { severity: anyOf(severities) } : {}),
    ...(types.length ? { type: anyOf(types) } : {}),
    ...(storeId ? { storeId } : {}),
    ...(user.role === "MERCADERISTA" ? { reportedById: user.id } : {}),
  };

  const [incidents, total, counts, aging] = await Promise.all([
    prisma.incident.findMany({
      where,
      orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
      skip,
      take,
      include: {
        store: { select: { id: true, name: true, zone: true, company: { select: { name: true } } } },
        product: { select: { id: true, name: true, imageEmoji: true } },
        reportedBy: { select: { name: true } },
        assignedTo: { select: { name: true } },
      },
    }),
    prisma.incident.count({ where }),
    prisma.incident.groupBy({ by: ["status"], _count: true }),
    prisma.incident.findMany({
      where: { status: { in: ["ABIERTA", "EN_PROCESO"] } },
      select: { createdAt: true, dueAt: true, severity: true },
    }),
  ]);

  const byStatus = new Map(counts.map((c) => [c.status, c._count]));
  const now = new Date();
  const overdue = aging.filter((i) => i.dueAt && i.dueAt < now).length;
  const avgAge = aging.length
    ? Math.round(aging.reduce((s, i) => s + (now.getTime() - i.createdAt.getTime()) / 86_400_000, 0) / aging.length)
    : 0;

  return (
    <>
      <PageHeader
        title="Novedades del punto de venta"
        subtitle="Todo lo que el equipo de campo levanta en góndola: quiebres, precios, planograma, producto por vencer y movimientos de la competencia."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Abiertas" value={fmtNumber(byStatus.get("ABIERTA") ?? 0)} hint="Aún sin tomar" icon={<IconAlert size={15} />} />
        <StatTile label="En proceso" value={fmtNumber(byStatus.get("EN_PROCESO") ?? 0)} hint="Con responsable asignado" icon={<IconClock size={15} />} />
        <StatTile label="Fuera de plazo" value={fmtNumber(overdue)} hint="Superaron su fecha compromiso" icon={<IconAlert size={15} />} />
        <StatTile label="Antigüedad media" value={`${avgAge} d`} hint={`${fmtNumber(byStatus.get("RESUELTA") ?? 0)} resueltas históricamente`} icon={<IconCheck size={15} />} />
      </div>

      <div className="mt-5">
        <Filters
          fields={[
            {
              type: "select", name: "estado", label: "Estado",
              options: [
                { value: "PENDIENTES", label: "Pendientes (abierta + en proceso)" },
                ...INCIDENT_STATUS.options.map((o) => ({ value: o.value, label: o.label })),
                { value: "TODAS", label: "Todas" },
              ],
              width: "w-60",
            },
            { type: "select", name: "severidad", label: "Severidad", options: SEVERITIES.options.map((o) => ({ value: o.value, label: o.label })), multi: true },
            { type: "select", name: "tipo", label: "Tipo", options: INCIDENT_TYPES.options.map((o) => ({ value: o.value, label: o.label })), width: "w-52", multi: true },
          ]}
        />

        <Card>
          {incidents.length === 0 ? (
            <EmptyState icon={<IconCheck size={26} />} title="Nada pendiente" description="No hay novedades que cumplan estos filtros." />
          ) : (
            <>
              <ul className="divide-y divide-[var(--border)]">
                {incidents.map((i) => {
                  const isOverdue = i.dueAt && i.dueAt < now && ["ABIERTA", "EN_PROCESO"].includes(i.status);
                  return (
                    <li key={i.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-[11.5px] text-[var(--text-muted)]">{i.code}</span>
                            <EnumBadge option={SEVERITIES.get(i.severity)} dot />
                            <EnumBadge option={INCIDENT_TYPES.get(i.type)} />
                            <EnumBadge option={INCIDENT_STATUS.get(i.status)} />
                            {isOverdue && <span className="badge badge-danger">Fuera de plazo</span>}
                          </div>
                          <p className="mt-1.5 text-[13.5px] font-medium">
                            {i.product?.imageEmoji ? `${i.product.imageEmoji} ` : ""}
                            {i.title}
                            {i.product && <span className="ml-1 text-[var(--text-secondary)]">— {i.product.name}</span>}
                          </p>
                          {i.description && <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">{i.description}</p>}
                          <p className="mt-1 text-[11.5px] text-[var(--text-muted)]">
                            <Link href={`/tiendas/${i.store.id}`} className="hover:text-[var(--brand)] hover:underline">{i.store.name}</Link>
                            {" · "}{i.store.company.name} · {i.store.zone} · reportó {i.reportedBy.name} el {fmtDate(i.createdAt)}
                            {i.assignedTo ? ` · responsable ${i.assignedTo.name}` : ""}
                            {i.dueAt ? ` · compromiso ${fmtDate(i.dueAt)}` : ""}
                          </p>
                          {i.resolution && (
                            <p className="mt-1.5 rounded-md border border-[var(--tone-success-bd)] bg-[var(--tone-success-bg)] px-2 py-1 text-[12px] text-[var(--tone-success-fg)]">
                              {i.resolution}
                            </p>
                          )}
                        </div>
                        {["ABIERTA", "EN_PROCESO"].includes(i.status) && <IncidentResolver id={i.id} status={i.status} />}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Pagination page={page} pageCount={pageCount(total, pageSize)} total={total} params={flatten(sp)} basePath="/novedades" />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
