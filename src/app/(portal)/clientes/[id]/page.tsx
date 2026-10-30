import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { CLIENT_ROLES, CONTACT_ROLES, requireSection } from "@/lib/auth";
import { LEAD_ROLES } from "@/lib/leads";
import { ContactEditor } from "@/components/contact-forms";
import { ClientCard } from "./client-editor";
import { clientStatuses, companyForecasts, getForecastCriteria, lastMonths, NOT_VOID, periodKey, startOfMonth } from "@/lib/analytics";
import { ClientStatusControl } from "@/components/client-status";
import { CHANNELS, CLIENT_INACTIVITY, CLIENT_STATUS, COMPANY_TYPES, INVOICE_STATUS, ORDER_STATUS, SIIGO_CUSTOMER, STORE_FORMATS, TIERS } from "@/lib/enums";
import { enviarClienteASiigo } from "@/lib/actions-leads";
import { parseTaxData, taxSummary } from "@/lib/rut";
import { fmtCompact, fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { netOfCredits, type SearchParams } from "@/lib/params";
import { CreditNotesSelect } from "@/components/filters";
import { Card, CardHeader, EnumBadge, KeyValue, PageHeader, StatTile } from "@/components/ui";
import { GroupedBarChart, RankingBars } from "@/components/charts";
import { IconBuilding, IconMail, IconPhone, IconSales, IconStore, IconTarget } from "@/components/icons";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.company.findUnique({ where: { id }, select: { name: true } });
  return { title: c?.name ?? "Cliente" };
}

export default async function ClienteDetalle({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const user = await requireSection("clientes");
  const { id } = await params;
  const credits = netOfCredits(await searchParams);

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
      contacts: {
        orderBy: [{ isPrimary: "desc" }, { lastName: "asc" }],
        include: { stores: { include: { store: { select: { id: true, name: true } } } } },
      },
    },
  });
  if (!company) notFound();

  const canEditContacts = CONTACT_ROLES.includes(user.role);
  const canEditClient = CLIENT_ROLES.includes(user.role);
  const range = lastMonths(12);
  const since = range[0].start;

  const criteria = await getForecastCriteria();
  const [invoices, creditNotes, forecasts, statuses, orders, pending, topSkus, owners] = await Promise.all([
    prisma.invoice.findMany({
      where: { companyId: id, issueDate: { gte: since }, status: NOT_VOID },
      select: { issueDate: true, net: true },
    }),
    credits ? prisma.creditNote.findMany({ where: { companyId: id, issueDate: { gte: since } }, select: { issueDate: true, net: true } }) : [],
    companyForecasts(range.map((r) => r.period), id, { criteria }),
    clientStatuses([id], criteria),
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
    canEditClient
      ? prisma.user.findMany({ where: { active: true, role: { in: LEAD_ROLES } }, orderBy: { name: "asc" }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  const products = await prisma.product.findMany({
    where: { id: { in: topSkus.map((t) => t.productId) } },
    select: { id: true, name: true, imageEmoji: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  const realByPeriod = new Map<string, number>();
  for (const i of invoices) realByPeriod.set(periodKey(i.issueDate), (realByPeriod.get(periodKey(i.issueDate)) ?? 0) + i.net);
  for (const n of creditNotes) realByPeriod.set(periodKey(n.issueDate), (realByPeriod.get(periodKey(n.issueDate)) ?? 0) - n.net);
  const fcByPeriod = new Map(range.map((r) => [r.period, forecasts.get(r.period)?.get(id)?.amount ?? 0]));

  const credited12 = creditNotes.reduce((s, n) => s + n.net, 0);
  const billed12 = invoices.reduce((s, i) => s + i.net, 0) - credited12;
  const owed = pending.reduce((s, i) => s + (i.total - i.paidAmount), 0);
  const overdue = pending.filter((i) => i.dueDate < new Date()).reduce((s, i) => s + (i.total - i.paidAmount), 0);
  const currentPeriod = periodKey(startOfMonth(0));
  const monthReal = realByPeriod.get(currentPeriod) ?? 0;
  const monthForecast = fcByPeriod.get(currentPeriod) ?? 0;
  const status = statuses.get(id)!;
  const statusHint =
    status.inactive === "MANUAL"
      ? `Inactivado el ${fmtDate(status.inactiveSince!)}${status.inactiveReason ? `: ${status.inactiveReason}` : ""}`
      : status.inactive === "SIN_COMPRAS"
        ? `Más de ${criteria.dormantMonths} meses sin comprar`
        : null;

  // Sólo los clientes convertidos con su documento se pueden enviar a Siigo desde aquí.
  const fiscal = parseTaxData(company.fiscalData);
  const siigoState = company.siigoId ? "EN_SIIGO" : company.siigoError ? "RECHAZADO" : "SIN_ENVIAR";

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Clientes", href: "/clientes" }, { label: company.name }]}
        title={company.name}
        subtitle={`${company.code} · ${COMPANY_TYPES.label(company.type)} · ${CHANNELS.label(company.channel)}`}
        actions={
          <>
            <span title={statusHint ?? CLIENT_STATUS.get(status.status).hint}>
              <EnumBadge option={CLIENT_STATUS.get(status.status)} dot />
            </span>
            <EnumBadge option={TIERS.get(company.tier)} />
            {canEditClient && <ClientStatusControl companyId={company.id} companyName={company.name} manual={status.inactive === "MANUAL"} />}
            <form className="flex items-center gap-2">
              <CreditNotesSelect net={credits} />
              <button className="btn btn-secondary">Aplicar</button>
            </form>
            <Link href={`/tiendas?cliente=${company.id}`} className="btn btn-secondary">
              <IconStore size={15} /> Ver tiendas
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Facturación 12 meses" value={fmtCompact(billed12)} hint={`${invoices.length} facturas emitidas${credited12 ? ` menos ${fmtCompact(credited12)} en notas crédito` : ""}`} icon={<IconSales size={15} />} />
        <StatTile
          label="Mes en curso"
          value={fmtCompact(monthReal)}
          hint={
            monthForecast
              ? `${((monthReal / monthForecast) * 100).toFixed(0)}% del forecast (${fmtCompact(monthForecast)})`
              : status.inactive
                ? "Inactivo: fuera del forecast"
                : "Sin historial para proyectar"
          }
          icon={<IconTarget size={15} />}
        />
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

        <ClientCard
          row={{
            id: company.id, name: company.name, taxId: company.taxId, type: company.type, channel: company.channel, tier: company.tier,
            ownerId: company.ownerId, city: company.city, address: company.address, phone: company.phone, email: company.email,
            creditLimit: company.creditLimit, paymentTermDays: company.paymentTermDays, notes: company.notes, siigoId: company.siigoId,
          }}
          owners={owners} canEdit={canEditClient}>
          <dl className="grid grid-cols-2 gap-x-4 px-4 py-3">
            <KeyValue label="Tipo de cliente">
              <span title={COMPANY_TYPES.get(company.type).hint}><EnumBadge option={COMPANY_TYPES.get(company.type)} /></span>
            </KeyValue>
            <KeyValue label="Canal">
              <span title={CHANNELS.get(company.channel).hint}><EnumBadge option={CHANNELS.get(company.channel)} /></span>
            </KeyValue>
            <KeyValue label="Estado">
              <span title={status.inactive ? CLIENT_INACTIVITY.get(status.inactive).hint : CLIENT_STATUS.get(status.status).hint}>
                <EnumBadge option={status.inactive ? CLIENT_INACTIVITY.get(status.inactive) : CLIENT_STATUS.get(status.status)} />
              </span>
            </KeyValue>
            <KeyValue label="Última compra">{status.lastPurchase ? fmtDate(status.lastPurchase) : "Nunca"}</KeyValue>
            <KeyValue label="NIT">{company.taxId ?? "—"}</KeyValue>
            <KeyValue label="Responsable">{company.owner?.name ?? "Sin asignar"}</KeyValue>
            <KeyValue label="Ciudad">{company.city ?? "—"}</KeyValue>
            <KeyValue label="Dirección">{company.address ?? "—"}</KeyValue>
            <KeyValue label="Teléfono">{company.phone ?? "—"}</KeyValue>
            <KeyValue label="Correo">{company.email ?? "—"}</KeyValue>
            <KeyValue label="Cupo de crédito">{fmtMoney(company.creditLimit)}</KeyValue>
            <KeyValue label="Plazo de pago">{company.paymentTermDays} días</KeyValue>
            {fiscal && <KeyValue label="Situación tributaria">{taxSummary(fiscal)}</KeyValue>}
            {(fiscal || company.siigoId) && (
              <KeyValue label="Siigo">
                <EnumBadge option={SIIGO_CUSTOMER.get(siigoState)} />
              </KeyValue>
            )}
          </dl>
          {fiscal && !company.siigoId && (
            <form action={enviarClienteASiigo} className="flex flex-col items-start gap-1.5 border-t border-[var(--border)] px-4 py-3">
              <input type="hidden" name="companyId" value={company.id} />
              {company.siigoError && <p className="text-[12px] text-[var(--tone-danger-fg)]">{company.siigoError}</p>}
              <button type="submit" className="btn btn-secondary">
                {company.siigoError ? "Reintentar en Siigo" : "Crear en Siigo"}
              </button>
            </form>
          )}
          {status.inactive === "MANUAL" && status.inactiveReason && (
            <p className="border-t border-[var(--border)] px-4 py-3 text-[12.5px] text-[var(--text-secondary)]">
              <span className="font-medium">Inactivo desde el {fmtDate(status.inactiveSince!)}:</span> {status.inactiveReason}
            </p>
          )}
          {company.notes && <p className="border-t border-[var(--border)] px-4 py-3 text-[12.5px] text-[var(--text-secondary)]">{company.notes}</p>}
        </ClientCard>
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
          <CardHeader
            title="Contactos"
            subtitle="Personas de esta empresa; cada una puede atender varias de sus tiendas"
            action={
              <span className="flex gap-1">
                {canEditContacts && <ContactEditor companyId={company.id} stores={company.stores.map((s) => ({ id: s.id, name: s.name }))} />}
                <Link href={`/contactos?cliente=${company.id}`} className="btn btn-ghost !px-2 text-[12.5px]">Ver todos</Link>
              </span>
            }
          />
          {company.contacts.length === 0 && (
            <p className="px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">Sin contactos registrados.</p>
          )}
          <ul className="divide-y divide-[var(--border)]">
            {company.contacts.slice(0, 12).map((c) => (
              <li key={c.id} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">
                      {c.firstName} {c.lastName}
                      {c.isPrimary && <span className="badge badge-info ml-1.5">Principal</span>}
                      {c.isDecisionMaker && <span className="badge badge-purple ml-1">Decide</span>}
                    </p>
                    <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                      {c.position} ·{" "}
                      {c.stores.length === 0
                        ? "Corporativo"
                        : c.stores.map((sc, i) => (
                            <span key={sc.storeId}>
                              {i > 0 && ", "}
                              <Link href={`/tiendas/${sc.store.id}`} className="hover:text-[var(--brand)] hover:underline">{sc.store.name}</Link>
                            </span>
                          ))}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5 text-[11.5px] text-[var(--text-secondary)]">
                    {c.phone && <span className="inline-flex items-center gap-1"><IconPhone size={11} /> {c.phone}</span>}
                    {c.email && <span className="inline-flex items-center gap-1 truncate"><IconMail size={11} /> {c.email}</span>}
                  </div>
                </div>
                {canEditContacts && (
                  <div className="mt-1">
                    <ContactEditor companyId={company.id} row={c} />
                  </div>
                )}
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
                  <th className="num">Sin IVA</th>
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
                    <td className="num font-semibold">{fmtCompact(o.net)}</td>
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
