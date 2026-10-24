"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { actualizarProveedor, importarProveedoresSiigo } from "@/lib/actions-suppliers";
import { Field, FormMessage, submitKeeping, type OwnerOption } from "@/app/(portal)/leads/lead-controls";
import { PaymentTermsInputs } from "@/components/supplier-forms";
import { IconRefresh } from "@/components/icons";

/**
 * Trae de Siigo los terceros que allá son proveedores. Llama la importación
 * página por página hasta terminar; si Siigo pide pausa, espera y sigue.
 */
export function ImportSiigoButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});

  async function run() {
    setRunning(true);
    setResult({});
    setProgress("Conectando con Siigo…");
    let page = 1;
    let nuevos = 0;
    let enlazados = 0;
    try {
      for (;;) {
        const b = await importarProveedoresSiigo(page);
        if (b.error) {
          setResult({ error: b.error });
          break;
        }
        if (b.retryAfterSeconds) {
          setProgress(`Siigo pidió una pausa: sigue en ${b.retryAfterSeconds} s…`);
          await new Promise((r) => setTimeout(r, b.retryAfterSeconds! * 1000));
          continue;
        }
        nuevos += b.nuevos;
        enlazados += b.enlazados;
        if (b.done) {
          setResult({ ok: `${nuevos} proveedores nuevos · ${enlazados} enlazados a los que ya estaban.` });
          break;
        }
        setProgress(`Página ${b.page} de ${b.pages} · ${nuevos} nuevos, ${enlazados} enlazados`);
        page++;
      }
    } catch {
      setResult({ error: "Se cortó la comunicación con el portal. Vuelve a importar: lo que ya entró no se duplica." });
    }
    setProgress(null);
    setRunning(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className="btn btn-secondary" onClick={run} disabled={running} title="Trae los terceros que en Siigo son proveedores; se cruzan por NIT">
        <IconRefresh size={14} className={running ? "animate-spin" : ""} />
        {running ? "Importando…" : "Traer de Siigo"}
      </button>
      {progress && <p className="text-[11.5px] tabular text-[var(--text-secondary)]" aria-live="polite">{progress}</p>}
      {(result.ok || result.error) && <div className="max-w-sm text-right"><FormMessage state={result} /></div>}
    </div>
  );
}

type SupplierRow = {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  address: string | null;
  paymentTerms: string | null;
  paymentTermDays: number | null;
  notes: string | null;
  active: boolean;
  ownerId: string | null;
};

export function SupplierForm({ supplier, owners }: { supplier: SupplierRow; owners: OwnerOption[] }) {
  const [state, formAction, pending] = useActionState(actualizarProveedor, {});
  return (
    <form onSubmit={submitKeeping(formAction)} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={supplier.id} />
      <Field label="Nombre *" wide>
        <input name="name" required className="field" defaultValue={supplier.name} />
      </Field>
      <Field label="Contacto">
        <input name="contactName" className="field" defaultValue={supplier.contactName ?? ""} />
      </Field>
      <Field label="Responsable">
        <select name="ownerId" className="field" defaultValue={supplier.ownerId ?? ""}>
          <option value="">Sin asignar</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Teléfono">
        <input name="phone" type="tel" className="field" defaultValue={supplier.phone ?? ""} />
      </Field>
      <Field label="Correo">
        <input name="email" type="email" className="field" defaultValue={supplier.email ?? ""} />
      </Field>
      <Field label="Ciudad">
        <input name="city" className="field" defaultValue={supplier.city ?? ""} />
      </Field>
      <Field label="Dirección">
        <input name="address" className="field" defaultValue={supplier.address ?? ""} />
      </Field>
      <PaymentTermsInputs terms={supplier.paymentTerms} days={supplier.paymentTermDays} />
      <Field label="Observaciones" wide>
        <textarea name="notes" rows={3} className="field resize-none" defaultValue={supplier.notes ?? ""} />
      </Field>
      <label className="flex items-center gap-2 text-[12.5px] sm:col-span-2">
        <input type="checkbox" name="active" defaultChecked={supplier.active} />
        Activo: se le sigue comprando
      </label>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <FormMessage state={state} />
        <div>
          <button type="submit" className="btn btn-secondary" disabled={pending}>
            {pending ? "Guardando…" : "Guardar proveedor"}
          </button>
        </div>
      </div>
    </form>
  );
}
