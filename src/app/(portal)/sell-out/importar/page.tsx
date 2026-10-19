import { prisma } from "@/lib/prisma";
import { requireRole, TRADE_ROLES } from "@/lib/auth";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { SellOutImport } from "./sell-out-import";

export const metadata = { title: "Cargar sell-out" };
export const dynamic = "force-dynamic";

export default async function ImportarSellOutPage() {
  await requireRole(TRADE_ROLES);

  const [companies, products] = await Promise.all([
    prisma.company.findMany({
      where: { active: true, stores: { some: {} } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { active: true },
      select: { id: true, name: true, sku: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Cargar sell-out"
        subtitle="Sube los reportes de venta que descargas de los portales de las cadenas. Primero verás qué entra y qué no se reconoce; nada se escribe hasta que confirmes."
        breadcrumb={[{ label: "Sell out", href: "/sell-out" }, { label: "Cargar" }]}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
        <SellOutImport companies={companies} products={products.map((p) => ({ id: p.id, label: `${p.name} · ${p.sku}` }))} />

        <Card>
          <CardHeader title="Cómo se lee el archivo" />
          <ul className="flex list-disc flex-col gap-2 py-3.5 pl-8 pr-4 text-[12.5px] text-[var(--text-secondary)]">
            <li>
              Puede ser la hoja «SELL OUT» completa: <strong>una pestaña por cadena</strong>. El cliente se reconoce por el
              nombre de la pestaña (FARMATODO, LOCATEL, OLIMPICA, COLSUBSIDIO); si no, lo eliges.
            </li>
            <li>
              Las columnas se reconocen por su encabezado, en cualquier orden: tienda (código), producto (EAN o código de la
              cadena), unidades vendidas y mes o fecha. El valor es opcional.
            </li>
            <li>La tienda se casa por el código con que la cadena la identifica, el mismo del maestro de tiendas.</li>
            <li>
              El producto se casa por EAN. Si el EAN falta o llegó dañado (<code>7.70E+17</code>), se usa el código propio de la
              cadena: el portal lo aprende de las filas que sí casan, o lo fijas una vez aquí.
            </li>
            <li>Cargar un mes de un cliente <strong>reemplaza</strong> ese mes completo: corregir un reporte es volver a subirlo.</li>
            <li>Las devoluciones (clase de movimiento 252 en Olímpica) restan.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
