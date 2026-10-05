import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { carrierCapabilities } from "@/lib/carriers";
import { ORDER_STATUS } from "@/lib/enums";
import { fmtDate, fmtMoney } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";
import { PageHeader } from "@/components/ui";
import { ShipmentForm, type OrderOption } from "./shipment-form";

export const metadata = { title: "Nueva guía" };
export const dynamic = "force-dynamic";

/** Hasta dónde se ofrecen pedidos para asociar: los despachos rara vez esperan más. */
const DIAS_PEDIDOS = 60;

export default async function NuevaGuiaPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection("guias");
  const sp = await searchParams;

  const [caps, orders] = await Promise.all([
    carrierCapabilities(),
    prisma.salesOrder.findMany({
      where: {
        status: { in: ["CONFIRMADO", "DESPACHADO", "FACTURADO"] },
        date: { gte: new Date(Date.now() - DIAS_PEDIDOS * 86_400_000) },
      },
      orderBy: { date: "desc" },
      take: 300,
      select: {
        id: true,
        number: true,
        date: true,
        status: true,
        total: true,
        company: { select: { name: true, address: true, city: true, phone: true } },
        store: { select: { name: true, address: true, city: true } },
        _count: { select: { shipments: { where: { status: { not: "ANULADA" } } } } },
      },
    }),
  ]);

  // Primero los pedidos que todavía no tienen guía: son los que están por despachar.
  const options: OrderOption[] = [...orders]
    .sort((a, b) => Number(a._count.shipments > 0) - Number(b._count.shipments > 0))
    .map((o) => ({
      id: o.id,
      label: `${o.number} · ${o.company.name}${o.store ? ` · ${o.store.name}` : ""} · ${fmtDate(o.date)} · ${fmtMoney(o.total)} · ${ORDER_STATUS.label(o.status)}${o._count.shipments ? " · ya tiene guía" : ""}`,
      recipientName: o.store ? `${o.company.name} — ${o.store.name}` : o.company.name,
      recipientPhone: o.company.phone ?? "",
      destinationAddress: o.store?.address ?? o.company.address ?? "",
      destinationCity: o.store?.city ?? o.company.city ?? "",
      declaredValue: Math.round(o.total),
    }));

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Guías de envío", href: "/guias" }, { label: "Nueva guía" }]}
        title="Nueva guía"
        subtitle="Registra una guía ya hecha en el sitio de la transportadora o, si su API está conectada, pídela desde aquí. Asociarla a un pedido llena el destino y marca el pedido como despachado."
      />
      <ShipmentForm
        carriers={caps.map((c) => ({ key: c.key, name: c.name, canCreate: c.canCreate }))}
        orders={options}
        defaultOrderId={one(sp.pedido)}
      />
    </>
  );
}
