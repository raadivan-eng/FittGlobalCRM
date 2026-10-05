import { requireRole } from "@/lib/auth";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { StoreImport } from "./store-import";

export const metadata = { title: "Importar tiendas" };
export const dynamic = "force-dynamic";

export default async function ImportarTiendasPage() {
  await requireRole(["ADMIN", "SUPERVISOR"]);

  return (
    <>
      <PageHeader
        title="Importar tiendas"
        subtitle="Carga el maestro de puntos de venta desde el Excel del equipo. Primero verás qué va a cambiar; nada se escribe hasta que confirmes."
        breadcrumb={[{ label: "Tiendas", href: "/tiendas" }, { label: "Importar" }]}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
        <StoreImport />

        <Card>
          <CardHeader title="Cómo se lee el archivo" />
          <ul className="flex list-disc flex-col gap-2 py-3.5 pl-8 pr-4 text-[12.5px] text-[var(--text-secondary)]">
            <li>
              Columnas: código, EAN localizador, razón social, nombre, dirección, ciudad, departamento y mercaderista.
              Las pestañas sin encabezado se leen en ese mismo orden.
            </li>
            <li>Las pestañas <strong>TAT</strong> entran como canal tradicional y tienda especializada.</li>
            <li>
              El código sólo es único dentro de cada cliente. Si dos filas del mismo cliente comparten código con datos
              distintos, ninguna se importa hasta que se corrija la hoja.
            </li>
            <li>
              Centros de distribución, oficinas, canales virtuales, tiendas cerradas y filas «No aplica» se guardan como
              <strong> no visitables</strong>: quedan registradas, pero no entran a las rutas.
            </li>
            <li>
              La hoja manda en nombre, dirección, ciudad, GLN y mercaderista. Las coordenadas, el formato, el ABC y la
              frecuencia se trabajan en el portal y no se pisan.
            </li>
            <li>Una tienda sin coordenadas no entra al planificador hasta geocodificar su dirección.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
