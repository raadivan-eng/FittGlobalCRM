"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { CONTACT_ROLES, requireRole } from "./auth";
import { normalizePhone } from "./leads";

export type ContactFormState = { error?: string; ok?: string };

const texto = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim();
const opcional = (fd: FormData, name: string) => texto(fd, name) || null;

/** Un contacto aparece en la ficha del cliente, en las de sus tiendas y en el listado. */
async function revalidarContactos(companyId: string, storeIds: string[]) {
  revalidatePath(`/clientes/${companyId}`);
  revalidatePath("/contactos");
  for (const id of storeIds) revalidatePath(`/tiendas/${id}`);
}

/**
 * Crea un contacto del cliente o corrige uno (con `contactId`). Al crearlo se
 * vincula a las tiendas marcadas (`storeIds`), que tienen que ser de ese mismo
 * cliente: un contacto pertenece a un solo cliente.
 */
export async function guardarContacto(_prev: ContactFormState, fd: FormData): Promise<ContactFormState> {
  await requireRole(CONTACT_ROLES);
  const firstName = texto(fd, "firstName");
  if (!firstName) return { error: "Falta el nombre del contacto." };
  const position = texto(fd, "position");
  if (!position) return { error: "Falta el cargo: comprador, jefe de tienda, administrador…" };
  const phone = normalizePhone(texto(fd, "phone"));
  if (texto(fd, "phone") && !phone) return { error: "El teléfono no parece válido." };

  const data = {
    firstName,
    lastName: texto(fd, "lastName"),
    position,
    phone,
    email: opcional(fd, "email")?.toLowerCase() ?? null,
    isPrimary: fd.get("isPrimary") === "on",
    isDecisionMaker: fd.get("isDecisionMaker") === "on",
  };

  const id = opcional(fd, "contactId");
  if (id) {
    const contact = await prisma.contact.findUnique({ where: { id }, select: { companyId: true, stores: { select: { storeId: true } } } });
    if (!contact) return { error: "El contacto ya no existe." };
    await prisma.contact.update({ where: { id }, data });
    await revalidarContactos(contact.companyId, contact.stores.map((s) => s.storeId));
    return { ok: "Contacto guardado." };
  }

  const company = await prisma.company.findUnique({ where: { id: texto(fd, "companyId") }, select: { id: true } });
  if (!company) return { error: "El cliente ya no existe." };
  const pedidas = [...new Set(fd.getAll("storeIds").map(String).filter(Boolean))];
  const stores = pedidas.length
    ? await prisma.store.findMany({ where: { id: { in: pedidas }, companyId: company.id }, select: { id: true } })
    : [];
  if (stores.length !== pedidas.length) return { error: "Sólo se puede vincular a tiendas de este mismo cliente." };

  const contact = await prisma.contact.create({ data: { ...data, companyId: company.id } });
  if (stores.length) {
    await prisma.storeContact.createMany({ data: stores.map((s) => ({ storeId: s.id, contactId: contact.id })) });
  }
  await revalidarContactos(company.id, stores.map((s) => s.id));
  return { ok: "Contacto agregado." };
}

/** Vincula un contacto existente a una tienda del mismo cliente. Repetirlo no duplica. */
export async function vincularContacto(fd: FormData) {
  await requireRole(CONTACT_ROLES);
  const [store, contact] = await Promise.all([
    prisma.store.findUnique({ where: { id: texto(fd, "storeId") }, select: { id: true, companyId: true } }),
    prisma.contact.findUnique({ where: { id: texto(fd, "contactId") }, select: { id: true, companyId: true } }),
  ]);
  if (!store || !contact || store.companyId !== contact.companyId) return;
  await prisma.storeContact.upsert({
    where: { storeId_contactId: { storeId: store.id, contactId: contact.id } },
    create: { storeId: store.id, contactId: contact.id },
    update: {},
  });
  await revalidarContactos(store.companyId, [store.id]);
}

/** Quita el vínculo con la tienda; el contacto sigue en el cliente. */
export async function desvincularContacto(fd: FormData) {
  await requireRole(CONTACT_ROLES);
  const storeId = texto(fd, "storeId");
  const contactId = texto(fd, "contactId");
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { companyId: true } });
  if (!store) return;
  await prisma.storeContact.deleteMany({ where: { storeId, contactId } });
  await revalidarContactos(store.companyId, [storeId]);
}

/** Borra el contacto del cliente y sus vínculos con tiendas. */
export async function eliminarContacto(fd: FormData) {
  await requireRole(CONTACT_ROLES);
  const id = texto(fd, "contactId");
  const contact = await prisma.contact.findUnique({ where: { id }, select: { companyId: true, stores: { select: { storeId: true } } } });
  if (!contact) return;
  await prisma.contact.delete({ where: { id } });
  await revalidarContactos(contact.companyId, contact.stores.map((s) => s.storeId));
}
