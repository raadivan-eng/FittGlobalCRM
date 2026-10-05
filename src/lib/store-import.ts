import "server-only";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { prisma } from "./prisma";

/**
 * Importación del maestro de puntos de venta desde el Excel que mantiene el
 * equipo («Puntos de Venta Fitt Global SAS»).
 *
 * El archivo se lee dos veces —una para la vista previa y otra al confirmar—
 * y ambas pasan por `planStoreImport`, así lo que se escribe es exactamente lo
 * que se mostró. La hoja manda en los datos de identidad (nombre, dirección,
 * ciudad, GLN, mercaderista); el CRM conserva lo que se trabaja aquí:
 * coordenadas, formato, ABC y frecuencia de visita.
 */

type Field = "code" | "gln" | "company" | "name" | "address" | "city" | "department" | "merchandiser";

/** Orden de columnas de la hoja. Se usa cuando una pestaña no trae encabezados (TAT). */
const DEFAULT_COLUMNS: Field[] = ["code", "gln", "company", "name", "address", "city", "department", "merchandiser"];

const HEADER_MATCHERS: [Field, RegExp][] = [
  ["code", /^COD/],
  ["gln", /EAN|GLN|LOCALIZADOR/],
  ["company", /RAZON SOCIAL|CADENA|CLIENTE/],
  ["name", /NOMBRE/],
  ["address", /DIRECCION/],
  ["city", /CIUDAD|MUNICIPIO/],
  ["department", /DEPARTAMENTO/],
  ["merchandiser", /MERCADERISTA/],
];

/** Pestañas del canal tienda a tienda: clientes independientes, canal tradicional. */
const TRADITIONAL_SHEETS = /^TAT\b/;

/** Variantes de la misma ciudad que trae la hoja. */
const CITY_ALIASES: Record<string, string> = {
  "BOGOTA, D.C.": "BOGOTA D.C.",
  BOGOTA: "BOGOTA D.C.",
  "CARTAGENA DE INDIAS": "CARTAGENA",
  "GUADALAJARA DE BUGA": "BUGA",
  "SANTA FE DE ANTIOQUI": "SANTA FE DE ANTIOQUIA",
};

/**
 * Prefijos de centros que no son punto de venta. Olímpica mezcla en su maestro
 * centros de distribución, plantas, oficinas y canales virtuales.
 */
const NON_STORE_PREFIXES: Record<string, string> = {
  CD: "Centro de distribución",
  CENTRAL: "Centro de distribución",
  CP: "Planta de producción",
  CAP: "Venta al por mayor",
  OFC: "Oficina administrativa",
  SD: "Servicio a domicilio",
  DOMICILIO: "Servicio a domicilio",
  TV: "Tienda virtual",
  TVF: "Tienda virtual",
};

const UNASSIGNED = new Set(["", "SIN ASIGNAR", "NO APLICA"]);

// ─────────────────────────────  Normalización  ───────────────────────────────

/** Llave de comparación: sin tildes, mayúsculas y espacios simples. */
export const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

const SMALL_WORDS = new Set(["de", "del", "la", "las", "los", "el", "y"]);

function titleCase(s: string) {
  return s
    .toLowerCase()
    .split(" ")
    .map((w, i) => {
      if (w === "d.c.") return "D.C.";
      if (i > 0 && SMALL_WORDS.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

const slug = (s: string) => norm(s).replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

const accents = (s: string) => (s.normalize("NFD").match(/[̀-ͯ]/g) ?? []).length;

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if ("richText" in v) return v.richText.map((t) => t.text).join("");
  if ("result" in v) return cellText((v.result ?? null) as ExcelJS.CellValue);
  if ("text" in v) return String(v.text);
  return "";
}

// ─────────────────────────────  Lectura del Excel  ───────────────────────────

type SheetRow = {
  sheet: string;
  line: number;
  traditional: boolean;
} & Record<Field, string>;

export type SheetSummary = { name: string; rows: number; used: boolean; note?: string };

async function readWorkbook(buffer: ArrayBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const rows: SheetRow[] = [];
  const sheets: SheetSummary[] = [];

  wb.eachSheet((ws) => {
    let columns: Partial<Record<Field, number>> | null = null;
    const found: SheetRow[] = [];

    ws.eachRow({ includeEmpty: false }, (row, line) => {
      const cells: string[] = [];
      for (let c = 1; c <= Math.max(row.cellCount, DEFAULT_COLUMNS.length); c++) cells.push(clean(cellText(row.getCell(c).value)));

      // ¿Es una fila de encabezados? Basta con reconocer la mitad de las columnas.
      const header: Partial<Record<Field, number>> = {};
      cells.forEach((text, i) => {
        const key = norm(text);
        const match = HEADER_MATCHERS.find(([field, re]) => header[field] == null && re.test(key));
        if (match) header[match[0]] = i;
      });
      if (Object.keys(header).length >= 4) {
        columns = header;
        return;
      }

      const map = columns ?? Object.fromEntries(DEFAULT_COLUMNS.map((f, i) => [f, i]));
      const get = (f: Field) => (map[f] == null ? "" : (cells[map[f]] ?? ""));
      found.push({
        sheet: ws.name,
        line,
        traditional: TRADITIONAL_SHEETS.test(norm(ws.name)),
        code: get("code"),
        gln: get("gln"),
        company: get("company"),
        name: get("name"),
        address: get("address"),
        city: get("city"),
        department: get("department"),
        merchandiser: get("merchandiser"),
      });
    });

    // Una pestaña sirve si trae cliente y nombre de tienda; «Hoja 2» es sólo una lista de códigos.
    const usable = found.filter((r) => r.company && r.name).length;
    if (usable === 0) {
      sheets.push({ name: ws.name, rows: found.length, used: false, note: "No tiene el formato de puntos de venta" });
      return;
    }
    sheets.push({ name: ws.name, rows: found.length, used: true });
    rows.push(...found);
  });

  return { rows, sheets };
}

// ──────────────────────────────  Reglas de negocio  ──────────────────────────

function exclusionReason(r: SheetRow): string | null {
  if (norm(r.merchandiser) === "NO APLICA") return "Marcada «No aplica» en la hoja";
  const name = norm(r.name);
  if (!name) return "Sin nombre de tienda";
  if (/\bCERRAD/.test(name)) return "Cerrada";
  if (/\bCEDI\b/.test(name)) return "Centro de distribución";
  return NON_STORE_PREFIXES[name.split(" ")[0]] ?? null;
}

function inferFormat(r: SheetRow): string {
  if (r.traditional) return "ESPECIALIZADA";
  const company = norm(r.company);
  const name = norm(r.name);
  const first = name.split(" ")[0];
  if (company.includes("PRICESMART")) return "MAYORISTA";
  if (company.includes("OLIMPICA")) {
    if (first === "SAO") return "HIPERMERCADO";
    if (first === "DO" || first === "SDO") return "FARMACIA";
    return "SUPERMERCADO";
  }
  if (/DROG|FARMA|SALUD|LOCATEL/.test(company) || /^(DROG|DISP|FARMA)/.test(name)) return "FARMACIA";
  return "SUPERMERCADO";
}

/** Ciudad canónica y su versión legible, prefiriendo la variante con tildes. */
function cityResolver(rows: SheetRow[]) {
  const keyOf = (raw: string) => {
    const k = norm(raw);
    return CITY_ALIASES[k] ?? k;
  };
  const best = new Map<string, string>();
  for (const r of rows) {
    if (!r.city) continue;
    const key = keyOf(r.city);
    const candidate = norm(r.city) === key ? r.city : key;
    const current = best.get(key);
    if (!current || accents(candidate) > accents(current)) best.set(key, candidate);
  }
  return (raw: string) => {
    if (!raw) return "Sin ciudad";
    return titleCase(best.get(keyOf(raw)) ?? raw);
  };
}

// ────────────────────────────────  El plan  ──────────────────────────────────

type StoreData = {
  code: string;
  gln: string | null;
  name: string;
  address: string | null;
  city: string;
  department: string | null;
  active: boolean;
  inactiveReason: string | null;
};

type PlannedStore = {
  companyKey: string;
  data: StoreData;
  format: string;
  merchandiserKey: string | null;
  existingId: string | null;
  changes: (keyof StoreData)[];
};

export type ImportPreview = {
  fileName: string;
  sheets: SheetSummary[];
  totals: {
    rows: number;
    stores: number;
    created: number;
    updated: number;
    unchanged: number;
    inactive: number;
    merged: number;
    conflicts: number;
    skipped: number;
    withoutAddress: number;
    withoutCity: number;
  };
  companies: { name: string; stores: number; isNew: boolean; channel: string }[];
  merchandisers: { name: string; stores: number; exists: boolean }[];
  inactiveByReason: { reason: string; count: number }[];
  conflicts: { company: string; code: string; variants: { where: string; name: string; city: string; address: string }[] }[];
  skipped: { where: string; reason: string }[];
  updates: { company: string; code: string; name: string; fields: string[] }[];
};

const FIELD_LABELS: Record<keyof StoreData, string> = {
  code: "código",
  gln: "GLN",
  name: "nombre",
  address: "dirección",
  city: "ciudad",
  department: "departamento",
  active: "estado",
  inactiveReason: "motivo",
};

export type ImportPlan = {
  preview: ImportPreview;
  companies: { key: string; name: string; code: string; existingId: string | null; type: string; channel: string }[];
  merchandisers: { key: string; name: string; existingId: string | null; zone: string }[];
  stores: PlannedStore[];
};

const where = (r: SheetRow) => `${r.sheet} · fila ${r.line}`;

export async function planStoreImport(buffer: ArrayBuffer, fileName: string): Promise<ImportPlan> {
  const { rows, sheets } = await readWorkbook(buffer);
  const cityOf = cityResolver(rows);

  const skipped: ImportPreview["skipped"] = [];
  const valid = rows.filter((r) => {
    const reason = !r.code ? "Sin código de tienda" : !r.company ? "Sin razón social" : null;
    if (reason) skipped.push({ where: where(r), reason });
    return !reason;
  });

  // ── Duplicados: el mismo código dentro del mismo cliente ────────────────────
  const groups = new Map<string, SheetRow[]>();
  for (const r of valid) {
    const key = `${norm(r.company)}|${norm(r.code)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  // Dos filas describen la misma tienda si coinciden nombre y ciudad, y la
  // dirección es igual o falta en alguna de las dos.
  const sameStore = (a: SheetRow, b: SheetRow) =>
    norm(a.name) === norm(b.name) &&
    cityOf(a.city) === cityOf(b.city) &&
    (!a.address || !b.address || norm(a.address) === norm(b.address));
  const filled = (r: SheetRow) => [r.gln, r.address, r.city, r.department].filter(Boolean).length;

  const conflicts: ImportPreview["conflicts"] = [];
  const unique: SheetRow[] = [];
  let merged = 0;

  for (const rawGroup of groups.values()) {
    // La fila más completa primero: es la que se conserva al fusionar.
    const group = [...rawGroup].sort((a, b) => filled(b) - filled(a));
    if (!group.every((r) => sameStore(group[0], r))) {
      // Dos tiendas distintas con el mismo código: no hay forma segura de elegir.
      conflicts.push({
        company: group[0].company,
        code: group[0].code,
        variants: rawGroup.map((r) => ({ where: where(r), name: r.name, city: cityOf(r.city), address: r.address })),
      });
      continue;
    }
    merged += group.length - 1;
    // Fila repetida: se queda la primera, con el mercaderista de la que lo tenga.
    const withMerch = group.find((r) => !UNASSIGNED.has(norm(r.merchandiser)));
    unique.push({ ...group[0], merchandiser: withMerch?.merchandiser ?? group[0].merchandiser });
  }

  // ── Clientes ────────────────────────────────────────────────────────────────
  const existingCompanies = await prisma.company.findMany({ select: { id: true, name: true, code: true } });
  const companyByKey = new Map<string, { id: string; name: string }>();
  for (const c of existingCompanies) {
    companyByKey.set(norm(c.name), c);
    companyByKey.set(norm(c.code), c);
  }

  const companyRows = new Map<string, SheetRow[]>();
  for (const r of unique) {
    const key = norm(r.company);
    companyRows.set(key, [...(companyRows.get(key) ?? []), r]);
  }

  const companies: ImportPlan["companies"] = [...companyRows.entries()].map(([key, list]) => {
    const existing = companyByKey.get(key) ?? companyByKey.get(slug(list[0].company));
    const traditional = list.every((r) => r.traditional);
    return {
      key,
      name: list[0].company,
      code: slug(list[0].company),
      existingId: existing?.id ?? null,
      type: list.length >= 5 ? "CADENA" : "INDEPENDIENTE",
      channel: traditional ? "TRADICIONAL" : "MODERNO",
    };
  });

  // ── Mercaderistas ──────────────────────────────────────────────────────────
  const users = await prisma.user.findMany({ select: { id: true, name: true, role: true } });
  const userByName = new Map<string, string>();
  // Si hay homónimos, gana el que ya tiene rol de mercaderista.
  const isMerch = (u: { role: string }) => Number(u.role === "MERCADERISTA");
  for (const u of [...users].sort((a, b) => isMerch(a) - isMerch(b))) userByName.set(norm(u.name), u.id);

  const merchRows = new Map<string, SheetRow[]>();
  for (const r of unique) {
    const key = norm(r.merchandiser);
    if (UNASSIGNED.has(key) || exclusionReason(r)) continue;
    merchRows.set(key, [...(merchRows.get(key) ?? []), r]);
  }

  const merchandisers: ImportPlan["merchandisers"] = [...merchRows.entries()].map(([key, list]) => {
    const cities = new Map<string, number>();
    for (const r of list) cities.set(cityOf(r.city), (cities.get(cityOf(r.city)) ?? 0) + 1);
    const zone = [...cities.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return { key, name: titleCase(clean(list[0].merchandiser)), existingId: userByName.get(key) ?? null, zone };
  });

  // ── Tiendas: nuevas, con cambios o iguales ─────────────────────────────────
  const existingIds = companies.flatMap((c) => (c.existingId ? [c.existingId] : []));
  const existingStores = existingIds.length
    ? await prisma.store.findMany({
        where: { companyId: { in: existingIds } },
        select: { id: true, companyId: true, code: true, gln: true, name: true, address: true, city: true, department: true, active: true, inactiveReason: true },
      })
    : [];
  const storeByKey = new Map(existingStores.map((s) => [`${s.companyId}|${norm(s.code)}`, s]));
  const companyIdByKey = new Map(companies.map((c) => [c.key, c.existingId]));

  const stores: PlannedStore[] = unique.map((r) => {
    const reason = exclusionReason(r);
    const gln = /^\d{13}$/.test(r.gln) ? r.gln : null;
    const department = r.department ? titleCase(r.department) : null;
    const data: StoreData = {
      code: r.code,
      gln,
      name: r.name || r.code,
      address: r.address || null,
      city: cityOf(r.city),
      department,
      active: !reason,
      inactiveReason: reason,
    };

    const companyId = companyIdByKey.get(norm(r.company));
    const existing = companyId ? storeByKey.get(`${companyId}|${norm(r.code)}`) : undefined;
    const changes = existing
      ? (Object.keys(data) as (keyof StoreData)[]).filter((k) => k !== "code" && (existing[k] ?? null) !== data[k])
      : [];

    const merchKey = norm(r.merchandiser);
    return {
      companyKey: norm(r.company),
      data,
      format: inferFormat(r),
      merchandiserKey: !reason && !UNASSIGNED.has(merchKey) ? merchKey : null,
      existingId: existing?.id ?? null,
      changes,
    };
  });

  // ── Resumen para la vista previa ───────────────────────────────────────────
  const inactiveByReason = new Map<string, number>();
  for (const s of stores) {
    if (s.data.inactiveReason) inactiveByReason.set(s.data.inactiveReason, (inactiveByReason.get(s.data.inactiveReason) ?? 0) + 1);
  }
  const companyName = new Map(companies.map((c) => [c.key, c.name]));

  const preview: ImportPreview = {
    fileName,
    sheets,
    totals: {
      rows: rows.length,
      stores: stores.length,
      created: stores.filter((s) => !s.existingId).length,
      updated: stores.filter((s) => s.existingId && s.changes.length).length,
      unchanged: stores.filter((s) => s.existingId && !s.changes.length).length,
      inactive: stores.filter((s) => !s.data.active).length,
      merged,
      conflicts: conflicts.length,
      skipped: skipped.length,
      withoutAddress: stores.filter((s) => s.data.active && !s.data.address).length,
      withoutCity: stores.filter((s) => s.data.city === "Sin ciudad").length,
    },
    companies: companies
      .map((c) => ({ name: c.name, stores: companyRows.get(c.key)?.length ?? 0, isNew: !c.existingId, channel: c.channel }))
      .sort((a, b) => b.stores - a.stores),
    merchandisers: merchandisers
      .map((m) => ({ name: m.name, stores: merchRows.get(m.key)?.length ?? 0, exists: !!m.existingId }))
      .sort((a, b) => b.stores - a.stores),
    inactiveByReason: [...inactiveByReason.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    conflicts,
    skipped: skipped.slice(0, 30),
    updates: stores
      .filter((s) => s.existingId && s.changes.length)
      .slice(0, 30)
      .map((s) => ({
        company: companyName.get(s.companyKey) ?? "",
        code: s.data.code,
        name: s.data.name,
        fields: s.changes.map((k) => FIELD_LABELS[k]),
      })),
  };

  return { preview, companies, merchandisers, stores };
}

/**
 * Escribe el plan. Sin control de permisos: quien la llame (la server action)
 * ya validó el rol.
 *
 * En local es una transacción; en D1 (producción) Prisma la ejecuta como
 * consultas sueltas, sin atomicidad. No es grave porque el plan es idempotente:
 * las tiendas se casan por cliente + código, así que si la carga se corta basta
 * con volver a importar el mismo archivo.
 */
export async function applyStoreImport(plan: ImportPlan) {
  return prisma.$transaction(
    async (tx) => {
      // ── Clientes nuevos ──────────────────────────────────────────────────
      const companyId = new Map<string, string>();
      let companies = 0;
      for (const c of plan.companies) {
        if (c.existingId) {
          companyId.set(c.key, c.existingId);
          continue;
        }
        const created = await tx.company.create({
          data: { code: c.code, name: c.name, type: c.type, channel: c.channel },
        });
        companyId.set(c.key, created.id);
        companies++;
      }

      // ── Mercaderistas que la hoja nombra y el portal no conoce ───────────
      // Se crean sin acceso: correo provisional y clave aleatoria que nadie
      // conoce. Aparecen en el planificador de rutas desde ya; para entrar al
      // portal hay que darles correo y clave reales.
      const userId = new Map<string, string>();
      let merchandisers = 0;
      for (const m of plan.merchandisers) {
        if (m.existingId) {
          userId.set(m.key, m.existingId);
          continue;
        }
        const local = norm(m.name).toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
        let email = `${local}@pendiente.local`;
        for (let i = 2; await tx.user.findUnique({ where: { email }, select: { id: true } }); i++) email = `${local}.${i}@pendiente.local`;
        const created = await tx.user.create({
          data: {
            email,
            name: m.name,
            role: "MERCADERISTA",
            zone: m.zone,
            passwordHash: bcrypt.hashSync(crypto.randomBytes(24).toString("base64url"), 10),
          },
        });
        userId.set(m.key, created.id);
        merchandisers++;
      }

      // ── Tiendas ──────────────────────────────────────────────────────────
      const toCreate = plan.stores.filter((s) => !s.existingId);
      if (toCreate.length) {
        await tx.store.createMany({
          data: toCreate.map((s) => ({
            ...s.data,
            companyId: companyId.get(s.companyKey)!,
            zone: s.data.city,
            format: s.format,
          })),
        });
      }

      const toUpdate = plan.stores.filter((s) => s.existingId && s.changes.length);
      for (const s of toUpdate) {
        // Si cambió la dirección, las coordenadas viejas ya no sirven: vuelve a la cola de geocodificación.
        const moved = s.changes.includes("address") || s.changes.includes("city");
        await tx.store.update({
          where: { id: s.existingId! },
          data: {
            ...s.data,
            ...(s.changes.includes("city") ? { zone: s.data.city } : {}),
            ...(moved ? { lat: null, lng: null, geoStatus: "PENDIENTE", geoSource: null, geoMatch: null, geocodedAt: null } : {}),
          },
        });
      }

      // ── Asignaciones: la hoja manda cuando nombra a alguien ─────────────
      // «Sin asignar» no borra nada: puede ser una asignación hecha en el portal.
      const assigned = plan.stores.filter((s) => s.merchandiserKey);
      const ids = await tx.store.findMany({
        where: { companyId: { in: [...new Set(assigned.map((s) => companyId.get(s.companyKey)!))] } },
        select: { id: true, companyId: true, code: true },
      });
      const storeId = new Map(ids.map((s) => [`${s.companyId}|${norm(s.code)}`, s.id]));

      const wanted = assigned.map((s) => ({
        storeId: storeId.get(`${companyId.get(s.companyKey)}|${norm(s.data.code)}`)!,
        userId: userId.get(s.merchandiserKey!)!,
      }));
      const current = await tx.storeAssignment.findMany({
        where: { storeId: { in: wanted.map((w) => w.storeId) } },
        select: { id: true, storeId: true, userId: true },
      });
      const target = new Map(wanted.map((w) => [w.storeId, w.userId]));
      const stale = current.filter((a) => target.get(a.storeId) !== a.userId).map((a) => a.id);
      if (stale.length) await tx.storeAssignment.deleteMany({ where: { id: { in: stale } } });

      const have = new Set(current.map((a) => `${a.storeId}|${a.userId}`));
      const missing = wanted.filter((w) => !have.has(`${w.storeId}|${w.userId}`));
      if (missing.length) await tx.storeAssignment.createMany({ data: missing });

      return {
        created: toCreate.length,
        updated: toUpdate.length,
        companies,
        merchandisers,
        assignments: missing.length,
      };
    },
    { timeout: 120_000 },
  );

}
