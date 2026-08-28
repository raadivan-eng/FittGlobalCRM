import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { forecastVsBilling, lastMonths, NOT_VOID, periodKey, startOfMonth } from "@/lib/analytics";
import { TIERS } from "@/lib/enums";
import { fmtCompact, fmtMoney, fmtNumber, fmtPeriod } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";
import { Card, CardHeader, EnumBadge, PageHeader, StatTile } from "@/components/ui";
import { GroupedBarChart, RankingBars } from "@/components/charts";
import { ForecastCell } from "./forecast-cell";
import { IconForecast, IconSales, IconTarget } from "@/components/icons";

export const metadata = { title: "Forecast" };
export const dynamic = "force-dynamic";

function periodOptions(ref = new Date()) {
  return Array.from({ length: 10 }, (_, i) => {
    const d = startOfMonth(i - 6, ref);
    return { key: periodKey(d), label: fmtPeriod(periodKey(d)), start: d, end: startOfMonth(i - 5, ref) };
  });
}

export default async function ForecastPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireSection("forecast");
  const sp = await searchParams;
  const now = new Date();
  const options = periodOptions(now);
  const period = options.find((o) => o.key === one(sp.periodo))?.key ?? periodKey(startOfMonth(0, now));
  const selected = options.find((o) => o.key === period)!;
  const editable = ["ADMIN", "COMERCIAL"].includes(user.role);

  const [companies, forecasts, invoices, series, productForecasts, productSales] = await Promise.all([
    prisma.company.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, tier: true, channel: true, owner: { select: { name: true } } },
    }),
    prisma.forecast.findMany({ where: { period, companyId: { not: null } }, select: { companyId: true, amount: true } }),
    prisma.invoice.groupBy({
      by: ["companyId"],
      where: { issueDate: { gte: selected.start, lt: selected.end }, status: NOT_VOID },
      _sum: { total: true },
    }),
    forecastVsBilling(12),
    prisma.forecast.findMany({
      where: { period, productId: { not: null } },
      include: { product: { select: { id: true, name: true, imageEmoji: true } } },
      orderBy: { amount: "desc" },
      take: 10,
    }),
    prisma.salesOrderLine.groupBy({
      by: ["productId"],
      where: { order: { date: { gte: selected.start, lt: selected.end }, status: NOT_VOID } },
      _sum: { total: true },
    }),
  ]);

  const fcByCompany = new Map(forecasts.map((f) => [f.companyId!, f.amount]));
  const realByCompany = new Map(invoices.map((i) => [i.companyId, i._sum.total ?? 0]));
  const realByProduct = new Map(productSales.map((p) => [p.productId, p._sum.total ?? 0]));

  const rows = companies
    .map((c) => {
      const forecast = fcByCompany.get(c.id) ?? 0;
      const real = realByCompany.get(c.id) ?? 0;
      return { company: c, forecast, real, gap: real - forecast, progress: forecast > 0 ? (real / forecast) * 100 : null };
    })
    .sort((a, b) => b.forecast - a.forecast);

  const totalForecast = rows.reduce((s, r) => s + r.forecast, 0);
  const totalReal = rows.reduce((s, r) => s + r.real, 0);
  const isPast = selected.end <= now;
  const isCurrent = period === periodKey(startOfMonth(0, now));

  return (
    <>
      <PageHeader
        title="Forecast de ventas"
        subtitle="Proyección por cliente y por producto, contrastada contra la facturación real del mismo período. Lo que no se proyecta no se puede medir."
        actions={
          <form className="flex items-center gap-2">
            <select name="periodo" defaultValue={period} className="field w-48">
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <button className="btn btn-secondary">Ver período</button>
          </form>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Forecast del período" value={fmtCompact(totalForecast)} hint={`${fmtNumber(rows.filter((r) => r.forecast > 0).length)} clientes con proyección`} icon={<IconForecast size={15} />} />
        <StatTile label="Facturación real" value={fmtCompact(totalReal)} hint={isCurrent ? "Mes en curso, aún parcial" : isPast ? "Período cerrado" : "Período futuro, sin facturación"} icon={<IconSales size={15} />} />
        <StatTile label="Avance" value={`${totalForecast ? ((totalReal / totalForecast) * 100).toFixed(0) : 0}%`} hint={`${fmtCompact(Math.abs(totalReal - totalForecast))} ${totalReal >= totalForecast ? "por encima" : "por debajo"} de la meta`} icon={<IconTarget size={15} />} />
        <StatTile label="Clientes en riesgo" value={fmtNumber(rows.filter((r) => r.forecast > 0 && (r.progress ?? 0) < 70 && isPast).length)} hint="Cerraron por debajo del 70% de su proyección" icon={<IconTarget size={15} />} />
      </div>

      <Card className="mt-5">
        <CardHeader title="Forecast contra facturación" subtitle="Doce meses móviles, ambas medidas en la misma escala" />
        <div className="px-4 py-4">
          <GroupedBarChart
            data={series.map((s) => ({ label: s.label, values: [s.forecast, s.real] }))}
            series={[
              { name: "Forecast", color: "var(--series-1)" },
              { name: "Facturación real", color: "var(--series-2)" },
            ]}
            format="compact"
            height={250}
          />
        </div>
      </Card>

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader
            title={`Proyección por cliente · ${fmtPeriod(period)}`}
            subtitle={editable ? "Edita el monto y guarda: el panel gerencial se actualiza al instante." : "Sólo lectura para tu rol."}
          />
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>ABC</th>
                  <th>Responsable</th>
                  <th className="num">Forecast</th>
                  <th className="num">Real</th>
                  <th className="num">Avance</th>
                  <th className="num">Brecha</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.company.id}>
                    <td>
                      <Link href={`/clientes/${r.company.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                        {r.company.name}
                      </Link>
                    </td>
                    <td><EnumBadge option={TIERS.get(r.company.tier)} /></td>
                    <td className="text-[var(--text-secondary)]">{r.company.owner?.name ?? "—"}</td>
                    <td className="num">
                      <ForecastCell period={period} companyId={r.company.id} amount={r.forecast} editable={editable} />
                    </td>
                    <td className="num font-semibold">{r.real > 0 ? fmtMoney(r.real) : "—"}</td>
                    <td className="num">
                      {r.progress == null ? (
                        <span className="text-[var(--text-muted)]">—</span>
                      ) : (
                        <span
                          className="font-semibold"
                          style={{ color: r.progress >= 100 ? "var(--good)" : r.progress >= 80 ? "var(--warning)" : "var(--critical)" }}
                        >
                          {r.progress.toFixed(0)}%
                        </span>
                      )}
                    </td>
                    <td className="num" style={{ color: r.gap >= 0 ? "var(--good)" : "var(--critical)" }}>
                      {r.forecast > 0 ? `${r.gap >= 0 ? "+" : "−"}${fmtMoney(Math.abs(r.gap)).replace("-", "")}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[var(--surface-2)] font-semibold">
                  <td colSpan={3}>Total</td>
                  <td className="num">{fmtMoney(totalForecast)}</td>
                  <td className="num">{fmtMoney(totalReal)}</td>
                  <td className="num">{totalForecast ? `${((totalReal / totalForecast) * 100).toFixed(0)}%` : "—"}</td>
                  <td className="num">{fmtMoney(totalReal - totalForecast)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Forecast por producto" subtitle={`Top SKU proyectados · ${fmtPeriod(period)}`} />
          {productForecasts.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-[var(--text-muted)]">
              No hay proyección por producto cargada para este período.
            </p>
          ) : (
            <RankingBars
              items={productForecasts.map((f) => ({
                label: `${f.product!.imageEmoji} ${f.product!.name}`,
                value: f.amount,
                sub: `real ${fmtCompact(realByProduct.get(f.productId!) ?? 0)}`,
                href: `/productos/${f.productId}`,
              }))}
              format="compact"
            />
          )}
        </Card>
      </div>
    </>
  );
}
