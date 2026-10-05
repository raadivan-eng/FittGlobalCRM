/**
 * Catálogo de proveedores con los que el portal se conecta.
 *
 * Es dato puro —sin prisma ni node— porque el formulario de credenciales es un
 * componente de cliente y necesita la definición de los campos. Todo lo que
 * toca la red o la base vive en src/lib/actions-integrations.ts.
 */

export type CarrierKey = "SERVIENTREGA" | "COORDINADORA" | "INTERRAPIDISIMO" | "ENVIA" | "TCC" | "DEPRISA";
export type ProviderKey = "SIIGO" | "META" | "GOOGLE" | "MAPS" | CarrierKey;

export type CredentialField = {
  /** `account` se guarda en claro (identifica la cuenta); el resto va cifrado. */
  name: "account" | "secret" | "extra";
  label: string;
  hint: string;
  /** Los campos secretos nunca se devuelven al navegador: sólo su máscara. */
  secret: boolean;
  /** Si puede quedar vacío al guardar. */
  optional?: boolean;
};

/** Las credenciales ya descifradas, tal como las usa quien habla con el proveedor. */
export type Credentials = { account: string; secret: string; extra: string };

export type CategoryKey = "FACTURACION" | "MARKETING" | "UBICACION" | "TRANSPORTE";

/** Grupos de la página de Conexiones, en el orden en que se muestran. */
export const CATEGORIES: { key: CategoryKey; title: string; description: string }[] = [
  {
    key: "FACTURACION",
    title: "Contabilidad y facturación",
    description: "El ERP es la fuente de verdad de facturas, cartera y precios de lista; el portal los lee de ahí.",
  },
  {
    key: "MARKETING",
    title: "Marketing y analítica",
    description: "Leads de campañas, conversaciones de WhatsApp y los reportes que se comparten fuera del portal.",
  },
  {
    key: "UBICACION",
    title: "Ubicación y rutas",
    description: "Coordenadas de los puntos de venta, la base para planear rutas y medir traslados.",
  },
  {
    key: "TRANSPORTE",
    title: "Transportadoras",
    description:
      "Con su API conectada, el portal pide las guías directamente a la transportadora y consulta su estado. Mientras una integración esté en preparación, las guías de esa transportadora se registran y actualizan a mano en Guías de envío.",
  },
];

export type Provider = {
  key: ProviderKey;
  /** SISTEMA: servicios del portal. TRANSPORTE: transportadoras de las guías. */
  kind: "SISTEMA" | "TRANSPORTE";
  /** Grupo en el que se muestra en Conexiones; ver CATEGORIES. */
  category: CategoryKey;
  name: string;
  tagline: string;
  /** Qué entra al portal por esta conexión. */
  brings: string[];
  /** Contra qué host se hace la prueba de conexión, para que no sea una caja negra. */
  endpoint?: string;
  docsUrl?: string;
  fields: CredentialField[];
};

/**
 * Las transportadoras comparten formulario: cada una pide usuario y clave de
 * su API más un código de cuenta. Cuando se implemente el adaptador de una
 * (src/lib/carriers.ts) y su API pida otra cosa, se le dan campos propios aquí.
 */
const CARRIER_FIELDS: CredentialField[] = [
  { name: "account", label: "Usuario de la API", hint: "Usuario o login que la transportadora asigna a la integración", secret: false },
  { name: "secret", label: "Clave o token", hint: "Contraseña, API key o token de la integración", secret: true },
  { name: "extra", label: "Código de cliente", hint: "Número de cuenta, código de cliente o centro de costo, si lo exige", secret: false, optional: true },
];

const CARRIER_BRINGS = [
  "Creación de guías desde el portal con los datos del pedido",
  "Consulta del estado y la trazabilidad de cada guía",
  "Rótulo de la guía para imprimir",
];

const carrier = (key: CarrierKey, name: string, tagline: string): Provider => ({
  key,
  kind: "TRANSPORTE",
  category: "TRANSPORTE",
  name,
  tagline,
  brings: CARRIER_BRINGS,
  fields: CARRIER_FIELDS,
});

/**
 * El color de cada proveedor sale de la paleta de series en orden fijo, igual
 * que en los gráficos: nunca se cicla ni se inventan tonos nuevos.
 */
export const PROVIDERS: Provider[] = [
  {
    key: "SIIGO",
    kind: "SISTEMA",
    category: "FACTURACION",
    name: "Siigo",
    tagline: "ERP contable y facturación electrónica",
    brings: [
      "Facturas de venta y notas emitidas desde el ERP",
      "Estado de cartera y pagos aplicados por cliente",
      "Catálogo de productos y precios de lista",
    ],
    endpoint: "POST https://api.siigo.com/auth",
    docsUrl: "https://siigoapi.docs.apiary.io/",
    fields: [
      { name: "account", label: "Usuario API", hint: "Correo del usuario con perfil API en Siigo", secret: false },
      { name: "secret", label: "Access key", hint: "Clave que Siigo entrega al habilitar la API", secret: true },
      { name: "extra", label: "Partner-Id", hint: "Identificador que Siigo asigna a la integración", secret: false },
    ],
  },
  {
    key: "META",
    kind: "SISTEMA",
    category: "MARKETING",
    name: "Meta",
    tagline: "Leads de campañas y WhatsApp Business",
    brings: [
      "Leads de formularios de Facebook e Instagram",
      "Desempeño de campañas por cuenta publicitaria",
      "Conversaciones de WhatsApp Business del canal HORECA",
    ],
    endpoint: "GET https://graph.facebook.com/v21.0/me",
    docsUrl: "https://developers.facebook.com/docs/graph-api/",
    fields: [
      { name: "account", label: "ID de la cuenta de negocio", hint: "Business ID en el Administrador Comercial", secret: false },
      { name: "secret", label: "Token de acceso", hint: "Token de larga duración de la app del sistema", secret: true },
    ],
  },
  {
    key: "GOOGLE",
    kind: "SISTEMA",
    category: "MARKETING",
    name: "Google",
    tagline: "Sheets, Drive y Analytics",
    brings: [
      "Exportación de reportes a Google Sheets",
      "Respaldo de soportes y documentos en Drive",
      "Tráfico y conversión del canal e-commerce desde Analytics",
    ],
    endpoint: "POST https://oauth2.googleapis.com/token",
    docsUrl: "https://developers.google.com/identity/protocols/oauth2",
    fields: [
      { name: "account", label: "Client ID", hint: "ID del cliente OAuth del proyecto de Google Cloud", secret: false },
      { name: "secret", label: "Client secret", hint: "Secreto del mismo cliente OAuth", secret: true },
      { name: "extra", label: "Refresh token", hint: "Token de actualización con los permisos ya concedidos", secret: true },
    ],
  },
  {
    key: "MAPS",
    kind: "SISTEMA",
    category: "UBICACION",
    name: "Google Maps",
    tagline: "Geocodificación de puntos de venta",
    brings: [
      "Coordenadas de cada tienda a partir de su dirección (Geocoding API)",
      "Búsqueda por nombre de las tiendas sin dirección (Places API)",
      "La base para ordenar las rutas y medir traslados",
    ],
    endpoint: "GET https://maps.googleapis.com/maps/api/geocode/json",
    docsUrl: "https://developers.google.com/maps/documentation/geocoding/overview",
    fields: [
      { name: "account", label: "Proyecto de Google Cloud", hint: "ID del proyecto donde se creó la clave, para reconocerla", secret: false },
      { name: "secret", label: "API key", hint: "Clave con Geocoding API y Places API (New) habilitadas, sin restricción de sitio web", secret: true },
    ],
  },
  carrier("SERVIENTREGA", "Servientrega", "Paquetería y mensajería nacional"),
  carrier("COORDINADORA", "Coordinadora", "Paquetería y carga nacional"),
  carrier("INTERRAPIDISIMO", "Interrapidísimo", "Mensajería y paquetería nacional"),
  carrier("ENVIA", "Envía", "Paquetería y carga nacional"),
  carrier("TCC", "TCC", "Carga masiva y paquetería"),
  carrier("DEPRISA", "Deprisa", "Mensajería y paquetería nacional"),
];

export const PROVIDER_KEYS = PROVIDERS.map((p) => p.key);

/** Transportadoras con las que se pueden emitir y rastrear guías. */
export const CARRIERS = PROVIDERS.filter((p) => p.kind === "TRANSPORTE");
export const isCarrier = (key: string): key is CarrierKey => CARRIERS.some((c) => c.key === key);

export const providerByKey = (key: string) => PROVIDERS.find((p) => p.key === key);

/** Deja ver los últimos caracteres para reconocer la credencial sin exponerla. */
export const secretHint = (value: string) => value.trim().slice(-4);
