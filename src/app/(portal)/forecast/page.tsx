import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { baselineWindow, companyForecasts, forecastVsBilling, leadForecasts, NOT_VOID, periodKey, startOfMonth } from "@/lib/analytics";
import { FORECAST_SOURCE, LEAD_SOURCES, LEAD_STATUS, TIERS } from "@/lib/enums";
import { fmtCompact, fmtMoney, fmtNumber, fmtPeriod } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";
import { Card, CardHeader, EnumBadge, PageHeader, StatTile } from "@/components/ui";
import { GroupedBarChart, RankingBars } from "@/components/charts";
import { ForecastCell } from "./forecast-cell";
import { ClientMonthsAdjust, ExcludeMonthButton } from "./adjust-months";
import { quitarMesExtraordinario } from "@/lib/actions-sales";
import { IconForecast, IconLead, IconSales, IconTarget } from "@/components/icons";

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
  const months = baselineWindow(period, now).periods;

  const [companies, forecasts, invoices, series, productForecasts, productSales, exclusions, leadsByPeriod] = await Promise.all([
    prisma.company.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, tier: true, channel: true, owner: { select: { name: true } } },
    }),
    companyForecasts([period]),
    prisma.invoice.groupBy({
      by: ["companyId"],
      where: { issueDate: { gte: selected.start, lt: selected.end }, status: NOT_VOID },
      _sum: { net: true },
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
    prisma.forecastExclusion.findMany({
      where: { period: { in: months } },
      orderBy: [{ period: "asc" }, { createdAt: "asc" }],
      select: { id: true, period: true, companyId: true, notes: true, company: { select: { name: true } } },
    }),
    leadForecasts([period]),
  ]);

  const fcByCompany = forecasts.get(period)!;
  const realByCompany = new Map(invoices.map((i) => [i.companyId, i._sum.net ?? 0]));
  const realByProduct = new Map(productSales.map((p) => [p.productId, p._sum.total ?? 0]));

  const rows = companies
    .map((c) => {
      const fc = fcByCompany.get(c.id);
      const forecast = fc?.amount ?? 0;
      const real = realByCompany.get(c.id) ?? 0;
      return {
        company: c,
        fc,
        forecast,
        real,
        gap: real - forecast,
        progress: forecast > 0 ? (real / forecast) * 100 : null,
      };
    })
    .sort((a, b) => b.forecast - a.forecast || b.real - a.real);

  const clientsForecast = rows.reduce((s, r) => s + r.forecast, 0);
  const hotLeads = leadsByPeriod.get(period)!;
  const totalForecast = clientsForecast + hotLeads.total;
  const totalReal = rows.reduce((s, r) => s + r.real, 0);
  const isPast = selected.end <= now;
  const isCurrent = period === periodKey(startOfMonth(0, now));

  // En el mes en curso el real es parcial: se mide contra el ritmo esperado a
  // la fecha (días transcurridos sobre días del mes), no contra el 100%.
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const pace = isCurrent ? (now.getDate() / daysInMonth) * 100 : 100;
  const measurable = isPast || isCurrent;
  const tone = (progress: number) =>
    progress >= pace ? "var(--good)" : progress >= pace * 0.8 ? "var(--warning)" : "var(--critical)";
  const atRisk = rows.filter((r) => r.progress != null && r.progress < pace * 0.7);

  const windowLabel = months.length
    ? months.length === 1 ? fmtPeriod(months[0]) : `${fmtPeriod(months[0])} a ${fmtPeriod(months[months.length - 1])}`
    : null;
  const totalProgress = totalForecast ? (totalReal / totalForecast) * 100 : 0;

  // Facturación total de cada mes de la ventana. Se marca como atípico lo que
  // pasa de 1,5 veces la mediana: es la pista para encontrar meses extraordinarios.
  const billedByMonth = months.map((m) => {
    let amount = 0;
    for (const f of fcByCompany.values()) amount += f.history.find((h) => h.period === m)?.amount ?? 0;
    return amount;
  });
  const sorted = [...billedByMonth].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
  const monthTotals = months.map((m, i) => {
    const exclusion = exclusions.find((e) => e.period === m && !e.companyId);
    return { period: m, amount: billedByMonth[i], exclusion, outlier: !exclusion && median > 0 && billedByMonth[i] > median * 1.5 };
  });
  const monthMax = Math.max(...billedByMonth, 1);
  const clientExclusions = exclusions.filter((e) => e.companyId);

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
        <StatTile label="Forecast del período" value={fmtCompact(totalForecast)} hint={`${fmtNumber(rows.filter((r) => r.forecast > 0).length)} clientes${hotLeads.leads.length ? ` + ${fmtNumber(hotLeads.leads.length)} leads calientes` : " con proyección"}`} icon={<IconForecast size={15} />} />
        <StatTile label="Facturación real" value={fmtCompact(totalReal)} hint={isCurrent ? "Mes en curso, aún parcial" : isPast ? "Período cerrado" : "Período futuro, sin facturación"} icon={<IconSales size={15} />} />
        <StatTile
          label="Avance"
          value={measurable ? `${totalProgress.toFixed(0)}%` : "—"}
          hint={
            isCurrent
              ? `Ritmo esperado al día ${now.getDate()}: ${pace.toFixed(0)}%`
              : !isPast
                ? "Se mide cuando el período empiece"
                : `${fmtCompact(Math.abs(totalReal - totalForecast))} ${totalReal >= totalForecast ? "por encima" : "por debajo"} de la meta`
          }
          icon={<IconTarget size={15} />}
        />
        <StatTile
          label="Clientes en riesgo"
          value={measurable ? fmtNumber(atRisk.length) : "—"}
          hint={
            isCurrent
              ? "Van por debajo del 70% del ritmo esperado"
              : isPast
                ? "Cerraron por debajo del 70% de su proyección"
                : "Se mide cuando el período empiece"
          }
          icon={<IconTarget size={15} />}
        />
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

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title={`Proyección por cliente · ${fmtPeriod(period)}`}
            subtitle={`${
              windowLabel
                ? `Sin carga manual, la meta es la facturación media mensual de ${windowLabel}, desde el primer mes con compra.`
                : "No hay meses cerrados del año para promediar: sólo cuenta lo cargado a mano."
            }${editable ? " Ajusta el monto para fijarlo; déjalo vacío para volver al promedio." : ""}`}
          />
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>ABC</th>
                  <th>Responsable</th>
                  <th>Origen</th>
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
                    <td className="whitespace-nowrap">
                      {r.fc ? (
                        <span className="inline-flex items-center gap-1.5">
                          <EnumBadge option={FORECAST_SOURCE.get(r.fc.source)} />
                          {r.fc.source === "PROMEDIO" && (
                            <span className="text-[12px] text-[var(--text-muted)]">{r.fc.months} m</span>
                          )}
                          {editable && r.fc.history.length > 0 && (
                            <ClientMonthsAdjust
                              companyId={r.company.id}
                              companyName={r.company.name}
                              history={r.fc.history}
                              notes={clientExclusions.find((e) => e.companyId === r.company.id)?.notes ?? null}
                            />
                          )}
                        </span>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                    <td className="num">
                      <ForecastCell
                        period={period}
                        companyId={r.company.id}
                        manual={r.fc?.source === "MANUAL" ? r.fc.amount : null}
                        baseline={r.fc?.baseline ?? 0}
                        editable={editable}
                      />
                    </td>
                    <td className="num font-semibold">{r.real > 0 ? fmtMoney(r.real) : "—"}</td>
                    <td className="num">
                      {r.progress == null || !measurable ? (
                        <span className="text-[var(--text-muted)]">—</span>
                      ) : (
                        <span className="font-semibold" style={{ color: tone(r.progress) }}>
                          {r.progress.toFixed(0)}%
                        </span>
                      )}
                    </td>
                    <td
                      className="num whitespace-nowrap"
                      style={{
                        color:
                          r.progress == null || !measurable
                            ? "var(--text-muted)"
                            : isCurrent
                              ? tone(r.progress)
                              : r.gap >= 0 ? "var(--good)" : "var(--critical)",
                      }}
                    >
                      {r.forecast > 0 && measurable ? `${r.gap >= 0 ? "+" : "−"}${fmtMoney(Math.abs(r.gap)).replace("-", "")}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {hotLeads.leads.length > 0 && (
                  <>
                    <tr className="text-[var(--text-secondary)]">
                      <td colSpan={4}>Subtotal clientes</td>
                      <td className="num">{fmtMoney(clientsForecast)}</td>
                      <td colSpan={3} />
                    </tr>
                    <tr className="text-[var(--text-secondary)]">
                      <td colSpan={4}>
                        <Link href={`/leads?estado=ABIERTOS&temperatura=CALIENTE&cierre=${period}`} className="hover:text-[var(--brand)] hover:underline">
                          Leads calientes que cierran este mes ({fmtNumber(hotLeads.leads.length)})
                        </Link>
                      </td>
                      <td className="num">{fmtMoney(hotLeads.total)}</td>
                      <td colSpan={3} />
                    </tr>
                  </>
                )}
                <tr className="bg-[var(--surface-2)] font-semibold">
                  <td colSpan={4}>Total</td>
                  <td className="num">{fmtMoney(totalForecast)}</td>
                  <td className="num">{fmtMoney(totalReal)}</td>
                  <td className="num">{totalForecast ? `${totalProgress.toFixed(0)}%` : "—"}</td>
                  <td className="num">{fmtMoney(totalReal - totalForecast)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <Card>
          <CardHeader
            title={`Leads calientes · ${fmtPeriod(period)}`}
            subtitle="Prospectos marcados como calientes con este mes de cierre. Su valor suma al forecast hasta que se ganan o se pierden."
            action={
              <Link href={`/leads?estado=ABIERTOS&temperatura=CALIENTE&cierre=${period}`} className="btn btn-ghost !px-2 text-[12.5px]">
                Ver
              </Link>
            }
          />
          {hotLeads.leads.length === 0 ? (
            <p className="flex flex-col items-center gap-2 px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">
              <IconLead size={20} />
              Ningún lead caliente tiene cierre tentativo en este mes.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {hotLeads.leads.slice(0, 8).map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                  <span className="min-w-0 flex-1">
                    <Link href={`/leads/${l.id}`} className="block truncate font-medium hover:text-[var(--brand)] hover:underline">
                      {l.name}
                    </Link>
                    <span className="block truncate text-[11.5px] text-[var(--text-muted)]">
                      {LEAD_SOURCES.label(l.source)} · {LEAD_STATUS.label(l.status)}{l.owner ? ` · ${l.owner}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{fmtCompact(l.amount)}</span>
                </li>
              ))}
              {hotLeads.leads.length > 8 && (
                <li className="px-4 py-2 text-[12px] text-[var(--text-muted)]">y {hotLeads.leads.length - 8} más</li>
              )}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Meses extraordinarios"
            subtitle="Lo que se excluye no entra al promedio. Úsalo para negociaciones especiales o compras que no se van a repetir."
          />
          {monthTotals.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">Este período no tiene meses cerrados para promediar.</p>
          ) : (
            <ul className="px-4 py-2">
              {monthTotals.map((m) => {
                return (
                  <li key={m.period} className="flex items-center gap-3 py-1.5 text-[13px]">
                    <span className={`w-32 shrink-0 whitespace-nowrap first-letter:uppercase ${m.exclusion ? "text-[var(--text-muted)] line-through" : ""}`}>
                      {fmtPeriod(m.period)}
                    </span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${(m.amount / monthMax) * 100}%`,
                          background: m.exclusion ? "var(--text-muted)" : m.outlier ? "var(--warning)" : "var(--series-1)",
                        }}
                      />
                    </span>
                    <span className="w-20 shrink-0 text-right tabular-nums">{fmtCompact(m.amount)}</span>
                    <span className="w-[72px] shrink-0 text-right">
                      {m.exclusion ? (
                        editable ? (
                          <form action={quitarMesExtraordinario}>
                            <input type="hidden" name="id" value={m.exclusion.id} />
                            <button className="btn btn-ghost !px-2 !py-0.5 text-[12px]" title={m.exclusion.notes ?? undefined}>Incluir</button>
                          </form>
                        ) : (
                          <span className="text-[12px] text-[var(--text-muted)]">Excluido</span>
                        )
                      ) : editable ? (
                        <ExcludeMonthButton period={m.period} />
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {monthTotals.some((m) => m.outlier || m.exclusion?.notes) && (
            <div className="space-y-1 border-t border-[var(--border)] px-4 py-2.5 text-[12px] text-[var(--text-secondary)]">
              {monthTotals.some((m) => m.outlier) && (
                <p className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-[var(--warning)]" />
                  Más de 1,5 veces el mes típico: revisa si fue extraordinario.
                </p>
              )}
              {monthTotals.filter((m) => m.exclusion?.notes).map((m) => (
                <p key={m.period}><span className="inline-block first-letter:uppercase">{fmtPeriod(m.period)}</span>: {m.exclusion!.notes}</p>
              ))}
            </div>
          )}
          {clientExclusions.length > 0 && (
            <div className="border-t border-[var(--border)] px-4 py-2.5">
              <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Ajustes por cliente</p>
              <ul>
                {clientExclusions.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 py-1 text-[12.5px]">
                    <span className="min-w-0 flex-1 truncate">
                      {e.company?.name} · <span className="inline-block first-letter:uppercase">{fmtPeriod(e.period)}</span>
                      {e.notes && <span className="text-[var(--text-muted)]"> — {e.notes}</span>}
                    </span>
                    {editable && (
                      <form action={quitarMesExtraordinario}>
                        <input type="hidden" name="id" value={e.id} />
                        <button className="btn btn-ghost !px-2 !py-0.5 text-[12px]">Quitar</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
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
      </div>
    </>
  );
}
