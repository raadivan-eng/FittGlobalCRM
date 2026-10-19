"use server";

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireSection } from "./auth";
import { ROLES } from "./enums";
import { AVATAR_COLORS } from "./avatar";

export type UserFormState = { error?: string; ok?: string; password?: string; email?: string };

/**
 * Clave temporal legible para dictarla o pegarla en un chat: sin caracteres
 * que se confunden (0/O, 1/l/I) y en tres bloques.
 */
function claveTemporal() {
  const alfabeto = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(12);
  const chars = Array.from(bytes, (b) => alfabeto[b % alfabeto.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((c) => c.join("")).join("-");
}

const texto = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Nunca dejar el portal sin un superadmin activo que pueda volver a dar acceso. */
async function quedariaSinSuperadmin(userId: string) {
  const otros = await prisma.user.count({ where: { role: "ADMIN", active: true, id: { not: userId } } });
  return otros === 0;
}

export async function crearUsuario(_prev: UserFormState, fd: FormData): Promise<UserFormState> {
  await requireSection("usuarios");

  const email = texto(fd, "email").toLowerCase();
  const name = texto(fd, "name");
  const role = texto(fd, "role");
  const propia = texto(fd, "password");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Escribe un correo válido." };
  if (!name) return { error: "Escribe el nombre de la persona." };
  if (!ROLES.values.includes(role as never)) return { error: "Elige un perfil." };
  if (propia && propia.length < 8) return { error: "La clave debe tener al menos 8 caracteres, o déjala vacía para generar una." };
  if (await prisma.user.findUnique({ where: { email } })) return { error: `Ya existe un usuario con ${email}.` };

  const password = propia || claveTemporal();
  await prisma.user.create({
    data: {
      email,
      name,
      role,
      passwordHash: bcrypt.hashSync(password, 10),
      avatarColor: AVATAR_COLORS[crypto.randomInt(AVATAR_COLORS.length)],
    },
  });

  revalidatePath("/usuarios");
  return { ok: `Usuario creado con perfil ${ROLES.label(role)}.`, email, password: propia ? undefined : password };
}

export async function cambiarPerfil(fd: FormData) {
  const me = await requireSection("usuarios");
  const id = texto(fd, "id");
  const role = texto(fd, "role");
  // El propio perfil no se toca desde aquí: un clic perdido dejaría fuera a quien administra.
  if (!id || id === me.id || !ROLES.values.includes(role as never)) return;

  const actual = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!actual || actual.role === role) return;
  if (actual.role === "ADMIN" && (await quedariaSinSuperadmin(id))) return;

  await prisma.user.update({ where: { id }, data: { role } });
  revalidatePath("/usuarios");
}

/** Desactivar corta el acceso al instante: getSession exige `active` en cada request. */
export async function cambiarEstado(fd: FormData) {
  const me = await requireSection("usuarios");
  const id = texto(fd, "id");
  const active = texto(fd, "active") === "1";
  if (!id || id === me.id) return;
  if (!active && (await quedariaSinSuperadmin(id))) return;

  await prisma.user.update({ where: { id }, data: { active } });
  revalidatePath("/usuarios");
}

export async function restablecerClave(_prev: UserFormState, fd: FormData): Promise<UserFormState> {
  await requireSection("usuarios");
  const id = texto(fd, "id");
  const user = await prisma.user.findUnique({ where: { id }, select: { email: true } });
  if (!user) return { error: "El usuario ya no existe." };

  const password = claveTemporal();
  await prisma.user.update({ where: { id }, data: { passwordHash: bcrypt.hashSync(password, 10) } });
  return { ok: "Clave restablecida.", email: user.email, password };
}
