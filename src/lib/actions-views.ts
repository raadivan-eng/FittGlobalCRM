"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireUser } from "./auth";

export type SavedViewResult = { error?: string; id?: string };

/** Quita la paginación: una vista guardada siempre abre en la primera página. */
function cleanQuery(query: string) {
  const q = new URLSearchParams(query);
  q.delete("page");
  return q.toString();
}

/**
 * Guarda los filtros actuales de una página con un nombre. Si el usuario ya
 * tiene una vista con ese nombre en la misma página, la reemplaza.
 */
export async function guardarVista(path: string, name: string, query: string): Promise<SavedViewResult> {
  const me = await requireUser();
  const nombre = name.trim();
  if (!path.startsWith("/")) return { error: "Ruta no válida." };
  if (!nombre) return { error: "Ponle un nombre a la vista." };
  if (nombre.length > 60) return { error: "El nombre es demasiado largo." };

  const view = await prisma.savedView.upsert({
    where: { userId_path_name: { userId: me.id, path, name: nombre } },
    update: { query: cleanQuery(query) },
    create: { userId: me.id, path, name: nombre, query: cleanQuery(query) },
    select: { id: true },
  });
  revalidatePath(path);
  return { id: view.id };
}

export async function eliminarVista(id: string): Promise<SavedViewResult> {
  const me = await requireUser();
  const view = await prisma.savedView.findFirst({ where: { id, userId: me.id }, select: { path: true } });
  if (!view) return { error: "La vista ya no existe." };
  await prisma.savedView.delete({ where: { id } });
  revalidatePath(view.path);
  return {};
}
