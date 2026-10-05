import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "node:crypto";
import { prisma } from "./prisma";
import { sessionSecret } from "./secrets";

const COOKIE = "fitt_session";
const MAX_AGE_SECONDS = 60 * 60 * 12;

function sign(payload: string) {
  return crypto.createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function createSessionToken(userId: string) {
  const body = Buffer.from(
    JSON.stringify({ uid: userId, exp: Date.now() + MAX_AGE_SECONDS * 1000 }),
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

function readToken(token: string): string | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  // timingSafeEqual exige buffers del mismo largo
  const expected = sign(body);
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as { uid: string; exp: number };
    if (!parsed?.uid || parsed.exp < Date.now()) return null;
    return parsed.uid;
  } catch {
    return null;
  }
}

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  zone: string | null;
  avatarColor: string;
};

/** Lectura de sesión memoizada por request. */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const userId = readToken(token);
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, zone: true, avatarColor: true, active: true },
  });
  if (!user?.active) return null;
  const { active: _active, ...session } = user;
  return session;
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(roles: string[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/sin-acceso");
  return user;
}

export async function setSessionCookie(userId: string) {
  (await cookies()).set(COOKIE, createSessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(COOKIE);
}

/** Qué secciones ve cada rol. Se usa tanto en el menú como en los guards de página. */
export const ACCESS: Record<string, string[]> = {
  ADMIN: ["dashboard", "clientes", "contactos", "tiendas", "equipo", "rutas", "visitas", "novedades", "guias", "productos", "inventario", "ventas", "forecast", "reportes", "conexiones"],
  COMERCIAL: ["dashboard", "clientes", "contactos", "tiendas", "rutas", "visitas", "novedades", "guias", "productos", "inventario", "ventas", "forecast", "reportes"],
  SUPERVISOR: ["dashboard", "clientes", "contactos", "tiendas", "equipo", "rutas", "visitas", "novedades", "guias", "productos", "inventario"],
  MERCADERISTA: ["dashboard", "tiendas", "rutas", "visitas", "novedades", "productos"],
};

export const can = (role: string, section: string) => (ACCESS[role] ?? []).includes(section);

/**
 * Guard de página. ACCESS es la única fuente de verdad: gobierna a la vez el
 * menú lateral y el acceso por URL, para que ocultar una sección del menú
 * signifique de verdad que no se puede entrar escribiendo la dirección.
 */
export async function requireSection(section: string): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, section)) redirect("/sin-acceso");
  return user;
}
