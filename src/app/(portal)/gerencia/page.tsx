import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { expiryReport, startOfMonth } from "@/lib/analytics";
import {
  AGING_BUCKETS, MIN_MARGIN_PCT, costToServe, grossMargin, groupLines, marginBridge, marginFacts, marginPct,
  monthlyMargin, netSales, receivablesAging, totalsBetween, workingCapital,
} from "@/lib/management";
import { fmtCompact, fmtNumber, fmtPct } from "@/lib/format";
import { netOfCredits, one, type SearchParams } from "@/lib/params";
import { CreditNotesSelect } from "@/components/filters";
import { Badge, Card, CardHeader, PageHeader, StatTile } from "@/components/ui";
import { CompositionBar, GroupedBarChart, LineChart, RankingBars } from "@/components/charts";
import { IconAlert, IconArrowRight, IconCart, IconExpiry, IconSales, IconTarget } from "@/components/icons";
import { GerenciaTabs } from "./tabs";

export const metadata = { title: "Tablero gerencial" };
export const dynamic = "force-dynamic";

/** Sólo meses cerrados: comparar un mes a medias contra uno completo siempre sale a la baja. */
const WINDOWS = [
  { key: "1", label: "Último mes cerrado", months: 1 },
  { key: "3", label: "Últimos 3 meses cerrados", months: 3 },
  { key: "6", label: "Últimos 6 meses cerrados", months: 6 },
];

const change = (curr: number, prev: number) => (prev ? ((curr - prev) / Math.abs(prev)) * 100 : null);
const pp = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1).replace(".", ",")} pp`;

export default async function GerenciaPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection("gerencia");
  const sp = await searchParams;
  const win = WINDOWS.find((w) => w.key === one(sp.rango)) ?? WINDOWS[0];
  const withCredits = netOfCredits(sp);

  const now = new Date();
  const curr = { from: startOfMonth(-win.months, now), to: startOfMonth(0, now) };
  const prev = { from: startOfMonth(-2 * win.months, now), to: curr.from };
  // Una sola lectura cubre el período anterior y los doce meses del gráfico.
  const factsFrom = prev.from < startOfMonth(-11, now) ? prev.from : startOfMonth(-11, now);

  const [facts, serve, aging, capital, expiry, companies, products] = await Promise.all([
    marginFacts(factsFrom, startOfMonth(1, now), withCredits),
    costToServe(curr.from, curr.to),
    receivablesAging(),
    workingCapital(),
    expiryReport(30),
    prisma.company.findMany({ select: { id: true, name: true } }),
    prisma.product.findMany({ select: { id: true, name: true, imageEmoji: true } }),
  ]);
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const productById = new Map(products.map((p) => [p.id, p]));

  const t1 = totalsBetween(facts, curr.from, curr.to);
  const t0 = totalsBetween(facts, prev.from, prev.to);
  const sales1 = netSales(t1);
  const margin1 = grossMargin(t1);
  const pct1 = marginPct(t1);
  const pct0 = marginPct(t0);
  const costSource =
    t1.booked === t1.months ? "Costo del estado de resultados" :
    t1.booked ? `Costo contable en ${t1.booked} de ${t1.months} meses` : "Costo de los productos";

  const freightTotal = [...serve.freight.values()].reduce((s, v) => s + v, 0);
  const tradeTotal = [...serve.trade.values()].reduce((s, v) => s + v, 0);
  const contribution = margin1 - freightTotal - tradeTotal;

  const series = monthlyMargin(facts, 12);
  const bridge = marginBridge(facts, prev, curr);
  const bridgeMax = Math.max(1, ...bridge.steps.map((s) => Math.abs(s.value)));

  // Clientes: margen bruto menos lo que cuesta atenderlos.
  const credits = new Map<string, number>();
  for (const c of facts.credits) if (c.issueDate >= curr.from && c.issueDate < curr.to) credits.set(c.companyId, (credits.get(c.companyId) ?? 0) + c.net);
  const clientRows = [...groupLines(facts, curr.from, curr.to, (l) => l.companyId).entries()]
    .map(([id, a]) => {
      const revenue = a.revenue - (credits.get(id) ?? 0);
      const margin = revenue - a.cost;
      const toServe = (serve.freight.get(id) ?? 0) + (serve.trade.get(id) ?? 0);
      return {
        id,
        name: companyById.get(id)?.name ?? "—",
        revenue,
        marginPct: revenue > 0 ? (margin / revenue) * 100 : 0,
        toServe,
        contribution: margin - toServe,
        contributionPct: revenue > 0 ? ((margin - toServe) / revenue) * 100 : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
  const lowClients = clientRows.filter((c) => c.marginPct < MIN_MARGIN_PCT);

  const categoryRows = [...groupLines(facts, curr.from, curr.to, (l) => l.category).entries()]
    .map(([label, a]) => ({ label, value: a.revenue > 0 ? ((a.revenue - a.cost) / a.revenue) * 100 : 0, sub: fmtCompact(a.revenue) }))
    .sort((a, b) => b.value - a.value);

  const lowProducts = [...groupLines(facts, curr.from, curr.to, (l) => l.productId).entries()]
    .map(([id, a]) => ({ id, ...a, pct: a.revenue > 0 ? ((a.revenue - a.cost) / a.revenue) * 100 : 0 }))
    .filter((p) => p.revenue > 0 && p.pct < MIN_MARGIN_PCT)
    .sort((a, b) => a.pct - b.pct);

  // Capital de trabajo.
  const openBalance = [...aging.buckets.values()].reduce((s, v) => s + v, 0);
  const overdue = openBalance - (aging.buckets.get("AL_DIA") ?? 0);
  const over60 = aging.buckets.get("D60_MAS") ?? 0;
  const dailyCost = t1.cost / Math.max(1, (curr.to.getTime() - curr.from.getTime()) / 86_400_000);
  const inventoryDays = dailyCost > 0 ? capital.inventory / dailyCost : null;
  const severeDebtors = aging.debtors.filter((d) => d.oldestDays > 60);

  const attention = [
    {
      label: "Clientes con mora de más de 60 días",
      count: severeDebtors.length,
      detail: fmtCompact(over60),
      href: "/ventas?vista=facturas&estado=VENCIDA",
    },
    {
      label: `Clientes con margen bajo el ${MIN_MARGIN_PCT} %`,
      count: lowClients.length,
      detail: fmtCompact(lowClients.reduce((s, c) => s + c.revenue, 0)),
      href: "#clientes",
    },
    {
      label: `Productos con margen bajo el ${MIN_MARGIN_PCT} %`,
      count: lowProducts.length,
      detail: fmtCompact(lowProducts.reduce((s, p) => s + p.revenue, 0)),
      href: "#productos",
    },
    {
      label: "Lotes vencidos o que vencen en 30 días",
      count: expiry.atRisk.length,
      detail: fmtCompact(expiry.riskValue),
      href: "/inventario",
    },
    {
      label: "Órdenes de compra con llegada atrasada",
      count: capital.lateOrders,
      detail: `de ${fmtNumber(capital.openOrders)} abiertas`,
      href: "/ordenes-compra",
    },
  ];

  return (
    <>
      <PageHeader
        title="Tablero gerencial"
        subtitle="Hacia dónde va el negocio: cuánto deja lo que se vende, qué lo explica y dónde está la plata inmovilizada."
        actions={
          <form className="flex items-center gap-2">
            <select name="rango" defaultValue={win.key} className="field w-56">
              {WINDOWS.map((w) => (
                <option key={w.key} value={w.key}>{w.label}</option>
              ))}
            </select>
            <CreditNotesSelect net={withCredits} />
            <button className="btn btn-secondary">Aplicar</button>
          </form>
        }
      />
      <GerenciaTabs active="/gerencia" />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Venta neta" value={fmtCompact(sales1)} delta={change(sales1, netSales(t0))} hint={withCredits ? "Menos notas crédito · vs período anterior" : "Sin descontar notas crédito · vs período anterior"} icon={<IconSales size={15} />} />
        <StatTile label="Margen bruto" value={fmtCompact(margin1)} delta={change(margin1, grossMargin(t0))} hint={`${costSource} · vs período anterior`} icon={<IconTarget size={15} />} />
        <StatTile label="Margen bruto %" value={fmtPct(pct1)} hint={`${pp(pct1 - pct0)} vs anterior · mínimo ${MIN_MARGIN_PCT} %`} />
        <StatTile label="Margen de contribución" value={fmtCompact(contribution)} hint={`Tras ${fmtCompact(freightTotal)} en fletes y ${fmtCompact(tradeTotal)} en trade`} />
      </div>
      {t1.uncosted > 0 && (
        <p className="mt-2 text-[12px] text-[var(--text-muted)]">
          {fmtCompact(t1.uncosted)} de facturación sin pedido asociado entran en la venta neta pero no en el margen: no hay renglones que costear.
        </p>
      )}

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Venta neta y margen bruto" subtitle="Últimos doce meses, el actual en curso" />
          <div className="px-4 py-4">
            <GroupedBarChart
              data={series.map((s) => ({ label: s.label, values: [s.sales, s.margin] }))}
              series={[
                { name: "Venta neta", color: "var(--series-1)" },
                { name: "Margen bruto", color: "var(--series-2)" },
              ]}
              format="compact"
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Margen bruto %" subtitle={`Con el costo de ventas contable en los meses cargados · el mínimo es ${MIN_MARGIN_PCT} %`} />
          <div className="px-4 py-4">
            <LineChart
              data={series.map((s) => ({ label: s.label, values: [s.pct] }))}
              series={[{ name: "Margen bruto %", color: "var(--series-1)" }]}
              format="percent"
              area={false}
            />
          </div>
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader
            title="¿Por qué cambió el margen?"
            subtitle={`Margen bruto de ${fmtCompact(bridge.before)} a ${fmtCompact(bridge.after)} frente al período anterior`}
          />
          <ul className="divide-y divide-[var(--border)]">
            {bridge.steps.map((s) => {
              const width = `${(Math.abs(s.value) / bridgeMax) * 50}%`;
              const positive = s.value >= 0;
              return (
                <li key={s.label} className="grid grid-cols-[9.5rem_1fr_6rem] items-center gap-3 px-4 py-3">
                  <span className="text-[13px] font-medium">{s.label}</span>
                  <div className="relative h-2.5 rounded-full bg-[var(--surface-3)]">
                    <span className="absolute inset-y-[-3px] left-1/2 w-px bg-[var(--border-strong)]" />
                    <span
                      className="absolute inset-y-0 rounded-full"
                      style={{ width, background: positive ? "var(--good)" : "var(--critical)", ...(positive ? { left: "50%" } : { right: "50%" }) }}
                    />
                  </div>
                  <span className="text-right text-[13px] font-semibold tabular" style={{ color: positive ? "var(--good)" : "var(--critical)" }}>
                    {positive ? "+" : "−"}{fmtCompact(Math.abs(s.value))}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-[var(--border)] px-4 py-3 text-[12px] text-[var(--text-muted)]">
            Volumen, precio y mezcla usan el costo promedio de los lotes, igual en ambos períodos; el costo contable recoge la diferencia con el estado de resultados.
          </p>
        </Card>

        <Card>
          <CardHeader title="Puntos de atención" subtitle="Lo que pide una decisión esta semana" />
          <ul className="divide-y divide-[var(--border)]">
            {attention.map((a) => (
              <li key={a.label}>
                <Link href={a.href} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-2)]">
                  <span
                    className="w-8 shrink-0 text-[18px] font-semibold tabular"
                    style={{ color: a.count > 0 ? "var(--critical)" : "var(--text-muted)" }}
                  >
                    {a.count}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">{a.label}</span>
                    <span className="block text-[12px] text-[var(--text-muted)]">{a.detail}</span>
                  </span>
                  <IconArrowRight size={14} className="shrink-0 text-[var(--text-muted)]" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-5">
        <div id="clientes" className="scroll-mt-20" />
        <CardHeader
          title="Rentabilidad por cliente"
          subtitle="Margen bruto con el costo de cada producto, menos fletes y trade del período: el estado de resultados no se abre por cliente"
        />
        <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th>Cliente</th>
                <th className="num">Venta neta</th>
                <th className="num">Margen bruto</th>
                <th className="num">Fletes y trade</th>
                <th className="num">Contribución</th>
                <th className="num">Contribución %</th>
              </tr>
            </thead>
            <tbody>
              {clientRows.slice(0, 15).map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/clientes/${c.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">{c.name}</Link>
                    {c.marginPct < MIN_MARGIN_PCT && <Badge tone="danger" className="ml-2">Bajo el mínimo</Badge>}
                  </td>
                  <td className="num">{fmtCompact(c.revenue)}</td>
                  <td className="num">{fmtPct(c.marginPct)}</td>
                  <td className="num text-[var(--text-secondary)]">{c.toServe > 0 ? fmtCompact(c.toServe) : "—"}</td>
                  <td className="num font-semibold">{fmtCompact(c.contribution)}</td>
                  <td className="num">{fmtPct(c.contributionPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {clientRows.length > 15 && (
          <p className="border-t border-[var(--border)] px-4 py-2.5 text-[12px] text-[var(--text-muted)]">
            Los 15 clientes de mayor venta de {fmtNumber(clientRows.length)} con facturación en el período.
          </p>
        )}
      </Card>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Margen bruto por categoría" subtitle="Porcentaje sobre la venta de cada categoría en el período" />
          <RankingBars items={categoryRows} format="percent" />
        </Card>
        <Card>
          <div id="productos" className="scroll-mt-20" />
          <CardHeader title={`Productos bajo el ${MIN_MARGIN_PCT} % de margen`} subtitle="Candidatos a revisar precio de venta o condición de compra" />
          {lowProducts.length ? (
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="num">Unidades</th>
                    <th className="num">Venta</th>
                    <th className="num">Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {lowProducts.slice(0, 12).map((p) => {
                    const product = productById.get(p.id);
                    return (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/productos/${p.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                            {product ? `${product.imageEmoji} ${product.name}` : "—"}
                          </Link>
                        </td>
                        <td className="num">{fmtNumber(p.units)}</td>
                        <td className="num">{fmtCompact(p.revenue)}</td>
                        <td className="num font-semibold" style={{ color: p.pct < 0 ? "var(--critical)" : undefined }}>{fmtPct(p.pct)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">Todos los productos vendidos en el período superan el mínimo.</p>
          )}
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-[15px] font-semibold">Capital de trabajo</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Cartera abierta" value={fmtCompact(openBalance)} hint={`${fmtCompact(overdue)} vencida`} icon={<IconAlert size={15} />} href="/ventas?vista=facturas" />
        <StatTile
          label="Cartera vencida"
          value={openBalance ? fmtPct((overdue / openBalance) * 100) : "—"}
          hint={`${fmtCompact(over60)} con más de 60 días`}
        />
        <StatTile
          label="Inventario valorizado"
          value={fmtCompact(capital.inventory)}
          hint={inventoryDays != null ? `${fmtNumber(Math.round(inventoryDays))} días de venta al costo` : "Sin venta en el período"}
          icon={<IconExpiry size={15} />}
          href="/inventario"
        />
        <StatTile
          label="Compras comprometidas"
          value={fmtCompact(capital.committed)}
          hint={`${fmtNumber(capital.openOrders)} órdenes emitidas sin recibir`}
          icon={<IconCart size={15} />}
          href="/ordenes-compra"
        />
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader title="Cartera por edades" subtitle="Saldo abierto con IVA, según días de mora" />
          <div className="px-4 py-4">
            <CompositionBar
              segments={AGING_BUCKETS.map((b) => ({ label: b.label, value: aging.buckets.get(b.key) ?? 0, color: b.color }))}
              format="compact"
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Mayores saldos vencidos" subtitle="Clientes a llamar antes de despachar el siguiente pedido" />
          {aging.debtors.length ? (
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th className="num">Vencido</th>
                    <th className="num">Mora más antigua</th>
                  </tr>
                </thead>
                <tbody>
                  {aging.debtors.slice(0, 8).map((d) => (
                    <tr key={d.id}>
                      <td>
                        <Link href={`/clientes/${d.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">{d.name}</Link>
                      </td>
                      <td className="num font-semibold">{fmtCompact(d.overdue)}</td>
                      <td className="num" style={{ color: d.oldestDays > 60 ? "var(--critical)" : d.oldestDays > 30 ? "var(--serious)" : undefined }}>
                        {fmtNumber(d.oldestDays)} días
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">No hay cartera vencida.</p>
          )}
        </Card>
      </div>
    </>
  );
}
