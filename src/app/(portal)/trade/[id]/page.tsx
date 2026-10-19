import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSection, TRADE_CHECK_ROLES, TRADE_ROLES } from "@/lib/auth";
import { BASELINE_MONTHS, compliance, tradeImpact, tradePhase } from "@/lib/trade";
import { periodLabel } from "@/lib/sell-out";
import { TRADE_EXECUTION, TRADE_PHASE, TRADE_STATUS, TRADE_TYPES } from "@/lib/enums";
import { fmtCompact, fmtDate, fmtDateTime, fmtNumber, fmtPct } from "@/lib/format";
import { flatten, one, pageCount, pagination, type SearchParams } from "@/lib/params";
import { Card, CardHeader, EnumBadge, KeyValue, Meter, PageHeader, StatTile } from "@/components/ui";
import { Filters } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import { LineChart } from "@/components/charts";
import { IconCheck, IconEdit, IconExternal, IconRotation, IconSales, IconStore } from "@/components/icons";
import { ExecutionControl, StatusControls } from "./controls";
import { AddStores } from "./add-stores";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await prisma.tradeActivity.findUnique({ where: { id }, select: { title: true } });
  return { title: a?.title ?? "Actividad de trade" };
}

export default async function ActividadDetalle({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const user = await requireSection("trade");
  const { id } = await params;
  const sp = await searchParams;

  const activity = await prisma.tradeActivity.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true } },
      owner: { select: { name: true } },
      products: { include: { product: { select: { id: true, name: true, sku: true, imageEmoji: true } } } },
    },
  });
  if (!activity) notFound();

  const execStatus = one(sp.ejecucion);
  const city = one(sp.ciudad);
  const { page, pageSize, skip, take } = pagination(sp.page, 40);
  const where = { activityId: id, ...(execStatus ? { status: execStatus } : {}), ...(city ? { store: { city } } : {}) };

  const [executions, filtered, counts, byCity, outside, impact] = await Promise.all([
    prisma.tradeExecution.findMany({
      where,
      // Primero lo que falta comprobar o corregir.
      orderBy: [{ status: "desc" }, { store: { name: "asc" } }],
      skip,
      take,
      include: {
        store: { select: { id: true, name: true, code: true, city: true } },
        checkedBy: { select: { name: true } },
      },
    }),
    prisma.tradeExecution.count({ where }),
    prisma.tradeExecution.groupBy({ by: ["status"], where: { activityId: id }, _count: true }),
    prisma.tradeExecution.findMany({ where: { activityId: id }, select: { status: true, store: { select: { city: true } } } }),
    prisma.store.findMany({
      where: { companyId: activity.companyId, active: true, tradeChecks: { none: { activityId: id } } },
      select: { id: true, name: true, code: true, city: true },
      orderBy: [{ city: "asc" }, { name: "asc" }],
    }),
    tradeImpact({
      id,
      companyId: activity.companyId,
      startDate: activity.startDate,
      endDate: activity.endDate,
      productIds: activity.products.map((p) => p.productId),
    }),
  ]);

  const c = compliance(counts.map((x) => ({ status: x.status, n: x._count })));
  const phase = tradePhase(activity);
  const canEdit = TRADE_ROLES.includes(user.role);
  const canCheck = TRADE_CHECK_ROLES.includes(user.role);

  const cities = new Map<string, { total: number; implemented: number; pending: number }>();
  for (const e of byCity) {
    const k = e.store.city;
    const row = cities.get(k) ?? { total: 0, implemented: 0, pending: 0 };
    row.total++;
    if (e.status === "IMPLEMENTADA") row.implemented++;
    if (e.status === "PENDIENTE") row.pending++;
    cities.set(k, row);
  }
  const cityRows = [...cities.entries()].sort((a, b) => b[1].total - a[1].total);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Actividades de trade", href: "/trade" }, { label: activity.code }]}
        title={activity.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <EnumBadge option={TRADE_TYPES.get(activity.type)} />
            <EnumBadge option={TRADE_STATUS.get(activity.status)} />
            {phase && <EnumBadge option={TRADE_PHASE.get(phase)} dot />}
            <span className="ml-1">
              <Link href={`/clientes/${activity.company.id}`} className="hover:text-[var(--brand)] hover:underline">{activity.company.name}</Link>
              {" · "}{fmtDate(activity.startDate)} – {fmtDate(activity.endDate)}
            </span>
          </span>
        }
        actions={
          canEdit && (
            <>
              <Link href={`/trade/${id}/editar`} className="btn btn-secondary">
                <IconEdit size={14} /> Editar
              </Link>
              <StatusControls id={id} status={activity.status} />
            </>
          )
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Implementada"
          value={`${Math.round(c.pct)} %`}
          hint={`${fmtNumber(c.implemented)} de ${fmtNumber(c.total)} tiendas${c.partial ? ` · ${c.partial} parciales` : ""}`}
          icon={<IconCheck size={15} />}
          href={`/trade/${id}?ejecucion=IMPLEMENTADA`}
        />
        <StatTile
          label="Verificada"
          value={`${Math.round(c.checkedPct)} %`}
          hint={`${fmtNumber(c.pending)} tiendas por visitar`}
          icon={<IconStore size={15} />}
          href={`/trade/${id}?ejecucion=PENDIENTE`}
        />
        <StatTile
          label="Inversión"
          value={fmtCompact(activity.budget)}
          hint={c.implemented ? `${fmtCompact(activity.budget / c.implemented)} por tienda implementada` : "Sin tiendas implementadas"}
          icon={<IconSales size={15} />}
        />
        <StatTile
          label="Efecto en sell-out"
          value={impact?.lift == null ? "—" : `${impact.lift >= 0 ? "+" : "−"}${Math.abs(Math.round(impact.lift))} pts`}
          hint={
            impact?.lift == null
              ? impact
                ? "Hace falta un grupo de comparación"
                : "Aún sin sell-out desde el inicio"
              : "Variación donde se implementó menos la del resto"
          }
          icon={<IconRotation size={15} />}
        />
      </div>

      <div className="mt-5 grid items-start gap-4 xl:grid-cols-[1.5fr_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader
              title="¿Vendió más donde se implementó?"
              subtitle={`Unidades por tienda al mes de ${activity.products.length ? "los productos de la actividad" : "todo el portafolio"}: ${BASELINE_MONTHS} meses antes contra los meses de vigencia. Las tiendas sin verificar no entran.`}
            />
            {!impact ? (
              <p className="px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">
                Todavía no hay sell-out de {activity.company.name} desde {fmtDate(activity.startDate)}.{" "}
                <Link href="/sell-out/importar" className="underline">Carga el reporte</Link> del mes para medirla.
              </p>
            ) : (
              <>
                <div className="px-4 py-3">
                  <LineChart
                    area={false}
                    format="number"
                    data={impact.periods.map((p) => ({
                      label: `${periodLabel(p.period)}${p.during ? " ●" : ""}`,
                      values: [Math.round(p.implemented * 10) / 10, Math.round(p.rest * 10) / 10],
                    }))}
                    series={[
                      { name: `Implementada (${impact.implemented.stores} tiendas)`, color: "var(--series-1)" },
                      { name: `Resto del cliente (${impact.rest.stores} tiendas)`, color: "var(--series-2)" },
                    ]}
                  />
                  <p className="mt-1 text-[11.5px] text-[var(--text-muted)]">● meses de vigencia con sell-out cargado ({impact.monthsMeasured}).</p>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 border-t border-[var(--border)] px-4 py-3 text-[12.5px]">
                  {([["Donde se implementó", impact.implemented], ["Resto del cliente", impact.rest]] as const).map(([label, g]) => (
                    <div key={label}>
                      <dt className="text-[11.5px] font-medium uppercase tracking-[0.04em] text-[var(--text-muted)]">{label}</dt>
                      <dd className="mt-0.5 tabular">
                        {g.stores
                          ? <>{fmtNumber(Math.round(g.baseline * 10) / 10)} → <strong>{fmtNumber(Math.round(g.during * 10) / 10)}</strong> u/tienda{g.change != null && <> ({fmtPct(g.change, 0)})</>}</>
                          : "Sin tiendas en este grupo"}
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Ejecución en tienda"
              subtitle={`${fmtNumber(c.total)} tiendas · lo que no se ha comprobado aparece primero`}
              action={canEdit && outside.length > 0 && <AddStores id={id} stores={outside} />}
            />
            <div className="px-4 pt-3">
              <Filters
                fields={[
                  { type: "select", name: "ejecucion", label: "Todos los resultados", options: TRADE_EXECUTION.options.map((o) => ({ value: o.value, label: o.label })), width: "w-52" },
                  { type: "select", name: "ciudad", label: "Todas las ciudades", options: cityRows.map(([k]) => ({ value: k, label: k })), width: "w-52" },
                ]}
              />
            </div>
            {executions.length === 0 ? (
              <p className="px-4 pb-8 pt-2 text-center text-[13px] text-[var(--text-muted)]">Ninguna tienda con este filtro.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
                {executions.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/tiendas/${e.store.id}`} className="truncate text-[13px] font-medium hover:text-[var(--brand)] hover:underline">
                          {e.store.name}
                        </Link>
                        <EnumBadge option={TRADE_EXECUTION.get(e.status)} dot />
                      </div>
                      <p className="text-[11.5px] text-[var(--text-muted)]">
                        {e.store.code} · {e.store.city}
                        {e.checkedAt ? ` · ${e.checkedBy?.name ?? "—"} el ${fmtDateTime(e.checkedAt)}` : ""}
                      </p>
                      {(e.notes || e.evidenceUrl) && (
                        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                          {e.notes}
                          {e.evidenceUrl && (
                            <a href={e.evidenceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--brand)] hover:underline">
                              <IconExternal size={12} /> Evidencia
                            </a>
                          )}
                        </p>
                      )}
                    </div>
                    {canCheck && (
                      <ExecutionControl id={e.id} status={e.status} notes={e.notes} evidenceUrl={e.evidenceUrl} canRemove={canEdit} />
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Pagination page={page} pageCount={pageCount(filtered, pageSize)} total={filtered} params={flatten(sp)} basePath={`/trade/${id}`} />
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="Lo pactado" />
            <dl className="grid grid-cols-2 gap-x-4 px-4 py-3">
              <div className="col-span-2">
                <KeyValue label="Mecánica">{activity.mechanic ?? <span className="text-[var(--text-muted)]">Sin detallar</span>}</KeyValue>
              </div>
              <KeyValue label="Inicio">{fmtDate(activity.startDate)}</KeyValue>
              <KeyValue label="Fin">{fmtDate(activity.endDate)}</KeyValue>
              <KeyValue label="Responsable">{activity.owner?.name ?? "—"}</KeyValue>
              <KeyValue label="Código">{activity.code}</KeyValue>
              {activity.description && (
                <div className="col-span-2">
                  <KeyValue label="Notas"><span className="whitespace-pre-line">{activity.description}</span></KeyValue>
                </div>
              )}
              {activity.closingNote && (
                <div className="col-span-2">
                  <KeyValue label="Aprendizaje al cerrar"><span className="whitespace-pre-line">{activity.closingNote}</span></KeyValue>
                </div>
              )}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Productos" subtitle={activity.products.length ? `${activity.products.length} en la actividad` : undefined} />
            {activity.products.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-[var(--text-secondary)]">Todo el portafolio.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {activity.products.map(({ product: p }) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2 text-[13px]">
                    <span className="truncate">{p.imageEmoji} {p.name}</span>
                    <span className="shrink-0 font-mono text-[11.5px] text-[var(--text-muted)]">{p.sku}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Por ciudad" subtitle="Implementadas sobre el total" />
            <ul className="flex flex-col">
              {cityRows.map(([name, row]) => (
                <li key={name} className="px-4 py-2">
                  <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                    <Link href={`/trade/${id}?ciudad=${encodeURIComponent(name)}`} className="truncate hover:text-[var(--brand)] hover:underline">{name}</Link>
                    <span className="shrink-0 tabular text-[var(--text-secondary)]">
                      {row.implemented} / {row.total}{row.pending ? ` · ${row.pending} por verificar` : ""}
                    </span>
                  </div>
                  <div className="mt-1">
                    <Meter value={row.implemented} max={row.total} color="var(--good)" height={5} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
