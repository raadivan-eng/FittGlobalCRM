import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { fieldKpis, startOfMonth } from "@/lib/analytics";
import { centroid, loadStoresForRouting } from "@/lib/field";
import { buildRoute, clockAt, scoreStores } from "@/lib/routing";
import { INCIDENT_TYPES, SEVERITIES, STORE_FORMATS, VISIT_STATUS } from "@/lib/enums";
import { fmtDate, fmtNumber } from "@/lib/format";
import { Card, CardHeader, EnumBadge, StatTile } from "@/components/ui";
import { IconAlert, IconArrowRight, IconClock, IconPin, IconRoute, IconTarget, IconVisit } from "@/components/icons";
import { ScoreBadge } from "@/components/score-badge";

const START_HOUR = 8;

export async function DashboardCampo({ userId, userName }: { userId: string; userName: string }) {
  const now = new Date();
  const monthStart = startOfMonth(0, now);
  const nextMonth = startOfMonth(1, now);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86_400_000);

  const [kpis, candidates, plannedToday, upcoming, myIncidents] = await Promise.all([
    fieldKpis(monthStart, nextMonth, userId),
    loadStoresForRouting({ userId }),
    prisma.visit.findMany({
      where: { userId, plannedDate: { gte: todayStart, lt: todayEnd } },
      include: { store: { select: { name: true, zone: true, company: { select: { name: true } } } } },
      orderBy: { plannedDate: "asc" },
    }),
    prisma.visit.findMany({
      where: { userId, plannedDate: { gte: todayEnd }, status: "PLANIFICADA" },
      include: { store: { select: { name: true, zone: true, company: { select: { name: true } } } } },
      orderBy: { plannedDate: "asc" },
      take: 8,
    }),
    prisma.incident.findMany({
      where: { reportedById: userId, status: { in: ["ABIERTA", "EN_PROCESO"] } },
      orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
      take: 6,
      include: { store: { select: { name: true } }, product: { select: { name: true, imageEmoji: true } } },
    }),
  ]);

  const scored = scoreStores(candidates, now);
  const plan = buildRoute(scored, { origin: centroid(candidates), workdayMinutes: 8 * 60, maxStops: 8 });

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Visitas de hoy" value={fmtNumber(plannedToday.length)} hint={`${plan.stops.length} sugeridas por el planificador`} icon={<IconVisit size={15} />} href="/visitas" />
        <StatTile label="Cumplimiento del mes" value={`${kpis.compliance.toFixed(0)}%`} hint={`${fmtNumber(kpis.completed)} de ${fmtNumber(kpis.planned)} visitas`} icon={<IconTarget size={15} />} />
        <StatTile label="Novedades abiertas" value={fmtNumber(kpis.openIncidents)} hint={`${fmtNumber(kpis.criticalIncidents)} de severidad alta o crítica`} icon={<IconAlert size={15} />} href="/novedades" />
        <StatTile label="Quiebre en góndola" value={`${kpis.oosRate.toFixed(1)}%`} hint={`${fmtNumber(kpis.skusAudited)} SKU auditados este mes`} icon={<IconPin size={15} />} invertDelta />
      </div>

      <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader
            title="Ruta sugerida para hoy"
            subtitle={`${plan.stops.length} paradas · ${Math.round((plan.totalTravelMinutes + plan.totalVisitMinutes) / 6) / 10} h estimadas · ${plan.distanceKm} km`}
            action={
              <Link href="/rutas" className="btn btn-secondary !px-2.5 text-[12.5px]">
                <IconRoute size={14} /> Ajustar ruta
              </Link>
            }
          />
          {plan.stops.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-[var(--text-muted)]">
              No tienes tiendas asignadas todavía. Habla con tu supervisor.
            </p>
          ) : (
            <ol className="divide-y divide-[var(--border)]">
              {plan.stops.map((stop) => (
                <li key={stop.store.id} className="flex gap-3 px-4 py-3">
                  <div className="flex flex-col items-center gap-1 pt-0.5">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[11.5px] font-bold text-[var(--brand-ink)]">
                      {stop.sequence}
                    </span>
                    <span className="text-[10.5px] tabular text-[var(--text-muted)]">{clockAt(START_HOUR, stop.arrivalMinute)}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/tiendas/${stop.store.id}`} className="truncate text-[13.5px] font-medium hover:text-[var(--brand)] hover:underline">
                          {stop.store.name}
                        </Link>
                        <p className="mt-0.5 truncate text-[12px] text-[var(--text-muted)]">
                          {stop.store.companyName} · {stop.store.zone} · {STORE_FORMATS.label(stop.store.format)}
                        </p>
                      </div>
                      <ScoreBadge score={stop.store.score} />
                    </div>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {stop.store.reasons.slice(0, 3).map((r) => (
                        <li key={r.label} className="rounded-md bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
                          {r.label}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                      <IconClock size={11} /> {stop.travelMinutes} min de traslado · {stop.store.avgVisitMinutes} min en tienda
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Agenda de hoy" subtitle={fmtDate(now)} />
            {plannedToday.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">Sin visitas agendadas para hoy.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {plannedToday.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">{v.store.name}</p>
                      <p className="truncate text-[11.5px] text-[var(--text-muted)]">{v.store.company.name}</p>
                    </div>
                    <EnumBadge option={VISIT_STATUS.get(v.status)} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Mis novedades abiertas" action={<Link href="/novedades" className="btn btn-ghost !px-2 text-[12.5px]">Ver <IconArrowRight size={13} /></Link>} />
            {myIncidents.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">Nada pendiente. Buen trabajo.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {myIncidents.map((i) => (
                  <li key={i.id} className="px-4 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-[13px] font-medium">
                        {i.product?.imageEmoji ? `${i.product.imageEmoji} ` : ""}{i.title}
                      </p>
                      <EnumBadge option={SEVERITIES.get(i.severity)} />
                    </div>
                    <p className="mt-0.5 truncate text-[11.5px] text-[var(--text-muted)]">
                      {i.store.name} · {INCIDENT_TYPES.label(i.type)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </section>

      {upcoming.length > 0 && (
        <Card>
          <CardHeader title="Próximas visitas planificadas" subtitle="Siguientes días de tu agenda" />
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tienda</th>
                  <th>Cliente</th>
                  <th>Zona</th>
                  <th>Objetivo</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((v) => (
                  <tr key={v.id}>
                    <td className="whitespace-nowrap">{fmtDate(v.plannedDate)}</td>
                    <td className="font-medium">{v.store.name}</td>
                    <td className="text-[var(--text-secondary)]">{v.store.company.name}</td>
                    <td className="text-[var(--text-secondary)]">{v.store.zone}</td>
                    <td className="text-[var(--text-secondary)]">{v.objective ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
