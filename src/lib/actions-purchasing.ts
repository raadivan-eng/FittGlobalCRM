"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { PURCHASE_ROLES, requireRole } from "./auth";
import { forecastPeriods } from "./purchase-plan";

const texto = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim();

/** «1.200» o «1200» → entero; vacío → null; basura o negativo → NaN. */
function entero(raw: string) {
  const limpio = raw.replace(/[^\d]/g, "");
  if (!raw.trim()) return null;
  const v = Number(limpio);
  return limpio && Number.isInteger(v) && v >= 0 ? v : NaN;
}

const esConflictoUnico = (e: unknown) => (e as { code?: string })?.code === "P2002";
const DAY = 86_400_000;

/** El forecast de compras depende de las órdenes, y la ficha del proveedor también las muestra. */
function revalidarCompras(supplierId?: string) {
  revalidatePath("/compras");
  revalidatePath("/ordenes-compra", "layout");
  if (supplierId) revalidatePath(`/proveedores/${supplierId}`);
}

/** Consecutivo OC-00001. Si dos órdenes se crean a la vez, el índice único decide y se reintenta. */
async function siguienteCodigo(intento: number) {
  const total = await prisma.purchaseOrder.count();
  return `OC-${String(total + 1 + intento).padStart(5, "0")}`;
}

/**
 * Fija la demanda mensual de un SKU para los meses que mira el forecast de
 * compras. Se guarda como forecast por producto —el mismo que ve el forecast de
 * ventas—, con el monto valorizado a precio de lista. Vacío lo borra y el SKU
 * vuelve a planearse con lo vendido.
 */
export async function guardarDemandaProducto(formData: FormData) {
  const user = await requireRole(PURCHASE_ROLES);

  const productId = texto(formData, "productId");
  const units = entero(texto(formData, "units"));
  if (!productId || Number.isNaN(units)) return;

  const product = await prisma.product.findUnique({ where: { id: productId }, select: { unitPrice: true } });
  if (!product) return;

  const periods = forecastPeriods();
  const existing = await prisma.forecast.findMany({ where: { productId, companyId: null, period: { in: periods } }, select: { id: true, period: true } });

  if (units == null) {
    if (existing.length) await prisma.forecast.deleteMany({ where: { id: { in: existing.map((e) => e.id) } } });
  } else {
    // Sin índice único sobre (period, productId): se actualiza lo que hay y se crea lo que falta.
    const amount = Math.round(units * product.unitPrice * 100) / 100;
    if (existing.length) await prisma.forecast.updateMany({ where: { id: { in: existing.map((e) => e.id) } }, data: { units, amount, createdById: user.id } });
    const missing = periods.filter((p) => !existing.some((e) => e.period === p));
    if (missing.length) await prisma.forecast.createMany({ data: missing.map((period) => ({ period, productId, units, amount, createdById: user.id })) });
  }

  revalidatePath("/compras");
  revalidatePath("/forecast");
}

/**
 * Crea una orden en borrador por proveedor con los SKU marcados en el forecast
 * de compras. El costo y los tiempos se leen otra vez de las condiciones
 * vigentes: el formulario sólo dice qué SKU, a quién y cuánto.
 */
export async function generarOrdenesCompra(formData: FormData) {
  const user = await requireRole(PURCHASE_ROLES);

  const pedidos = formData
    .getAll("item")
    .map(String)
    .map((productId) => ({
      productId,
      supplierId: texto(formData, `supplier-${productId}`),
      quantity: entero(texto(formData, `qty-${productId}`)),
      suggested: entero(texto(formData, `suggested-${productId}`)) ?? 0,
    }))
    .filter((p): p is typeof p & { quantity: number } => !!p.supplierId && typeof p.quantity === "number" && p.quantity > 0);
  if (!pedidos.length) return;

  const condiciones = await prisma.supplierProduct.findMany({
    where: { OR: pedidos.map((p) => ({ supplierId: p.supplierId, productId: p.productId })) },
    select: { supplierId: true, productId: true, unitCost: true, productionLeadDays: true, transitDays: true },
  });

  const porProveedor = new Map<string, { productId: string; quantity: number; suggestedQty: number; unitCost: number; leadDays: number }[]>();
  for (const p of pedidos) {
    const c = condiciones.find((x) => x.supplierId === p.supplierId && x.productId === p.productId);
    if (!c) continue;
    const lineas = porProveedor.get(p.supplierId) ?? porProveedor.set(p.supplierId, []).get(p.supplierId)!;
    lineas.push({ productId: p.productId, quantity: p.quantity, suggestedQty: Number.isNaN(p.suggested) ? 0 : p.suggested, unitCost: c.unitCost, leadDays: c.productionLeadDays + c.transitDays });
  }

  for (const [supplierId, lines] of porProveedor) {
    for (let intento = 0; ; intento++) {
      try {
        await prisma.purchaseOrder.create({
          data: { code: await siguienteCodigo(intento), supplierId, createdById: user.id, notes: "Generada desde el forecast de compras", lines: { create: lines } },
        });
        break;
      } catch (e) {
        if (!esConflictoUnico(e) || intento >= 4) throw e;
      }
    }
  }

  revalidarCompras();
  redirect(porProveedor.size ? "/ordenes-compra?estado=BORRADOR" : "/compras");
}

async function ordenEn(id: string, estados: string[]) {
  const order = id ? await prisma.purchaseOrder.findUnique({ where: { id }, select: { id: true, status: true, supplierId: true } }) : null;
  return order && estados.includes(order.status) ? order : null;
}

/**
 * Aplica las cantidades y la nota del formulario del borrador; un renglón en
 * cero sale de la orden. Repetirlo deja lo mismo, así que es seguro en D1.
 */
async function aplicarCambios(orderId: string, formData: FormData) {
  const lines = await prisma.purchaseOrderLine.findMany({ where: { orderId }, select: { id: true, quantity: true } });
  for (const l of lines) {
    const q = entero(texto(formData, `qty-${l.id}`));
    if (q == null || Number.isNaN(q) || q === l.quantity) continue;
    if (q === 0) await prisma.purchaseOrderLine.delete({ where: { id: l.id } });
    else await prisma.purchaseOrderLine.update({ where: { id: l.id }, data: { quantity: q } });
  }
  if (formData.has("notes")) await prisma.purchaseOrder.update({ where: { id: orderId }, data: { notes: texto(formData, "notes") || null } });
}

export async function guardarCantidadesOrden(formData: FormData) {
  await requireRole(PURCHASE_ROLES);
  const order = await ordenEn(texto(formData, "orderId"), ["BORRADOR"]);
  if (!order) return;
  await aplicarCambios(order.id, formData);
  revalidarCompras(order.supplierId);
}

/**
 * Emite el borrador: desde hoy cuenta como mercancía en camino, y cada renglón
 * queda con su llegada prevista según el lead time con que se pidió.
 */
export async function emitirOrdenCompra(formData: FormData) {
  await requireRole(PURCHASE_ROLES);
  const order = await ordenEn(texto(formData, "orderId"), ["BORRADOR"]);
  if (!order) return;
  // Se emite con lo que haya en pantalla, aunque no se haya guardado antes.
  await aplicarCambios(order.id, formData);

  const now = new Date();
  const lines = await prisma.purchaseOrderLine.findMany({ where: { orderId: order.id }, select: { id: true, leadDays: true } });
  if (!lines.length) return;
  for (const l of lines) await prisma.purchaseOrderLine.update({ where: { id: l.id }, data: { expectedAt: new Date(now.getTime() + l.leadDays * DAY) } });
  const latest = Math.max(...lines.map((l) => l.leadDays));
  await prisma.purchaseOrder.update({ where: { id: order.id }, data: { status: "EMITIDA", issuedAt: now, expectedAt: new Date(now.getTime() + latest * DAY) } });

  revalidarCompras(order.supplierId);
}

/** La mercancía llegó: deja de contar en camino. El inventario lo da de alta el ingreso de mercancía. */
export async function recibirOrdenCompra(formData: FormData) {
  await requireRole(PURCHASE_ROLES);
  const order = await ordenEn(texto(formData, "orderId"), ["EMITIDA"]);
  if (!order) return;
  await prisma.purchaseOrder.update({ where: { id: order.id }, data: { status: "RECIBIDA", receivedAt: new Date() } });
  revalidarCompras(order.supplierId);
}

export async function anularOrdenCompra(formData: FormData) {
  await requireRole(PURCHASE_ROLES);
  const order = await ordenEn(texto(formData, "orderId"), ["BORRADOR", "EMITIDA"]);
  if (!order) return;
  await prisma.purchaseOrder.update({ where: { id: order.id }, data: { status: "ANULADA" } });
  revalidarCompras(order.supplierId);
}
