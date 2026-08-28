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
