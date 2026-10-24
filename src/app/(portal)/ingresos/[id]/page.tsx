import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { RECEIPT_ROLES, requireSection } from "@/lib/auth";
import { RECEIPT_SOURCE, RECEIPT_STATUS } from "@/lib/enums";
import { claudeApiKey } from "@/lib/lector-documentos";
import { daysUntil, reconcile, SHORT_EXPIRY_DAYS } from "@/lib/receipts";
import { fmtDate, fmtDateTime, fmtMoney, fmtMoneyPrecise, fmtNumber } from "@/lib/format";
import { Card, CardHeader, EnumBadge, KeyValue, PageHeader } from "@/components/ui";
import { IconAlert, IconCheck, IconExternal } from "@/components/icons";
import { CancelReceiptButton, PackingSlipForm } from "../receipt-controls";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await prisma.goodsReceipt.findUnique({ where: { id }, select: { code: true } });
  return { title: r ? `Ingreso ${r.code}` : "Ingreso" };
}

export default async function IngresoDetalle({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireSection("ingresos");
  const canEdit = RECEIPT_ROLES.includes(user.role);
  const { id } = await params;

  const [r, apiKey] = await Promise.all([
    prisma.goodsReceipt.findUnique({
      where: { id },
      include: {
        warehouse: { select: { name: true, city: true } },
        supplier: { select: { id: true, name: true } },
        createdBy: { select: { name: true } },
        receivedBy: { select: { name: true } },
        lines: { include: { product: { select: { id: true, sku: true, name: true, imageEmoji: true } } } },
        lots: { orderBy: { expiryDate: "asc" }, include: { product: { select: { id: true, sku: true, name: true } } } },
      },
    }),
    claudeApiKey(),
  ]);
  if (!r) notFound();

  const pendiente = r.status === "POR_RECIBIR";
  const recibido = r.status === "RECIBIDO" || r.status === "CON_DIFERENCIAS";
  const valor = r.lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
  const cuadre = reconcile(r.lines, r.lots);
  const productos = new Map(r.lines.map((l) => [l.productId, l.product]));

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Ingresos de mercancía", href: "/ingresos" }, { label: r.code }]}
        title={`Factura ${r.invoiceNumber}`}
        subtitle={`${r.supplierName} · entra a ${r.warehouse.name}`}
        actions={
          <>
            {recibido && (
              <Link href={`/packing-slip/${r.id}`} target="_blank" className="btn btn-secondary">
                <IconExternal size={14} /> Packing slip
              </Link>
            )}
            <EnumBadge option={RECEIPT_STATUS.get(r.status)} dot />
          </>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          {pendiente && canEdit && (
            <Card>
              <CardHeader
                title="Paso 2 · Packing slip"
                subtitle="Al llegar la mercancía, fotografía las etiquetas para certificar lote, vencimiento y cantidad. Lo contado se contrasta con la factura antes de entrar a bodega."
              />
              <PackingSlipForm
                receiptId={r.id}
                expected={r.lines.map((l) => ({ productId: l.productId, sku: l.product.sku, name: l.product.name, quantity: l.quantity }))}
                reader={Boolean(apiKey)}
              />
            </Card>
          )}

          {recibido && (
            <Card>
              <CardHeader
                title="Packing slip"
                subtitle={`Certificado ${fmtDateTime(r.receivedAt)}${r.receivedBy ? ` por ${r.receivedBy.name}` : ""} · ${r.lots.length} ${r.lots.length === 1 ? "lote" : "lotes"} en bodega`}
              />
              {r.receivedNotes && (
                <p className="flex items-start gap-1.5 border-b border-[var(--border)] bg-[var(--tone-warning-bg)] px-4 py-2.5 text-[12.5px] text-[var(--tone-warning-fg)]">
                  <IconAlert size={13} className="mt-0.5 shrink-0" />
                  {r.receivedNotes}
                </p>
              )}
              <div className="scroll-x">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Lote</th>
                      <th>Vence</th>
                      <th className="num">Unidades</th>
                      <th>Origen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.lots.map((l) => {
                      const dias = daysUntil(l.expiryDate);
                      return (
                        <tr key={l.id}>
                          <td>
                            <Link href={`/productos/${l.product.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                              {l.product.name}
                            </Link>
                            <span className="block font-mono text-[11px] text-[var(--text-muted)]">{l.product.sku}</span>
                          </td>
                          <td className="font-mono text-[12px]">{l.lotCode}</td>
                          <td className="whitespace-nowrap">
                            {fmtDate(l.expiryDate)}
                            {dias <= SHORT_EXPIRY_DAYS && <span className="badge badge-warning ml-1.5">{dias} d</span>}
                          </td>
                          <td className="num">{fmtNumber(l.quantity)}</td>
                          <td><EnumBadge option={RECEIPT_SOURCE.get(l.source)} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title={recibido ? "Facturado contra recibido" : "Renglones de la factura"} subtitle={`${fmtMoney(valor)} sin IVA`} />
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Código en factura</th>
                    <th className="num">Costo unit.</th>
                    <th className="num">Facturado</th>
                    {recibido && <th className="num">Recibido</th>}
                    {recibido && <th className="num">Diferencia</th>}
                  </tr>
                </thead>
                <tbody>
                  {(recibido ? cuadre : cuadre.filter((c) => c.invoiced > 0)).map((c) => {
                    const p = productos.get(c.productId);
                    const ls = r.lines.filter((l) => l.productId === c.productId);
                    return (
                      <tr key={c.productId}>
                        <td>
                          {p ? (
                            <Link href={`/productos/${p.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                              {p.imageEmoji} {p.name}
                            </Link>
                          ) : (
                            "—"
                          )}
                          {ls[0]?.description && <span className="block text-[11.5px] text-[var(--text-muted)]">{ls[0].description}</span>}
                        </td>
                        <td className="font-mono text-[12px]">{ls.map((l) => l.sku).join(", ")}</td>
                        <td className="num whitespace-nowrap">{ls.length ? fmtMoneyPrecise(ls[0].unitCost) : "—"}</td>
                        <td className="num">{fmtNumber(c.invoiced)}</td>
                        {recibido && <td className="num">{fmtNumber(c.received)}</td>}
                        {recibido && (
                          <td className="num whitespace-nowrap">
                            {c.diff === 0 ? (
                              <span className="inline-flex items-center gap-1 text-[var(--tone-success-fg)]"><IconCheck size={12} /> Cuadra</span>
                            ) : (
                              <span className="font-semibold text-[var(--tone-warning-fg)]">
                                {c.diff > 0 ? "+" : "−"}
                                {fmtNumber(Math.abs(c.diff))}
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Factura" />
            <dl className="grid grid-cols-2 gap-x-4 px-4 py-2.5">
              <KeyValue label="Proveedor">
                {r.supplier ? (
                  <Link href={`/proveedores/${r.supplier.id}`} className="hover:text-[var(--brand)] hover:underline">{r.supplierName}</Link>
                ) : (
                  <>
                    {r.supplierName}
                    <span className="block text-[11.5px] text-[var(--text-muted)]">No está dado de alta</span>
                  </>
                )}
              </KeyValue>
              <KeyValue label="NIT">{r.supplierTaxId ?? "—"}</KeyValue>
              <KeyValue label="Número"><span className="font-mono">{r.invoiceNumber}</span></KeyValue>
              <KeyValue label="Fecha">{fmtDate(r.invoiceDate)}</KeyValue>
              <KeyValue label="Bodega">{r.warehouse.name} · {r.warehouse.city}</KeyValue>
              <KeyValue label="Carga"><EnumBadge option={RECEIPT_SOURCE.get(r.source)} /></KeyValue>
              <KeyValue label="Registrada">
                {fmtDateTime(r.createdAt)}
                {r.createdBy && <span className="block text-[11.5px] text-[var(--text-muted)]">{r.createdBy.name}</span>}
              </KeyValue>
              <KeyValue label="Consecutivo"><span className="font-mono">{r.code}</span></KeyValue>
            </dl>
            {r.notes && <p className="border-t border-[var(--border)] px-4 py-2.5 text-[12.5px] text-[var(--text-secondary)]">{r.notes}</p>}
            {pendiente && canEdit && (
              <div className="border-t border-[var(--border)] px-2 py-1.5">
                <CancelReceiptButton id={r.id} />
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
