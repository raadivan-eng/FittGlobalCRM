import { prisma } from "@/lib/prisma";
import { RECEIPT_ROLES, requireRole } from "@/lib/auth";
import { claudeApiKey } from "@/lib/lector-documentos";
import { PageHeader } from "@/components/ui";
import { InvoiceForm } from "../receipt-controls";

export const metadata = { title: "Cargar factura" };
export const dynamic = "force-dynamic";

export default async function NuevoIngresoPage() {
  await requireRole(RECEIPT_ROLES);

  const [products, warehouses, apiKey] = await Promise.all([
    prisma.product.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, sku: true, name: true } }),
    prisma.warehouse.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, city: true } }),
    claudeApiKey(),
  ]);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Ingresos de mercancía", href: "/ingresos" }, { label: "Cargar factura" }]}
        title="Cargar factura de proveedor"
        subtitle="Paso 1 del ingreso: lo que el proveedor facturó. Cuando llegue la mercancía, el packing slip certifica lote, vencimiento y cantidad contra estos renglones."
      />
      <InvoiceForm products={products} warehouses={warehouses} reader={Boolean(apiKey)} />
    </>
  );
}
