"use client";

import { startTransition, useActionState, useState } from "react";
import { crearActividad, editarActividad, type TradeFormState } from "@/lib/actions-trade";
import { TRADE_TYPES } from "@/lib/enums";
import { fmtNumber } from "@/lib/format";
import { IconAlert, IconMegaphone } from "@/components/icons";

export type CompanyOption = { id: string; name: string; cities: { city: string; stores: number }[] };
export type ProductOption = { id: string; label: string; brand: string };
export type OwnerOption = { id: string; name: string };

export type ActivityDefaults = {
  id: string;
  type: string;
  title: string;
  mechanic: string;
  description: string;
  startDate: string;
  endDate: string;
  budget: number;
  ownerId: string;
  productIds: string[];
};

function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? "sm:col-span-2" : ""}`}>
      <span className="text-[12px] font-medium text-[var(--text-secondary)]">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-[var(--text-muted)]">{hint}</span>}
    </label>
  );
}

/**
 * Alta y edición de una actividad. Al crearla se elige el cliente y dónde debe
 * verse; al editarla, las tiendas se gestionan desde el detalle.
 */
export function ActivityForm({
  companies = [],
  products,
  owners,
  defaults,
}: {
  companies?: CompanyOption[];
  products: ProductOption[];
  owners: OwnerOption[];
  defaults?: ActivityDefaults;
}) {
  const editing = Boolean(defaults);
  const [state, formAction, pending] = useActionState<TradeFormState, FormData>(editing ? editarActividad : crearActividad, {});
  const [companyId, setCompanyId] = useState("");
  const [allCities, setAllCities] = useState(true);
  const [cities, setCities] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  const company = companies.find((c) => c.id === companyId);
  const storeCount = company
    ? company.cities.filter((c) => allCities || cities.includes(c.city)).reduce((t, c) => t + c.stores, 0)
    : 0;

  const brands = [...new Set(products.map((p) => p.brand))];

  return (
    <form
      // Con `action` React vacía el formulario al terminar, incluso si vuelve un
      // error; enviándolo a mano se conserva lo escrito para corregirlo.
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setSaved(false);
        startTransition(() => {
          formAction(fd);
          if (editing) setSaved(true);
        });
      }}
      className="grid items-start gap-4 lg:grid-cols-3"
    >
      {defaults && <input type="hidden" name="id" value={defaults.id} />}

      <div className="card flex flex-col gap-4 px-4 py-4 lg:col-span-2">
        <section>
          <h3 className="text-[13.5px] font-semibold">La actividad</h3>
          <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
            <Field label="Tipo">
              <select name="type" className="field" required defaultValue={defaults?.type ?? ""}>
                <option value="">Elige uno…</option>
                {TRADE_TYPES.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Responsable">
              <select name="ownerId" className="field" defaultValue={defaults?.ownerId ?? ""}>
                <option value="">Quien la crea</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Nombre" wide>
              <input name="title" required className="field" placeholder="Temporada deportiva — punta de góndola" defaultValue={defaults?.title} />
            </Field>
            <Field label="Mecánica" hint="Tal como se pactó: es lo que se va a verificar en la tienda" wide>
              <input name="mechanic" className="field" placeholder="2×1 en barras de 60 g · rompetráfico en cada caja" defaultValue={defaults?.mechanic} />
            </Field>
            <Field label="Inicio">
              <input name="startDate" type="date" required className="field" defaultValue={defaults?.startDate} />
            </Field>
            <Field label="Fin">
              <input name="endDate" type="date" required className="field" defaultValue={defaults?.endDate} />
            </Field>
            <Field label="Inversión comprometida" hint="Sin IVA: descuento, fee de exhibición, material, impulso">
              <input name="budget" inputMode="numeric" className="field tabular" placeholder="0" defaultValue={defaults?.budget || ""} />
            </Field>
            <Field label="Notas" wide>
              <textarea name="description" rows={3} className="field" placeholder="Condiciones, contacto en la cadena, qué material se envía…" defaultValue={defaults?.description} />
            </Field>
          </div>
        </section>

        <section className="border-t border-[var(--border)] pt-4">
          <h3 className="text-[13.5px] font-semibold">Productos</h3>
          <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">Sin marcar ninguno, cubre todo el portafolio. Son los que se miden en el sell-out.</p>
          <div className="mt-2.5 flex flex-col gap-3">
            {brands.map((brand) => (
              <fieldset key={brand}>
                <legend className="mb-1 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">{brand}</legend>
                <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                  {products.filter((p) => p.brand === brand).map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-[13px]">
                      <input type="checkbox" name="productIds" value={p.id} defaultChecked={defaults?.productIds.includes(p.id)} />
                      <span className="truncate">{p.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        </section>
      </div>

      <div className="flex flex-col gap-4">
        {!editing && (
          <div className="card flex flex-col gap-3 px-4 py-4">
            <h3 className="text-[13.5px] font-semibold">Dónde se ejecuta</h3>
            <Field label="Cliente">
              <select name="companyId" className="field" required value={companyId} onChange={(e) => { setCompanyId(e.target.value); setCities([]); setAllCities(true); }}>
                <option value="">Elige el cliente…</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
            {company && (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1 text-[12px] font-medium text-[var(--text-secondary)]">Tiendas</legend>
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="radio" checked={allCities} onChange={() => setAllCities(true)} />
                  Todas las activas
                </label>
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="radio" checked={!allCities} onChange={() => setAllCities(false)} />
                  Sólo algunas ciudades
                </label>
                {!allCities && (
                  <div className="ml-6 mt-1 flex max-h-56 flex-col gap-1 overflow-y-auto">
                    {company.cities.map((c) => (
                      <label key={c.city} className="flex items-center justify-between gap-2 text-[12.5px]">
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            name="cities"
                            value={c.city}
                            checked={cities.includes(c.city)}
                            onChange={(e) => setCities(e.target.checked ? [...cities, c.city] : cities.filter((x) => x !== c.city))}
                          />
                          {c.city}
                        </span>
                        <span className="tabular text-[var(--text-muted)]">{c.stores}</span>
                      </label>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
                  {fmtNumber(storeCount)} tienda{storeCount === 1 ? "" : "s"} quedan por verificar. Después puedes sumar o quitar tiendas.
                </p>
              </fieldset>
            )}
            <fieldset className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-3">
              <legend className="mb-1 text-[12px] font-medium text-[var(--text-secondary)]">Estado</legend>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="radio" name="status" value="PLANEADA" defaultChecked />
                Planeada: todavía en negociación
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="radio" name="status" value="APROBADA" />
                Aprobada: ya está pactada
              </label>
            </fieldset>
          </div>
        )}

        <div className="card flex flex-col gap-2 px-4 py-4">
          {state.error && (
            <p className="flex items-center gap-2 text-[12.5px] text-[var(--critical)]">
              <IconAlert size={14} /> {state.error}
            </p>
          )}
          {editing && saved && !pending && !state.error && <p className="text-[12.5px] text-[var(--good)]">Cambios guardados.</p>}
          <button type="submit" className="btn btn-primary" disabled={pending}>
            <IconMegaphone size={14} />
            {pending ? "Guardando…" : editing ? "Guardar cambios" : "Crear actividad"}
          </button>
        </div>
      </div>
    </form>
  );
}
