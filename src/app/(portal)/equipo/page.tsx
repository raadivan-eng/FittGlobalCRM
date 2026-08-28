import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { startOfMonth } from "@/lib/analytics";
import { loadStoresForRouting } from "@/lib/field";
import { scoreStores } from "@/lib/routing";
import { fmtNumber, fmtPeriod } from "@/lib/format";
import { periodKey } from "@/lib/analytics";
import { Avatar, Card, CardHeader, Meter, PageHeader, StatTile } from "@/components/ui";
import { RankingBars } from "@/components/charts";
import { IconAlert, IconRoute, IconTarget, IconTeam } from "@/components/icons";

export const metadata = { title: "Equipo de campo" };
export const dynamic = "force-dynamic";

export default async function EquipoPage() {
  await requireSection("equipo");

  const now = new Date();
  const from = startOfMonth(0, now);
  const to = startOfMonth(1, now);

  const team = await prisma.user.findMany({
    where: { role: "MERCADERISTA", active: true },
    orderBy: { name: "asc" },
    include: { _count: { select: { assignments: true } } },
  });

  const rows = await Promise.all(
    team.map(async (member) => {
      const [planned, completed, missed, incidents, shelf, duration, visitedStores, signals] = await Promise.all([
        prisma.visit.count({ where: { userId: member.id, plannedDate: { gte: from, lt: to } } }),
        prisma.visit.count({ where: { userId: member.id, plannedDate: { gte: from, lt: to }, status: "COMPLETADA" } }),
        prisma.visit.count({ where: { userId: member.id, plannedDate: { gte: from, lt: to }, status: "NO_REALIZADA" } }),
        prisma.incident.count({ where: { reportedById: member.id, createdAt: { gte: from, lt: to } } }),
        prisma.shelfReport.count({ where: { visit: { userId: member.id, plannedDate: { gte: from, lt: to } } } }),
        prisma.visit.aggregate({
          where: { userId: member.id, plannedDate: { gte: from, lt: to }, status: "COMPLETADA", durationMinutes: { not: null } },
          _avg: { durationMinutes: true },
        }),
        prisma.visit.findMany({
          where: { userId: member.id, plannedDate: { gte: from, lt: to }, status: "COMPLETADA" },
          select: { storeId: true },
          distinct: ["storeId"],
        }),
        loadStoresForRouting({ userId: member.id }),
      ]);

      const scored = scoreStores(signals, now);
      return {
        member,
        planned,
        completed,
        missed,
        incidents,
        shelf,
        avgDuration: Math.round(duration._avg.durationMinutes ?? 0),
        coverage: member._count.assignments ? (visitedStores.length / member._count.assignments) * 100 : 0,
        visitedStores: visitedStores.length,
        compliance: planned ? (completed / planned) * 100 : 0,
        overdue: scored.filter((s) => s.overdueDays > 0).length,
        urgent: scored.filter((s) => s.score >= 62).length,
      };
    }),
  );

  const totals = rows.reduce(
    (acc, r) => ({
      planned: acc.planned + r.planned,
      completed: acc.completed + r.completed,
      incidents: acc.incidents + r.incidents,
      overdue: acc.overdue + r.overdue,
    }),
    { planned: 0, completed: 0, incidents: 0, overdue: 0 },
  );

  return (
    <>
      <PageHeader
        title="Equipo de campo"
        subtitle={`Desempeño de los mercaderistas en ${fmtPeriod(periodKey(from))}. La cobertura mide cuántas de sus tiendas asignadas recibieron al menos una visita.`}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Mercaderistas activos" value={fmtNumber(team.length)} hint={`${fmtNumber(team.reduce((s, t) => s + t._count.assignments, 0))} tiendas asignadas`} icon={<IconTeam size={15} />} />
        <StatTile label="Cumplimiento global" value={`${totals.planned ? ((totals.completed / totals.planned) * 100).toFixed(0) : 0}%`} hint={`${fmtNumber(totals.completed)} de ${fmtNumber(totals.planned)} visitas`} icon={<IconTarget size={15} />} />
        <StatTile label="Novedades levantadas" value={fmtNumber(totals.incidents)} hint="Reportadas este mes por el equipo" icon={<IconAlert size={15} />} />
        <StatTile label="Tiendas con frecuencia vencida" value={fmtNumber(totals.overdue)} hint="Requieren visita antes de cerrar el mes" icon={<IconRoute size={15} />} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        {rows.map((r) => (
          <Card key={r.member.id}>
            <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
              <Avatar name={r.member.name} color={r.member.avatarColor} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold">{r.member.name}</p>
                <p className="truncate text-[11.5px] text-[var(--text-muted)]">
                  Zona {r.member.zone ?? "—"} · {r.member._count.assignments} tiendas
                </p>
              </div>
              <Link href={`/rutas?mercaderista=${r.member.id}`} className="btn btn-ghost !px-2 text-[12px]" title="Ver su ruta">
                <IconRoute size={15} />
              </Link>
            </div>

            <div className="flex flex-col gap-3 px-4 py-3.5">
              <div>
                <div className="flex items-baseline justify-between text-[12.5px]">
                  <span className="text-[var(--text-secondary)]">Cumplimiento de visitas</span>
                  <span className="font-semibold tabular">{r.compliance.toFixed(0)}%</span>
                </div>
                <div className="mt-1.5">
                  <Meter value={r.completed} max={Math.max(1, r.planned)} color={r.compliance >= 90 ? "var(--good)" : r.compliance >= 70 ? "var(--warning)" : "var(--critical)"} />
                </div>
                <p className="mt-1 text-[11.5px] text-[var(--text-muted)]">{r.completed} completadas · {r.missed} no realizadas de {r.planned}</p>
              </div>

              <div>
                <div className="flex items-baseline justify-between text-[12.5px]">
                  <span className="text-[var(--text-secondary)]">Cobertura de su cartera</span>
                  <span className="font-semibold tabular">{r.coverage.toFixed(0)}%</span>
                </div>
                <div className="mt-1.5">
                  <Meter value={r.visitedStores} max={Math.max(1, r.member._count.assignments)} color="var(--seq-400)" />
                </div>
                <p className="mt-1 text-[11.5px] text-[var(--text-muted)]">{r.visitedStores} de {r.member._count.assignments} tiendas visitadas</p>
              </div>

              <dl className="grid grid-cols-3 gap-2 border-t border-[var(--border)] pt-3">
                {[
                  { k: "Novedades", v: fmtNumber(r.incidents) },
                  { k: "SKU auditados", v: fmtNumber(r.shelf) },
                  { k: "Duración media", v: `${r.avgDuration}′` },
                ].map((x) => (
                  <div key={x.k}>
                    <dt className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--text-muted)]">{x.k}</dt>
                    <dd className="mt-0.5 text-[14px] font-semibold tabular">{x.v}</dd>
                  </div>
                ))}
              </dl>

              {r.urgent > 0 && (
                <p className="rounded-md border border-[var(--tone-danger-bd)] bg-[var(--tone-danger-bg)] px-2 py-1.5 text-[11.5px] text-[var(--tone-danger-fg)]">
                  {r.urgent} tienda{r.urgent === 1 ? "" : "s"} con prioridad urgente · {r.overdue} con frecuencia vencida
                </p>
              )}
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Ranking por cumplimiento" subtitle="Visitas completadas sobre planificadas" />
          <RankingBars
            items={[...rows].sort((a, b) => b.compliance - a.compliance).map((r) => ({
              label: r.member.name,
              value: r.compliance,
              sub: `${r.completed}/${r.planned} visitas`,
              href: `/rutas?mercaderista=${r.member.id}`,
            }))}
            format="percent"
            color="var(--seq-400)"
          />
        </Card>
        <Card>
          <CardHeader title="Ranking por novedades levantadas" subtitle="Señal de intensidad del trabajo en góndola" />
          <RankingBars
            items={[...rows].sort((a, b) => b.incidents - a.incidents).map((r) => ({
              label: r.member.name,
              value: r.incidents,
              sub: `${r.shelf} SKU`,
            }))}
            format="raw"
            color="var(--seq-550)"
          />
        </Card>
      </div>
    </>
  );
}
