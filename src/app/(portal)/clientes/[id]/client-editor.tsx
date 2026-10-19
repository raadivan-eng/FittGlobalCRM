"use client";

import { useActionState, useState, type ReactNode } from "react";
import { guardarCliente, type ClientFormState } from "@/lib/actions-clients";
import { CHANNELS, COMPANY_TYPES, TIERS } from "@/lib/enums";
import { Field, FormMessage, submitKeeping } from "@/app/(portal)/leads/lead-controls";
import { Card, CardHeader } from "@/components/ui";

export type ClientRow = {
  id: string;
  name: string;
  taxId: string | null;
  type: string;
  channel: string;
  tier: string;
  ownerId: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  creditLimit: number;
  paymentTermDays: number;
  notes: string | null;
  siigoId: string | null;
};

function ClientFields({ row, owners, close }: { row: ClientRow; owners: { id: string; name: string }[]; close: () => void }) {
  const [state, formAction, pending] = useActionState(guardarCliente, {});
  const [seen, setSeen] = useState<ClientFormState>(state);
  const [type, setType] = useState(row.type);
  const [channel, setChannel] = useState(row.channel);
  if (state !== seen) {
    setSeen(state);
    if (state.ok) close();
  }
  return (
    <form onSubmit={submitKeeping(formAction)} className="grid gap-3 px-4 py-3 sm:grid-cols-2">
      <input type="hidden" name="companyId" value={row.id} />
      <Field label="Razón social *" wide>
        <input name="name" required className="field" defaultValue={row.name} />
      </Field>
      <Field label="Tipo de cliente" hint={COMPANY_TYPES.get(type).hint} wide>
        <select name="type" className="field" value={type} onChange={(e) => setType(e.target.value)}>
          {COMPANY_TYPES.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Canal" hint={CHANNELS.get(channel).hint} wide>
        <select name="channel" className="field" value={channel} onChange={(e) => setChannel(e.target.value)}>
          {CHANNELS.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Clasificación ABC">
        <select name="tier" className="field" defaultValue={row.tier}>
          {TIERS.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Responsable">
        <select name="ownerId" className="field" defaultValue={row.ownerId ?? ""}>
          <option value="">Sin asignar</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </Field>
      <Field label="NIT" hint={row.siigoId ? "Fijo: ya está creado en Siigo" : undefined}>
        <input name="taxId" className="field" defaultValue={row.taxId ?? ""} disabled={!!row.siigoId} />
      </Field>
      <Field label="Ciudad">
        <input name="city" className="field" defaultValue={row.city ?? ""} />
      </Field>
      <Field label="Dirección" wide>
        <input name="address" className="field" defaultValue={row.address ?? ""} />
      </Field>
      <Field label="Teléfono">
        <input name="phone" type="tel" className="field" defaultValue={row.phone ?? ""} />
      </Field>
      <Field label="Correo">
        <input name="email" type="email" className="field" defaultValue={row.email ?? ""} />
      </Field>
      <Field label="Cupo de crédito">
        <input name="creditLimit" type="number" min={0} step="any" className="field" defaultValue={row.creditLimit} />
      </Field>
      <Field label="Plazo de pago (días)">
        <input name="paymentTermDays" type="number" min={0} max={365} step={1} className="field" defaultValue={row.paymentTermDays} />
      </Field>
      <Field label="Notas" wide>
        <textarea name="notes" rows={3} className="field" defaultValue={row.notes ?? ""} />
      </Field>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <FormMessage state={state} />
        <div className="flex gap-1.5">
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Guardando…" : "Guardar cliente"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={close}>Cancelar</button>
        </div>
      </div>
    </form>
  );
}

/**
 * Tarjeta «Ficha comercial»: muestra la ficha (children, pintada en el servidor)
 * y, para quien puede editar, la cambia por el formulario en el mismo lugar.
 */
export function ClientCard({ row, owners, canEdit, children }: { row: ClientRow; owners: { id: string; name: string }[]; canEdit: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader
        title="Ficha comercial"
        subtitle={open ? "Corrige la clasificación y los datos del cliente" : undefined}
        action={canEdit && !open && <button type="button" className="btn btn-ghost !px-2 text-[12.5px]" onClick={() => setOpen(true)}>Editar</button>}
      />
      {open ? <ClientFields row={row} owners={owners} close={() => setOpen(false)} /> : children}
    </Card>
  );
}
