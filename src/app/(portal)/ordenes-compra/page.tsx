import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { PURCHASE_ORDER_STATUS } from "@/lib/enums";
import { fmtCompact, fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { flatten, one, pageCount, pagination, type SearchParams } from "@/lib/params";
import { Card, EmptyState, EnumBadge, PageHeader, StatTile } from "@/components/ui";
import { Filters } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import { IconAlert, IconCart, IconOrder, IconTruck } from "@/components/icons";

export const metadata = { title: "Órdenes de compra" };
export const dynamic = "force-dynamic";

const valor = (lines: { quantity: number; unitCost: number }[]) => lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);

export default async function OrdenesCompraPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection("compras");
  const sp = await searchParams;
  const status = one(sp.estado);
  const supplierId = one(sp.proveedor);
  const q = one(sp.q).trim();
  const { page, pageSize, skip, take } = pagination(sp.page, 25);

  const where = {
    ...(status ? { status } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(q ? { OR: [{ code: { contains: q } }, { supplier: { name: { contains: q } } }] } : {}),
  };

  const [orders, total, open, suppliers] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { supplier: { select: { id: true, name: true } }, lines: { select: { quantity: true, unitCost: true } } },
    }),
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({
      where: { status: { in: ["BORRADOR", "EMITIDA"] } },
      select: { status: true, expectedAt: true, lines: { select: { quantity: true, unitCost: true } } },
    }),
    prisma.supplier.findMany({ where: { orders: { some: {} } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const now = new Date();
  const drafts = open.filter((o) => o.status === "BORRADOR");
  const issued = open.filter((o) => o.status === "EMITIDA");
  const late = issued.filter((o) => o.expectedAt && o.expectedAt < now);
  const empty = total === 0 && !status && !supplierId && !q;

  return (
    <>
      <PageHeader
        title="Órdenes de compra"
        subtitle="Lo que se le pide a cada proveedor. Nacen en borrador desde el forecast de compras; al emitirlas cuentan como mercancía en camino hasta que llegan."
        actions={
          <Link href="/compras" className="btn btn-primary">
            <IconCart size={15} /> Forecast de compras
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Borradores" value={fmtNumber(drafts.length)} hint={drafts.length ? `${fmtCompact(drafts.reduce((s, o) => s + valor(o.lines), 0))} por revisar y emitir` : "Nada por emitir"} icon={<IconOrder size={15} />} href="/ordenes-compra?estado=BORRADOR" />
        <StatTile label="En camino" value={fmtCompact(issued.reduce((s, o) => s + valor(o.lines), 0))} hint={`${fmtNumber(issued.length)} órdenes emitidas`} icon={<IconTruck size={15} />} href="/ordenes-compra?estado=EMITIDA" />
        <StatTile label="Atrasadas" value={fmtNumber(late.length)} hint={late.length ? "Pasó la llegada prevista y no se han recibido" : "Todas dentro del lead time"} icon={<IconAlert size={15} />} />
        <StatTile label="Unidades en camino" value={fmtNumber(issued.reduce((s, o) => s + o.lines.reduce((t, l) => t + l.quantity, 0), 0))} hint="Cuentan en el forecast de compras" icon={<IconCart size={15} />} />
      </div>

      <div className="mt-5">
        <Filters
          fields={[
            { type: "search", name: "q", placeholder: "Código o proveedor…" },
            { type: "select", name: "estado", label: "Todos los estados", options: PURCHASE_ORDER_STATUS.options.map((o) => ({ value: o.value, label: o.label })) },
            { type: "select", name: "proveedor", label: "Todos los proveedores", options: suppliers.map((s) => ({ value: s.id, label: s.name })) },
          ]}
        />
        <Card>
          {orders.length === 0 ? (
            <EmptyState
              title={empty ? "Todavía no hay órdenes de compra" : "Ninguna orden coincide"}
              description={empty ? "Genéralas desde el forecast de compras: marca los SKU a pedir y se crea un borrador por proveedor." : "Cambia los filtros para ver el resto."}
              icon={<IconOrder size={22} />}
              action={empty ? <Link href="/compras" className="btn btn-primary">Ir al forecast de compras</Link> : undefined}
            />
          ) : (
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Orden</th>
                    <th>Proveedor</th>
                    <th>Estado</th>
                    <th className="num">SKU</th>
                    <th className="num">Unidades</th>
                    <th className="num">Valor</th>
                    <th>Emitida</th>
                    <th>Llegada prevista</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const overdue = o.status === "EMITIDA" && o.expectedAt && o.expectedAt < now;
                    return (
                      <tr key={o.id}>
                        <td>
                          <Link href={`/ordenes-compra/${o.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                            {o.code}
                          </Link>
                        </td>
                        <td>
                          <Link href={`/proveedores/${o.supplier.id}`} className="hover:text-[var(--brand)] hover:underline">
                            {o.supplier.name}
                          </Link>
                        </td>
                        <td><EnumBadge option={PURCHASE_ORDER_STATUS.get(o.status)} /></td>
                        <td className="num">{fmtNumber(o.lines.length)}</td>
                        <td className="num">{fmtNumber(o.lines.reduce((s, l) => s + l.quantity, 0))}</td>
                        <td className="num font-semibold">{fmtMoney(valor(o.lines))}</td>
                        <td className="whitespace-nowrap text-[var(--text-secondary)]">{o.issuedAt ? fmtDate(o.issuedAt) : "—"}</td>
                        <td className="whitespace-nowrap" style={{ color: overdue ? "var(--tone-danger-fg)" : undefined }}>
                          {o.status === "RECIBIDA" ? `Recibida ${fmtDate(o.receivedAt)}` : o.expectedAt ? fmtDate(o.expectedAt) : "—"}
                          {overdue && " · atrasada"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {orders.length > 0 && <Pagination page={page} pageCount={pageCount(total, pageSize)} total={total} params={flatten(sp)} basePath="/ordenes-compra" />}
        </Card>
      </div>
    </>
  );
}
