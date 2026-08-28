import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { billedBetween, lastMonths, NOT_VOID, periodKey, receivables, startOfMonth } from "@/lib/analytics";
import { INVOICE_STATUS, ORDER_STATUS } from "@/lib/enums";
import { fmtCompact, fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { flatten, one, pageCount, pagination, type SearchParams } from "@/lib/params";
import { Card, CardHeader, EmptyState, EnumBadge, PageHeader, StatTile } from "@/components/ui";
import { LineChart } from "@/components/charts";
import { Pagination } from "@/components/pagination";
import { Filters } from "@/components/filters";
import { IconAlert, IconSales, IconTarget } from "@/components/icons";

export const metadata = { title: "Ventas y facturación" };
export const dynamic = "force-dynamic";

const INVOICE_STATES = new Set(INVOICE_STATUS.values as string[]);

export default async function VentasPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection("ventas");
  const sp = await searchParams;
  const statusParam = one(sp.estado);
  // Un estado de factura en la URL (p. ej. desde el panel) abre directamente esa vista.
  const view = one(sp.vista) || (statusParam && INVOICE_STATES.has(statusParam) ? "facturas" : "pedidos");
  const companyId = one(sp.cliente);
  const { page, pageSize, skip, take } = pagination(sp.page, 25);

  const now = new Date();
  const monthStart = startOfMonth(0, now);
  const nextMonth = startOfMonth(1, now);
  const range = lastMonths(12, now);

  const [mtd, cart, invoices12, companies, orderStats] = await Promise.all([
    billedBetween(monthStart, nextMonth),
    receivables(),
    prisma.invoice.findMany({ where: { issueDate: { gte: range[0].start }, status: NOT_VOID }, select: { issueDate: true, total: true } }),
    prisma.company.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.salesOrder.aggregate({ where: { date: { gte: monthStart, lt: nextMonth }, status: NOT_VOID }, _count: true, _sum: { total: true } }),
  ]);

  const byPeriod = new Map<string, number>();
  for (const i of invoices12) byPeriod.set(periodKey(i.issueDate), (byPeriod.get(periodKey(i.issueDate)) ?? 0) + i.total);

  const avgTicket = orderStats._count ? (orderStats._sum.total ?? 0) / orderStats._count : 0;

  const orderWhere = {
    ...(companyId ? { companyId } : {}),
    ...(statusParam && !INVOICE_STATES.has(statusParam) ? { status: statusParam } : {}),
  };
  const invoiceWhere = {
    ...(companyId ? { companyId } : {}),
    ...(statusParam && INVOICE_STATES.has(statusParam) ? { status: statusParam } : {}),
  };

  const [orders, orderCount, invoiceRows, invoiceCount] = await Promise.all([
    view === "pedidos"
      ? prisma.salesOrder.findMany({
          where: orderWhere,
          orderBy: { date: "desc" },
          skip,
          take,
          include: { company: { select: { id: true, name: true } }, store: { select: { name: true } }, invoice: { select: { number: true, status: true } }, _count: { select: { lines: true } } },
        })
      : Promise.resolve([]),
    view === "pedidos" ? prisma.salesOrder.count({ where: orderWhere }) : Promise.resolve(0),
    view === "facturas"
      ? prisma.invoice.findMany({
          where: invoiceWhere,
          orderBy: { issueDate: "desc" },
          skip,
          take,
          include: { company: { select: { id: true, name: true } }, order: { select: { number: true } } },
        })
      : Promise.resolve([]),
    view === "facturas" ? prisma.invoice.count({ where: invoiceWhere }) : Promise.resolve(0),
  ]);

  const total = view === "pedidos" ? orderCount : invoiceCount;
  const tab = (key: string, label: string) => {
    const q = new URLSearchParams();
    q.set("vista", key);
    if (companyId) q.set("cliente", companyId);
    return (
      <Link
        key={key}
        href={`/ventas?${q.toString()}`}
        className={`btn ${view === key ? "btn-primary" : "btn-secondary"} !py-1 text-[12.5px]`}
      >
        {label}
      </Link>
    );
  };

  return (
    <>
      <PageHeader
        title="Ventas y facturación"
        subtitle="Pedidos, facturación emitida y estado de la cartera. La facturación es la medida contra la que se contrasta el forecast."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Facturado en el mes" value={fmtCompact(mtd.total)} hint={`${fmtNumber(mtd.count)} facturas emitidas`} icon={<IconSales size={15} />} />
        <StatTile label="Pedidos del mes" value={fmtNumber(orderStats._count)} hint={`Ticket medio ${fmtCompact(avgTicket)}`} icon={<IconTarget size={15} />} />
        <StatTile label="Por cobrar" value={fmtCompact(cart.open)} hint={`${fmtNumber(cart.count)} facturas pendientes`} icon={<IconSales size={15} />} />
        <StatTile label="Cartera vencida" value={fmtCompact(cart.overdue)} hint={`${((cart.overdue / Math.max(1, cart.open)) * 100).toFixed(0)}% de lo pendiente`} icon={<IconAlert size={15} />} href="/ventas?estado=VENCIDA" />
      </div>

      <Card className="mt-5">
        <CardHeader title="Facturación mensual" subtitle="Últimos doce meses" />
        <div className="px-4 py-4">
          <LineChart
            data={range.map((r) => ({ label: r.label, values: [Math.round(byPeriod.get(r.period) ?? 0)] }))}
            series={[{ name: "Facturación emitida", color: "var(--series-1)" }]}
            format="compact"
            height={220}
          />
        </div>
      </Card>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {tab("pedidos", "Pedidos")}
        {tab("facturas", "Facturación")}
      </div>

      <div className="mt-3">
        <Filters
          fields={[
            { type: "select", name: "cliente", label: "Todos los clientes", options: companies.map((c) => ({ value: c.id, label: c.name })), width: "w-60" },
            {
              type: "select",
              name: "estado",
              label: "Estado",
              options: (view === "pedidos" ? ORDER_STATUS.options : INVOICE_STATUS.options).map((o) => ({ value: o.value, label: o.label })),
            },
          ]}
        />

        <Card>
          {total === 0 ? (
            <EmptyState icon={<IconSales size={26} />} title="Sin registros" description="Ajusta los filtros para ver otros documentos." />
          ) : (
            <>
              <div className="scroll-x">
                {view === "pedidos" ? (
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Pedido</th>
                        <th>Fecha</th>
                        <th>Cliente</th>
                        <th>Entrega</th>
                        <th>Estado</th>
                        <th className="num">Descuento</th>
                        <th className="num">Total</th>
                        <th>Factura</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => (
                        <tr key={o.id}>
                          <td>
                            <span className="font-mono text-[12px] font-medium">{o.number}</span>
                            <p className="text-[11px] text-[var(--text-muted)]">{o._count.lines} líneas</p>
                          </td>
                          <td className="whitespace-nowrap text-[var(--text-secondary)]">{fmtDate(o.date)}</td>
                          <td>
                            <Link href={`/clientes/${o.company.id}`} className="hover:text-[var(--brand)] hover:underline">
                              {o.company.name}
                            </Link>
                          </td>
                          <td className="text-[var(--text-secondary)]">{o.store?.name ?? "Centralizada"}</td>
                          <td><EnumBadge option={ORDER_STATUS.get(o.status)} /></td>
                          <td className="num text-[var(--text-secondary)]">{o.discount > 0 ? fmtMoney(o.discount) : "—"}</td>
                          <td className="num font-semibold">{fmtMoney(o.total)}</td>
                          <td className="font-mono text-[11.5px] text-[var(--text-secondary)]">{o.invoice?.number ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Factura</th>
                        <th>Emisión</th>
                        <th>Vencimiento</th>
                        <th>Cliente</th>
                        <th>Estado</th>
                        <th className="num">Total</th>
                        <th className="num">Pagado</th>
                        <th className="num">Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoiceRows.map((i) => {
                        const balance = i.total - i.paidAmount;
                        const overdue = i.dueDate < now && balance > 0;
                        return (
                          <tr key={i.id}>
                            <td>
                              <span className="font-mono text-[12px] font-medium">{i.number}</span>
                              <p className="font-mono text-[11px] text-[var(--text-muted)]">{i.order?.number ?? "—"}</p>
                            </td>
                            <td className="whitespace-nowrap text-[var(--text-secondary)]">{fmtDate(i.issueDate)}</td>
                            <td className={`whitespace-nowrap ${overdue ? "font-medium text-[var(--critical)]" : "text-[var(--text-secondary)]"}`}>{fmtDate(i.dueDate)}</td>
                            <td>
                              <Link href={`/clientes/${i.company.id}`} className="hover:text-[var(--brand)] hover:underline">
                                {i.company.name}
                              </Link>
                            </td>
                            <td><EnumBadge option={INVOICE_STATUS.get(i.status)} dot /></td>
                            <td className="num">{fmtMoney(i.total)}</td>
                            <td className="num text-[var(--text-secondary)]">{fmtMoney(i.paidAmount)}</td>
                            <td className="num font-semibold">{balance > 0 ? fmtMoney(balance) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              <Pagination page={page} pageCount={pageCount(total, pageSize)} total={total} params={flatten(sp)} basePath="/ventas" />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
