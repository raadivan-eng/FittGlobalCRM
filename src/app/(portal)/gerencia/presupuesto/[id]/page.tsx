import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { periodKey } from "@/lib/analytics";
import {
  budgetConfig, budgetYears, clientActuals, clientBudget, clientShares, generalBudget, selectionFor, shareIn, subtotals, sumLines, yearMonths, type Lines,
} from "@/lib/budget";
import { CHANNELS } from "@/lib/enums";
import { fmtCompact, fmtMoney, fmtPct } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";
import { Card, CardHeader, EnumBadge, PageHeader, StatTile } from "@/components/ui";
import { GroupedBarChart } from "@/components/charts";
import { IconSales, IconTarget } from "@/components/icons";
import { Attainment, Deviation, StatementTable, pp, thresholdsOf } from "../shared";
import { YearSelect } from "../year-select";

export const metadata = { title: "Presupuesto del cliente" };
export const dynamic = "force-dynamic";

export default async function ClientBudgetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await requireSection("gerencia");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const now = new Date();
  const year = Number(one(sp.anio)) || now.getFullYear();
  const config = await budgetConfig();
  const { rubros, settings } = config;
  const t = thresholdsOf(settings);
  const selection = selectionFor(year, one(sp.periodo), settings.defaultPeriod, now);
  const months = yearMonths(year);
  const current = periodKey(now);
  const st = (l: Lines) => subtotals(l, rubros);

  const [company, years, general, shares, actuals] = await Promise.all([
    prisma.company.findUnique({ where: { id }, select: { id: true, name: true, channel: true, owner: { select: { name: true } } } }),
    budgetYears(now),
    generalBudget(year, rubros),
    clientShares(year),
    clientActuals(months.map((m) => m.period).filter((p) => p <= current), config),
  ]);
  if (!company) notFound();

  const share = shares.get(id);
  const realOf = (companyId: string, ps: string[]) => sumLines(ps.map((p) => actuals.byClient.get(companyId)?.get(p)));
  const budget = clientBudget(general.byPeriod, share, selection.periods, rubros);
  const real = realOf(id, selection.periods);
  const sb = st(budget);
  const sr = st(real);

  // Su peso dentro del todo: venta de todos los clientes y ganancia sumada de todos.
  let allSales = 0;
  let allNet = 0;
  for (const companyId of actuals.byClient.keys()) {
    const r = st(realOf(companyId, selection.periods));
    allSales += r.sales;
    allNet += r.net;
  }
  const realShare = allSales ? (sr.sales / allSales) * 100 : 0;

  const monthly = months.map((m) => ({
    ...m,
    budget: st(share ? clientBudget(general.byPeriod, share, [m.period], rubros) : {}),
    real: m.period <= current ? st(realOf(id, [m.period])) : null,
  }));
  const periodQuery = selection.key;

  return (
    <>
      <PageHeader
        title={company.name}
        subtitle={<>Su parte del presupuesto general {year} contra lo que de verdad dejó · <EnumBadge option={CHANNELS.get(company.channel)} />{company.owner ? ` · ${company.owner.name}` : ""}</>}
        breadcrumb={[{ label: "Gerencia", href: "/gerencia" }, { label: "Presupuesto", href: `/gerencia/presupuesto?anio=${year}` }, { label: company.name }]}
        actions={
          <>
            <YearSelect years={years} year={year} keep={{ periodo: one(sp.periodo) }} />
            <Link href={`/clientes/${company.id}`} className="btn btn-secondary">Ficha del cliente</Link>
          </>
        }
      />

      <nav className="mb-4 flex flex-wrap gap-1.5 text-[12.5px]">
        {[{ key: "acumulado", label: "Acumulado" }, { key: "anio", label: "Año completo" }, ...months.map((m) => ({ key: m.period, label: m.label }))].map((o) => (
          <Link
            key={o.key}
            href={`/gerencia/presupuesto/${id}?anio=${year}&periodo=${o.key}`}
            className={`btn ${periodQuery === o.key ? "btn-secondary" : "btn-ghost"} !px-2 !py-0.5 ${/^\d/.test(o.key) ? "capitalize" : ""}`}
          >
            {o.label}
          </Link>
        ))}
      </nav>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Participación en la venta"
          value={fmtPct(realShare)}
          hint={share ? `${pp(realShare - share.base)} vs ${fmtPct(share.base)} presupuestada` : "Sin participación en el presupuesto"}
          icon={<IconTarget size={15} />}
        />
        <StatTile
          label="Ingresos netos"
          value={fmtCompact(sr.sales)}
          hint={sb.sales ? <><Attainment real={sr.sales} budget={sb.sales} t={t} /> de {fmtCompact(sb.sales)}</> : selection.label}
          icon={<IconSales size={15} />}
        />
        <StatTile label="Contribución" value={fmtCompact(sr.contribution)} hint={sb.sales ? <>Ppto. {fmtCompact(sb.contribution)} · <Attainment real={sr.contribution} budget={sb.contribution} t={t} /></> : "Tras los gastos comerciales atribuibles"} />
        <StatTile
          label="Ganancia (pérdida)"
          value={fmtCompact(sr.net)}
          hint={allNet ? `${fmtPct((sr.net / allNet) * 100)} de la ganancia de los clientes` : undefined}
        />
      </div>

      <Card className="mt-5">
        <CardHeader title={`Estado de resultados · ${selection.label}`} subtitle="Los rubros marcados «repartido» son su parte de lo que reporta la contabilidad, con la base de reparto de la configuración." />
        <StatementTable budget={budget} real={real} rubros={rubros} t={t} />
      </Card>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Ingresos netos" subtitle={`Presupuesto contra real, ${year}`} />
          <div className="px-4 py-4">
            <GroupedBarChart
              data={monthly.map((m) => ({ label: m.label, values: [m.budget.sales, m.real?.sales ?? 0] }))}
              series={[{ name: "Presupuesto", color: "var(--series-1)" }, { name: "Real", color: "var(--series-2)" }]}
              format="compact"
            />
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Participación presupuestada"
            action={<Link href={`/gerencia/presupuesto/participacion?anio=${year}`} className="btn btn-ghost !px-2 text-[12.5px]">Editar</Link>}
          />
          {share ? (
            <ul className="grid grid-cols-1 gap-x-6 px-4 py-3 text-[12.5px] sm:grid-cols-2">
              {rubros.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-3 py-1">
                  <span className="text-[var(--text-secondary)]">{r.label}</span>
                  <span className={`tabular ${r.source !== "VENTAS" && share.overrides[r.key] != null ? "font-semibold" : ""}`}>{fmtPct(shareIn(share, r), 2)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">Este cliente no tiene participación en el presupuesto {year}.</p>
          )}
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Mes a mes" subtitle="Lo que le tocaba al cliente en cada mes contra lo que dejó" />
        <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th>Mes</th>
                <th className="num">Ingresos ppto.</th>
                <th className="num">Ingresos real</th>
                <th className="num">Cumpl.</th>
                <th className="num">Contribución ppto.</th>
                <th className="num">Contribución real</th>
                <th className="num">Ganancia ppto.</th>
                <th className="num">Ganancia real</th>
                <th className="num">Desviación</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m) => (
                <tr key={m.period}>
                  <td>
                    <span className="font-medium capitalize">{m.label}</span>
                    {m.period === current && <span className="ml-1.5 text-[11px] text-[var(--text-muted)]">en curso</span>}
                  </td>
                  <td className="num text-[var(--text-secondary)]">{m.budget.sales ? fmtMoney(m.budget.sales) : "—"}</td>
                  <td className="num font-semibold">{m.real ? fmtMoney(m.real.sales) : "—"}</td>
                  <td className="num">{m.real && m.period < current ? <Attainment real={m.real.sales} budget={m.budget.sales} t={t} /> : "—"}</td>
                  <td className="num text-[var(--text-secondary)]">{m.budget.sales ? fmtMoney(m.budget.contribution) : "—"}</td>
                  <td className="num">{m.real ? fmtMoney(m.real.contribution) : "—"}</td>
                  <td className="num text-[var(--text-secondary)]">{m.budget.sales ? fmtMoney(m.budget.net) : "—"}</td>
                  <td className="num font-semibold" style={m.real && m.real.net < 0 ? { color: "var(--critical)" } : undefined}>{m.real ? fmtMoney(m.real.net) : "—"}</td>
                  <td className="num">{m.real && m.budget.sales && m.period < current ? <Deviation value={m.real.net - m.budget.net} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {actuals.missing.length > 0 && (
          <p className="border-t border-[var(--border)] px-4 py-2.5 text-[12px] text-[var(--text-muted)]">
            Los meses sin estado de resultados cargado no le reparten los rubros repartidos: su ganancia sale igual a la contribución.
          </p>
        )}
      </Card>
    </>
  );
}
