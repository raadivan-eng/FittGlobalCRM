import Link from "next/link";
import { Fragment } from "react";
import { requireSection } from "@/lib/auth";
import { GROUPS, statementFor, statementYears, type GroupKey, type Totals } from "@/lib/income-statement";
import { fmtCompact, fmtNumber, fmtPct } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";
import { Card, EmptyState, PageHeader, StatTile } from "@/components/ui";
import { IconReports } from "@/components/icons";
import { GerenciaTabs } from "../tabs";

export const metadata = { title: "Estado de resultados" };
export const dynamic = "force-dynamic";

/** Subtotales que cierran cada bloque del estado, en el orden del reporte contable. */
const SUBTOTALS: Partial<Record<GroupKey, { key: keyof Totals; label: string; final?: boolean }>> = {
  COSTO: { key: "grossProfit", label: "Ganancia bruta" },
  OTROS_GASTOS: { key: "beforeFinancial", label: "Ganancia antes de financieros" },
  FINANCIEROS: { key: "beforeTax", label: "Ganancia (pérdida) antes de impuestos" },
  IMPUESTOS: { key: "net", label: "Ganancia (pérdida)", final: true },
};

const monthLabel = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-CO", { month: "short" }).replace(".", "");
};

/** Cifra y su peso sobre los ingresos del mismo mes, como en la hoja. */
function Amount({ value, base, strong = false, signed = false }: { value: number | undefined; base: number; strong?: boolean; signed?: boolean }) {
  if (!value) return <span className="text-[var(--text-muted)]">—</span>;
  return (
    <>
      <span className={strong ? "font-semibold" : undefined} style={signed && value < 0 ? { color: "var(--critical)" } : undefined}>
        {fmtNumber(Math.round(value))}
      </span>
      {base > 0 && <span className="block text-[11px] text-[var(--text-muted)]">{fmtPct((value / base) * 100)}</span>}
    </>
  );
}

export default async function ResultadosPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection("gerencia");
  const sp = await searchParams;
  const years = await statementYears();
  const year = Number(one(sp.anio)) || years[0] || new Date().getFullYear();
  const detail = one(sp.detalle) !== "no";
  const { periods, accounts, totals, yearTotals } = await statementFor(year);

  const upload = (
    <Link href="/gerencia/resultados/cargar" className="btn btn-primary">Cargar estado de resultados</Link>
  );

  const header = (
    <PageHeader
      title="Estado de resultados"
      subtitle="Lo que reporta la contabilidad, mes a mes y por cuenta: lo que de verdad quedó después de costos, gastos e impuestos."
      actions={
        <>
          {years.length > 0 && (
            <form className="flex items-center gap-2">
              <select name="anio" defaultValue={year} className="field w-28">
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <select name="detalle" defaultValue={detail ? "si" : "no"} className="field w-40">
                <option value="si">Con cuentas</option>
                <option value="no">Sólo grupos</option>
              </select>
              <button className="btn btn-secondary">Aplicar</button>
            </form>
          )}
          {upload}
        </>
      }
    />
  );

  if (!periods.length) {
    return (
      <>
        {header}
        <GerenciaTabs active="/gerencia/resultados" />
        <Card>
          <EmptyState
            icon={<IconReports size={28} />}
            title={`Sin estado de resultados para ${year}`}
            description="Sube el Excel del estado de resultados con una columna por mes. Verás los totales de cada mes antes de guardarlo."
            action={upload}
          />
        </Card>
      </>
    );
  }

  const income = yearTotals.INGRESOS;
  const opex = yearTotals.PERSONAL + yearTotals.OTROS_GASTOS;
  const ratio = (v: number) => (income > 0 ? fmtPct((v / income) * 100) : "—");
  const range = periods.length === 1 ? monthLabel(periods[0]) : `${monthLabel(periods[0])} – ${monthLabel(periods[periods.length - 1])}`;

  const totalRow = (label: string, key: keyof Totals, kind: "group" | "subtotal" | "final") => (
    <tr
      className={kind === "group" ? "bg-[var(--surface-2)]" : undefined}
      style={kind !== "group" ? { borderTop: "2px solid var(--border-strong)" } : undefined}
    >
      <td className="sticky left-0 z-[1] bg-inherit font-semibold" style={{ background: kind === "group" ? "var(--surface-2)" : "var(--surface-1)" }}>
        {label}
      </td>
      {periods.map((p) => (
        <td key={p} className="num">
          <Amount value={totals.get(p)![key]} base={totals.get(p)!.INGRESOS} strong signed={kind !== "group"} />
        </td>
      ))}
      <td className="num">
        <Amount value={yearTotals[key]} base={income} strong signed={kind !== "group"} />
      </td>
    </tr>
  );

  return (
    <>
      {header}
      <GerenciaTabs active="/gerencia/resultados" />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={`Ingresos netos ${year}`} value={fmtCompact(income)} hint={`${range} · después de devoluciones`} />
        <StatTile label="Margen bruto" value={ratio(yearTotals.grossProfit)} hint={`${fmtCompact(yearTotals.grossProfit)} de ganancia bruta`} />
        <StatTile label="Gasto operativo" value={ratio(opex)} hint={`${fmtCompact(opex)} en personal y otros gastos`} />
        <StatTile label="Ganancia (pérdida)" value={fmtCompact(yearTotals.net)} hint={`Margen neto ${ratio(yearTotals.net)}`} />
      </div>

      <Card className="mt-5">
        <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th className="sticky left-0 z-[2] min-w-[16rem]">Cuenta</th>
                {periods.map((p) => <th key={p} className="num capitalize">{monthLabel(p)}</th>)}
                <th className="num">Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {GROUPS.map((g) => {
                const rows = accounts.filter((a) => a.group === g.key);
                const sub = SUBTOTALS[g.key];
                if (!rows.length && !sub) return null;
                return (
                  <Fragment key={g.key}>
                    {totalRow(g.label, g.key, "group")}
                    {detail &&
                      rows.map((a) => (
                        <tr key={a.code}>
                          <td className="sticky left-0 z-[1] bg-[var(--surface-1)] text-[var(--text-secondary)]">
                            <span className="tabular text-[var(--text-muted)]">{a.code}</span> {a.name}
                          </td>
                          {periods.map((p) => (
                            <td key={p} className="num">
                              <Amount value={a.amounts.get(p)} base={totals.get(p)!.INGRESOS} />
                            </td>
                          ))}
                          <td className="num">
                            <Amount value={a.total} base={income} />
                          </td>
                        </tr>
                      ))}
                    {sub && totalRow(sub.label, sub.key, sub.final ? "final" : "subtotal")}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-[var(--border)] px-4 py-2.5 text-[12px] text-[var(--text-muted)]">
          Debajo de cada cifra, su peso sobre los ingresos del mes. Las cuentas se agrupan por su código PUC; {fmtNumber(accounts.length)} cuentas con movimiento en {year}.
        </p>
      </Card>
    </>
  );
}
