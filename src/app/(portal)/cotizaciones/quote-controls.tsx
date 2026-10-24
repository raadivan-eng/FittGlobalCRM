"use client";

import { useActionState, useState, useTransition } from "react";
import {
  actualizarDatosCotizacion,
  actualizarSeguimientoCotizacion,
  convertirCotizacion,
  crearCotizacion,
  leerDocumentoProveedor,
} from "@/lib/actions-suppliers";
import { formatTaxId, taxSummary, type TaxReading } from "@/lib/rut";
import { QUOTE_OPEN, QUOTE_STATUS } from "@/lib/enums";
import { Field, FormMessage, submitKeeping, type OwnerOption } from "@/app/(portal)/leads/lead-controls";
import { ConditionInputs, PaymentTermsInputs } from "@/components/supplier-forms";
import { IconAlert, IconFactory, IconPlus, IconSparkle } from "@/components/icons";

// ───────────────────────────────  Alta  ──────────────────────────────────────

/**
 * Alta de la cotización. Arranca con una fila de SKU; se agregan las que hagan
 * falta. Las respuestas del proveedor pueden quedar vacías si todavía no contesta.
 */
export function NewQuoteForm({ owners, defaultOwnerId }: { owners: OwnerOption[]; defaultOwnerId: string }) {
  const [state, formAction, pending] = useActionState(crearCotizacion, {});
  // Cada fila tiene una llave estable para poder quitar una del medio.
  const [rows, setRows] = useState([0]);
  const [next, setNext] = useState(1);

  return (
    <form onSubmit={submitKeeping(formAction)} className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <div className="card">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-[13.5px] font-semibold">SKU a cotizar</h3>
          <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
            Las preguntas que se le hacen al proveedor por cada producto. Si aún no responde, deja en blanco lo que falte y complétalo en la ficha.
          </p>
        </div>
        <ol className="divide-y divide-[var(--border)]">
          {rows.map((key, i) => (
            <li key={key} className="px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[12px] font-semibold text-[var(--text-secondary)]">SKU {i + 1}</span>
                {rows.length > 1 && (
                  <button type="button" className="btn btn-ghost !px-2 text-[12px] text-[var(--tone-danger-fg)]" onClick={() => setRows((r) => r.filter((k) => k !== key))}>
                    Quitar
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <ConditionInputs compact={i > 0} />
              </div>
            </li>
          ))}
        </ol>
        <div className="border-t border-[var(--border)] px-4 py-3">
          <button
            type="button"
            className="btn btn-ghost !px-2 text-[12.5px]"
            onClick={() => {
              setRows((r) => [...r, next]);
              setNext((n) => n + 1);
            }}
          >
            <IconPlus size={13} /> Otro SKU
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="card flex flex-col gap-3 px-4 py-4">
          <h3 className="text-[13.5px] font-semibold">Proveedor</h3>
          <Field label="Proveedor *" hint="Como se le conoce; la razón social sale del RUT al aprobarlo">
            <input name="name" required className="field" placeholder="Laboratorios Andinos" />
          </Field>
          <Field label="Contacto">
            <input name="contactName" className="field" placeholder="Quién cotiza" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Teléfono">
              <input name="phone" type="tel" className="field" />
            </Field>
            <Field label="Correo">
              <input name="email" type="email" className="field" />
            </Field>
          </div>
          <Field label="Ciudad">
            <input name="city" className="field" />
          </Field>
        </div>
        <div className="card flex flex-col gap-3 px-4 py-4">
          <h3 className="text-[13.5px] font-semibold">Condiciones de compra</h3>
          <PaymentTermsInputs terms={null} days={null} />
          <Field label="Responsable">
            <select name="ownerId" className="field" defaultValue={defaultOwnerId}>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Observaciones">
            <textarea name="notes" rows={3} className="field resize-none" placeholder="Muestras, certificaciones, cómo llegamos a él…" />
          </Field>
          <FormMessage state={state} />
          <div>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Creando…" : "Crear cotización"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

// ──────────────────────────────  Ficha  ──────────────────────────────────────

type QuoteFollowUp = {
  id: string;
  status: string;
  ownerId: string | null;
  paymentTerms: string | null;
  paymentTermDays: number | null;
  discardReason: string | null;
};

export function QuoteFollowUpForm({ quote, owners }: { quote: QuoteFollowUp; owners: OwnerOption[] }) {
  const [state, formAction, pending] = useActionState(actualizarSeguimientoCotizacion, {});
  const [status, setStatus] = useState(quote.status);
  return (
    <form onSubmit={submitKeeping(formAction)} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={quote.id} />
      <Field label="Estado" hint={QUOTE_STATUS.get(status).hint}>
        <select name="status" className="field" value={status} onChange={(e) => setStatus(e.target.value)}>
          {QUOTE_STATUS.options
            .filter((o) => (QUOTE_OPEN as readonly string[]).includes(o.value) || o.value === "DESCARTADA")
            .map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
        </select>
      </Field>
      {status === "DESCARTADA" && (
        <Field label="Motivo *">
          <input name="discardReason" className="field" required defaultValue={quote.discardReason ?? ""} placeholder="Precio, mínimos muy altos, tiempos…" />
        </Field>
      )}
      <PaymentTermsInputs terms={quote.paymentTerms} days={quote.paymentTermDays} />
      <Field label="Responsable">
        <select name="ownerId" className="field" defaultValue={quote.ownerId ?? ""}>
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

type QuoteData = { id: string; name: string; contactName: string | null; phone: string | null; email: string | null; city: string | null; notes: string | null };

export function QuoteDataForm({ quote }: { quote: QuoteData }) {
  const [state, formAction, pending] = useActionState(actualizarDatosCotizacion, {});
  return (
    <form onSubmit={submitKeeping(formAction)} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={quote.id} />
      <Field label="Proveedor *">
        <input name="name" required className="field" defaultValue={quote.name} />
      </Field>
      <Field label="Contacto">
        <input name="contactName" className="field" defaultValue={quote.contactName ?? ""} />
      </Field>
      <Field label="Teléfono">
        <input name="phone" type="tel" className="field" defaultValue={quote.phone ?? ""} />
      </Field>
      <Field label="Correo">
        <input name="email" type="email" className="field" defaultValue={quote.email ?? ""} />
      </Field>
      <Field label="Ciudad">
        <input name="city" className="field" defaultValue={quote.city ?? ""} />
      </Field>
      <Field label="Observaciones" wide>
        <textarea name="notes" rows={3} className="field resize-none" defaultValue={quote.notes ?? ""} />
      </Field>
      <div className="flex flex-col gap-2 sm:col-span-2">
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

// ───────────────────────────────  Conversión  ────────────────────────────────

/** Casilla de un documento: sube el archivo, lo lee y muestra qué revisar. */
function DocumentSlot({
  kind,
  label,
  help,
  reading,
  lectura,
  onFile,
}: {
  kind: "RUT" | "CAMARA_COMERCIO";
  label: string;
  help: string;
  reading: boolean;
  lectura: TaxReading;
  onFile: (kind: "RUT" | "CAMARA_COMERCIO", file: File) => void;
}) {
  const doc = lectura.data;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-[var(--border-strong)] px-3 py-2.5">
      <span className="text-[12px] font-medium text-[var(--text-secondary)]">{label} *</span>
      <label className={`btn btn-secondary w-fit cursor-pointer ${reading ? "pointer-events-none opacity-60" : ""}`}>
        <IconSparkle size={14} className={reading ? "animate-pulse" : ""} />
        {reading ? "Leyendo…" : doc ? "Subir otro" : "Subir PDF o foto"}
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={reading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onFile(kind, file);
          }}
        />
      </label>
      <span className="text-[11px] text-[var(--text-muted)]">
        {doc ? `Leído: ${doc.legalName} · ${doc.idType} ${formatTaxId(doc)}${doc.issuedAt ? ` · expedido ${doc.issuedAt}` : ""}` : help}
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
  );
}

type ConvertQuote = QuoteData & { paymentTerms: string | null; paymentTermDays: number | null };

/**
 * Conversión en proveedor. Pide el RUT —de ahí sale el tercero de Siigo— y el
 * certificado de Cámara de Comercio, del mismo NIT. Sin los dos leídos, o con
 * algún SKU sin respuesta, el botón no se habilita.
 */
export function ConvertQuoteForm({ quote, missing, reader, siigo }: { quote: ConvertQuote; missing: string[]; reader: boolean; siigo: boolean }) {
  const [state, formAction, pending] = useActionState(convertirCotizacion, {});
  const [open, setOpen] = useState(false);
  const [reading, startReading] = useTransition();
  const [readingKind, setReadingKind] = useState<string | null>(null);
  const [rut, setRut] = useState<TaxReading>({});
  const [camara, setCamara] = useState<TaxReading>({});
  // Cada RUT leído remonta los campos para que tomen sus valores.
  const [version, setVersion] = useState(0);
  const doc = rut.data;
  const sameNit = doc && camara.data ? doc.idNumber === camara.data.idNumber : true;
  const ready = Boolean(doc && camara.data && sameNit && !missing.length);

  const leer = (kind: "RUT" | "CAMARA_COMERCIO", file: File) => {
    const fd = new FormData();
    fd.set("document", file);
    fd.set("kind", kind);
    setReadingKind(kind);
    startReading(async () => {
      const r = await leerDocumentoProveedor(fd);
      const set = kind === "RUT" ? setRut : setCamara;
      set((prev) => (r.data ? r : { ...prev, error: r.error, warnings: [] }));
      if (r.data && kind === "RUT") setVersion((v) => v + 1);
      setReadingKind(null);
    });
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-primary w-full justify-center" onClick={() => setOpen(true)}>
        <IconFactory size={14} /> Aprobar y crear proveedor
      </button>
    );
  }
  return (
    <form onSubmit={submitKeeping(formAction)} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={quote.id} />

      {missing.length > 0 && (
        <FormMessage state={{ error: `Faltan respuestas del proveedor en ${missing.join(", ")}. Complétalas en la tabla de SKU antes de aprobar.` }} />
      )}

      {reader ? (
        <>
          <DocumentSlot
            kind="RUT"
            label="RUT del proveedor"
            help="De la DIAN. Llena razón social, NIT, dirección y responsabilidades fiscales para Siigo."
            reading={reading && readingKind === "RUT"}
            lectura={rut}
            onFile={leer}
          />
          <DocumentSlot
            kind="CAMARA_COMERCIO"
            label="Certificado de Cámara de Comercio"
            help="De existencia y representación legal, o matrícula mercantil. Debe ser reciente."
            reading={reading && readingKind === "CAMARA_COMERCIO"}
            lectura={camara}
            onFile={leer}
          />
          {!sameNit && (
            <FormMessage state={{ error: `El RUT es del NIT ${doc!.idNumber} y la Cámara del ${camara.data!.idNumber}: deben ser del mismo proveedor.` }} />
          )}
        </>
      ) : (
        <FormMessage state={{ error: "Para aprobar hace falta leer el RUT y la Cámara de Comercio, y la lectura no está conectada: un administrador debe cargar la API key de Claude en Conexiones API." }} />
      )}

      {doc && (
        <>
          <input type="hidden" name="rut" value={rut.raw} />
          <input type="hidden" name="rutSeal" value={rut.seal} />
        </>
      )}
      {camara.data && (
        <>
          <input type="hidden" name="camara" value={camara.raw} />
          <input type="hidden" name="camaraSeal" value={camara.seal} />
        </>
      )}

      <div key={version} className="flex flex-col gap-3">
        {doc && (
          <>
            <Field label="Razón social">
              <input name="legalName" className="field" defaultValue={doc.legalName} />
            </Field>
            <Field label={doc.idType === "NIT" ? "NIT" : doc.idType === "CC" ? "Cédula" : "Cédula de extranjería"} hint={taxSummary(doc)}>
              <input className="field tabular-nums" value={formatTaxId(doc)} readOnly />
            </Field>
            <Field label="Dirección" hint={doc.cityCode ? `Código DANE ${doc.cityCode}` : undefined}>
              <input name="address" className="field" defaultValue={doc.address ?? ""} />
            </Field>
            <Field label="Ciudad">
              <input name="city" className="field" defaultValue={doc.city ?? quote.city ?? ""} />
            </Field>
          </>
        )}
        <Field label="Contacto">
          <input name="contactName" className="field" defaultValue={quote.contactName ?? doc?.legalRepresentative ?? camara.data?.legalRepresentative ?? ""} />
        </Field>
        <Field label="Correo">
          <input name="email" type="email" className="field" defaultValue={quote.email ?? doc?.email ?? ""} />
        </Field>
        <Field label="Teléfono">
          <input name="phone" type="tel" className="field" defaultValue={quote.phone ?? doc?.phone ?? ""} />
        </Field>
      </div>

      <PaymentTermsInputs terms={quote.paymentTerms} days={quote.paymentTermDays} required />

      {doc &&
        (siigo ? (
          <label className="flex items-start gap-2 text-[12.5px]">
            <input type="checkbox" name="siigo" defaultChecked className="mt-0.5" />
            <span>
              Crear también el proveedor en Siigo
              <span className="block text-[11px] text-[var(--text-muted)]">Con los datos del RUT. Si el NIT ya existe allá, sólo se enlaza.</span>
            </span>
          </label>
        ) : (
          <p className="text-[11.5px] text-[var(--text-muted)]">Activa el módulo Clientes de Siigo en Conexiones API para crear el proveedor allá al aprobar.</p>
        ))}

      <FormMessage state={state} />
      <div className="flex flex-wrap gap-1.5">
        <button type="submit" className="btn btn-primary" disabled={pending || reading || !ready} title={ready ? undefined : "Sube el RUT y la Cámara de Comercio, y completa los SKU"}>
          {pending ? "Creando proveedor…" : "Crear proveedor"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </form>
  );
}
