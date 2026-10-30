export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ""));

export function pagination(raw: string | string[] | undefined, pageSize = 25) {
  const page = Math.max(1, Number(one(raw)) || 1);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function pageCount(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Aplana los searchParams a strings para reconstruir enlaces de paginación. */
export function flatten(sp: Record<string, string | string[] | undefined>) {
  return Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, one(v)]));
}

/** Lee un día `YYYY-MM-DD` de la URL como medianoche local; `null` si no es válido. */
export function parseDay(raw: string | string[] | undefined) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(one(raw));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Lee un filtro de selección múltiple: la URL guarda los valores separados por
 * coma (`?cliente=a,b`). Una coma dentro de un valor viaja escapada (`\\,`),
 * así «Bogotá, D.C.» no se parte en dos. Devuelve una lista vacía si no hay filtro.
 */
export function many(raw: string | string[] | undefined) {
  return splitList(one(raw));
}

export const splitList = (raw: string) =>
  raw
    .split(/(?<!\\),/)
    .map((v) => v.replace(/\\,/g, ",").trim())
    .filter(Boolean);

export const joinList = (values: string[]) => values.map((v) => v.replace(/,/g, "\\,")).join(",");

/** Condición Prisma para un filtro múltiple; `undefined` si no filtra nada. */
export const anyOf = (values: string[]) => (values.length ? { in: values } : undefined);

/**
 * Toda vista de facturación descuenta las notas crédito: es la venta real.
 * `?nc=sin` la muestra emitida, sin descontarlas.
 */
export const netOfCredits = (sp: Record<string, string | string[] | undefined>) => one(sp.nc) !== "sin";
