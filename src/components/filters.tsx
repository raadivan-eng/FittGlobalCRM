import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { FilterBar, type FilterField } from "./filter-bar";

export type { FilterField };

/** El interruptor de notas crédito de toda vista de facturación (ver netOfCredits). */
export const CREDIT_NOTES_FILTER: FilterField = {
  type: "select",
  name: "nc",
  label: "Descontando notas crédito",
  width: "w-56",
  options: [{ value: "sin", label: "Sin descontar notas crédito" }],
};

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

/** El mismo interruptor para las cabeceras que filtran con un formulario simple. */
export function CreditNotesSelect({ net }: { net: boolean }) {
  return (
    <select name="nc" defaultValue={net ? "" : "sin"} className="field w-56" aria-label="Notas crédito">
      <option value="">Descontando notas crédito</option>
      <option value="sin">Sin descontar notas crédito</option>
    </select>
  );
}
