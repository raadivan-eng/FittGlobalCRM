import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { NOT_VOID, startOfMonth, topCategories, topCompanies, topProducts, topStores } from "@/lib/analytics";
import { CHANNELS, INCIDENT_TYPES, TIERS } from "@/lib/enums";
import { fmtCompact, fmtNumber, fmtPct } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";
import { Card, CardHeader, EnumBadge, PageHeader, StatTile } from "@/components/ui";
import { CompositionBar, RankingBars } from "@/components/charts";
import { IconAlert, IconReports, IconSales, IconStore } from "@/components/icons";

export const metadata = { title: "Reportes" };
export const dynamic = "force-dynamic";

/** Slots categóricos en su orden fijo. Nunca se ciclan: pasado el octavo se agrupa. */
const SERIES = [
  "var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)",
  "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)",
];

/** Agrupa la cola en «Otros» para no inventar tonos fuera de la paleta. */
function toSegments(entries: [string, number][], limit = SERIES.length) {
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, limit).map(([label, value], i) => ({ label, value, color: SERIES[i] }));
  const tail = sorted.slice(limit);
  if (tail.length) head.push({ label: `Otros (${tail.length})`, value: tail.reduce((s, x) => s + x[1], 0), color: "var(--text-muted)" });
  return head;
}

const WINDOWS = [
  { key: "3", label: "Últimos 3 meses", months: 3 },
  { key: "6", label: "Últimos 6 meses", months: 6 },
  { key: "12", label: "Últimos 12 meses", months: 12 },
];

export default async function ReportesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection("reportes");
  const sp = await searchParams;
  const win = WINDOWS.find((w) => w.key === one(sp.rango)) ?? WINDOWS[0];

  const now = new Date();
  const from = startOfMonth(-(win.months - 1), now);
  const to = startOfMonth(1, now);

  const [categories, products, companies, stores, invoices, incidentTypes, zoneVisits, zoneShelf] = await Promise.all([
    topCategories(from, to),
    topProducts(from, to, 12),
    topCompanies(from, to, 12),
    topStores(from, to, 12),
    prisma.invoice.findMany({
      where: { issueDate: { gte: from, lt: to }, status: NOT_VOID },
      select: { total: true, company: { select: { channel: true, tier: true, city: true } } },
    }),
    prisma.incident.groupBy({ by: ["type"], where: { createdAt: { gte: from, lt: to } }, _count: true }),
    prisma.visit.findMany({
      where: { plannedDate: { gte: from, lt: to } },
      select: { status: true, store: { select: { zone: true, city: true } } },
    }),
    prisma.shelfReport.findMany({
      where: { visit: { plannedDate: { gte: from, lt: to }, status: "COMPLETADA" } },
      select: { outOfStock: true, planogramOk: true, priceTagOk: true, product: { select: { category: true } }, visit: { select: { store: { select: { zone: true } } } } },
    }),
  ]);

  const byChannel = new Map<string, number>();
  const byTier = new Map<string, number>();
  const byCity = new Map<string, number>();
  for (const i of invoices) {
    byChannel.set(i.company.channel, (byChannel.get(i.company.channel) ?? 0) + i.total);
    byTier.set(i.company.tier, (byTier.get(i.company.tier) ?? 0) + i.total);
    if (i.company.city) byCity.set(i.company.city, (byCity.get(i.company.city) ?? 0) + i.total);
  }

  const zoneStats = new Map<string, { planned: number; completed: number; oos: number; audited: number }>();
  for (const v of zoneVisits) {
    const key = `${v.store.city} · ${v.store.zone}`;
    const acc = zoneStats.get(key) ?? { planned: 0, completed: 0, oos: 0, audited: 0 };
    acc.planned += 1;
    if (v.status === "COMPLETADA") acc.completed += 1;
    zoneStats.set(key, acc);
  }
  for (const s of zoneShelf) {
    const zone = s.visit.store.zone;
    for (const [key, acc] of zoneStats) {
      if (key.endsWith(`· ${zone}`)) {
        acc.audited += 1;
        if (s.outOfStock) acc.oos += 1;
      }
    }
  }

  const categoryOos = new Map<string, { oos: number; total: number }>();
  for (const s of zoneShelf) {
    const acc = categoryOos.get(s.product.category) ?? { oos: 0, total: 0 };
    acc.total += 1;
    if (s.outOfStock) acc.oos += 1;
    categoryOos.set(s.product.category, acc);
  }

  const totalBilled = invoices.reduce((s, i) => s + i.total, 0);
  const oosTotal = zoneShelf.filter((s) => s.outOfStock).length;
  const planogramFails = zoneShelf.filter((s) => !s.planogramOk).length;
  const priceFails = zoneShelf.filter((s) => !s.priceTagOk).length;

  return (
    <>
      <PageHeader
        title="Reportes"
        subtitle="Lecturas cruzadas del negocio: dónde se concentra la venta, cómo se ejecuta en el punto de venta y qué categorías pierden disponibilidad."
        actions={
          <form className="flex items-center gap-2">
            <select name="rango" defaultValue={win.key} className="field w-48">
              {WINDOWS.map((w) => (
                <option key={w.key} value={w.key}>{w.label}</option>
              ))}
            </select>
            <button className="btn btn-secondary">Aplicar</button>
          </form>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Facturación del período" value={fmtCompact(totalBilled)} hint={`${fmtNumber(invoices.length)} facturas · ${win.label.toLowerCase()}`} icon={<IconSales size={15} />} />
        <StatTile label="Tasa de quiebre" value={zoneShelf.length ? fmtPct((oosTotal / zoneShelf.length) * 100) : "—"} hint={`${fmtNumber(oosTotal)} de ${fmtNumber(zoneShelf.length)} mediciones`} icon={<IconAlert size={15} />} invertDelta />
        <StatTile label="Planograma incumplido" value={zoneShelf.length ? fmtPct((planogramFails / zoneShelf.length) * 100) : "—"} hint="Pérdida de espacio negociado" icon={<IconStore size={15} />} invertDelta />
        <StatTile label="Precio mal exhibido" value={zoneShelf.length ? fmtPct((priceFails / zoneShelf.length) * 100) : "—"} hint={`${fmtNumber(priceFails)} etiquetas fuera de lista`} icon={<IconReports size={15} />} invertDelta />
      </div>

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Venta por canal" subtitle="Participación sobre la facturación del período" />
          <div className="px-4 py-4">
            <CompositionBar
              segments={toSegments([...byChannel.entries()].map(([k, v]) => [CHANNELS.label(k), v] as [string, number]))}
              format="compact"
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Venta por clasificación ABC" subtitle="Concentración de la cartera" />
          <div className="px-4 py-4">
            <CompositionBar
              segments={["A", "B", "C"].map((t, i) => ({ label: TIERS.label(t), value: byTier.get(t) ?? 0, color: SERIES[i] }))}
              format="compact"
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Venta por ciudad" subtitle="Sede del cliente facturado" />
          <div className="px-4 py-4">
            <CompositionBar
              segments={toSegments([...byCity.entries()])}
              format="compact"
            />
          </div>
        </Card>
      </div>

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Top productos" subtitle="Por facturación" />
          <RankingBars items={products.map((p) => ({ label: `${p.product.imageEmoji} ${p.product.name}`, value: p.revenue, sub: `${fmtNumber(p.units)} u.`, href: `/productos/${p.product.id}` }))} format="compact" />
        </Card>
        <Card>
          <CardHeader title="Top clientes" subtitle="Por facturación" />
          <RankingBars items={companies.map((c) => ({ label: c.company.name, value: c.revenue, href: `/clientes/${c.company.id}`, badge: <span className={`badge badge-${TIERS.get(c.company.tier).tone}`}>{c.company.tier}</span> }))} format="compact" color="var(--seq-550)" />
        </Card>
        <Card>
          <CardHeader title="Top tiendas" subtitle="Con pedido directo al punto" />
          <RankingBars items={stores.map((s) => ({ label: s.store.name, value: s.revenue, sub: s.store.zone, href: `/tiendas/${s.store.id}` }))} format="compact" color="var(--seq-250)" />
        </Card>
      </div>

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Ejecución por zona" subtitle="Cumplimiento de visitas y disponibilidad en góndola" />
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Zona</th>
                  <th className="num">Visitas plan.</th>
                  <th className="num">Completadas</th>
                  <th className="num">Cumplimiento</th>
                  <th className="num">SKU auditados</th>
                  <th className="num">Quiebre</th>
                </tr>
              </thead>
              <tbody>
                {[...zoneStats.entries()]
                  .sort((a, b) => b[1].planned - a[1].planned)
                  .map(([zone, s]) => {
                    const compliance = s.planned ? (s.completed / s.planned) * 100 : 0;
                    const oosRate = s.audited ? (s.oos / s.audited) * 100 : 0;
                    return (
                      <tr key={zone}>
                        <td className="font-medium">{zone}</td>
                        <td className="num">{fmtNumber(s.planned)}</td>
                        <td className="num">{fmtNumber(s.completed)}</td>
                        <td className="num">
                          <span className="font-semibold" style={{ color: compliance >= 90 ? "var(--good)" : compliance >= 70 ? "var(--warning)" : "var(--critical)" }}>
                            {compliance.toFixed(0)}%
                          </span>
                        </td>
                        <td className="num text-[var(--text-secondary)]">{fmtNumber(s.audited)}</td>
                        <td className="num">
                          <span style={{ color: oosRate > 15 ? "var(--critical)" : oosRate > 8 ? "var(--warning)" : "var(--good)" }}>
                            {oosRate.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Quiebre por categoría" subtitle="Porcentaje de mediciones sin producto en góndola" />
            <RankingBars
              items={[...categoryOos.entries()]
                .map(([k, v]) => ({ label: k, value: v.total ? (v.oos / v.total) * 100 : 0, sub: `${v.oos}/${v.total} mediciones` }))
                .sort((a, b) => b.value - a.value)}
              format="percent"
              color="var(--serious)"
            />
          </Card>
          <Card>
            <CardHeader title="Novedades por tipo" subtitle={`Levantadas en ${win.label.toLowerCase()}`} />
            <ul className="divide-y divide-[var(--border)]">
              {incidentTypes
                .sort((a, b) => b._count - a._count)
                .map((t) => (
                  <li key={t.type} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <EnumBadge option={INCIDENT_TYPES.get(t.type)} />
                    <Link href={`/novedades?tipo=${t.type}&estado=TODAS`} className="text-[13px] font-semibold tabular hover:text-[var(--brand)] hover:underline">
                      {fmtNumber(t._count)}
                    </Link>
                  </li>
                ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card className="mt-5">
        <CardHeader title="Facturación por categoría de producto" subtitle="Participación del portafolio en el período" />
        <div className="px-4 py-4">
          <CompositionBar
            segments={toSegments(categories.map((c) => [c.category, c.revenue] as [string, number]))}
            format="compact"
          />
        </div>
      </Card>
    </>
  );
}
