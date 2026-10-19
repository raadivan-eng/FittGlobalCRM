"use client";

import { useState, useTransition } from "react";
import { cambiarEstadoActividad, quitarTienda, verificarEjecucion } from "@/lib/actions-trade";
import { TRADE_EXECUTION } from "@/lib/enums";

/** Botones de ciclo de vida según el estado actual. Cerrar pide el aprendizaje. */
export function StatusControls({ id, status }: { id: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState("");

  const send = (next: string, closingNote = "") => {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("status", next);
    if (closingNote) fd.set("closingNote", closingNote);
    startTransition(() => cambiarEstadoActividad(fd));
  };

  if (closing) {
    return (
      <div className="flex w-full max-w-md flex-col gap-2">
        <textarea
          className="field"
          rows={3}
          placeholder="¿Qué funcionó y qué no? Queda en la actividad para la próxima negociación."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary" disabled={pending} onClick={() => send("CERRADA", note)}>
            {pending ? "Cerrando…" : "Cerrar actividad"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setClosing(false)}>Volver</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status === "PLANEADA" && (
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => send("APROBADA")}>Aprobar</button>
      )}
      {status === "APROBADA" && (
        <>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={() => setClosing(true)}>Cerrar y evaluar</button>
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => send("PLANEADA")}>Volver a planeada</button>
        </>
      )}
      {(status === "CERRADA" || status === "CANCELADA") && (
        <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => send("APROBADA")}>Reabrir</button>
      )}
      {(status === "PLANEADA" || status === "APROBADA") && (
        <button
          type="button"
          className="btn btn-ghost text-[var(--critical)]"
          disabled={pending}
          onClick={() => confirm("¿Cancelar la actividad? Se conserva con su historia.") && send("CANCELADA")}
        >
          Cancelar
        </button>
      )}
    </div>
  );
}

/** Lo que se encontró en una tienda. Se abre en línea para no salir de la lista. */
export function ExecutionControl({
  id,
  status,
  notes,
  evidenceUrl,
  canRemove,
}: {
  id: string;
  status: string;
  notes: string | null;
  evidenceUrl: string | null;
  canRemove: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const quick = (next: string) => {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("status", next);
    if (notes) fd.set("notes", notes);
    if (evidenceUrl) fd.set("evidenceUrl", evidenceUrl);
    startTransition(() => verificarEjecucion(fd));
  };

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {status !== "IMPLEMENTADA" && (
          <button type="button" className="btn btn-secondary h-7 !px-2 text-[12px]" disabled={pending} onClick={() => quick("IMPLEMENTADA")}>
            Implementada
          </button>
        )}
        <button type="button" className="btn btn-ghost h-7 !px-2 text-[12px]" disabled={pending} onClick={() => setOpen(true)}>
          {status === "PENDIENTE" ? "Otro resultado…" : "Editar"}
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex w-full flex-col gap-2 sm:w-80"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          await verificarEjecucion(fd);
          setOpen(false);
        });
      }}
    >
      <input type="hidden" name="id" value={id} />
      <select name="status" className="field" defaultValue={status}>
        {TRADE_EXECUTION.options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <input name="notes" className="field" placeholder="Qué faltó: precio, material, espacio…" defaultValue={notes ?? ""} />
      <input name="evidenceUrl" type="url" className="field" placeholder="Enlace a la foto (opcional)" defaultValue={evidenceUrl ?? ""} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-primary h-8" disabled={pending}>{pending ? "Guardando…" : "Guardar"}</button>
        <button type="button" className="btn btn-ghost h-8" onClick={() => setOpen(false)}>Cerrar</button>
        {canRemove && (
          <button
            type="button"
            className="btn btn-ghost ml-auto h-8 text-[12px] text-[var(--critical)]"
            disabled={pending}
            onClick={() => {
              if (!confirm("¿Sacar esta tienda de la actividad?")) return;
              const fd = new FormData();
              fd.set("id", id);
              startTransition(() => quitarTienda(fd));
            }}
          >
            Quitar tienda
          </button>
        )}
      </div>
    </form>
  );
}
