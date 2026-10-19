"use client";

import { useActionState, useEffect, useState } from "react";
import { eliminarContacto, guardarContacto, vincularContacto } from "@/lib/actions-contacts";
import { Field, FormMessage, submitKeeping } from "@/app/(portal)/leads/lead-controls";
import { IconPlus } from "@/components/icons";

export type ContactRow = {
  id: string;
  firstName: string;
  lastName: string;
  position: string;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
  isDecisionMaker: boolean;
};

type StoreOption = { id: string; name: string };

function ContactFields({
  companyId,
  stores,
  checkedStoreId,
  row,
  close,
}: {
  companyId: string;
  stores: StoreOption[];
  checkedStoreId?: string;
  row?: ContactRow;
  close: () => void;
}) {
  const [state, formAction, pending] = useActionState(guardarContacto, {});
  // Al guardar bien se cierra el editor; el padre vuelve a mostrar la lista.
  useEffect(() => {
    if (state.ok) close();
  }, [state, close]);
  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={submitKeeping(formAction)} className="grid gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3 sm:grid-cols-2">
        <input type="hidden" name="companyId" value={companyId} />
        {row && <input type="hidden" name="contactId" value={row.id} />}
        <Field label="Nombre *">
          <input name="firstName" required className="field" defaultValue={row?.firstName ?? ""} />
        </Field>
        <Field label="Apellido">
          <input name="lastName" className="field" defaultValue={row?.lastName ?? ""} />
        </Field>
        <Field label="Cargo *" wide>
          <input name="position" required className="field" defaultValue={row?.position ?? ""} placeholder="Comprador, jefe de tienda, administrador…" />
        </Field>
        <Field label="Teléfono">
          <input name="phone" type="tel" className="field" defaultValue={row?.phone ?? ""} />
        </Field>
        <Field label="Correo">
          <input name="email" type="email" className="field" defaultValue={row?.email ?? ""} />
        </Field>
        <div className="flex flex-wrap gap-4 text-[12.5px] sm:col-span-2">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="isPrimary" defaultChecked={row?.isPrimary ?? false} /> Principal
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="isDecisionMaker" defaultChecked={row?.isDecisionMaker ?? false} /> Decide la compra
          </label>
        </div>
        {!row && stores.length > 0 && (
          <fieldset className="flex flex-col gap-1 sm:col-span-2">
            <legend className="mb-1 text-[12px] font-medium text-[var(--text-secondary)]">Tiendas que atiende</legend>
            <div className="grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2">
              {stores.map((s) => (
                <label key={s.id} className="flex items-center gap-1.5 text-[12.5px]">
                  <input type="checkbox" name="storeIds" value={s.id} defaultChecked={s.id === checkedStoreId} />
                  <span className="truncate">{s.name}</span>
                </label>
              ))}
            </div>
            <span className="text-[11px] text-[var(--text-muted)]">Sin tiendas queda como contacto corporativo.</span>
          </fieldset>
        )}
        <div className="flex flex-col gap-2 sm:col-span-2">
          <FormMessage state={state} />
          <div className="flex gap-1.5">
            <button type="submit" className="btn btn-secondary" disabled={pending}>
              {pending ? "Guardando…" : row ? "Guardar contacto" : "Agregar contacto"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={close}>Cancelar</button>
          </div>
        </div>
      </form>
      {row && (
        <form
          action={eliminarContacto}
          onSubmit={(e) => {
            if (!confirm(`¿Eliminar a ${row.firstName} ${row.lastName}? Se quita del cliente y de todas sus tiendas.`)) e.preventDefault();
          }}
        >
          <input type="hidden" name="contactId" value={row.id} />
          <button type="submit" className="btn btn-ghost !px-2 text-[12.5px] text-[var(--tone-danger-fg)]">Eliminar contacto</button>
        </form>
      )}
    </div>
  );
}

/**
 * Alta o corrección de un contacto del cliente. En la ficha de una tienda,
 * `checkedStoreId` deja esa tienda marcada para que el contacto nazca vinculado.
 */
export function ContactEditor(props: { companyId: string; stores?: StoreOption[]; checkedStoreId?: string; row?: ContactRow }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="btn btn-ghost !px-2 text-[12.5px]" onClick={() => setOpen(true)}>
        {props.row ? "Editar" : <><IconPlus size={13} /> Nuevo contacto</>}
      </button>
    );
  }
  return (
    <div className="w-full">
      <ContactFields {...props} stores={props.stores ?? []} close={() => setOpen(false)} />
    </div>
  );
}

/** Vincula a la tienda un contacto que ya existe en el cliente. */
export function LinkContactForm({ storeId, options }: { storeId: string; options: { id: string; label: string }[] }) {
  if (!options.length) return null;
  return (
    <form action={vincularContacto} className="flex gap-1.5">
      <input type="hidden" name="storeId" value={storeId} />
      <select name="contactId" className="field min-w-0 flex-1" required defaultValue="" aria-label="Contacto del cliente">
        <option value="" disabled>Vincular un contacto del cliente…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      <button type="submit" className="btn btn-secondary">Vincular</button>
    </form>
  );
}
