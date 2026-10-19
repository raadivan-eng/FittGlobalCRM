"use server";

import { revalidatePath } from "next/cache";
import { requireRole, TRADE_ROLES } from "./auth";
import { prisma } from "./prisma";
import { applySellOutImport, codeKey, planSellOutImport, previewOf, type SellOutPreview } from "./sell-out-import";

export type SellOutAnalysis = { error?: string; preview?: SellOutPreview };
export type SellOutResult = {
  error?: string;
  done?: { companyName: string; periods: string[]; units: number; lines: number }[];
};

/** El reporte de Farmatodo de un año ronda los 2 MB. */
const MAX_BYTES = 8 * 1024 * 1024;

async function readInput(formData: FormData) {
  const file = formData.get("archivo");
  if (!(file instanceof File) || file.size === 0) throw new Error("Elige el archivo de sell-out.");
  if (!/\.xlsx$/i.test(file.name)) throw new Error("El archivo debe ser .xlsx (en Google Sheets: Archivo → Descargar → Microsoft Excel).");
  if (file.size > MAX_BYTES) throw new Error("El archivo supera 8 MB. Descarga sólo las pestañas o los meses que vas a cargar.");

  const year = Number(formData.get("anio")) || new Date().getFullYear();
  // `cliente:<pestaña>` = id del cliente que la persona eligió para esa pestaña.
  const assign: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("cliente:") && typeof value === "string" && value) assign[key.slice(8)] = value;
  }
  return { buffer: await file.arrayBuffer(), name: file.name, year, assign };
}

const message = (e: unknown) => (e instanceof Error ? e.message : "No se pudo leer el archivo.");

/** Lee el archivo y muestra qué entraría y qué no se reconoce, sin escribir nada. */
export async function analizarSellOut(formData: FormData): Promise<SellOutAnalysis> {
  await requireRole(TRADE_ROLES);
  try {
    const { buffer, name, year, assign } = await readInput(formData);
    const plan = await planSellOutImport(buffer, name, { year, assign });
    if (!plan.sheets.some((s) => s.dataRows > 0)) {
      return { error: "Ninguna pestaña trae columnas de tienda, producto y unidades vendidas." };
    }
    return { preview: previewOf(plan) };
  } catch (e) {
    return { error: message(e) };
  }
}

/** Vuelve a leer el archivo —no viaja estado desde el navegador— y reemplaza los meses que trae. */
export async function importarSellOut(formData: FormData): Promise<SellOutResult> {
  const user = await requireRole(TRADE_ROLES);
  let plan;
  try {
    const { buffer, name, year, assign } = await readInput(formData);
    plan = await planSellOutImport(buffer, name, { year, assign });
  } catch (e) {
    return { error: message(e) };
  }
  if (!plan.sheets.some((s) => s.companyId && s.periods.length)) {
    return { error: "No hay ninguna pestaña con cliente asignado y ventas reconocidas." };
  }

  const done = await applySellOutImport(plan, user.id);
  revalidatePath("/sell-out");
  revalidatePath("/trade", "layout");
  revalidatePath("/tiendas", "layout");
  return { done };
}

/**
 * Fija a mano a qué producto corresponde un código de la cadena que no casó
 * por EAN. Llega como `alias:<companyId>|<código>` = id del producto.
 */
export async function guardarEquivalencias(formData: FormData): Promise<{ error?: string; saved?: number }> {
  await requireRole(TRADE_ROLES);
  const pairs: { companyId: string; code: string; productId: string; description: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("alias:") || typeof value !== "string" || !value) continue;
    const [companyId, code] = key.slice(6).split("|");
    if (!companyId || !code) continue;
    pairs.push({ companyId, code: codeKey(code), productId: value, description: String(formData.get(`desc:${companyId}|${code}`) ?? "") });
  }
  if (!pairs.length) return { error: "Elige al menos un producto." };

  const valid = new Set((await prisma.product.findMany({ where: { id: { in: pairs.map((p) => p.productId) } }, select: { id: true } })).map((p) => p.id));
  let saved = 0;
  for (const p of pairs.filter((x) => valid.has(x.productId))) {
    await prisma.productAlias.upsert({
      where: { companyId_code: { companyId: p.companyId, code: p.code } },
      create: { companyId: p.companyId, code: p.code, productId: p.productId, description: p.description || null },
      update: { productId: p.productId },
    });
    saved++;
  }
  return { saved };
}
