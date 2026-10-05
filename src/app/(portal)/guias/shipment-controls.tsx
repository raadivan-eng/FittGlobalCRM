"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import {
  anularGuia,
  asignarNumeroGuia,
  consultarGuia,
  consultarGuiasActivas,
  registrarMovimiento,
  solicitarGuia,
} from "@/lib/actions-shipments";
import { IconPlus, IconRefresh, IconTruck, IconX } from "@/components/icons";

/** Opciones de estado que se pueden anotar a mano, ya con su etiqueta. */
export type StatusChoice = { value: string; label: string };

function Submit({ label, pendingLabel, className, icon }: { label: string; pendingLabel: string; className: string; icon?: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? pendingLabel : (<>{icon}{label}</>)}
    </button>
  );
}

/** Consulta en bloque las guías en curso de las transportadoras con rastreo por API. */
export function RefreshActiveButton() {
  return (
    <form action={consultarGuiasActivas}>
      <Submit label="Actualizar guías en curso" pendingLabel="Consultando transportadoras…" className="btn btn-secondary" icon={<IconRefresh size={14} />} />
    </form>
  );
}

export function TrackButton({ id }: { id: string }) {
  return (
    <form action={consultarGuia}>
      <input type="hidden" name="id" value={id} />
      <Submit label="Consultar estado" pendingLabel="Consultando…" className="btn btn-primary !py-1 text-[12.5px]" icon={<IconRefresh size={12} />} />
    </form>
  );
}

export function RequestButton({ id, carrier }: { id: string; carrier: string }) {
  return (
    <form action={solicitarGuia}>
      <input type="hidden" name="id" value={id} />
      <Submit label={`Solicitar guía a ${carrier}`} pendingLabel="Solicitando…" className="btn btn-primary !py-1 text-[12.5px]" icon={<IconTruck size={12} />} />
    </form>
  );
}

/** Para el borrador cuya guía se terminó haciendo fuera del portal. */
export function AssignNumberForm({ id }: { id: string }) {
  return (
    <form action={asignarNumeroGuia} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="flex min-w-[200px] flex-1 flex-col gap-1">
        <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">Número de guía</span>
        <input name="trackingNumber" required className="field font-mono" placeholder="El que entregó la transportadora" />
      </label>
      <Submit label="Registrar número" pendingLabel="Guardando…" className="btn btn-secondary" />
    </form>
  );
}

/** Anota un movimiento de la trazabilidad a mano. */
export function MovementForm({ id, choices, defaultStatus }: { id: string; choices: StatusChoice[]; defaultStatus: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary !py-1 text-[12.5px]" onClick={() => setOpen(true)}>
        <IconPlus size={12} /> Registrar movimiento
      </button>
    );
  }

  return (
    <form
      action={async (fd) => {
        await registrarMovimiento(fd);
        setOpen(false);
      }}
      className="flex w-full flex-col gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3"
    >
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">Nuevo estado</span>
          <select name="status" className="field" defaultValue={defaultStatus}>
            {choices.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">Cuándo ocurrió</span>
          <input name="occurredAt" type="datetime-local" className="field" />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">Qué pasó</span>
        <input name="description" className="field" placeholder="Recibido en centro de distribución, destinatario ausente…" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">Dónde</span>
        <input name="location" className="field" placeholder="Ciudad o centro de la transportadora" />
      </label>
      <p className="text-[11px] text-[var(--text-muted)]">Si dejas la fecha vacía se toma la hora actual.</p>
      <div className="flex gap-1.5">
        <Submit label="Guardar" pendingLabel="Guardando…" className="btn btn-primary !py-1 text-[12.5px]" />
        <button type="button" className="btn btn-ghost !py-1 text-[12.5px]" onClick={() => setOpen(false)}>
          <IconX size={12} /> Cancelar
        </button>
      </div>
    </form>
  );
}

export function CancelForm({ id }: { id: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost !py-1 text-[12.5px]" onClick={() => setOpen(true)}>
        Anular guía
      </button>
    );
  }

  return (
    <form action={anularGuia} className="flex w-full flex-col gap-2 rounded-lg border border-[var(--tone-danger-bd)] bg-[var(--tone-danger-bg)] p-2.5">
      <input type="hidden" name="id" value={id} />
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-medium text-[var(--tone-danger-fg)]">Motivo de la anulación</span>
        <input name="motivo" className="field" placeholder="Pedido cancelado, datos errados…" />
      </label>
      <div className="flex gap-1.5">
        <Submit label="Anular" pendingLabel="Anulando…" className="btn btn-danger !py-1 text-[12.5px]" />
        <button type="button" className="btn btn-ghost !py-1 text-[12.5px]" onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
