import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PURCHASE_ROLES, requireSection } from "@/lib/auth";
import { PURCHASE_ORDER_STATUS } from "@/lib/enums";
import { anularOrdenCompra, emitirOrdenCompra, guardarCantidadesOrden, recibirOrdenCompra } from "@/lib/actions-purchasing";
import { fmtDate, fmtDateShort, fmtMoney, fmtMoneyPrecise, fmtNumber } from "@/lib/format";
import { Card, CardHeader, EnumBadge, KeyValue, PageHeader, StatTile } from "@/components/ui";
import { IconCart, IconClock, IconOrder, IconSales } from "@/components/icons";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await prisma.purchaseOrder.findUnique({ where: { id }, select: { code: true } });
  return { title: order?.code ?? "Orden de compra" };
}

export default async function OrdenCompraPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireSection("compras");
  const { id } = await params;

  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, code: true, paymentTerms: true, contactName: true, email: true, phone: true } },
      createdBy: { select: { name: true } },
      lines: { include: { product: { select: { id: true, sku: true, name: true, imageEmoji: true, unitsPerCase: true } } } },
    },
  });
  if (!order) notFound();

  // Condiciones vigentes, para avisar si una cantidad quedó por debajo del mínimo del proveedor.
  const conditions = await prisma.supplierProduct.findMany({
    where: { supplierId: order.supplierId, productId: { in: order.lines.map((l) => l.productId) } },
    select: { productId: true, minOrderQty: true },
  });
  const minimum = new Map(conditions.map((c) => [c.productId!, c.minOrderQty]));

  const editable = PURCHASE_ROLES.includes(user.role);
  const draft = order.status === "BORRADOR" && editable;
  const lines = [...order.lines].sort((a, b) => a.product.sku.localeCompare(b.product.sku));
  const total = lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
  const units = lines.reduce((s, l) => s + l.quantity, 0);
  const suggested = lines.reduce((s, l) => s + l.suggestedQty, 0);
  const lead = lines.length ? Math.max(...lines.map((l) => l.leadDays)) : 0;
  const late = order.status === "EMITIDA" && order.expectedAt && order.expectedAt < new Date();

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Órdenes de compra", href: "/ordenes-compra" }, { label: order.code }]}
        title={`${order.code} · ${order.supplier.name}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <EnumBadge option={PURCHASE_ORDER_STATUS.get(order.status)} />
            <span className="text-[12.5px] text-[var(--text-muted)]">
              Creada el {fmtDate(order.createdAt)}
              {order.createdBy ? ` por ${order.createdBy.name}` : ""}
              {order.notes ? ` · ${order.notes}` : ""}
            </span>
          </span>
        }
        actions={
          editable && order.status === "EMITIDA" ? (
            <form action={recibirOrdenCompra}>
              <input type="hidden" name="orderId" value={order.id} />
              <button className="btn btn-primary">Marcar recibida</button>
            </form>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Valor" value={fmtMoney(total)} hint="Sin IVA, con el costo de las condiciones" icon={<IconSales size={15} />} />
        <StatTile
          label="Unidades"
          value={fmtNumber(units)}
          hint={suggested && suggested !== units ? `Sugerido: ${fmtNumber(suggested)} (${units > suggested ? "+" : "−"}${fmtNumber(Math.abs(units - suggested))})` : "Igual a lo sugerido"}
          icon={<IconCart size={15} />}
        />
        <StatTile label="Lead time" value={`${lead} d`} hint="El renglón que más tarda" icon={<IconClock size={15} />} />
        <StatTile
          label={order.status === "RECIBIDA" ? "Recibida" : "Llegada prevista"}
          value={order.status === "RECIBIDA" ? fmtDate(order.receivedAt) : order.expectedAt ? fmtDate(order.expectedAt) : "Al emitir"}
          hint={late ? "Atrasada: pasó la fecha y no se ha recibido" : order.issuedAt ? `Emitida el ${fmtDate(order.issuedAt)}` : `${lead} días después de emitirla`}
          icon={<IconOrder size={15} />}
        />
      </div>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Renglones"
            subtitle={draft ? "Ajusta las cantidades antes de emitir; en cero, el renglón sale de la orden." : "Lo que se le pidió al proveedor."}
          />
          <form action={guardarCantidadesOrden}>
            <input type="hidden" name="orderId" value={order.id} />
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="num">Sugerido</th>
                    <th className="num">Cantidad</th>
                    <th className="num">Costo</th>
                    <th className="num">Valor</th>
                    <th className="num">Lead time</th>
                    <th>Llega</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const min = minimum.get(l.productId);
                    return (
                      <tr key={l.id}>
                        <td className="min-w-[200px]">
                          <Link href={`/productos/${l.product.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                            {l.product.imageEmoji} {l.product.name}
                          </Link>
                          <span className="block text-[11.5px] text-[var(--text-muted)]">
                            {l.product.sku} · caja de {l.product.unitsPerCase}
                            {min != null && ` · mín. ${fmtNumber(min)}`}
                          </span>
                        </td>
                        <td className="num text-[var(--text-secondary)]">{l.suggestedQty ? fmtNumber(l.suggestedQty) : "—"}</td>
                        <td className="num whitespace-nowrap">
                          {draft ? (
                            <input name={`qty-${l.id}`} defaultValue={l.quantity} inputMode="numeric" className="field !w-24 !py-0.5 text-right" aria-label={`Cantidad de ${l.product.name}`} />
                          ) : (
                            <span className="font-semibold">{fmtNumber(l.quantity)}</span>
                          )}
                          {min != null && l.quantity < min && <span className="block text-[11px] text-[var(--tone-danger-fg)]">Bajo el mínimo</span>}
                          {l.quantity % l.product.unitsPerCase !== 0 && <span className="block text-[11px] text-[var(--tone-warning-fg)]">Cajas incompletas</span>}
                        </td>
                        <td className="num">{fmtMoneyPrecise(l.unitCost)}</td>
                        <td className="num font-semibold">{fmtMoney(l.quantity * l.unitCost)}</td>
                        <td className="num">{l.leadDays} d</td>
                        <td className="whitespace-nowrap text-[var(--text-secondary)]">{l.expectedAt ? fmtDateShort(l.expectedAt) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-[var(--surface-2)] font-semibold">
                    <td colSpan={2}>Total</td>
                    <td className="num">{fmtNumber(units)}</td>
                    <td />
                    <td className="num">{fmtMoney(total)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
            {draft && (
              <div className="flex flex-col gap-3 border-t border-[var(--border)] px-4 py-3">
                <label className="flex flex-col gap-1 text-[12.5px]">
                  <span className="font-medium">Nota para el proveedor</span>
                  <textarea name="notes" defaultValue={order.notes ?? ""} rows={2} className="field" />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="submit" className="btn btn-secondary">Guardar cambios</button>
                  <button type="submit" formAction={emitirOrdenCompra} className="btn btn-primary">Emitir orden</button>
                  <span className="text-[12px] text-[var(--text-muted)]">Al emitirla cuenta como mercancía en camino en el forecast de compras.</span>
                </div>
              </div>
            )}
          </form>
        </Card>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <Card>
            <CardHeader title="Proveedor" action={<Link href={`/proveedores/${order.supplier.id}`} className="btn btn-ghost !px-2 text-[12.5px]">Ver ficha</Link>} />
            <dl className="grid grid-cols-2 gap-x-4 px-4 py-3">
              <KeyValue label="Código">{order.supplier.code}</KeyValue>
              <KeyValue label="Condiciones de pago">{order.supplier.paymentTerms ?? <span className="text-[var(--text-muted)]">Sin definir</span>}</KeyValue>
              <KeyValue label="Contacto">{order.supplier.contactName ?? <span className="text-[var(--text-muted)]">—</span>}</KeyValue>
              <KeyValue label="Correo">{order.supplier.email ?? <span className="text-[var(--text-muted)]">—</span>}</KeyValue>
            </dl>
          </Card>

          {editable && ["BORRADOR", "EMITIDA"].includes(order.status) && (
            <Card>
              <CardHeader title="Anular" subtitle="La orden deja de contar en el forecast de compras. No se puede deshacer." />
              <form action={anularOrdenCompra} className="px-4 py-3">
                <input type="hidden" name="orderId" value={order.id} />
                <button className="btn btn-secondary">Anular orden</button>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
