import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { periodKey } from "@/lib/analytics";
import {
  budgetConfig, budgetYears, clientActuals, clientBudget, clientShares, generalBudget, selectionFor, subtotals, sumLines, yearMonths, type Lines,
} from "@/lib/budget";
import { CHANNELS } from "@/lib/enums";
import { fmtCompact, fmtPct } from "@/lib/format";
import { many, one, type SearchParams } from "@/lib/params";
import { Badge, Card, CardHeader, EnumBadge, PageHeader, StatTile } from "@/components/ui";
import { Filters } from "@/components/filters";
import { GroupedBarChart } from "@/components/charts";
import { IconSales, IconTarget } from "@/components/icons";
import { GerenciaTabs } from "../tabs";
import { Attainment, BudgetTabs, Deviation, StatementTable, clientLink, pp, thresholdsOf } from "./shared";

export const metadata = { title: "Presupuesto: resultados" };
export const dynamic = "force-dynamic";

export default async function PresupuestoPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection("gerencia");
  const sp = await searchParams;
  const now = new Date();
  const year = Number(one(sp.anio)) || now.getFullYear();
  const config = await budgetConfig();
  const { rubros, settings } = config;
  const t = thresholdsOf(settings);
  const selection = selectionFor(year, one(sp.periodo), settings.defaultPeriod, now);
  const clientIds = many(sp.cliente);
  const channelKeys = many(sp.canal);
  const filtered = clientIds.length > 0 || channelKeys.length > 0;
  const months = yearMonths(year);
  const current = periodKey(now);
  const st = (l: Lines) => subtotals(l, rubros);

  const [years, general, shares, actuals, companies] = await Promise.all([
    budgetYears(now),
    generalBudget(year, rubros),
    clientShares(year),
    clientActuals(months.map((m) => m.period).filter((p) => p <= current), config),
    prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, channel: true, active: true } }),
  ]);

  const periods = selection.periods;
  const realOf = (id: string, ps = periods) => sumLines(ps.map((p) => actuals.byClient.get(id)?.get(p)));
  const totalRealSales = companies.reduce((s, c) => s + st(realOf(c.id)).sales, 0);
  const totalRealNet = companies.reduce((s, c) => s + st(realOf(c.id)).net, 0);

  const rowFor = (id: string) => {
    const real = realOf(id);
    return {
      budget: clientBudget(general.byPeriod, shares.get(id), periods, rubros),
      real,
      shareBudget: shares.get(id)?.base ?? 0,
      shareReal: totalRealSales > 0 ? (st(real).sales / totalRealSales) * 100 : 0,
    };
  };
  const clients = companies
    .filter((c) => (!clientIds.length || clientIds.includes(c.id)) && (!channelKeys.length || channelKeys.includes(c.channel)))
    .map((c) => ({ company: c, ...rowFor(c.id) }))
    .filter((r) => shares.has(r.company.id) || Math.round(st(r.real).sales) !== 0)
    .sort((a, b) => st(b.budget).sales - st(a.budget).sales || st(b.real).sales - st(a.real).sales);

  // Sin filtros el todo es el presupuesto general contra la contabilidad; con filtros, la suma de los clientes elegidos.
  const scopeBudget = filtered ? sumLines(clients.map((c) => c.budget)) : sumLines(periods.map((p) => general.byPeriod.get(p)));
  const scopeReal = filtered ? sumLines(clients.map((c) => c.real)) : sumLines(periods.map((p) => actuals.statement.get(p)));
  const sb = st(scopeBudget);
  const sr = st(scopeReal);
  const missing = actuals.missing.filter((p) => periods.includes(p));

  const channels = CHANNELS.options
    .map((o) => {
      const rows = companies.filter((c) => c.channel === o.value).map((c) => rowFor(c.id));
      return {
        option: o,
        budget: st(sumLines(rows.map((r) => r.budget))),
        real: st(sumLines(rows.map((r) => r.real))),
        shareBudget: rows.reduce((s, r) => s + r.shareBudget, 0),
        shareReal: rows.reduce((s, r) => s + r.shareReal, 0),
      };
    })
    .filter((c) => c.shareBudget > 0 || Math.round(c.real.sales) !== 0);

  const series = months.map((m) => {
    const b = filtered ? sumLines(clients.map((c) => clientBudget(general.byPeriod, shares.get(c.company.id), [m.period], rubros))) : (general.byPeriod.get(m.period) ?? {});
    const r = filtered ? sumLines(clients.map((c) => realOf(c.company.id, [m.period]))) : (actuals.statement.get(m.period) ?? {});
    return { label: m.label, b: st(b), r: st(r) };
  });

  const isYear = selection.kind === "ANIO";
  const keepPeriod = one(sp.periodo) ? `&periodo=${one(sp.periodo)}` : "";
  const scopeLabel = filtered
    ? clients.length === 1
      ? clients[0].company.name
      : `${clients.length} clientes${channelKeys.length ? ` · ${channelKeys.map((k) => CHANNELS.label(k)).join(", ")}` : ""}`
    : "Todo el negocio";
  const pctOf = (v: number, base: number) => (base ? (v / base) * 100 : 0);

  return (
    <>
      <PageHeader
        title="Presupuesto"
        subtitle="El presupuesto general, la parte que le toca a cada cliente y lo que de verdad dejó cada uno dentro del todo."
      />
      <GerenciaTabs active="/gerencia/presupuesto" />
      <BudgetTabs active="/gerencia/presupuesto" year={year} />

      <Filters
        fields={[
          { type: "select", name: "anio", label: `Año ${now.getFullYear()}`, options: years.map((y) => ({ value: String(y), label: `Año ${y}` })), width: "w-32" },
          {
            type: "select",
            name: "periodo",
            label: settings.defaultPeriod === "ANIO" ? "Año completo" : "Acumulado a la fecha",
            width: "w-48",
            options: [
              { value: "acumulado", label: "Acumulado a la fecha" },
              { value: "anio", label: "Año completo" },
              ...months.map((m) => ({ value: m.period, label: `Mes: ${m.label} ${year}` })),
            ],
          },
          { type: "select", name: "canal", label: "Todos los canales", options: CHANNELS.options.map((o) => ({ value: o.value, label: o.label })), multi: true },
          { type: "select", name: "cliente", label: "Todos los clientes", options: companies.map((c) => ({ value: c.id, label: c.name })), multi: true },
        ]}
      />

      {general.byPeriod.size === 0 && (
        <p className="card mb-4 px-4 py-3 text-[13px]">
          No hay presupuesto general para {year}.{" "}
          <Link href={`/gerencia/presupuesto/general?anio=${year}`} className="font-medium text-[var(--brand)] hover:underline">Cárgalo</Link> y luego reparte la{" "}
          <Link href={`/gerencia/presupuesto/participacion?anio=${year}`} className="font-medium text-[var(--brand)] hover:underline">participación de cada cliente</Link>.
        </p>
      )}

      <p className="mb-3 text-[12.5px] text-[var(--text-muted)]">
        <strong className="text-[var(--text-secondary)]">{scopeLabel}</strong> · {selection.label}
        {isYear && " · el real llega hasta hoy: se lee como avance del año"}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Ingresos netos"
          value={fmtCompact(sr.sales)}
          hint={sb.sales ? <><Attainment real={sr.sales} budget={sb.sales} t={t} /> de {fmtCompact(sb.sales)}</> : "Sin presupuesto"}
          icon={<IconSales size={15} />}
        />
        <StatTile
          label="Ganancia bruta"
          value={fmtCompact(sr.grossProfit)}
          hint={sb.sales ? `${fmtPct(pctOf(sr.grossProfit, sr.sales))} · ${pp(pctOf(sr.grossProfit, sr.sales) - pctOf(sb.grossProfit, sb.sales))} vs ppto.` : undefined}
        />
        <StatTile
          label="Contribución"
          value={fmtCompact(sr.contribution)}
          hint={sb.sales ? <>Ppto. {fmtCompact(sb.contribution)} · <Attainment real={sr.contribution} budget={sb.contribution} t={t} /></> : "Tras los gastos comerciales atribuibles"}
          icon={<IconTarget size={15} />}
        />
        <StatTile
          label="Ganancia (pérdida)"
          value={fmtCompact(sr.net)}
          hint={sb.sales ? <>Ppto. {fmtCompact(sb.net)} · <Attainment real={sr.net} budget={sb.net} t={t} /></> : undefined}
        />
      </div>
      {missing.length > 0 && (
        <p className="mt-2 text-[12px] text-[var(--text-muted)]">
          Sin estado de resultados cargado en {missing.length === 1 ? "un mes" : `${missing.length} meses`} del período: {filtered ? "los rubros repartidos" : "el real del negocio"} de esos meses queda en cero.{" "}
          <Link href="/gerencia/resultados/cargar" className="text-[var(--brand)] hover:underline">Cargarlo</Link>
        </p>
      )}
      {general.unmapped.length > 0 && (
        <p className="mt-2 text-[12px] text-[var(--warning)]">
          {general.unmapped.length} cuentas del presupuesto no caen en ningún rubro y no se cuentan: {general.unmapped.slice(0, 4).join(", ")}.{" "}
          <Link href={`/gerencia/presupuesto/configuracion?anio=${year}`} className="text-[var(--brand)] hover:underline">Revisar rubros</Link>
        </p>
      )}

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Ingresos netos" subtitle={`Presupuesto contra real, ${year}`} />
          <div className="px-4 py-4">
            <GroupedBarChart
              data={series.map((s) => ({ label: s.label, values: [s.b.sales, s.r.sales] }))}
              series={[{ name: "Presupuesto", color: "var(--series-1)" }, { name: "Real", color: "var(--series-2)" }]}
              format="compact"
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Contribución" subtitle="Ganancia bruta menos los gastos comerciales atribuibles" />
          <div className="px-4 py-4">
            <GroupedBarChart
              data={series.map((s) => ({ label: s.label, values: [s.b.contribution, s.r.contribution] }))}
              series={[{ name: "Presupuesto", color: "var(--series-1)" }, { name: "Real", color: "var(--series-2)" }]}
              format="compact"
            />
          </div>
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] items-start gap-4">
        <Card>
          <CardHeader
            title="Estado de resultados"
            subtitle={filtered ? "Presupuesto de los clientes elegidos contra su real; los rubros repartidos se asignan con la base de la configuración." : "Presupuesto general contra el estado de resultados de la contabilidad."}
          />
          <StatementTable budget={scopeBudget} real={scopeReal} rubros={rubros} t={t} />
        </Card>

        <Card>
          <CardHeader title="Por canal" subtitle="Peso de cada canal en la venta y lo que aporta a la ganancia total de los clientes" />
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Canal</th>
                  <th className="num">Part. ppto.</th>
                  <th className="num">Part. real</th>
                  <th className="num">Ingresos real</th>
                  <th className="num">Cumpl.</th>
                  <th className="num">Contribución</th>
                  <th className="num">Ganancia</th>
                  <th className="num">Aporte</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c.option.value}>
                    <td>
                      <Link href={`/gerencia/presupuesto?anio=${year}${keepPeriod}&canal=${c.option.value}`} className="hover:underline">
                        <EnumBadge option={c.option} />
                      </Link>
                    </td>
                    <td className="num text-[var(--text-secondary)]">{fmtPct(c.shareBudget)}</td>
                    <td className="num">{fmtPct(c.shareReal)}</td>
                    <td className="num font-semibold">{fmtCompact(c.real.sales)}</td>
                    <td className="num"><Attainment real={c.real.sales} budget={c.budget.sales} t={t} /></td>
                    <td className="num">{fmtCompact(c.real.contribution)}</td>
                    <td className="num" style={c.real.net < 0 ? { color: "var(--critical)" } : undefined}>{fmtCompact(c.real.net)}</td>
                    <td className="num">{totalRealNet ? fmtPct((c.real.net / totalRealNet) * 100) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader
          title="Rendimiento por cliente"
          subtitle="Participación presupuestada contra la real en la venta, y lo que deja cada cliente frente a lo que le tocaba. Aporte: su parte de la ganancia total de los clientes."
        />
        {clients.length ? (
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th className="num">Part. ppto.</th>
                  <th className="num">Part. real</th>
                  <th className="num">Δ</th>
                  <th className="num">Ingresos ppto.</th>
                  <th className="num">Ingresos real</th>
                  <th className="num">Cumpl.</th>
                  <th className="num">Contribución</th>
                  <th className="num">vs ppto.</th>
                  <th className="num">Ganancia</th>
                  <th className="num">vs ppto.</th>
                  <th className="num">Aporte</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => {
                  const b = st(c.budget);
                  const r = st(c.real);
                  return (
                    <tr key={c.company.id}>
                      <td>
                        <Link href={clientLink(c.company.id, year, one(sp.periodo) || undefined)} className="font-medium hover:text-[var(--brand)] hover:underline">
                          {c.company.name}
                        </Link>
                        {!shares.has(c.company.id) && <Badge tone="warning" className="ml-2">Sin participación</Badge>}
                        <span className="block text-[11.5px] text-[var(--text-muted)]">{CHANNELS.label(c.company.channel)}</span>
                      </td>
                      <td className="num text-[var(--text-secondary)]">{c.shareBudget ? fmtPct(c.shareBudget) : "—"}</td>
                      <td className="num">{fmtPct(c.shareReal)}</td>
                      <td className="num whitespace-nowrap text-[var(--text-secondary)]">{c.shareBudget ? pp(c.shareReal - c.shareBudget) : "—"}</td>
                      <td className="num text-[var(--text-secondary)]">{b.sales ? fmtCompact(b.sales) : "—"}</td>
                      <td className="num font-semibold">{fmtCompact(r.sales)}</td>
                      <td className="num"><Attainment real={r.sales} budget={b.sales} t={t} /></td>
                      <td className="num">{fmtCompact(r.contribution)}</td>
                      <td className="num">{b.sales ? <Deviation value={r.contribution - b.contribution} format={fmtCompact} /> : "—"}</td>
                      <td className="num font-semibold" style={r.net < 0 ? { color: "var(--critical)" } : undefined}>{fmtCompact(r.net)}</td>
                      <td className="num">{b.sales ? <Deviation value={r.net - b.net} format={fmtCompact} /> : "—"}</td>
                      <td className="num">{totalRealNet ? fmtPct((r.net / totalRealNet) * 100) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">Ningún cliente con participación ni venta en el período con estos filtros.</p>
        )}
        {actuals.uncosted > 0 && (
          <p className="border-t border-[var(--border)] px-4 py-2.5 text-[12px] text-[var(--text-muted)]">
            {fmtCompact(actuals.uncosted)} facturados en {year} sin pedido asociado suman a los ingresos pero no tienen costo: su ganancia bruta sale inflada.
          </p>
        )}
      </Card>
    </>
  );
}
