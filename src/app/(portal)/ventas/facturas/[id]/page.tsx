import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { INVOICE_STATUS } from "@/lib/enums";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { Card, CardHeader, EnumBadge, KeyValue, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({ where: { id }, select: { number: true } });
  return { title: invoice ? `Factura ${invoice.number}` : "Factura" };
}

export default async function FacturaPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSection("ventas");
  const { id } = await params;

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true, taxId: true } },
      order: {
        select: {
          number: true,
          store: { select: { name: true } },
          lines: { include: { product: { select: { id: true, sku: true, name: true, imageEmoji: true } } } },
        },
      },
      creditNotes: { orderBy: { issueDate: "asc" } },
    },
  });
  if (!invoice) notFound();

  const lines = invoice.order?.lines ?? [];
  // El neto de la factura se reparte entre sus renglones igual que en Forecast vs ejecución.
  const gross = lines.reduce((s, l) => s + l.total, 0);
  const credited = invoice.creditNotes.reduce((s, n) => s + n.net, 0);
  const balance = invoice.total - invoice.paidAmount;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Ventas", href: "/ventas?vista=facturas" }, { label: invoice.number }]}
        title={`Factura ${invoice.number}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <EnumBadge option={INVOICE_STATUS.get(invoice.status)} dot />
            <Link href={`/clientes/${invoice.company.id}`} className="text-[12.5px] hover:text-[var(--brand)] hover:underline">
              {invoice.company.name}
            </Link>
          </span>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <Card>
          <CardHeader title="Resumen" />
          <dl className="grid gap-x-6 px-4 py-2 sm:grid-cols-4">
            <KeyValue label="Emisión">{fmtDate(invoice.issueDate)}</KeyValue>
            <KeyValue label="Vencimiento">{fmtDate(invoice.dueDate)}</KeyValue>
            <KeyValue label="Cliente">
              {invoice.company.name}
              {invoice.company.taxId && <span className="block text-[12px] text-[var(--text-muted)]">NIT {invoice.company.taxId}</span>}
            </KeyValue>
            <KeyValue label="Pedido">
              {invoice.order?.number ?? "—"}
              {invoice.order?.store && <span className="block text-[12px] text-[var(--text-muted)]">{invoice.order.store.name}</span>}
            </KeyValue>
            <KeyValue label="Neto sin IVA">{fmtMoney(invoice.net)}</KeyValue>
            <KeyValue label="Total con IVA">{fmtMoney(invoice.total)}</KeyValue>
            <KeyValue label="Pagado">{fmtMoney(invoice.paidAmount)}</KeyValue>
            <KeyValue label="Saldo">{balance > 0 ? fmtMoney(balance) : "—"}</KeyValue>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Renglones" subtitle="«Neto atribuido» es la parte del neto de la factura que le toca a cada producto, después de descuentos y ajustes de facturación." />
          {lines.length ? (
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="num">Cantidad</th>
                    <th className="num">Precio unitario</th>
                    <th className="num">Descuento</th>
                    <th className="num">Total del renglón</th>
                    <th className="num">Neto atribuido</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <Link href={`/productos/${l.product.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                          {l.product.imageEmoji} {l.product.name}
                        </Link>
                        <span className="block text-[11.5px] text-[var(--text-muted)]">{l.product.sku}</span>
                      </td>
                      <td className="num">{fmtNumber(l.quantity)}</td>
                      <td className="num text-[var(--text-secondary)]">{fmtMoney(l.unitPrice)}</td>
                      <td className="num text-[var(--text-secondary)]">{l.discountPct ? `${l.discountPct}%` : "—"}</td>
                      <td className="num">{fmtMoney(l.total)}</td>
                      <td className="num font-semibold">{gross > 0 ? fmtMoney((l.total / gross) * invoice.net) : "—"}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: "2px solid var(--border-strong)" }}>
                    <td className="font-semibold">Total</td>
                    <td className="num font-semibold">{fmtNumber(lines.reduce((s, l) => s + l.quantity, 0))}</td>
                    <td colSpan={2} />
                    <td className="num font-semibold">{fmtMoney(gross)}</td>
                    <td className="num font-semibold">{fmtMoney(invoice.net)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">Esta factura llegó sin renglones: suma al cliente, pero no a un producto.</p>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Notas crédito"
            subtitle={invoice.creditNotes.length ? `${fmtMoney(credited)} sin IVA · neto después de notas: ${fmtMoney(invoice.net - credited)}` : undefined}
          />
          {invoice.creditNotes.length ? (
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Nota crédito</th>
                    <th>Emisión</th>
                    <th>Motivo</th>
                    <th className="num">Sin IVA</th>
                    <th className="num">Con IVA</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.creditNotes.map((n) => (
                    <tr key={n.id}>
                      <td className="font-mono text-[12px] font-medium">{n.number}</td>
                      <td className="whitespace-nowrap text-[var(--text-secondary)]">{fmtDate(n.issueDate)}</td>
                      <td className="text-[var(--text-secondary)]">{n.reason ?? "—"}</td>
                      <td className="num font-semibold">{fmtMoney(n.net)}</td>
                      <td className="num text-[var(--text-secondary)]">{fmtMoney(n.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">Sin notas crédito sobre esta factura.</p>
          )}
        </Card>
      </div>
    </>
  );
}
