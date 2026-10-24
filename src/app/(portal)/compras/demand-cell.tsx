"use client";

import { useState } from "react";
import { guardarDemandaProducto } from "@/lib/actions-purchasing";
import { fmtNumber } from "@/lib/format";
import { IconCheck, IconEdit, IconX } from "@/components/icons";

/**
 * Demanda mensual con que se planea un SKU. `forecast` son las unidades
 * cargadas a mano (null si no hay) y `history` el promedio vendido, que rige
 * cuando no hay forecast. Guardar vacío vuelve al histórico.
 */
export function DemandCell({
  productId,
  forecast,
  history,
  editable,
}: {
  productId: string;
  forecast: number | null;
  history: number;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const units = forecast ?? history;

  if (!editable || !editing) {
    return (
      <span className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
        <span className={units > 0 ? "font-semibold" : "text-[var(--text-muted)]"}>{fmtNumber(units)}</span>
        {editable && (
          <button type="button" onClick={() => setEditing(true)} className="btn btn-ghost !px-1 !py-0.5" title="Ajustar demanda" aria-label="Ajustar demanda">
            <IconEdit size={12} />
          </button>
        )}
      </span>
    );
  }

  return (
    <form action={guardarDemandaProducto} onSubmit={() => setEditing(false)} className="inline-flex items-center gap-1">
      <input type="hidden" name="productId" value={productId} />
      <input
        name="units"
        defaultValue={forecast != null ? String(forecast) : ""}
        inputMode="numeric"
        autoFocus
        className="field !w-24 !py-0.5 text-right"
        placeholder={`Hist. ${history}`}
        title="Unidades al mes para los próximos tres meses. Déjalo vacío para usar lo vendido."
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
