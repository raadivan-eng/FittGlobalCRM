"use client";

import { Fragment, useActionState, useState } from "react";
import { guardarPresupuestoGeneral, type BudgetResult } from "@/lib/actions-management";
import { rubroOf, subtotals, sumLines, val, type Lines, type Rubro } from "@/lib/budget-lines";
import { fmtNumber, parseAmount, parsePct } from "@/lib/format";

const MM = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

export type EditorAccount = {
  code: string;
  name: string;
  /** Presupuesto guardado por mes («01»…«12»). */
  budget: Record<string, number>;
  /** Real de la contabilidad en el mismo mes de los últimos doce cerrados. */
  reference: Record<string, number>;
};

type Row = { code: string; name: string; months: string[]; reference: Record<string, number> };

const text = (v: number | undefined) => (v ? String(Math.round(v)) : "");
const num = (s: string) => parseAmount(s) ?? 0;

/**
 * Reparte un total anual en doce meses: según cómo se movió la cuenta en la
 * contabilidad (si tiene historia del mismo signo) o parejo.
 */
function spread(total: number, reference: Record<string, number>, mode: "ESTACIONAL" | "PAREJO") {
  const ref = MM.map((m) => reference[m] ?? 0);
  const base = ref.reduce((s, v) => s + v, 0);
  if (mode === "PAREJO" || base === 0 || ref.some((v) => Math.sign(v) === -Math.sign(base))) return MM.map(() => Math.round(total / 12));
  return ref.map((v) => Math.round((total * v) / base));
}

/**
 * El presupuesto general cuenta por cuenta y mes por mes. Cada fila admite el
 * total del año —se reparte al salir de la casilla— o el valor de cada mes.
 */
export function GeneralEditor({
  year,
  accounts,
  monthLabels,
  refLabel,
  rubros,
  defaultSpread,
}: {
  year: number;
  accounts: EditorAccount[];
  monthLabels: string[];
  refLabel: string;
  rubros: Rubro[];
  defaultSpread: "ESTACIONAL" | "PAREJO";
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    accounts.map((a) => ({ code: a.code, name: a.name, months: MM.map((m) => text(a.budget[m])), reference: a.reference })),
  );
  const [totals, setTotals] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"ESTACIONAL" | "PAREJO">(defaultSpread);
  const [growth, setGrowth] = useState("0");
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newError, setNewError] = useState("");
  const [state, action, pending] = useActionState<BudgetResult, FormData>(guardarPresupuestoGeneral, {});
  const hasReference = rows.some((r) => Object.keys(r.reference).length > 0);

  const setMonth = (code: string, i: number, value: string) =>
    setRows((rs) => rs.map((r) => (r.code === code ? { ...r, months: r.months.map((m, j) => (j === i ? value : m)) } : r)));
  const applyTotal = (code: string) => {
    const raw = totals[code];
    if (raw == null) return;
    setTotals(({ [code]: _, ...rest }) => rest);
    const total = parseAmount(raw);
    if (total == null) return;
    setRows((rs) => rs.map((r) => (r.code === code ? { ...r, months: spread(total, r.reference, mode).map((v) => (v ? String(v) : "")) } : r)));
  };
  const fillFromReference = () => {
    const f = 1 + (parsePct(growth) ?? 0) / 100;
    setRows((rs) => rs.map((r) => ({ ...r, months: MM.map((m) => text((r.reference[m] ?? 0) * f)) })));
  };
  const addAccount = () => {
    const code = newCode.trim();
    if (!/^[4-7]\d{3,9}$/.test(code)) return setNewError("El código debe ser una cuenta de resultados del PUC (empieza por 4, 5, 6 o 7).");
    if (!rubroOf(code, rubros)) return setNewError("Esa cuenta no cae en ningún rubro: agrega su prefijo en Configuración.");
    if (rows.some((r) => r.code === code)) return setNewError("Esa cuenta ya está en el presupuesto.");
    if (!newName.trim()) return setNewError("Ponle nombre a la cuenta.");
    setRows((rs) => [...rs, { code, name: newName.trim(), months: MM.map(() => ""), reference: {} }].sort((a, b) => a.code.localeCompare(b.code)));
    setNewCode("");
    setNewName("");
    setNewError("");
  };

  // Rubros por mes, para los subtotales en vivo.
  const rubroByCode = new Map(rows.map((r) => [r.code, rubroOf(r.code, rubros)?.key ?? null]));
  const byMonth = MM.map((_, i) => {
    const l: Lines = {};
    for (const r of rows) {
      const key = rubroByCode.get(r.code);
      if (key) l[key] = (l[key] ?? 0) + num(r.months[i]);
    }
    return l;
  });
  const yearLines = sumLines(byMonth);
  const net = byMonth.map((l) => subtotals(l, rubros).net);
  const groups = [
    ...rubros.map((r) => ({ key: r.key, label: r.label, rows: rows.filter((x) => rubroByCode.get(x.code) === r.key) })),
    { key: "", label: "Sin rubro: no suman (asígnales un prefijo en Configuración)", rows: rows.filter((x) => !rubroByCode.get(x.code)) },
  ].filter((g) => g.key || g.rows.length);

  const cell = "num !px-1.5";
  return (
    <form action={action}>
      <input type="hidden" name="anio" value={year} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--border)] px-4 py-3 text-[12.5px] text-[var(--text-secondary)]">
        {hasReference && (
          <span className="inline-flex flex-wrap items-center gap-2">
            Partir del real ({refLabel}) con un crecimiento de
            <input value={growth} onChange={(e) => setGrowth(e.target.value)} inputMode="decimal" className="field !w-16 !py-0.5 text-right" aria-label="Crecimiento %" />%
            <button type="button" onClick={fillFromReference} className="btn btn-secondary !py-0.5 text-[12px]">Llenar todo</button>
          </span>
        )}
        <label className="inline-flex items-center gap-2">
          Al escribir un total anual, repartirlo
          <select value={mode} onChange={(e) => setMode(e.target.value as "ESTACIONAL" | "PAREJO")} className="field !w-auto !py-0.5 text-[12.5px]">
            <option value="ESTACIONAL">según la estacionalidad real</option>
            <option value="PAREJO">parejo en los doce meses</option>
          </select>
        </label>
      </div>

      <div className="scroll-x">
        <table className="tbl text-[12.5px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-[2] min-w-[15rem]">Cuenta</th>
              <th className="num">Total año</th>
              {monthLabels.map((m) => <th key={m} className="num capitalize">{m}</th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              return (
                <Fragment key={g.key || "sin-rubro"}>
                  <tr className="bg-[var(--surface-2)] font-semibold" style={g.key ? undefined : { color: "var(--warning)" }}>
                    <td className="sticky left-0 z-[1] bg-[var(--surface-2)]">{g.label}</td>
                    <td className="num">{g.key ? fmtNumber(Math.round(val(yearLines, g.key))) : ""}</td>
                    {byMonth.map((l, i) => <td key={i} className={cell}>{g.key ? fmtNumber(Math.round(val(l, g.key))) : ""}</td>)}
                  </tr>
                  {g.rows.map((r) => {
                    const total = r.months.reduce((s, m) => s + num(m), 0);
                    return (
                      <tr key={r.code}>
                        <td className="sticky left-0 z-[1] bg-[var(--surface-1)]">
                          <input type="hidden" name="cuenta" value={r.code} />
                          <input type="hidden" name={`nombre-${r.code}`} value={r.name} />
                          <span className="tabular text-[var(--text-muted)]">{r.code}</span> {r.name}
                        </td>
                        <td className="num !px-1.5">
                          <input
                            value={totals[r.code] ?? (total ? String(Math.round(total)) : "")}
                            onChange={(e) => setTotals((t) => ({ ...t, [r.code]: e.target.value }))}
                            onBlur={() => applyTotal(r.code)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                applyTotal(r.code);
                              }
                            }}
                            inputMode="numeric"
                            className="field !w-28 !py-0.5 text-right font-semibold"
                            aria-label={`Total año de ${r.name}`}
                            title="Escribe el total del año y sal de la casilla para repartirlo"
                          />
                        </td>
                        {r.months.map((m, i) => (
                          <td key={i} className={cell}>
                            <input
                              name={`m-${r.code}-${MM[i]}`}
                              value={m}
                              onChange={(e) => setMonth(r.code, i, e.target.value)}
                              inputMode="numeric"
                              className="field !w-24 !py-0.5 text-right"
                              placeholder={r.reference[MM[i]] ? String(Math.round(r.reference[MM[i]])) : ""}
                              aria-label={`${r.name}, ${monthLabels[i]}`}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
            <tr style={{ borderTop: "2px solid var(--border-strong)" }} className="font-semibold">
              <td className="sticky left-0 z-[1] bg-[var(--surface-1)]">Ganancia (pérdida)</td>
              <td className="num" style={subtotals(yearLines, rubros).net < 0 ? { color: "var(--critical)" } : undefined}>{fmtNumber(Math.round(subtotals(yearLines, rubros).net))}</td>
              {net.map((v, i) => <td key={i} className={cell} style={v < 0 ? { color: "var(--critical)" } : undefined}>{fmtNumber(Math.round(v))}</td>)}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-4 py-3 text-[12.5px]">
        <span className="text-[var(--text-secondary)]">Agregar cuenta:</span>
        <input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="Código PUC" inputMode="numeric" className="field !w-32 !py-0.5" />
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre de la cuenta" className="field !w-64 !py-0.5" />
        <button type="button" onClick={addAccount} className="btn btn-secondary !py-0.5 text-[12px]">Agregar</button>
        {newError && <span className="text-[var(--critical)]">{newError}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] px-4 py-3">
        <button className="btn btn-primary" disabled={pending}>{pending ? "Guardando…" : `Guardar presupuesto ${year}`}</button>
        {state.error && <span className="text-[12.5px] text-[var(--critical)]">{state.error}</span>}
        {state.saved && !state.error && !pending && <span className="text-[12.5px] text-[var(--good)]">{state.saved}</span>}
        <span className="ml-auto text-[12px] text-[var(--text-muted)]">
          Con el signo del estado de resultados: ingresos y gastos en positivo, devoluciones en negativo. Sin IVA.
        </span>
      </div>
    </form>
  );
}
