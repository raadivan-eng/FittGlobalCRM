"use server";

import { revalidatePath } from "next/cache";
import { requireSection } from "./auth";
import { applyStatement, planStatement, type Totals } from "./income-statement";

export type StatementPreview = {
  sheet: string;
  accounts: number;
  skipped: string[];
  months: { period: string; lines: number; totals: Totals }[];
};
export type StatementResult = { error?: string; preview?: StatementPreview; done?: string[] };

const MAX_BYTES = 8 * 1024 * 1024;

async function readInput(formData: FormData) {
  const file = formData.get("archivo");
  if (!(file instanceof File) || file.size === 0) throw new Error("Elige el archivo del estado de resultados.");
  if (!/\.xlsx$/i.test(file.name)) throw new Error("El archivo debe ser .xlsx (en Google Sheets: Archivo → Descargar → Microsoft Excel).");
  if (file.size > MAX_BYTES) throw new Error("El archivo supera 8 MB.");
  const year = Number(formData.get("anio")) || new Date().getFullYear();
  return planStatement(await file.arrayBuffer(), year);
}

const message = (e: unknown) => (e instanceof Error ? e.message : "No se pudo leer el archivo.");

/** Lee el archivo y devuelve los totales de cada mes para cruzarlos con la hoja, sin escribir nada. */
export async function analizarResultados(formData: FormData): Promise<StatementResult> {
  await requireSection("gerencia");
  try {
    const plan = await readInput(formData);
    if (!plan.lines.length) return { error: "La hoja tiene meses pero ninguna cuenta de resultados con valor." };
    return {
      preview: {
        sheet: plan.sheet,
        accounts: plan.accounts,
        skipped: plan.skipped,
        months: plan.totals.map((t) => ({ period: t.period, lines: plan.lines.filter((l) => l.period === t.period).length, totals: t.totals })),
      },
    };
  } catch (e) {
    return { error: message(e) };
  }
}

/** Vuelve a leer el archivo —no viaja estado desde el navegador— y reemplaza los meses que trae. */
export async function importarResultados(formData: FormData): Promise<StatementResult> {
  await requireSection("gerencia");
  try {
    const plan = await readInput(formData);
    const done = await applyStatement(plan);
    revalidatePath("/gerencia");
    revalidatePath("/gerencia/resultados");
    return { done };
  } catch (e) {
    return { error: message(e) };
  }
}
