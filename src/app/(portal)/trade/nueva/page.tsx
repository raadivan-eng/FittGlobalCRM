import { prisma } from "@/lib/prisma";
import { requireRole, TRADE_ROLES } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ActivityForm, type CompanyOption } from "../activity-form";

export const metadata = { title: "Nueva actividad de trade" };
export const dynamic = "force-dynamic";

export default async function NuevaActividadPage() {
  await requireRole(TRADE_ROLES);

  const [byCity, products, owners] = await Promise.all([
    prisma.store.groupBy({ by: ["companyId", "city"], where: { active: true, company: { active: true } }, _count: true }),
    prisma.product.findMany({ where: { active: true }, select: { id: true, name: true, brand: true }, orderBy: [{ brand: "asc" }, { name: "asc" }] }),
    prisma.user.findMany({ where: { active: true, role: { in: ["ADMIN", "COMERCIAL", "SUPERVISOR"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  // Todos los clientes activos: los traídos de Siigo suelen llegar sin tiendas
  // y se les suman después desde la ficha de la actividad.
  const companies = await prisma.company.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const options: CompanyOption[] = companies.map((c) => ({
    ...c,
    cities: byCity
      .filter((r) => r.companyId === c.id)
      .map((r) => ({ city: r.city, stores: r._count }))
      .sort((a, b) => b.stores - a.stores),
  }));

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Actividades de trade", href: "/trade" }, { label: "Nueva" }]}
        title="Nueva actividad de trade"
        subtitle="Registra lo que se pactó con la cadena y dónde debe verse. Cada tienda queda por verificar hasta que alguien compruebe en góndola que se implementó."
      />
      <ActivityForm companies={options} products={products.map((p) => ({ id: p.id, label: p.name, brand: p.brand }))} owners={owners} />
    </>
  );
}
