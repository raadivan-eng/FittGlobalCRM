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
  { value: "ADMIN", label: "Superadmin", tone: "purple", hint: "Acceso total: usuarios, permisos y conexiones API" },
  { value: "COMERCIAL", label: "Sales", tone: "info", hint: "Leads, clientes, ventas, forecast, reportes, trade y operación en calle" },
  { value: "BASIC", label: "Basic", tone: "neutral", hint: "Consulta de clientes, tiendas, productos, inventario y ventas, sin editar" },
  { value: "SUPERVISOR", label: "Supervisor de campo", tone: "warning", hint: "Planifica rutas, valida novedades y verifica el trade en tienda" },
  { value: "MERCADERISTA", label: "Mercaderista", tone: "success", hint: "Visita tiendas y reporta góndola" },
] as const);

/**
 * Tipo de cliente: qué clase de empresa nos compra. Define cómo se negocia con
 * ella (quién decide, cómo paga, con qué volumen). Es independiente del canal.
 */
export const COMPANY_TYPES = catalog([
  { value: "CADENA", label: "Cadena", tone: "info", hint: "Varios puntos de venta con una central de compras que negocia, codifica y paga por todos. Ej.: Éxito, Olímpica, Farmatodo." },
  { value: "MAYORISTA", label: "Mayorista", tone: "purple", hint: "Compra para revender a otros comercios, no al consumidor final. Ej.: distribuidores y autoservicios mayoristas." },
  { value: "INDEPENDIENTE", label: "Independiente", tone: "neutral", hint: "Uno o pocos puntos de venta donde el dueño decide y compra directo. Ej.: tienda de barrio, minimercado, tienda naturista." },
  { value: "HORECA", label: "HORECA", tone: "warning", hint: "Hoteles, restaurantes y cafés: usan o sirven el producto en su negocio en lugar de exhibirlo para reventa." },
] as const);

/**
 * Canal: por dónde llega el producto al consumidor final. Define cómo se
 * ejecuta en el punto de venta (góndola, mostrador, consumo en sitio o en línea).
 */
export const CHANNELS = catalog([
  { value: "MODERNO", label: "Canal moderno", tone: "info", hint: "Autoservicio organizado: supermercados, hipermercados y droguerías de cadena. Hay góndola, planograma y codificación." },
  { value: "TRADICIONAL", label: "Canal tradicional", tone: "success", hint: "Venta tienda a tienda y por mostrador: tiendas de barrio, minimercados y los distribuidores que las surten." },
  { value: "HORECA", label: "HORECA", tone: "warning", hint: "Consumo fuera del hogar: el producto se sirve o se usa en hoteles, restaurantes, cafés y catering." },
  { value: "ECOMMERCE", label: "E-commerce", tone: "purple", hint: "Venta en línea: tienda web propia del cliente, marketplace o app de domicilios." },
] as const);

export const TIERS = catalog([
  { value: "A", label: "Tier A", tone: "success", hint: "Top de facturación" },
  { value: "B", label: "Tier B", tone: "info" },
  { value: "C", label: "Tier C", tone: "neutral" },
] as const);

/** De dónde sale el forecast de un cliente; no se guarda, se deriva al leer. */
export const FORECAST_SOURCE = catalog([
  { value: "PROMEDIO", label: "Automático", tone: "neutral", hint: "Proyectado con el criterio de forecast vigente" },
  { value: "MANUAL", label: "Manual", tone: "purple", hint: "Monto cargado por el comercial" },
] as const);

/**
 * Estado comercial del cliente; no se guarda, se deriva al leer
 * (clientStatuses). Un inactivo no entra al forecast.
 */
export const CLIENT_STATUS = catalog([
  { value: "ACTIVO", label: "Activo", tone: "success", hint: "Compra con regularidad: entra al forecast" },
  { value: "INACTIVO", label: "Inactivo", tone: "neutral", hint: "Sin compras recientes o inactivado a mano: el forecast lo proyecta en 0" },
] as const);

/** Por qué un cliente está inactivo (ClientInactivity). */
export const CLIENT_INACTIVITY = catalog([
  { value: "SIN_COMPRAS", label: "Sin compras", tone: "neutral", hint: "Lleva los meses del criterio de forecast sin comprar; vuelve a activo con su próxima compra" },
  { value: "MANUAL", label: "Inactivado a mano", tone: "warning", hint: "Sigue inactivo hasta que alguien lo reactive" },
] as const);

/** Cómo se proyecta la base histórica de cada cliente (ForecastCriteria.method). */
export const FORECAST_METHODS = catalog([
  { value: "ANIO_VIGENTE", label: "Promedio del año vigente", tone: "neutral", hint: "Media de los meses cerrados del año. Enero se proyecta con el año que acaba de cerrar." },
  { value: "MOVIL", label: "Promedio móvil", tone: "info", hint: "Media de los últimos N meses cerrados, sin importar el año. Reacciona más rápido a los cambios." },
  { value: "PONDERADO", label: "Promedio ponderado", tone: "purple", hint: "Últimos N meses, con más peso a los recientes: el último cuenta N veces, el más viejo una." },
  { value: "ESTACIONAL", label: "Mismo mes del año anterior", tone: "warning", hint: "Lo que el cliente compró ese mes hace un año. Si no compró o el mes está excluido, usa el promedio móvil." },
] as const);

export const STORE_FORMATS = catalog([
  { value: "HIPERMERCADO", label: "Hipermercado", tone: "info" },
  { value: "SUPERMERCADO", label: "Supermercado", tone: "info" },
  { value: "MINIMARKET", label: "Minimarket", tone: "success" },
  { value: "BODEGA", label: "Bodega", tone: "neutral" },
  { value: "FARMACIA", label: "Farmacia", tone: "purple" },
  { value: "MAYORISTA", label: "Mayorista", tone: "warning" },
  { value: "ESPECIALIZADA", label: "Tienda especializada", tone: "success", hint: "Naturistas, tiendas fitness y canal tienda a tienda" },
  { value: "ECOMMERCE", label: "E-commerce", tone: "purple", hint: "Tienda en línea, marketplace o venta por app" },
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
  { value: "INACTIVO", label: "Inactivo", tone: "neutral", hint: "Módulo apagado: el portal no lo usa" },
] as const);

/** Estado de la geocodificación de una tienda. Sin coordenadas no entra a las rutas. */
export const GEO_STATUS = catalog([
  { value: "UBICADA", label: "Ubicada", tone: "success", hint: "Google la encontró con precisión de dirección o por el nombre de la tienda" },
  { value: "MANUAL", label: "Verificada", tone: "success", hint: "Ubicación fijada o confirmada a mano" },
  { value: "POR_REVISAR", label: "Por revisar", tone: "warning", hint: "Hay coordenadas, pero Google no está seguro: conviene confirmarlas" },
  { value: "NO_ENCONTRADA", label: "No encontrada", tone: "danger", hint: "Sin coordenadas: falta dirección o Google no la encontró en la ciudad" },
  { value: "PENDIENTE", label: "Pendiente", tone: "neutral", hint: "Todavía no se ha geocodificado" },
  { value: "DIGITAL", label: "Digital", tone: "purple", hint: "Tienda en línea: no tiene ubicación física ni entra a rutas" },
] as const);

/** Tienda que el localizador encontró en Google Maps y no estaba en el maestro. */
export const CANDIDATE_STATUS = catalog([
  { value: "NUEVA", label: "Por revisar", tone: "warning", hint: "Está en Google Maps y no en el maestro" },
  { value: "CREADA", label: "Creada", tone: "success", hint: "Se dio de alta como tienda nueva" },
  { value: "VINCULADA", label: "Vinculada", tone: "info", hint: "Era una tienda que ya estaba en el maestro" },
  { value: "DESCARTADA", label: "Descartada", tone: "neutral", hint: "No es punto de venta o no se atiende; no se vuelve a avisar" },
] as const);

/** Avisos de la bandeja del portal. */
export const NOTIFICATION_TYPES = catalog([
  { value: "TIENDA_ENCONTRADA", label: "Tienda encontrada", tone: "warning" },
  { value: "TIENDA_CREADA", label: "Tienda creada", tone: "success" },
  { value: "LEAD_NUEVO", label: "Lead nuevo", tone: "info" },
  { value: "LEAD_MENSAJE", label: "Mensaje de lead", tone: "purple" },
] as const);

/** Por dónde llegó un lead: lo buscó el comercial o llegó solo por un medio. */
export const LEAD_ENTRIES = catalog([
  { value: "INBOUND", label: "Medios", tone: "info", hint: "Llegó por redes, la web, WhatsApp o contacto directo" },
  { value: "SALES_HUNT", label: "Sales hunt", tone: "purple", hint: "Lo salió a buscar el área comercial, a partir de una tienda" },
] as const);

/** Medio de origen. Los de API entran solos; DIRECTO y SALES_HUNT los registra una persona. */
export const LEAD_SOURCES = catalog([
  { value: "FACEBOOK", label: "Facebook", tone: "info", hint: "Formulario de Lead Ads o anuncio que abre WhatsApp" },
  { value: "INSTAGRAM", label: "Instagram", tone: "purple", hint: "Formulario de Lead Ads o anuncio que abre WhatsApp" },
  { value: "WHATSAPP", label: "WhatsApp", tone: "success", hint: "Escribió a WhatsApp Business sin anuncio de por medio" },
  { value: "WEB", label: "Sitio web", tone: "neutral", hint: "Formulario de contacto de la página" },
  { value: "DIRECTO", label: "Directo", tone: "neutral", hint: "Llamada, correo o visita sin pasar por una plataforma" },
  { value: "SALES_HUNT", label: "Sales hunt", tone: "warning", hint: "Tienda identificada por el área comercial" },
] as const);

/**
 * Embudo del lead. El orden importa: es el que sigue el selector y el tablero.
 * GANADO y PERDIDO lo cierran; un lead cerrado ya no suma al forecast.
 */
export const LEAD_STATUS = catalog([
  { value: "NUEVO", label: "Nuevo", tone: "info", hint: "Nadie lo ha contactado todavía" },
  { value: "CONTACTADO", label: "Contactado", tone: "neutral", hint: "Hubo primer contacto" },
  { value: "CALIFICADO", label: "Calificado", tone: "purple", hint: "Tiene interés, volumen y quién decide" },
  { value: "NEGOCIACION", label: "En negociación", tone: "warning", hint: "Hay propuesta o lista de precios sobre la mesa" },
  { value: "GANADO", label: "Ganado", tone: "success", hint: "Se convirtió en cliente" },
  { value: "PERDIDO", label: "Perdido", tone: "danger", hint: "No compró; queda el motivo" },
] as const);

export const LEAD_OPEN = ["NUEVO", "CONTACTADO", "CALIFICADO", "NEGOCIACION"] as const;

/** Qué tan cerca está de comprar. Cuánto suma cada temperatura al forecast lo fija el criterio. */
export const LEAD_TEMPERATURE = catalog([
  { value: "CALIENTE", label: "Caliente", tone: "danger", hint: "Cierre probable: exige mes y valor, con los que suma al forecast" },
  { value: "TIBIO", label: "Tibio", tone: "warning", hint: "Interesado; si tiene mes y valor suma al forecast según el criterio" },
  { value: "FRIO", label: "Frío", tone: "info", hint: "Primer acercamiento o sin respuesta" },
] as const);

export const LEAD_EVENTS = catalog([
  { value: "CREADO", label: "Creado", tone: "info" },
  { value: "MENSAJE", label: "Mensaje", tone: "success" },
  { value: "NOTA", label: "Nota", tone: "neutral" },
  { value: "ESTADO", label: "Cambio", tone: "purple" },
  { value: "CONVERTIDO", label: "Convertido", tone: "success" },
] as const);

/** Si el cliente o el proveedor ya existe como tercero en Siigo. Se deriva de `siigoId` y `siigoError`. */
export const SIIGO_CUSTOMER = catalog([
  { value: "EN_SIIGO", label: "En Siigo", tone: "success" },
  { value: "SIN_ENVIAR", label: "Sin enviar", tone: "warning" },
  { value: "RECHAZADO", label: "Rechazado por Siigo", tone: "danger" },
] as const);

/**
 * Embudo de la cotización de un proveedor nuevo. APROBADA sólo se alcanza al
 * convertirla en proveedor; DESCARTADA la cierra con su motivo.
 */
export const QUOTE_STATUS = catalog([
  { value: "SOLICITADA", label: "Solicitada", tone: "info", hint: "Se le pidió cotización y todavía no responde" },
  { value: "RECIBIDA", label: "Recibida", tone: "purple", hint: "Llegaron costos, mínimos y tiempos por SKU" },
  { value: "NEGOCIACION", label: "En negociación", tone: "warning", hint: "Se están ajustando precios o condiciones de compra" },
  { value: "APROBADA", label: "Aprobada", tone: "success", hint: "Condiciones confirmadas: ya es proveedor" },
  { value: "DESCARTADA", label: "Descartada", tone: "danger", hint: "No se le compra; queda el motivo" },
] as const);

export const QUOTE_OPEN = ["SOLICITADA", "RECIBIDA", "NEGOCIACION"] as const;

export const QUOTE_EVENTS = catalog([
  { value: "CREADA", label: "Creada", tone: "info" },
  { value: "NOTA", label: "Nota", tone: "neutral" },
  { value: "ESTADO", label: "Cambio", tone: "purple" },
  { value: "CONVERTIDA", label: "Proveedor", tone: "success" },
] as const);

/** De dónde salió el proveedor. */
export const SUPPLIER_ORIGIN = catalog([
  { value: "CRM", label: "Cotización", tone: "info", hint: "Convertido en el portal desde una cotización aprobada" },
  { value: "SIIGO", label: "Siigo", tone: "neutral", hint: "Ya era proveedor en Siigo y se trajo de allá" },
] as const);

/**
 * Qué hacer con un SKU según el forecast de compras. Se deriva al leer: es la
 * comparación entre lo que hay, lo que viene y lo que se va a vender mientras
 * llega la próxima compra.
 */
export const PURCHASE_SIGNAL = catalog([
  { value: "QUIEBRE", label: "Quiebre", tone: "danger", hint: "Lo despachable se agota antes de que llegue lo que viene en camino o una compra emitida hoy" },
  { value: "PEDIR", label: "Pedir ya", tone: "warning", hint: "El inventario está en el punto de reorden o por debajo" },
  { value: "PROGRAMAR", label: "Programar", tone: "info", hint: "Hay que pedir antes de la próxima revisión" },
  { value: "CUBIERTO", label: "Cubierto", tone: "success", hint: "Lo que hay y lo que viene alcanza hasta la próxima revisión" },
  { value: "SIN_PROVEEDOR", label: "Sin proveedor", tone: "neutral", hint: "Ningún proveedor tiene condiciones cargadas para este SKU" },
  { value: "SIN_DEMANDA", label: "Sin demanda", tone: "neutral", hint: "No se ha vendido en los meses de referencia ni tiene forecast" },
] as const);

/** De dónde sale la demanda mensual con que se planea la compra. */
export const DEMAND_SOURCE = catalog([
  { value: "HISTORICO", label: "Histórico", tone: "neutral", hint: "Promedio de unidades vendidas en los últimos meses cerrados" },
  { value: "FORECAST", label: "Forecast", tone: "purple", hint: "Unidades proyectadas por el comercial para los próximos meses" },
] as const);

/** Ciclo de una orden de compra. Sólo las EMITIDAS cuentan como mercancía en camino. */
export const PURCHASE_ORDER_STATUS = catalog([
  { value: "BORRADOR", label: "Borrador", tone: "neutral", hint: "Generada desde el forecast; se pueden ajustar las cantidades" },
  { value: "EMITIDA", label: "Emitida", tone: "info", hint: "Enviada al proveedor: cuenta como mercancía en camino" },
  { value: "RECIBIDA", label: "Recibida", tone: "success", hint: "La mercancía llegó; el inventario lo lleva el ingreso de mercancía" },
  { value: "ANULADA", label: "Anulada", tone: "danger", hint: "No se va a pedir" },
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

/** Tipo de estrategia de trade o marketing que se pacta con un cliente. */
export const TRADE_TYPES = catalog([
  { value: "PROMOCION", label: "Promoción", tone: "info", hint: "Precio o mecánica especial: 2×1, descuento, pague N lleve M" },
  { value: "ACTIVACION", label: "Activación", tone: "purple", hint: "Impulso, evento o presencia de marca en el punto de venta" },
  { value: "EXHIBICION", label: "Exhibición adicional", tone: "success", hint: "Punta de góndola, isla, cabecera o espacio negociado" },
  { value: "MATERIAL_POP", label: "Material POP", tone: "warning", hint: "Rompetráficos, stoppers, cenefas, habladores" },
  { value: "DEGUSTACION", label: "Degustación", tone: "purple", hint: "Prueba de producto con impulsadora" },
  { value: "CATALOGO", label: "Catálogo o encarte", tone: "info", hint: "Aparición en revista, folleto o vitrina digital de la cadena" },
  { value: "OTRO", label: "Otra", tone: "neutral" },
] as const);

/**
 * Ciclo de una actividad de trade. Mientras está APROBADA, las fechas dicen si
 * va a empezar, está vigente o ya terminó (TRADE_PHASE); al cerrarla queda la
 * evaluación.
 */
export const TRADE_STATUS = catalog([
  { value: "PLANEADA", label: "Planeada", tone: "neutral", hint: "En negociación con el cliente; todavía no se ejecuta" },
  { value: "APROBADA", label: "Aprobada", tone: "info", hint: "Pactada: se ejecuta en sus fechas y hay que comprobarla en tienda" },
  { value: "CERRADA", label: "Cerrada", tone: "success", hint: "Terminó y quedó evaluada" },
  { value: "CANCELADA", label: "Cancelada", tone: "danger", hint: "No se hizo" },
] as const);

/** Dónde está en el calendario una actividad aprobada. No se guarda: sale de las fechas. */
export const TRADE_PHASE = catalog([
  { value: "PROXIMA", label: "Por iniciar", tone: "neutral" },
  { value: "VIGENTE", label: "Vigente", tone: "success" },
  { value: "VENCIDA", label: "Terminó sin cerrar", tone: "warning", hint: "Pasó la fecha final: falta evaluarla y cerrarla" },
] as const);

/** Si la actividad se ve de verdad en la tienda. */
export const TRADE_EXECUTION = catalog([
  { value: "PENDIENTE", label: "Por verificar", tone: "neutral", hint: "Nadie la ha comprobado en la tienda" },
  { value: "IMPLEMENTADA", label: "Implementada", tone: "success", hint: "Se ve completa en el punto de venta" },
  { value: "PARCIAL", label: "Parcial", tone: "warning", hint: "Está, pero incompleta: falta material, precio o espacio" },
  { value: "NO_IMPLEMENTADA", label: "No implementada", tone: "danger", hint: "La tienda no la tiene" },
] as const);

/** De dónde llegó un dato de sell-out. */
export const SELLOUT_SOURCE = catalog([
  { value: "ARCHIVO", label: "Archivo", tone: "neutral", hint: "Reporte del portal de la cadena cargado en Excel" },
  { value: "API", label: "API", tone: "info", hint: "Leído directamente del portal de la cadena" },
] as const);

/**
 * Ciclo de un ingreso de mercancía. Nace con la factura; el packing slip lo
 * cierra como RECIBIDO si cuadra con lo facturado o CON_DIFERENCIAS si no.
 */
export const RECEIPT_STATUS = catalog([
  { value: "POR_RECIBIR", label: "Por recibir", tone: "info", hint: "Factura cargada: falta certificar la mercancía con el packing slip" },
  { value: "RECIBIDO", label: "Recibido", tone: "success", hint: "Lo contado cuadra con lo facturado; los lotes están en bodega" },
  { value: "CON_DIFERENCIAS", label: "Con diferencias", tone: "warning", hint: "Llegó más o menos de lo facturado: hay que reclamar o ajustar con el proveedor" },
  { value: "ANULADO", label: "Anulado", tone: "neutral", hint: "La factura se cargó por error o se anuló antes de recibir" },
] as const);

/** Si un dato del ingreso lo digitó una persona o lo leyó Claude de un documento. */
export const RECEIPT_SOURCE = catalog([
  { value: "LECTURA", label: "Lectura con Claude", tone: "purple", hint: "Claude lo leyó del PDF o la foto; una persona lo revisó" },
  { value: "MANUAL", label: "Manual", tone: "neutral", hint: "Una persona lo digitó" },
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
