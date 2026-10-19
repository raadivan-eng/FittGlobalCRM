import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole, TRADE_ROLES } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ActivityForm } from "../../activity-form";

export const metadata = { title: "Editar actividad de trade" };
export const dynamic = "force-dynamic";

/** Fecha guardada al mediodía de Bogotá → valor de <input type="date">. */
const inputDate = (d: Date) => new Date(d.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);

export default async function EditarActividadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(TRADE_ROLES);
  const { id } = await params;

  const [activity, products, owners] = await Promise.all([
    prisma.tradeActivity.findUnique({ where: { id }, include: { company: { select: { name: true } }, products: { select: { productId: true } } } }),
    prisma.product.findMany({ where: { active: true }, select: { id: true, name: true, brand: true }, orderBy: [{ brand: "asc" }, { name: "asc" }] }),
    prisma.user.findMany({ where: { active: true, role: { in: ["ADMIN", "COMERCIAL", "SUPERVISOR"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (!activity) notFound();

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Actividades de trade", href: "/trade" }, { label: activity.code, href: `/trade/${id}` }, { label: "Editar" }]}
        title={`Editar ${activity.code}`}
        subtitle={`${activity.company.name}. Las tiendas se suman o se quitan desde el detalle de la actividad.`}
      />
      <ActivityForm
        products={products.map((p) => ({ id: p.id, label: p.name, brand: p.brand }))}
        owners={owners}
        defaults={{
          id,
          type: activity.type,
          title: activity.title,
          mechanic: activity.mechanic ?? "",
          description: activity.description ?? "",
          startDate: inputDate(activity.startDate),
          endDate: inputDate(activity.endDate),
          budget: activity.budget,
          ownerId: activity.ownerId ?? "",
          productIds: activity.products.map((p) => p.productId),
        }}
      />
    </>
  );
}
