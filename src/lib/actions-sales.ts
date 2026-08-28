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

  if (existing) {
    await prisma.forecast.update({ where: { id: existing.id }, data: { amount, createdById: user.id } });
  } else {
    await prisma.forecast.create({ data: { period, companyId, amount, units: 0, createdById: user.id } });
  }

  revalidatePath("/forecast");
  revalidatePath("/");
}
