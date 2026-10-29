import Link from "next/link";
import { isExpense, statementRows, subtotals, val, type BudgetSettings, type Lines, type Rubro } from "@/lib/budget-lines";
import { fmtMoney, fmtPct } from "@/lib/format";

export type Thresholds = { warn: number; tolerance: number };
export const thresholdsOf = (s: BudgetSettings): Thresholds => ({ warn: s.warnPct, tolerance: s.expenseTolerancePct });

/**
 * Cumplimiento: verde desde el 100 %, ámbar desde el umbral configurado, rojo
 * por debajo. En gastos, al revés: verde hasta 100 %, ámbar hasta la
 * tolerancia. El número siempre acompaña al color.
 */
export function Attainment({ real, budget, expense = false, t = { warn: 90, tolerance: 110 } }: { real: number; budget: number; expense?: boolean; t?: Thresholds }) {
  if (!budget) return <span className="text-[var(--text-muted)]">—</span>;
  const pct = (real / budget) * 100;
  const good = expense ? pct <= 100 : pct >= 100;
  const near = expense ? pct <= t.tolerance : pct >= t.warn;
  const color = good ? "var(--good)" : near ? "var(--warning)" : "var(--critical)";
  return <span className="font-semibold tabular" style={{ color }}>{fmtPct(pct, 0)}</span>;
}

/** Desviación en plata contra el presupuesto, con signo; en gastos, gastar de más es lo malo. */
export function Deviation({ value, format = fmtMoney, expense = false }: { value: number; format?: (v: number) => string; expense?: boolean }) {
  if (Math.round(value) === 0) return <span className="text-[var(--text-muted)]">—</span>;
  const good = expense ? value < 0 : value > 0;
  return (
    <span className="whitespace-nowrap font-medium tabular" style={{ color: good ? "var(--good)" : "var(--critical)" }}>
      {value > 0 ? "+" : "−"}{format(Math.abs(value))}
    </span>
  );
}

/** Diferencia en puntos porcentuales, con signo explícito. */
export const pp = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1).replace(".", ",")} pp`;

const TABS = [
  { href: "/gerencia/presupuesto", label: "Resultados" },
  { href: "/gerencia/presupuesto/general", label: "Presupuesto general" },
  { href: "/gerencia/presupuesto/participacion", label: "Participación por cliente" },
  { href: "/gerencia/presupuesto/configuracion", label: "Configuración" },
];

/** Las caras del presupuesto: cómo va, el todo, lo que le toca a cada cliente y los criterios con que se mide. */
export function BudgetTabs({ active, year }: { active: string; year: number }) {
  return (
    <nav className="mb-4 flex flex-wrap gap-1.5 border-b border-[var(--border)] pb-3">
      {TABS.map((t) => (
        <Link key={t.href} href={`${t.href}?anio=${year}`} className={`btn ${active === t.href ? "btn-secondary" : "btn-ghost"} !py-1 text-[12.5px]`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Estado de resultados presupuesto contra real, por rubro y con sus
 * subtotales. Debajo de cada cifra, su peso sobre los ingresos.
 */
export function StatementTable({ budget, real, rubros, t, showReal = true }: { budget: Lines; real: Lines; rubros: Rubro[]; t: Thresholds; showReal?: boolean }) {
  const sb = subtotals(budget, rubros);
  const sr = subtotals(real, rubros);
  const weight = (v: number, base: number) => (base ? <span className="block text-[11px] text-[var(--text-muted)]">{fmtPct((v / base) * 100)}</span> : null);
  return (
    <div className="scroll-x">
      <table className="tbl">
        <thead>
          <tr>
            <th>Rubro</th>
            <th className="num">Presupuesto</th>
            {showReal && <th className="num">Real</th>}
            {showReal && <th className="num">Desviación</th>}
            {showReal && <th className="num">Ejecución</th>}
          </tr>
        </thead>
        <tbody>
          {statementRows(rubros).map((row) => {
            const isRubro = row.kind === "rubro";
            const b = isRubro ? val(budget, row.rubro.key) : sb[row.key];
            const r = isRubro ? val(real, row.rubro.key) : sr[row.key];
            const expense = isRubro && isExpense(row.rubro);
            return (
              <tr key={isRubro ? row.rubro.key : row.key} className={isRubro ? undefined : "bg-[var(--surface-2)]"}>
                <td className={isRubro ? "text-[var(--text-secondary)]" : "font-semibold"}>
                  {isRubro ? row.rubro.label : row.label}
                  {isRubro && row.rubro.source === "REPARTIDO" && showReal && <span className="ml-1.5 text-[11px] text-[var(--text-muted)]">repartido</span>}
                </td>
                <td className={`num ${isRubro ? "" : "font-semibold"}`}>{b ? fmtMoney(b) : "—"}{weight(b, sb.sales)}</td>
                {showReal && <td className={`num ${isRubro ? "" : "font-semibold"}`} style={!isRubro && r < 0 ? { color: "var(--critical)" } : undefined}>{r ? fmtMoney(r) : "—"}{weight(r, sr.sales)}</td>}
                {showReal && <td className="num">{b || r ? <Deviation value={r - b} expense={expense} /> : "—"}</td>}
                {showReal && <td className="num">{b > 0 ? <Attainment real={r} budget={b} expense={expense} t={t} /> : "—"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const clientLink = (id: string, year: number, periodo?: string) => `/gerencia/presupuesto/${id}?anio=${year}${periodo ? `&periodo=${periodo}` : ""}`;
