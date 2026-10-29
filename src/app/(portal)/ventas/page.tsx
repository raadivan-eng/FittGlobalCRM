import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { NOT_VOID, periodKey, periodShort, receivables, startOfMonth } from "@/lib/analytics";
import { COMPANY_TYPES, INVOICE_STATUS, ORDER_STATUS } from "@/lib/enums";
import { fmtCompact, fmtDate, fmtDateShort, fmtMoney, fmtNumber } from "@/lib/format";
import { anyOf, flatten, many, one, pageCount, pagination, parseDay, type SearchParams } from "@/lib/params";
import { Card, CardHeader, EmptyState, EnumBadge, PageHeader, StatTile } from "@/components/ui";
import { LineChart } from "@/components/charts";
import { Pagination } from "@/components/pagination";
import { Filters } from "@/components/filters";
import { IconAlert, IconSales, IconTarget } from "@/components/icons";

export const metadata = { title: "Ventas y facturación" };
export const dynamic = "force-dynamic";

const INVOICE_STATES = new Set(INVOICE_STATUS.values as string[]);

const dayKey = (d: Date) => `${periodKey(d)}-${String(d.getDate()).padStart(2, "0")}`;

/** Cubetas del gráfico: por día si el rango cabe en dos meses, si no por mes. */
function chartBuckets(from: Date, to: Date) {
  const daily = to.getTime() - from.getTime() <= 62 * 86_400_000;
  const list: { key: string; label: string }[] = [];
  if (daily) {
    for (let d = new Date(from); d < to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      list.push({ key: dayKey(d), label: fmtDateShort(d) });
    }
  } else {
    for (let d = startOfMonth(0, from); d < to; d = startOfMonth(1, d)) {
      list.push({ key: periodKey(d), label: periodShort(d) });
    }
  }
  return { daily, list, keyOf: daily ? dayKey : periodKey };
}

export default async function VentasPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection("ventas");
  const sp = await searchParams;
  const statuses = many(sp.estado);
  // Un estado de factura en la URL (p. ej. desde el panel) abre directamente esa vista.
  const view = one(sp.vista) || (statuses.length && statuses.every((s) => INVOICE_STATES.has(s)) ? "facturas" : "pedidos");
  const companyIds = many(sp.cliente);
  const companyTypes = many(sp.tipo);
  // Por defecto la facturación descuenta las notas crédito: es la venta real.
  const grossOnly = one(sp.nc) === "sin";
  const { page, pageSize, skip, take } = pagination(sp.page, 25);

  const now = new Date();
  const monthStart = startOfMonth(0, now);
  const nextMonth = startOfMonth(1, now);

  // Rango de fechas: `hasta` es inclusivo en la URL y exclusivo en las consultas.
  let fromDay = parseDay(sp.desde);
  let toDay = parseDay(sp.hasta);
  if (fromDay && toDay && fromDay > toDay) [fromDay, toDay] = [toDay, fromDay];
  const hasRange = Boolean(fromDay || toDay);
  const rangeEnd = toDay ? new Date(toDay.getFullYear(), toDay.getMonth(), toDay.getDate() + 1) : null;

  // Sin rango, las tarjetas miran el mes en curso y el gráfico los últimos doce meses.
  const periodFrom = hasRange ? fromDay : monthStart;
  const periodTo = hasRange ? rangeEnd : nextMonth;
  const chartFrom = fromDay ?? startOfMonth(-11, toDay ?? now);
  const chartTo = rangeEnd ?? nextMonth;
  const buckets = chartBuckets(chartFrom, chartTo);

  const dateRange = (from: Date | null, to: Date | null) => ({ ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) });
  const byCompany = {
    ...(companyIds.length ? { companyId: anyOf(companyIds) } : {}),
    ...(companyTypes.length ? { company: { type: anyOf(companyTypes) } } : {}),
  };

  const [billed, credited, cart, chartInvoices, chartCredits, companies, orderStats] = await Promise.all([
    prisma.invoice.aggregate({ where: { ...byCompany, issueDate: dateRange(periodFrom, periodTo), status: NOT_VOID }, _sum: { net: true }, _count: true }),
    prisma.creditNote.aggregate({ where: { ...byCompany, issueDate: dateRange(periodFrom, periodTo) }, _sum: { net: true }, _count: true }),
    receivables(byCompany),
    prisma.invoice.findMany({ where: { ...byCompany, issueDate: { gte: chartFrom, lt: chartTo }, status: NOT_VOID }, select: { issueDate: true, net: true } }),
    grossOnly
      ? Promise.resolve([])
      : prisma.creditNote.findMany({ where: { ...byCompany, issueDate: { gte: chartFrom, lt: chartTo } }, select: { issueDate: true, net: true } }),
    prisma.company.findMany({ where: { active: true, ...(companyTypes.length ? { type: anyOf(companyTypes) } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.salesOrder.aggregate({ where: { ...byCompany, date: dateRange(periodFrom, periodTo), status: NOT_VOID }, _count: true, _sum: { net: true } }),
  ]);

  const byBucket = new Map<string, number>();
  for (const i of chartInvoices) {
    const key = buckets.keyOf(i.issueDate);
    byBucket.set(key, (byBucket.get(key) ?? 0) + i.net);
  }
  // El gráfico no dibuja bajo cero: un día con sólo notas crédito queda en la base.
  for (const n of chartCredits) {
    const key = buckets.keyOf(n.issueDate);
    byBucket.set(key, (byBucket.get(key) ?? 0) - n.net);
  }

  const creditTotal = credited._sum.net ?? 0;
  const billedTotal = (billed._sum.net ?? 0) - (grossOnly ? 0 : creditTotal);

  const avgTicket = orderStats._count ? (orderStats._sum.net ?? 0) / orderStats._count : 0;
  const periodWord = hasRange ? "período" : "mes";

  const orderStatuses = statuses.filter((s) => !INVOICE_STATES.has(s));
  const invoiceStatuses = statuses.filter((s) => INVOICE_STATES.has(s));
  const orderWhere = {
    ...byCompany,
    ...(hasRange ? { date: dateRange(fromDay, rangeEnd) } : {}),
    ...(orderStatuses.length ? { status: anyOf(orderStatuses) } : {}),
  };
  const invoiceWhere = {
    ...byCompany,
    ...(hasRange ? { issueDate: dateRange(fromDay, rangeEnd) } : {}),
    ...(invoiceStatuses.length ? { status: anyOf(invoiceStatuses) } : {}),
  };
  const creditWhere = {
    ...byCompany,
    ...(hasRange ? { issueDate: dateRange(fromDay, rangeEnd) } : {}),
  };

  const [orders, orderCount, invoiceRows, invoiceCount, creditRows, creditCount] = await Promise.all([
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
    view === "notas"
      ? prisma.creditNote.findMany({
          where: creditWhere,
          orderBy: { issueDate: "desc" },
          skip,
          take,
          include: { company: { select: { id: true, name: true } }, invoice: { select: { id: true, number: true } } },
        })
      : Promise.resolve([]),
    view === "notas" ? prisma.creditNote.count({ where: creditWhere }) : Promise.resolve(0),
  ]);

  const total = view === "pedidos" ? orderCount : view === "notas" ? creditCount : invoiceCount;
  const tab = (key: string, label: string) => {
    const q = new URLSearchParams();
    q.set("vista", key);
    // Al cambiar de vista se conservan cliente, tipo y fechas; el estado no aplica.
    for (const k of ["cliente", "tipo", "desde", "hasta", "nc"]) if (one(sp[k])) q.set(k, one(sp[k]));
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
        <StatTile label={`Facturado en el ${periodWord}`} value={fmtCompact(billedTotal)}
          hint={
            credited._count
              ? `${fmtNumber(billed._count)} facturas · ${grossOnly ? "sin descontar" : "menos"} ${fmtCompact(creditTotal)} en notas crédito`
              : `${fmtNumber(billed._count)} facturas emitidas`
          } icon={<IconSales size={15} />} />
        <StatTile label={`Pedidos del ${periodWord}`} value={fmtNumber(orderStats._count)} hint={`Ticket medio ${fmtCompact(avgTicket)}`} icon={<IconTarget size={15} />} />
        <StatTile label="Por cobrar" value={fmtCompact(cart.open)} hint={`${fmtNumber(cart.count)} facturas pendientes`} icon={<IconSales size={15} />} />
        <StatTile label="Cartera vencida" value={fmtCompact(cart.overdue)} hint={`${((cart.overdue / Math.max(1, cart.open)) * 100).toFixed(0)}% de lo pendiente`} icon={<IconAlert size={15} />} href="/ventas?estado=VENCIDA" />
      </div>

      <Card className="mt-5">
        <CardHeader
          title={buckets.daily ? "Facturación diaria" : "Facturación mensual"}
          subtitle={hasRange ? `${fmtDate(chartFrom)} – ${fmtDate(new Date(chartTo.getTime() - 86_400_000))}` : "Últimos doce meses"}
        />
        <div className="px-4 py-4">
          <LineChart
            data={buckets.list.map((b) => ({ label: b.label, values: [Math.max(0, Math.round(byBucket.get(b.key) ?? 0))] }))}
            series={[{ name: grossOnly ? "Facturación emitida" : "Facturación menos notas crédito", color: "var(--series-1)" }]}
            format="compact"
            height={220}
            labelEvery={Math.max(1, Math.ceil(buckets.list.length / 14))}
          />
        </div>
      </Card>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {tab("pedidos", "Pedidos")}
        {tab("facturas", "Facturación")}
        {tab("notas", "Notas crédito")}
      </div>

      <div className="mt-3">
        <Filters
          fields={[
            { type: "date", name: "desde", label: "Desde" },
            { type: "date", name: "hasta", label: "Hasta" },
            {
              type: "select",
              name: "tipo",
              label: "Tipo de cliente",
              options: COMPANY_TYPES.options.map((o) => ({ value: o.value, label: o.label })),
              multi: true,
            },
            { type: "select", name: "cliente", label: "Todos los clientes", options: companies.map((c) => ({ value: c.id, label: c.name })), width: "w-60", multi: true },
            {
              type: "select",
              name: "nc",
              label: "Descontando notas crédito",
              options: [{ value: "sin", label: "Sin descontar notas crédito" }],
            },
            // Las notas crédito no tienen estado.
            ...(view === "notas"
              ? []
              : [
                  {
                    type: "select" as const,
                    name: "estado",
                    label: "Estado",
                    options: (view === "pedidos" ? ORDER_STATUS.options : INVOICE_STATUS.options).map((o) => ({ value: o.value, label: o.label })),
                    multi: true,
                  },
                ]),
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
                        <th className="num">Sin IVA</th>
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
                          <td className="num font-semibold">{fmtMoney(o.net)}</td>
                          <td className="font-mono text-[11.5px] text-[var(--text-secondary)]">{o.invoice?.number ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : view === "notas" ? (
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Nota crédito</th>
                        <th>Emisión</th>
                        <th>Cliente</th>
                        <th>Factura afectada</th>
                        <th>Motivo</th>
                        <th className="num">Sin IVA</th>
                        <th className="num">Con IVA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {creditRows.map((n) => (
                        <tr key={n.id}>
                          <td className="font-mono text-[12px] font-medium">{n.number}</td>
                          <td className="whitespace-nowrap text-[var(--text-secondary)]">{fmtDate(n.issueDate)}</td>
                          <td>
                            <Link href={`/clientes/${n.company.id}`} className="hover:text-[var(--brand)] hover:underline">
                              {n.company.name}
                            </Link>
                          </td>
                          <td className="font-mono text-[11.5px] text-[var(--text-secondary)]">
                            {n.invoice ? (
                              <Link href={`/ventas/facturas/${n.invoice.id}`} className="hover:text-[var(--brand)] hover:underline">
                                {n.invoice.number}
                              </Link>
                            ) : "—"}
                          </td>
                          <td className="max-w-[280px] truncate text-[var(--text-secondary)]" title={n.reason ?? undefined}>{n.reason ?? "—"}</td>
                          <td className="num font-semibold">{fmtMoney(n.net)}</td>
                          <td className="num text-[var(--text-secondary)]">{fmtMoney(n.total)}</td>
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
                        <th className="num">Sin IVA</th>
                        <th className="num">Con IVA</th>
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
                              <Link href={`/ventas/facturas/${i.id}`} className="font-mono text-[12px] font-medium hover:text-[var(--brand)] hover:underline">
                                {i.number}
                              </Link>
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
                            <td className="num">{fmtMoney(i.net)}</td>
                            <td className="num text-[var(--text-secondary)]">{fmtMoney(i.total)}</td>
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
