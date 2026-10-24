"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { guardarCondicion, quitarCondicion } from "@/lib/actions-suppliers";
import { lineComplete, minOrderValue, totalLeadDays } from "@/lib/suppliers";
import { fmtMoney, fmtMoneyPrecise, fmtNumber } from "@/lib/format";
import { Field, FormMessage, submitKeeping } from "@/app/(portal)/leads/lead-controls";
import { Badge } from "@/components/ui";
import { IconPlus } from "@/components/icons";

/** Un SKU con sus condiciones: una línea de cotización o una condición vigente del proveedor. */
export type ConditionRow = {
  id: string;
  sku: string;
  description: string | null;
  product: { id: string; name: string } | null;
  minOrderQty: number | null;
  unitCost: number | null;
  productionLeadDays: number | null;
  transitDays: number | null;
};

/** `quote`: SKU de una cotización (las respuestas pueden faltar). `supplier`: condiciones vigentes (todas obligatorias). */
export type ConditionScope = "quote" | "supplier";

/**
 * Las seis preguntas de cada SKU. En una fila nueva del alta van sin nombre
 * propio (`sku`, `unitCost`…) y se repiten por fila; el servidor las lee en orden.
 */
export function ConditionInputs({ row, required = false, compact = false }: { row?: Partial<ConditionRow>; required?: boolean; compact?: boolean }) {
  const mark = required ? " *" : "";
  const num = (v: number | null | undefined) => (v != null ? String(v) : "");
  return (
    <>
      <Field label="1. SKU *">
        <input name="sku" required className="field font-mono text-[12.5px] uppercase" defaultValue={row?.sku ?? ""} placeholder="PROT-WHEY-2LB" />
      </Field>
      <Field label="Descripción" hint={compact ? undefined : "Si el SKU es del catálogo, toma su nombre"}>
        <input name="description" className="field" defaultValue={row?.description ?? ""} placeholder="Proteína whey 2 lb vainilla" />
      </Field>
      <Field label={`2. Cantidad mínima de compra${mark}`} hint={compact ? undefined : "Unidades por SKU"}>
        <input name="minOrderQty" inputMode="numeric" required={required} className="field tabular-nums" defaultValue={num(row?.minOrderQty)} placeholder="500" />
      </Field>
      <Field label={`3. Costo por unidad${mark}`} hint={compact ? undefined : "Sin IVA"}>
        <input name="unitCost" inputMode="decimal" required={required} className="field tabular-nums" defaultValue={num(row?.unitCost)} placeholder="0" />
      </Field>
      <Field label={`5. Production lead time${mark}`} hint={compact ? undefined : "Días desde la orden"}>
        <input name="productionLeadDays" inputMode="numeric" required={required} className="field tabular-nums" defaultValue={num(row?.productionLeadDays)} placeholder="30" />
      </Field>
      <Field label={`6. Transit time${mark}`} hint={compact ? undefined : "Días hasta la bodega"}>
        <input name="transitDays" inputMode="numeric" required={required} className="field tabular-nums" defaultValue={num(row?.transitDays)} placeholder="15" />
      </Field>
    </>
  );
}

function ConditionForm({ scope, parentId, row, close }: { scope: ConditionScope; parentId: string; row?: ConditionRow; close: () => void }) {
  const [state, formAction, pending] = useActionState(guardarCondicion, {});
  useEffect(() => {
    if (state.ok) close();
  }, [state, close]);
  return (
    <form onSubmit={submitKeeping(formAction)} className="grid gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3 sm:grid-cols-2 lg:grid-cols-3">
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="parentId" value={parentId} />
      {row && <input type="hidden" name="lineId" value={row.id} />}
      <ConditionInputs row={row} required={scope === "supplier"} />
      <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-3">
        {scope === "quote" && <span className="text-[11px] text-[var(--text-muted)]">Deja vacío lo que el proveedor no haya respondido todavía.</span>}
        <FormMessage state={state} />
        <div className="flex gap-1.5">
          <button type="submit" className="btn btn-secondary" disabled={pending}>
            {pending ? "Guardando…" : row ? "Guardar SKU" : "Agregar SKU"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={close}>Cancelar</button>
        </div>
      </div>
    </form>
  );
}

const pending = <span className="text-[var(--text-muted)]">—</span>;

/**
 * Tabla de SKU con sus condiciones. Con `editable`, cada fila se corrige en
 * línea y se agregan SKU nuevos; la compra mínima y el lead time total se
 * calculan, no se preguntan.
 */
export function ConditionsTable({
  scope,
  parentId,
  rows,
  editable,
}: {
  scope: ConditionScope;
  parentId: string;
  rows: ConditionRow[];
  editable: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const close = () => setEditing(null);
  // En una cotización siempre queda al menos un SKU.
  const removable = scope === "supplier" || rows.length > 1;

  return (
    <div>
      {rows.length > 0 && (
        <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th>SKU</th>
                <th className="num">Mín. compra</th>
                <th className="num">Costo unit.</th>
                <th className="num">Compra mínima</th>
                <th className="num" title="Production lead time más transit time">Lead time</th>
                {editable && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const total = totalLeadDays(r);
                const value = minOrderValue(r);
                if (editing === r.id) {
                  return (
                    <tr key={r.id}>
                      <td colSpan={editable ? 6 : 5} className="!py-3">
                        <ConditionForm scope={scope} parentId={parentId} row={r} close={close} />
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={r.id}>
                    <td className="min-w-[200px]">
                      <span className="font-mono text-[12.5px] font-medium">{r.sku}</span>
                      {scope === "quote" && !lineComplete(r) && <Badge tone="warning" className="ml-1.5">Sin respuesta</Badge>}
                      <span className="block text-[11.5px] text-[var(--text-muted)]">
                        {r.product ? (
                          <Link href={`/productos?q=${encodeURIComponent(r.sku)}`} className="hover:text-[var(--brand)] hover:underline">
                            {r.description ?? r.product.name}
                          </Link>
                        ) : (
                          (r.description ?? "Fuera del catálogo")
                        )}
                      </span>
                    </td>
                    <td className="num whitespace-nowrap">{r.minOrderQty != null ? `${fmtNumber(r.minOrderQty)} u` : pending}</td>
                    <td className="num whitespace-nowrap">{r.unitCost != null ? fmtMoneyPrecise(r.unitCost) : pending}</td>
                    <td className="num whitespace-nowrap">{value != null ? fmtMoney(value) : pending}</td>
                    <td className="num whitespace-nowrap">
                      {total != null ? <span className="font-semibold">{total} días</span> : pending}
                      {(r.productionLeadDays != null || r.transitDays != null) && (
                        <span className="block text-[11px] text-[var(--text-muted)]">
                          {r.productionLeadDays ?? "?"} producción · {r.transitDays ?? "?"} tránsito
                        </span>
                      )}
                    </td>
                    {editable && (
                      <td className="whitespace-nowrap text-right">
                        <button type="button" className="btn btn-ghost !px-2 text-[12.5px]" onClick={() => setEditing(r.id)}>
                          Editar
                        </button>
                        {removable && (
                          <form action={quitarCondicion} className="inline">
                            <input type="hidden" name="scope" value={scope} />
                            <input type="hidden" name="parentId" value={parentId} />
                            <input type="hidden" name="lineId" value={r.id} />
                            <button type="submit" className="btn btn-ghost !px-2 text-[12.5px] text-[var(--tone-danger-fg)]">Quitar</button>
                          </form>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editable && (
        <div className="border-t border-[var(--border)] px-4 py-3">
          {editing === "new" ? (
            <ConditionForm scope={scope} parentId={parentId} close={close} />
          ) : (
            <button type="button" className="btn btn-ghost !px-2 text-[12.5px]" onClick={() => setEditing("new")}>
              <IconPlus size={13} /> Agregar SKU
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Condiciones de compra (pregunta 4): el texto pactado y el plazo en días. */
export function PaymentTermsInputs({ terms, days, required = false }: { terms: string | null; days: number | null; required?: boolean }) {
  return (
    <>
      <Field label={`4. Condiciones de compra${required ? " *" : ""}`} hint="Cómo se le paga: plazo, anticipo, contra entrega…">
        <input name="paymentTerms" required={required} className="field" defaultValue={terms ?? ""} placeholder="Pago a 30 días" />
      </Field>
      <Field label="Plazo de pago (días)" hint="Vacío: se toma del texto. Contado = 0">
        <input name="paymentTermDays" inputMode="numeric" className="field tabular-nums" defaultValue={days != null ? String(days) : ""} placeholder="30" />
      </Field>
    </>
  );
}
