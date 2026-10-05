import "server-only";
import { prisma } from "./prisma";
import { decryptJson } from "./secrets";
import { CARRIERS, type CarrierKey, type Credentials } from "./integrations";

/**
 * Adaptadores de las transportadoras.
 *
 * El portal no sabe hablar con ninguna transportadora en particular: sabe pedir
 * una guía, consultar su estado y probar unas credenciales a través de la
 * interfaz `CarrierAdapter`. Habilitar la API de una transportadora es:
 *
 *   1. Escribir su adaptador (p. ej. `src/lib/carriers/servientrega.ts`) que
 *      implemente esta interfaz con `pedir` de ./http, traduciendo sus estados
 *      al catálogo SHIPMENT_STATUS de ./enums.
 *   2. Registrarlo en `ADAPTERS` más abajo.
 *   3. Si su API pide credenciales distintas, darle campos propios en
 *      ./integrations (si no, le sirven los genéricos de transportadora).
 *
 * Con eso aparecen solos el botón «Probar conexión» en /conexiones, la opción
 * «Solicitar a la transportadora» al crear una guía y la consulta de estado en
 * /guias. Mientras una transportadora no tenga adaptador, sus guías se
 * registran y se actualizan a mano.
 */

/** Lo que el portal entrega a la transportadora para pedir una guía. */
export type GuideRequest = {
  /** Consecutivo interno; sirve como referencia del remitente en la guía. */
  reference: string;
  recipientName: string;
  recipientPhone: string | null;
  destinationAddress: string;
  destinationCity: string;
  packages: number;
  weightKg: number | null;
  declaredValue: number;
  contents: string | null;
  notes: string | null;
};

export type GuideCreated = {
  trackingNumber: string;
  labelUrl?: string | null;
  shippingCost?: number | null;
  estimatedDelivery?: Date | null;
};

export type TrackingEvent = {
  /** Ya traducido al catálogo SHIPMENT_STATUS. */
  status: string;
  description: string;
  location?: string | null;
  occurredAt: Date;
};

export type TrackingResult = {
  /** Estado actual traducido al catálogo SHIPMENT_STATUS. */
  status: string;
  events: TrackingEvent[];
  estimatedDelivery?: Date | null;
  deliveredAt?: Date | null;
};

export type CarrierAdapter = {
  /** Prueba las credenciales; devuelve lo que respondió o lanza con su mensaje. */
  autenticar(c: Credentials): Promise<string>;
  /** Pide la guía. Opcional: hay transportadoras que sólo exponen rastreo. */
  crearGuia?(c: Credentials, req: GuideRequest): Promise<GuideCreated>;
  /** Consulta el estado y la trazabilidad de una guía por su número. */
  consultar?(c: Credentials, trackingNumber: string): Promise<TrackingResult>;
  /** Anula en la transportadora una guía que todavía no se ha recogido. */
  anular?(c: Credentials, trackingNumber: string): Promise<void>;
};

/** Registro de adaptadores implementados. Vacío hasta habilitar la primera API. */
const ADAPTERS: Partial<Record<CarrierKey, CarrierAdapter>> = {};

export const carrierAdapter = (key: string): CarrierAdapter | null => ADAPTERS[key as CarrierKey] ?? null;

/** Credenciales descifradas de la transportadora, o `null` si no está conectada. */
export async function carrierCredentials(key: string): Promise<Credentials | null> {
  const row = await prisma.apiConnection.findUnique({ where: { provider: key } });
  if (!row || row.status !== "CONECTADA") return null;
  const secretos = decryptJson(row.secretCipher);
  if (!secretos) return null;
  return { account: row.account ?? "", secret: secretos.secret ?? "", extra: secretos.extra ?? "" };
}

export type CarrierCapability = {
  key: CarrierKey;
  name: string;
  /** Hay adaptador escrito para su API. */
  integrated: boolean;
  /** Sus credenciales están guardadas y la última prueba pasó. */
  connected: boolean;
  canCreate: boolean;
  canTrack: boolean;
};

/** Qué se puede hacer hoy con cada transportadora. Lo leen las páginas de guías. */
export async function carrierCapabilities(): Promise<CarrierCapability[]> {
  const rows = await prisma.apiConnection.findMany({
    where: { provider: { in: CARRIERS.map((c) => c.key) } },
    select: { provider: true, status: true },
  });
  const status = new Map(rows.map((r) => [r.provider, r.status]));
  return CARRIERS.map((c) => {
    const adapter = carrierAdapter(c.key);
    const connected = Boolean(adapter) && status.get(c.key) === "CONECTADA";
    return {
      key: c.key as CarrierKey,
      name: c.name,
      integrated: Boolean(adapter),
      connected,
      canCreate: connected && Boolean(adapter?.crearGuia),
      canTrack: connected && Boolean(adapter?.consultar),
    };
  });
}
