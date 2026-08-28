"use client";

import { useState } from "react";
import { actualizarNovedad } from "@/lib/actions-field";
import { IconCheck, IconX } from "@/components/icons";

export function IncidentResolver({ id, status }: { id: string; status: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="flex shrink-0 gap-1.5">
        {status === "ABIERTA" && (
          <form action={actualizarNovedad}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="status" value="EN_PROCESO" />
            <button className="btn btn-secondary !px-2 !py-0.5 text-[12px]">Tomar</button>
          </form>
        )}
        <button type="button" className="btn btn-primary !px-2 !py-0.5 text-[12px]" onClick={() => setOpen(true)}>
          <IconCheck size={12} /> Resolver
        </button>
      </div>
    );
  }

  return (
    <form action={actualizarNovedad} className="flex w-full shrink-0 flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5 sm:w-80">
      <input type="hidden" name="id" value={id} />
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">Resultado</span>
        <select name="status" className="field" defaultValue="RESUELTA">
          <option value="RESUELTA">Resuelta</option>
          <option value="DESCARTADA">Descartada</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">Qué se hizo</span>
        <textarea name="resolution" rows={2} className="field resize-none" placeholder="Reposición ejecutada, precio corregido…" />
      </label>
      <div className="flex gap-1.5">
        <button type="submit" className="btn btn-primary !py-1 text-[12.5px]">Guardar</button>
        <button type="button" className="btn btn-ghost !py-1 text-[12.5px]" onClick={() => setOpen(false)}>
          <IconX size={12} /> Cancelar
        </button>
      </div>
    </form>
  );
}
