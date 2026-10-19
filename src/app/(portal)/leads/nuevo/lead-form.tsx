"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import { buscarLugares, crearLead, ubicarPunto } from "@/lib/actions-leads";
import type { PlaceOption } from "@/lib/leads";
import { LEAD_SOURCES, LEAD_STATUS, STORE_FORMATS } from "@/lib/enums";
import { IconPin, IconSearch, IconX } from "@/components/icons";
import { CloseFields, Field, FormMessage, submitKeeping, type OwnerOption } from "../lead-controls";

const MANUAL_SOURCES = ["DIRECTO", "WHATSAPP", "FACEBOOK", "INSTAGRAM", "WEB"];

export function NewLeadForm({
  mode,
  owners,
  defaultOwnerId,
  periods,
  mapsReady,
}: {
  mode: "SALES_HUNT" | "INBOUND";
  owners: OwnerOption[];
  defaultOwnerId: string;
  periods: string[];
  mapsReady: boolean;
}) {
  const [state, formAction, pending] = useActionState(crearLead, {});
  const hunt = mode === "SALES_HUNT";

  // Ubicación del sales hunt: un lugar de Google Maps o coordenadas pegadas a mano.
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<PlaceOption[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [place, setPlace] = useState<PlaceOption | null>(null);
  const [coords, setCoords] = useState("");
  const [point, setPoint] = useState<{ lat: number; lng: number; city?: string | null } | null>(null);
  const [pointError, setPointError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const located = Boolean(place || point);

  // Ciudad y dirección: salen del lugar elegido o del punto pegado, y quedan editables.
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");

  const choosePlace = (p: PlaceOption | null) => {
    setPlace(p);
    if (p) {
      setCity(p.city ?? "");
      setAddress(p.address ?? "");
    }
  };

  // Al pegar coordenadas o un enlace de Maps se ubica el punto y se toma su ciudad.
  useEffect(() => {
    const text = coords.trim();
    setPoint(null);
    setPointError(null);
    if (!text) return;
    let vigente = true;
    const t = setTimeout(async () => {
      setLocating(true);
      const r = await ubicarPunto(text);
      if (!vigente) return;
      setLocating(false);
      if (r.error || r.lat === undefined || r.lng === undefined) return setPointError(r.error ?? "No se pudo ubicar el punto.");
      setPoint({ lat: r.lat, lng: r.lng, city: r.city });
      if (r.city) setCity(r.city);
      if (r.address) setAddress((actual) => actual || r.address!);
    }, 500);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [coords]);

  const search = () =>
    startSearch(async () => {
      setSearchError(null);
      const r = await buscarLugares(query);
      setPlaces(r.places ?? []);
      if (r.error) setSearchError(r.error);
    });

  return (
    <form onSubmit={submitKeeping(formAction)} className="grid items-start gap-4 lg:grid-cols-3">
      <input type="hidden" name="entry" value={mode} />

      <div className="card flex flex-col gap-4 px-4 py-4 lg:col-span-2">
        {hunt && (
          <section>
            <h3 className="text-[13.5px] font-semibold">1 · Ubicación de la tienda</h3>
            {place ? (
              <div className="mt-2.5 flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
                <IconPin size={16} className="mt-0.5 shrink-0 text-[var(--brand)]" />
                <div className="min-w-0 flex-1 text-[13px]">
                  <p className="font-medium">{place.name}</p>
                  <p className="text-[12px] text-[var(--text-secondary)]">{place.address}</p>
                  {place.mapsUrl && (
                    <a href={place.mapsUrl} target="_blank" rel="noreferrer" className="text-[12px] text-[var(--brand)] hover:underline">
                      Ver en Google Maps
                    </a>
                  )}
                </div>
                <button type="button" className="btn btn-ghost h-7 w-7 !px-0" aria-label="Elegir otra" onClick={() => choosePlace(null)}>
                  <IconX size={14} />
                </button>
                <input type="hidden" name="placeId" value={place.placeId} />
                <input type="hidden" name="lat" value={place.lat} />
                <input type="hidden" name="lng" value={place.lng} />
                <input type="hidden" name="mapsUrl" value={place.mapsUrl ?? ""} />
              </div>
            ) : (
              <div className="mt-2.5 flex flex-col gap-3">
                {mapsReady ? (
                  <>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <IconSearch size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                        <input
                          className="field pl-8"
                          placeholder="Nombre del negocio y ciudad: «Minimercado La 70 Medellín»"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              search();
                            }
                          }}
                        />
                      </div>
                      <button type="button" className="btn btn-secondary" onClick={search} disabled={searching}>
                        {searching ? "Buscando…" : "Buscar"}
                      </button>
                    </div>
                    {searchError && <FormMessage state={{ error: searchError }} />}
                    {places && places.length === 0 && !searchError && (
                      <p className="text-[12.5px] text-[var(--text-muted)]">Google Maps no encontró nada así. Prueba con otro nombre o marca la ubicación abajo.</p>
                    )}
                    {places && places.length > 0 && (
                      <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
                        {places.map((p) => (
                          <li key={p.placeId} className="flex items-start gap-3 px-3 py-2.5 text-[13px]">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium">{p.name}</p>
                              <p className="text-[12px] text-[var(--text-secondary)]">{p.address}</p>
                              {p.store && (
                                <p className="mt-0.5 text-[12px] text-[var(--tone-success-fg)]">
                                  Ya es cliente: {p.store.name} de {p.store.company}
                                </p>
                              )}
                              {p.lead && (
                                <Link href={`/leads/${p.lead.id}`} className="mt-0.5 block text-[12px] text-[var(--brand)] hover:underline">
                                  Ya es el lead {p.lead.code} · {LEAD_STATUS.label(p.lead.status)}
                                </Link>
                              )}
                            </div>
                            <button type="button" className="btn btn-secondary !px-2.5 text-[12.5px]" disabled={Boolean(p.store)} onClick={() => choosePlace(p)}>
                              Elegir
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <p className="text-[12.5px] text-[var(--text-secondary)]">
                    Google Maps no está conectado, así que no se puede buscar la tienda. Marca su ubicación con coordenadas o un enlace de Maps.
                  </p>
                )}
                <Field label="¿No aparece? Pega las coordenadas o el enlace de Google Maps" hint="«4.6533, -74.0836» o el enlace que copias al compartir la ubicación">
                  <input name="coords" className="field font-mono text-[12.5px]" value={coords} onChange={(e) => setCoords(e.target.value)} />
                </Field>
                {locating && <p className="-mt-1 text-[12px] text-[var(--text-muted)]">Ubicando el punto…</p>}
                {pointError && <FormMessage state={{ error: pointError }} />}
                {point && (
                  <p className="-mt-1 flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
                    <IconPin size={13} className="text-[var(--brand)]" />
                    {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
                    {point.city ? ` · ${point.city}` : " · no se pudo saber la ciudad, escríbela abajo"}
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        <section className={hunt ? "border-t border-[var(--border)] pt-4" : ""}>
          <h3 className="text-[13.5px] font-semibold">{hunt ? "2 · El negocio, su tienda y su contacto" : "El negocio, su tienda y su contacto"}</h3>
          {/* key: al elegir otro lugar se reinician los campos con sus datos. */}
          <div key={place?.placeId ?? "manual"} className="mt-2.5 grid gap-3 sm:grid-cols-2">
            {!hunt && (
              <>
                <Field label="Llegó por *">
                  <select name="source" className="field" defaultValue="DIRECTO" required>
                    {LEAD_SOURCES.options
                      .filter((o) => MANUAL_SOURCES.includes(o.value))
                      .map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                  </select>
                </Field>
                <Field label="Detalle del origen" hint="Campaña, feria, referido de quién…">
                  <input name="sourceDetail" className="field" />
                </Field>
              </>
            )}
            <Field label="Negocio *" wide>
              <input name="name" required className="field" defaultValue={place?.name ?? ""} />
            </Field>
          </div>

          <h4 className="mt-4 text-[12.5px] font-semibold text-[var(--text-secondary)]">Tienda</h4>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Field label="Nombre de la tienda" hint="Vacío: el mismo del negocio. Las demás tiendas se agregan en la ficha." wide>
              <input name="storeName" className="field" placeholder="Sede, sucursal o punto" />
            </Field>
            <Field label={hunt ? "Ciudad" : "Ciudad *"}>
              <input name="city" className="field" value={city} onChange={(e) => setCity(e.target.value)} required={!hunt} />
            </Field>
            <Field label="Formato de tienda">
              <select name="format" className="field" defaultValue="">
                <option value="">Sin definir</option>
                {STORE_FORMATS.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Dirección" wide>
              <input name="address" className="field" value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
          </div>

          <h4 className="mt-4 text-[12.5px] font-semibold text-[var(--text-secondary)]">Contacto</h4>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Field label="Nombre *">
              <input name="contactName" required className="field" placeholder="Quién decide la compra" />
            </Field>
            <Field label="Cargo">
              <input name="position" className="field" placeholder="Dueño, comprador, administrador…" />
            </Field>
            <Field label="Teléfono" hint={hunt ? undefined : "Teléfono o correo: al menos uno"}>
              <input name="phone" type="tel" className="field" />
            </Field>
            <Field label="Correo">
              <input name="email" type="email" className="field" />
            </Field>
          </div>
        </section>
      </div>

      <div className="card flex flex-col gap-3 px-4 py-4">
        <CloseFields temperature="FRIO" closePeriod={null} expectedValue={null} periods={periods} />
        <Field label="Responsable">
          <select name="ownerId" className="field" defaultValue={defaultOwnerId}>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Observaciones">
          <textarea name="notes" rows={3} className="field resize-none" placeholder="Qué vende, qué le interesa, próximo paso…" />
        </Field>

        <FormMessage state={state} />

        <div className="flex flex-wrap gap-1.5 pt-1">
          <button type="submit" className="btn btn-primary" disabled={pending || (hunt && !located)}>
            {pending ? "Guardando…" : "Crear lead"}
          </button>
          <Link href="/leads" className="btn btn-ghost">Cancelar</Link>
        </div>
        {hunt && !located && <p className="text-[11.5px] text-[var(--text-muted)]">Primero elige la tienda o marca su ubicación.</p>}
      </div>
    </form>
  );
}
