"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { analizarSellOut, guardarEquivalencias, importarSellOut, type SellOutResult } from "@/lib/actions-sellout";
import type { SellOutPreview, SheetPreview } from "@/lib/sell-out-import";
import { fmtNumber, fmtPeriod } from "@/lib/format";
import { Badge, Card, CardHeader } from "@/components/ui";
import { IconAlert, IconCheck } from "@/components/icons";

type Option = { id: string; name?: string; label?: string };

export function SellOutImport({ companies, products }: { companies: Option[]; products: Option[] }) {
  const input = useRef<HTMLInputElement>(null);
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<SellOutPreview | null>(null);
  const [done, setDone] = useState<SellOutResult["done"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [step, setStep] = useState<"analizar" | "importar" | "equivalencias" | null>(null);
  const [pending, startTransition] = useTransition();

  // El archivo se envía a mano y no con <form action>: React reinicia el
  // formulario tras cada acción y el input perdería el archivo elegido.
  const build = (overrides = assign) => {
    const file = input.current?.files?.[0];
    if (!file) return null;
    const data = new FormData();
    data.set("archivo", file);
    data.set("anio", String(year));
    for (const [sheet, id] of Object.entries(overrides)) if (id) data.set(`cliente:${sheet}`, id);
    return data;
  };

  const analyze = (overrides = assign) => {
    const data = build(overrides);
    if (!data) {
      setError("Elige el archivo .xlsx de sell-out.");
      return;
    }
    setError(null);
    setStep("analizar");
    startTransition(async () => {
      const r = await analizarSellOut(data);
      setPreview(r.preview ?? null);
      setDone(null);
      if (r.error) setError(r.error);
    });
  };

  const confirm = () => {
    const data = build();
    if (!data) return;
    setError(null);
    setStep("importar");
    startTransition(async () => {
      const r = await importarSellOut(data);
      if (r.error) setError(r.error);
      if (r.done) {
        setDone(r.done);
        setPreview(null);
      }
    });
  };

  const saveAliases = (form: HTMLFormElement) => {
    const data = new FormData(form);
    setStep("equivalencias");
    startTransition(async () => {
      const r = await guardarEquivalencias(data);
      if (r.error) {
        setError(r.error);
        return;
      }
      setNotice(`${r.saved} equivalencia${r.saved === 1 ? "" : "s"} guardada${r.saved === 1 ? "" : "s"}. Vuelvo a leer el archivo…`);
      analyze();
    });
  };

  const reset = () => {
    setPreview(null);
    setDone(null);
    setError(null);
    setNotice(null);
    setAssign({});
  };

  const ready = preview?.sheets.filter((s) => s.companyId && s.periods.length) ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardHeader title="Archivo" subtitle="En Google Sheets: Archivo → Descargar → Microsoft Excel (.xlsx)" />
        <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
          <input
            ref={input}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={reset}
            className="field max-w-full flex-1 py-1.5"
          />
          <label className="flex items-center gap-2 text-[12.5px] text-[var(--text-secondary)]">
            Año de los meses
            <select className="field w-auto" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => analyze()}>
            {pending && step === "analizar" ? "Leyendo…" : "Analizar"}
          </button>
        </div>
        <p className="border-t border-[var(--border)] px-4 py-2 text-[11.5px] text-[var(--text-muted)]">
          El año sólo se usa en las filas que traen el nombre del mes sin fecha (Farmatodo, Locatel).
        </p>
        {error && (
          <p className="flex items-center gap-2 border-t border-[var(--border)] px-4 py-2.5 text-[12.5px] text-[var(--critical)]">
            <IconAlert size={14} /> {error}
          </p>
        )}
        {notice && !error && <p className="border-t border-[var(--border)] px-4 py-2.5 text-[12.5px] text-[var(--text-secondary)]">{notice}</p>}
      </Card>

      {done && (
        <Card>
          <CardHeader title="Sell-out cargado" />
          <ul className="divide-y divide-[var(--border)]">
            {done.map((d) => (
              <li key={d.companyName} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                <span className="flex items-center gap-2">
                  <IconCheck size={14} className="text-[var(--good)]" />
                  <strong>{d.companyName}</strong>
                  <span className="text-[var(--text-muted)]">{d.periods.map(fmtPeriod).join(", ")}</span>
                </span>
                <span className="tabular">{fmtNumber(d.units)} u</span>
              </li>
            ))}
          </ul>
          <div className="border-t border-[var(--border)] px-4 py-3">
            <Link href="/sell-out" className="btn btn-primary">Ver el sell-out</Link>
          </div>
        </Card>
      )}

      {preview?.sheets.map((s) => (
        <SheetCard
          key={s.sheet}
          sheet={s}
          companies={companies}
          products={products}
          pending={pending}
          onAssign={(id) => {
            const next = { ...assign, [s.sheet]: id };
            setAssign(next);
            analyze(next);
          }}
          onSaveAliases={saveAliases}
        />
      ))}

      {preview && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
            <p className="text-[12.5px] text-[var(--text-secondary)]">
              {ready.length
                ? `Se cargarán ${ready.length} pestaña${ready.length === 1 ? "" : "s"}: ${fmtNumber(ready.reduce((t, s) => t + s.matchedUnits, 0))} unidades. Los meses que ya estaban se reemplazan.`
                : "Ninguna pestaña está lista: asigna el cliente y revisa que haya filas reconocidas."}
            </p>
            <button type="button" className="btn btn-primary" disabled={pending || !ready.length} onClick={confirm}>
              {pending && step === "importar" ? "Cargando…" : "Confirmar carga"}
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}

function SheetCard({
  sheet: s,
  companies,
  products,
  pending,
  onAssign,
  onSaveAliases,
}: {
  sheet: SheetPreview;
  companies: Option[];
  products: Option[];
  pending: boolean;
  onAssign: (companyId: string) => void;
  onSaveAliases: (form: HTMLFormElement) => void;
}) {
  if (!s.dataRows) {
    return (
      <Card>
        <div className="flex items-center justify-between gap-3 px-4 py-3 text-[13px]">
          <span className="font-medium">{s.sheet}</span>
          <span className="text-[12px] text-[var(--text-muted)]">Se omite: {s.note ?? "sin filas de venta"}</span>
        </div>
      </Card>
    );
  }

  const pct = s.dataRows ? Math.round((s.matchedRows / s.dataRows) * 100) : 0;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Pestaña «{s.sheet}»
            {s.companyId ? <Badge tone="success">{pct} % reconocido</Badge> : <Badge tone="warning">Falta el cliente</Badge>}
          </span>
        }
        subtitle={`${fmtNumber(s.dataRows)} filas de venta${s.note ? ` · ${s.note}` : ""}`}
      />
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-3">
        <label className="flex items-center gap-2 text-[12.5px] text-[var(--text-secondary)]">
          Cliente
          <select className="field w-72" value={s.companyId ?? ""} disabled={pending} onChange={(e) => onAssign(e.target.value)}>
            <option value="">Elige el cliente…</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        {s.detected && <span className="text-[11.5px] text-[var(--text-muted)]">Reconocido por el nombre de la pestaña</span>}
      </div>

      {s.periods.length > 0 && (
        <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th>Mes</th>
                <th className="num">Unidades</th>
                <th className="num">Tiendas con venta</th>
                <th className="num">Ya cargado</th>
              </tr>
            </thead>
            <tbody>
              {s.periods.map((p) => (
                <tr key={p.period}>
                  <td className="capitalize">{fmtPeriod(p.period)}</td>
                  <td className="num font-semibold">{fmtNumber(p.units)}</td>
                  <td className="num">{fmtNumber(p.stores)}</td>
                  <td className="num">
                    {p.replaces ? <span className="text-[var(--tone-warning-fg)]">{fmtNumber(p.replaces)} u · se reemplaza</span> : <span className="text-[var(--text-muted)]">Nuevo</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {s.skippedRows > 0 && (
        <p className="flex items-center gap-2 border-t border-[var(--border)] px-4 py-2.5 text-[12.5px] text-[var(--critical)]">
          <IconAlert size={14} /> {fmtNumber(s.skippedRows)} filas ({fmtNumber(s.skippedUnits)} unidades) quedan por fuera
          porque su tienda o su producto no se reconoce{s.truncated ? "; abajo van las de más unidades" : ""}.
        </p>
      )}

      {s.unmatchedStores.length > 0 && (
        <details className="border-t border-[var(--border)]">
          <summary className="cursor-pointer px-4 py-2.5 text-[12.5px] font-medium">
            {s.unmatchedStores.length} tiendas que no están en el maestro de este cliente
          </summary>
          <ul className="grid gap-x-4 px-4 pb-3 text-[12px] sm:grid-cols-2">
            {s.unmatchedStores.map((st) => (
              <li key={st.code} className="flex justify-between gap-2 py-0.5">
                <span className="truncate"><span className="font-mono">{st.code}</span> {st.name}</span>
                <span className="shrink-0 tabular text-[var(--text-muted)]">{fmtNumber(st.units)} u</span>
              </li>
            ))}
          </ul>
          <p className="px-4 pb-3 text-[11.5px] text-[var(--text-muted)]">
            Súmalas al Excel de puntos de venta y reimpórtalo en <Link href="/tiendas/importar" className="underline">Tiendas → Importar</Link>, o revisa que el código sea el mismo que usa la cadena.
          </p>
        </details>
      )}

      {s.unmatchedProducts.length > 0 && s.companyId && (
        <form
          className="border-t border-[var(--border)]"
          onSubmit={(e) => {
            e.preventDefault();
            onSaveAliases(e.currentTarget);
          }}
        >
          <p className="px-4 pt-3 text-[12.5px] font-medium">Productos sin reconocer</p>
          <p className="px-4 pb-2 text-[11.5px] text-[var(--text-muted)]">
            Indica a qué producto corresponde cada código de la cadena. Se guarda para las próximas cargas.
          </p>
          <ul className="divide-y divide-[var(--border)]">
            {s.unmatchedProducts.map((p) => (
              <li key={p.code} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <div className="min-w-0 flex-1 text-[12.5px]">
                  <p className="truncate">{p.description || "Sin descripción"}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    <span className="font-mono">{p.code}</span>{p.ean && p.ean !== p.code ? ` · EAN ${p.ean}` : ""} · {fmtNumber(p.units)} u
                  </p>
                </div>
                <input type="hidden" name={`desc:${s.companyId}|${p.code}`} value={p.description} />
                <select name={`alias:${s.companyId}|${p.code}`} className="field w-72" defaultValue="">
                  <option value="">No es nuestro / dejar por fuera</option>
                  {products.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          <div className="px-4 py-3">
            <button type="submit" className="btn btn-secondary" disabled={pending}>
              Guardar equivalencias y volver a leer
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
