/**
 * SQLite no tiene enums nativos, así que los catálogos viven aquí.
 * Cada entrada define la etiqueta visible y el tono con el que se pinta el badge.
 */

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "purple";

export type Option<T extends string = string> = {
  value: T;
  label: string;
  tone: Tone;
  hint?: string;
};

function catalog<T extends string>(options: readonly Option<T>[]) {
  const byValue = new Map(options.map((o) => [o.value, o]));
  return {
    options,
    values: options.map((o) => o.value),
    get: (value: string | null | undefined): Option<T> =>
      byValue.get(value as T) ?? { value: (value ?? "—") as T, label: value ?? "—", tone: "neutral" },
    label: (value: string | null | undefined) => byValue.get(value as T)?.label ?? value ?? "—",
  };
}

export const ROLES = catalog([
  { value: "ADMIN", label: "Administrador", tone: "purple", hint: "Acceso total al portal" },
  { value: "COMERCIAL", label: "Comercial", tone: "info", hint: "Decisiones de venta, forecast y clientes" },
  { value: "SUPERVISOR", label: "Supervisor de campo", tone: "warning", hint: "Planifica rutas y valida novedades" },
  { value: "MERCADERISTA", label: "Mercaderista", tone: "success", hint: "Visita tiendas y reporta góndola" },
] as const);

export const COMPANY_TYPES = catalog([
  { value: "CADENA", label: "Cadena", tone: "info" },
  { value: "MAYORISTA", label: "Mayorista", tone: "purple" },
  { value: "INDEPENDIENTE", label: "Independiente", tone: "neutral" },
  { value: "HORECA", label: "HORECA", tone: "warning" },
] as const);

export const CHANNELS = catalog([
  { value: "MODERNO", label: "Canal moderno", tone: "info" },
  { value: "TRADICIONAL", label: "Canal tradicional", tone: "success" },
  { value: "HORECA", label: "HORECA", tone: "warning" },
  { value: "ECOMMERCE", label: "E-commerce", tone: "purple" },
] as const);

export const TIERS = catalog([
  { value: "A", label: "Tier A", tone: "success", hint: "Top de facturación" },
  { value: "B", label: "Tier B", tone: "info" },
  { value: "C", label: "Tier C", tone: "neutral" },
] as const);

export const STORE_FORMATS = catalog([
  { value: "HIPERMERCADO", label: "Hipermercado", tone: "info" },
  { value: "SUPERMERCADO", label: "Supermercado", tone: "info" },
  { value: "MINIMARKET", label: "Minimarket", tone: "success" },
  { value: "BODEGA", label: "Bodega", tone: "neutral" },
  { value: "FARMACIA", label: "Farmacia", tone: "purple" },
  { value: "MAYORISTA", label: "Mayorista", tone: "warning" },
] as const);

export const VISIT_STATUS = catalog([
  { value: "PLANIFICADA", label: "Planificada", tone: "info" },
  { value: "EN_CURSO", label: "En curso", tone: "warning" },
  { value: "COMPLETADA", label: "Completada", tone: "success" },
  { value: "NO_REALIZADA", label: "No realizada", tone: "danger" },
] as const);

export const INCIDENT_TYPES = catalog([
  { value: "QUIEBRE", label: "Quiebre de stock", tone: "danger" },
  { value: "PRECIO", label: "Precio incorrecto", tone: "warning" },
  { value: "EXHIBICION", label: "Exhibición / planograma", tone: "info" },
  { value: "VENCIMIENTO", label: "Producto por vencer", tone: "danger" },
  { value: "DANIO", label: "Producto dañado", tone: "warning" },
  { value: "COMPETENCIA", label: "Acción de competencia", tone: "purple" },
  { value: "OTRO", label: "Otro", tone: "neutral" },
] as const);

export const SEVERITIES = catalog([
  { value: "CRITICA", label: "Crítica", tone: "danger" },
  { value: "ALTA", label: "Alta", tone: "danger" },
  { value: "MEDIA", label: "Media", tone: "warning" },
  { value: "BAJA", label: "Baja", tone: "neutral" },
] as const);

export const INCIDENT_STATUS = catalog([
  { value: "ABIERTA", label: "Abierta", tone: "danger" },
  { value: "EN_PROCESO", label: "En proceso", tone: "warning" },
  { value: "RESUELTA", label: "Resuelta", tone: "success" },
  { value: "DESCARTADA", label: "Descartada", tone: "neutral" },
] as const);

export const ORDER_STATUS = catalog([
  { value: "BORRADOR", label: "Borrador", tone: "neutral" },
  { value: "CONFIRMADO", label: "Confirmado", tone: "info" },
  { value: "DESPACHADO", label: "Despachado", tone: "warning" },
  { value: "FACTURADO", label: "Facturado", tone: "success" },
  { value: "ANULADO", label: "Anulado", tone: "danger" },
] as const);

export const INVOICE_STATUS = catalog([
  { value: "EMITIDA", label: "Emitida", tone: "info" },
  { value: "PARCIAL", label: "Pago parcial", tone: "warning" },
  { value: "PAGADA", label: "Pagada", tone: "success" },
  { value: "VENCIDA", label: "Vencida", tone: "danger" },
  { value: "ANULADA", label: "Anulada", tone: "neutral" },
] as const);

export const LOT_STATUS = catalog([
  { value: "DISPONIBLE", label: "Disponible", tone: "success" },
  { value: "LIQUIDACION", label: "En liquidación", tone: "warning" },
  { value: "BLOQUEADO", label: "Bloqueado", tone: "danger" },
  { value: "MERMA", label: "Merma", tone: "neutral" },
] as const);

/** Semáforo de vencimiento: la regla de negocio que ordena todo el módulo de inventario. */
export const EXPIRY_BANDS = [
  { key: "VENCIDO", label: "Vencido", tone: "danger" as Tone, maxDays: -1 },
  { key: "CRITICO", label: "≤ 30 días", tone: "danger" as Tone, maxDays: 30 },
  { key: "ALERTA", label: "31 – 60 días", tone: "warning" as Tone, maxDays: 60 },
  { key: "VIGILAR", label: "61 – 90 días", tone: "info" as Tone, maxDays: 90 },
  { key: "SANO", label: "> 90 días", tone: "success" as Tone, maxDays: Infinity },
] as const;

export type ExpiryBandKey = (typeof EXPIRY_BANDS)[number]["key"];

export function expiryBand(daysToExpiry: number) {
  return EXPIRY_BANDS.find((b) => daysToExpiry <= b.maxDays) ?? EXPIRY_BANDS[EXPIRY_BANDS.length - 1];
}
