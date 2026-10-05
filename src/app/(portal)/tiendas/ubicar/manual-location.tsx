"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ubicarTiendaManual, type ManualLocationState } from "@/lib/actions-stores";

function Save() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-secondary" disabled={pending}>
      {pending ? "…" : "Fijar"}
    </button>
  );
}

/** Campo para pegar el enlace de Google Maps (o «lat, lng») de una tienda. */
export function ManualLocation({ id }: { id: string }) {
  const [state, action] = useActionState<ManualLocationState, FormData>(ubicarTiendaManual, {});
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <div className="flex gap-1.5">
        <input name="coordenadas" className="field w-full min-w-40 py-1 text-[12px]" placeholder="Enlace de Maps o lat, lng" />
        <Save />
      </div>
      {state.error && <p className="text-[11.5px] text-[var(--critical)]">{state.error}</p>}
    </form>
  );
}
