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
