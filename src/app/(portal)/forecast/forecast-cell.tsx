"use client";

import { useState } from "react";
import { guardarForecast } from "@/lib/actions-sales";
import { fmtMoney } from "@/lib/format";
import { IconCheck, IconEdit, IconX } from "@/components/icons";

export function ForecastCell({ period, companyId, amount, editable }: { period: string; companyId: string; amount: number; editable: boolean }) {
  const [editing, setEditing] = useState(false);

  if (!editable || !editing) {
    return (
      <span className="inline-flex items-center justify-end gap-1.5">
        <span className={amount > 0 ? "font-semibold" : "text-[var(--text-muted)]"}>{amount > 0 ? fmtMoney(amount) : "Sin cargar"}</span>
        {editable && (
          <button type="button" onClick={() => setEditing(true)} className="btn btn-ghost !px-1 !py-0.5" title="Editar forecast" aria-label="Editar forecast">
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
        defaultValue={amount ? String(Math.round(amount)) : ""}
        inputMode="numeric"
        autoFocus
        className="field !w-28 !py-0.5 text-right"
        placeholder="0"
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
