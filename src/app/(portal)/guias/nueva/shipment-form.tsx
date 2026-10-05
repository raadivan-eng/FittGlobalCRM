"use client";

import Link from "next/link";
import { startTransition, useActionState, useRef, useState } from "react";
import { crearGuia, type ShipmentFormState } from "@/lib/actions-shipments";
import { IconAlert, IconTruck } from "@/components/icons";

export type CarrierOption = { key: string; name: string; canCreate: boolean };

/** Pedido ofrecido para asociar, con el destino ya resuelto para prellenar. */
export type OrderOption = {
  id: string;
  label: string;
  recipientName: string;
  recipientPhone: string;
  destinationAddress: string;
  destinationCity: string;
  declaredValue: number;
};

const PREFILL = ["recipientName", "recipientPhone", "destinationAddress", "destinationCity", "declaredValue"] as const;

function Submit({ mode, pending }: { mode: "MANUAL" | "API"; pending: boolean }) {
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      <IconTruck size={14} />
      {pending ? (mode === "API" ? "Solicitando a la transportadora…" : "Guardando…") : mode === "API" ? "Solicitar guía" : "Registrar guía"}
    </button>
  );
}

function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? "sm:col-span-2" : ""}`}>
      <span className="text-[12px] font-medium text-[var(--text-secondary)]">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-[var(--text-muted)]">{hint}</span>}
    </label>
  );
}

export function ShipmentForm({ carriers, orders, defaultOrderId }: { carriers: CarrierOption[]; orders: OrderOption[]; defaultOrderId?: string }) {
  const [state, formAction, pending] = useActionState<ShipmentFormState, FormData>(crearGuia, {});
  const [carrier, setCarrier] = useState("");
  const [mode, setMode] = useState<"MANUAL" | "API">("MANUAL");
  const formRef = useRef<HTMLFormElement>(null);

  const selected = carriers.find((c) => c.key === carrier);
  const apiAvailable = Boolean(selected?.canCreate);
  const effectiveMode = apiAvailable ? mode : "MANUAL";
  const initialOrder = orders.find((o) => o.id === defaultOrderId);

  /** Copia el destino del pedido a los campos; luego se pueden corregir a mano. */
  const prefill = (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    const form = formRef.current;
    if (!order || !form) return;
    for (const name of PREFILL) {
      const input = form.elements.namedItem(name) as HTMLInputElement | null;
      if (input) input.value = String(order[name]);
    }
  };

  return (
    <form
      ref={formRef}
      // Con `action` React vacía el formulario al terminar, incluso si vuelve un
      // error; enviándolo a mano se conserva lo escrito para corregirlo.
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
      className="grid items-start gap-4 lg:grid-cols-3"
    >
      <input type="hidden" name="mode" value={effectiveMode} />

      <div className="card flex flex-col gap-4 px-4 py-4 lg:col-span-2">
        <section>
          <h3 className="text-[13.5px] font-semibold">Transportadora</h3>
          <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
            <Field label="Transportadora">
              <select name="carrier" className="field" required value={carrier} onChange={(e) => setCarrier(e.target.value)}>
                <option value="">Elige una…</option>
                {carriers.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}{c.canCreate ? " · API conectada" : ""}
                  </option>
                ))}
              </select>
            </Field>

            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-[12px] font-medium text-[var(--text-secondary)]">Cómo se genera</legend>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="radio" checked={effectiveMode === "MANUAL"} onChange={() => setMode("MANUAL")} />
                Ya la hice en el sitio de la transportadora
              </label>
              <label className={`flex items-center gap-2 text-[13px] ${apiAvailable ? "" : "text-[var(--text-muted)]"}`}>
                <input type="radio" checked={effectiveMode === "API"} disabled={!apiAvailable} onChange={() => setMode("API")} />
                Pedirla a la transportadora por API
              </label>
              {selected && !apiAvailable && (
                <span className="text-[11px] text-[var(--text-muted)]">
                  {selected.name} todavía no tiene la creación de guías por API habilitada.
                </span>
              )}
            </fieldset>

            {effectiveMode === "MANUAL" && (
              <Field label="Número de guía" hint="Tal como aparece en el rótulo de la transportadora" wide>
                <input name="trackingNumber" required className="field font-mono" autoComplete="off" spellCheck={false} />
              </Field>
            )}
          </div>
        </section>

        <section className="border-t border-[var(--border)] pt-4">
          <h3 className="text-[13.5px] font-semibold">Pedido y destino</h3>
          <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
            <Field label="Pedido asociado" hint="Opcional. Al elegirlo se copia su destino y valor; puedes corregirlos." wide>
              <select name="orderId" className="field" defaultValue={initialOrder?.id ?? ""} onChange={(e) => prefill(e.target.value)}>
                <option value="">Sin pedido</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Destinatario">
              <input name="recipientName" required className="field" defaultValue={initialOrder?.recipientName} />
            </Field>
            <Field label="Teléfono de contacto">
              <input name="recipientPhone" type="tel" className="field" defaultValue={initialOrder?.recipientPhone} />
            </Field>
            <Field label="Dirección de entrega" wide>
              <input name="destinationAddress" required className="field" defaultValue={initialOrder?.destinationAddress} />
            </Field>
            <Field label="Ciudad">
              <input name="destinationCity" required className="field" defaultValue={initialOrder?.destinationCity} />
            </Field>
          </div>
        </section>

        <section className="border-t border-[var(--border)] pt-4">
          <h3 className="text-[13.5px] font-semibold">Mercancía</h3>
          <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
            <Field label="Paquetes">
              <input name="packages" type="number" min={1} step={1} defaultValue={1} className="field" />
            </Field>
            <Field label="Peso total (kg)">
              <input name="weightKg" type="number" min={0} step="0.1" className="field" />
            </Field>
            <Field label="Valor declarado" hint="Base del seguro de la transportadora">
              <input name="declaredValue" type="number" min={0} step="1" className="field" defaultValue={initialOrder?.declaredValue} />
            </Field>
            <Field label="Costo del flete">
              <input name="shippingCost" type="number" min={0} step="1" className="field" />
            </Field>
            <Field label="Contenido" wide>
              <input name="contents" className="field" placeholder="Cajas de producto terminado, material POP…" />
            </Field>
          </div>
        </section>
      </div>

      <div className="card flex flex-col gap-3 px-4 py-4">
        <Field label="Entrega estimada">
          <input name="estimatedDelivery" type="date" className="field" />
        </Field>
        <Field label="Observaciones">
          <textarea name="notes" rows={3} className="field resize-none" placeholder="Horario de recibo, instrucciones de entrega…" />
        </Field>

        {state.error && (
          <p className="flex items-start gap-1.5 rounded-md border border-[var(--tone-danger-bd)] bg-[var(--tone-danger-bg)] px-2 py-1.5 text-[12px] text-[var(--tone-danger-fg)]">
            <IconAlert size={13} className="mt-px shrink-0" />
            {state.error}
          </p>
        )}

        <div className="flex flex-wrap gap-1.5 pt-1">
          <Submit mode={effectiveMode} pending={pending} />
          <Link href="/guias" className="btn btn-ghost">Cancelar</Link>
        </div>
      </div>
    </form>
  );
}
