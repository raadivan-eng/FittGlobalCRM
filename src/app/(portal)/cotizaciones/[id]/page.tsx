import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSection, SUPPLIER_ROLES } from "@/lib/auth";
import { QUOTE_EVENTS, QUOTE_OPEN, QUOTE_STATUS } from "@/lib/enums";
import { agregarNotaCotizacion } from "@/lib/actions-suppliers";
import { claudeApiKey } from "@/lib/lector-documentos";
import { siigoCustomersReady } from "@/lib/siigo-clientes";
import { lineComplete, minOrderValue, totalLeadDays } from "@/lib/suppliers";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { Avatar, Card, CardHeader, EnumBadge, KeyValue, PageHeader } from "@/components/ui";
import { ConditionsTable } from "@/components/supplier-forms";
import { IconMail, IconPhone } from "@/components/icons";
import { ConvertQuoteForm, QuoteDataForm, QuoteFollowUpForm } from "../quote-controls";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quote = await prisma.supplierQuote.findUnique({ where: { id }, select: { name: true } });
  return { title: quote?.name ?? "Cotización" };
}

export default async function CotizacionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSection("proveedores");
  const { id } = await params;

  const [quote, owners, reader, siigo] = await Promise.all([
    prisma.supplierQuote.findUnique({
      where: { id },
      include: {
        owner: { select: { name: true, avatarColor: true } },
        createdBy: { select: { name: true } },
        supplier: { select: { id: true, code: true, name: true } },
        events: { orderBy: { occurredAt: "desc" }, take: 200, include: { user: { select: { name: true } } } },
        lines: { orderBy: { createdAt: "asc" }, include: { product: { select: { id: true, name: true } } } },
      },
    }),
    prisma.user.findMany({ where: { active: true, role: { in: SUPPLIER_ROLES } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    claudeApiKey().then(Boolean),
    siigoCustomersReady(),
  ]);
  if (!quote) notFound();

  const isOpen = (QUOTE_OPEN as readonly string[]).includes(quote.status);
  const editable = !quote.supplier;
  const missing = quote.lines.filter((l) => !lineComplete(l)).map((l) => l.sku);
  const minimum = quote.lines.reduce((s, l) => s + (minOrderValue(l) ?? 0), 0);
  const leads = quote.lines.map(totalLeadDays).filter((d): d is number => d != null);
  const digits = quote.phone?.replace(/\D/g, "");

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Cotizaciones", href: "/cotizaciones" }, { label: quote.code }]}
        title={quote.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <EnumBadge option={QUOTE_STATUS.get(quote.status)} dot />
            <span className="text-[12.5px] text-[var(--text-muted)]">
              Creada el {fmtDate(quote.createdAt)}
              {quote.createdBy ? ` por ${quote.createdBy.name}` : ""}
            </span>
          </span>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <Card>
            <CardHeader title="Resumen" />
            <dl className="grid gap-x-6 px-4 py-2 sm:grid-cols-3">
              <KeyValue label="Condiciones de compra">
                {quote.paymentTerms ?? <span className="text-[var(--text-muted)]">Sin definir</span>}
                {quote.paymentTermDays != null && <span className="block text-[12px] text-[var(--text-muted)]">{quote.paymentTermDays === 0 ? "De contado" : `${quote.paymentTermDays} días de plazo`}</span>}
              </KeyValue>
              <KeyValue label="Compra mínima total">
                {minimum ? fmtMoney(minimum) : "—"}
                <span className="block text-[12px] text-[var(--text-muted)]">Mínimo de cada SKU por su costo</span>
              </KeyValue>
              <KeyValue label="Lead time">
                {leads.length ? (Math.min(...leads) === Math.max(...leads) ? `${leads[0]} días` : `${Math.min(...leads)} a ${Math.max(...leads)} días`) : "—"}
                <span className="block text-[12px] text-[var(--text-muted)]">Producción más tránsito</span>
              </KeyValue>
              <KeyValue label="Contacto">
                {quote.contactName ?? "—"}
                <span className="flex flex-wrap gap-x-3 text-[12px] text-[var(--text-secondary)]">
                  {quote.phone && (
                    <>
                      <a href={`tel:${quote.phone}`} className="inline-flex items-center gap-1 hover:text-[var(--brand)]">
                        <IconPhone size={12} /> {quote.phone}
                      </a>
                      <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" className="text-[var(--brand)] hover:underline">WhatsApp</a>
                    </>
                  )}
                  {quote.email && (
                    <a href={`mailto:${quote.email}`} className="inline-flex items-center gap-1 hover:text-[var(--brand)]">
                      <IconMail size={12} /> {quote.email}
                    </a>
                  )}
                </span>
              </KeyValue>
              <KeyValue label="Ciudad">{quote.city ?? "—"}</KeyValue>
              {quote.discardReason && <KeyValue label="Motivo del descarte">{quote.discardReason}</KeyValue>}
            </dl>
            {quote.notes && <p className="whitespace-pre-line border-t border-[var(--border)] px-4 py-3 text-[13px] text-[var(--text-secondary)]">{quote.notes}</p>}
          </Card>

          <Card>
            <CardHeader
              title="SKU cotizados"
              subtitle={
                editable
                  ? "Lo que respondió el proveedor por cada producto. Para aprobar la cotización, todos deben tener mínimo, costo, producción y tránsito."
                  : "Pasaron a ser las condiciones vigentes del proveedor."
              }
            />
            <ConditionsTable scope="quote" parentId={quote.id} rows={quote.lines} editable={editable && isOpen} />
          </Card>

          <Card>
            <CardHeader title="Bitácora" subtitle="Notas del equipo, cada cambio de seguimiento y la aprobación." />
            <form action={agregarNotaCotizacion} className="flex flex-col gap-2 border-b border-[var(--border)] px-4 py-3">
              <input type="hidden" name="id" value={quote.id} />
              <textarea name="body" rows={2} required className="field resize-none" placeholder="Llamada, muestras, contraoferta, próximo paso…" />
              <div>
                <button type="submit" className="btn btn-secondary">Agregar nota</button>
              </div>
            </form>
            <ol className="divide-y divide-[var(--border)]">
              {quote.events.map((e) => (
                <li key={e.id} className="flex gap-3 px-4 py-3">
                  <div className="w-[88px] shrink-0">
                    <EnumBadge option={QUOTE_EVENTS.get(e.type)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-line break-words text-[13px]">{e.body}</p>
                    <p className="mt-0.5 text-[11.5px] text-[var(--text-muted)]">
                      {fmtDateTime(e.occurredAt)} · {e.user?.name ?? "Portal"}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          {editable && (
            <Card>
              <CardHeader title="Datos del proveedor" subtitle="Corrige el nombre y el contacto a medida que los confirmes." />
              <div className="px-4 py-4">
                <QuoteDataForm quote={quote} />
              </div>
            </Card>
          )}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          {quote.supplier ? (
            <Card>
              <CardHeader title="Ya es proveedor" subtitle={quote.convertedAt ? `Aprobada el ${fmtDate(quote.convertedAt)}` : undefined} />
              <div className="px-4 py-4">
                <Link href={`/proveedores/${quote.supplier.id}`} className="font-medium text-[var(--brand)] hover:underline">
                  {quote.supplier.code} · {quote.supplier.name}
                </Link>
              </div>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader title="Seguimiento" />
                <div className="px-4 py-4">
                  <QuoteFollowUpForm quote={quote} owners={owners} />
                </div>
              </Card>
              {isOpen && (
                <Card>
                  <CardHeader
                    title="Aprobar y crear proveedor"
                    subtitle="Con las condiciones de compra confirmadas, crea el proveedor con estos SKU. Exige su RUT —de ahí salen los datos tributarios con que se crea en Siigo— y su certificado de Cámara de Comercio."
                  />
                  <div className="px-4 py-4">
                    <ConvertQuoteForm quote={quote} missing={missing} reader={reader} siigo={siigo} />
                  </div>
                </Card>
              )}
            </>
          )}

          <Card>
            <CardHeader title="Responsable" />
            <div className="flex items-center gap-2.5 px-4 py-3 text-[13px]">
              {quote.owner ? (
                <>
                  <Avatar name={quote.owner.name} color={quote.owner.avatarColor} size={28} />
                  {quote.owner.name}
                </>
              ) : (
                <span className="text-[var(--text-muted)]">Sin asignar: elígelo en Seguimiento.</span>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
