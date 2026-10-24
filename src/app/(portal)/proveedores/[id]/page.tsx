import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSection, SUPPLIER_ROLES } from "@/lib/auth";
import { QUOTE_STATUS, SIIGO_CUSTOMER, SUPPLIER_ORIGIN } from "@/lib/enums";
import { enviarProveedorASiigo } from "@/lib/actions-suppliers";
import { parseTaxData, taxSummary } from "@/lib/rut";
import { minOrderValue, totalLeadDays } from "@/lib/suppliers";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { Badge, Card, CardHeader, EnumBadge, KeyValue, PageHeader, StatTile } from "@/components/ui";
import { ConditionsTable } from "@/components/supplier-forms";
import { IconClock, IconProduct, IconQuote, IconSales } from "@/components/icons";
import { SupplierForm } from "../supplier-controls";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supplier = await prisma.supplier.findUnique({ where: { id }, select: { name: true } });
  return { title: supplier?.name ?? "Proveedor" };
}

export default async function ProveedorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSection("proveedores");
  const { id } = await params;

  const [supplier, owners] = await Promise.all([
    prisma.supplier.findUnique({
      where: { id },
      include: {
        owner: { select: { name: true } },
        products: { orderBy: { sku: "asc" }, include: { product: { select: { id: true, name: true } } } },
        quotes: { orderBy: { createdAt: "desc" }, select: { id: true, code: true, status: true, convertedAt: true, createdAt: true } },
      },
    }),
    prisma.user.findMany({ where: { active: true, role: { in: SUPPLIER_ROLES } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!supplier) notFound();

  const fiscal = parseTaxData(supplier.fiscalData);
  const camara = parseTaxData(supplier.chamberData);
  const siigoState = supplier.siigoId ? "EN_SIIGO" : supplier.siigoError ? "RECHAZADO" : "SIN_ENVIAR";
  const leads = supplier.products.map(totalLeadDays).filter((d): d is number => d != null);
  const minimum = supplier.products.reduce((s, p) => s + (minOrderValue(p) ?? 0), 0);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Proveedores", href: "/proveedores" }, { label: supplier.name }]}
        title={supplier.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <EnumBadge option={SUPPLIER_ORIGIN.get(supplier.origin)} />
            <EnumBadge option={SIIGO_CUSTOMER.get(siigoState)} />
            {!supplier.active && <Badge>Inactivo</Badge>}
            <span className="text-[12.5px] text-[var(--text-muted)]">
              {supplier.code}
              {supplier.taxId ? ` · NIT ${supplier.taxId}` : ""} · desde el {fmtDate(supplier.createdAt)}
            </span>
          </span>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="SKU" value={fmtNumber(supplier.products.length)} hint="Con condiciones vigentes" icon={<IconProduct size={15} />} />
        <StatTile label="Compra mínima" value={minimum ? fmtMoney(minimum) : "—"} hint="Mínimo de cada SKU por su costo" icon={<IconSales size={15} />} />
        <StatTile
          label="Lead time"
          value={leads.length ? (Math.min(...leads) === Math.max(...leads) ? `${leads[0]} d` : `${Math.min(...leads)}–${Math.max(...leads)} d`) : "—"}
          hint="Producción más tránsito"
          icon={<IconClock size={15} />}
        />
        <StatTile
          label="Condiciones de compra"
          value={supplier.paymentTermDays != null ? (supplier.paymentTermDays === 0 ? "Contado" : `${supplier.paymentTermDays} d`) : "—"}
          hint={supplier.paymentTerms ?? "Sin definir"}
          icon={<IconQuote size={15} />}
        />
      </div>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <Card>
            <CardHeader
              title="Condiciones por SKU"
              subtitle="Cantidad mínima, costo sin IVA, production lead time y transit time vigentes con este proveedor. Una cotización nueva aprobada las actualiza."
            />
            <ConditionsTable scope="supplier" parentId={supplier.id} rows={supplier.products} editable />
            {!supplier.products.length && (
              <p className="px-4 pb-3 text-[12.5px] text-[var(--text-muted)]">
                {supplier.origin === "SIIGO" ? "Siigo no guarda condiciones por SKU: cárgalas aquí." : "Sin SKU todavía."}
              </p>
            )}
          </Card>

          <Card>
            <CardHeader title="Datos del proveedor" subtitle="Contacto, condiciones de compra y si se le sigue comprando." />
            <div className="px-4 py-4">
              <SupplierForm supplier={supplier} owners={owners} />
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <Card>
            <CardHeader title="Documentos y Siigo" subtitle={fiscal ? "Leídos al aprobar la cotización." : undefined} />
            <dl className="grid grid-cols-2 gap-x-4 px-4 py-3">
              <KeyValue label="RUT">
                {fiscal ? (
                  <>
                    {fiscal.legalName}
                    <span className="block text-[12px] text-[var(--text-muted)]">{fiscal.issuedAt ? `Generado ${fiscal.issuedAt}` : "Sin fecha"}</span>
                  </>
                ) : (
                  <span className="text-[var(--text-muted)]">Sin cargar</span>
                )}
              </KeyValue>
              <KeyValue label="Cámara de Comercio">
                {camara ? (
                  <>
                    {camara.issuedAt ? `Expedido ${camara.issuedAt}` : "Sin fecha"}
                    {camara.legalRepresentative && <span className="block text-[12px] text-[var(--text-muted)]">Rep. legal: {camara.legalRepresentative}</span>}
                  </>
                ) : (
                  <span className="text-[var(--text-muted)]">Sin cargar</span>
                )}
              </KeyValue>
              {fiscal && <KeyValue label="Situación tributaria">{taxSummary(fiscal)}</KeyValue>}
              <KeyValue label="Siigo">
                <EnumBadge option={SIIGO_CUSTOMER.get(siigoState)} />
              </KeyValue>
            </dl>
            {fiscal && !supplier.siigoId && (
              <form action={enviarProveedorASiigo} className="flex flex-col items-start gap-1.5 border-t border-[var(--border)] px-4 py-3">
                <input type="hidden" name="supplierId" value={supplier.id} />
                {supplier.siigoError && <p className="text-[12px] text-[var(--tone-danger-fg)]">{supplier.siigoError}</p>}
                <button type="submit" className="btn btn-secondary">
                  {supplier.siigoError ? "Reintentar en Siigo" : "Crear en Siigo"}
                </button>
              </form>
            )}
            {!fiscal && !supplier.siigoId && (
              <p className="border-t border-[var(--border)] px-4 py-3 text-[12px] text-[var(--text-muted)]">
                Para crearlo en Siigo hace falta su RUT: entra por una cotización aprobada.
              </p>
            )}
          </Card>

          <Card>
            <CardHeader title="Cotizaciones" subtitle="Las que se aprobaron con este proveedor." />
            {supplier.quotes.length ? (
              <ul className="divide-y divide-[var(--border)]">
                {supplier.quotes.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                    <Link href={`/cotizaciones/${c.id}`} className="font-mono text-[12.5px] text-[var(--brand)] hover:underline">{c.code}</Link>
                    <span className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
                      {fmtDate(c.convertedAt ?? c.createdAt)}
                      <EnumBadge option={QUOTE_STATUS.get(c.status)} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-[12.5px] text-[var(--text-muted)]">
                {supplier.origin === "SIIGO" ? "Se trajo de Siigo, sin cotización en el portal." : "Sin cotizaciones."}
              </p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
