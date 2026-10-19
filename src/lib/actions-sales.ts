"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireRole } from "./auth";

/**
 * Alta o actualización del forecast de un cliente para un período.
 * No hay índice único sobre (period, companyId) —SQLite trata los NULL como
 * distintos— así que la unicidad se resuelve aquí de forma explícita.
 */
export async function guardarForecast(formData: FormData) {
  const user = await requireRole(["ADMIN", "COMERCIAL"]);

  const period = String(formData.get("period") ?? "");
  const companyId = String(formData.get("companyId") ?? "");
  const raw = String(formData.get("amount") ?? "").replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
  const amount = Number(raw);

  if (!/^\d{4}-\d{2}$/.test(period) || !companyId || !Number.isFinite(amount) || amount < 0) return;

  const existing = await prisma.forecast.findFirst({ where: { period, companyId, productId: null } });

  // Vacío borra la carga manual y el cliente vuelve a proyectarse por promedio.
  if (raw === "") {
    if (existing) await prisma.forecast.delete({ where: { id: existing.id } });
  } else if (existing) {
    await prisma.forecast.update({ where: { id: existing.id }, data: { amount, createdById: user.id } });
  } else {
    await prisma.forecast.create({ data: { period, companyId, amount, units: 0, createdById: user.id } });
  }

  revalidatePath("/forecast");
  revalidatePath(`/clientes/${companyId}`);
  revalidatePath("/");
}

function revalidateForecast(companyId?: string | null) {
  revalidatePath("/forecast");
  revalidatePath("/");
  if (companyId) revalidatePath(`/clientes/${companyId}`);
  else revalidatePath("/clientes/[id]", "page");
}

/**
 * Marca o desmarca un mes como extraordinario para todos los clientes: sale del
 * promedio con que se proyecta el forecast de cada uno.
 */
export async function alternarMesExtraordinario(formData: FormData) {
  const user = await requireRole(["ADMIN", "COMERCIAL"]);

  const period = String(formData.get("period") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!/^\d{4}-\d{2}$/.test(period)) return;

  const existing = await prisma.forecastExclusion.findFirst({ where: { period, companyId: null } });
  if (existing) {
    await prisma.forecastExclusion.delete({ where: { id: existing.id } });
  } else {
    await prisma.forecastExclusion.create({ data: { period, notes, createdById: user.id } });
  }

  revalidateForecast();
}

/** Quita un ajuste puntual, sea global o de un cliente. */
export async function quitarMesExtraordinario(formData: FormData) {
  await requireRole(["ADMIN", "COMERCIAL"]);

  const id = String(formData.get("id") ?? "");
  const existing = id ? await prisma.forecastExclusion.findUnique({ where: { id } }) : null;
  if (!existing) return;

  await prisma.forecastExclusion.delete({ where: { id } });
  revalidateForecast(existing.companyId);
}

/**
 * Deja los meses extraordinarios de un cliente tal como vienen en el
 * formulario: `months` son todos los meses que se mostraron y `excluir` los
 * marcados. Repetirlo no cambia nada, así que es seguro sin transacción en D1.
 */
export async function ajustarMesesCliente(formData: FormData) {
  const user = await requireRole(["ADMIN", "COMERCIAL"]);

  const companyId = String(formData.get("companyId") ?? "");
  const months = formData.getAll("months").map(String).filter((p) => /^\d{4}-\d{2}$/.test(p));
  const marked = new Set(formData.getAll("excluir").map(String));
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!companyId || months.length === 0) return;

  const existing = await prisma.forecastExclusion.findMany({ where: { companyId, period: { in: months } } });
  const have = new Set(existing.map((e) => e.period));

  const remove = existing.filter((e) => !marked.has(e.period)).map((e) => e.id);
  const add = months.filter((p) => marked.has(p) && !have.has(p));
  const keep = existing.filter((e) => marked.has(e.period)).map((e) => e.id);

  if (remove.length) await prisma.forecastExclusion.deleteMany({ where: { id: { in: remove } } });
  if (add.length) {
    await prisma.forecastExclusion.createMany({
      data: add.map((period) => ({ period, companyId, notes, createdById: user.id })),
    });
  }
  // La nota describe el ajuste completo del cliente: se aplica también a los que siguen marcados.
  if (keep.length) await prisma.forecastExclusion.updateMany({ where: { id: { in: keep } }, data: { notes } });

  revalidateForecast(companyId);
}
