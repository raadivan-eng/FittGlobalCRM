"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ajustarMesesCliente, alternarMesExtraordinario } from "@/lib/actions-sales";
import { fmtMoney, fmtPeriod } from "@/lib/format";
import { IconFilter, IconX } from "@/components/icons";

type Month = {
  period: string;
  amount: number;
  excluded: "TODOS" | "CLIENTE" | null;
};

/** Media desde el primer mes con compra, sin los meses excluidos: la misma regla que companyForecasts. */
function average(history: Month[], excluded: (m: Month) => boolean) {
  const counted = history.filter((m) => !excluded(m));
  const first = counted.findIndex((m) => m.amount > 0);
  if (first < 0) return { value: 0, months: 0 };
  const span = counted.slice(first);
  return {
    value: Math.round(span.reduce((s, m) => s + m.amount, 0) / span.length),
    months: span.length,
  };
}

/**
 * El diálogo se monta en <body> con un portal: dentro de una celda de la tabla
 * heredaría `whitespace-nowrap` y la alineación a la derecha, y el contenido se
 * desbordaba hacia los lados.
 */
function Modal({
  trigger,
  title,
  subtitle,
  children,
}: {
  trigger: (open: () => void) => ReactNode;
  title: string;
  subtitle?: string;
  children: (close: () => void) => ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const close = () => ref.current?.close();
  return (
    <>
      {trigger(() => ref.current?.showModal())}
      {mounted &&
        createPortal(
          <dialog
            ref={ref}
            className="card m-auto w-[min(480px,calc(100vw-32px))] overflow-x-hidden whitespace-normal p-0 text-left text-[13px] font-normal text-[var(--text-primary)] backdrop:bg-black/40"
            onClick={(e) => e.target === ref.current && close()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
              <div>
                <h2 className="text-[14px] font-semibold">{title}</h2>
                {subtitle && <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">{subtitle}</p>}
              </div>
              <button type="button" onClick={close} className="btn btn-ghost !px-1 !py-0.5" aria-label="Cerrar">
                <IconX size={14} />
              </button>
            </div>
            {children(close)}
          </dialog>,
          document.body,
        )}
    </>
  );
}

/** Meses extraordinarios de un cliente: se marcan y el promedio se recalcula en vivo antes de guardar. */
export function ClientMonthsAdjust({
  companyId,
  companyName,
  history,
  notes,
}: {
  companyId: string;
  companyName: string;
  history: Month[];
  notes: string | null;
}) {
  const [marked, setMarked] = useState(() => new Set(history.filter((m) => m.excluded === "CLIENTE").map((m) => m.period)));
  const before = average(history, (m) => m.excluded != null);
  const after = average(history, (m) => m.excluded === "TODOS" || marked.has(m.period));
  const max = Math.max(...history.map((m) => m.amount), 1);
  const adjusted = history.some((m) => m.excluded === "CLIENTE");

  return (
    <Modal
      title={`Ajustar promedio · ${companyName}`}
      subtitle="Marca los meses extraordinarios (una negociación especial, una compra única): salen de la suma y del conteo."
      trigger={(open) => (
        <button
          type="button"
          onClick={open}
          className={`btn btn-ghost !px-1 !py-0.5 ${adjusted ? "!text-[var(--brand)]" : ""}`}
          title={adjusted ? "Promedio ajustado: ver meses excluidos" : "Excluir meses extraordinarios del promedio"}
          aria-label="Ajustar promedio"
        >
          <IconFilter size={12} />
        </button>
      )}
    >
      {(close) => (
        <form action={ajustarMesesCliente} onSubmit={close}>
          <input type="hidden" name="companyId" value={companyId} />
          <ul className="max-h-[50vh] overflow-y-auto px-4 py-2">
            {history.map((m) => {
              const global = m.excluded === "TODOS";
              const off = global || marked.has(m.period);
              return (
                <li key={m.period} className="flex items-center gap-3 py-1.5 text-[13px]">
                  {!global && <input type="hidden" name="months" value={m.period} />}
                  <input
                    type="checkbox"
                    name="excluir"
                    value={m.period}
                    checked={off}
                    disabled={global}
                    onChange={(e) => {
                      const next = new Set(marked);
                      if (e.target.checked) next.add(m.period);
                      else next.delete(m.period);
                      setMarked(next);
                    }}
                    aria-label={`Excluir ${fmtPeriod(m.period)}`}
                  />
                  <span className={`min-w-0 flex-1 truncate first-letter:uppercase sm:w-40 sm:flex-none ${off ? "text-[var(--text-muted)] line-through" : ""}`}>{fmtPeriod(m.period)}</span>
                  <span className="hidden h-2 min-w-6 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)] sm:block">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${(m.amount / max) * 100}%`,
                        background: off ? "var(--text-muted)" : "var(--series-1)",
                      }}
                    />
                  </span>
                  <span className={`shrink-0 text-right tabular-nums sm:w-32 ${off ? "text-[var(--text-muted)]" : ""}`}>
                    {m.amount > 0 ? fmtMoney(m.amount) : "—"}
                  </span>
                  {global && <span className="w-12 shrink-0 text-[11px] text-[var(--text-muted)]">todos</span>}
                </li>
              );
            })}
          </ul>
          <div className="border-t border-[var(--border)] px-4 py-3">
            <p className="text-[13px]">
              Promedio: <span className="text-[var(--text-secondary)]">{fmtMoney(before.value)}</span> →{" "}
              <span className="font-semibold">{fmtMoney(after.value)}</span>{" "}
              <span className="text-[12px] text-[var(--text-muted)]">({after.months} meses)</span>
            </p>
            <input name="notes" defaultValue={notes ?? ""} className="field mt-2" placeholder="Motivo (opcional): negociación especial de febrero…" />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={close} className="btn btn-secondary">
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary">
                Guardar ajuste
              </button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Excluye un mes para todos los clientes, pidiendo el motivo antes. */
export function ExcludeMonthButton({ period }: { period: string }) {
  return (
    <Modal
      title={`Excluir ${fmtPeriod(period)} para todos`}
      subtitle="Ningún cliente lo contará en su promedio. Los ajustes por cliente se mantienen."
      trigger={(open) => (
        <button type="button" onClick={open} className="btn btn-ghost !px-2 !py-0.5 text-[12px]">
          Excluir
        </button>
      )}
    >
      {(close) => (
        <form action={alternarMesExtraordinario} onSubmit={close} className="px-4 py-3">
          <input type="hidden" name="period" value={period} />
          <input name="notes" className="field" placeholder="Motivo: negociación especial, carga inicial…" autoFocus />
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={close} className="btn btn-secondary">
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary">
              Excluir mes
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
