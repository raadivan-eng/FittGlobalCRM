import "server-only";
import crypto from "node:crypto";
import ExcelJS from "exceljs";
import { prisma } from "./prisma";
import { cellText, norm } from "./store-import";
import { brandOf } from "./geocoding";

/**
 * Carga del sell-out que publican los portales de las cadenas.
 *
 * Cada portal entrega su propio formato —Farmatodo no trae valor, Olímpica
 * llega por documento de inventario, Colsubsidio repite la fila por cada
 * venta— pero todos dicen lo mismo: qué tienda vendió cuántas unidades de qué
 * producto en qué mes. Las columnas se reconocen por su encabezado, así que da
 * igual el orden, y cada pestaña se asigna a un cliente por la marca de su
 * nombre («LOCATEL» → Breccia Salud).
 *
 * Como en la importación de tiendas, el archivo se lee dos veces —vista previa
 * y confirmación— y ambas pasan por `planSellOutImport`: lo que se escribe es
 * lo que se mostró. Cargar un mes de un cliente reemplaza ese mes completo, así
 * que corregir un reporte es volver a subirlo.
 *
 * Cuando los portales abran su API, el adaptador entregará estas mismas filas
 * (`RawRow`) y todo lo demás —casar, agregar, reemplazar— se reutiliza.
 */

type Field = "month" | "date" | "storeCode" | "storeName" | "ean" | "itemCode" | "description" | "units" | "amount" | "movement";

/** Encabezados de cada portal, ya normalizados (sin tildes, `_` como espacio). */
const HEADERS: [Field, RegExp][] = [
  ["month", /^MES$/],
  ["date", /^FECHA( DE DOCUMENTO| DE VENTA)?$/],
  ["storeCode", /^(TIENDA|CENTRO|COD CENTRO|CODI CENTRO|CODIGO CENTRO|COD TIENDA|CODIGO TIENDA)$/],
  ["storeName", /^(NOMBRE TIENDA|NOMBRE CENTRO|NOMBRE DE LA TIENDA|PUNTO DE VENTA)$/],
  ["ean", /^(UPC|EAN|EAN13|CODIGO EAN|CODIGO EAN\/UPC|CODIGO DE BARRAS)$/],
  ["itemCode", /^(SKU|CODIGO SAP|ARTICULO|MATERIAL|PLU|CODIGO PRODUCTO)$/],
  ["description", /^(DESCRIPCION|DESCRIPCION ITEM|NOMBRE PRODUCTO|TEXTO BREVE DE ARTICULO)$/],
  // Colsubsidio llama «VENTA» a las unidades y «VENTA TOTAL» al valor.
  ["units", /^(UNIDADES|UNIDADES VENDIDAS|CANTIDAD|SUMA DE CANTIDAD TOMA|VENTA)$/],
  ["amount", /^(VENTA NETA|VENTA TOTAL|VALOR|VALOR VENTA|SUMA DE VALORVTA C\/IVA)$/],
  ["movement", /^CLASE DE MOVIMIENTO$/],
];

/** Clase de movimiento SAP que anula una venta (Olímpica): resta en vez de sumar. */
const REVERSAL_MOVEMENTS = new Set(["252"]);

const MONTHS: Record<string, number> = {
  ENERO: 1, ENE: 1, FEBRERO: 2, FEB: 2, MARZO: 3, MAR: 3, ABRIL: 4, ABR: 4, MAYO: 5, MAY: 5, JUNIO: 6, JUN: 6,
  JULIO: 7, JUL: 7, AGOSTO: 8, AGO: 8, SEPTIEMBRE: 9, SETIEMBRE: 9, SEP: 9, SET: 9, OCTUBRE: 10, OCT: 10,
  NOVIEMBRE: 11, NOV: 11, DICIEMBRE: 12, DIC: 12,
};

/** Cuántas tiendas o productos sin reconocer se muestran por pestaña. */
const MAX_UNMATCHED = 40;
/** Filas por INSERT: viajan como un solo parámetro JSON para no gastar el tope de D1. */
const INSERT_BATCH = 1500;

const headerKey = (s: string) => norm(s).replace(/[_.]/g, " ").replace(/\s+/g, " ").trim();
export const codeKey = (s: string) => norm(s).replace(/\s+/g, "");
/** «0123» y «123» son la misma tienda en reportes que pierden los ceros. */
const looseCode = (s: string) => codeKey(s).replace(/^0+(?=\d)/, "");

/** «16.100,00», «16100,00» y «16100.5» → número. */
function parseNumber(raw: string): number | null {
  let s = raw.replace(/[$\s]/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Un EAN sólo sirve con sus dígitos completos: «7.70E+17» es lo que queda cuando Sheets lo redondea. */
function cleanEan(raw: string) {
  const digits = raw.replace(/\s/g, "");
  return /^\d{8,14}$/.test(digits) ? digits.replace(/^0+(?=\d{8})/, "") : "";
}

function parseDate(raw: string): { y: number; m: number } | null {
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { y: Number(m[1]), m: Number(m[2]) };
  m = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return { y: Number(m[3]), m: Number(m[2]) };
  return null;
}

function parseMonth(raw: string): number | null {
  const k = norm(raw).replace(/\.$/, "");
  if (MONTHS[k]) return MONTHS[k];
  const ym = k.match(/^(\d{4})-(\d{1,2})$/);
  if (ym) return Number(ym[2]);
  const n = Number(k);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

const period = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

// ─────────────────────────────  Lectura del Excel  ───────────────────────────

/** Una fila del reporte tal como la entrega el portal, antes de casarla. */
export type RawRow = {
  period: string;
  storeCode: string;
  storeName: string;
  ean: string;
  itemCode: string;
  description: string;
  units: number;
  amount: number | null;
};

type RawSheet = { name: string; rows: RawRow[]; dataRows: number; note?: string };

async function readWorkbook(buffer: ArrayBuffer, year: number): Promise<RawSheet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets: RawSheet[] = [];

  wb.eachSheet((ws) => {
    let columns: Partial<Record<Field, number>> | null = null;
    const rows: RawRow[] = [];
    let dataRows = 0;
    let undated = 0;

    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= row.cellCount; c++) cells.push(cellText(row.getCell(c).value).replace(/\s+/g, " ").trim());

      if (!columns) {
        const header: Partial<Record<Field, number>> = {};
        cells.forEach((text, i) => {
          const key = headerKey(text);
          const match = HEADERS.find(([field, re]) => header[field] == null && re.test(key));
          if (match) header[match[0]] = i;
        });
        const enough = header.storeCode != null && header.units != null && (header.ean != null || header.itemCode != null);
        if (enough) columns = header;
        return;
      }

      const map = columns;
      const get = (f: Field) => (map[f] == null ? "" : (cells[map[f]!] ?? ""));
      const storeCode = get("storeCode");
      const unitsRaw = parseNumber(get("units"));
      if (!storeCode || unitsRaw == null) return;
      dataRows++;

      const date = parseDate(get("date"));
      const month = date?.m ?? parseMonth(get("month"));
      if (!month) {
        undated++;
        return;
      }
      const sign = REVERSAL_MOVEMENTS.has(get("movement")) ? -1 : 1;
      const amount = map.amount == null ? null : parseNumber(get("amount"));

      rows.push({
        period: period(date?.y ?? year, month),
        storeCode,
        storeName: get("storeName"),
        ean: cleanEan(get("ean")),
        itemCode: get("itemCode"),
        description: get("description"),
        units: sign * Math.round(unitsRaw),
        amount: amount == null ? null : sign * amount,
      });
    });

    if (!columns) {
      sheets.push({ name: ws.name, rows: [], dataRows: 0, note: "No tiene columnas de tienda, producto y unidades" });
      return;
    }
    sheets.push({
      name: ws.name,
      rows,
      dataRows,
      note: undated ? `${undated} filas sin mes ni fecha quedaron por fuera` : undefined,
    });
  });

  return sheets;
}

// ──────────────────────────────  Casar y agregar  ────────────────────────────

type Line = { storeId: string; productId: string; period: string; units: number; amount: number | null };

export type UnmatchedStore = { code: string; name: string; rows: number; units: number };
/** `code` ya va normalizado: es la llave de ProductAlias. */
export type UnmatchedProduct = { code: string; ean: string; description: string; rows: number; units: number };

export type SheetPreview = {
  sheet: string;
  dataRows: number;
  note?: string;
  companyId: string | null;
  companyName: string | null;
  /** El cliente salió del nombre de la pestaña, no lo eligió nadie. */
  detected: boolean;
  periods: { period: string; units: number; amount: number | null; stores: number; replaces: number }[];
  matchedRows: number;
  matchedUnits: number;
  skippedRows: number;
  skippedUnits: number;
  unmatchedStores: UnmatchedStore[];
  unmatchedProducts: UnmatchedProduct[];
  /** Hay filas sin reconocer más allá de las listadas. */
  truncated: boolean;
};

export type SellOutPreview = { sheets: SheetPreview[]; year: number };

type SheetPlan = SheetPreview & { lines: Line[]; aliases: { code: string; productId: string; description: string }[] };

export type SellOutPlan = { sheets: SheetPlan[]; year: number; fileName: string };

/** Cliente de cada pestaña: el que eligió la persona o el que comparte marca con el nombre de la pestaña. */
function detectCompany(sheet: string, companies: { id: string; name: string }[]) {
  const key = norm(sheet);
  const brand = brandOf(sheet);
  const hits = companies.filter((c) => (brand && brandOf(c.name) === brand) || norm(c.name) === key || (key.length >= 5 && norm(c.name).includes(key)));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * `assign` fija el cliente de una pestaña («FARMATODO» → id); sin él se detecta.
 * `year` completa las filas que sólo traen el nombre del mes.
 */
export async function planSellOutImport(buffer: ArrayBuffer, fileName: string, opts: { year: number; assign: Record<string, string> }): Promise<SellOutPlan> {
  const raw = await readWorkbook(buffer, opts.year);
  const companies = await prisma.company.findMany({ where: { active: true }, select: { id: true, name: true } });
  const products = await prisma.product.findMany({ select: { id: true, barcode: true } });
  const byEan = new Map(products.filter((p) => p.barcode).map((p) => [cleanEan(p.barcode!), p.id]));
  const current = period(new Date().getFullYear(), new Date().getMonth() + 1);

  const sheets: SheetPlan[] = [];
  for (const s of raw) {
    const chosen = opts.assign[s.name];
    const company = chosen ? (companies.find((c) => c.id === chosen) ?? null) : s.rows.length ? detectCompany(s.name, companies) : null;

    const base: SheetPlan = {
      sheet: s.name,
      dataRows: s.dataRows,
      note: s.note,
      companyId: company?.id ?? null,
      companyName: company?.name ?? null,
      detected: Boolean(company && !chosen),
      periods: [],
      matchedRows: 0,
      matchedUnits: 0,
      skippedRows: 0,
      skippedUnits: 0,
      unmatchedStores: [],
      unmatchedProducts: [],
      truncated: false,
      lines: [],
      aliases: [],
    };
    if (!company || !s.rows.length) {
      sheets.push(base);
      continue;
    }

    const [stores, aliases, existing] = await Promise.all([
      prisma.store.findMany({ where: { companyId: company.id }, select: { id: true, code: true } }),
      prisma.productAlias.findMany({ where: { companyId: company.id }, select: { code: true, productId: true } }),
      prisma.sellOut.groupBy({
        by: ["period"],
        where: { companyId: company.id, period: { in: [...new Set(s.rows.map((r) => r.period))] } },
        _sum: { units: true },
      }),
    ]);
    const storeExact = new Map(stores.map((st) => [codeKey(st.code), st.id]));
    const storeLoose = new Map(stores.map((st) => [looseCode(st.code), st.id]));
    const aliasOf = new Map(aliases.map((a) => [codeKey(a.code), a.productId]));
    const replaced = new Map(existing.map((e) => [e.period, e._sum.units ?? 0]));

    const lines = new Map<string, Line>();
    const missingStores = new Map<string, UnmatchedStore>();
    const missingProducts = new Map<string, UnmatchedProduct>();
    const learned = new Map<string, { code: string; productId: string; description: string }>();

    // Cada fila que casa por EAN enseña el código propio de la cadena: así se
    // reconocen las filas donde el EAN llega dañado, en este archivo y en los
    // siguientes. Se aprende antes de casar para que el orden de las filas no importe.
    for (const r of s.rows) {
      const fromEan = r.ean ? byEan.get(r.ean) : undefined;
      const k = r.itemCode ? codeKey(r.itemCode) : "";
      if (!fromEan || !k || aliasOf.has(k)) continue;
      aliasOf.set(k, fromEan);
      learned.set(k, { code: k, productId: fromEan, description: r.description });
    }

    for (const r of s.rows) {
      if (r.period > current) {
        base.skippedRows++;
        base.skippedUnits += r.units;
        continue;
      }
      const storeId = storeExact.get(codeKey(r.storeCode)) ?? storeLoose.get(looseCode(r.storeCode));
      const productId =
        (r.ean ? byEan.get(r.ean) : undefined) ??
        (r.itemCode ? aliasOf.get(codeKey(r.itemCode)) : undefined) ??
        (r.ean ? aliasOf.get(r.ean) : undefined) ??
        (r.description ? aliasOf.get(codeKey(r.description)) : undefined);

      if (!storeId || !productId) {
        base.skippedRows++;
        base.skippedUnits += r.units;
        if (!storeId) {
          const k = codeKey(r.storeCode);
          const m = missingStores.get(k) ?? { code: r.storeCode, name: r.storeName, rows: 0, units: 0 };
          m.rows++;
          m.units += r.units;
          missingStores.set(k, m);
        }
        if (!productId) {
          // La llave con que se guardará la equivalencia si alguien la fija a mano.
          const code = codeKey(r.itemCode || r.ean || r.description);
          const m = missingProducts.get(code) ?? { code, ean: r.ean, description: r.description, rows: 0, units: 0 };
          m.rows++;
          m.units += r.units;
          missingProducts.set(code, m);
        }
        continue;
      }

      const k = `${storeId}|${productId}|${r.period}`;
      const line = lines.get(k) ?? { storeId, productId, period: r.period, units: 0, amount: null };
      line.units += r.units;
      if (r.amount != null) line.amount = (line.amount ?? 0) + r.amount;
      lines.set(k, line);
      base.matchedRows++;
      base.matchedUnits += r.units;
    }

    // Una devolución mayor que la venta del mes no deja rotación negativa.
    base.lines = [...lines.values()].filter((l) => l.units > 0).map((l) => ({ ...l, amount: l.amount == null ? null : Math.round(l.amount) }));
    base.aliases = [...learned.values()];

    const byPeriod = new Map<string, { units: number; amount: number | null; stores: Set<string> }>();
    for (const l of base.lines) {
      const p = byPeriod.get(l.period) ?? { units: 0, amount: null, stores: new Set<string>() };
      p.units += l.units;
      if (l.amount != null) p.amount = (p.amount ?? 0) + l.amount;
      p.stores.add(l.storeId);
      byPeriod.set(l.period, p);
    }
    base.periods = [...byPeriod.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([p, v]) => ({ period: p, units: v.units, amount: v.amount, stores: v.stores.size, replaces: replaced.get(p) ?? 0 }));

    const sortByUnits = <T extends { units: number }>(list: T[]) => list.sort((a, b) => b.units - a.units);
    base.unmatchedStores = sortByUnits([...missingStores.values()]).slice(0, MAX_UNMATCHED);
    base.unmatchedProducts = sortByUnits([...missingProducts.values()]).slice(0, MAX_UNMATCHED);
    base.truncated = missingStores.size > MAX_UNMATCHED || missingProducts.size > MAX_UNMATCHED;
    sheets.push(base);
  }

  return { sheets, year: opts.year, fileName };
}

/** Lo que viaja al navegador: sin las líneas, que sólo se usan al escribir. */
export function previewOf(plan: SellOutPlan): SellOutPreview {
  return {
    year: plan.year,
    sheets: plan.sheets.map(({ lines: _lines, aliases: _aliases, ...rest }) => rest),
  };
}

// ────────────────────────────────  Escritura  ────────────────────────────────

/**
 * Reemplaza, para cada pestaña con cliente, los meses que trae. D1 no tiene
 * transacciones: si se corta a mitad, volver a cargar el archivo deja todo
 * igual, porque cada mes se borra antes de escribirse.
 */
export async function applySellOutImport(plan: SellOutPlan, userId: string) {
  const done: { companyId: string; companyName: string; periods: string[]; units: number; lines: number }[] = [];

  for (const s of plan.sheets) {
    if (!s.companyId || !s.lines.length) continue;
    const periods = s.periods.map((p) => p.period);

    const record = await prisma.sellOutImport.create({
      data: {
        companyId: s.companyId,
        source: "ARCHIVO",
        fileName: plan.fileName,
        sheet: s.sheet,
        periods: periods.join(","),
        rows: s.dataRows,
        units: s.matchedUnits,
        skippedRows: s.skippedRows,
        skippedUnits: s.skippedUnits,
        unmatched: s.unmatchedStores.length || s.unmatchedProducts.length
          ? JSON.stringify({ stores: s.unmatchedStores, products: s.unmatchedProducts })
          : null,
        userId,
      },
    });

    await prisma.sellOut.deleteMany({ where: { companyId: s.companyId, period: { in: periods } } });

    // Un solo parámetro JSON por lote: un createMany partido en filas de a
    // nueve (tope de D1) gastaría cientos de consultas en un mes de Farmatodo.
    for (let i = 0; i < s.lines.length; i += INSERT_BATCH) {
      const batch = s.lines
        .slice(i, i + INSERT_BATCH)
        .map((l) => [crypto.randomUUID(), l.period, s.companyId, l.storeId, l.productId, l.units, l.amount]);
      await prisma.$executeRawUnsafe(
        `INSERT INTO "SellOut" ("id", "period", "companyId", "storeId", "productId", "units", "amount", "source", "importId")
         SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), json_extract(value, '$[3]'),
                json_extract(value, '$[4]'), json_extract(value, '$[5]'), json_extract(value, '$[6]'), 'ARCHIVO', ?
         FROM json_each(?)`,
        record.id,
        JSON.stringify(batch),
      );
    }

    for (const a of s.aliases) {
      await prisma.productAlias.upsert({
        where: { companyId_code: { companyId: s.companyId, code: a.code } },
        create: { companyId: s.companyId, code: a.code, productId: a.productId, description: a.description || null },
        update: {},
      });
    }

    done.push({ companyId: s.companyId, companyName: s.companyName ?? "", periods, units: s.matchedUnits, lines: s.lines.length });
  }

  return done;
}
