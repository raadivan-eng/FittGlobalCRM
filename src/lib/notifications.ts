import "server-only";
import { prisma } from "./prisma";

/** Quiénes reciben los avisos de tiendas: los que pueden revisarlas. */
const STORE_REVIEWERS = ["ADMIN", "SUPERVISOR"];

/**
 * Deja un aviso en la bandeja de cada destinatario: los de `userIds` si viene,
 * si no todos los de `roles`. `exceptUserId` excluye a quien provocó el aviso:
 * no hace falta contarle lo que acaba de hacer.
 */
export async function notify(input: {
  type: string;
  title: string;
  body?: string;
  href?: string;
  roles?: string[];
  userIds?: string[];
  exceptUserId?: string;
}) {
  const users = await prisma.user.findMany({
    where: {
      active: true,
      ...(input.userIds ? { id: { in: input.userIds } } : { role: { in: input.roles ?? STORE_REVIEWERS } }),
      ...(input.exceptUserId ? { NOT: { id: input.exceptUserId } } : {}),
    },
    select: { id: true },
  });
  if (!users.length) return;
  await prisma.notification.createMany({
    data: users.map((u) => ({ userId: u.id, type: input.type, title: input.title, body: input.body, href: input.href })),
  });
}

export const unreadCount = (userId: string) => prisma.notification.count({ where: { userId, readAt: null } });
