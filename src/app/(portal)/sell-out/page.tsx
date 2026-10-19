import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { can, requireSection, TRADE_ROLES } from "@/lib/auth";
import {
  addMonths, change, monthlyByCompany, periodLabel, periodsUntil, productPerformance, ROTATION_LOOKBACK,
  sellInUnits, storePerformance,
} from "@/lib/sell-out";
import { fmtCompact, fmtDateTime, fmtNumber, fmtPeriod } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";
import { Card, CardHeader, Delta, EmptyState, PageHeader, StatTile } from "@/components/ui";
import { Filters } from "@/components/filters";
import { GroupedBarChart, LineChart, RankingBars } from "@/components/charts";
import { IconAlert, IconRotation, IconStore, IconUpload } from "@/components/icons";

export const metadata = { title: "Sell out" };
export const dynamic = "force-dynamic";

/** Slots categóricos en su orden fijo. Nunca se ciclan: pasado el séptimo cliente se agrupa en «Otros». */
const SERIES = [
  "var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)",
  "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)",
];

const WINDOW = 12;

/** «sept 2025 – sept 2026 (13 meses)» si son seguidos; si no, la lista. */
function periodRange(periods: string[]) {
  const sorted = [...periods].sort();
  if (sorted.length < 3) return sorted.map(fmtPeriod).join(", ");
  const contiguous = sorted.every((p, i) => i === 0 || addMonths(sorted[i - 1], 1) === p);
  return contiguous
    ? `${fmtPeriod(sorted[0])} – ${fmtPeriod(sorted[sorted.length - 1])} (${sorted.length} meses)`
    : sorted.map(fmtPeriod).join(", ");
}

export default async function SellOutPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireSection("sellout");
  const sp = await searchParams;
  const companyId = one(sp.cliente) || undefined;

  const [periodRows, companyRows, imports] = await Promise.all([
    prisma.sellOut.groupBy({ by: ["period"], where: companyId ? { companyId } : {}, orderBy: { period: "desc" } }),
    prisma.sellOut.groupBy({ by: ["companyId"] }),
    prisma.sellOutImport.findMany({
      where: companyId ? { companyId } : {},
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { company: { select: { name: true } }, user: { select: { name: true } } },
    }),
  ]);
  const canLoad = TRADE_ROLES.includes(user.role);
  const companies = await prisma.company.findMany({
    where: { id: { in: companyRows.map((c) => c.companyId) } },
    select: { id: true, name: true, _count: { select: { stores: { where: { active: true } } } } },
    orderBy: { name: "asc" },
  });

  const header = (
    <PageHeader
      title="Sell out"
      subtitle="Lo que nuestros clientes venden al consumidor en cada punto de venta, mes a mes, según los reportes de sus portales. Es la rotación: si no sale de la góndola, no vuelve a pedirse."
      actions={
        canLoad && (
          <Link href="/sell-out/importar" className="btn btn-primary">
            <IconUpload size={14} /> Cargar reporte
          </Link>
        )
      }
    />
  );

  if (!periodRows.length) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={<IconRotation size={26} />}
            title="Todavía no hay sell-out cargado"
            description="Sube el Excel con los reportes de los portales (Farmatodo, Locatel, Olímpica, Colsubsidio…): cada pestaña se asigna a su cliente y se casa contra el maestro de tiendas y productos."
            action={canLoad && <Link href="/sell-out/importar" className="btn btn-primary">Cargar reporte</Link>}
          />
        </Card>
      </>
    );
  }

  const available = periodRows.map((p) => p.period);
  const period = available.includes(one(sp.mes)) ? one(sp.mes) : available[0];
  const prev = addMonths(period, -1);
  const lastYear = addMonths(period, -12);
  const periods = periodsUntil(period, WINDOW);
  const sellThroughPeriods = periodsUntil(period, 3);

  const scopeIds = companyId ? [companyId] : companies.map((c) => c.id);
  const [monthly, yearAgo, sellIn, stores, products] = await Promise.all([
    monthlyByCompany(periods, companyId),
    monthlyByCompany([lastYear], companyId),
    sellInUnits(periods, scopeIds),
    companyId ? storePerformance(companyId, period) : Promise.resolve([]),
    productPerformance(period, companyId),
  ]);

  const nameOf = new Map(companies.map((c) => [c.id, c.name]));
  const activeStores = new Map(companies.map((c) => [c.id, c._count.stores]));

  const sum = (p: string, key: "units" | "value" | "stores", source = monthly) =>
    [...source.values()].reduce((t, months) => t + (months.get(p)?.[key] ?? 0), 0);
  const units = sum(period, "units");
  const unitsPrev = sum(prev, "units");
  const value = sum(period, "value");
  const valuePrev = sum(prev, "value");
  const withSales = sum(period, "stores");
  const withSalesPrev = sum(prev, "stores");
  const storeBase = scopeIds.reduce((t, id) => t + (activeStores.get(id) ?? 0), 0);
  const rotation = withSales ? units / withSales : 0;
  const rotationPrev = withSalesPrev ? unitsPrev / withSalesPrev : 0;
  const unitsYearAgo = sum(lastYear, "units", yearAgo);

  // Una serie por cliente en el orden de su venta del mes; pasado el séptimo, «Otros».
  const ranked = [...monthly.entries()].sort((a, b) => (b[1].get(period)?.units ?? 0) - (a[1].get(period)?.units ?? 0));
  const head = companyId ? ranked : ranked.slice(0, SERIES.length - 1);
  const tail = companyId ? [] : ranked.slice(SERIES.length - 1);
  const lineSeries = [
    ...head.map(([id], i) => ({ name: nameOf.get(id) ?? "—", color: SERIES[i] })),
    ...(tail.length ? [{ name: `Otros (${tail.length})`, color: "var(--text-muted)" }] : []),
  ];
  const lineData = periods.map((p) => ({
    label: periodLabel(p),
    values: [
      ...head.map(([, months]) => months.get(p)?.units ?? 0),
      ...(tail.length ? [tail.reduce((t, [, months]) => t + (months.get(p)?.units ?? 0), 0)] : []),
    ],
  }));

  const sellInOf = (id: string, p: string) => sellIn.get(id)?.get(p) ?? 0;
  const sellInData = periods.map((p) => ({
    label: periodLabel(p),
    values: [scopeIds.reduce((t, id) => t + sellInOf(id, p), 0), sum(p, "units")],
  }));

  const rows = companies
    .filter((c) => scopeIds.includes(c.id))
    .map((c) => {
      const m = monthly.get(c.id);
      const now = m?.get(period);
      const before = m?.get(prev);
      const out3 = sellThroughPeriods.reduce((t, p) => t + (m?.get(p)?.units ?? 0), 0);
      const in3 = sellThroughPeriods.reduce((t, p) => t + sellInOf(c.id, p), 0);
      return {
        id: c.id,
        name: c.name,
        units: now?.units ?? 0,
        value: now?.value ?? 0,
        vsPrev: change(now?.units ?? 0, before?.units ?? 0),
        vsYear: change(now?.units ?? 0, yearAgo.get(c.id)?.get(lastYear)?.units ?? 0),
        stores: now?.stores ?? 0,
        base: activeStores.get(c.id) ?? 0,
        rotation: now?.stores ? now.units / now.stores : 0,
        sellThrough: in3 > 0 ? (out3 / in3) * 100 : null,
        loaded: Boolean(now),
      };
    })
    .sort((a, b) => b.units - a.units);

  const stopped = stores.filter((s) => s.units === 0 && s.average > 0).sort((a, b) => b.average - a.average);
  const selling = stores.filter((s) => s.units > 0);

  const pageMonths = available.slice(0, 18);

  return (
    <>
      {header}

      <Filters
        fields={[
          { type: "select", name: "cliente", label: "Todos los clientes", options: companies.map((c) => ({ value: c.id, label: c.name })), width: "w-64" },
          { type: "select", name: "mes", label: "Último mes cargado", options: pageMonths.map((p) => ({ value: p, label: fmtPeriod(p) })), width: "w-56" },
        ]}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Unidades vendidas"
          value={fmtNumber(units)}
          delta={change(units, unitsPrev)}
          hint={`vs ${fmtPeriod(prev)}${unitsYearAgo ? ` · ${fmtNumber(unitsYearAgo)} hace un año` : ""}`}
          icon={<IconRotation size={15} />}
        />
        <StatTile label="Valor a precio de lista" value={fmtCompact(value)} delta={change(value, valuePrev)} hint="Unidades × precio mayorista" />
        <StatTile
          label="Tiendas con venta"
          value={fmtNumber(withSales)}
          delta={change(withSales, withSalesPrev)}
          hint={storeBase ? `de ${fmtNumber(storeBase)} activas (${Math.round((withSales / storeBase) * 100)} %)` : undefined}
          icon={<IconStore size={15} />}
        />
        <StatTile label="Rotación por tienda" value={fmtNumber(Math.round(rotation * 10) / 10)} delta={change(rotation, rotationPrev)} hint="Unidades al mes en cada tienda con venta" />
      </div>

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader title="Unidades vendidas al consumidor" subtitle={`Últimos ${WINDOW} meses${companyId ? "" : " por cliente"}`} />
          <div className="px-4 py-3">
            <LineChart data={lineData} series={lineSeries} format="number" area={false} />
          </div>
        </Card>
        <Card className="min-w-0">
          <CardHeader
            title="Sell-in frente a sell-out"
            subtitle="Unidades que facturamos contra unidades que salieron de la góndola. Si el sell-in corre por encima varios meses, el inventario se acumula en la cadena."
          />
          <div className="px-4 py-3">
            <GroupedBarChart
              data={sellInData}
              series={[
                { name: "Sell-in (facturado)", color: "var(--series-1)" },
                { name: "Sell-out (vendido)", color: "var(--series-2)" },
              ]}
              format="number"
            />
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title={`Rendimiento por cliente · ${fmtPeriod(period)}`} subtitle="Sell-through: lo vendido al consumidor sobre lo facturado en los últimos 3 meses." />
        <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th>Cliente</th>
                <th className="num">Unidades</th>
                <th className="num">vs mes anterior</th>
                <th className="num">vs hace un año</th>
                <th className="num">Valor a lista</th>
                <th className="num">Tiendas con venta</th>
                <th className="num">Rotación / tienda</th>
                <th className="num">Sell-through 3 m</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/sell-out?cliente=${r.id}&mes=${period}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                      {r.name}
                    </Link>
                    {!r.loaded && <p className="text-[11.5px] text-[var(--tone-warning-fg)]">Sin reporte cargado para este mes</p>}
                  </td>
                  <td className="num font-semibold">{r.loaded ? fmtNumber(r.units) : "—"}</td>
                  <td className="num">{r.loaded ? <Delta value={r.vsPrev} /> : "—"}</td>
                  <td className="num">{r.loaded ? <Delta value={r.vsYear} /> : "—"}</td>
                  <td className="num">{r.loaded ? fmtCompact(r.value) : "—"}</td>
                  <td className="num">
                    {r.loaded ? `${fmtNumber(r.stores)}` : "—"}
                    {r.loaded && r.base > 0 && <span className="text-[var(--text-muted)]"> / {fmtNumber(r.base)}</span>}
                  </td>
                  <td className="num">{r.loaded ? fmtNumber(Math.round(r.rotation * 10) / 10) : "—"}</td>
                  <td className="num">
                    {r.sellThrough == null ? (
                      <span className="text-[var(--text-muted)]">Sin sell-in</span>
                    ) : (
                      <span style={{ color: r.sellThrough < 70 ? "var(--critical)" : undefined }}>{fmtNumber(Math.round(r.sellThrough))} %</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-3">
        {companyId ? (
          <>
            <Card>
              <CardHeader title="Tiendas que más rotan" subtitle={`${fmtNumber(selling.length)} con venta en ${fmtPeriod(period)}`} />
              <RankingBars
                format="number"
                items={selling.slice(0, 15).map((s) => ({
                  label: s.name,
                  value: s.units,
                  href: `/tiendas/${s.id}`,
                  sub: s.prev ? `${s.prev} el mes anterior` : "sin venta el mes anterior",
                }))}
              />
            </Card>
            <Card>
              <CardHeader
                title="Tiendas que dejaron de rotar"
                subtitle={`Vendían en los ${ROTATION_LOOKBACK} meses previos y en ${fmtPeriod(period)} no vendieron nada: casi siempre es quiebre o producto fuera de góndola.`}
              />
              {stopped.length === 0 ? (
                <p className="px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">Ninguna. Todas las tiendas que vendían siguen rotando.</p>
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {stopped.slice(0, 15).map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <Link href={`/tiendas/${s.id}`} className="block truncate text-[13px] font-medium hover:text-[var(--brand)] hover:underline">
                          {s.name}
                        </Link>
                        <p className="text-[11.5px] text-[var(--text-muted)]">{s.code} · {s.city}</p>
                      </div>
                      <span className="shrink-0 text-right text-[12px] tabular text-[var(--text-secondary)]">
                        {fmtNumber(Math.round(s.average * 10) / 10)} u/mes antes
                      </span>
                    </li>
                  ))}
                  {stopped.length > 15 && <li className="px-4 py-2 text-[12px] text-[var(--text-muted)]">y {stopped.length - 15} más</li>}
                </ul>
              )}
            </Card>
          </>
        ) : (
          <Card className="xl:col-span-2">
            <CardHeader title="Detalle por tienda" />
            <EmptyState
              icon={<IconStore size={24} />}
              title="Elige un cliente"
              description="Al filtrar por cliente verás qué tiendas más rotan y cuáles dejaron de vender, para mandar al equipo de campo."
            />
          </Card>
        )}
        <Card>
          <CardHeader title="Productos" subtitle={`Unidades en ${fmtPeriod(period)}`} />
          <RankingBars
            format="number"
            items={products.slice(0, 12).map((p) => ({
              label: `${p.imageEmoji} ${p.name}`,
              value: p.units,
              href: `/productos?q=${encodeURIComponent(p.sku)}`,
              sub: p.prev ? `${p.prev} el mes anterior` : undefined,
            }))}
          />
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Últimas cargas" subtitle="Cada carga reemplaza los meses que trae para ese cliente." />
        {imports.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">Sin cargas registradas.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {imports.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-[12.5px]">
                <div className="min-w-0">
                  <p className="font-medium">
                    {i.company.name}
                    <span className="font-normal text-[var(--text-muted)]"> · {periodRange(i.periods.split(","))}</span>
                  </p>
                  <p className="text-[11.5px] text-[var(--text-muted)]">
                    {i.fileName ?? "API"}{i.sheet ? ` › ${i.sheet}` : ""} · {i.user?.name ?? "Sistema"} · {fmtDateTime(i.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3 tabular">
                  <span>{fmtNumber(i.units)} u</span>
                  {i.skippedRows > 0 && (
                    <span className="inline-flex items-center gap-1 text-[var(--critical)]" title="Filas cuya tienda o producto no se reconoció">
                      <IconAlert size={12} /> {fmtNumber(i.skippedRows)} filas sin casar ({fmtNumber(i.skippedUnits)} u)
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
