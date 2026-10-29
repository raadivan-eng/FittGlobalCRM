"use client";

import { useActionState, useState } from "react";
import { guardarParticipaciones, type BudgetResult } from "@/lib/actions-management";
import { fmtMoney, fmtPct, parsePct } from "@/lib/format";

export type ShareRow = {
  id: string;
  name: string;
  channel: string;
  channelLabel: string;
  /** Peso real en la venta de los últimos doce meses cerrados. */
  reference: number;
  base: number | null;
  overrides: Record<string, number>;
};

const pctText = (v: number | null | undefined) => (v == null ? "" : String(Math.round(v * 100) / 100).replace(".", ","));

/**
 * Participación de cada cliente en el presupuesto general. La base es su peso
 * en la venta y rige en todos los rubros; un rubro con valor propio la reemplaza.
 */
export function ShareEditor({
  year,
  rows: initial,
  channels,
  budgetSales,
  refLabel,
  adjustable,
}: {
  year: number;
  rows: ShareRow[];
  channels: { value: string; label: string }[];
  budgetSales: number;
  refLabel: string;
  /** Rubros que admiten un % distinto a la base (todos menos el de la venta). */
  adjustable: { key: string; label: string }[];
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const r of initial) {
      v[`base-${r.id}`] = pctText(r.base);
      for (const l of adjustable) v[`${l.key}-${r.id}`] = pctText(r.overrides[l.key]);
    }
    return v;
  });
  const [channel, setChannel] = useState("");
  const [adjust, setAdjust] = useState(() => initial.some((r) => Object.keys(r.overrides).length > 0));
  const [state, action, pending] = useActionState<BudgetResult, FormData>(guardarParticipaciones, {});

  const set = (name: string, value: string) => setValues((v) => ({ ...v, [name]: value }));
  const pct = (name: string) => parsePct(values[name] ?? "") ?? 0;
  const effective = (id: string, line: string) => (line === "base" ? pct(`base-${id}`) : parsePct(values[`${line}-${id}`] ?? "") ?? pct(`base-${id}`));
  const useReference = () =>
    setValues((v) => {
      const next = { ...v };
      for (const r of initial) if (!channel || r.channel === channel) next[`base-${r.id}`] = r.reference > 0 ? pctText(r.reference) : "";
      return next;
    });

  const visible = initial.filter((r) => !channel || r.channel === channel);
  const sum = (line: string, rows = initial) => rows.reduce((s, r) => s + (pct(`base-${r.id}`) > 0 ? effective(r.id, line) : 0), 0);
  const totalBase = sum("base");

  const tone = (t: number) => (t > 100.05 ? "var(--critical)" : undefined);

  return (
    <form action={action}>
      <input type="hidden" name="anio" value={year} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--border)] px-4 py-3 text-[12.5px] text-[var(--text-secondary)]">
        <label className="inline-flex items-center gap-2">
          Canal
          <select value={channel} onChange={(e) => setChannel(e.target.value)} className="field !w-auto !py-0.5 text-[12.5px]">
            <option value="">Todos</option>
            {channels.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <button type="button" onClick={useReference} className="btn btn-secondary !py-0.5 text-[12px]">
          Usar el peso real ({refLabel}){channel ? " en este canal" : ""}
        </button>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={adjust} onChange={(e) => setAdjust(e.target.checked)} />
          Ajustar por rubro
        </label>
        <span className="ml-auto" style={{ color: tone(totalBase) }}>
          Venta asignada: <strong>{fmtPct(totalBase)}</strong>
          {totalBase < 99.95 && <> · sin asignar {fmtPct(100 - totalBase)}</>}
        </span>
      </div>

      <div className="scroll-x">
        <table className="tbl text-[12.5px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-[2] min-w-[13rem]">Cliente</th>
              <th>Canal</th>
              <th className="num">Peso real</th>
              <th className="num">Participación</th>
              <th className="num">Venta ppto.</th>
              {adjust && adjustable.map((l) => <th key={l.key} className="num" title={l.label}>{l.label.split(",")[0]}</th>)}
            </tr>
          </thead>
          <tbody>
            {initial.map((r) => {
              const hidden = channel && r.channel !== channel;
              return (
                <tr key={r.id} className={hidden ? "hidden" : undefined}>
                  <td className="sticky left-0 z-[1] bg-[var(--surface-1)] font-medium">
                    <input type="hidden" name="cliente" value={r.id} />
                    {r.name}
                  </td>
                  <td className="text-[var(--text-secondary)]">{r.channelLabel}</td>
                  <td className="num text-[var(--text-secondary)]">{r.reference > 0 ? fmtPct(r.reference) : "—"}</td>
                  <td className="num !px-1.5">
                    <input
                      name={`base-${r.id}`}
                      value={values[`base-${r.id}`]}
                      onChange={(e) => set(`base-${r.id}`, e.target.value)}
                      inputMode="decimal"
                      className="field !w-20 !py-0.5 text-right font-semibold"
                      aria-label={`Participación de ${r.name}`}
                    />
                  </td>
                  <td className="num text-[var(--text-secondary)]">{pct(`base-${r.id}`) > 0 ? fmtMoney((budgetSales * pct(`base-${r.id}`)) / 100) : "—"}</td>
                  {adjustable.map((l) =>
                    adjust ? (
                      <td key={l.key} className="num !px-1.5">
                        <input
                          name={`${l.key}-${r.id}`}
                          value={values[`${l.key}-${r.id}`]}
                          onChange={(e) => set(`${l.key}-${r.id}`, e.target.value)}
                          inputMode="decimal"
                          placeholder={values[`base-${r.id}`] || ""}
                          className="field !w-[4.5rem] !py-0.5 text-right"
                          aria-label={`${l.label} de ${r.name}`}
                        />
                      </td>
                    ) : (
                      values[`${l.key}-${r.id}`] && <input key={l.key} type="hidden" name={`${l.key}-${r.id}`} value={values[`${l.key}-${r.id}`]} />
                    ),
                  )}
                </tr>
              );
            })}
            <tr style={{ borderTop: "2px solid var(--border-strong)" }} className="font-semibold">
              <td className="sticky left-0 z-[1] bg-[var(--surface-1)]">{channel ? "Total del canal" : "Total"}</td>
              <td />
              <td className="num">{fmtPct(visible.reduce((s, r) => s + r.reference, 0))}</td>
              <td className="num" style={{ color: tone(sum("base", visible)) }}>{fmtPct(sum("base", visible))}</td>
              <td className="num">{fmtMoney((budgetSales * sum("base", visible)) / 100)}</td>
              {adjust && adjustable.map((l) => <td key={l.key} className="num" style={{ color: tone(sum(l.key)) }}>{fmtPct(sum(l.key, visible))}</td>)}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] px-4 py-3">
        <button className="btn btn-primary" disabled={pending}>{pending ? "Guardando…" : `Guardar participaciones ${year}`}</button>
        {state.error && <span className="text-[12.5px] text-[var(--critical)]">{state.error}</span>}
        {state.saved && !state.error && !pending && <span className="text-[12.5px] text-[var(--good)]">{state.saved}</span>}
        <span className="ml-auto max-w-[36rem] text-[12px] text-[var(--text-muted)]">
          Un rubro vacío toma la participación del cliente. Ningún rubro puede sumar más de 100 % entre todos los clientes; lo que falte queda sin asignar (clientes nuevos, leads).
        </span>
      </div>
    </form>
  );
}
