"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { CLIENT_ROLES, requireRole } from "./auth";
import { CHANNELS, COMPANY_TYPES, TIERS } from "./enums";
import { LEAD_ROLES, normalizePhone } from "./leads";

export type ClientFormState = { error?: string; ok?: string };

const texto = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim();
const opcional = (fd: FormData, name: string) => texto(fd, name) || null;

/**
 * Corrige la ficha de un cliente existente: clasificación (tipo, canal, ABC),
 * responsable, datos de contacto y condiciones de crédito. El NIT queda fijo
 * una vez el tercero existe en Siigo, porque allá es la llave del cruce.
 */
export async function guardarCliente(_prev: ClientFormState, fd: FormData): Promise<ClientFormState> {
  await requireRole(CLIENT_ROLES);
  const company = await prisma.company.findUnique({ where: { id: texto(fd, "companyId") }, select: { id: true, siigoId: true, taxId: true } });
  if (!company) return { error: "El cliente ya no existe." };

  const name = texto(fd, "name");
  if (!name) return { error: "Falta la razón social." };
  const type = texto(fd, "type");
  const channel = texto(fd, "channel");
  const tier = texto(fd, "tier");
  if (!COMPANY_TYPES.values.includes(type as never)) return { error: "Tipo de cliente inválido." };
  if (!CHANNELS.values.includes(channel as never)) return { error: "Canal inválido." };
  if (!TIERS.values.includes(tier as never)) return { error: "Clasificación ABC inválida." };

  const creditLimit = Number(texto(fd, "creditLimit") || 0);
  const paymentTermDays = Number(texto(fd, "paymentTermDays") || 0);
  if (!Number.isFinite(creditLimit) || creditLimit < 0) return { error: "El cupo de crédito no es un número válido." };
  if (!Number.isInteger(paymentTermDays) || paymentTermDays < 0 || paymentTermDays > 365) {
    return { error: "El plazo de pago va en días enteros, entre 0 y 365." };
  }

  const phone = normalizePhone(texto(fd, "phone"));
  if (texto(fd, "phone") && !phone) return { error: "El teléfono no parece válido." };

  const ownerId = opcional(fd, "ownerId");
  if (ownerId) {
    const owner = await prisma.user.findFirst({ where: { id: ownerId, active: true, role: { in: LEAD_ROLES } }, select: { id: true } });
    if (!owner) return { error: "El responsable elegido no está activo." };
  }

  await prisma.company.update({
    where: { id: company.id },
    data: {
      name,
      taxId: company.siigoId ? company.taxId : opcional(fd, "taxId"),
      type,
      channel,
      tier,
      ownerId,
      city: opcional(fd, "city"),
      address: opcional(fd, "address"),
      phone,
      email: opcional(fd, "email")?.toLowerCase() ?? null,
      creditLimit,
      paymentTermDays,
      notes: opcional(fd, "notes"),
    },
  });

  // Tipo, canal y ABC alimentan los filtros del listado, los reportes y el tablero.
  revalidatePath(`/clientes/${company.id}`);
  revalidatePath("/clientes");
  revalidatePath("/reportes");
  revalidatePath("/");
  return { ok: "Cliente guardado." };
}
