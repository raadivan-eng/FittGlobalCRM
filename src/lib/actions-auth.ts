"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { clearSessionCookie, setSessionCookie } from "./auth";

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Ingresa tu correo y contraseña." };

  const user = await prisma.user.findUnique({ where: { email } });
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
