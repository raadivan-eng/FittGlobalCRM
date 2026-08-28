"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireUser } from "./auth";

/** Convierte un plan de ruta en visitas planificadas reales. */
export async function generarVisitasDeRuta(formData: FormData) {
  const user = await requireUser();
  const userId = String(formData.get("userId") ?? "");
  const dateStr = String(formData.get("fecha") ?? "");
  const payload = String(formData.get("plan") ?? "[]");

  if (user.role === "MERCADERISTA" && userId !== user.id) return;

  const plan = JSON.parse(payload) as { storeId: string; sequence: number; travelMinutes: number }[];
  if (!plan.length) return;

  const date = new Date(`${dateStr}T00:00:00`);
  const dayEnd = new Date(date.getTime() + 86_400_000);

  // Idempotente: no duplica una visita ya agendada ese día para la misma tienda.
  const existing = await prisma.visit.findMany({
    where: { userId, plannedDate: { gte: date, lt: dayEnd }, storeId: { in: plan.map((p) => p.storeId) } },
    select: { storeId: true },
  });
  const already = new Set(existing.map((e) => e.storeId));

  const toCreate = plan.filter((p) => !already.has(p.storeId));
  if (toCreate.length) {
    await prisma.visit.createMany({
      data: toCreate.map((p) => ({
        storeId: p.storeId,
        userId,
        plannedDate: date,
        status: "PLANIFICADA",
        sequence: p.sequence,
        travelMinutes: p.travelMinutes,
        objective: "Ruta generada por el planificador",
      })),
    });
  }

  revalidatePath("/rutas");
  revalidatePath("/visitas");
}

export async function actualizarNovedad(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const resolution = String(formData.get("resolution") ?? "").trim();

  if (!id || !["ABIERTA", "EN_PROCESO", "RESUELTA", "DESCARTADA"].includes(status)) return;

  await prisma.incident.update({
    where: { id },
    data: {
      status,
      resolvedAt: ["RESUELTA", "DESCARTADA"].includes(status) ? new Date() : null,
      resolution: resolution || null,
      assignedToId: status === "EN_PROCESO" ? user.id : undefined,
    },
  });

  revalidatePath("/novedades");
  revalidatePath("/");
}

/** Marca la llegada al punto de venta. */
export async function registrarCheckIn(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const visit = await prisma.visit.findUnique({ where: { id }, select: { userId: true, store: { select: { lat: true, lng: true } } } });
  if (!visit) return;
  if (user.role === "MERCADERISTA" && visit.userId !== user.id) return;

  await prisma.visit.update({
    where: { id },
    data: { status: "EN_CURSO", checkInAt: new Date(), checkInLat: visit.store.lat, checkInLng: visit.store.lng },
  });
  revalidatePath("/visitas");
}

/** Cierra la visita y calcula su duración real. */
export async function registrarCheckOut(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const summary = String(formData.get("summary") ?? "").trim();

  const visit = await prisma.visit.findUnique({ where: { id }, select: { userId: true, checkInAt: true } });
  if (!visit) return;
  if (user.role === "MERCADERISTA" && visit.userId !== user.id) return;

  const now = new Date();
  await prisma.visit.update({
    where: { id },
    data: {
      status: "COMPLETADA",
      checkOutAt: now,
      durationMinutes: visit.checkInAt ? Math.max(1, Math.round((now.getTime() - visit.checkInAt.getTime()) / 60000)) : null,
      summary: summary || undefined,
    },
  });
  revalidatePath("/visitas");
  revalidatePath("/");
}
