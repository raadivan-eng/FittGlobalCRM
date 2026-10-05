/**
 * Catálogo de proveedores con los que el portal se conecta.
 *
 * Es dato puro —sin prisma ni node— porque el formulario de credenciales es un
 * componente de cliente y necesita la definición de los campos. Todo lo que
 * toca la red o la base vive en src/lib/actions-integrations.ts.
 */

export type ProviderKey = "SIIGO" | "META" | "GOOGLE" | "MAPS";

export type CredentialField = {
  /** `account` se guarda en claro (identifica la cuenta); el resto va cifrado. */
  name: "account" | "secret" | "extra";
  label: string;
  hint: string;
  /** Los campos secretos nunca se devuelven al navegador: sólo su máscara. */
  secret: boolean;
};

export type Provider = {
  key: ProviderKey;
  name: string;
  tagline: string;
  /** Qué entra al portal por esta conexión. */
  brings: string[];
  /** Contra qué host se hace la prueba de conexión, para que no sea una caja negra. */
  endpoint: string;
  docsUrl: string;
  fields: CredentialField[];
};

/**
 * El color de cada proveedor sale de la paleta de series en orden fijo, igual
 * que en los gráficos: nunca se cicla ni se inventan tonos nuevos.
 */
export const PROVIDERS: Provider[] = [
  {
    key: "SIIGO",
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
];

export const PROVIDER_KEYS = PROVIDERS.map((p) => p.key);

export const providerByKey = (key: string) => PROVIDERS.find((p) => p.key === key);

/** Deja ver los últimos caracteres para reconocer la credencial sin exponerla. */
export const secretHint = (value: string) => value.trim().slice(-4);
