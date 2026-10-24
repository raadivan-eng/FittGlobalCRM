import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { RECEIPT_STATUS } from "@/lib/enums";
import { reconcile } from "@/lib/receipts";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { BrandTile } from "@/components/brand-mark";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await prisma.goodsReceipt.findUnique({ where: { id }, select: { code: true } });
  return { title: r ? `Packing slip ${r.code}` : "Packing slip" };
}

/**
 * Packing slip del ingreso: la constancia de lo que entró a bodega, lote por
 * lote, contra la factura. Va fuera del portal para imprimirse sin el menú.
 */
export default async function PackingSlip({ params }: { params: Promise<{ id: string }> }) {
  await requireSection("ingresos");
  const { id } = await params;
  const r = await prisma.goodsReceipt.findUnique({
    where: { id },
    include: {
      warehouse: { select: { name: true, city: true } },
      receivedBy: { select: { name: true } },
      lines: { select: { productId: true, quantity: true } },
      lots: { orderBy: [{ productId: "asc" }, { expiryDate: "asc" }], include: { product: { select: { sku: true, name: true } } } },
    },
  });
  if (!r || !r.receivedAt) notFound();

  const productos = await prisma.product.findMany({ where: { id: { in: r.lines.map((l) => l.productId) } }, select: { id: true, sku: true, name: true } });
  const nombre = new Map(productos.map((p) => [p.id, p]));
  const cuadre = reconcile(r.lines, r.lots);

  return (
    <main className="print-doc mx-auto max-w-[860px] px-5 py-8">
      <div className="no-print mb-6 flex justify-end">
        <PrintButton />
      </div>

      <header className="flex items-start justify-between gap-4 border-b border-[var(--border-strong)] pb-4">
        <div className="flex items-center gap-3">
          <BrandTile size={36} />
          <div className="leading-tight">
            <p className="text-[15px] font-semibold">Fitt Global</p>
            <p className="text-[12px] text-[var(--text-muted)]">Ingreso de mercancía a bodega</p>
          </div>
        </div>
        <div className="text-right">
          <h1 className="text-[20px] font-semibold tracking-[-0.01em]">Packing slip</h1>
          <p className="font-mono text-[13px]">{r.code}</p>
          <p className="text-[12px] text-[var(--text-secondary)]">{RECEIPT_STATUS.label(r.status)}</p>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 py-4 text-[13px] sm:grid-cols-3">
        <Dato label="Proveedor">{r.supplierName}{r.supplierTaxId ? ` · NIT ${r.supplierTaxId}` : ""}</Dato>
        <Dato label="Factura">{r.invoiceNumber}{r.invoiceDate ? ` · ${fmtDate(r.invoiceDate)}` : ""}</Dato>
        <Dato label="Bodega">{r.warehouse.name} · {r.warehouse.city}</Dato>
        <Dato label="Recibido">{fmtDateTime(r.receivedAt)}</Dato>
        <Dato label="Recibió">{r.receivedBy?.name ?? "—"}</Dato>
        <Dato label="Lotes">{fmtNumber(r.lots.length)}</Dato>
      </dl>

      <h2 className="mb-2 mt-2 text-[13.5px] font-semibold">Lotes recibidos</h2>
      <table className="tbl">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Producto</th>
            <th>Lote</th>
            <th>Vencimiento</th>
            <th className="num">Unidades</th>
          </tr>
        </thead>
        <tbody>
          {r.lots.map((l) => (
            <tr key={l.id}>
              <td className="font-mono text-[12px]">{l.product.sku}</td>
              <td>{l.product.name}</td>
              <td className="font-mono text-[12px]">{l.lotCode}</td>
              <td>{fmtDate(l.expiryDate)}</td>
              <td className="num">{fmtNumber(l.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mb-2 mt-6 text-[13.5px] font-semibold">Cuadre contra la factura</h2>
      <table className="tbl">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Producto</th>
            <th className="num">Facturado</th>
            <th className="num">Recibido</th>
            <th className="num">Diferencia</th>
          </tr>
        </thead>
        <tbody>
          {cuadre.map((c) => (
            <tr key={c.productId}>
              <td className="font-mono text-[12px]">{nombre.get(c.productId)?.sku}</td>
              <td>{nombre.get(c.productId)?.name}</td>
              <td className="num">{fmtNumber(c.invoiced)}</td>
              <td className="num">{fmtNumber(c.received)}</td>
              <td className="num font-semibold">{c.diff === 0 ? "0" : `${c.diff > 0 ? "+" : "−"}${fmtNumber(Math.abs(c.diff))}`}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {r.receivedNotes && (
        <p className="mt-4 rounded-md border border-[var(--border-strong)] px-3 py-2 text-[12.5px]">
          <strong>Diferencias:</strong> {r.receivedNotes}
        </p>
      )}

      <div className="mt-14 grid grid-cols-2 gap-10 text-[12px] text-[var(--text-secondary)]">
        <p className="border-t border-[var(--border-strong)] pt-1.5">Recibe en bodega</p>
        <p className="border-t border-[var(--border-strong)] pt-1.5">Entrega (transportador o proveedor)</p>
      </div>
    </main>
  );
}

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-muted)]">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
