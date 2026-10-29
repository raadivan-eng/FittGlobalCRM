import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { FilterBar, type FilterField } from "./filter-bar";

export type { FilterField };

/**
 * Barra de filtros sincronizada con la URL: el estado vive en la query string,
 * así los filtros son compartibles y sobreviven a recargar la página. Carga
 * aquí las vistas guardadas del usuario; la barra se queda con las de la
 * página en curso.
 */
export async function Filters({ fields, extra }: { fields: FilterField[]; extra?: React.ReactNode }) {
  const user = await getSession();
  const views = user
    ? await prisma.savedView.findMany({
        where: { userId: user.id },
        select: { id: true, path: true, name: true, query: true },
        orderBy: { name: "asc" },
      })
    : [];
  return <FilterBar fields={fields} extra={extra} views={views} />;
}
