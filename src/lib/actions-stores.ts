"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "./auth";
import { prisma } from "./prisma";
import { applyStoreImport, planStoreImport, type ImportPreview } from "./store-import";
import { geocodeBatch, parseCoordinates, type GeocodeBatch } from "./geocoding";
import { notify } from "./notifications";

export type ImportAnalysis = { error?: string; preview?: ImportPreview };
export type ImportResult = {
  error?: string;
  done?: { created: number; updated: number; companies: number; merchandisers: number; assignments: number };
};

const IMPORT_ROLES = ["ADMIN", "SUPERVISOR"];
const MAX_BYTES = 3 * 1024 * 1024;

async function readFile(formData: FormData) {
  const file = formData.get("archivo");
  if (!(file instanceof File) || file.size === 0) throw new Error("Elige el archivo de puntos de venta.");
  if (!/\.xlsx$/i.test(file.name)) throw new Error("El archivo debe ser .xlsx (en Google Sheets: Archivo → Descargar → Microsoft Excel).");
  if (file.size > MAX_BYTES) throw new Error("El archivo supera 3 MB.");
  return { buffer: await file.arrayBuffer(), name: file.name };
}

const message = (e: unknown) => (e instanceof Error ? e.message : "No se pudo leer el archivo.");

/** Lee el archivo y devuelve qué pasaría al importarlo, sin escribir nada. */
export async function analizarImportacionTiendas(formData: FormData): Promise<ImportAnalysis> {
  await requireRole(IMPORT_ROLES);
  try {
    const { buffer, name } = await readFile(formData);
    const { preview } = await planStoreImport(buffer, name);
    if (!preview.totals.stores) return { error: "No se encontró ninguna tienda en el archivo." };
    return { preview };
  } catch (e) {
    return { error: message(e) };
  }
}

/**
 * Aplica la importación. Vuelve a calcular el plan desde el archivo para que
 * no viaje estado desde el navegador; todo ocurre en una sola transacción.
 */
export async function importarTiendas(formData: FormData): Promise<ImportResult> {
  const user = await requireRole(IMPORT_ROLES);

  let plan;
  try {
    const { buffer, name } = await readFile(formData);
    plan = await planStoreImport(buffer, name);
  } catch (e) {
    return { error: message(e) };
  }

  const result = await applyStoreImport(plan);
  if (result.created) {
    await notify({
      type: "TIENDA_CREADA",
      title: result.created === 1 ? "La importación creó 1 tienda" : `La importación creó ${result.created} tiendas`,
      body: `${user.name} cargó el maestro de puntos de venta. Las tiendas nuevas quedan pendientes de ubicar.`,
      href: "/tiendas/ubicar",
      exceptUserId: user.id,
    });
  }

  revalidatePath("/tiendas");
  revalidatePath("/clientes");
  revalidatePath("/rutas");
  revalidatePath("/equipo");
  revalidatePath("/", "layout");
  return { done: result };
}

// ───────────────────────────────  Geocodificación  ───────────────────────────

const BATCH_SIZE = 25;

function revalidarUbicaciones() {
  revalidatePath("/tiendas", "layout");
  revalidatePath("/rutas");
}

/**
 * Ubica el siguiente lote de tiendas. El navegador la llama en bucle mientras
 * `remaining` sea mayor que cero; `startedAt` marca el inicio de la corrida
 * para que un reintento no vuelva sobre las tiendas que acaba de procesar.
 */
export async function geocodificarLote(input: { retry: boolean; startedAt: string }): Promise<GeocodeBatch> {
  await requireRole(IMPORT_ROLES);
  const startedAt = new Date(input.startedAt);
  const batch = await geocodeBatch({
    size: BATCH_SIZE,
    retryNotFound: input.retry,
    places: true,
    startedAt: Number.isNaN(startedAt.getTime()) ? new Date() : startedAt,
  });
  if (batch.processed) revalidarUbicaciones();
  return batch;
}

export type ManualLocationState = { error?: string; ok?: boolean };

/** Fija las coordenadas a mano: pegadas desde Google Maps o escritas como «lat, lng». */
export async function ubicarTiendaManual(_prev: ManualLocationState, formData: FormData): Promise<ManualLocationState> {
  await requireRole(IMPORT_ROLES);
  const id = String(formData.get("id") ?? "");
  const coords = parseCoordinates(String(formData.get("coordenadas") ?? ""));
  if (!coords) return { error: "Pega un enlace de Google Maps o escribe «latitud, longitud» dentro de Colombia." };

  await prisma.store.update({
    where: { id },
    data: { ...coords, geoStatus: "MANUAL", geoSource: "MANUAL", geoMatch: "Fijada a mano", geocodedAt: new Date() },
  });
  revalidarUbicaciones();
  return { ok: true };
}

/** Da por buena la ubicación que propuso Google para una tienda en revisión. */
export async function confirmarUbicacion(formData: FormData) {
  await requireRole(IMPORT_ROLES);
  const id = String(formData.get("id") ?? "");
  await prisma.store.updateMany({
    where: { id, geoStatus: "POR_REVISAR", lat: { not: null } },
    data: { geoStatus: "MANUAL" },
  });
  revalidarUbicaciones();
}
