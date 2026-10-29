"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { requireRole, TRADE_CHECK_ROLES, TRADE_ROLES } from "./auth";
import { TRADE_EXECUTION, TRADE_STATUS, TRADE_TYPES } from "./enums";

export type TradeFormState = { error?: string };

const texto = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim();

/** Fecha de un <input type="date">, fijada al mediodía de Bogotá (ver src/lib/trade.ts). */
function fecha(valor: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  const d = new Date(`${valor}T12:00:00-05:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function monto(valor: string) {
  if (!valor) return 0;
  const n = Number(valor.replace(/[$\s.]/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Consecutivo TR-00001. Si dos se crean a la vez, el índice único decide y se reintenta. */
async function siguienteCodigo(intento: number) {
  const total = await prisma.tradeActivity.count();
  return `TR-${String(total + 1 + intento).padStart(5, "0")}`;
}

const esConflictoUnico = (e: unknown) => (e as { code?: string })?.code === "P2002";

/** Filas por createMany de ejecuciones: id, actividad, tienda, estado y fecha caben ~15 veces en el tope de D1. */
const LOTE_TIENDAS = 15;

function revalidarTrade(id?: string) {
  revalidatePath("/trade");
  if (id) revalidatePath(`/trade/${id}`);
  revalidatePath("/tiendas", "layout");
}

type Campos = {
  type: string;
  title: string;
  mechanic: string | null;
  description: string | null;
  startDate: Date;
  endDate: Date;
  budget: number;
  ownerId: string | null;
};

/** Lee y valida los campos comunes a crear y editar. */
function leerCampos(fd: FormData): Campos | string {
  const type = texto(fd, "type");
  const title = texto(fd, "title");
  const startDate = fecha(texto(fd, "startDate"));
  const endDate = fecha(texto(fd, "endDate"));
  const budget = monto(texto(fd, "budget"));
  if (!TRADE_TYPES.values.includes(type as never)) return "Elige el tipo de actividad.";
  if (!title) return "Ponle un nombre a la actividad.";
  if (!startDate || !endDate) return "Indica las fechas de inicio y fin.";
  if (endDate < startDate) return "La fecha final no puede ser anterior a la de inicio.";
  if (budget == null) return "La inversión debe ser un número.";
  return {
    type,
    title,
    mechanic: texto(fd, "mechanic") || null,
    description: texto(fd, "description") || null,
    startDate,
    endDate,
    budget,
    ownerId: texto(fd, "ownerId") || null,
  };
}

/**
 * Crea la actividad con sus productos y una fila de ejecución por cada tienda
 * donde debe verse: todas las activas del cliente o las de las ciudades
 * elegidas.
 */
export async function crearActividad(_prev: TradeFormState, fd: FormData): Promise<TradeFormState> {
  const user = await requireRole(TRADE_ROLES);
  const campos = leerCampos(fd);
  if (typeof campos === "string") return { error: campos };

  const companyId = texto(fd, "companyId");
  const status = texto(fd, "status") === "APROBADA" ? "APROBADA" : "PLANEADA";
  const productIds = fd.getAll("productIds").map(String).filter(Boolean);
  const cities = fd.getAll("cities").map(String).filter(Boolean);

  const company = companyId ? await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } }) : null;
  if (!company) return { error: "Elige el cliente con quien se pactó." };

  const stores = await prisma.store.findMany({
    where: { companyId, active: true, ...(cities.length ? { city: { in: cities } } : {}) },
    select: { id: true },
  });
  if (!stores.length && cities.length) return { error: "El cliente no tiene tiendas activas en las ciudades elegidas." };

  let id = "";
  for (let intento = 0; intento < 5 && !id; intento++) {
    try {
      const created = await prisma.tradeActivity.create({
        data: {
          ...campos,
          code: await siguienteCodigo(intento),
          status,
          companyId,
          createdById: user.id,
          ownerId: campos.ownerId ?? user.id,
          products: { create: productIds.map((productId) => ({ productId })) },
        },
        select: { id: true },
      });
      id = created.id;
    } catch (e) {
      if (!esConflictoUnico(e)) throw e;
    }
  }
  if (!id) return { error: "No se pudo asignar un consecutivo. Intenta de nuevo." };

  for (let i = 0; i < stores.length; i += LOTE_TIENDAS) {
    await prisma.tradeExecution.createMany({
      data: stores.slice(i, i + LOTE_TIENDAS).map((s) => ({ activityId: id, storeId: s.id })),
    });
  }

  revalidarTrade();
  redirect(`/trade/${id}`);
}

/** Corrige nombre, mecánica, fechas, inversión o responsable. */
export async function editarActividad(_prev: TradeFormState, fd: FormData): Promise<TradeFormState> {
  await requireRole(TRADE_ROLES);
  const id = texto(fd, "id");
  const campos = leerCampos(fd);
  if (typeof campos === "string") return { error: campos };
  const productIds = fd.getAll("productIds").map(String).filter(Boolean);

  await prisma.tradeActivity.update({ where: { id }, data: campos });
  // Repetible sin daño: se borra y se vuelve a escribir la lista completa.
  await prisma.tradeActivityProduct.deleteMany({ where: { activityId: id } });
  if (productIds.length) await prisma.tradeActivityProduct.createMany({ data: productIds.map((productId) => ({ activityId: id, productId })) });

  revalidarTrade(id);
  return {};
}

/** Aprueba, cierra con su aprendizaje, cancela o devuelve a planeación. */
export async function cambiarEstadoActividad(fd: FormData) {
  await requireRole(TRADE_ROLES);
  const id = texto(fd, "id");
  const status = texto(fd, "status");
  if (!id || !TRADE_STATUS.values.includes(status as never)) return;
  const closingNote = texto(fd, "closingNote");

  await prisma.tradeActivity.update({
    where: { id },
    data: { status, ...(status === "CERRADA" ? { closingNote: closingNote || null } : {}) },
  });
  revalidarTrade(id);
}

/** Lo que se encontró en la tienda: implementada, parcial o ausente, con nota y evidencia. */
export async function verificarEjecucion(fd: FormData) {
  const user = await requireRole(TRADE_CHECK_ROLES);
  const id = texto(fd, "id");
  const status = texto(fd, "status");
  if (!id || !TRADE_EXECUTION.values.includes(status as never)) return;
  const evidence = texto(fd, "evidenceUrl");

  const execution = await prisma.tradeExecution.update({
    where: { id },
    data: {
      status,
      notes: texto(fd, "notes") || null,
      evidenceUrl: /^https?:\/\//i.test(evidence) ? evidence : null,
      checkedAt: status === "PENDIENTE" ? null : new Date(),
      checkedById: status === "PENDIENTE" ? null : user.id,
    },
    select: { activityId: true },
  });
  revalidarTrade(execution.activityId);
}

/** Suma a la actividad tiendas activas del cliente que no estaban (p. ej. una sede nueva). */
export async function agregarTiendas(fd: FormData) {
  await requireRole(TRADE_ROLES);
  const id = texto(fd, "id");
  const storeIds = fd.getAll("storeIds").map(String).filter(Boolean);
  const activity = await prisma.tradeActivity.findUnique({ where: { id }, select: { companyId: true, executions: { select: { storeId: true } } } });
  if (!activity || !storeIds.length) return;

  const already = new Set(activity.executions.map((e) => e.storeId));
  const valid = await prisma.store.findMany({
    where: { id: { in: storeIds.filter((s) => !already.has(s)) }, companyId: activity.companyId },
    select: { id: true },
  });
  for (let i = 0; i < valid.length; i += LOTE_TIENDAS) {
    await prisma.tradeExecution.createMany({ data: valid.slice(i, i + LOTE_TIENDAS).map((s) => ({ activityId: id, storeId: s.id })) });
  }
  revalidarTrade(id);
}

/** Saca una tienda de la actividad: se pactó sin ella o cerró. */
export async function quitarTienda(fd: FormData) {
  await requireRole(TRADE_ROLES);
  const id = texto(fd, "id");
  const execution = await prisma.tradeExecution.findUnique({ where: { id }, select: { activityId: true } });
  if (!execution) return;
  await prisma.tradeExecution.delete({ where: { id } });
  revalidarTrade(execution.activityId);
}
