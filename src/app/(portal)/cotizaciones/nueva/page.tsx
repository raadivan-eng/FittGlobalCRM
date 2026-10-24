import { prisma } from "@/lib/prisma";
import { requireSection, SUPPLIER_ROLES } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { NewQuoteForm } from "../quote-controls";

export const metadata = { title: "Nueva cotización" };
export const dynamic = "force-dynamic";

export default async function NuevaCotizacionPage() {
  const user = await requireSection("proveedores");
  const owners = await prisma.user.findMany({
    where: { active: true, role: { in: SUPPLIER_ROLES } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Cotizaciones", href: "/cotizaciones" }, { label: "Nueva cotización" }]}
        title="Nueva cotización"
        subtitle="Los SKU que se le piden a un proveedor nuevo y lo que responda por cada uno: cantidad mínima, costo, producción y tránsito. Cuando se confirmen las condiciones de compra, se aprueba y se vuelve proveedor."
      />
      <NewQuoteForm owners={owners} defaultOwnerId={user.id} />
    </>
  );
}
