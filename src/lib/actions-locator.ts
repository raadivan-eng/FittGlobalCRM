"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, requireUser } from "./auth";
import { prisma } from "./prisma";
import { locatorBatch, storeNameFor, type LocatorBatch } from "./store-locator";
import { notify } from "./notifications";

const REVIEW_ROLES = ["ADMIN", "SUPERVISOR"];
const BATCH_SIZE = 3;

function revalidar() {
  revalidatePath("/tiendas", "layout");
  revalidatePath("/rutas");
  revalidatePath("/avisos");
}

/**
 * Corre el siguiente lote de búsquedas. El navegador la llama en bucle mientras
 * `remaining` sea mayor que cero; `startedAt` evita repetir las que ya corrieron.
 */
export async function buscarTiendasLote(input: { startedAt: string }): Promise<LocatorBatch> {
  await requireRole(REVIEW_ROLES);
  const startedAt = new Date(input.startedAt);
  const batch = await locatorBatch({ size: BATCH_SIZE, before: Number.isNaN(startedAt.getTime()) ? new Date() : startedAt });
  if (batch.processed) revalidar();
  return batch;
}

async function pendingCandidate(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  return prisma.storeCandidate.findFirst({ where: { id, status: "NUEVA" }, include: { company: { select: { name: true } } } });
}

/** Da de alta la tienda descubierta, ya ubicada, con el formato habitual de su cadena. */
export async function crearTiendaDescubierta(formData: FormData) {
  const user = await requireRole(REVIEW_ROLES);
  const c = await pendingCandidate(formData);
  if (!c) return;

  const [formats, taken] = await Promise.all([
    prisma.store.groupBy({ by: ["format"], where: { companyId: c.companyId }, _count: true, orderBy: { _count: { format: "desc" } }, take: 1 }),
    prisma.store.count({ where: { companyId: c.companyId, code: { startsWith: "GM-" } } }),
  ]);
  // La cadena no publica el código de la sede nueva: se usa uno provisional que la importación no pisa.
  let n = taken + 1;
  let code = `GM-${String(n).padStart(4, "0")}`;
  while (await prisma.store.findFirst({ where: { companyId: c.companyId, code }, select: { id: true } })) code = `GM-${String(++n).padStart(4, "0")}`;

  const name = storeNameFor(c, c.company.name);
  const store = await prisma.store.create({
    data: {
      code,
      name,
      companyId: c.companyId,
      address: c.address,
      city: c.city,
      zone: c.city,
      format: formats[0]?.format ?? "SUPERMERCADO",
      lat: c.lat,
      lng: c.lng,
      placeId: c.placeId,
      geoStatus: "UBICADA",
      geoSource: "PLACES",
      geoMatch: `${c.name} · ${c.address ?? ""}`,
      geocodedAt: new Date(),
    },
  });
  await prisma.storeCandidate.update({
    where: { id: c.id },
    data: { status: "CREADA", storeId: store.id, reviewedById: user.id, reviewedAt: new Date() },
  });
  await notify({
    type: "TIENDA_CREADA",
    title: `Tienda creada: ${name}`,
    body: `${user.name} la dio de alta desde Google Maps en ${c.city}. Falta asignarle mercaderista.`,
    href: `/tiendas/${store.id}`,
    exceptUserId: user.id,
  });
  revalidar();
}

/** Es una tienda que ya estaba en el maestro: se le pasa el lugar de Google. */
export async function vincularTiendaDescubierta(formData: FormData) {
  const user = await requireRole(REVIEW_ROLES);
  const c = await pendingCandidate(formData);
  const storeId = String(formData.get("storeId") ?? "");
  const store = c && (await prisma.store.findFirst({ where: { id: storeId, companyId: c.companyId }, select: { id: true, lat: true } }));
  if (!c || !store) return;

  await prisma.store.update({
    where: { id: store.id },
    data: {
      placeId: c.placeId,
      // Alguien confirmó que es la misma tienda: la ubicación de Google queda verificada.
      ...(store.lat == null
        ? { lat: c.lat, lng: c.lng, geoStatus: "MANUAL", geoSource: "PLACES", geoMatch: `${c.name} · ${c.address ?? ""}`, geocodedAt: new Date() }
        : {}),
    },
  });
  await prisma.storeCandidate.update({
    where: { id: c.id },
    data: { status: "VINCULADA", storeId: store.id, reviewedById: user.id, reviewedAt: new Date() },
  });
  revalidar();
}

/** No es punto de venta o no se atiende. Queda registrada para no volver a avisarla. */
export async function descartarTiendaDescubierta(formData: FormData) {
  const user = await requireRole(REVIEW_ROLES);
  const c = await pendingCandidate(formData);
  if (!c) return;
  await prisma.storeCandidate.update({ where: { id: c.id }, data: { status: "DESCARTADA", reviewedById: user.id, reviewedAt: new Date() } });
  revalidar();
}

// ──────────────────────────────────  Avisos  ─────────────────────────────────

/** Marca el aviso como leído y lleva a lo que señala. */
export async function abrirAviso(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const n = await prisma.notification.findFirst({ where: { id, userId: user.id }, select: { href: true } });
  if (!n) return;
  await prisma.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
  redirect(n.href ?? "/avisos");
}

export async function marcarAvisosLeidos() {
  const user = await requireUser();
  await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}
