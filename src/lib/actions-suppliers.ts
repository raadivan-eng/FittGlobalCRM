"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { requireRole, SUPPLIER_ROLES } from "./auth";
import { QUOTE_OPEN, QUOTE_STATUS } from "./enums";
import { normalizePhone } from "./leads";
import { readUploadedDocument } from "./lector-documentos";
import { pushSupplierToSiigo } from "./siigo-clientes";
import { codigoProveedor, importSuppliersBatch, nitBase, siguienteNumeroProveedor, type SupplierImportBatch } from "./siigo-proveedores";
import { formatTaxId, parseTaxData, type TaxReading } from "./rut";
import { seal, sealMatches } from "./secrets";
import { CHAMBER_MAX_AGE_DAYS, lineComplete, termDaysFrom } from "./suppliers";

export type SupplierFormState = { error?: string; ok?: string };

const texto = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim();
const opcional = (fd: FormData, name: string) => texto(fd, name) || null;

/**
 * Número escrito a la colombiana o con punto decimal: «12.500» y «12500» son
 * doce mil quinientos; «12.500,50», «0,70» y «0.70» llevan decimales. Un punto
 * sólo se toma por separador de miles si separa grupos de tres dígitos y no hay
 * coma. Vacío → null; basura → NaN.
 */
function numero(raw: string) {
  let limpio = raw.replace(/[^\d.,]/g, "");
  if (!limpio) return null;
  if (limpio.includes(",")) limpio = limpio.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(limpio)) limpio = limpio.replace(/\./g, "");
  const v = Number(limpio);
  return Number.isFinite(v) && v >= 0 ? v : NaN;
}

/** Compras toca dos secciones del menú: se revalidan las dos con sus fichas. */
function revalidarCompras() {
  revalidatePath("/cotizaciones", "layout");
  revalidatePath("/proveedores", "layout");
}

async function responsable(fd: FormData, fallback: string) {
  const id = texto(fd, "ownerId");
  if (!id) return fallback;
  const user = await prisma.user.findFirst({ where: { id, active: true, role: { in: SUPPLIER_ROLES } }, select: { id: true } });
  return user?.id ?? fallback;
}

/**
 * Condiciones de compra: el texto pactado y, si se puede, el plazo en días. Si
 * no se escribe el plazo, se toma del texto («Pago a 30 días» → 30).
 */
function leerCondiciones(fd: FormData) {
  const paymentTerms = opcional(fd, "paymentTerms");
  const dias = numero(texto(fd, "paymentTermDays"));
  if (Number.isNaN(dias) || (dias != null && !Number.isInteger(dias))) return { error: "El plazo de pago debe ser un número entero de días." };
  return { paymentTerms, paymentTermDays: dias ?? termDaysFrom(paymentTerms) };
}

// ────────────────────────────  SKU y sus condiciones  ─────────────────────────

type Respuestas = { minOrderQty: number | null; unitCost: number | null; productionLeadDays: number | null; transitDays: number | null };
type Linea = { sku: string; description: string | null } & Respuestas;

/**
 * Las preguntas de cada SKU: cantidad mínima, costo, producción y tránsito.
 * En una cotización pueden quedar vacías mientras el proveedor no responda; en
 * un proveedor (`completa`) son obligatorias.
 */
function leerLinea(valores: Record<keyof Linea, string>, completa: boolean): Linea | { error: string } {
  const sku = valores.sku.trim().toUpperCase();
  if (!sku) return { error: "Falta el SKU." };
  const minOrderQty = numero(valores.minOrderQty);
  const unitCost = numero(valores.unitCost);
  const productionLeadDays = numero(valores.productionLeadDays);
  const transitDays = numero(valores.transitDays);
  const enteros: [number | null, string][] = [
    [minOrderQty, "La cantidad mínima"],
    [productionLeadDays, "El production lead time"],
    [transitDays, "El transit time"],
  ];
  for (const [v, nombre] of enteros) {
    if (Number.isNaN(v) || (v != null && !Number.isInteger(v))) return { error: `${nombre} de ${sku} debe ser un número entero.` };
  }
  if (Number.isNaN(unitCost)) return { error: `El costo de ${sku} no es un número.` };
  if (minOrderQty === 0) return { error: `La cantidad mínima de ${sku} debe ser al menos 1.` };
  const linea = { sku, description: valores.description.trim() || null, minOrderQty, unitCost, productionLeadDays, transitDays };
  if (completa && !lineComplete(linea)) return { error: `Completa las cuatro respuestas de ${sku}: mínimo, costo, producción y tránsito.` };
  return linea;
}

const CAMPOS_LINEA = ["sku", "description", "minOrderQty", "unitCost", "productionLeadDays", "transitDays"] as const;

/** Líneas que llegan repetidas en el formulario de alta (`sku`, `unitCost`… una vez por fila). */
function leerLineas(fd: FormData) {
  const columnas = Object.fromEntries(CAMPOS_LINEA.map((c) => [c, fd.getAll(c).map(String)])) as Record<keyof Linea, string[]>;
  const lineas: Linea[] = [];
  for (let i = 0; i < columnas.sku.length; i++) {
    const fila = Object.fromEntries(CAMPOS_LINEA.map((c) => [c, columnas[c][i] ?? ""])) as Record<keyof Linea, string>;
    // Una fila que se dejó en blanco no cuenta.
    if (CAMPOS_LINEA.every((c) => !fila[c].trim())) continue;
    const l = leerLinea(fila, false);
    if ("error" in l) return { error: l.error };
    if (lineas.some((x) => x.sku === l.sku)) return { error: `El SKU ${l.sku} está repetido.` };
    lineas.push(l);
  }
  return { lineas };
}

/** Si el SKU es del catálogo, la línea queda enlazada al producto y toma su nombre si no tiene descripción. */
async function enlazarProductos<T extends { sku: string; description: string | null }>(lineas: T[]) {
  if (!lineas.length) return [];
  const productos = await prisma.product.findMany({ where: { sku: { in: lineas.map((l) => l.sku) } }, select: { id: true, sku: true, name: true } });
  const porSku = new Map(productos.map((p) => [p.sku.toUpperCase(), p]));
  return lineas.map((l) => {
    const p = porSku.get(l.sku);
    return { ...l, productId: p?.id ?? null, description: l.description ?? p?.name ?? null };
  });
}

// ─────────────────────────────────  Alta  ────────────────────────────────────

/** Siguiente CT-00000. Si dos se crean a la vez, el índice único decide y se reintenta. */
async function crearConCodigo(data: Omit<Prisma.SupplierQuoteUncheckedCreateInput, "code">) {
  for (let intento = 0; intento < 6; intento++) {
    const total = await prisma.supplierQuote.count();
    const code = `CT-${String(total + 1 + intento).padStart(5, "0")}`;
    try {
      return await prisma.supplierQuote.create({ data: { ...data, code } });
    } catch (e) {
      if ((e as { code?: string })?.code !== "P2002") throw e;
    }
  }
  throw new Error("No se pudo asignar un consecutivo a la cotización; intenta de nuevo.");
}

/**
 * Alta de la cotización de un proveedor nuevo con los SKU que se le piden. Las
 * respuestas de cada SKU pueden ir vacías: se completan cuando conteste.
 */
export async function crearCotizacion(_prev: SupplierFormState, fd: FormData): Promise<SupplierFormState> {
  const user = await requireRole(SUPPLIER_ROLES);
  const name = texto(fd, "name");
  if (!name) return { error: "Falta el nombre del proveedor." };
  const phone = normalizePhone(texto(fd, "phone"));
  if (texto(fd, "phone") && !phone) return { error: "El teléfono no parece válido." };
  const condiciones = leerCondiciones(fd);
  if ("error" in condiciones) return { error: condiciones.error };
  const r = leerLineas(fd);
  if ("error" in r) return { error: r.error };
  if (!r.lineas.length) return { error: "Agrega al menos un SKU a cotizar." };

  const lineas = await enlazarProductos(r.lineas);
  const completas = lineas.filter(lineComplete).length;
  const quote = await crearConCodigo({
    name,
    contactName: opcional(fd, "contactName"),
    phone,
    email: opcional(fd, "email")?.toLowerCase() ?? null,
    city: opcional(fd, "city"),
    ...condiciones,
    // Si ya trae las respuestas de todos los SKU, la cotización está recibida.
    status: completas === lineas.length ? "RECIBIDA" : "SOLICITADA",
    notes: opcional(fd, "notes"),
    ownerId: await responsable(fd, user.id),
    createdById: user.id,
  });
  await prisma.supplierQuoteLine.createMany({ data: lineas.map((l) => ({ ...l, quoteId: quote.id })) });
  await prisma.supplierQuoteEvent.create({
    data: {
      quoteId: quote.id,
      type: "CREADA",
      body: `Cotización con ${`${lineas.length} SKU`}${completas < lineas.length ? ` · ${lineas.length - completas} sin respuesta del proveedor` : ""}`,
      userId: user.id,
    },
  });

  revalidarCompras();
  redirect(`/cotizaciones/${quote.id}`);
}

// ──────────────────────────────  Seguimiento  ────────────────────────────────

async function cotizacionAbierta(id: string) {
  const quote = await prisma.supplierQuote.findUnique({ where: { id } });
  if (!quote) return { error: "La cotización ya no existe." };
  if (quote.supplierId) return { error: "Esta cotización ya es proveedor: sus condiciones se editan en la ficha del proveedor." };
  return { quote };
}

/** Estado, responsable y condiciones de compra. Cada cambio queda en la bitácora. */
export async function actualizarSeguimientoCotizacion(_prev: SupplierFormState, fd: FormData): Promise<SupplierFormState> {
  const user = await requireRole(SUPPLIER_ROLES);
  const r = await cotizacionAbierta(texto(fd, "id"));
  if ("error" in r) return { error: r.error };
  const { quote } = r;

  const status = texto(fd, "status");
  if (!QUOTE_OPEN.includes(status as never) && status !== "DESCARTADA") return { error: "Para aprobarla, conviértela en proveedor." };
  const discardReason = status === "DESCARTADA" ? opcional(fd, "discardReason") : null;
  if (status === "DESCARTADA" && !discardReason) return { error: "Anota por qué se descarta: precio, mínimos, tiempos…" };
  const condiciones = leerCondiciones(fd);
  if ("error" in condiciones) return { error: condiciones.error };
  const ownerId = await responsable(fd, quote.ownerId ?? user.id);

  const cambios: string[] = [];
  if (status !== quote.status) cambios.push(`Estado: ${QUOTE_STATUS.label(quote.status)} → ${QUOTE_STATUS.label(status)}`);
  if (condiciones.paymentTerms !== quote.paymentTerms) cambios.push(`Condiciones de compra: ${condiciones.paymentTerms ?? "sin definir"}`);
  if (condiciones.paymentTermDays !== quote.paymentTermDays) {
    cambios.push(`Plazo: ${condiciones.paymentTermDays != null ? `${condiciones.paymentTermDays} días` : "sin definir"}`);
  }
  if (ownerId !== quote.ownerId) {
    const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { name: true } });
    cambios.push(`Responsable: ${owner?.name ?? "—"}`);
  }
  if (discardReason && discardReason !== quote.discardReason) cambios.push(`Motivo: ${discardReason}`);
  if (!cambios.length) return { ok: "Sin cambios." };

  await prisma.supplierQuote.update({
    where: { id: quote.id },
    data: { status, discardReason, ownerId, ...condiciones, lastActivityAt: new Date() },
  });
  await prisma.supplierQuoteEvent.create({ data: { quoteId: quote.id, type: "ESTADO", body: cambios.join(" · "), userId: user.id } });
  revalidarCompras();
  return { ok: "Seguimiento guardado." };
}

/** Nombre del proveedor, contacto y observaciones. Son correcciones: no van a la bitácora. */
export async function actualizarDatosCotizacion(_prev: SupplierFormState, fd: FormData): Promise<SupplierFormState> {
  await requireRole(SUPPLIER_ROLES);
  const r = await cotizacionAbierta(texto(fd, "id"));
  if ("error" in r) return { error: r.error };
  const name = texto(fd, "name");
  if (!name) return { error: "Falta el nombre del proveedor." };
  const phone = normalizePhone(texto(fd, "phone"));
  if (texto(fd, "phone") && !phone) return { error: "El teléfono no parece válido." };
  await prisma.supplierQuote.update({
    where: { id: r.quote.id },
    data: {
      name,
      contactName: opcional(fd, "contactName"),
      phone,
      email: opcional(fd, "email")?.toLowerCase() ?? null,
      city: opcional(fd, "city"),
      notes: opcional(fd, "notes"),
    },
  });
  revalidarCompras();
  return { ok: "Datos guardados." };
}

export async function agregarNotaCotizacion(fd: FormData) {
  const user = await requireRole(SUPPLIER_ROLES);
  const id = texto(fd, "id");
  const body = texto(fd, "body");
  if (!id || !body) return;
  const quote = await prisma.supplierQuote.findUnique({ where: { id }, select: { id: true } });
  if (!quote) return;
  await prisma.supplierQuoteEvent.create({ data: { quoteId: id, type: "NOTA", body, userId: user.id } });
  await prisma.supplierQuote.update({ where: { id }, data: { lastActivityAt: new Date() } });
  revalidarCompras();
}

/**
 * Agrega o corrige (con `lineId`) un SKU de una cotización abierta
 * (`scope=quote`) o las condiciones de un SKU de un proveedor (`scope=supplier`).
 */
export async function guardarCondicion(_prev: SupplierFormState, fd: FormData): Promise<SupplierFormState> {
  const user = await requireRole(SUPPLIER_ROLES);
  const proveedor = texto(fd, "scope") === "supplier";
  const parentId = texto(fd, "parentId");
  const lineId = opcional(fd, "lineId");

  const valores = Object.fromEntries(CAMPOS_LINEA.map((c) => [c, texto(fd, c)])) as Record<keyof Linea, string>;
  const leida = leerLinea(valores, proveedor);
  if ("error" in leida) return { error: leida.error };
  const [linea] = await enlazarProductos([leida]);

  try {
    if (proveedor) {
      const supplier = await prisma.supplier.findUnique({ where: { id: parentId }, select: { id: true } });
      if (!supplier) return { error: "El proveedor ya no existe." };
      const data = linea as typeof linea & { minOrderQty: number; unitCost: number; productionLeadDays: number; transitDays: number };
      if (lineId) {
        const { count } = await prisma.supplierProduct.updateMany({ where: { id: lineId, supplierId: supplier.id }, data });
        if (!count) return { error: "Ese SKU ya no está en el proveedor." };
      } else {
        await prisma.supplierProduct.create({ data: { ...data, supplierId: supplier.id } });
      }
    } else {
      const r = await cotizacionAbierta(parentId);
      if ("error" in r) return { error: r.error };
      if (lineId) {
        const { count } = await prisma.supplierQuoteLine.updateMany({ where: { id: lineId, quoteId: r.quote.id }, data: linea });
        if (!count) return { error: "Ese SKU ya no está en la cotización." };
      } else {
        await prisma.supplierQuoteLine.create({ data: { ...linea, quoteId: r.quote.id } });
        await prisma.supplierQuoteEvent.create({ data: { quoteId: r.quote.id, type: "NOTA", body: `SKU agregado: ${linea.sku}`, userId: user.id } });
      }
      await prisma.supplierQuote.update({ where: { id: r.quote.id }, data: { lastActivityAt: new Date() } });
    }
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") return { error: `El SKU ${linea.sku} ya está; edita esa fila.` };
    throw e;
  }
  revalidarCompras();
  return { ok: lineId ? "SKU guardado." : "SKU agregado." };
}

export async function quitarCondicion(fd: FormData) {
  await requireRole(SUPPLIER_ROLES);
  const parentId = texto(fd, "parentId");
  const lineId = texto(fd, "lineId");
  if (texto(fd, "scope") === "supplier") {
    await prisma.supplierProduct.deleteMany({ where: { id: lineId, supplierId: parentId } });
  } else {
    const r = await cotizacionAbierta(parentId);
    if ("error" in r) return;
    // Una cotización siempre conserva al menos un SKU.
    if ((await prisma.supplierQuoteLine.count({ where: { quoteId: parentId } })) <= 1) return;
    await prisma.supplierQuoteLine.deleteMany({ where: { id: lineId, quoteId: parentId } });
  }
  revalidarCompras();
}

// ───────────────────────────────  Conversión  ────────────────────────────────

const DOCUMENTOS = {
  RUT: { nombre: "RUT", falta: "Elige el archivo del RUT." },
  CAMARA_COMERCIO: { nombre: "certificado de Cámara de Comercio", falta: "Elige el archivo del certificado de Cámara de Comercio." },
} as const;

/**
 * Lee el RUT o el certificado de Cámara de Comercio del proveedor (`kind`). No
 * guarda nada: devuelve lo leído, sellado, para revisarlo en el formulario.
 */
export async function leerDocumentoProveedor(fd: FormData): Promise<TaxReading> {
  const user = await requireRole(SUPPLIER_ROLES);
  const kind = texto(fd, "kind") === "CAMARA_COMERCIO" ? "CAMARA_COMERCIO" : "RUT";
  const lectura = await readUploadedDocument(fd.get("document"), user.id, DOCUMENTOS[kind].falta);
  if (!lectura.data) return lectura;
  if (lectura.data.documentType !== kind) {
    return { error: `Ese documento no es un ${DOCUMENTOS[kind].nombre}: súbelo en su casilla.` };
  }
  let warnings = lectura.warnings ?? [];
  if (kind === "CAMARA_COMERCIO") {
    // DANE y dirección sólo importan para Siigo, y salen del RUT. De la Cámara
    // importa que el proveedor exista hoy: un certificado viejo no lo prueba.
    const expedido = lectura.data.issuedAt ? new Date(`${lectura.data.issuedAt}T12:00:00-05:00`) : null;
    const dias = expedido && !Number.isNaN(expedido.getTime()) ? Math.floor((Date.now() - expedido.getTime()) / 86_400_000) : null;
    warnings =
      dias == null
        ? ["No se leyó la fecha de expedición del certificado: revisa que sea reciente."]
        : dias > CHAMBER_MAX_AGE_DAYS
          ? [`El certificado tiene ${dias} días: pide uno de menos de ${CHAMBER_MAX_AGE_DAYS}.`]
          : [];
  }
  const raw = JSON.stringify(lectura.data);
  return { ...lectura, warnings, raw, seal: seal(raw) };
}

/** Lo que llegó sellado del formulario, si es del tipo de documento esperado. */
function documentoSellado(fd: FormData, campo: string, tipo: "RUT" | "CAMARA_COMERCIO") {
  const raw = texto(fd, campo);
  if (!raw) return null;
  const datos = sealMatches(raw, texto(fd, `${campo}Seal`)) ? parseTaxData(raw) : null;
  return datos?.documentType === tipo ? datos : null;
}

/**
 * Convierte la cotización aprobada en proveedor. Exige que cada SKU tenga sus
 * cuatro respuestas, las condiciones de compra, el RUT (lo que alimenta a
 * Siigo) y la Cámara de Comercio, ambos del mismo NIT. Si el NIT ya es de un
 * proveedor —p. ej. uno traído de Siigo—, la cotización se suma a sus
 * condiciones en vez de duplicarlo.
 *
 * D1 no tiene transacciones: la cotización se marca apenas existe el
 * proveedor y los SKU se guardan por (proveedor, SKU), así que repetir la
 * acción tras un corte no duplica nada.
 */
export async function convertirCotizacion(_prev: SupplierFormState, fd: FormData): Promise<SupplierFormState> {
  const user = await requireRole(SUPPLIER_ROLES);
  const quote = await prisma.supplierQuote.findUnique({ where: { id: texto(fd, "id") }, include: { lines: { orderBy: { createdAt: "asc" } } } });
  if (!quote) return { error: "La cotización ya no existe." };
  if (quote.status === "DESCARTADA") return { error: "Reabre la cotización antes de convertirla." };
  if (quote.supplierId) redirect(`/proveedores/${quote.supplierId}`);

  if (!quote.lines.length) return { error: "La cotización no tiene SKU." };
  const pendientes = quote.lines.filter((l) => !lineComplete(l));
  if (pendientes.length) {
    return { error: `Faltan respuestas del proveedor en ${pendientes.map((l) => l.sku).join(", ")}: mínimo, costo, producción y tránsito.` };
  }
  const condiciones = leerCondiciones(fd);
  if ("error" in condiciones) return { error: condiciones.error };
  if (!condiciones.paymentTerms) return { error: "Confirma las condiciones de compra antes de crear el proveedor." };

  const fiscal = documentoSellado(fd, "rut", "RUT");
  if (!fiscal) return { error: texto(fd, "rut") ? "Los datos del RUT no son válidos; vuelve a subirlo." : "Sube el RUT del proveedor." };
  const camara = documentoSellado(fd, "camara", "CAMARA_COMERCIO");
  if (!camara) {
    return { error: texto(fd, "camara") ? "Los datos de la Cámara de Comercio no son válidos; vuelve a subirla." : "Sube el certificado de Cámara de Comercio del proveedor." };
  }
  const base = nitBase(fiscal.idNumber);
  if (nitBase(camara.idNumber) !== base) {
    return { error: `El RUT es del NIT ${base} y la Cámara de Comercio del ${nitBase(camara.idNumber)}: deben ser del mismo proveedor.` };
  }

  const name = texto(fd, "legalName") || fiscal.legalName;
  fiscal.legalName = name;
  // El RUT no siempre trae representante legal; la Cámara sí, y Siigo lo usa de contacto.
  fiscal.legalRepresentative ??= camara.legalRepresentative;
  const taxId = formatTaxId(fiscal);
  const phone = normalizePhone(texto(fd, "phone"));
  const datos = {
    contactName: opcional(fd, "contactName"),
    phone,
    email: opcional(fd, "email")?.toLowerCase() ?? null,
    city: opcional(fd, "city"),
    address: opcional(fd, "address"),
  };

  // Un proveedor con el mismo NIT —traído de Siigo o de otra cotización— recibe estas condiciones.
  const mismos = await prisma.supplier.findMany({ where: { taxId: { startsWith: base } } });
  let supplier = mismos.find((s) => nitBase(s.taxId) === base) ?? null;
  const existia = Boolean(supplier);

  if (supplier) {
    // Lo que ya tenía el proveedor no se pisa, salvo los documentos y las condiciones nuevas.
    supplier = await prisma.supplier.update({
      where: { id: supplier.id },
      data: {
        taxId: supplier.taxId?.includes("-") ? supplier.taxId : taxId,
        contactName: supplier.contactName ?? datos.contactName,
        phone: supplier.phone ?? datos.phone,
        email: supplier.email ?? datos.email,
        city: supplier.city ?? datos.city,
        address: supplier.address ?? datos.address,
        ...condiciones,
        fiscalData: JSON.stringify(fiscal),
        chamberData: JSON.stringify(camara),
        active: true,
      },
    });
  } else {
    for (let intento = 0; !supplier && intento < 5; intento++) {
      try {
        supplier = await prisma.supplier.create({
          data: {
            code: codigoProveedor((await siguienteNumeroProveedor()) + intento),
            name,
            taxId,
            origin: "CRM",
            ...datos,
            ...condiciones,
            fiscalData: JSON.stringify(fiscal),
            chamberData: JSON.stringify(camara),
            notes: quote.notes,
            ownerId: quote.ownerId ?? user.id,
          },
        });
      } catch (e) {
        if ((e as { code?: string })?.code !== "P2002") throw e;
      }
    }
    if (!supplier) return { error: "No se pudo asignar código al proveedor; intenta de nuevo." };
  }

  const now = new Date();
  await prisma.supplierQuote.update({
    where: { id: quote.id },
    data: { status: "APROBADA", supplierId: supplier.id, ...condiciones, convertedAt: now, lastActivityAt: now },
  });

  // Las condiciones de la cotización pasan a ser las vigentes de cada SKU con el proveedor.
  for (const l of quote.lines) {
    const condicion = {
      description: l.description,
      productId: l.productId,
      minOrderQty: l.minOrderQty!,
      unitCost: l.unitCost!,
      productionLeadDays: l.productionLeadDays!,
      transitDays: l.transitDays!,
    };
    await prisma.supplierProduct.upsert({
      where: { supplierId_sku: { supplierId: supplier.id, sku: l.sku } },
      create: { ...condicion, supplierId: supplier.id, sku: l.sku },
      update: condicion,
    });
  }

  // Siigo va al final: si lo rechaza, el proveedor ya existe y se reintenta desde su ficha.
  let siigo = "";
  if (fd.get("siigo") === "on" && !supplier.siigoId) {
    const r = await pushSupplierToSiigo(supplier.id, user.id);
    siigo = "error" in r ? ` · Siigo no lo recibió: ${r.error}` : r.existed ? " · ya existía en Siigo y quedó enlazado" : " · creado en Siigo";
  }

  await prisma.supplierQuoteEvent.create({
    data: {
      quoteId: quote.id,
      type: "CONVERTIDA",
      body: `${existia ? "Sumada al proveedor" : "Convertida en el proveedor"} ${supplier.code} con RUT y Cámara de Comercio · ${`${quote.lines.length} SKU`} · ${condiciones.paymentTerms}${siigo}`,
      userId: user.id,
    },
  });

  revalidarCompras();
  revalidatePath("/conexiones");
  redirect(`/proveedores/${supplier.id}`);
}

// ──────────────────────────────  Proveedores  ────────────────────────────────

/** Datos de contacto, condiciones de compra y estado del proveedor. */
export async function actualizarProveedor(_prev: SupplierFormState, fd: FormData): Promise<SupplierFormState> {
  await requireRole(SUPPLIER_ROLES);
  const id = texto(fd, "id");
  const name = texto(fd, "name");
  if (!name) return { error: "Falta el nombre del proveedor." };
  const phone = normalizePhone(texto(fd, "phone"));
  if (texto(fd, "phone") && !phone) return { error: "El teléfono no parece válido." };
  const condiciones = leerCondiciones(fd);
  if ("error" in condiciones) return { error: condiciones.error };
  const { count } = await prisma.supplier.updateMany({
    where: { id },
    data: {
      name,
      contactName: opcional(fd, "contactName"),
      phone,
      email: opcional(fd, "email")?.toLowerCase() ?? null,
      city: opcional(fd, "city"),
      address: opcional(fd, "address"),
      ...condiciones,
      notes: opcional(fd, "notes"),
      active: fd.get("active") === "on",
      ownerId: await responsable(fd, texto(fd, "ownerId")),
    },
  });
  if (!count) return { error: "El proveedor ya no existe." };
  revalidarCompras();
  return { ok: "Proveedor guardado." };
}

/** Reintenta desde la ficha el alta en Siigo de un proveedor convertido con su RUT. */
export async function enviarProveedorASiigo(fd: FormData) {
  const user = await requireRole(SUPPLIER_ROLES);
  const id = texto(fd, "supplierId");
  if (!id) return;
  await pushSupplierToSiigo(id, user.id);
  revalidarCompras();
  revalidatePath("/conexiones");
}

/**
 * Una página de la importación de proveedores desde Siigo. El botón la llama
 * en bucle con la página siguiente hasta que `done`.
 */
export async function importarProveedoresSiigo(page: number): Promise<SupplierImportBatch> {
  const user = await requireRole(SUPPLIER_ROLES);
  const batch = await importSuppliersBatch(Math.max(1, Math.floor(page) || 1), user.id);
  if (batch.done || batch.nuevos || batch.enlazados) revalidarCompras();
  return batch;
}
