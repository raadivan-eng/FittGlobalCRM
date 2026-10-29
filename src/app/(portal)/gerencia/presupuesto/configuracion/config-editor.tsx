"use client";

import { useActionState, useState } from "react";
import { guardarConfiguracionPresupuesto, restaurarConfiguracionPresupuesto, type BudgetResult } from "@/lib/actions-management";
import { ALLOCATION_BASES, BLOCKS, SOURCES, blockIndex, rubroKey, rubroOf, type BlockKey, type BudgetSettings, type Rubro, type SourceKey } from "@/lib/budget-lines";
import { IconArrowDown, IconArrowUp, IconTrash } from "@/components/icons";

type Row = { key: string; label: string; prefixes: string; block: BlockKey; source: SourceKey; isNew?: boolean };

const toRubro = (r: Row): Rubro => ({ ...r, prefixes: r.prefixes.split(/[,\s]+/).map((p) => p.trim()).filter(Boolean) });

/**
 * Rubros y criterios del presupuesto. Debajo de los rubros se ve, en vivo, qué
 * cuentas conocidas caen en cada uno: así se comprueba un prefijo antes de guardar.
 */
export function ConfigEditor({ rubros, settings, accounts }: { rubros: Rubro[]; settings: BudgetSettings; accounts: { code: string; name: string }[] }) {
  const [rows, setRows] = useState<Row[]>(() => rubros.map((r) => ({ ...r, prefixes: r.prefixes.join(", ") })));
  const [newLabel, setNewLabel] = useState("");
  const [newError, setNewError] = useState("");
  const [state, action, pending] = useActionState<BudgetResult, FormData>(guardarConfiguracionPresupuesto, {});

  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      const next = [...rs];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });
  const remove = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));
  const add = () => {
    const label = newLabel.trim();
    let key = rubroKey(label);
    if (!label || !key) return setNewError("Escribe el nombre del rubro.");
    for (let n = 2; rows.some((r) => r.key === key); n++) key = `${rubroKey(label).slice(0, 37)}_${n}`;
    setRows((rs) => [...rs, { key, label, prefixes: "", block: "OPERATIVO", source: "REPARTIDO", isNew: true }]);
    setNewLabel("");
    setNewError("");
  };

  // Vista previa: dónde cae cada cuenta conocida con los prefijos escritos.
  const live = rows.map(toRubro);
  const byRubro = new Map<string, { code: string; name: string }[]>();
  const orphans: { code: string; name: string }[] = [];
  for (const a of accounts) {
    const r = rubroOf(a.code, live);
    if (!r) orphans.push(a);
    else byRubro.set(r.key, [...(byRubro.get(r.key) ?? []), a]);
  }
  const ordered = [...rows].sort((a, b) => blockIndex(a.block) - blockIndex(b.block));

  return (
    <>
      <form action={action}>
        <section className="card">
          <header className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-[14px] font-semibold">Criterios</h2>
            <p className="text-[12.5px] text-[var(--text-muted)]">Cómo se mide y se lee el presupuesto. Rigen en todas las pantallas de Presupuesto.</p>
          </header>
          <div className="grid gap-x-6 gap-y-4 px-4 py-4 text-[13px] md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="font-medium">Base para repartir los rubros «repartidos»</span>
              <select name="allocation" defaultValue={settings.allocation} className="field">
                {ALLOCATION_BASES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
              </select>
              <span className="text-[12px] text-[var(--text-muted)]">Con esto se le asigna a cada cliente su parte de los gastos que la contabilidad no separa por cliente.</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium">Meses para el peso real de cada cliente</span>
              <input name="referenceMonths" type="number" min={3} max={24} defaultValue={settings.referenceMonths} className="field !w-28" />
              <span className="text-[12px] text-[var(--text-muted)]">Meses cerrados con que se calcula el peso real que sirve de guía para las participaciones (3 a 24).</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium">Al escribir un total anual en el presupuesto general</span>
              <select name="spread" defaultValue={settings.spread} className="field">
                <option value="ESTACIONAL">Repartirlo según la estacionalidad real</option>
                <option value="PAREJO">Repartirlo parejo en los doce meses</option>
              </select>
              <span className="text-[12px] text-[var(--text-muted)]">Es la opción con que abre el editor; ahí mismo se puede cambiar.</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium">Período con que abre la vista de resultados</span>
              <select name="defaultPeriod" defaultValue={settings.defaultPeriod} className="field">
                <option value="ACUMULADO">Acumulado de los meses cerrados</option>
                <option value="ANIO">Año completo</option>
              </select>
            </label>
            <div className="flex flex-col gap-1">
              <span className="font-medium">Semáforo de cumplimiento</span>
              <span className="flex flex-wrap items-center gap-2 text-[var(--text-secondary)]">
                Ingresos y ganancias: verde desde 100 %, ámbar desde
                <input name="warnPct" inputMode="decimal" defaultValue={String(settings.warnPct).replace(".", ",")} className="field !w-16 !py-0.5 text-right" aria-label="Ámbar desde %" />%
              </span>
              <span className="flex flex-wrap items-center gap-2 text-[var(--text-secondary)]">
                Gastos y costo: verde hasta 100 %, ámbar hasta
                <input name="expenseTolerancePct" inputMode="decimal" defaultValue={String(settings.expenseTolerancePct).replace(".", ",")} className="field !w-16 !py-0.5 text-right" aria-label="Ámbar hasta %" />%
              </span>
            </div>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="creditNotes" value="si" defaultChecked={settings.creditNotes} className="mt-1" />
              <span>
                <span className="font-medium">Las notas crédito restan de la venta del cliente</span>
                <span className="block text-[12px] text-[var(--text-muted)]">En el mes en que se emiten, no en el de la factura que afectan.</span>
              </span>
            </label>
          </div>
        </section>

        <section className="card mt-5">
          <header className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-[14px] font-semibold">Rubros</h2>
            <p className="text-[12.5px] text-[var(--text-muted)]">
              Cada rubro agrupa cuentas del PUC por el comienzo de su código; si dos prefijos cubren una cuenta, gana el más largo (523550 le gana a 5).
              La ubicación decide en qué subtotal entra; «se mide con» dice de dónde sale lo real de cada cliente.
            </p>
          </header>
          <div className="scroll-x">
            <table className="tbl text-[12.5px]">
              <thead>
                <tr>
                  <th className="w-16">Orden</th>
                  <th>Nombre</th>
                  <th>Prefijos de cuenta</th>
                  <th>Ubicación en el estado</th>
                  <th>Se mide en cada cliente con</th>
                  <th className="num">Cuentas</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key}>
                    <td className="whitespace-nowrap">
                      <input type="hidden" name="rubro" value={r.key} />
                      <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="btn btn-ghost !px-1 !py-0.5" aria-label="Subir"><IconArrowUp size={12} /></button>
                      <button type="button" disabled={i === rows.length - 1} onClick={() => move(i, 1)} className="btn btn-ghost !px-1 !py-0.5" aria-label="Bajar"><IconArrowDown size={12} /></button>
                    </td>
                    <td>
                      <input name={`label-${r.key}`} value={r.label} onChange={(e) => set(r.key, { label: e.target.value })} className="field !w-52 !py-0.5" aria-label="Nombre del rubro" />
                      {r.isNew && <span className="ml-2 text-[11px] text-[var(--brand)]">nuevo</span>}
                    </td>
                    <td>
                      <input name={`prefijos-${r.key}`} value={r.prefixes} onChange={(e) => set(r.key, { prefixes: e.target.value })} placeholder="529505, 5296" className="field !w-32 !py-0.5 tabular" aria-label={`Prefijos de ${r.label}`} />
                    </td>
                    <td>
                      <select name={`bloque-${r.key}`} value={r.block} onChange={(e) => set(r.key, { block: e.target.value as BlockKey })} className="field !w-auto !py-0.5 text-[12.5px]">
                        {BLOCKS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
                      </select>
                    </td>
                    <td>
                      <select name={`fuente-${r.key}`} value={r.source} onChange={(e) => set(r.key, { source: e.target.value as SourceKey })} className="field !w-auto !py-0.5 text-[12.5px]">
                        {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                    </td>
                    <td className="num" title={(byRubro.get(r.key) ?? []).map((a) => `${a.code} ${a.name}`).join("\n")}>
                      {(byRubro.get(r.key) ?? []).length || <span className="text-[var(--text-muted)]">0</span>}
                    </td>
                    <td>
                      <button type="button" onClick={() => remove(r.key)} className="btn btn-ghost !px-1.5 !py-0.5 text-[var(--critical)]" aria-label={`Quitar ${r.label}`} title="Quitar rubro">
                        <IconTrash size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-4 py-3 text-[12.5px]">
            <span className="text-[var(--text-secondary)]">Nuevo rubro:</span>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="Comisiones de venta"
              className="field !w-64 !py-0.5"
            />
            <button type="button" onClick={add} className="btn btn-secondary !py-0.5 text-[12px]">Agregar</button>
            {newError && <span className="text-[var(--critical)]">{newError}</span>}
            <span className="text-[var(--text-muted)]">Luego escribe sus prefijos, su ubicación y cómo se mide.</span>
          </div>
        </section>

        <div className="card mt-5 flex flex-wrap items-center gap-3 px-4 py-3">
          <button className="btn btn-primary" disabled={pending}>{pending ? "Guardando…" : "Guardar configuración"}</button>
          {state.error && <span className="text-[12.5px] text-[var(--critical)]">{state.error}</span>}
          {state.saved && !state.error && !pending && <span className="text-[12.5px] text-[var(--good)]">{state.saved}</span>}
        </div>
      </form>

      <section className="card mt-5">
        <header className="border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-[14px] font-semibold">Cómo queda el estado de resultados</h2>
          <p className="text-[12.5px] text-[var(--text-muted)]">Vista previa con lo que está escrito arriba, antes de guardar: las {accounts.length} cuentas que conocen la contabilidad y el presupuesto.</p>
        </header>
        {orphans.length > 0 && (
          <div className="border-b border-[var(--border)] px-4 py-3 text-[12.5px]" style={{ color: "var(--critical)" }}>
            <strong>{orphans.length} cuentas sin rubro</strong> — no se podrá guardar así: {orphans.map((a) => `${a.code} ${a.name}`).join(" · ")}
          </div>
        )}
        <div className="grid gap-x-6 gap-y-3 px-4 py-3 text-[12.5px] md:grid-cols-2">
          {ordered.map((r) => (
            <div key={r.key}>
              <p className="font-semibold">
                {r.label || "Sin nombre"} <span className="font-normal text-[var(--text-muted)]">· {BLOCKS.find((b) => b.key === r.block)?.label} · {SOURCES.find((s) => s.key === r.source)?.label.toLowerCase()}</span>
              </p>
              <p className="text-[var(--text-secondary)]">
                {(byRubro.get(r.key) ?? []).map((a) => `${a.code} ${a.name}`).join(" · ") || <span className="text-[var(--text-muted)]">Ninguna cuenta conocida todavía</span>}
              </p>
            </div>
          ))}
        </div>
      </section>

      <form
        action={restaurarConfiguracionPresupuesto}
        onSubmit={(e) => {
          if (!confirm("¿Volver a los rubros y criterios de siempre? Se pierden los rubros agregados y los ajustes de participación que tengan.")) e.preventDefault();
        }}
        className="mt-4 text-right"
      >
        <button className="btn btn-ghost text-[12.5px] text-[var(--critical)]">Restaurar rubros y criterios de siempre</button>
      </form>
    </>
  );
}
