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
  { value: "ESPECIALIZADA", label: "Tienda especializada", tone: "success", hint: "Naturistas, tiendas fitness y canal tienda a tienda" },
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

export const CONNECTION_STATUS = catalog([
  { value: "CONECTADA", label: "Conectada", tone: "success", hint: "La última prueba contra el proveedor respondió bien" },
  { value: "PENDIENTE", label: "Sin verificar", tone: "warning", hint: "Hay credenciales guardadas que nadie ha probado todavía" },
  { value: "ERROR", label: "Con error", tone: "danger", hint: "El proveedor rechazó las credenciales en la última prueba" },
  { value: "SIN_CONFIGURAR", label: "Sin configurar", tone: "neutral", hint: "Todavía no se han cargado credenciales" },
] as const);

/** Estado de la geocodificación de una tienda. Sin coordenadas no entra a las rutas. */
export const GEO_STATUS = catalog([
  { value: "UBICADA", label: "Ubicada", tone: "success", hint: "Google la encontró con precisión de dirección o por el nombre de la tienda" },
  { value: "MANUAL", label: "Verificada", tone: "success", hint: "Ubicación fijada o confirmada a mano" },
  { value: "POR_REVISAR", label: "Por revisar", tone: "warning", hint: "Hay coordenadas, pero Google no está seguro: conviene confirmarlas" },
  { value: "NO_ENCONTRADA", label: "No encontrada", tone: "danger", hint: "Sin coordenadas: falta dirección o Google no la encontró en la ciudad" },
  { value: "PENDIENTE", label: "Pendiente", tone: "neutral", hint: "Todavía no se ha geocodificado" },
] as const);

/** Resultado de cada entrada de la bitácora de una conexión. */
export const CONNECTION_EVENTS = catalog([
  { value: "OK", label: "Correcto", tone: "success" },
  { value: "FALLO", label: "Fallo", tone: "danger" },
  { value: "INFO", label: "Cambio", tone: "info" },
] as const);

/**
 * Ciclo de vida de una guía. El orden importa: es el que sigue la línea de
 * tiempo y el que se ofrece al registrar un movimiento a mano.
 */
export const SHIPMENT_STATUS = catalog([
  { value: "BORRADOR", label: "Borrador", tone: "neutral", hint: "Preparada en el portal, todavía sin número de guía" },
  { value: "GENERADA", label: "Generada", tone: "info", hint: "La transportadora asignó número; falta que recoja" },
  { value: "RECOGIDA", label: "Recogida", tone: "info", hint: "La transportadora tiene la mercancía" },
  { value: "EN_TRANSITO", label: "En tránsito", tone: "purple", hint: "Viajando entre centros de distribución" },
  { value: "EN_REPARTO", label: "En reparto", tone: "purple", hint: "Salió a entrega en la ciudad de destino" },
  { value: "NOVEDAD", label: "Con novedad", tone: "warning", hint: "Dirección errada, destinatario ausente, rechazo… requiere gestión" },
  { value: "ENTREGADA", label: "Entregada", tone: "success", hint: "Recibida en destino" },
  { value: "DEVUELTA", label: "Devuelta", tone: "danger", hint: "Regresó al remitente sin entregarse" },
  { value: "ANULADA", label: "Anulada", tone: "neutral", hint: "Cancelada antes de despacharse" },
] as const);

/** Estados en los que la guía sigue viva y vale la pena consultarla. */
export const SHIPMENT_ACTIVE = ["GENERADA", "RECOGIDA", "EN_TRANSITO", "EN_REPARTO", "NOVEDAD"] as const;
/** Estados finales: ya no cambian y no se consultan más. */
export const SHIPMENT_CLOSED = ["ENTREGADA", "DEVUELTA", "ANULADA"] as const;

/** Quién originó una guía o un movimiento de su trazabilidad. */
export const SHIPMENT_SOURCE = catalog([
  { value: "API", label: "API", tone: "info", hint: "Lo informó la transportadora por su API" },
  { value: "MANUAL", label: "Manual", tone: "neutral", hint: "Lo registró una persona en el portal" },
  { value: "SISTEMA", label: "Portal", tone: "neutral", hint: "Lo anotó el portal al crear o anular la guía" },
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
