import "server-only";
import ExcelJS from "exceljs";
import { prisma } from "./prisma";
import { cellText, norm } from "./store-import";

/**
 * Estado de resultados de la contabilidad, mes a mes y por cuenta del PUC.
 *
 * La contabilidad lo entrega con su propio orden de grupos; aquí se rearma a
 * partir del código de cada cuenta, con los mismos grupos y subtotales del
 * reporte que se lleva hoy en la hoja, para que las cifras se puedan cruzar
 * línea por línea. Las cuentas de balance (clases 1 a 3) no entran.
 *
 * Hoy llega por archivo; cuando se lea de Siigo, el adaptador entregará estas
 * mismas filas (`ParsedLine`) y todo lo demás se reutiliza.
 */

export const GROUPS = [
  { key: "INGRESOS", label: "Ingresos de actividades ordinarias" },
  { key: "COSTO", label: "Costo de ventas" },
  { key: "OTROS_INGRESOS", label: "Otros ingresos" },
  { key: "PERSONAL", label: "Gastos de administración (personal)" },
  { key: "OTROS_GASTOS", label: "Otros gastos" },
  { key: "FINANCIEROS", label: "Gastos financieros" },
  { key: "IMPUESTOS", label: "Ingreso (gasto) por impuestos" },
] as const;

export type GroupKey = (typeof GROUPS)[number]["key"];

/** Grupo de una cuenta por su código PUC; null si es de balance y no va al estado. */
export function groupOf(code: string): GroupKey | null {
  if (code.startsWith("41")) return "INGRESOS";
  if (code.startsWith("4")) return "OTROS_INGRESOS";
  if (code.startsWith("6") || code.startsWith("7")) return "COSTO";
  if (code.startsWith("5105") || code.startsWith("5205")) return "PERSONAL";
  // 5115 es impuestos de administración (industria y comercio, predial…).
  if (code.startsWith("5115") || code.startsWith("54")) return "IMPUESTOS";
  if (code.startsWith("53")) return "FINANCIEROS";
  if (code.startsWith("5")) return "OTROS_GASTOS";
  return null;
}

export type Totals = Record<GroupKey, number> & {
  grossProfit: number;
  beforeFinancial: number;
  beforeTax: number;
  net: number;
};

/** Subtotales del estado a partir de lo que suma cada grupo. */
export function totalsOf(byGroup: Partial<Record<GroupKey, number>>): Totals {
  const g = Object.fromEntries(GROUPS.map((x) => [x.key, byGroup[x.key] ?? 0])) as Record<GroupKey, number>;
  const grossProfit = g.INGRESOS - g.COSTO;
  const beforeFinancial = grossProfit + g.OTROS_INGRESOS - g.PERSONAL - g.OTROS_GASTOS;
  const beforeTax = beforeFinancial - g.FINANCIEROS;
  return { ...g, grossProfit, beforeFinancial, beforeTax, net: beforeTax - g.IMPUESTOS };
}

/* ─────────────────────────────  Lectura del Excel  ───────────────────────── */

const MONTHS = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

/** «ENERO», «Enero 2026», «SEPT»: el mes y, si viene, el año. */
function monthOf(text: string): { month: number; year: number | null } | null {
  const t = norm(text);
  const m = t.match(/^([A-Z]+)\.?(?:\s+(?:DE\s+)?(\d{4}))?$/);
  if (!m) return null;
  const month = MONTHS.findIndex((name) => m[1].length >= 3 && name.startsWith(m[1]));
  return month < 0 ? null : { month, year: m[2] ? Number(m[2]) : null };
}

/** Cifras como número de Excel o como texto colombiano: «-5.791.016,00», «(1.234,50)». */
function amountOf(v: ExcelJS.CellValue): number | null {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "result" in v && typeof v.result === "number") return v.result;
  let t = cellText(v).replace(/[$\s]/g, "");
  if (!t) return null;
  const negative = /^\(.*\)$/.test(t) || t.startsWith("-");
  t = t.replace(/[()-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

export type ParsedLine = { period: string; accountCode: string; accountName: string; amount: number };

export type StatementPlan = {
  sheet: string;
  lines: ParsedLine[];
  periods: string[];
  accounts: number;
  /** Cuentas que no son de resultados y se dejaron fuera. */
  skipped: string[];
  totals: { period: string; totals: Totals }[];
};

const ACCOUNT = /^(\d{4,10})\s*-\s*(.+)$/;

/**
 * Busca la fila «Nombre» y, encima de ella, los meses. Cada mes ocupa dos
 * columnas (valor y % sobre ingresos); el valor está en la primera.
 */
export async function planStatement(buffer: ArrayBuffer, year: number): Promise<StatementPlan> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  for (const ws of wb.worksheets) {
    let headerRow = 0;
    let nameCol = 0;
    ws.eachRow((row, r) => {
      if (headerRow) return;
      row.eachCell((cell, c) => {
        if (!headerRow && norm(cellText(cell.value)) === "NOMBRE") {
          headerRow = r;
          nameCol = c;
        }
      });
    });
    if (!headerRow) continue;

    const columns = new Map<number, string>();
    for (let r = Math.max(1, headerRow - 2); r <= headerRow; r++) {
      ws.getRow(r).eachCell((cell, c) => {
        // Una celda combinada repite el valor en cada columna: sólo cuenta la primera.
        if (cell.isMerged && cell.master.address !== cell.address) return;
        const m = monthOf(cellText(cell.value));
        if (m) columns.set(c, `${m.year ?? year}-${String(m.month + 1).padStart(2, "0")}`);
      });
    }
    if (!columns.size) continue;

    const lines: ParsedLine[] = [];
    const skipped = new Set<string>();
    const accounts = new Set<string>();
    ws.eachRow((row, r) => {
      if (r <= headerRow) return;
      const match = cellText(row.getCell(nameCol).value).trim().match(ACCOUNT);
      if (!match) return;
      const [, code, name] = match;
      if (!groupOf(code)) {
        skipped.add(`${code} - ${name.trim()}`);
        return;
      }
      for (const [c, period] of columns) {
        const amount = amountOf(row.getCell(c).value);
        if (amount == null || amount === 0) continue;
        lines.push({ period, accountCode: code, accountName: name.trim(), amount });
        accounts.add(code);
      }
    });

    const periods = [...new Set(columns.values())].sort();
    const totals = periods.map((period) => {
      const byGroup: Partial<Record<GroupKey, number>> = {};
      for (const l of lines) {
        if (l.period !== period) continue;
        const g = groupOf(l.accountCode)!;
        byGroup[g] = (byGroup[g] ?? 0) + l.amount;
      }
      return { period, totals: totalsOf(byGroup) };
    });
    return { sheet: ws.name, lines, periods, accounts: accounts.size, skipped: [...skipped], totals };
  }
  throw new Error("No encontré la fila «Nombre» con los meses encima. Sube el estado de resultados tal como sale de la hoja.");
}

/** Reemplaza completos los meses que trae el archivo: corregir es volver a subirlo. */
export async function applyStatement(plan: StatementPlan) {
  const periods = plan.periods.filter((p) => plan.lines.some((l) => l.period === p));
  await prisma.incomeStatementLine.deleteMany({ where: { period: { in: periods } } });
  await prisma.incomeStatementLine.createMany({ data: plan.lines.map((l) => ({ ...l, source: "ARCHIVO" })) });
  return periods;
}

/* ─────────────────────────────  Consulta  ───────────────────────────────── */

export type StatementAccount = { code: string; name: string; group: GroupKey; amounts: Map<string, number>; total: number };

/** El estado de un año: cuentas con su valor por mes y los subtotales de cada mes. */
export async function statementFor(year: number) {
  const rows = await prisma.incomeStatementLine.findMany({
    where: { period: { gte: `${year}-01`, lte: `${year}-12` } },
    select: { period: true, accountCode: true, accountName: true, amount: true },
    orderBy: { accountCode: "asc" },
  });
  const periods = [...new Set(rows.map((r) => r.period))].sort();
  const accounts = new Map<string, StatementAccount>();
  const byPeriod = new Map<string, Partial<Record<GroupKey, number>>>(periods.map((p) => [p, {}]));
  const yearGroups: Partial<Record<GroupKey, number>> = {};
  for (const r of rows) {
    const group = groupOf(r.accountCode);
    if (!group) continue;
    const a = accounts.get(r.accountCode) ?? { code: r.accountCode, name: r.accountName, group, amounts: new Map(), total: 0 };
    a.amounts.set(r.period, (a.amounts.get(r.period) ?? 0) + r.amount);
    a.total += r.amount;
    accounts.set(r.accountCode, a);
    const g = byPeriod.get(r.period)!;
    g[group] = (g[group] ?? 0) + r.amount;
    yearGroups[group] = (yearGroups[group] ?? 0) + r.amount;
  }
  return {
    periods,
    accounts: [...accounts.values()],
    totals: new Map(periods.map((p) => [p, totalsOf(byPeriod.get(p)!)])),
    yearTotals: totalsOf(yearGroups),
  };
}

/** Años con estado cargado, del más reciente al más antiguo. */
export async function statementYears() {
  const rows = await prisma.incomeStatementLine.findMany({ select: { period: true }, distinct: ["period"] });
  return [...new Set(rows.map((r) => Number(r.period.slice(0, 4))))].sort((a, b) => b - a);
}
