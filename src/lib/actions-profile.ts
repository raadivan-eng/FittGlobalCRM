"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireUser } from "./auth";
import { AVATAR_COLORS } from "./avatar";

export type ProfileFormState = { error?: string; ok?: string };

const texto = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/**
 * Datos personales del propio usuario. El correo es el identificador de acceso
 * y el perfil/zona los asigna quien administra, así que no se aceptan aquí
 * aunque lleguen en el formulario.
 */
export async function actualizarPerfil(_prev: ProfileFormState, fd: FormData): Promise<ProfileFormState> {
  const me = await requireUser();

  const name = texto(fd, "name");
  const phone = texto(fd, "phone");
  const avatarColor = texto(fd, "avatarColor");

  if (!name) return { error: "Escribe tu nombre." };
  if (name.length > 80) return { error: "El nombre es demasiado largo." };
  if (phone && !/^[+\d][\d\s()-]{6,19}$/.test(phone)) return { error: "Escribe un teléfono válido (sólo dígitos, espacios, guiones y +)." };
  if (!AVATAR_COLORS.includes(avatarColor)) return { error: "Elige un color de la lista." };

  await prisma.user.update({
    where: { id: me.id },
    data: { name, phone: phone || null, avatarColor },
  });

  // El nombre y el avatar se ven en el menú lateral de todas las páginas.
  revalidatePath("/", "layout");
  return { ok: "Datos guardados." };
}

export async function cambiarMiClave(_prev: ProfileFormState, fd: FormData): Promise<ProfileFormState> {
  const me = await requireUser();

  const actual = String(fd.get("current") ?? "");
  const nueva = String(fd.get("password") ?? "");
  const repetida = String(fd.get("confirm") ?? "");

  if (!actual) return { error: "Escribe tu clave actual." };
  if (nueva.length < 8) return { error: "La clave nueva debe tener al menos 8 caracteres." };
  if (nueva !== repetida) return { error: "Las dos claves nuevas no coinciden." };

  const user = await prisma.user.findUnique({ where: { id: me.id }, select: { passwordHash: true } });
  if (!user || !bcrypt.compareSync(actual, user.passwordHash)) return { error: "La clave actual no es correcta." };
  if (bcrypt.compareSync(nueva, user.passwordHash)) return { error: "La clave nueva debe ser distinta de la actual." };

  await prisma.user.update({ where: { id: me.id }, data: { passwordHash: bcrypt.hashSync(nueva, 10) } });
  return { ok: "Clave actualizada. Úsala la próxima vez que entres." };
}
