import { requireSection } from "@/lib/auth";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { StatementImport } from "./statement-import";

export const metadata = { title: "Cargar estado de resultados" };
export const dynamic = "force-dynamic";

export default async function CargarResultadosPage() {
  await requireSection("gerencia");

  return (
    <>
      <PageHeader
        title="Cargar estado de resultados"
        subtitle="Sube el estado de resultados de la contabilidad. Primero verás los totales de cada mes para cruzarlos con tu hoja; nada se escribe hasta que confirmes."
        breadcrumb={[{ label: "Gerencia", href: "/gerencia" }, { label: "Estado de resultados", href: "/gerencia/resultados" }, { label: "Cargar" }]}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
        <StatementImport />

        <Card>
          <CardHeader title="Cómo se lee el archivo" />
          <ul className="flex list-disc flex-col gap-2 py-3.5 pl-8 pr-4 text-[12.5px] text-[var(--text-secondary)]">
            <li>
              Una fila de encabezado con <strong>«Nombre»</strong> y, encima, el nombre de cada mes (Enero, Febrero…).
              La columna «% Cump» se ignora: el porcentaje se recalcula.
            </li>
            <li>
              Cada cuenta como <strong>«41359503 - Venta de Alimentos»</strong>. Las filas de grupo y subtotal no hacen
              falta: se rearman a partir del código PUC.
            </li>
            <li>
              Los valores con el signo del reporte: ingresos y gastos en positivo, devoluciones en negativo.
            </li>
            <li>
              Si el mes no trae año, se usa el que elijas. Cargar un mes <strong>lo reemplaza completo</strong>: para
              corregirlo basta con volver a subirlo.
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}
