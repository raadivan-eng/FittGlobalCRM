import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { lastMonths, NOT_VOID, periodKey, startOfMonth } from "@/lib/analytics";
import { CHANNELS, COMPANY_TYPES, INVOICE_STATUS, ORDER_STATUS, STORE_FORMATS, TIERS } from "@/lib/enums";
import { fmtCompact, fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { Card, CardHeader, EnumBadge, KeyValue, PageHeader, StatTile } from "@/components/ui";
import { GroupedBarChart, RankingBars } from "@/components/charts";
import { IconBuilding, IconMail, IconPhone, IconSales, IconStore, IconTarget } from "@/components/icons";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.company.findUnique({ where: { id }, select: { name: true } });
  return { title: c?.name ?? "Cliente" };
}

export default async function ClienteDetalle({ params }: { params: Promise<{ id: string }> }) {
  await requireSection("clientes");
  const { id } = await params;

  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      owner: { select: { name: true, email: true } },
      stores: {
        where: { active: true },
        orderBy: { name: "asc" },
        include: {
          assignments: { include: { user: { select: { name: true } } } },
          _count: { select: { incidents: true } },
        },
      },
      contacts: { orderBy: [{ isPrimary: "desc" }, { lastName: "asc" }], include: { store: { select: { name: true } } } },
    },
  });
  if (!company) notFound();

  const range = lastMonths(12);
  const since = range[0].start;

  const [invoices, forecasts, orders, pending, topSkus] = await Promise.all([
    prisma.invoice.findMany({
      where: { companyId: id, issueDate: { gte: since }, status: NOT_VOID },
      select: { issueDate: true, total: true },
    }),
    prisma.forecast.findMany({ where: { companyId: id, period: { in: range.map((r) => r.period) } }, select: { period: true, amount: true } }),
    prisma.salesOrder.findMany({
      where: { companyId: id },
      orderBy: { date: "desc" },
      take: 8,
      include: { invoice: { select: { number: true, status: true } }, store: { select: { name: true } }, _count: { select: { lines: true } } },
    }),
    prisma.invoice.findMany({ where: { companyId: id, status: { in: ["EMITIDA", "PARCIAL", "VENCIDA"] } }, select: { total: true, paidAmount: true, dueDate: true } }),
    prisma.salesOrderLine.groupBy({
      by: ["productId"],
      where: { order: { companyId: id, date: { gte: since }, status: NOT_VOID } },
      _sum: { total: true },
      orderBy: { _sum: { total: "desc" } },
      take: 6,
    }),
  ]);

  const products = await prisma.product.findMany({
    where: { id: { in: topSkus.map((t) => t.productId) } },
    select: { id: true, name: true, imageEmoji: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  const realByPeriod = new Map<string, number>();
  for (const i of invoices) realByPeriod.set(periodKey(i.issueDate), (realByPeriod.get(periodKey(i.issueDate)) ?? 0) + i.total);
  const fcByPeriod = new Map(forecasts.map((f) => [f.period, f.amount]));

  const billed12 = invoices.reduce((s, i) => s + i.total, 0);
  const owed = pending.reduce((s, i) => s + (i.total - i.paidAmount), 0);
  const overdue = pending.filter((i) => i.dueDate < new Date()).reduce((s, i) => s + (i.total - i.paidAmount), 0);
  const currentPeriod = periodKey(startOfMonth(0));
  const monthReal = realByPeriod.get(currentPeriod) ?? 0;
  const monthForecast = fcByPeriod.get(currentPeriod) ?? 0;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Clientes", href: "/clientes" }, { label: company.name }]}
        title={company.name}
        subtitle={`${company.code} · ${COMPANY_TYPES.label(company.type)} · ${CHANNELS.label(company.channel)}`}
        actions={
          <>
            <EnumBadge option={TIERS.get(company.tier)} />
            <Link href={`/tiendas?cliente=${company.id}`} className="btn btn-secondary">
              <IconStore size={15} /> Ver tiendas
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Facturación 12 meses" value={fmtCompact(billed12)} hint={`${invoices.length} facturas emitidas`} icon={<IconSales size={15} />} />
        <StatTile label="Mes en curso" value={fmtCompact(monthReal)} hint={monthForecast ? `${((monthReal / monthForecast) * 100).toFixed(0)}% del forecast (${fmtCompact(monthForecast)})` : "Sin forecast cargado"} icon={<IconTarget size={15} />} />
        <StatTile label="Por cobrar" value={fmtCompact(owed)} hint={overdue > 0 ? `${fmtCompact(overdue)} ya vencido` : "Al día"} icon={<IconBuilding size={15} />} />
        <StatTile label="Red del cliente" value={fmtNumber(company.stores.length)} hint={`${fmtNumber(company.contacts.length)} contactos registrados`} icon={<IconStore size={15} />} />
      </div>

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title="Forecast contra facturación" subtitle="Doce meses móviles de este cliente" />
          <div className="px-4 py-4">
            <GroupedBarChart
              data={range.map((r) => ({ label: r.label, values: [Math.round(fcByPeriod.get(r.period) ?? 0), Math.round(realByPeriod.get(r.period) ?? 0)] }))}
              series={[
                { name: "Forecast", color: "var(--series-1)" },
                { name: "Facturación real", color: "var(--series-2)" },
              ]}
              format="compact"
              height={230}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Ficha comercial" />
          <dl className="grid grid-cols-2 gap-x-4 px-4 py-3">
            <KeyValue label="NIT">{company.taxId ?? "—"}</KeyValue>
            <KeyValue label="Responsable">{company.owner?.name ?? "Sin asignar"}</KeyValue>
            <KeyValue label="Ciudad">{company.city ?? "—"}</KeyValue>
            <KeyValue label="Dirección">{company.address ?? "—"}</KeyValue>
            <KeyValue label="Teléfono">{company.phone ?? "—"}</KeyValue>
            <KeyValue label="Correo">{company.email ?? "—"}</KeyValue>
            <KeyValue label="Cupo de crédito">{fmtMoney(company.creditLimit)}</KeyValue>
            <KeyValue label="Plazo de pago">{company.paymentTermDays} días</KeyValue>
          </dl>
          {company.notes && <p className="border-t border-[var(--border)] px-4 py-3 text-[12.5px] text-[var(--text-secondary)]">{company.notes}</p>}
        </Card>
      </div>

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Puntos de venta" subtitle={`${company.stores.length} tiendas activas`} />
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Tienda</th>
                  <th>Zona</th>
                  <th>Formato</th>
                  <th className="num">Frecuencia</th>
                  <th>Mercaderista</th>
                </tr>
              </thead>
              <tbody>
                {company.stores.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/tiendas/${s.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                        {s.name}
                      </Link>
                      <p className="text-[11.5px] text-[var(--text-muted)]">{s.code}</p>
                    </td>
                    <td className="text-[var(--text-secondary)]">{s.zone}</td>
                    <td className="text-[var(--text-secondary)]">{STORE_FORMATS.label(s.format)}</td>
                    <td className="num text-[var(--text-secondary)]">{s.visitsPerMonth}×/mes</td>
                    <td className="text-[var(--text-secondary)]">{s.assignments[0]?.user.name ?? "Sin asignar"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Productos más comprados" subtitle="Últimos 12 meses" />
          <RankingBars
            items={topSkus.map((t) => ({
              label: `${productById.get(t.productId)?.imageEmoji ?? "📦"} ${productById.get(t.productId)?.name ?? "—"}`,
              value: t._sum.total ?? 0,
              href: `/productos/${t.productId}`,
            }))}
            format="compact"
          />
        </Card>
      </div>

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader title="Contactos" subtitle="Personas de esta empresa y de sus tiendas" action={<Link href={`/contactos?cliente=${company.id}`} className="btn btn-ghost !px-2 text-[12.5px]">Ver todos</Link>} />
          <ul className="divide-y divide-[var(--border)]">
            {company.contacts.slice(0, 8).map((c) => (
              <li key={c.id} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">
                      {c.firstName} {c.lastName}
                      {c.isPrimary && <span className="badge badge-info ml-1.5">Principal</span>}
                      {c.isDecisionMaker && <span className="badge badge-purple ml-1">Decide</span>}
                    </p>
                    <p className="mt-0.5 truncate text-[12px] text-[var(--text-muted)]">
                      {c.position}
                      {c.store ? ` · ${c.store.name}` : " · Corporativo"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5 text-[11.5px] text-[var(--text-secondary)]">
                    {c.phone && <span className="inline-flex items-center gap-1"><IconPhone size={11} /> {c.phone}</span>}
                    {c.email && <span className="inline-flex items-center gap-1 truncate"><IconMail size={11} /> {c.email}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Últimos pedidos" action={<Link href={`/ventas?cliente=${company.id}`} className="btn btn-ghost !px-2 text-[12.5px]">Ver todos</Link>} />
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Fecha</th>
                  <th>Estado</th>
                  <th className="num">Total</th>
                  <th>Factura</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <span className="font-mono text-[12px]">{o.number}</span>
                      <p className="text-[11.5px] text-[var(--text-muted)]">{o._count.lines} líneas{o.store ? ` · ${o.store.name}` : ""}</p>
                    </td>
                    <td className="whitespace-nowrap text-[var(--text-secondary)]">{fmtDate(o.date)}</td>
                    <td><EnumBadge option={ORDER_STATUS.get(o.status)} /></td>
                    <td className="num font-semibold">{fmtCompact(o.total)}</td>
                    <td>{o.invoice ? <EnumBadge option={INVOICE_STATUS.get(o.invoice.status)} /> : <span className="text-[var(--text-muted)]">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
