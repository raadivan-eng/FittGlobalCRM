"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cambiarEstadoCliente, type ClientFormState } from "@/lib/actions-clients";
import { FormMessage, submitKeeping } from "@/app/(portal)/leads/lead-controls";
import { IconX } from "@/components/icons";

/**
 * Inactiva o reactiva un cliente a mano. Inactivar pide el motivo en un
 * diálogo, montado en <body> para no heredar el estilo de la celda donde vive
 * el botón; reactivar es un clic, porque sólo deshace una decisión manual.
 */
export function ClientStatusControl({
  companyId,
  companyName,
  manual,
  className = "btn btn-secondary",
}: {
  companyId: string;
  companyName: string;
  /** Ya está inactivo a mano: el botón lo reactiva. */
  manual: boolean;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(cambiarEstadoCliente, {});
  const [seen, setSeen] = useState<ClientFormState>(state);
  const ref = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (state !== seen) {
    setSeen(state);
    if (state.ok) ref.current?.close();
  }

  if (manual) {
    return (
      <form onSubmit={submitKeeping(formAction)} className="inline">
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="estado" value="ACTIVO" />
        <button className={className} disabled={pending} title="Vuelve a entrar al forecast con su historia">
          {pending ? "Reactivando…" : "Reactivar"}
        </button>
      </form>
    );
  }

  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.showModal()}>
        Inactivar
      </button>
      {mounted &&
        createPortal(
          <dialog
            ref={ref}
            className="card m-auto w-[min(440px,calc(100vw-32px))] overflow-x-hidden whitespace-normal p-0 text-left text-[13px] font-normal text-[var(--text-primary)] backdrop:bg-black/40"
            onClick={(e) => e.target === ref.current && ref.current?.close()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
              <div>
                <h2 className="text-[14px] font-semibold">Inactivar {companyName}</h2>
                <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">
                  Desde este mes el forecast lo proyecta en 0, aunque tenga historia. Sigue así hasta que alguien lo reactive.
                </p>
              </div>
              <button type="button" onClick={() => ref.current?.close()} className="btn btn-ghost !px-1 !py-0.5" aria-label="Cerrar">
                <IconX size={14} />
              </button>
            </div>
            <form onSubmit={submitKeeping(formAction)} className="flex flex-col gap-2 px-4 py-3">
              <input type="hidden" name="companyId" value={companyId} />
              <input type="hidden" name="estado" value="INACTIVO" />
              <input name="reason" required className="field" placeholder="Motivo: cerró, cambió de proveedor, dejó de pagar…" />
              <FormMessage state={state} />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => ref.current?.close()} className="btn btn-secondary">
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={pending}>
                  {pending ? "Inactivando…" : "Inactivar"}
                </button>
              </div>
            </form>
          </dialog>,
          document.body,
        )}
    </>
  );
}
