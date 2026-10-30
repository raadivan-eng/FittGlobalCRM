"use client";

import { startTransition, useActionState, useEffect, useState, useTransition } from "react";
import {
  actualizarDatos,
  actualizarSeguimiento,
  convertirLead,
  guardarContactoLead,
  guardarTiendaLead,
  leerDocumento,
  sincronizarMeta,
  type LeadFormState,
} from "@/lib/actions-leads";
import { formatTaxId, taxSummary, type TaxReading } from "@/lib/rut";
import { CHANNELS, COMPANY_TYPES, LEAD_OPEN, LEAD_STATUS, LEAD_TEMPERATURE, STORE_FORMATS } from "@/lib/enums";
import { fmtPeriod } from "@/lib/format";
import { IconAlert, IconCheck, IconClients, IconPlus, IconRefresh, IconSparkle } from "@/components/icons";

export function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? "sm:col-span-2" : ""}`}>
      <span className="text-[12px] font-medium text-[var(--text-secondary)]">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-[var(--text-muted)]">{hint}</span>}
    </label>
  );
}

export function FormMessage({ state }: { state: LeadFormState }) {
  if (state.error) {
    return (
      <p className="flex items-start gap-1.5 rounded-md border border-[var(--tone-danger-bd)] bg-[var(--tone-danger-bg)] px-2 py-1.5 text-[12px] text-[var(--tone-danger-fg)]">
        <IconAlert size={13} className="mt-px shrink-0" />
        {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p className="flex items-start gap-1.5 text-[12px] text-[var(--tone-success-fg)]">
        <IconCheck size={13} className="mt-px shrink-0" />
        {state.ok}
      </p>
    );
  }
  return null;
}

/**
 * Con `action` React vacía el formulario al terminar, incluso si vuelve un
 * error; enviándolo a mano se conserva lo escrito para corregirlo.
 */
export function submitKeeping(formAction: (fd: FormData) => void) {
  return (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  };
}

// ─────────────────────────────  Listado  ─────────────────────────────────────

export function SyncMetaButton() {
  const [state, action, pending] = useActionState(sincronizarMeta, {});
  return (
    <div className="flex flex-col items-end gap-1">
      <form action={action}>
        <button type="submit" className="btn btn-secondary" disabled={pending} title="Trae los leads de formularios de Facebook e Instagram de los últimos 30 días">
          <IconRefresh size={14} className={pending ? "animate-spin" : ""} />
          {pending ? "Consultando Meta…" : "Sincronizar formularios"}
        </button>
      </form>
      {(state.ok || state.error) && <div className="max-w-sm text-right"><FormMessage state={state} /></div>}
    </div>
  );
}

export function CopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [shown, setShown] = useState(!secret);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11.5px] font-medium uppercase tracking-[0.04em] text-[var(--text-muted)]">{label}</span>
      <div className="flex items-center gap-1.5">
        <input readOnly className="field min-w-0 flex-1 font-mono text-[12px]" value={shown ? value : "•".repeat(Math.min(value.length, 32))} />
        {secret && (
          <button type="button" className="btn btn-ghost !px-2 text-[12px]" onClick={() => setShown((s) => !s)}>
            {shown ? "Ocultar" : "Ver"}
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary !px-2 text-[12px]"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────  Ficha  ──────────────────────────────────────

export type OwnerOption = { id: string; name: string };

/** Temperatura, mes de cierre y valor: el trío que decide si el lead suma al forecast. */
export function CloseFields({
  temperature: initialTemperature,
  closePeriod,
  expectedValue,
  periods,
}: {
  temperature: string;
  closePeriod: string | null;
  expectedValue: number | null;
  periods: string[];
}) {
  const [temperature, setTemperature] = useState(initialTemperature);
  const hot = temperature === "CALIENTE";
  const options = [...new Set([...(closePeriod ? [closePeriod] : []), ...periods])].sort();
  return (
    <>
      <Field label="Temperatura" hint={LEAD_TEMPERATURE.get(temperature).hint}>
        <select name="temperature" className="field" value={temperature} onChange={(e) => setTemperature(e.target.value)}>
          {LEAD_TEMPERATURE.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>
      <Field label={hot ? "Mes tentativo de cierre *" : "Mes tentativo de cierre"} hint="Con valor, el lead suma al forecast de ese mes">
        <select name="closePeriod" className="field" defaultValue={closePeriod ?? ""} required={hot}>
          <option value="">Sin definir</option>
          {options.map((p) => (
            <option key={p} value={p}>{fmtPeriod(p)}</option>
          ))}
        </select>
      </Field>
      <Field label={hot ? "Valor esperado *" : "Valor esperado"} hint="Lo que se le facturaría en el mes de cierre">
        <input
          name="expectedValue"
          inputMode="decimal"
          className="field tabular-nums"
          defaultValue={expectedValue != null ? String(Math.round(expectedValue)) : ""}
          required={hot}
          placeholder="0"
        />
      </Field>
    </>
  );
}

export function FollowUpForm({
  lead,
  owners,
  periods,
}: {
  lead: { id: string; status: string; temperature: string; closePeriod: string | null; expectedValue: number | null; ownerId: string | null; lostReason: string | null };
  owners: OwnerOption[];
  periods: string[];
}) {
  const [state, formAction, pending] = useActionState(actualizarSeguimiento, {});
  const [status, setStatus] = useState(lead.status);
  return (
    <form onSubmit={submitKeeping(formAction)} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={lead.id} />
      <Field label="Estado" hint={LEAD_STATUS.get(status).hint}>
        <select name="status" className="field" value={status} onChange={(e) => setStatus(e.target.value)}>
          {LEAD_STATUS.options
            .filter((o) => (LEAD_OPEN as readonly string[]).includes(o.value) || o.value === "PERDIDO")
            .map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
        </select>
      </Field>
      {status === "PERDIDO" && (
        <Field label="Motivo *">
          <input name="lostReason" className="field" required defaultValue={lead.lostReason ?? ""} placeholder="Precio, ya tiene proveedor, no responde…" />
        </Field>
      )}
      <CloseFields temperature={lead.temperature} closePeriod={lead.closePeriod} expectedValue={lead.expectedValue} periods={periods} />
      <Field label="Responsable">
        <select name="ownerId" className="field" defaultValue={lead.ownerId ?? ""}>
          <option value="">Sin asignar</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </Field>
      <FormMessage state={state} />
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Guardando…" : "Guardar seguimiento"}
        </button>
      </div>
    </form>
  );
}

export function DataForm({ lead }: { lead: { id: string; name: string; notes: string | null } }) {
  const [state, formAction, pending] = useActionState(actualizarDatos, {});
  return (
    <form onSubmit={submitKeeping(formAction)} className="grid gap-3">
      <input type="hidden" name="id" value={lead.id} />
      <Field label="Negocio *">
        <input name="name" required className="field" defaultValue={lead.name} />
      </Field>
      <Field label="Observaciones">
        <textarea name="notes" rows={3} className="field resize-none" defaultValue={lead.notes ?? ""} />
      </Field>
      <div className="flex flex-col gap-2">
        <FormMessage state={state} />
        <div>
          <button type="submit" className="btn btn-secondary" disabled={pending}>
            {pending ? "Guardando…" : "Guardar datos"}
          </button>
        </div>
      </div>
    </form>
  );
}

export type LeadStoreRow = { id: string; name: string; city: string | null; address: string | null; format: string | null };
export type LeadContactRow = { id: string; name: string; position: string | null; phone: string | null; email: string | null };

/** Botón que abre un formulario en línea y lo cierra al guardar o cancelar. */
function InlineEditor({ label, children }: { label: React.ReactNode; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="btn btn-ghost !px-2 text-[12.5px]" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return <div className="w-full">{children(() => setOpen(false))}</div>;
}

/** Cierra el editor en cuanto la acción responde bien. */
function useCloseOnOk(state: LeadFormState, close: () => void) {
  useEffect(() => {
    if (state.ok) close();
  }, [state, close]);
}

function LeadStoreFields({ leadId, row, close }: { leadId: string; row?: LeadStoreRow; close: () => void }) {
  const [state, formAction, pending] = useActionState(guardarTiendaLead, {});
  useCloseOnOk(state, close);
  return (
    <form onSubmit={submitKeeping(formAction)} className="grid gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3 sm:grid-cols-2">
      <input type="hidden" name="leadId" value={leadId} />
      {row && <input type="hidden" name="storeId" value={row.id} />}
      <Field label="Tienda *" wide>
        <input name="name" required className="field" defaultValue={row?.name ?? ""} placeholder="Sede, sucursal o nombre del punto" />
      </Field>
      <Field label="Ciudad">
        <input name="city" className="field" defaultValue={row?.city ?? ""} />
      </Field>
      <Field label="Formato">
        <select name="format" className="field" defaultValue={row?.format ?? ""}>
          <option value="">Sin definir</option>
          {STORE_FORMATS.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Dirección" wide>
        <input name="address" className="field" defaultValue={row?.address ?? ""} />
      </Field>
      <Field label="Ubicación" hint={row ? "Coordenadas o enlace de Google Maps; vacío conserva la actual" : "Coordenadas o enlace de Google Maps"} wide>
        <input name="coords" className="field font-mono text-[12.5px]" placeholder="4.6533, -74.0836" />
      </Field>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <FormMessage state={state} />
        <div className="flex gap-1.5">
          <button type="submit" className="btn btn-secondary" disabled={pending}>
            {pending ? "Guardando…" : row ? "Guardar tienda" : "Agregar tienda"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={close}>Cancelar</button>
        </div>
      </div>
    </form>
  );
}

function LeadContactFields({ leadId, row, close }: { leadId: string; row?: LeadContactRow; close: () => void }) {
  const [state, formAction, pending] = useActionState(guardarContactoLead, {});
  useCloseOnOk(state, close);
  return (
    <form onSubmit={submitKeeping(formAction)} className="grid gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3 sm:grid-cols-2">
      <input type="hidden" name="leadId" value={leadId} />
      {row && <input type="hidden" name="contactId" value={row.id} />}
      <Field label="Nombre *">
        <input name="name" required className="field" defaultValue={row?.name ?? ""} />
      </Field>
      <Field label="Cargo">
        <input name="position" className="field" defaultValue={row?.position ?? ""} placeholder="Dueño, comprador, administrador…" />
      </Field>
      <Field label="Teléfono">
        <input name="phone" type="tel" className="field" defaultValue={row?.phone ?? ""} />
      </Field>
      <Field label="Correo">
        <input name="email" type="email" className="field" defaultValue={row?.email ?? ""} />
      </Field>
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
  );
}

export function LeadStoreEditor({ leadId, row }: { leadId: string; row?: LeadStoreRow }) {
  return (
    <InlineEditor label={row ? "Editar" : <><IconPlus size={13} /> Agregar tienda</>}>
      {(close) => <LeadStoreFields leadId={leadId} row={row} close={close} />}
    </InlineEditor>
  );
}

export function LeadContactEditor({ leadId, row }: { leadId: string; row?: LeadContactRow }) {
  return (
    <InlineEditor label={row ? "Editar" : <><IconPlus size={13} /> Agregar contacto</>}>
      {(close) => <LeadContactFields leadId={leadId} row={row} close={close} />}
    </InlineEditor>
  );
}

type ConvertLead = { id: string; name: string; stores: LeadStoreRow[]; contacts: LeadContactRow[] };

/**
 * Conversión en cliente. El RUT es obligatorio: el portal lo lee, llena razón
 * social, NIT y dirección, y puede crear el tercero en Siigo de una vez. Sin un
 * RUT leído el botón de crear no se habilita.
 */
export function ConvertForm({ lead, reader, siigo }: { lead: ConvertLead; reader: boolean; siigo: boolean }) {
  const [state, formAction, pending] = useActionState(convertirLead, {});
  const [open, setOpen] = useState(false);
  const [reading, startReading] = useTransition();
  const [lectura, setLectura] = useState<TaxReading>({});
  // Cada lectura nueva remonta los campos para que tomen sus valores.
  const [version, setVersion] = useState(0);
  // El formato de las tiendas insinúa el tipo de cliente y el canal; se pueden corregir.
  const formats = lead.stores.map((s) => s.format);
  const type = formats.includes("MAYORISTA") ? "MAYORISTA" : "INDEPENDIENTE";
  const channel = formats.includes("ECOMMERCE") ? "ECOMMERCE" : "TRADICIONAL";
  const first = { city: lead.stores[0]?.city ?? null, address: lead.stores[0]?.address ?? null };
  const reach = { phone: lead.contacts.find((c) => c.phone)?.phone ?? null, email: lead.contacts.find((c) => c.email)?.email ?? null };
  const doc = lectura.data;

  const leer = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const fd = new FormData();
    fd.set("document", file);
    startReading(async () => {
      const r = await leerDocumento(fd);
      setLectura(r.data ? r : { ...lectura, error: r.error, warnings: [] });
      if (r.data) setVersion((v) => v + 1);
    });
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-primary w-full justify-center" onClick={() => setOpen(true)}>
        <IconClients size={14} /> Convertir en cliente
      </button>
    );
  }
  return (
    <form onSubmit={submitKeeping(formAction)} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={lead.id} />

      {reader ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-[var(--border-strong)] px-3 py-2.5">
          <span className="text-[12px] font-medium text-[var(--text-secondary)]">RUT del cliente *</span>
          <label className={`btn btn-secondary w-fit cursor-pointer ${reading ? "pointer-events-none opacity-60" : ""}`}>
            <IconSparkle size={14} className={reading ? "animate-pulse" : ""} />
            {reading ? "Leyendo el RUT…" : doc ? "Subir otro RUT" : "Subir PDF o foto del RUT"}
            <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" onChange={leer} disabled={reading} />
          </label>
          <span className="text-[11px] text-[var(--text-muted)]">
            {doc
              ? "RUT leído: revisa los datos antes de crear el cliente."
              : "Obligatorio. Llena razón social, NIT, dirección y responsabilidades fiscales."}
          </span>
          {lectura.error && <FormMessage state={{ error: lectura.error }} />}
          {doc && !!lectura.warnings?.length && (
            <ul className="flex flex-col gap-1 rounded-md border border-[var(--tone-warning-bd)] bg-[var(--tone-warning-bg)] px-2 py-1.5 text-[11.5px] text-[var(--tone-warning-fg)]">
              {lectura.warnings.map((w) => (
                <li key={w} className="flex items-start gap-1.5">
                  <IconAlert size={12} className="mt-px shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <FormMessage state={{ error: "Para convertir hace falta leer el RUT, y la lectura no está conectada: un administrador debe cargar la API key de Claude en Conexiones API." }} />
      )}

      <div key={version} className="flex flex-col gap-3">
        {doc && (
          <>
            <input type="hidden" name="fiscal" value={lectura.raw} />
            <input type="hidden" name="seal" value={lectura.seal} />
          </>
        )}
        <Field label="Razón social">
          <input name="companyName" className="field" defaultValue={doc?.legalName ?? lead.name} />
        </Field>
        {doc ? (
          <>
            <Field label={doc.idType === "NIT" ? "NIT" : doc.idType === "CC" ? "Cédula" : "Cédula de extranjería"} hint={taxSummary(doc)}>
              <input className="field tabular-nums" value={formatTaxId(doc)} readOnly />
            </Field>
            <Field label="Dirección" hint={doc.cityCode ? `Código DANE ${doc.cityCode}` : undefined}>
              <input name="address" className="field" defaultValue={doc.address ?? first.address ?? ""} />
            </Field>
            <Field label="Ciudad">
              <input name="city" className="field" defaultValue={doc.city ?? first.city ?? ""} />
            </Field>
            <Field label="Correo">
              <input name="email" type="email" className="field" defaultValue={doc.email ?? reach.email ?? ""} />
            </Field>
            <Field label="Teléfono">
              <input name="phone" type="tel" className="field" defaultValue={reach.phone ?? doc.phone ?? ""} />
            </Field>
          </>
        ) : null}
      </div>

      <Field label="Tipo de cliente" hint="Qué clase de empresa compra: cadena, mayorista, independiente u HORECA">
        <select name="type" className="field" defaultValue={type}>
          {COMPANY_TYPES.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Canal" hint="Dónde ve el producto el consumidor final">
        <select name="channel" className="field" defaultValue={channel}>
          {CHANNELS.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[12px] font-medium text-[var(--text-secondary)]">Tiendas que pasan al cliente *</legend>
        {lead.stores.map((s) => (
          <div key={s.id} className="flex flex-col gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-2">
            <label className="flex items-start gap-2 text-[12.5px]">
              <input type="checkbox" name="storeIds" value={s.id} defaultChecked className="mt-0.5" />
              <span>
                {s.name}
                <span className="block text-[11px] text-[var(--text-muted)]">{[s.city, s.address].filter(Boolean).join(" · ") || "Sin ciudad ni dirección"}</span>
              </span>
            </label>
            <select name={`format-${s.id}`} className="field" defaultValue={s.format ?? "MINIMARKET"} aria-label={`Formato de ${s.name}`}>
              {STORE_FORMATS.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        ))}
        <span className="text-[11px] text-[var(--text-muted)]">E-commerce crea una tienda digital, sin ubicación y fuera de rutas.</span>
      </fieldset>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-[12px] font-medium text-[var(--text-secondary)]">Contactos que pasan al cliente *</legend>
        {lead.contacts.map((c) => (
          <label key={c.id} className="flex items-start gap-2 text-[12.5px]">
            <input type="checkbox" name="contactIds" value={c.id} defaultChecked className="mt-0.5" />
            <span>
              {c.name}
              <span className="block text-[11px] text-[var(--text-muted)]">{[c.position, c.phone ?? c.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}</span>
            </span>
          </label>
        ))}
        <span className="text-[11px] text-[var(--text-muted)]">Cada contacto queda vinculado a cada tienda elegida; se ajusta luego en la ficha del cliente.</span>
      </fieldset>

      {doc &&
        (siigo ? (
          <label className="flex items-start gap-2 text-[12.5px]">
            <input type="checkbox" name="siigo" defaultChecked className="mt-0.5" />
            <span>
              Crear también el tercero en Siigo
              <span className="block text-[11px] text-[var(--text-muted)]">Si el NIT ya existe allá, sólo se enlaza.</span>
            </span>
          </label>
        ) : (
          <p className="text-[11.5px] text-[var(--text-muted)]">
            Activa el módulo Clientes de Siigo en Conexiones API para crear el tercero allá al convertir.
          </p>
        ))}

      <FormMessage state={state} />
      <div className="flex flex-wrap gap-1.5">
        <button type="submit" className="btn btn-primary" disabled={pending || reading || !doc} title={doc ? undefined : "Sube el RUT para crear el cliente"}>
          {pending ? "Creando cliente…" : "Crear cliente"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </form>
  );
}
