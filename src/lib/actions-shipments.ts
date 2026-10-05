"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { requireSection } from "./auth";
import { isCarrier } from "./integrations";
import { SHIPMENT_ACTIVE, SHIPMENT_CLOSED, SHIPMENT_STATUS } from "./enums";
import { carrierAdapter, carrierCapabilities, carrierCredentials, type TrackingResult } from "./carriers";

export type ShipmentFormState = { error?: string };

/** Cuántas guías consulta una actualización masiva: Workers limita las subpeticiones por request. */
const LOTE_CONSULTA = 20;

const texto = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim();
const numero = (fd: FormData, name: string) => {
  const v = Number(texto(fd, name).replace(",", "."));
  return Number.isFinite(v) && texto(fd, name) !== "" ? v : null;
};

/**
 * Los campos de fecha y hora llegan sin zona. La operación es en Colombia
 * (UTC−5 todo el año) y en Workers el servidor corre en UTC, así que la zona se
 * fija aquí en vez de depender de dónde corra la acción.
 */
function fechaLocal(valor: string) {
  if (!valor) return null;
  const d = new Date(valor.length === 10 ? `${valor}T12:00:00-05:00` : `${valor}:00-05:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const mensaje = (e: unknown) => (e instanceof Error ? e.message : "Fallo desconocido");

function revalidarGuias(id?: string) {
  revalidatePath("/guias");
  if (id) revalidatePath(`/guias/${id}`);
}

/** Consecutivo GU-00001. Si dos guías se crean a la vez, el índice único decide y se reintenta. */
async function siguienteCodigo(intento: number) {
  const total = await prisma.shipment.count();
  return `GU-${String(total + 1 + intento).padStart(5, "0")}`;
}

const esConflictoUnico = (e: unknown) => (e as { code?: string })?.code === "P2002";

/** Al tener número de guía, el pedido asociado pasa a despachado si estaba sólo confirmado. */
async function marcarPedidoDespachado(orderId: string | null) {
  if (!orderId) return;
  const { count } = await prisma.salesOrder.updateMany({ where: { id: orderId, status: "CONFIRMADO" }, data: { status: "DESPACHADO" } });
  if (count) revalidatePath("/ventas");
}

/**
 * Pide la guía a la transportadora para un borrador. Si falla, el borrador
 * queda tal cual con el error anotado, para reintentar o registrar el número a mano.
 */
async function solicitarATransportadora(shipmentId: string, userId: string) {
  const s = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!s || s.status !== "BORRADOR") return;

  const adapter = carrierAdapter(s.carrier);
  const creds = await carrierCredentials(s.carrier);
  if (!adapter?.crearGuia || !creds) {
    await prisma.shipment.update({
      where: { id: s.id },
      data: { lastSyncError: "La transportadora no tiene la creación de guías por API habilitada y conectada." },
    });
    return;
  }

  try {
    const guia = await adapter.crearGuia(creds, {
      reference: s.code,
      recipientName: s.recipientName,
      recipientPhone: s.recipientPhone,
      destinationAddress: s.destinationAddress,
      destinationCity: s.destinationCity,
      packages: s.packages,
      weightKg: s.weightKg,
      declaredValue: s.declaredValue,
      contents: s.contents,
      notes: s.notes,
    });
    await prisma.shipment.update({
      where: { id: s.id },
      data: {
        trackingNumber: guia.trackingNumber,
        source: "API",
        status: "GENERADA",
        labelUrl: guia.labelUrl ?? null,
        shippingCost: guia.shippingCost ?? s.shippingCost,
        estimatedDelivery: guia.estimatedDelivery ?? s.estimatedDelivery,
        lastSyncAt: new Date(),
        lastSyncError: null,
      },
    });
    await prisma.shipmentEvent.create({
      data: {
        shipmentId: s.id,
        status: "GENERADA",
        description: `La transportadora asignó la guía ${guia.trackingNumber}`,
        occurredAt: new Date(),
        source: "API",
        userId,
      },
    });
    await marcarPedidoDespachado(s.orderId);
  } catch (e) {
    await prisma.shipment.update({ where: { id: s.id }, data: { lastSyncError: mensaje(e) } });
  }
}

/**
 * Incorpora lo que respondió la transportadora. Los movimientos se comparan
 * por fecha, estado y descripción, así repetir la consulta no los duplica
 * (y, sin transacciones en D1, repetirla después de un fallo tampoco hace daño).
 */
async function aplicarSeguimiento(shipmentId: string, r: TrackingResult) {
  const previos = await prisma.shipmentEvent.findMany({
    where: { shipmentId, source: "API" },
    select: { occurredAt: true, status: true, description: true },
  });
  const clave = (e: { occurredAt: Date; status: string; description: string }) =>
    `${e.occurredAt.getTime()}|${e.status}|${e.description}`;
  const vistos = new Set(previos.map(clave));
  const nuevos = r.events.filter((e) => !vistos.has(clave(e)));

  if (nuevos.length) {
    await prisma.shipmentEvent.createMany({
      data: nuevos.map((e) => ({
        shipmentId,
        status: e.status,
        description: e.description,
        location: e.location ?? null,
        occurredAt: e.occurredAt,
        source: "API",
      })),
    });
  }

  const recogida = r.events
    .filter((e) => e.status !== "GENERADA")
    .map((e) => e.occurredAt)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  await prisma.shipment.update({
    where: { id: shipmentId },
    data: {
      status: r.status,
      estimatedDelivery: r.estimatedDelivery ?? undefined,
      deliveredAt: r.status === "ENTREGADA" ? (r.deliveredAt ?? new Date()) : undefined,
      shippedAt: recogida ?? undefined,
      lastSyncAt: new Date(),
      lastSyncError: null,
    },
  });
}

/** Consulta una guía contra su transportadora. Devuelve el error, si lo hubo. */
async function consultarUna(s: { id: string; carrier: string; trackingNumber: string | null }) {
  const adapter = carrierAdapter(s.carrier);
  const creds = await carrierCredentials(s.carrier);
  if (!s.trackingNumber || !adapter?.consultar || !creds) return "Consulta por API no disponible para esta transportadora.";
  try {
    await aplicarSeguimiento(s.id, await adapter.consultar(creds, s.trackingNumber));
    return null;
  } catch (e) {
    const error = mensaje(e);
    await prisma.shipment.update({ where: { id: s.id }, data: { lastSyncAt: new Date(), lastSyncError: error } });
    return error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crea la guía. En modo MANUAL se transcribe una guía ya hecha en el sitio de
 * la transportadora; en modo API el portal la pide y, si la transportadora
 * falla, la guía queda en borrador con el error a la vista.
 */
export async function crearGuia(_prev: ShipmentFormState, fd: FormData): Promise<ShipmentFormState> {
  const user = await requireSection("guias");

  const carrier = texto(fd, "carrier");
  const mode = texto(fd, "mode") === "API" ? "API" : "MANUAL";
  const trackingNumber = texto(fd, "trackingNumber").replace(/\s+/g, "");
  const orderId = texto(fd, "orderId") || null;
  const recipientName = texto(fd, "recipientName");
  const destinationAddress = texto(fd, "destinationAddress");
  const destinationCity = texto(fd, "destinationCity");
  const packages = Math.max(1, Math.round(numero(fd, "packages") ?? 1));

  if (!isCarrier(carrier)) return { error: "Elige la transportadora." };
  if (mode === "MANUAL" && !trackingNumber) return { error: "Escribe el número de guía que entregó la transportadora." };
  if (!recipientName || !destinationAddress || !destinationCity) {
    return { error: "Faltan los datos del destino: destinatario, dirección y ciudad." };
  }

  if (mode === "API") {
    const cap = (await carrierCapabilities()).find((c) => c.key === carrier);
    if (!cap?.canCreate) return { error: "Esta transportadora todavía no permite crear guías desde el portal. Regístrala a mano." };
  } else {
    const repetida = await prisma.shipment.findFirst({ where: { carrier, trackingNumber }, select: { code: true } });
    if (repetida) return { error: `La guía ${trackingNumber} ya está registrada como ${repetida.code}.` };
  }

  const order = orderId
    ? await prisma.salesOrder.findUnique({ where: { id: orderId }, select: { id: true, companyId: true, storeId: true } })
    : null;

  const data = {
    carrier,
    trackingNumber: mode === "MANUAL" ? trackingNumber : null,
    source: mode,
    status: mode === "MANUAL" ? "GENERADA" : "BORRADOR",
    orderId: order?.id ?? null,
    companyId: order?.companyId ?? null,
    storeId: order?.storeId ?? null,
    recipientName,
    recipientPhone: texto(fd, "recipientPhone") || null,
    destinationAddress,
    destinationCity,
    packages,
    weightKg: numero(fd, "weightKg"),
    declaredValue: numero(fd, "declaredValue") ?? 0,
    shippingCost: numero(fd, "shippingCost"),
    contents: texto(fd, "contents") || null,
    notes: texto(fd, "notes") || null,
    estimatedDelivery: fechaLocal(texto(fd, "estimatedDelivery")),
    createdById: user.id,
  };

  let id = "";
  for (let intento = 0; intento < 3 && !id; intento++) {
    try {
      const row = await prisma.shipment.create({ data: { ...data, code: await siguienteCodigo(intento) } });
      id = row.id;
    } catch (e) {
      if (!esConflictoUnico(e)) throw e;
    }
  }
  if (!id) return { error: "No se pudo asignar el consecutivo de la guía. Intenta de nuevo." };

  await prisma.shipmentEvent.create({
    data: {
      shipmentId: id,
      status: data.status,
      description: mode === "MANUAL" ? `Guía ${trackingNumber} registrada a mano` : "Guía preparada en el portal",
      occurredAt: new Date(),
      source: "SISTEMA",
      userId: user.id,
    },
  });

  if (mode === "MANUAL") await marcarPedidoDespachado(data.orderId);
  else await solicitarATransportadora(id, user.id);

  revalidarGuias(id);
  redirect(`/guias/${id}`);
}

/** Reintenta pedir a la transportadora un borrador que quedó sin número. */
export async function solicitarGuia(fd: FormData) {
  const user = await requireSection("guias");
  const id = texto(fd, "id");
  await solicitarATransportadora(id, user.id);
  revalidarGuias(id);
}

/** Para un borrador cuya guía se terminó haciendo en el sitio de la transportadora. */
export async function asignarNumeroGuia(fd: FormData) {
  const user = await requireSection("guias");
  const id = texto(fd, "id");
  const trackingNumber = texto(fd, "trackingNumber").replace(/\s+/g, "");
  const s = await prisma.shipment.findUnique({ where: { id } });
  if (!s || s.status !== "BORRADOR" || !trackingNumber) return;

  const repetida = await prisma.shipment.findFirst({ where: { carrier: s.carrier, trackingNumber, id: { not: id } }, select: { id: true } });
  if (repetida) return;

  await prisma.shipment.update({
    where: { id },
    data: { trackingNumber, status: "GENERADA", source: "MANUAL", lastSyncError: null },
  });
  await prisma.shipmentEvent.create({
    data: { shipmentId: id, status: "GENERADA", description: `Guía ${trackingNumber} registrada a mano`, occurredAt: new Date(), source: "MANUAL", userId: user.id },
  });
  await marcarPedidoDespachado(s.orderId);
  revalidarGuias(id);
}

/** Consulta el estado de una guía en su transportadora. */
export async function consultarGuia(fd: FormData) {
  await requireSection("guias");
  const id = texto(fd, "id");
  const s = await prisma.shipment.findUnique({ where: { id }, select: { id: true, carrier: true, trackingNumber: true } });
  if (!s) return;
  await consultarUna(s);
  revalidarGuias(id);
}

/**
 * Actualiza de una vez las guías en curso de las transportadoras con rastreo
 * por API, empezando por las que llevan más tiempo sin consultarse.
 */
export async function consultarGuiasActivas() {
  await requireSection("guias");
  const rastreables = (await carrierCapabilities()).filter((c) => c.canTrack).map((c) => c.key);
  if (!rastreables.length) return;

  const guias = await prisma.shipment.findMany({
    where: { carrier: { in: rastreables }, status: { in: [...SHIPMENT_ACTIVE] }, trackingNumber: { not: null } },
    orderBy: [{ lastSyncAt: { sort: "asc", nulls: "first" } }],
    take: LOTE_CONSULTA,
    select: { id: true, carrier: true, trackingNumber: true },
  });
  for (const s of guias) await consultarUna(s);
  revalidarGuias();
}

/**
 * Anota un movimiento a mano (lo que dijo la transportadora por teléfono, lo
 * que se vio en su sitio). El estado de la guía sólo cambia si el movimiento es
 * el más reciente: un hecho viejo que se anota tarde no la hace retroceder.
 */
export async function registrarMovimiento(fd: FormData) {
  const user = await requireSection("guias");
  const id = texto(fd, "id");
  const status = texto(fd, "status");
  const description = texto(fd, "description") || SHIPMENT_STATUS.label(status);
  const location = texto(fd, "location") || null;
  const occurredAt = fechaLocal(texto(fd, "occurredAt")) ?? new Date();

  const permitidos: string[] = [...SHIPMENT_ACTIVE, "ENTREGADA", "DEVUELTA"];
  if (!permitidos.includes(status)) return;

  const s = await prisma.shipment.findUnique({
    where: { id },
    select: { status: true, shippedAt: true, events: { orderBy: { occurredAt: "desc" }, take: 1, select: { occurredAt: true } } },
  });
  if (!s || s.status === "BORRADOR" || s.status === "ANULADA") return;

  await prisma.shipmentEvent.create({
    data: { shipmentId: id, status, description, location, occurredAt, source: "MANUAL", userId: user.id },
  });

  const masReciente = !s.events[0] || occurredAt >= s.events[0].occurredAt;
  await prisma.shipment.update({
    where: { id },
    data: {
      ...(masReciente ? { status } : {}),
      ...(status === "ENTREGADA" ? { deliveredAt: occurredAt } : {}),
      ...(!s.shippedAt && status !== "GENERADA" ? { shippedAt: occurredAt } : {}),
    },
  });
  revalidarGuias(id);
}

/**
 * Cancela una guía que no llegó a despacharse. Si la pidió el portal y la
 * transportadora permite anular por API, se anula allá primero: si se niega,
 * la guía sigue viva aquí con el motivo a la vista.
 */
export async function anularGuia(fd: FormData) {
  const user = await requireSection("guias");
  const id = texto(fd, "id");
  const motivo = texto(fd, "motivo");
  const s = await prisma.shipment.findUnique({ where: { id }, select: { status: true, source: true, carrier: true, trackingNumber: true } });
  if (!s || (SHIPMENT_CLOSED as readonly string[]).includes(s.status)) return;

  const adapter = carrierAdapter(s.carrier);
  if (s.source === "API" && s.trackingNumber && adapter?.anular) {
    const creds = await carrierCredentials(s.carrier);
    try {
      if (!creds) throw new Error("La conexión con la transportadora no está activa.");
      await adapter.anular(creds, s.trackingNumber);
    } catch (e) {
      await prisma.shipment.update({ where: { id }, data: { lastSyncError: `No se pudo anular en la transportadora: ${mensaje(e)}` } });
      revalidarGuias(id);
      return;
    }
  }

  await prisma.shipment.update({ where: { id }, data: { status: "ANULADA" } });
  await prisma.shipmentEvent.create({
    data: {
      shipmentId: id,
      status: "ANULADA",
      description: motivo ? `Guía anulada: ${motivo}` : "Guía anulada",
      occurredAt: new Date(),
      source: "SISTEMA",
      userId: user.id,
    },
  });
  revalidarGuias(id);
}
