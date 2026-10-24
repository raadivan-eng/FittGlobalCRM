"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { RECEIPT_ROLES, requireRole } from "./auth";
import { readPackingPhoto, readSupplierInvoice } from "./lector-bodega";
import { nitBase } from "./siigo-proveedores";
import { daysUntil, dateFromIso, isoDate, matches, reconcile, SHORT_EXPIRY_DAYS, type InvoiceReading, type PackingReading } from "./receipts";

export type ReceiptFormState = { error?: string; ok?: string };

const texto = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim();
const opcional = (fd: FormData, name: string) => texto(fd, name) || null;
const lista = (fd: FormData, name: string) => fd.getAll(name).map((v) => String(v).trim());

/** «12.500», «12500» o «12500,50» → número; vacío → null; basura → NaN. */
function numero(raw: string) {
  const limpio = raw.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
  if (!limpio) return null;
  const v = Number(limpio);
  return Number.isFinite(v) && v >= 0 ? v : NaN;
}

const plural = (n: number, palabra: string) => `${n} ${palabra}${n === 1 ? "" : "s"}`;
const esConflictoUnico = (e: unknown) => (e as { code?: string })?.code === "P2002";

/** Un ingreso toca su ficha, el inventario y el stock de cada producto. */
function revalidarBodega() {
  revalidatePath("/ingresos", "layout");
  revalidatePath("/inventario");
  revalidatePath("/productos", "layout");
}

/** Consecutivo IN-00001. Si dos ingresos se crean a la vez, el índice único decide y se reintenta. */
async function siguienteCodigo(intento: number) {
  const total = await prisma.goodsReceipt.count();
  return `IN-${String(total + 1 + intento).padStart(5, "0")}`;
}

/**
 * Traductor de códigos a productos del catálogo: el SKU propio, el código de
 * barras o la referencia con que el proveedor lo tiene en sus condiciones.
 */
async function catalogo(supplierId: string | null) {
  const [products, supplierSkus] = await Promise.all([
    prisma.product.findMany({ where: { active: true }, select: { id: true, sku: true, barcode: true } }),
    supplierId
      ? prisma.supplierProduct.findMany({ where: { supplierId, productId: { not: null } }, select: { sku: true, productId: true } })
      : Promise.resolve([]),
  ]);
  const porCodigo = new Map<string, string>();
  for (const s of supplierSkus) porCodigo.set(s.sku.toUpperCase(), s.productId!);
  for (const p of products) {
    if (p.barcode) porCodigo.set(p.barcode.replace(/\s/g, ""), p.id);
    porCodigo.set(p.sku.toUpperCase(), p.id);
  }
  return (code: string | null | undefined) => (code ? (porCodigo.get(code.trim().toUpperCase()) ?? porCodigo.get(code.replace(/\s/g, "")) ?? null) : null);
}

/** El proveedor dado de alta que emitió la factura: primero por NIT, después por nombre exacto. */
async function proveedorDeFactura(taxId: string | null, name: string) {
  const base = nitBase(taxId);
  if (base) {
    const mismos = await prisma.supplier.findMany({ where: { taxId: { startsWith: base } }, select: { id: true, taxId: true } });
    const s = mismos.find((x) => nitBase(x.taxId) === base);
    if (s) return s.id;
  }
  const s = name ? await prisma.supplier.findFirst({ where: { name }, select: { id: true } }) : null;
  return s?.id ?? null;
}

/** Otro ingreso vivo con la misma factura del mismo proveedor. */
async function facturaRepetida(invoiceNumber: string, supplierId: string | null, supplierName: string) {
  return prisma.goodsReceipt.findFirst({
    where: { invoiceNumber, status: { not: "ANULADO" }, OR: [...(supplierId ? [{ supplierId }] : []), { supplierName }] },
    select: { code: true },
  });
}

// ────────────────────────────────  Factura  ──────────────────────────────────

/**
 * Lee la factura con Claude y cruza cada renglón con el catálogo. No guarda
 * nada: devuelve lo leído para revisarlo en el formulario.
 */
export async function leerFactura(fd: FormData): Promise<InvoiceReading> {
  const user = await requireRole(RECEIPT_ROLES);
  const lectura = await readSupplierInvoice(fd.get("document"), user.id);
  if (!lectura.data) return { error: lectura.error };
  const { documentType: _tipo, lines, ...factura } = lectura.data;

  const supplierId = await proveedorDeFactura(factura.supplierTaxId, factura.supplierName);
  const producto = await catalogo(supplierId);
  const renglones = lines.map((l) => ({
    sku: l.code.trim().toUpperCase(),
    description: l.description.trim(),
    quantity: Math.round(l.quantity),
    unitCost: l.unitCost,
    productId: producto(l.code),
  }));

  const warnings: string[] = [];
  const sinProducto = renglones.filter((l) => !l.productId).length;
  if (sinProducto) warnings.push(`${plural(sinProducto, "renglón")} no se reconoció en el catálogo: elige el producto a mano.`);
  if (!supplierId) warnings.push("El proveedor no está dado de alta: el ingreso queda con el nombre de la factura.");
  const repetida = await facturaRepetida(factura.invoiceNumber, supplierId, factura.supplierName);
  if (repetida) warnings.push(`La factura ${factura.invoiceNumber} ya está cargada en el ingreso ${repetida.code}.`);
  if (!factura.invoiceDate) warnings.push("No se leyó la fecha de la factura.");

  return { data: { ...factura, supplierTaxId: factura.supplierTaxId?.replace(/\D/g, "") || null, supplierId, lines: renglones }, warnings };
}

/**
 * Registra la factura del proveedor y abre el ingreso POR_RECIBIR. Los renglones
 * llegan como campos repetidos, en orden; cada uno debe apuntar a un producto
 * del catálogo, porque es lo que luego se contrasta con lo contado.
 */
export async function crearIngreso(_prev: ReceiptFormState, fd: FormData): Promise<ReceiptFormState> {
  const user = await requireRole(RECEIPT_ROLES);
  const supplierName = texto(fd, "supplierName");
  const invoiceNumber = texto(fd, "invoiceNumber").toUpperCase();
  if (!supplierName) return { error: "Escribe el proveedor que emite la factura." };
  if (!invoiceNumber) return { error: "Escribe el número de la factura." };
  const invoiceDate = texto(fd, "invoiceDate") ? dateFromIso(texto(fd, "invoiceDate")) : null;
  if (texto(fd, "invoiceDate") && !invoiceDate) return { error: "La fecha de la factura no es válida." };
  const supplierTaxId = texto(fd, "supplierTaxId").replace(/\D/g, "") || null;

  const skus = lista(fd, "lineSku");
  const productIds = lista(fd, "lineProductId");
  const descripciones = lista(fd, "lineDescription");
  const cantidades = lista(fd, "lineQuantity");
  const costos = lista(fd, "lineUnitCost");
  if (!skus.length) return { error: "La factura no tiene renglones." };

  const productos = new Map(
    (await prisma.product.findMany({ where: { id: { in: productIds.filter(Boolean) } }, select: { id: true, sku: true, unitCost: true } })).map((p) => [p.id, p]),
  );
  const lines = [];
  for (let i = 0; i < skus.length; i++) {
    const n = `El renglón ${i + 1}`;
    const product = productos.get(productIds[i]);
    if (!product) return { error: `${n}${skus[i] ? ` (${skus[i]})` : ""} no tiene producto del catálogo.` };
    const quantity = numero(cantidades[i] ?? "");
    if (quantity == null || Number.isNaN(quantity) || !Number.isInteger(quantity) || quantity <= 0) return { error: `${n} debe tener una cantidad entera mayor que cero.` };
    const costo = numero(costos[i] ?? "");
    if (Number.isNaN(costo)) return { error: `El costo del renglón ${i + 1} no es un número.` };
    lines.push({
      productId: product.id,
      sku: skus[i].toUpperCase() || product.sku,
      description: descripciones[i] || null,
      quantity,
      // Sin costo en la factura, el lote entra al costo de lista del producto.
      unitCost: costo ?? product.unitCost,
    });
  }

  const supplierId = await proveedorDeFactura(supplierTaxId, supplierName);
  const repetida = await facturaRepetida(invoiceNumber, supplierId, supplierName);
  if (repetida) return { error: `La factura ${invoiceNumber} ya está cargada en el ingreso ${repetida.code}. Anúlalo si quieres cargarla de nuevo.` };

  let warehouseId = texto(fd, "warehouseId");
  if (warehouseId === "NUEVA") {
    const name = texto(fd, "warehouseName");
    const city = texto(fd, "warehouseCity");
    if (!name || !city) return { error: "Escribe el nombre y la ciudad de la bodega nueva." };
    const total = await prisma.warehouse.count();
    const w = await prisma.warehouse.create({ data: { name, city, code: `BOD-${String(total + 1).padStart(2, "0")}` } });
    warehouseId = w.id;
  } else if (!(await prisma.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true } }))) {
    return { error: "Elige la bodega a la que entra la mercancía." };
  }

  const data = {
    status: "POR_RECIBIR",
    source: texto(fd, "source") === "LECTURA" ? "LECTURA" : "MANUAL",
    supplierId,
    supplierName,
    supplierTaxId,
    invoiceNumber,
    invoiceDate,
    warehouseId,
    notes: opcional(fd, "notes"),
    createdById: user.id,
  };

  // D1 no tiene transacciones: si los renglones fallan, el ingreso queda sin
  // renglones y se puede anular; nunca entra inventario desde aquí.
  let id = "";
  for (let intento = 0; intento < 3 && !id; intento++) {
    try {
      id = (await prisma.goodsReceipt.create({ data: { ...data, code: await siguienteCodigo(intento) } })).id;
    } catch (e) {
      if (!esConflictoUnico(e)) throw e;
    }
  }
  if (!id) return { error: "No se pudo asignar el consecutivo del ingreso. Intenta de nuevo." };
  await prisma.goodsReceiptLine.createMany({ data: lines.map((l) => ({ ...l, receiptId: id })) });

  revalidarBodega();
  redirect(`/ingresos/${id}`);
}

/** Anula un ingreso que todavía no se recibió: la factura se cargó por error. */
export async function anularIngreso(fd: FormData) {
  await requireRole(RECEIPT_ROLES);
  const id = texto(fd, "id");
  await prisma.goodsReceipt.updateMany({ where: { id, status: "POR_RECIBIR" }, data: { status: "ANULADO" } });
  revalidarBodega();
}

// ──────────────────────────────  Packing slip  ───────────────────────────────

/**
 * Lee la foto de una etiqueta y devuelve los lotes como renglones del packing
 * slip, ya cruzados con los productos de la factura. No guarda nada.
 */
export async function leerEtiquetas(fd: FormData): Promise<PackingReading> {
  const user = await requireRole(RECEIPT_ROLES);
  const receipt = await prisma.goodsReceipt.findUnique({
    where: { id: texto(fd, "receiptId") },
    select: { status: true, lines: { select: { sku: true, product: { select: { id: true, sku: true, name: true, barcode: true, unitsPerCase: true } } } } },
  });
  if (!receipt) return { error: "El ingreso ya no existe." };
  if (receipt.status !== "POR_RECIBIR") return { error: "Este ingreso ya se recibió." };

  const productos = [...new Map(receipt.lines.map((l) => [l.product.id, l.product])).values()];
  const lectura = await readPackingPhoto(fd.get("photo"), productos, user.id);
  if (!lectura.data) return { error: lectura.error };

  // Lo que se reconoce sólo vale si es uno de los productos facturados.
  const porCodigo = new Map<string, (typeof productos)[number]>();
  for (const p of productos) {
    porCodigo.set(p.sku.toUpperCase(), p);
    if (p.barcode) porCodigo.set(p.barcode.replace(/\s/g, ""), p);
  }
  for (const l of receipt.lines) porCodigo.set(l.sku.toUpperCase(), l.product);
  const buscar = (code: string | null) => (code ? (porCodigo.get(code.trim().toUpperCase()) ?? porCodigo.get(code.replace(/\s/g, ""))) : undefined);

  const warnings: string[] = [];
  const rows = [];
  for (const item of lectura.data.items) {
    const p = buscar(item.sku) ?? buscar(item.printedCode);
    const nombre = p?.name ?? item.description;
    if (!p) warnings.push(`«${item.description}» no coincide con ningún producto de la factura: elige el producto o quita el renglón.`);
    if (!item.lotCode) warnings.push(`No se leyó el lote de ${nombre}.`);
    const vence = dateFromIso(item.expiryDate);
    if (!vence) warnings.push(`No se leyó el vencimiento de ${nombre}.`);
    if (item.quantity == null) warnings.push(`No se leyó la cantidad de ${nombre}: cuéntala.`);
    const unidades = item.quantity == null ? null : Math.round(item.unit === "CAJA" && p ? item.quantity * p.unitsPerCase : item.quantity);
    if (item.unit === "CAJA" && !p && item.quantity != null) warnings.push(`La cantidad de ${nombre} viene en cajas: conviértela a unidades.`);
    rows.push({
      productId: p?.id ?? "",
      lotCode: item.lotCode?.trim().toUpperCase() ?? "",
      expiryDate: vence ? isoDate(vence) : "",
      quantity: unidades != null ? String(unidades) : "",
      source: "LECTURA" as const,
    });
  }
  if (!rows.length) return { error: "No se encontró ningún producto con lote en la foto. Acércate a la etiqueta y vuelve a tomarla." };
  return { rows, warnings };
}

/**
 * Certifica el ingreso con el packing slip: valida cada lote, lo contrasta con
 * la factura y da de alta los lotes en el inventario. Si no cuadra, exige
 * explicar la diferencia y el ingreso queda CON_DIFERENCIAS.
 *
 * D1 no tiene transacciones: antes de escribir se borra lo que haya dejado un
 * intento anterior a medias, así que repetir la acción no duplica inventario.
 */
export async function certificarIngreso(_prev: ReceiptFormState, fd: FormData): Promise<ReceiptFormState> {
  const user = await requireRole(RECEIPT_ROLES);
  const receipt = await prisma.goodsReceipt.findUnique({
    where: { id: texto(fd, "receiptId") },
    include: { lines: { include: { product: { select: { id: true, name: true } } } } },
  });
  if (!receipt) return { error: "El ingreso ya no existe." };
  if (receipt.status !== "POR_RECIBIR") return { error: "Este ingreso ya se recibió o está anulado." };

  const nombres = new Map(receipt.lines.map((l) => [l.productId, l.product.name]));
  const productIds = lista(fd, "lotProductId");
  const codigos = lista(fd, "lotCode");
  const vencimientos = lista(fd, "lotExpiry");
  const cantidades = lista(fd, "lotQuantity");
  const fuentes = lista(fd, "lotSource");
  if (!productIds.length) return { error: "Registra al menos un lote recibido." };

  // Un mismo lote leído en dos fotos se suma en un solo renglón.
  const lotes = new Map<string, { productId: string; lotCode: string; expiryDate: Date; quantity: number; source: string }>();
  for (let i = 0; i < productIds.length; i++) {
    const n = `El lote ${i + 1}`;
    const productId = productIds[i];
    if (!nombres.has(productId)) return { error: `${n} no tiene un producto de la factura.` };
    const nombre = nombres.get(productId)!;
    const lotCode = codigos[i]?.toUpperCase();
    if (!lotCode) return { error: `Falta el número de lote de ${nombre}.` };
    const expiryDate = dateFromIso(vencimientos[i]);
    if (!expiryDate) return { error: `Falta el vencimiento del lote ${lotCode} de ${nombre}.` };
    if (daysUntil(expiryDate) < 0) return { error: `El lote ${lotCode} de ${nombre} está vencido: no se recibe. Quítalo y reclámalo al proveedor.` };
    const quantity = numero(cantidades[i] ?? "");
    if (quantity == null || Number.isNaN(quantity) || !Number.isInteger(quantity) || quantity <= 0) {
      return { error: `La cantidad del lote ${lotCode} de ${nombre} debe ser un entero mayor que cero.` };
    }
    const key = `${productId}|${lotCode}|${isoDate(expiryDate)}`;
    const previo = lotes.get(key);
    if (previo) previo.quantity += quantity;
    else lotes.set(key, { productId, lotCode, expiryDate, quantity, source: fuentes[i] === "LECTURA" ? "LECTURA" : "MANUAL" });
  }

  const cuadre = reconcile(receipt.lines, [...lotes.values()]);
  const cuadra = matches(cuadre);
  const receivedNotes = opcional(fd, "receivedNotes");
  if (!cuadra && !receivedNotes) return { error: "Lo recibido no cuadra con la factura: explica la diferencia antes de dar de alta el ingreso." };

  // Costo del lote: el promedio facturado del producto.
  const costo = new Map<string, number>();
  for (const r of cuadre) {
    const ls = receipt.lines.filter((l) => l.productId === r.productId);
    const unidades = ls.reduce((s, l) => s + l.quantity, 0);
    costo.set(r.productId, unidades ? ls.reduce((s, l) => s + l.quantity * l.unitCost, 0) / unidades : 0);
  }

  await prisma.inventoryLot.deleteMany({ where: { receiptId: receipt.id } });
  await prisma.goodsReceiptLot.deleteMany({ where: { receiptId: receipt.id } });
  const ahora = new Date();
  await prisma.goodsReceiptLot.createMany({ data: [...lotes.values()].map((l) => ({ ...l, receiptId: receipt.id })) });
  await prisma.inventoryLot.createMany({
    data: [...lotes.values()].map((l) => ({
      lotCode: l.lotCode,
      productId: l.productId,
      warehouseId: receipt.warehouseId,
      quantity: l.quantity,
      unitCost: Math.round((costo.get(l.productId) ?? 0) * 100) / 100,
      expiryDate: l.expiryDate,
      receivedAt: ahora,
      receiptId: receipt.id,
    })),
  });
  await prisma.goodsReceipt.update({
    where: { id: receipt.id },
    data: { status: cuadra ? "RECIBIDO" : "CON_DIFERENCIAS", receivedAt: ahora, receivedById: user.id, receivedNotes },
  });

  revalidarBodega();
  const cortos = [...lotes.values()].filter((l) => daysUntil(l.expiryDate) <= SHORT_EXPIRY_DAYS).length;
  return {
    ok: `${plural(lotes.size, "lote")} en bodega${cuadra ? "" : " con diferencias contra la factura"}.${cortos ? ` ${plural(cortos, "lote")} vence en ${SHORT_EXPIRY_DAYS} días o menos.` : ""}`,
  };
}
