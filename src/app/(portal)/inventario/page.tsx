import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { expiryReport } from "@/lib/analytics";
import { EXPIRY_BANDS, LOT_STATUS } from "@/lib/enums";
import { fmtCompact, fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";
import { Card, CardHeader, EnumBadge, PageHeader, StatTile } from "@/components/ui";
import { CompositionBar, RankingBars } from "@/components/charts";
import { IconExpiry, IconInventory, IconAlert, IconSales } from "@/components/icons";

export const metadata = { title: "Inventario y vencimientos" };
export const dynamic = "force-dynamic";

const BAND_COLOR: Record<string, string> = {
  VENCIDO: "var(--critical)",
  CRITICO: "var(--serious)",
  ALERTA: "var(--warning)",
  VIGILAR: "var(--seq-400)",
  SANO: "var(--good)",
};
const BAND_TONE: Record<string, "danger" | "warning" | "info" | "success"> = {
  VENCIDO: "danger", CRITICO: "danger", ALERTA: "warning", VIGILAR: "info", SANO: "success",
};

/** La banda de caducidad determina qué hacer con el lote, no sólo cómo pintarlo. */
const ACTION: Record<string, string> = {
  VENCIDO: "Dar de baja y registrar merma",
  CRITICO: "Liquidar o canjear esta semana",
  ALERTA: "Empujar por canal mayorista con descuento",
  VIGILAR: "Priorizar en despachos (FEFO)",
  SANO: "Rotación normal",
};

export default async function InventarioPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection("inventario");
  const sp = await searchParams;
  const band = one(sp.banda);
  const warehouseId = one(sp.bodega);
  const category = one(sp.categoria);

  const [report, warehouses] = await Promise.all([
    expiryReport(),
    prisma.warehouse.findMany({ orderBy: { name: "asc" } }),
  ]);

  const categories = [...new Set(report.rows.map((r) => r.product.category))].sort();

  // Sin filtro explícito la tabla muestra sólo lo accionable (≤ 90 días);
  // "TODAS" abre el inventario completo.
  const bandMatch = (r: (typeof report.rows)[number]) =>
    band === "TODAS" ? true : band ? r.band === band : r.daysToExpiry <= 90;

  const filtered = report.rows.filter(
    (r) =>
      bandMatch(r) &&
      (!warehouseId || r.warehouse.id === warehouseId) &&
      (!category || r.product.category === category),
  );

  // Riesgo = todo lo que vence en 90 días o menos.
  const risky = filtered.filter((r) => r.daysToExpiry <= 90);
  const byCategory = new Map<string, number>();
  const byWarehouse = new Map<string, number>();
  for (const r of report.atRisk) {
    byCategory.set(r.product.category, (byCategory.get(r.product.category) ?? 0) + r.valueAtRisk);
    byWarehouse.set(r.warehouse.name, (byWarehouse.get(r.warehouse.name) ?? 0) + r.valueAtRisk);
  }

  const expired = report.byBand.get("VENCIDO")!;
  const critical = report.byBand.get("CRITICO")!;

  const linkFor = (params: Record<string, string>) => {
    const q = new URLSearchParams({ ...(band ? { banda: band } : {}), ...(warehouseId ? { bodega: warehouseId } : {}), ...(category ? { categoria: category } : {}), ...params });
    for (const [k, v] of [...q.entries()]) if (!v) q.delete(k);
    const s = q.toString();
    return s ? `/inventario?${s}` : "/inventario";
  };

  return (
    <>
      <PageHeader
        title="Inventario y vencimientos"
        subtitle="Control de caducidad por lote. La banda de vencimiento define la acción: liquidar, empujar por canal mayorista, priorizar en despacho o dar de baja."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Valor en bodega" value={fmtCompact(report.totalValue)} hint={`${fmtNumber(report.totalUnits)} unidades en ${fmtNumber(report.rows.length)} lotes`} icon={<IconInventory size={15} />} />
        <StatTile label="En riesgo ≤ 90 días" value={fmtCompact(report.riskValue)} hint={`${((report.riskValue / Math.max(1, report.totalValue)) * 100).toFixed(0)}% del valor total`} icon={<IconExpiry size={15} />} />
        <StatTile label="Acción inmediata ≤ 30 días" value={fmtCompact(critical.value)} hint={`${fmtNumber(critical.lots)} lotes · ${fmtNumber(critical.units)} unidades`} icon={<IconAlert size={15} />} />
        <StatTile label="Ya vencido" value={fmtCompact(expired.value)} hint={`${fmtNumber(expired.lots)} lotes bloqueados para despacho`} icon={<IconSales size={15} />} />
      </div>

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader title="Semáforo de vencimiento" subtitle="Valor al costo por banda. Toca una banda para filtrar la tabla." />
          <div className="px-4 py-4">
            <CompositionBar
              segments={EXPIRY_BANDS.map((b) => ({ label: b.label, value: report.byBand.get(b.key)!.value, color: BAND_COLOR[b.key] }))}
              format="compact"
            />
            <div className="mt-4 flex flex-wrap gap-1.5">
              <Link href={linkFor({ banda: "" })} className={`badge ${band ? "badge-neutral" : "badge-info"}`}>
                En riesgo ≤ 90 d ({fmtNumber(report.atRisk.length)})
              </Link>
              {EXPIRY_BANDS.map((b) => (
                <Link key={b.key} href={linkFor({ banda: b.key })} className={`badge ${band === b.key ? `badge-${BAND_TONE[b.key]}` : "badge-neutral"}`}>
                  {b.label} ({fmtNumber(report.byBand.get(b.key)!.lots)})
                </Link>
              ))}
              <Link href={linkFor({ banda: "TODAS" })} className={`badge ${band === "TODAS" ? "badge-info" : "badge-neutral"}`}>
                Todo el inventario ({fmtNumber(report.rows.length)})
              </Link>
            </div>
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <Card>
            <CardHeader title="Riesgo por categoría" subtitle="Valor que vence en 90 días o menos" />
            <RankingBars
              items={[...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v, href: linkFor({ categoria: k }) }))}
              format="compact"
              color="var(--serious)"
            />
          </Card>
          <Card>
            <CardHeader title="Riesgo por bodega" />
            <RankingBars
              items={[...byWarehouse.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v }))}
              format="compact"
              color="var(--warning)"
            />
          </Card>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <form className="flex flex-wrap items-center gap-2">
          {band && <input type="hidden" name="banda" value={band} />}
          <select name="bodega" defaultValue={warehouseId} className="field w-52">
            <option value="">Todas las bodegas</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <select name="categoria" defaultValue={category} className="field w-48">
            <option value="">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button className="btn btn-secondary">Aplicar</button>
          {(warehouseId || category || band) && (
            <Link href="/inventario" className="btn btn-ghost text-[12.5px]">Limpiar</Link>
          )}
        </form>
        <span className="text-[12.5px] text-[var(--text-muted)]">
          {fmtNumber(filtered.length)} lotes · {fmtMoney(risky.reduce((s, r) => s + r.valueAtRisk, 0))} en riesgo
        </span>
      </div>

      <Card className="mt-3">
        <CardHeader
          title={
            band === "TODAS"
              ? "Todos los lotes"
              : band
                ? `Lotes · ${EXPIRY_BANDS.find((b) => b.key === band)?.label}`
                : "Lotes por vencer en 90 días o menos"
          }
          subtitle="Ordenados por proximidad de vencimiento (FEFO)"
        />
        <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Lote</th>
                <th>Bodega</th>
                <th className="num">Unidades</th>
                <th>Vence</th>
                <th className="num">Días</th>
                <th className="num">Valor en riesgo</th>
                <th>Estado</th>
                <th>Acción sugerida</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 80).map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/productos/${r.product.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                      {r.product.imageEmoji} {r.product.name}
                    </Link>
                    <p className="font-mono text-[11px] text-[var(--text-muted)]">{r.product.sku} · {r.product.category}</p>
                  </td>
                  <td className="font-mono text-[12px]">{r.lotCode}</td>
                  <td className="text-[var(--text-secondary)]">{r.warehouse.name}</td>
                  <td className="num">{fmtNumber(r.quantity)}</td>
                  <td className="whitespace-nowrap">{fmtDate(r.expiryDate)}</td>
                  <td className="num">
                    <span className={`badge badge-${BAND_TONE[r.band]}`}>
                      {r.daysToExpiry < 0 ? `${Math.abs(r.daysToExpiry)} d vencido` : `${r.daysToExpiry} d`}
                    </span>
                  </td>
                  <td className="num font-semibold">{fmtMoney(r.valueAtRisk)}</td>
                  <td><EnumBadge option={LOT_STATUS.get(r.status)} /></td>
                  <td className="text-[12px] text-[var(--text-secondary)]">{ACTION[r.band]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > 80 && (
          <p className="border-t border-[var(--border)] px-4 py-2.5 text-[12px] text-[var(--text-muted)]">
            Mostrando los 80 lotes más próximos a vencer de {fmtNumber(filtered.length)}. Filtra por bodega o categoría para acotar.
          </p>
        )}
      </Card>
    </>
  );
}
