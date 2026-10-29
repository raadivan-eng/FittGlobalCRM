import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { leadForecasts, periodKey, periodShort, startOfMonth } from "@/lib/analytics";
import { NO_PRODUCT, documentShares, forecastExecution, rollUp, type Cell, type DocShare, type ExecutionRow } from "@/lib/forecast-execution";
import { fmtCompact, fmtDate, fmtMoney, fmtNumber, fmtPeriod } from "@/lib/format";
import { flatten, many, one, pageCount, pagination, type SearchParams } from "@/lib/params";
import { Card, CardHeader, PageHeader, StatTile } from "@/components/ui";
import { Filters } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import { GroupedBarChart } from "@/components/charts";
import { IconForecast, IconSales, IconTarget } from "@/components/icons";
import { ForecastTabs } from "../tabs";

export const metadata = { title: "Forecast vs ejecución" };
export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "cliente", label: "Por cliente" },
  { key: "producto", label: "Por producto" },
  { key: "detalle", label: "Producto × cliente" },
] as const;
type View = (typeof VIEWS)[number]["key"];

const SORTS = [
  { value: "brecha", label: "Mayor faltante primero" },
  { value: "forecast", label: "Mayor forecast primero" },
  { value: "real", label: "Mayor venta primero" },
];

/** Doce meses atrás y tres adelante: lo que se puede proyectar y medir. */
function periodOptions(now: Date) {
  return Array.from({ length: 16 }, (_, i) => periodKey(startOfMonth(i - 12, now)));
}

function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  const [fy, fm] = from.split("-").map(Number);
  for (let d = new Date(fy, fm - 1, 1); periodKey(d) <= to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) out.push(periodKey(d));
  return out;
}

/** Avance contra lo que ya debería estar facturado: verde desde 100 %, ámbar desde 80 %. */
function Progress({ row }: { row: ExecutionRow }) {
  if (row.expected <= 0) return <span className="text-[var(--text-muted)]">{row.real > 0 ? "Sin forecast" : "—"}</span>;
  const pct = (row.real / row.expected) * 100;
  const color = pct >= 100 ? "var(--good)" : pct >= 80 ? "var(--warning)" : "var(--critical)";
  return <span className="font-semibold tabular" style={{ color }}>{pct.toFixed(0)}%</span>;
}

function Gap({ row }: { row: ExecutionRow }) {
  const gap = row.real - row.expected;
  if (row.expected <= 0 || Math.round(gap) === 0) return <span className="text-[var(--text-muted)]">—</span>;
  return (
    <span className="whitespace-nowrap font-medium tabular" style={{ color: gap > 0 ? "var(--good)" : "var(--critical)" }}>
      {gap > 0 ? "+" : "−"}{fmtMoney(Math.abs(gap))}
    </span>
  );
}

/** Hasta cuántos documentos lista el desglose de un valor. */
const SOURCE_LIMIT = 200;

const monthStart = (period: string) => new Date(Number(period.slice(0, 4)), Number(period.slice(5)) - 1, 1);

const units = (v: number) => (v > 0 ? fmtNumber(Math.round(v)) : "—");

export default async function EjecucionPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection("forecast");
  const sp = await searchParams;
  const now = new Date();
  const options = periodOptions(now);
  const current = periodKey(startOfMonth(0, now));
  const to = options.includes(one(sp.hasta)) ? one(sp.hasta) : current;
  const fromRaw = options.includes(one(sp.desde)) ? one(sp.desde) : to;
  const from = fromRaw <= to ? fromRaw : to;
  const view: View = VIEWS.find((v) => v.key === one(sp.vista))?.key ?? "cliente";
  const sort = SORTS.find((s) => s.value === one(sp.orden))?.value ?? "brecha";
  const clientIds = many(sp.cliente);
  const productIds = many(sp.producto);
  const categories = many(sp.categoria);
  // Por defecto la ejecución es lo facturado; el filtro le descuenta las notas crédito.
  const credits = one(sp.nc) === "con";
  const origin = one(sp.origen);

  const range = monthsBetween(from, to);
  const chart = Array.from({ length: 12 }, (_, i) => periodKey(startOfMonth(i - 11, new Date(Number(to.slice(0, 4)), Number(to.slice(5)) - 1, 1))));

  const [cells, companies, products, leads, shares] = await Promise.all([
    forecastExecution([...new Set([...chart, ...range])], credits),
    prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, owner: { select: { name: true } } } }),
    prisma.product.findMany({ orderBy: { name: "asc" }, select: { id: true, sku: true, name: true, category: true, imageEmoji: true } }),
    leadForecasts(range),
    origin ? documentShares(monthStart(from), startOfMonth(1, monthStart(to)), credits) : Promise.resolve([] as DocShare[]),
  ]);
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const productById = new Map(products.map((p) => [p.id, p]));

  // Los filtros de producto y categoría dejan fuera lo facturado sin detalle de producto.
  const keep = (c: Pick<Cell, "companyId" | "productId">) =>
    (!clientIds.length || clientIds.includes(c.companyId)) &&
    (!productIds.length || productIds.includes(c.productId)) &&
    (!categories.length || categories.includes(productById.get(c.productId)?.category ?? ""));

  const total = rollUp(cells, range, () => "total", keep, now).get("total") ?? { key: "total", forecast: 0, forecastUnits: 0, expected: 0, real: 0, realUnits: 0 };
  const series = chart.map((p) => {
    const r = rollUp(cells, [p], () => "t", keep, now).get("t");
    return { label: periodShort(new Date(Number(p.slice(0, 4)), Number(p.slice(5)) - 1, 1)), values: [r?.forecast ?? 0, r?.real ?? 0] };
  });

  const rowKey = (c: Pick<Cell, "companyId" | "productId">) =>
    view === "cliente" ? c.companyId : view === "producto" ? c.productId : `${c.companyId}|${c.productId}`;
  const grouped = rollUp(cells, range, rowKey, keep, now);
  const sorted = [...grouped.values()]
    .filter((r) => r.forecast > 0 || Math.round(r.real) !== 0)
    .sort((a, b) =>
      sort === "forecast" ? b.forecast - a.forecast : sort === "real" ? b.real - a.real : a.real - a.expected - (b.real - b.expected),
    );
  const behind = sorted.filter((r) => r.expected > 0 && r.real / r.expected < 0.8).length;
  const { page, pageSize, skip } = pagination(sp.page, 50);
  const rows = sorted.slice(skip, skip + pageSize);

  // Cuántos productos y clientes se mueven en cada fila agregada.
  const breadth = new Map<string, Set<string>>();
  if (view !== "detalle") {
    for (const p of range)
      for (const c of cells.get(p)?.values() ?? []) {
        if (!keep(c) || (c.forecast <= 0 && c.real === 0)) continue;
        const k = view === "cliente" ? c.companyId : c.productId;
        const set = breadth.get(k) ?? new Set();
        set.add(view === "cliente" ? c.productId : c.companyId);
        breadth.set(k, set);
      }
  }

  // Desglose de un valor de ejecución: las facturas (y notas crédito) que lo forman, una fila por documento.
  const sources = new Map<string, DocShare>();
  for (const d of shares) {
    if (!range.includes(d.period) || !keep(d) || (origin !== "total" && rowKey(d) !== origin)) continue;
    const s = sources.get(d.docId);
    if (s) {
      s.amount += d.amount;
      s.units += d.units;
    } else sources.set(d.docId, { ...d });
  }
  const sourceRows = [...sources.values()].sort((a, b) => b.issueDate.getTime() - a.issueDate.getTime() || a.number.localeCompare(b.number));
  const sourceTotal = sourceRows.reduce((s, d) => ({ amount: s.amount + d.amount, units: s.units + d.units }), { amount: 0, units: 0 });
  const originLabel = (() => {
    if (origin === "total") return "Total del rango";
    const [companyId, productId] = view === "cliente" ? [origin, ""] : view === "producto" ? ["", origin] : origin.split("|");
    const product = productId === NO_PRODUCT ? "Sin detalle de producto" : productById.get(productId)?.name;
    return [companyById.get(companyId)?.name, product].filter(Boolean).join(" · ");
  })();

  const leadsTotal = range.reduce((s, p) => s + (leads.get(p)?.total ?? 0), 0);
  const partial = range.includes(current);
  const rangeLabel = from === to ? fmtPeriod(from) : `${fmtPeriod(from)} a ${fmtPeriod(to)}`;
  const params = flatten(sp);
  const withParams = (changes: Record<string, string | null>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") q.set(k, v);
    for (const [k, v] of Object.entries(changes)) (v ? q.set(k, v) : q.delete(k));
    return `/forecast/ejecucion?${q.toString()}`;
  };

  const productLabel = (id: string) => {
    if (id === NO_PRODUCT) return <span className="text-[var(--text-muted)]">Sin detalle de producto</span>;
    const p = productById.get(id);
    return p ? (
      <Link href={withParams({ vista: "detalle", producto: id })} className="font-medium hover:text-[var(--brand)] hover:underline">
        {p.imageEmoji} {p.name}
      </Link>
    ) : "—";
  };
  const clientLabel = (id: string) => (
    <Link href={withParams({ vista: "detalle", cliente: id })} className="font-medium hover:text-[var(--brand)] hover:underline">
      {companyById.get(id)?.name ?? "—"}
    </Link>
  );
  const periodField = (name: string, prefix: string) => ({
    type: "select" as const,
    name,
    label: `${prefix}: mes actual`,
    width: "w-48",
    options: options.map((p) => ({ value: p, label: `${prefix}: ${fmtPeriod(p)}` })),
  });

  return (
    <>
      <PageHeader
        title="Forecast vs ejecución"
        subtitle="Lo proyectado contra lo facturado en Siigo, en total, por cliente, por producto y por producto dentro de cada cliente."
      />
      <ForecastTabs active="/forecast/ejecucion" />

      <Filters
        fields={[
          periodField("desde", "Desde"),
          periodField("hasta", "Hasta"),
          { type: "select", name: "cliente", label: "Todos los clientes", options: companies.map((c) => ({ value: c.id, label: c.name })), multi: true },
          { type: "select", name: "categoria", label: "Todas las categorías", options: [...new Set(products.map((p) => p.category))].sort().map((c) => ({ value: c, label: c })), multi: true },
          { type: "select", name: "producto", label: "Todos los productos", options: products.map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` })), multi: true },
          { type: "select", name: "nc", label: "Sin descontar notas crédito", width: "w-56", options: [{ value: "con", label: "Descontando notas crédito" }] },
        ]}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Forecast" value={fmtCompact(total.forecast)} hint={rangeLabel} icon={<IconForecast size={15} />} />
        <StatTile
          label="Ejecución"
          value={fmtCompact(total.real)}
          hint={[partial ? "Incluye el mes en curso, aún parcial" : `${fmtNumber(Math.round(total.realUnits))} unidades facturadas`, credits && "menos notas crédito"].filter(Boolean).join(" · ")}
          icon={<IconSales size={15} />}
        />
        <StatTile
          label="Avance"
          value={total.expected > 0 ? `${((total.real / total.expected) * 100).toFixed(0)}%` : "—"}
          hint={partial ? `Contra ${fmtCompact(total.expected)} esperados a la fecha` : total.expected > 0 ? `${fmtCompact(Math.abs(total.real - total.expected))} ${total.real >= total.expected ? "por encima" : "por debajo"}` : "El rango aún no empieza"}
          icon={<IconTarget size={15} />}
        />
        <StatTile
          label={view === "cliente" ? "Clientes bajo el 80 %" : view === "producto" ? "Productos bajo el 80 %" : "Combinaciones bajo el 80 %"}
          value={total.expected > 0 ? fmtNumber(behind) : "—"}
          hint={`de ${fmtNumber(sorted.filter((r) => r.expected > 0).length)} con forecast en el rango`}
        />
      </div>

      <Card className="mt-5">
        <CardHeader title="Forecast contra ejecución" subtitle={`Doce meses hasta ${fmtPeriod(to)}, con los filtros aplicados`} />
        <div className="px-4 py-4">
          <GroupedBarChart
            data={series}
            series={[
              { name: "Forecast", color: "var(--series-1)" },
              { name: "Ejecución", color: "var(--series-2)" },
            ]}
            format="compact"
          />
        </div>
      </Card>

      <Card className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <nav className="flex flex-wrap gap-2">
            {VIEWS.map((v) => (
              <Link key={v.key} href={withParams({ vista: v.key, origen: null })} className={`btn ${view === v.key ? "btn-primary" : "btn-secondary"} !py-1 text-[12.5px]`}>
                {v.label}
              </Link>
            ))}
          </nav>
          <nav className="flex flex-wrap gap-1.5 text-[12px]">
            {SORTS.map((s) => (
              <Link key={s.value} href={withParams({ orden: s.value })} className={`btn ${sort === s.value ? "btn-secondary" : "btn-ghost"} !px-2 !py-0.5`}>
                {s.label}
              </Link>
            ))}
          </nav>
        </div>
        {rows.length ? (
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  {view !== "producto" && <th>Cliente</th>}
                  {view !== "cliente" && <th>Producto</th>}
                  {view !== "detalle" && <th className="num">{view === "cliente" ? "Productos" : "Clientes"}</th>}
                  {view !== "cliente" && <th className="num">Unid. forecast</th>}
                  {view !== "cliente" && <th className="num">Unid. reales</th>}
                  <th className="num">Forecast</th>
                  <th className="num">Ejecución</th>
                  <th className="num">Avance</th>
                  <th className="num">Brecha</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const [companyId, productId] = view === "cliente" ? [r.key, ""] : view === "producto" ? ["", r.key] : r.key.split("|");
                  return (
                    <tr key={r.key}>
                      {view !== "producto" && (
                        <td>
                          {clientLabel(companyId)}
                          {view === "cliente" && companyById.get(companyId)?.owner && (
                            <span className="block text-[11.5px] text-[var(--text-muted)]">{companyById.get(companyId)!.owner!.name}</span>
                          )}
                        </td>
                      )}
                      {view !== "cliente" && (
                        <td>
                          {productLabel(productId)}
                          {view === "producto" && productById.get(productId) && (
                            <span className="block text-[11.5px] text-[var(--text-muted)]">{productById.get(productId)!.sku} · {productById.get(productId)!.category}</span>
                          )}
                        </td>
                      )}
                      {view !== "detalle" && <td className="num text-[var(--text-secondary)]">{fmtNumber(breadth.get(r.key)?.size ?? 0)}</td>}
                      {view !== "cliente" && <td className="num text-[var(--text-secondary)]">{units(r.forecastUnits)}</td>}
                      {view !== "cliente" && <td className="num">{units(r.realUnits)}</td>}
                      <td className="num">{r.forecast > 0 ? fmtMoney(r.forecast) : "—"}</td>
                      <td className="num font-semibold">
                        <Link href={`${withParams({ origen: r.key })}#origen`} title="Ver las facturas que forman este valor" className="hover:text-[var(--brand)] hover:underline">
                          {fmtMoney(r.real)}
                        </Link>
                      </td>
                      <td className="num"><Progress row={r} /></td>
                      <td className="num"><Gap row={r} /></td>
                    </tr>
                  );
                })}
                <tr style={{ borderTop: "2px solid var(--border-strong)" }}>
                  <td className="font-semibold" colSpan={2}>Total {sorted.length > rows.length ? `(${fmtNumber(sorted.length)} filas)` : ""}</td>
                  {view !== "cliente" && <td className="num font-semibold">{units(total.forecastUnits)}</td>}
                  {view !== "cliente" && <td className="num font-semibold">{units(total.realUnits)}</td>}
                  <td className="num font-semibold">{fmtMoney(total.forecast)}</td>
                  <td className="num font-semibold">
                    <Link href={`${withParams({ origen: "total" })}#origen`} title="Ver las facturas que forman este valor" className="hover:text-[var(--brand)] hover:underline">
                      {fmtMoney(total.real)}
                    </Link>
                  </td>
                  <td className="num"><Progress row={total} /></td>
                  <td className="num"><Gap row={total} /></td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">Nada proyectado ni facturado en {rangeLabel} con estos filtros.</p>
        )}
        <Pagination page={page} pageCount={pageCount(sorted.length, pageSize)} total={sorted.length} params={params} basePath="/forecast/ejecucion" />
        <div className="space-y-1 border-t border-[var(--border)] px-4 py-2.5 text-[12px] text-[var(--text-muted)]">
          <p>
            El forecast de cada producto es lo que el cliente le compró en promedio cada mes, con la misma ventana y meses excluidos que su forecast;
            si el forecast del cliente se fijó a mano, se reparte con esa mezcla. La ejecución es el neto facturado en Siigo, sin IVA
            {credits ? ", menos las notas crédito: cada una resta con la mezcla de productos de la factura que afecta" : "; las notas crédito no se descuentan salvo que lo pidas en el filtro"}.
            Haz clic en un valor de ejecución para ver las facturas de donde sale.
            {partial && " En el mes en curso el avance se mide contra la parte proporcional a los días transcurridos."}
          </p>
          {leadsTotal > 0 && (
            <p>{fmtCompact(leadsTotal)} de leads calientes con cierre en el rango no entran aquí: todavía no son clientes ni tienen productos.</p>
          )}
        </div>
      </Card>
      {origin && (
        <Card className="mt-5">
          <div id="origen" className="scroll-mt-4" />
          <CardHeader
            title={`De dónde sale la ejecución · ${originLabel}`}
            subtitle={`${rangeLabel}, con los filtros aplicados${credits ? ", descontando notas crédito" : ""}. «Aporta» es la parte del documento que le toca a esta fila.`}
            action={<Link href={withParams({ origen: null })} className="btn btn-ghost !px-2 !py-0.5 text-[12px]">Cerrar</Link>}
          />
          {sourceRows.length ? (
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Documento</th>
                    <th>Emisión</th>
                    <th>Cliente</th>
                    <th className="num">Unidades</th>
                    <th className="num">Neto del documento</th>
                    <th className="num">Aporta</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceRows.slice(0, SOURCE_LIMIT).map((d) => (
                    <tr key={d.docId}>
                      <td>
                        {d.invoiceId ? (
                          <Link href={`/ventas/facturas/${d.invoiceId}`} className="font-mono text-[12px] font-medium hover:text-[var(--brand)] hover:underline">
                            {d.number}
                          </Link>
                        ) : (
                          <span className="font-mono text-[12px] font-medium">{d.number}</span>
                        )}
                        <span className="block text-[11.5px] text-[var(--text-muted)]">{d.kind === "FACTURA" ? "Factura" : "Nota crédito"}</span>
                      </td>
                      <td className="whitespace-nowrap text-[var(--text-secondary)]">{fmtDate(d.issueDate)}</td>
                      <td>{companyById.get(d.companyId)?.name ?? "—"}</td>
                      <td className="num">{units(d.units)}</td>
                      <td className="num text-[var(--text-secondary)]">{fmtMoney(d.kind === "NOTA" ? -d.docNet : d.docNet)}</td>
                      <td className="num font-semibold" style={d.amount < 0 ? { color: "var(--critical)" } : undefined}>{fmtMoney(d.amount)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: "2px solid var(--border-strong)" }}>
                    <td className="font-semibold" colSpan={3}>
                      Total · {fmtNumber(sourceRows.length)} documentos{sourceRows.length > SOURCE_LIMIT ? ` (se muestran los ${SOURCE_LIMIT} más recientes)` : ""}
                    </td>
                    <td className="num font-semibold">{units(sourceTotal.units)}</td>
                    <td />
                    <td className="num font-semibold">{fmtMoney(sourceTotal.amount)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">Ningún documento facturado forma este valor en {rangeLabel}.</p>
          )}
        </Card>
      )}
    </>
  );
}
