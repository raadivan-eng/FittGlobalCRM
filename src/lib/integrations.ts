/**
 * Catálogo de proveedores con los que el portal se conecta.
 *
 * Es dato puro —sin prisma ni node— porque el formulario de credenciales es un
 * componente de cliente y necesita la definición de los campos. Todo lo que
 * toca la red o la base vive en src/lib/actions-integrations.ts.
 */

export type CarrierKey = "SERVIENTREGA" | "COORDINADORA" | "INTERRAPIDISIMO" | "ENVIA" | "TCC" | "DEPRISA";
export type ProviderKey = "SIIGO" | "CLAUDE" | "META" | "GOOGLE" | "MAPS" | CarrierKey;

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

/**
 * Un proveedor con varias APIs bajo las mismas credenciales (Siigo) las separa
 * en módulos: comparten usuario y clave, pero cada uno se identifica ante el
 * proveedor con su propio Partner-ID, se prende por separado y lleva su propio
 * estado, porque falla y se sincroniza por su cuenta.
 */
export type ProviderModule = {
  key: string;
  name: string;
  brings: string[];
  /** Nombre con el que quedó registrada la aplicación en el proveedor; sirve de ejemplo. */
  suggestedPartnerId: string;
  /** Consulta mínima que confirma que el módulo puede leer lo suyo. */
  probe: { path: string; noun: string };
  /** Qué trae el botón «Sincronizar»; sin esto el módulo sólo se prueba. */
  sync?: string;
};

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
  /** Sólo para proveedores con varias APIs; ver ProviderModule. */
  modules?: ProviderModule[];
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
    // Lo que trae cada módulo va en el módulo.
    brings: [],
    endpoint: "POST https://api.siigo.com/auth",
    docsUrl: "https://siigoapi.docs.apiary.io/",
    fields: [
      { name: "account", label: "Usuario API", hint: "Correo del usuario con perfil API en Siigo", secret: false },
      { name: "secret", label: "Access key", hint: "Clave que Siigo entrega al habilitar la API", secret: true },
    ],
    modules: [
      {
        key: "FACTURACION",
        name: "Facturación",
        brings: ["Facturas de venta y notas crédito emitidas en Siigo", "Estado de cartera y pagos aplicados por cliente"],
        suggestedPartnerId: "CRMFittGlobalFacturacion",
        probe: { path: "/v1/invoices", noun: "facturas" },
        sync: "Trae las facturas y notas crédito desde enero de 2026 a Ventas y facturación. Cada noche entra lo nuevo.",
      },
      {
        key: "CLIENTES",
        name: "Clientes",
        brings: [
          "Terceros de Siigo para cruzarlos con los clientes del portal",
          "Alta en Siigo del cliente que nace de un lead, con los datos de su RUT",
          "Proveedores que ya existen en Siigo, traídos a Proveedores",
          "Alta en Siigo del proveedor que nace de una cotización aprobada, con su RUT",
        ],
        suggestedPartnerId: "CRMFittGlobalClientes",
        probe: { path: "/v1/customers", noun: "clientes" },
      },
      {
        key: "INVENTARIOS",
        name: "Inventarios",
        brings: ["Catálogo de productos, precios de lista y existencias"],
        suggestedPartnerId: "CRMFittGlobalInventarios",
        probe: { path: "/v1/products", noun: "productos" },
      },
    ],
  },
  {
    key: "CLAUDE",
    kind: "SISTEMA",
    category: "FACTURACION",
    name: "Claude",
    tagline: "Lectura del RUT y la Cámara de Comercio de clientes y proveedores",
    brings: [
      "Razón social, NIT, dirección y responsabilidades fiscales leídas del documento al convertir un lead o una cotización",
      "Funciona con el PDF de la DIAN o una foto legible; sin esta conexión no se pueden convertir leads ni cotizaciones",
    ],
    endpoint: "GET https://api.anthropic.com/v1/models",
    docsUrl: "https://platform.claude.com/docs/en/build-with-claude/pdf-support",
    fields: [
      { name: "account", label: "Workspace", hint: "Nombre del workspace de la Consola de Claude donde se creó la clave, para reconocerla", secret: false },
      { name: "secret", label: "API key", hint: "Clave de la API de Claude (sk-ant-…)", secret: true },
    ],
  },
  {
    key: "META",
    kind: "SISTEMA",
    category: "MARKETING",
    name: "Meta",
    tagline: "Leads de campañas y WhatsApp Business",
    brings: [
      "Leads de formularios de Facebook e Instagram, directo a Leads",
      "Quien escribe a WhatsApp Business entra como lead, con el anuncio de origen si lo hubo",
      "Los mensajes siguientes quedan en la bitácora del lead",
    ],
    endpoint: "GET https://graph.facebook.com/v21.0/me",
    docsUrl: "https://developers.facebook.com/docs/graph-api/webhooks/getting-started",
    fields: [
      { name: "account", label: "ID de la cuenta de negocio", hint: "Business ID en el Administrador Comercial", secret: false },
      {
        name: "secret",
        label: "Token de acceso",
        hint: "Token de larga duración de un usuario del sistema con leads_retrieval, pages_manage_metadata y whatsapp_business_messaging",
        secret: true,
      },
      {
        name: "extra",
        label: "Clave secreta de la app",
        hint: "App Secret de la app de Meta. Sin ella el portal rechaza el webhook, porque no puede comprobar que lo envía Meta",
        secret: true,
        optional: true,
      },
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

export const moduleByKey = (provider: Provider, key: string) => provider.modules?.find((m) => m.key === key);

/** Deja ver los últimos caracteres para reconocer la credencial sin exponerla. */
export const secretHint = (value: string) => value.trim().slice(-4);
