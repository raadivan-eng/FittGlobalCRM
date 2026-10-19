"use client";

import { useState } from "react";
import { guardarForecast } from "@/lib/actions-sales";
import { fmtMoney } from "@/lib/format";
import { IconCheck, IconEdit, IconX } from "@/components/icons";

/**
 * `manual` es el monto cargado a mano (null si no hay); `baseline` el promedio
 * histórico que rige cuando no hay manual. Guardar vacío vuelve al promedio.
 */
export function ForecastCell({
  period,
  companyId,
  manual,
  baseline,
  editable,
}: {
  period: string;
  companyId: string;
  manual: number | null;
  baseline: number;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const amount = manual ?? baseline;

  if (!editable || !editing) {
    return (
      <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
        <span className={amount > 0 ? "font-semibold" : "text-[var(--text-muted)]"}>{amount > 0 ? fmtMoney(amount) : "Sin historial"}</span>
        {editable && (
          <button type="button" onClick={() => setEditing(true)} className="btn btn-ghost !px-1 !py-0.5" title="Ajustar forecast" aria-label="Ajustar forecast">
            <IconEdit size={12} />
          </button>
        )}
      </span>
    );
  }

  return (
    <form action={guardarForecast} onSubmit={() => setEditing(false)} className="inline-flex items-center gap-1">
      <input type="hidden" name="period" value={period} />
      <input type="hidden" name="companyId" value={companyId} />
      <input
        name="amount"
        defaultValue={manual != null ? String(Math.round(manual)) : ""}
        inputMode="numeric"
        autoFocus
        className="field !w-32 !py-0.5 text-right"
        placeholder={baseline > 0 ? `Prom. ${Math.round(baseline)}` : "0"}
        title="Déjalo vacío para usar el promedio del año"
      />
      <button type="submit" className="btn btn-primary !px-1.5 !py-0.5" title="Guardar" aria-label="Guardar">
        <IconCheck size={12} />
      </button>
      <button type="button" onClick={() => setEditing(false)} className="btn btn-ghost !px-1 !py-0.5" title="Cancelar" aria-label="Cancelar">
        <IconX size={12} />
      </button>
    </form>
  );
}
