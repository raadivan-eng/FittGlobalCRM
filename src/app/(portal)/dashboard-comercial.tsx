import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  billedBetween, companyForecasts, coverage, expiryReport, fieldKpis, forecastVsBilling, getForecastCriteria, leadForecasts,
  NOT_VOID, periodKey, receivables, startOfMonth, sumForecasts, topCompanies, topProducts, topStores,
} from "@/lib/analytics";
import { EXPIRY_BANDS, INCIDENT_TYPES, SEVERITIES, TIERS } from "@/lib/enums";
import { fmtCompact, fmtDate, fmtMoney, fmtNumber, fmtPeriod } from "@/lib/format";
import { Card, CardHeader, EnumBadge, SectionTitle, StatTile } from "@/components/ui";
import { CompositionBar, GaugeMeter, GroupedBarChart, RankingBars } from "@/components/charts";
import {
  IconAlert, IconArrowRight, IconExpiry, IconForecast, IconRoute, IconSales, IconTarget, IconVisit,
} from "@/components/icons";

const BAND_COLOR: Record<string, string> = {
  VENCIDO: "var(--critical)",
  CRITICO: "var(--serious)",
  ALERTA: "var(--warning)",
  VIGILAR: "var(--seq-400)",
  SANO: "var(--good)",
};

export async function DashboardComercial({ userName, credits }: { userName: string; credits: boolean }) {
  const now = new Date();
  const monthStart = startOfMonth(0, now);
  const nextMonth = startOfMonth(1, now);
  const prevMonth = startOfMonth(-1, now);
  const dayOfMonth = now.getDate();
  // Mismo tramo del mes anterior: comparar 27 días contra 31 sería engañoso.
  const prevSameSpan = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), dayOfMonth + 1);
  const quarterStart = startOfMonth(-2, now);
  const criteria = await getForecastCriteria();

  const [
    mtd, prevMtd, series, forecastMonth, leadsMonth, expiry, cover, field, cart,
    products, companies, stores, criticalIncidents, activeCounts,
  ] = await Promise.all([
    billedBetween(monthStart, nextMonth, undefined, credits),
    billedBetween(prevMonth, prevSameSpan, undefined, credits),
    forecastVsBilling(12, credits),
    companyForecasts([periodKey(monthStart)], undefined, { criteria }),
    leadForecasts([periodKey(monthStart)], criteria),
    expiryReport(),
    coverage(monthStart, nextMonth),
    fieldKpis(monthStart, nextMonth),
    receivables(),
    topProducts(quarterStart, nextMonth, 7),
    topCompanies(quarterStart, nextMonth, 7, credits),
    topStores(quarterStart, nextMonth, 7),
    prisma.incident.findMany({
      where: { status: { in: ["ABIERTA", "EN_PROCESO"] }, severity: { in: ["CRITICA", "ALTA"] } },
      orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
      take: 6,
      include: {
        store: { select: { name: true, city: true, company: { select: { name: true } } } },
        product: { select: { name: true, imageEmoji: true } },
        reportedBy: { select: { name: true } },
      },
    }),
    Promise.all([
      prisma.company.count({ where: { active: true } }),
      prisma.store.count({ where: { active: true } }),
      prisma.salesOrder.count({ where: { date: { gte: monthStart, lt: nextMonth }, status: NOT_VOID } }),
    ]),
  ]);

  const leadsTarget = leadsMonth.get(periodKey(monthStart))?.total ?? 0;
  const forecastTarget = sumForecasts(forecastMonth.get(periodKey(monthStart))) + leadsTarget + criteria.newBusiness;
  const delta = prevMtd.total > 0 ? ((mtd.total - prevMtd.total) / prevMtd.total) * 100 : null;
  const [companyCount, storeCount, orderCount] = activeCounts;

  const expiredValue = expiry.byBand.get("VENCIDO")!.value;
  const criticalValue = expiry.byBand.get("CRITICO")!.value;

  return (
    <div className="flex flex-col gap-6">
      {/* ── KPIs de decisión ── */}
      <section>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Facturado en el mes"
            value={fmtCompact(mtd.total)}
            delta={delta}
            hint={`${credits ? "Menos notas crédito · " : ""}vs. ${fmtCompact(prevMtd.total)} al día ${dayOfMonth} del mes anterior`}
            icon={<IconSales size={15} />}
            href={credits ? "/ventas" : "/ventas?nc=sin"}
          />
          <StatTile
            label="Avance del forecast"
            value={`${forecastTarget ? ((mtd.total / forecastTarget) * 100).toFixed(0) : "0"}%`}
            hint={`Meta ${fmtCompact(forecastTarget)}${leadsTarget ? ` (${fmtCompact(leadsTarget)} en leads)` : ""} · ${fmtPeriod(periodKey(monthStart))}`}
            icon={<IconTarget size={15} />}
            href="/forecast"
          />
          <StatTile
            label="Valor por vencer ≤ 90 días"
            value={fmtCompact(expiry.riskValue)}
            hint={`${fmtNumber(expiry.atRisk.length)} lotes · ${fmtCompact(expiredValue + criticalValue)} en riesgo inmediato`}
            icon={<IconExpiry size={15} />}
            href="/inventario"
          />
          <StatTile
            label="Cartera vencida"
            value={fmtCompact(cart.overdue)}
            hint={`${fmtCompact(cart.open)} pendiente total en ${cart.count} facturas`}
            icon={<IconAlert size={15} />}
            href="/ventas?estado=VENCIDA"
          />
        </div>
      </section>

      {/* ── Forecast vs facturación ── */}
      <section className="grid gap-4 lg:grid-cols-[1.65fr_1fr]">
        <Card>
          <CardHeader
            title="Forecast contra facturación"
            subtitle="Doce meses móviles. Ambas medidas en la misma escala monetaria."
            action={
              <Link href="/forecast" className="btn btn-ghost !px-2 text-[12.5px]">
                Ver detalle <IconArrowRight size={13} />
              </Link>
            }
          />
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

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Cumplimiento del mes" subtitle={fmtPeriod(periodKey(monthStart))} />
            <div className="flex flex-col gap-4 px-4 py-4">
              <GaugeMeter label="Facturación vs forecast" value={mtd.total} target={forecastTarget} format="compact" />
              <GaugeMeter label="Visitas ejecutadas vs planificadas" value={field.completed} target={field.planned} format="number" />
              <GaugeMeter label="Cobertura de tiendas asignadas" value={cover.visited} target={cover.assigned} format="number" />
            </div>
          </Card>

          <Card>
            <CardHeader title="Operación" subtitle="Estado actual de la red" />
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-b-xl bg-[var(--border)]">
              {[
                { k: "Clientes activos", v: fmtNumber(companyCount), href: "/clientes" },
                { k: "Puntos de venta", v: fmtNumber(storeCount), href: "/tiendas" },
                { k: "Pedidos del mes", v: fmtNumber(orderCount), href: "/ventas" },
                { k: "Novedades abiertas", v: fmtNumber(field.openIncidents), href: "/novedades" },
              ].map((x) => (
                <Link key={x.k} href={x.href} className="bg-[var(--surface-1)] px-4 py-3 transition-colors hover:bg-[var(--surface-2)]">
                  <dt className="text-[11.5px] text-[var(--text-muted)]">{x.k}</dt>
                  <dd className="mt-0.5 text-[18px] font-semibold tabular">{x.v}</dd>
                </Link>
              ))}
            </dl>
          </Card>
        </div>
      </section>

      {/* ── Rankings ── */}
      <section>
        <SectionTitle
          action={<span className="text-[12px] text-[var(--text-muted)]">Últimos 3 meses</span>}
        >
          Qué más vende
        </SectionTitle>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title="Productos" subtitle="Por facturación del período" />
            <RankingBars
              items={products.map((p) => ({
                label: `${p.product.imageEmoji} ${p.product.name}`,
                value: p.revenue,
                sub: `${fmtNumber(p.units)} u.`,
                href: `/productos/${p.product.id}`,
              }))}
              format="compact"
            />
          </Card>
          <Card>
            <CardHeader title="Clientes" subtitle="Empresas por facturación" />
            <RankingBars
              items={companies.map((c) => ({
                label: c.company.name,
                value: c.revenue,
                href: `/clientes/${c.company.id}`,
                badge: <span className={`badge badge-${TIERS.get(c.company.tier).tone}`}>{c.company.tier}</span>,
              }))}
              format="compact"
              color="var(--seq-550)"
            />
          </Card>
          <Card>
            <CardHeader title="Tiendas" subtitle="Puntos de venta con pedido directo" />
            <RankingBars
              items={stores.map((s) => ({
                label: s.store.name,
                value: s.revenue,
                sub: s.store.zone,
                href: `/tiendas/${s.store.id}`,
              }))}
              format="compact"
              color="var(--seq-250)"
            />
          </Card>
        </div>
      </section>

      {/* ── Vencimientos + novedades ── */}
      <section className="grid items-start gap-4 lg:grid-cols-[1fr_1.1fr]">
        <Card>
          <CardHeader
            title="Inventario por banda de vencimiento"
            subtitle="Valor al costo de los lotes disponibles"
            action={
              <Link href="/inventario" className="btn btn-ghost !px-2 text-[12.5px]">
                Gestionar <IconArrowRight size={13} />
              </Link>
            }
          />
          <div className="px-4 py-4">
            <CompositionBar
              segments={EXPIRY_BANDS.map((b) => ({
                label: b.label,
                value: expiry.byBand.get(b.key)!.value,
                color: BAND_COLOR[b.key],
              }))}
              format="compact"
            />
            <p className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-[12.5px] text-[var(--text-secondary)]">
              <strong className="text-[var(--text-primary)]">{fmtMoney(expiredValue + criticalValue)}</strong> requiere acción
              esta semana: producto vencido o con menos de 30 días. Total en bodega:{" "}
              <strong className="text-[var(--text-primary)]">{fmtCompact(expiry.totalValue)}</strong> en{" "}
              {fmtNumber(expiry.totalUnits)} unidades.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Novedades que exigen decisión"
            subtitle="Severidad crítica y alta, sin resolver"
            action={
              <Link href="/novedades" className="btn btn-ghost !px-2 text-[12.5px]">
                Ver todas <IconArrowRight size={13} />
              </Link>
            }
          />
          {criticalIncidents.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-[var(--text-muted)]">Sin novedades críticas abiertas.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {criticalIncidents.map((inc) => (
                <li key={inc.id} className="px-4 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">
                        {inc.product?.imageEmoji ? `${inc.product.imageEmoji} ` : ""}
                        {inc.title}
                      </p>
                      <p className="mt-0.5 truncate text-[12px] text-[var(--text-muted)]">
                        {inc.store.name} · {inc.store.company.name} · {fmtDate(inc.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <EnumBadge option={SEVERITIES.get(inc.severity)} dot />
                      <span className="text-[11px] text-[var(--text-muted)]">{INCIDENT_TYPES.label(inc.type)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* ── Accesos rápidos ── */}
      <section className="grid gap-3 sm:grid-cols-3">
        {[
          { href: "/rutas", Icon: IconRoute, title: "Planificar rutas", text: "Ordena la jornada de campo por impacto real." },
          { href: "/forecast", Icon: IconForecast, title: "Cargar forecast", text: "Proyección por cliente y producto del trimestre." },
          { href: "/visitas", Icon: IconVisit, title: "Revisar visitas", text: `${fmtNumber(field.completed)} ejecutadas este mes de ${fmtNumber(field.planned)}.` },
        ].map(({ href, Icon, title, text }) => (
          <Link key={href} href={href} className="card flex items-start gap-3 px-4 py-3.5 transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand-ink)]">
              <Icon size={17} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13.5px] font-semibold">{title}</span>
              <span className="mt-0.5 block text-[12.5px] text-[var(--text-secondary)]">{text}</span>
            </span>
          </Link>
        ))}
      </section>
    </div>
  );
}
