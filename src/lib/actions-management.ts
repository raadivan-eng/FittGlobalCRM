"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { requireSection } from "./auth";
import { applyStatement, planStatement, type Totals } from "./income-statement";
import { BLOCKS, DEFAULT_RUBROS, SOURCES, budgetConfig, knownAccounts, normalizeSettings, rubroOf, yearMonths, type BlockKey, type Rubro, type SourceKey } from "./budget";
import { parseAmount, parsePct } from "./format";

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

/* ─────────────────────────────  Presupuesto  ───────────────────────────── */

export type BudgetResult = { error?: string; saved?: string };

const validYear = (raw: FormDataEntryValue | null) => {
  const year = Number(raw);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null;
};

function revalidateBudget() {
  revalidatePath("/gerencia/presupuesto", "layout");
}

/**
 * Guarda el presupuesto general de un año: una cifra por cuenta y mes. Sólo
 * escribe lo que cambió —crea, actualiza o borra—, así repetirlo no hace daño
 * aunque D1 no tenga transacciones. Una casilla vacía borra ese mes.
 */
export async function guardarPresupuestoGeneral(_prev: BudgetResult, formData: FormData): Promise<BudgetResult> {
  const user = await requireSection("gerencia");
  const year = validYear(formData.get("anio"));
  if (!year) return { error: "Falta el año." };
  const { rubros } = await budgetConfig();
  const codes = [...new Set(formData.getAll("cuenta").map(String))];

  const wanted = new Map<string, { period: string; accountCode: string; accountName: string; amount: number }>();
  for (const code of codes) {
    if (!/^[4-7]\d{0,9}$/.test(code)) return { error: `«${code}» no es una cuenta de resultados (clases 4 a 7 del PUC).` };
    const name = String(formData.get(`nombre-${code}`) ?? "").trim();
    if (!name) return { error: `A la cuenta ${code} le falta el nombre.` };
    const amounts = yearMonths(year).map((m) => ({ period: m.period, amount: parseAmount(String(formData.get(`m-${code}-${m.mm}`) ?? "")) ?? 0 }));
    if (!amounts.some((a) => a.amount !== 0)) continue;
    // Una cuenta sin rubro no suma en ningún lado: se pide asignarla antes de presupuestarla.
    if (!rubroOf(code, rubros)) return { error: `La cuenta ${code} ${name} no cae en ningún rubro: agrégale un prefijo en Configuración.` };
    for (const a of amounts) if (a.amount !== 0) wanted.set(`${a.period}|${code}`, { period: a.period, accountCode: code, accountName: name, amount: a.amount });
  }

  const existing = await prisma.budgetLine.findMany({ where: { period: { gte: `${year}-01`, lte: `${year}-12` } } });
  const byKey = new Map(existing.map((e) => [`${e.period}|${e.accountCode}`, e]));
  const remove = existing.filter((e) => !wanted.has(`${e.period}|${e.accountCode}`)).map((e) => e.id);
  const create = [...wanted.entries()].filter(([k]) => !byKey.has(k)).map(([, w]) => ({ ...w, updatedById: user.id }));
  const update = [...wanted.entries()].filter(([k, w]) => {
    const e = byKey.get(k);
    return e && (e.amount !== w.amount || e.accountName !== w.accountName);
  });

  if (remove.length) await prisma.budgetLine.deleteMany({ where: { id: { in: remove } } });
  if (create.length) await prisma.budgetLine.createMany({ data: create });
  for (const [k, w] of update) await prisma.budgetLine.update({ where: { id: byKey.get(k)!.id }, data: { amount: w.amount, accountName: w.accountName, updatedById: user.id } });

  revalidateBudget();
  return { saved: `Presupuesto ${year} guardado: ${new Set([...wanted.values()].map((w) => w.accountCode)).size} cuentas.` };
}

/**
 * Guarda la participación de cada cliente en el presupuesto de un año: su %
 * base y, si se dio, un % distinto por rubro. Vacío en un rubro vuelve a la
 * base; vacío en la base deja al cliente sin presupuesto.
 */
export async function guardarParticipaciones(_prev: BudgetResult, formData: FormData): Promise<BudgetResult> {
  const user = await requireSection("gerencia");
  const year = validYear(formData.get("anio"));
  if (!year) return { error: "Falta el año." };
  const { rubros } = await budgetConfig();
  const adjustable = rubros.filter((r) => r.source !== "VENTAS");
  const ids = [...new Set(formData.getAll("cliente").map(String))];

  const wanted = new Map<string, { companyId: string; line: string; pct: number }>();
  // Lo que suma cada rubro entre todos: el ajuste del cliente o, sin él, su base.
  const totals = new Map<string, number>();
  for (const companyId of ids) {
    let base = 0;
    for (const line of ["", ...adjustable.map((r) => r.key)]) {
      const pct = parsePct(String(formData.get(`${line || "base"}-${companyId}`) ?? ""));
      if (pct != null && (pct < 0 || pct > 100)) return { error: "Las participaciones van de 0 % a 100 %." };
      if (!line) {
        if (pct == null) break; // sin base el cliente no participa y sus ajustes no aplican
        base = pct;
      }
      if (pct != null) wanted.set(`${companyId}|${line}`, { companyId, line, pct });
      totals.set(line || "base", (totals.get(line || "base") ?? 0) + (pct ?? base));
    }
  }
  const over = [...totals.entries()].find(([, t]) => t > 100.05);
  if (over) {
    const label = over[0] === "base" ? "venta" : (rubros.find((r) => r.key === over[0])?.label ?? over[0]).toLowerCase();
    return { error: `Las participaciones de ${label} suman ${over[1].toFixed(1).replace(".", ",")} %: no pueden pasar de 100 %.` };
  }

  const existing = await prisma.clientShare.findMany({ where: { year } });
  const byKey = new Map(existing.map((e) => [`${e.companyId}|${e.line}`, e]));
  const remove = existing.filter((e) => !wanted.has(`${e.companyId}|${e.line}`)).map((e) => e.id);
  const create = [...wanted.entries()].filter(([k]) => !byKey.has(k)).map(([, w]) => ({ ...w, year, updatedById: user.id }));
  const update = [...wanted.entries()].filter(([k, w]) => byKey.has(k) && byKey.get(k)!.pct !== w.pct);

  if (remove.length) await prisma.clientShare.deleteMany({ where: { id: { in: remove } } });
  if (create.length) await prisma.clientShare.createMany({ data: create });
  for (const [k, w] of update) await prisma.clientShare.update({ where: { id: byKey.get(k)!.id }, data: { pct: w.pct, updatedById: user.id } });

  revalidateBudget();
  const base = totals.get("base") ?? 0;
  return { saved: `Participaciones ${year} guardadas: ${[...wanted.values()].filter((w) => !w.line).length} clientes, ${base.toFixed(1).replace(".", ",")} % de la venta asignada.` };
}

/**
 * Guarda rubros y criterios. Los rubros se validan contra todas las cuentas
 * que se conocen (contabilidad y presupuesto): ninguna puede quedar sin rubro.
 * Las fuentes directas (venta, costo, fletes, trade) van en un solo rubro cada
 * una, porque se medirían dos veces. Quitar un rubro borra los ajustes de
 * participación que tenía.
 */
export async function guardarConfiguracionPresupuesto(_prev: BudgetResult, formData: FormData): Promise<BudgetResult> {
  const user = await requireSection("gerencia");
  const settings = normalizeSettings({
    allocation: formData.get("allocation"),
    creditNotes: formData.get("creditNotes") === "si",
    referenceMonths: formData.get("referenceMonths"),
    spread: formData.get("spread"),
    warnPct: parsePct(String(formData.get("warnPct") ?? "")),
    expenseTolerancePct: parsePct(String(formData.get("expenseTolerancePct") ?? "")),
    defaultPeriod: formData.get("defaultPeriod"),
  });

  const keys = formData.getAll("rubro").map(String);
  const rubros: Rubro[] = [];
  for (const key of keys) {
    const label = String(formData.get(`label-${key}`) ?? "").trim();
    const prefixes = String(formData.get(`prefijos-${key}`) ?? "").split(/[,\s]+/).map((p) => p.trim()).filter(Boolean);
    const block = String(formData.get(`bloque-${key}`) ?? "") as BlockKey;
    const source = String(formData.get(`fuente-${key}`) ?? "") as SourceKey;
    if (!/^[A-Z0-9_]{1,40}$/.test(key)) return { error: `La clave «${key}» no es válida.` };
    if (!label) return { error: "Todos los rubros necesitan nombre." };
    if (!prefixes.length) return { error: `«${label}» necesita al menos un prefijo de cuenta.` };
    const bad = prefixes.find((p) => !/^[4-7]\d{0,9}$/.test(p));
    if (bad) return { error: `«${label}»: el prefijo ${bad} no es de una cuenta de resultados (4 a 7).` };
    if (!BLOCKS.some((b) => b.key === block)) return { error: `«${label}» no tiene ubicación en el estado.` };
    if (!SOURCES.some((s) => s.key === source)) return { error: `«${label}» no tiene forma de medirse.` };
    rubros.push({ key, label, prefixes, block, source });
  }
  if (new Set(keys).size !== keys.length) return { error: "Hay dos rubros con la misma clave: cambia el nombre de uno." };
  const seen = new Map<string, string>();
  for (const r of rubros)
    for (const p of r.prefixes) {
      if (seen.has(p)) return { error: `El prefijo ${p} está en «${seen.get(p)}» y en «${r.label}».` };
      seen.set(p, r.label);
    }
  for (const s of SOURCES.filter((s) => s.key !== "REPARTIDO")) {
    const using = rubros.filter((r) => r.source === s.key);
    if (using.length > 1) return { error: `«${s.label}» sólo puede medir un rubro; la usan ${using.map((r) => `«${r.label}»`).join(" y ")}.` };
  }
  const sales = rubros.find((r) => r.source === "VENTAS");
  if (!sales || sales.block !== "INGRESOS") return { error: "Debe haber un rubro de ingresos medido con la venta facturada: es la base de la participación." };

  const orphans = (await knownAccounts()).filter((a) => !rubroOf(a.code, rubros));
  if (orphans.length) {
    const list = orphans.slice(0, 4).map((a) => `${a.code} ${a.name}`).join(", ");
    return { error: `Quedarían cuentas sin rubro: ${list}${orphans.length > 4 ? ` y ${orphans.length - 4} más` : ""}. Agrégales un prefijo.` };
  }

  // Sin transacciones en D1: cada paso se puede repetir sin daño.
  const removed = (await prisma.budgetRubro.findMany({ select: { key: true } })).map((r) => r.key).filter((k) => !keys.includes(k));
  const currentKeys = new Set(rubros.map((r) => r.key));
  await prisma.clientShare.deleteMany({ where: { line: { notIn: ["", ...currentKeys] } } });
  if (removed.length) await prisma.budgetRubro.deleteMany({ where: { key: { in: removed } } });
  for (const [position, r] of rubros.entries()) {
    const data = { label: r.label, prefixes: r.prefixes.join(","), block: r.block, source: r.source, position };
    await prisma.budgetRubro.upsert({ where: { key: r.key }, create: { key: r.key, ...data }, update: data });
  }
  await prisma.budgetSettings.upsert({ where: { id: "default" }, create: { id: "default", ...settings, updatedById: user.id }, update: { ...settings, updatedById: user.id } });

  revalidateBudget();
  return { saved: `Configuración guardada: ${rubros.length} rubros.` };
}

/** Vuelve a los rubros y criterios de siempre. Los ajustes por rubros que dejan de existir se borran. */
export async function restaurarConfiguracionPresupuesto() {
  await requireSection("gerencia");
  await prisma.clientShare.deleteMany({ where: { line: { notIn: ["", ...DEFAULT_RUBROS.map((r) => r.key)] } } });
  await prisma.budgetRubro.deleteMany({});
  await prisma.budgetSettings.deleteMany({});
  revalidateBudget();
  redirect(`/gerencia/presupuesto/configuracion?restaurado=${Date.now()}`);
}
