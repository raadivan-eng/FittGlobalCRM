"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { analizarResultados, importarResultados, type StatementPreview } from "@/lib/actions-management";
import { fmtNumber, fmtPeriod } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui";
import { IconAlert, IconCheck } from "@/components/icons";

const signed = (v: number) => (
  <span style={v < 0 ? { color: "var(--critical)" } : undefined}>{fmtNumber(Math.round(v))}</span>
);

export function StatementImport() {
  const input = useRef<HTMLInputElement>(null);
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [done, setDone] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // El archivo se envía a mano y no con <form action>: React reinicia el
  // formulario tras cada acción y el input perdería el archivo elegido.
  const build = () => {
    const file = input.current?.files?.[0];
    if (!file) return null;
    const data = new FormData();
    data.set("archivo", file);
    data.set("anio", String(year));
    return data;
  };

  const run = (action: typeof analizarResultados) => {
    const data = build();
    if (!data) {
      setError("Elige el archivo .xlsx del estado de resultados.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await action(data);
      if (r.error) setError(r.error);
      setPreview(r.preview ?? null);
      setDone(r.done ?? null);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Archivo" />
        <div className="flex flex-wrap items-end gap-3 px-4 py-4">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12.5px] font-medium">
            Estado de resultados (.xlsx)
            <input
              ref={input}
              type="file"
              accept=".xlsx"
              className="field"
              onChange={() => {
                setPreview(null);
                setDone(null);
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] font-medium">
            Año
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="field w-28">
              {[thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => run(analizarResultados)}>
            {pending && !preview ? "Leyendo…" : "Revisar archivo"}
          </button>
        </div>
        {error && (
          <p className="flex items-center gap-2 border-t border-[var(--border)] px-4 py-3 text-[13px] text-[var(--critical)]">
            <IconAlert size={15} /> {error}
          </p>
        )}
      </Card>

      {preview && (
        <Card>
          <CardHeader
            title="Totales por mes"
            subtitle={`Pestaña «${preview.sheet}» · ${fmtNumber(preview.accounts)} cuentas. Crúzalos con tu hoja antes de guardar.`}
          />
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th className="num">Ingresos</th>
                  <th className="num">Ganancia bruta</th>
                  <th className="num">Antes de financieros</th>
                  <th className="num">Ganancia (pérdida)</th>
                </tr>
              </thead>
              <tbody>
                {preview.months.map((m) => (
                  <tr key={m.period}>
                    <td className="font-medium capitalize">
                      {fmtPeriod(m.period)}
                      <span className="block text-[11.5px] font-normal text-[var(--text-muted)]">{fmtNumber(m.lines)} cuentas con valor</span>
                    </td>
                    <td className="num">{signed(m.totals.INGRESOS)}</td>
                    <td className="num">{signed(m.totals.grossProfit)}</td>
                    <td className="num">{signed(m.totals.beforeFinancial)}</td>
                    <td className="num font-semibold">{signed(m.totals.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.skipped.length > 0 && (
            <p className="border-t border-[var(--border)] px-4 py-2.5 text-[12px] text-[var(--text-muted)]">
              Se dejan fuera {preview.skipped.length} cuentas de balance: {preview.skipped.slice(0, 4).join(" · ")}
              {preview.skipped.length > 4 ? "…" : ""}
            </p>
          )}
          <div className="flex justify-end border-t border-[var(--border)] px-4 py-3">
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(importarResultados)}>
              {pending ? "Guardando…" : `Guardar ${preview.months.length} ${preview.months.length === 1 ? "mes" : "meses"}`}
            </button>
          </div>
        </Card>
      )}

      {done && (
        <Card>
          <p className="flex flex-wrap items-center gap-2 px-4 py-4 text-[13px]">
            <IconCheck size={16} className="text-[var(--good)]" />
            Quedaron cargados {done.length} {done.length === 1 ? "mes" : "meses"}: {done.map(fmtPeriod).join(", ")}.
            <Link href={`/gerencia/resultados?anio=${done[0]?.slice(0, 4) ?? ""}`} className="font-semibold text-[var(--brand)] hover:underline">
              Ver el estado de resultados
            </Link>
          </p>
        </Card>
      )}
    </div>
  );
}
