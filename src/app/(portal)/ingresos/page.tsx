import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { RECEIPT_ROLES, requireSection } from "@/lib/auth";
import { RECEIPT_STATUS } from "@/lib/enums";
import { fmtCompact, fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { flatten, one, pageCount, pagination, type SearchParams } from "@/lib/params";
import { Card, EmptyState, EnumBadge, PageHeader, StatTile } from "@/components/ui";
import { Filters } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import { IconAlert, IconCheck, IconClock, IconPlus, IconReceive } from "@/components/icons";

export const metadata = { title: "Ingresos de mercancía" };
export const dynamic = "force-dynamic";

/** Una factura que lleva más de esto sin recibirse merece una llamada al proveedor. */
const DIAS_SIN_RECIBIR = 7;

export default async function IngresosPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireSection("ingresos");
  const canEdit = RECEIPT_ROLES.includes(user.role);
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const status = one(sp.estado);
  const warehouseId = one(sp.bodega);
  const { page, pageSize, skip, take } = pagination(sp.page, 25);

  const where = {
    ...(status ? { status } : {}),
    ...(warehouseId ? { warehouseId } : {}),
    ...(q ? { OR: [{ code: { contains: q } }, { invoiceNumber: { contains: q } }, { supplierName: { contains: q } }] } : {}),
  };

  const hace30 = new Date(Date.now() - 30 * 86_400_000);
  const [receipts, total, pendientes, recibidos, warehouses] = await Promise.all([
    prisma.goodsReceipt.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        warehouse: { select: { name: true } },
        lines: { select: { quantity: true, unitCost: true } },
        lots: { select: { quantity: true } },
      },
    }),
    prisma.goodsReceipt.count({ where }),
    prisma.goodsReceipt.findMany({ where: { status: "POR_RECIBIR" }, select: { createdAt: true, lines: { select: { quantity: true, unitCost: true } } } }),
    prisma.goodsReceipt.findMany({ where: { status: { in: ["RECIBIDO", "CON_DIFERENCIAS"] }, receivedAt: { gte: hace30 } }, select: { status: true } }),
    prisma.warehouse.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const valor = (lines: { quantity: number; unitCost: number }[]) => lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
  const limite = Date.now() - DIAS_SIN_RECIBIR * 86_400_000;
  const atrasados = pendientes.filter((r) => r.createdAt.getTime() < limite).length;
  const conDiferencias = recibidos.filter((r) => r.status === "CON_DIFERENCIAS").length;
  const vacio = total === 0 && !q && !status && !warehouseId;

  return (
    <>
      <PageHeader
        title="Ingresos de mercancía"
        subtitle="Entrada de producto a bodega en dos pasos: se carga la factura del proveedor y, cuando llega la mercancía, el packing slip certifica lote, vencimiento y cantidad contra lo facturado."
        actions={
          canEdit && (
            <Link href="/ingresos/nuevo" className="btn btn-primary">
              <IconPlus size={14} /> Cargar factura
            </Link>
          )
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Por recibir"
          value={fmtNumber(pendientes.length)}
          hint={`${fmtCompact(pendientes.reduce((s, r) => s + valor(r.lines), 0))} facturado en camino`}
          icon={<IconReceive size={15} />}
          href="/ingresos?estado=POR_RECIBIR"
        />
        <StatTile
          label="Atrasados"
          value={fmtNumber(atrasados)}
          hint={`Facturados hace más de ${DIAS_SIN_RECIBIR} días sin llegar`}
          icon={<IconClock size={15} />}
          href="/ingresos?estado=POR_RECIBIR"
        />
        <StatTile label="Recibidos · 30 días" value={fmtNumber(recibidos.length)} hint="Lotes dados de alta en bodega" icon={<IconCheck size={15} />} href="/ingresos?estado=RECIBIDO" />
        <StatTile
          label="Con diferencias · 30 días"
          value={fmtNumber(conDiferencias)}
          hint="Llegó más o menos de lo facturado"
          icon={<IconAlert size={15} />}
          href="/ingresos?estado=CON_DIFERENCIAS"
        />
      </div>

      <div className="mt-5">
        <Filters
          fields={[
            { type: "search", name: "q", placeholder: "Factura, proveedor o consecutivo…", width: "w-full sm:w-72" },
            { type: "select", name: "estado", label: "Estado", options: RECEIPT_STATUS.options.map((o) => ({ value: o.value, label: o.label })), width: "w-44" },
            { type: "select", name: "bodega", label: "Bodega", options: warehouses.map((w) => ({ value: w.id, label: w.name })), width: "w-52" },
          ]}
        />

        <Card>
          {receipts.length === 0 ? (
            <EmptyState
              icon={<IconReceive size={26} />}
              title={vacio ? "Todavía no hay ingresos" : "Ningún ingreso coincide"}
              description={vacio ? "Carga la factura de un proveedor para preparar la recepción de la mercancía." : "Prueba con otra factura, estado o bodega."}
              action={
                canEdit && (
                  <Link href="/ingresos/nuevo" className="btn btn-primary">
                    <IconPlus size={14} /> Cargar factura
                  </Link>
                )
              }
            />
          ) : (
            <>
              <div className="scroll-x">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Ingreso</th>
                      <th>Proveedor</th>
                      <th>Bodega</th>
                      <th className="num">Facturado</th>
                      <th className="num">Recibido</th>
                      <th className="num">Valor</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.map((r) => {
                      const facturado = r.lines.reduce((s, l) => s + l.quantity, 0);
                      const recibido = r.lots.reduce((s, l) => s + l.quantity, 0);
                      return (
                        <tr key={r.id}>
                          <td className="whitespace-nowrap">
                            <Link href={`/ingresos/${r.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                              Factura {r.invoiceNumber}
                            </Link>
                            <span className="block font-mono text-[11px] text-[var(--text-muted)]">
                              {r.code} · {fmtDate(r.invoiceDate ?? r.createdAt)}
                            </span>
                          </td>
                          <td className="min-w-[180px]">{r.supplierName}</td>
                          <td className="text-[var(--text-secondary)]">{r.warehouse.name}</td>
                          <td className="num">{fmtNumber(facturado)} u</td>
                          <td className="num">
                            {r.status === "POR_RECIBIR" || r.status === "ANULADO" ? (
                              <span className="text-[var(--text-muted)]">—</span>
                            ) : (
                              <>
                                {fmtNumber(recibido)} u
                                {recibido !== facturado && (
                                  <span className="block text-[11px] text-[var(--tone-warning-fg)]">
                                    {recibido > facturado ? "+" : "−"}
                                    {fmtNumber(Math.abs(recibido - facturado))} u
                                  </span>
                                )}
                              </>
                            )}
                          </td>
                          <td className="num">{fmtMoney(valor(r.lines))}</td>
                          <td>
                            <EnumBadge option={RECEIPT_STATUS.get(r.status)} dot />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageCount={pageCount(total, pageSize)} total={total} params={flatten(sp)} basePath="/ingresos" />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
