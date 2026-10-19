"use client";

import { useState, useTransition } from "react";
import { agregarTiendas } from "@/lib/actions-trade";
import { IconPlus } from "@/components/icons";

type StoreOption = { id: string; name: string; code: string; city: string };

/** Suma tiendas del cliente que no estaban en la actividad. */
export function AddStores({ id, stores }: { id: string; stores: StoreOption[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost !px-2 text-[12.5px]" onClick={() => setOpen(true)}>
        <IconPlus size={13} /> Sumar tiendas
      </button>
    );
  }

  return (
    <form
      className="flex w-72 flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          await agregarTiendas(fd);
          setOpen(false);
        });
      }}
    >
      <input type="hidden" name="id" value={id} />
      <select name="storeIds" multiple required className="field h-44" aria-label="Tiendas para sumar">
        {stores.map((s) => (
          <option key={s.id} value={s.id}>{s.city} · {s.name} ({s.code})</option>
        ))}
      </select>
      <span className="text-[11px] text-[var(--text-muted)]">Cmd o Ctrl para elegir varias.</span>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary h-8" disabled={pending}>{pending ? "Sumando…" : "Sumar"}</button>
        <button type="button" className="btn btn-ghost h-8" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </form>
  );
}
