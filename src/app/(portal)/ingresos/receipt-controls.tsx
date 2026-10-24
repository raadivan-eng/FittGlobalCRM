"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { anularIngreso, certificarIngreso, crearIngreso, leerEtiquetas, leerFactura } from "@/lib/actions-receipts";
import { daysUntil, dateFromIso, reconcile, SHORT_EXPIRY_DAYS, type InvoiceLineDraft, type InvoiceReading, type PackingRow } from "@/lib/receipts";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { Field, FormMessage, submitKeeping } from "@/app/(portal)/leads/lead-controls";
import { IconAlert, IconCheck, IconPlus, IconReceive, IconSparkle } from "@/components/icons";

export type ProductOption = { id: string; sku: string; name: string };
export type WarehouseOption = { id: string; name: string; city: string };

/** Avisos de una lectura: lo que Claude no pudo leer o no reconoció. */
function Warnings({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return (
    <ul className="flex flex-col gap-1 rounded-md border border-[var(--tone-warning-bd)] bg-[var(--tone-warning-bg)] px-2 py-1.5 text-[11.5px] text-[var(--tone-warning-fg)]">
      {items.map((w) => (
        <li key={w} className="flex items-start gap-1.5">
          <IconAlert size={12} className="mt-px shrink-0" />
          {w}
        </li>
      ))}
    </ul>
  );
}

/**
 * Las fotos del celular pesan varios MB y Claude no las necesita tan grandes:
 * se reducen en el navegador a 2400 px por lado, que todavía deja leer un lote.
 */
async function reducirFoto(file: File, maxSide = 2400): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 3 * 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
    return blob ? new File([blob], "foto.jpg", { type: "image/jpeg" }) : file;
  } catch {
    // HEIC u otro formato que el navegador no decodifica: va tal cual y el servidor dirá si sirve.
    return file;
  }
}

// ────────────────────────────────  Factura  ──────────────────────────────────

type LineRow = Omit<InvoiceLineDraft, "quantity" | "unitCost"> & { key: number; quantity: string; unitCost: string };

const filaVacia = (key: number): LineRow => ({ key, sku: "", description: "", productId: "", quantity: "", unitCost: "" });
const num = (v: string) => Number(v.replace(/\./g, "").replace(",", ".")) || 0;

/**
 * Paso 1: la factura del proveedor. Se lee con Claude desde el PDF o una foto
 * —o se digita— y cada renglón se amarra a un producto del catálogo.
 */
export function InvoiceForm({ products, warehouses, reader }: { products: ProductOption[]; warehouses: WarehouseOption[]; reader: boolean }) {
  const [state, formAction, pending] = useActionState(crearIngreso, {});
  const [reading, startReading] = useTransition();
  const [lectura, setLectura] = useState<InvoiceReading>({});
  // Cada factura leída remonta los campos de cabecera para que tomen sus valores.
  const [version, setVersion] = useState(0);
  const [rows, setRows] = useState<LineRow[]>([filaVacia(0)]);
  const [next, setNext] = useState(1);
  const [warehouseId, setWarehouseId] = useState(warehouses.length === 1 ? warehouses[0].id : warehouses.length ? "" : "NUEVA");

  const head = lectura.data;
  const total = rows.reduce((s, r) => s + num(r.quantity) * num(r.unitCost), 0);
  const unidades = rows.reduce((s, r) => s + num(r.quantity), 0);
  const set = (key: number, patch: Partial<LineRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const leer = (file: File) => {
    startReading(async () => {
      const fd = new FormData();
      fd.set("document", await reducirFoto(file));
      const r = await leerFactura(fd);
      setLectura((prev) => (r.data ? r : { ...prev, error: r.error, warnings: [] }));
      if (!r.data) return;
      setRows(
        r.data.lines.map((l, i) => ({
          key: next + i,
          sku: l.sku,
          description: l.description,
          productId: l.productId ?? "",
          quantity: String(l.quantity),
          // El punto es separador de miles en los campos: el decimal va con coma.
          unitCost: l.unitCost != null ? String(l.unitCost).replace(".", ",") : "",
        })),
      );
      setNext((n) => n + r.data!.lines.length);
      setVersion((v) => v + 1);
    });
  };

  return (
    <form onSubmit={submitKeeping(formAction)} className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
      <input type="hidden" name="source" value={head ? "LECTURA" : "MANUAL"} />

      <div className="card">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-[13.5px] font-semibold">Renglones de la factura</h3>
          <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
            Lo que el proveedor cobró, en unidades y a costo sin IVA. Cada renglón debe apuntar a un producto del catálogo: es lo que se contrasta con lo que llegue.
          </p>
        </div>
        <ol className="divide-y divide-[var(--border)]">
          {rows.map((r, i) => (
            <li key={r.key} className="px-4 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-[var(--text-secondary)]">
                  Renglón {i + 1}
                  {head && !r.productId && <span className="badge badge-warning ml-1.5">Sin producto</span>}
                </span>
                {rows.length > 1 && (
                  <button type="button" className="btn btn-ghost !px-2 text-[12px] text-[var(--tone-danger-fg)]" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                    Quitar
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_7rem_8rem]">
                <Field label="Código en la factura">
                  <input name="lineSku" className="field font-mono text-[12.5px] uppercase" value={r.sku} onChange={(e) => set(r.key, { sku: e.target.value })} placeholder="PROT-WHEY-2LB" />
                </Field>
                <Field label="Producto del catálogo *" hint={r.description && head ? `Factura: ${r.description}` : undefined}>
                  <select name="lineProductId" required className="field" value={r.productId ?? ""} onChange={(e) => set(r.key, { productId: e.target.value })}>
                    <option value="">Elige el producto…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} · {p.name}
                      </option>
                    ))}
                  </select>
                  <input type="hidden" name="lineDescription" value={r.description} />
                </Field>
                <Field label="Unidades *">
                  <input name="lineQuantity" required inputMode="numeric" className="field tabular-nums" value={r.quantity} onChange={(e) => set(r.key, { quantity: e.target.value })} placeholder="0" />
                </Field>
                <Field label="Costo unit." hint="Sin IVA">
                  <input name="lineUnitCost" inputMode="decimal" className="field tabular-nums" value={r.unitCost} onChange={(e) => set(r.key, { unitCost: e.target.value })} placeholder="0" />
                </Field>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-3">
          <button
            type="button"
            className="btn btn-ghost !px-2 text-[12.5px]"
            onClick={() => {
              setRows((rs) => [...rs, filaVacia(next)]);
              setNext((n) => n + 1);
            }}
          >
            <IconPlus size={13} /> Otro renglón
          </button>
          <span className="text-[12.5px] text-[var(--text-secondary)] tabular">
            {fmtNumber(unidades)} unidades · <span className="font-semibold text-[var(--text-primary)]">{fmtMoney(total)}</span> sin IVA
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="card flex flex-col gap-3 px-4 py-3.5">
          <div>
            <h3 className="text-[13.5px] font-semibold">Factura del proveedor</h3>
            <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">Sube el PDF de la factura electrónica o una foto: Claude llena el formulario y tú lo revisas.</p>
          </div>
          {reader ? (
            <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-[var(--border-strong)] px-3 py-2.5">
              <label className={`btn btn-secondary w-fit cursor-pointer ${reading ? "pointer-events-none opacity-60" : ""}`}>
                <IconSparkle size={14} className={reading ? "animate-pulse" : ""} />
                {reading ? "Leyendo factura…" : head ? "Leer otra factura" : "Subir PDF o foto"}
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={reading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) leer(file);
                  }}
                />
              </label>
              <span className="text-[11px] text-[var(--text-muted)]">
                {head ? `Leída: factura ${head.invoiceNumber} de ${head.supplierName} · ${head.lines.length} renglones` : "También puedes digitarla abajo."}
              </span>
              {lectura.error && <FormMessage state={{ error: lectura.error }} />}
              {head && <Warnings items={lectura.warnings} />}
            </div>
          ) : (
            <p className="text-[12px] text-[var(--text-muted)]">
              La lectura automática no está conectada: un administrador puede cargar la API key de Claude en Conexiones API. Mientras tanto, digita la factura.
            </p>
          )}

          <div key={version} className="grid gap-3">
            <Field label="Proveedor *" hint="Razón social del emisor de la factura">
              <input name="supplierName" required className="field" defaultValue={head?.supplierName ?? ""} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="NIT" hint="Sin dígito de verificación">
                <input name="supplierTaxId" inputMode="numeric" className="field tabular-nums" defaultValue={head?.supplierTaxId ?? ""} />
              </Field>
              <Field label="Número de factura *">
                <input name="invoiceNumber" required className="field font-mono uppercase" defaultValue={head?.invoiceNumber ?? ""} placeholder="FE-10234" />
              </Field>
            </div>
            <Field label="Fecha de la factura">
              <input name="invoiceDate" type="date" className="field" defaultValue={head?.invoiceDate ?? ""} />
            </Field>
          </div>
        </div>

        <div className="card flex flex-col gap-3 px-4 py-3.5">
          <Field label="Bodega de destino *">
            <select name="warehouseId" required className="field" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Elige la bodega…</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · {w.city}
                </option>
              ))}
              <option value="NUEVA">Otra bodega…</option>
            </select>
          </Field>
          {warehouseId === "NUEVA" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre de la bodega *">
                <input name="warehouseName" required className="field" placeholder="CEDI Bogotá" />
              </Field>
              <Field label="Ciudad *">
                <input name="warehouseCity" required className="field" placeholder="Bogotá" />
              </Field>
            </div>
          )}
          <Field label="Notas" hint="Transportadora, fecha estimada de llegada, orden de compra…">
            <textarea name="notes" rows={2} className="field" />
          </Field>
          <FormMessage state={state} />
          <button type="submit" className="btn btn-primary justify-center" disabled={pending || reading}>
            <IconReceive size={14} /> {pending ? "Guardando…" : "Registrar factura"}
          </button>
          <p className="text-[11px] text-[var(--text-muted)]">Queda por recibir: el inventario sólo sube cuando el packing slip certifique lo que llegó.</p>
        </div>
      </div>
    </form>
  );
}

// ──────────────────────────────  Packing slip  ───────────────────────────────

export type ExpectedLine = { productId: string; sku: string; name: string; quantity: number };

/**
 * Paso 2: el packing slip. Cada foto de etiqueta suma lotes con su vencimiento
 * y cantidad; todo se corrige a mano y el cuadre contra la factura se ve en
 * vivo. Al certificarlo, los lotes entran a la bodega.
 */
export function PackingSlipForm({ receiptId, expected, reader }: { receiptId: string; expected: ExpectedLine[]; reader: boolean }) {
  const [state, formAction, pending] = useActionState(certificarIngreso, {});
  const [reading, startReading] = useTransition();
  const [rows, setRows] = useState<PackingRow[]>([]);
  const [next, setNext] = useState(0);
  const [lectura, setLectura] = useState<{ error?: string; warnings?: string[] }>({});
  const [fotos, setFotos] = useState(0);

  const productos = useMemo(() => [...new Map(expected.map((e) => [e.productId, e])).values()], [expected]);
  const cuadre = reconcile(
    expected,
    rows.filter((r) => r.productId).map((r) => ({ productId: r.productId, quantity: Number(r.quantity) || 0 })),
  );
  const diferencias = cuadre.filter((c) => c.diff !== 0);
  const set = (key: string, patch: Partial<PackingRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const agregar = (nuevas: Omit<PackingRow, "key">[]) => {
    setRows((rs) => [...rs, ...nuevas.map((r, i) => ({ ...r, key: String(next + i) }))]);
    setNext((n) => n + nuevas.length);
  };

  const leer = (file: File) => {
    startReading(async () => {
      const fd = new FormData();
      fd.set("receiptId", receiptId);
      fd.set("photo", await reducirFoto(file));
      const r = await leerEtiquetas(fd);
      setLectura({ error: r.error, warnings: r.warnings });
      if (r.rows) {
        agregar(r.rows);
        setFotos((n) => n + 1);
      }
    });
  };

  if (state.ok) {
    return (
      <div className="px-4 py-4">
        <FormMessage state={state} />
      </div>
    );
  }

  return (
    <form onSubmit={submitKeeping(formAction)} className="flex flex-col">
      <input type="hidden" name="receiptId" value={receiptId} />

      <div className="flex flex-col gap-2 border-b border-[var(--border)] px-4 py-3.5">
        {reader ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className={`btn btn-primary cursor-pointer ${reading ? "pointer-events-none opacity-60" : ""}`}>
                <IconSparkle size={14} className={reading ? "animate-pulse" : ""} />
                {reading ? "Leyendo etiqueta…" : fotos ? "Tomar otra foto" : "Tomar foto de la etiqueta"}
                {/* capture abre la cámara trasera en el celular; en el computador, el selector de archivos. */}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  disabled={reading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) leer(file);
                  }}
                />
              </label>
              <button
                type="button"
                className="btn btn-ghost text-[12.5px]"
                onClick={() => agregar([{ productId: productos.length === 1 ? productos[0].productId : "", lotCode: "", expiryDate: "", quantity: "", source: "MANUAL" }])}
              >
                <IconPlus size={13} /> Lote a mano
              </button>
            </div>
            <span className="text-[11.5px] text-[var(--text-muted)]">
              Una foto por producto o por rótulo de caja, con el lote y el vencimiento a la vista. Claude lee lote, vencimiento, SKU y cantidad; revisa cada renglón antes de certificar.
              {fotos > 0 && ` ${fotos} ${fotos === 1 ? "foto leída" : "fotos leídas"}.`}
            </span>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] text-[var(--text-muted)]">La lectura de fotos no está conectada (falta la API key de Claude en Conexiones API): registra cada lote a mano.</p>
            <button
              type="button"
              className="btn btn-secondary w-fit"
              onClick={() => agregar([{ productId: productos.length === 1 ? productos[0].productId : "", lotCode: "", expiryDate: "", quantity: "", source: "MANUAL" }])}
            >
              <IconPlus size={13} /> Agregar lote
            </button>
          </div>
        )}
        {lectura.error && <FormMessage state={{ error: lectura.error }} />}
        <Warnings items={lectura.warnings} />
      </div>

      {/* Filas apiladas en el celular, en línea desde sm: en el muelle no hay que desplazarse de lado. */}
      {rows.length > 0 && (
        <ol className="divide-y divide-[var(--border)]">
          {rows.map((r) => {
            const vence = dateFromIso(r.expiryDate);
            const dias = vence ? daysUntil(vence) : null;
            return (
              <li key={r.key} className="grid gap-2.5 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_6.5rem_auto] sm:items-start">
                <input type="hidden" name="lotSource" value={r.source} />
                <Field label="Producto">
                  <select name="lotProductId" required className="field" value={r.productId} onChange={(e) => set(r.key, { productId: e.target.value })}>
                    <option value="">Elige el producto…</option>
                    {productos.map((p) => (
                      <option key={p.productId} value={p.productId}>
                        {p.sku} · {p.name}
                      </option>
                    ))}
                  </select>
                  {r.source === "LECTURA" && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                      <IconSparkle size={11} /> Leído de la foto
                    </span>
                  )}
                </Field>
                <div className="grid grid-cols-2 gap-2.5 sm:contents">
                  <Field label="Lote">
                    <input name="lotCode" required className="field font-mono text-[12.5px] uppercase" value={r.lotCode} onChange={(e) => set(r.key, { lotCode: e.target.value })} placeholder="L2410-A" />
                  </Field>
                  <Field label="Vence">
                    <input name="lotExpiry" type="date" required className="field" value={r.expiryDate} onChange={(e) => set(r.key, { expiryDate: e.target.value })} />
                    {dias != null && dias < 0 && <span className="text-[11px] text-[var(--tone-danger-fg)]">Vencido: no se recibe</span>}
                    {dias != null && dias >= 0 && dias <= SHORT_EXPIRY_DAYS && <span className="text-[11px] text-[var(--tone-warning-fg)]">Vence en {dias} días</span>}
                  </Field>
                </div>
                <div className="flex items-end gap-2 sm:contents">
                  <Field label="Unidades">
                    <input name="lotQuantity" required inputMode="numeric" className="field text-right tabular-nums" value={r.quantity} onChange={(e) => set(r.key, { quantity: e.target.value })} placeholder="0" />
                  </Field>
                  <button type="button" className="btn btn-ghost !px-2 text-[12.5px] text-[var(--tone-danger-fg)] sm:mt-[22px]" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                    Quitar
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="border-t border-[var(--border)] px-4 py-3.5">
        <h4 className="mb-2 text-[12.5px] font-semibold">Cuadre contra la factura</h4>
        <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num">Facturado</th>
                <th className="num">Recibido</th>
                <th className="num">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {cuadre.map((c) => {
                const p = productos.find((x) => x.productId === c.productId);
                return (
                  <tr key={c.productId}>
                    <td>
                      {p?.name}
                      <span className="block font-mono text-[11px] text-[var(--text-muted)]">{p?.sku}</span>
                    </td>
                    <td className="num">{fmtNumber(c.invoiced)}</td>
                    <td className="num">{fmtNumber(c.received)}</td>
                    <td className="num whitespace-nowrap">
                      {c.diff === 0 ? (
                        <span className="inline-flex items-center gap-1 text-[var(--tone-success-fg)]"><IconCheck size={12} /> Cuadra</span>
                      ) : (
                        <span className="font-semibold text-[var(--tone-warning-fg)]">
                          {c.diff > 0 ? "Sobran " : "Faltan "}
                          {fmtNumber(Math.abs(c.diff))}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-[var(--border)] px-4 py-3.5">
        {rows.length > 0 && diferencias.length > 0 && (
          <Field label="Explicación de la diferencia *" hint="Queda en el ingreso para el reclamo o el ajuste con el proveedor">
            <textarea name="receivedNotes" required rows={2} className="field" placeholder="Llegaron 2 cajas golpeadas que se devolvieron al transportador…" />
          </Field>
        )}
        <FormMessage state={state} />
        <button type="submit" className="btn btn-primary w-fit" disabled={pending || reading || !rows.length}>
          <IconCheck size={14} />
          {pending ? "Dando de alta…" : diferencias.length ? "Certificar con diferencias" : "Certificar ingreso"}
        </button>
      </div>
    </form>
  );
}

export function CancelReceiptButton({ id }: { id: string }) {
  return (
    <form
      action={anularIngreso}
      onSubmit={(e) => {
        if (!confirm("¿Anular este ingreso? La factura queda registrada como anulada y no entra mercancía.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="btn btn-ghost text-[12.5px] text-[var(--tone-danger-fg)]">Anular ingreso</button>
    </form>
  );
}
