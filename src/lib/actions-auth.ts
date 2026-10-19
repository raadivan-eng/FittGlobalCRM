"use server";

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { clearSessionCookie, setSessionCookie } from "./auth";
import { AVATAR_COLORS } from "./avatar";

/**
 * Autorregistro: un correo del dominio de la empresa que entra con la clave
 * compartida obtiene una cuenta BASIC (sólo consulta) la primera vez. Quien ya
 * tiene cuenta entra con su propia clave, y una cuenta desactivada no revive.
 * Para subirle el rol a alguien, se hace en Usuarios.
 */
const DOMINIO_EMPRESA = "@fittglobal.com";
const CLAVE_COMPARTIDA = process.env.AUTOREGISTRO_CLAVE || "fitt2026";

/** «maria.lopez@…» → «Maria Lopez»: un nombre provisional que se corrige en Usuarios. */
const nombreDesdeCorreo = (email: string) =>
  email
    .slice(0, -DOMINIO_EMPRESA.length)
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ");

async function autorregistrar(email: string) {
  try {
    return await prisma.user.create({
      data: {
        email,
        name: nombreDesdeCorreo(email),
        passwordHash: bcrypt.hashSync(CLAVE_COMPARTIDA, 10),
        role: "BASIC",
        avatarColor: AVATAR_COLORS[crypto.randomInt(AVATAR_COLORS.length)],
      },
    });
  } catch {
    // Dos ingresos simultáneos con el mismo correo: el otro ya la creó.
    return prisma.user.findUnique({ where: { email } });
  }
}

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Ingresa tu correo y contraseña." };

  let user = await prisma.user.findUnique({ where: { email } });
  if (
    !user &&
    password === CLAVE_COMPARTIDA &&
    email.endsWith(DOMINIO_EMPRESA) &&
    /^[a-z0-9][a-z0-9._-]*$/.test(email.slice(0, -DOMINIO_EMPRESA.length))
  ) {
    user = await autorregistrar(email);
  }
  if (!user || !user.active || !bcrypt.compareSync(password, user.passwordHash)) {
    return { error: "Credenciales incorrectas. Verifica el correo y la contraseña." };
  }

  await setSessionCookie(user.id);
  redirect("/");
}

export async function logoutAction() {
  await clearSessionCookie();
  redirect("/login");
}
