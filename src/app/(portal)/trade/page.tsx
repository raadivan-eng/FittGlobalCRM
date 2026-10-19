import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection, TRADE_ROLES } from "@/lib/auth";
import { complianceByActivity, liveWhere, tradePhase } from "@/lib/trade";
import { TRADE_PHASE, TRADE_STATUS, TRADE_TYPES } from "@/lib/enums";
import { fmtCompact, fmtDate, fmtNumber } from "@/lib/format";
import { flatten, one, pageCount, pagination, type SearchParams } from "@/lib/params";
import { Card, EmptyState, EnumBadge, Meter, PageHeader, StatTile } from "@/components/ui";
import { Filters } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import { IconAlert, IconCheck, IconMegaphone, IconPlus, IconStore } from "@/components/icons";

export const metadata = { title: "Actividades de trade" };
export const dynamic = "force-dynamic";

/** Por debajo de esto una actividad vigente se marca: lo pactado no se está viendo en tienda. */
const LOW_COMPLIANCE = 70;

export default async function TradePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireSection("trade");
  const sp = await searchParams;
  const status = one(sp.estado) || "ABIERTAS";
  const type = one(sp.tipo);
  const companyId = one(sp.cliente);
  const { page, pageSize, skip, take } = pagination(sp.page, 20);
  const now = new Date();

  const statusFilter =
    status === "ABIERTAS" ? { status: { in: ["PLANEADA", "APROBADA"] } }
    : status === "VIGENTES" ? liveWhere(now)
    : status === "TODAS" ? {}
    : { status };
  const where = { ...statusFilter, ...(type ? { type } : {}), ...(companyId ? { companyId } : {}) };

  const [activities, total, live, companies, yearBudget] = await Promise.all([
    prisma.tradeActivity.findMany({
      where,
      orderBy: [{ startDate: "desc" }],
      skip,
      take,
      include: {
        company: { select: { id: true, name: true } },
        owner: { select: { name: true } },
        _count: { select: { products: true, executions: true } },
      },
    }),
    prisma.tradeActivity.count({ where }),
    prisma.tradeActivity.findMany({ where: liveWhere(now), select: { id: true, budget: true } }),
    prisma.company.findMany({ where: { tradeActivities: { some: {} } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.tradeActivity.aggregate({
      where: { status: { in: ["APROBADA", "CERRADA"] }, startDate: { gte: new Date(now.getFullYear(), 0, 1) } },
      _sum: { budget: true },
    }),
  ]);

  const [comp, liveComp] = await Promise.all([
    complianceByActivity(activities.map((a) => a.id)),
    complianceByActivity(live.map((a) => a.id)),
  ]);
  const liveTotals = [...liveComp.values()].reduce(
    (t, c) => ({ total: t.total + c.total, implemented: t.implemented + c.implemented, pending: t.pending + c.pending }),
    { total: 0, implemented: 0, pending: 0 },
  );
  const lowLive = [...liveComp.values()].filter((c) => c.total && c.pct < LOW_COMPLIANCE).length;

  return (
    <>
      <PageHeader
        title="Actividades de trade"
        subtitle="Promociones, activaciones, exhibiciones y demás acuerdos con las cadenas. Cada una se comprueba tienda por tienda: lo que no se ve en la góndola no se pagó para nada."
        actions={
          TRADE_ROLES.includes(user.role) && (
            <Link href="/trade/nueva" className="btn btn-primary">
              <IconPlus size={14} /> Nueva actividad
            </Link>
          )
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Vigentes hoy" value={fmtNumber(live.length)} hint={`${fmtCompact(live.reduce((t, a) => t + a.budget, 0))} en inversión`} icon={<IconMegaphone size={15} />} href="/trade?estado=VIGENTES" />
        <StatTile
          label="Implementación vigente"
          value={liveTotals.total ? `${Math.round((liveTotals.implemented / liveTotals.total) * 100)} %` : "—"}
          hint={`${fmtNumber(liveTotals.implemented)} de ${fmtNumber(liveTotals.total)} tiendas comprobadas`}
          icon={<IconCheck size={15} />}
        />
        <StatTile label="Tiendas por verificar" value={fmtNumber(liveTotals.pending)} hint="En actividades vigentes" icon={<IconStore size={15} />} />
        <StatTile
          label="Bajo cumplimiento"
          value={fmtNumber(lowLive)}
          hint={`Vigentes con menos de ${LOW_COMPLIANCE} % implementado · ${fmtCompact(yearBudget._sum.budget ?? 0)} invertidos en el año`}
          icon={<IconAlert size={15} />}
        />
      </div>

      <div className="mt-5">
        <Filters
          fields={[
            {
              type: "select", name: "estado", label: "Abiertas (planeadas + aprobadas)",
              options: [
                { value: "VIGENTES", label: "Vigentes hoy" },
                ...TRADE_STATUS.options.map((o) => ({ value: o.value, label: o.label })),
                { value: "TODAS", label: "Todas" },
              ],
              width: "w-64",
            },
            { type: "select", name: "tipo", label: "Tipo", options: TRADE_TYPES.options.map((o) => ({ value: o.value, label: o.label })), width: "w-52" },
            { type: "select", name: "cliente", label: "Cliente", options: companies.map((c) => ({ value: c.id, label: c.name })), width: "w-60" },
          ]}
        />

        <Card>
          {activities.length === 0 ? (
            <EmptyState
              icon={<IconMegaphone size={26} />}
              title="Sin actividades"
              description="No hay actividades de trade que cumplan estos filtros."
              action={TRADE_ROLES.includes(user.role) && <Link href="/trade/nueva" className="btn btn-primary">Crear la primera</Link>}
            />
          ) : (
            <>
              <ul className="divide-y divide-[var(--border)]">
                {activities.map((a) => {
                  const c = comp.get(a.id)!;
                  const phase = tradePhase(a, now);
                  const low = phase === "VIGENTE" && c.total > 0 && c.pct < LOW_COMPLIANCE;
                  return (
                    <li key={a.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-[11.5px] text-[var(--text-muted)]">{a.code}</span>
                            <EnumBadge option={TRADE_TYPES.get(a.type)} />
                            <EnumBadge option={TRADE_STATUS.get(a.status)} />
                            {phase && <EnumBadge option={TRADE_PHASE.get(phase)} dot />}
                            {low && <span className="badge badge-danger">Bajo cumplimiento</span>}
                          </div>
                          <Link href={`/trade/${a.id}`} className="mt-1.5 block text-[13.5px] font-medium hover:text-[var(--brand)] hover:underline">
                            {a.title}
                          </Link>
                          {a.mechanic && <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">{a.mechanic}</p>}
                          <p className="mt-1 text-[11.5px] text-[var(--text-muted)]">
                            {a.company.name} · {fmtDate(a.startDate)} – {fmtDate(a.endDate)} · {a._count.products ? `${a._count.products} productos` : "Todo el portafolio"}
                            {a.budget ? ` · ${fmtCompact(a.budget)}` : ""}
                            {a.owner ? ` · ${a.owner.name}` : ""}
                          </p>
                        </div>
                        <div className="w-full shrink-0 sm:w-56">
                          <div className="flex items-baseline justify-between text-[12px]">
                            <span className="text-[var(--text-secondary)]">Implementada</span>
                            <span className="font-semibold tabular">
                              {fmtNumber(c.implemented)} / {fmtNumber(c.total)} tiendas
                            </span>
                          </div>
                          <div className="mt-1.5">
                            <Meter value={c.implemented} max={c.total} color={low ? "var(--critical)" : "var(--good)"} />
                          </div>
                          <p className="mt-1 text-[11px] text-[var(--text-muted)] tabular">
                            {c.partial ? `${c.partial} parciales · ` : ""}{c.missing ? `${c.missing} sin implementar · ` : ""}{c.pending} por verificar
                          </p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Pagination page={page} pageCount={pageCount(total, pageSize)} total={total} params={flatten(sp)} basePath="/trade" />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
