import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { carrierCapabilities } from "@/lib/carriers";
import { providerByKey } from "@/lib/integrations";
import { SHIPMENT_ACTIVE, SHIPMENT_CLOSED, SHIPMENT_SOURCE, SHIPMENT_STATUS } from "@/lib/enums";
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from "@/lib/format";
import { Card, CardHeader, EmptyState, EnumBadge, KeyValue, PageHeader } from "@/components/ui";
import { IconAlert, IconExternal, IconTruck } from "@/components/icons";
import { AssignNumberForm, CancelForm, MovementForm, RequestButton, TrackButton } from "../shipment-controls";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await prisma.shipment.findUnique({ where: { id }, select: { code: true, trackingNumber: true } });
  return { title: s ? `Guía ${s.trackingNumber ?? s.code}` : "Guía" };
}

/** Lo que se puede anotar a mano: todo menos los estados que maneja el propio portal. */
const MANUAL_CHOICES = SHIPMENT_STATUS.options
  .filter((o) => !["BORRADOR", "ANULADA"].includes(o.value))
  .map((o) => ({ value: o.value, label: o.label }));

export default async function GuiaDetalle({ params }: { params: Promise<{ id: string }> }) {
  await requireSection("guias");
  const { id } = await params;

  const [s, caps] = await Promise.all([
    prisma.shipment.findUnique({
      where: { id },
      include: {
        order: { select: { number: true, date: true, total: true, status: true } },
        company: { select: { id: true, name: true } },
        store: { select: { id: true, name: true } },
        createdBy: { select: { name: true } },
        events: { orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }], include: { user: { select: { name: true } } } },
      },
    }),
    carrierCapabilities(),
  ]);
  if (!s) notFound();

  const carrierName = providerByKey(s.carrier)?.name ?? s.carrier;
  const cap = caps.find((c) => c.key === s.carrier);
  const closed = (SHIPMENT_CLOSED as readonly string[]).includes(s.status);
  const isDraft = s.status === "BORRADOR";
  const canTrack = Boolean(cap?.canTrack && s.trackingNumber && !closed && !isDraft);
  // El siguiente paso natural del ciclo, para no obligar a buscarlo en la lista.
  const activeIdx = SHIPMENT_ACTIVE.indexOf(s.status as (typeof SHIPMENT_ACTIVE)[number]);
  const nextStatus = activeIdx >= 0 && activeIdx < 3 ? SHIPMENT_ACTIVE[activeIdx + 1] : "ENTREGADA";

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Guías de envío", href: "/guias" }, { label: s.code }]}
        title={s.trackingNumber ? `Guía ${s.trackingNumber}` : `Borrador ${s.code}`}
        subtitle={`${carrierName} · para ${s.recipientName} en ${s.destinationCity}`}
        actions={<EnumBadge option={SHIPMENT_STATUS.get(s.status)} dot />}
      />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {isDraft && (
            <Card>
              <CardHeader
                title="Pendiente de número de guía"
                subtitle={
                  cap?.canCreate
                    ? `Se puede pedir a ${carrierName} desde aquí o registrar el número si la guía se hizo en su sitio.`
                    : `${carrierName} todavía no tiene la creación de guías por API habilitada: haz la guía en su sitio y registra aquí el número.`
                }
              />
              <div className="flex flex-col gap-3 px-4 py-3.5">
                {s.lastSyncError && <SyncError message={s.lastSyncError} />}
                {cap?.canCreate && <RequestButton id={s.id} carrier={carrierName} />}
                <AssignNumberForm id={s.id} />
              </div>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Trazabilidad"
              subtitle={
                cap?.canTrack
                  ? `Estado consultado a ${carrierName}${s.lastSyncAt ? ` · última consulta ${fmtDateTime(s.lastSyncAt)}` : " · todavía sin consultar"}`
                  : `${carrierName} no tiene consulta por API: los movimientos se anotan a mano`
              }
              action={canTrack ? <TrackButton id={s.id} /> : undefined}
            />
            {!isDraft && s.lastSyncError && (
              <div className="border-b border-[var(--border)] px-4 py-2.5">
                <SyncError message={s.lastSyncError} />
              </div>
            )}
            {s.events.length ? (
              <ol className="px-4 py-3">
                {s.events.map((e, i) => {
                  const opt = SHIPMENT_STATUS.get(e.status);
                  return (
                    <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
                      {i < s.events.length - 1 && (
                        <span aria-hidden className="absolute left-[5px] top-4 h-[calc(100%-12px)] w-px bg-[var(--border)]" />
                      )}
                      <span aria-hidden className={`mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full dot-${opt.tone}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[13px] font-medium">{opt.label}</span>
                          <EnumBadge option={SHIPMENT_SOURCE.get(e.source)} />
                        </div>
                        <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">{e.description}</p>
                        <p className="mt-0.5 text-[11.5px] text-[var(--text-muted)]">
                          {fmtDateTime(e.occurredAt)}
                          {e.location ? ` · ${e.location}` : ""}
                          {e.user ? ` · ${e.user.name}` : ""}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <EmptyState icon={<IconTruck size={24} />} title="Sin movimientos" description="Cuando la transportadora reporte avances aparecerán aquí." />
            )}
            {!isDraft && s.status !== "ANULADA" && (
              <div className="border-t border-[var(--border)] px-4 py-3">
                <MovementForm id={s.id} choices={MANUAL_CHOICES} defaultStatus={nextStatus} />
              </div>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader title="Datos del envío" subtitle={`Creada el ${fmtDate(s.createdAt)}${s.createdBy ? ` por ${s.createdBy.name}` : ""}`} />
          <dl className="grid grid-cols-2 gap-x-4 px-4 py-2">
            <KeyValue label="Transportadora">{carrierName}</KeyValue>
            <KeyValue label="Origen"><EnumBadge option={SHIPMENT_SOURCE.get(s.source)} /></KeyValue>
            <KeyValue label="Número de guía">
              <span className="font-mono text-[12.5px]">{s.trackingNumber ?? "—"}</span>
            </KeyValue>
            <KeyValue label="Consecutivo">
              <span className="font-mono text-[12.5px]">{s.code}</span>
            </KeyValue>
            <div className="col-span-2">
              <KeyValue label="Destinatario">
                {s.recipientName}
                {s.recipientPhone && <span className="block text-[12.5px] text-[var(--text-secondary)]">{s.recipientPhone}</span>}
              </KeyValue>
            </div>
            <div className="col-span-2">
              <KeyValue label="Dirección">
                {s.destinationAddress}
                <span className="block text-[12.5px] text-[var(--text-secondary)]">{s.destinationCity}</span>
              </KeyValue>
            </div>
            <KeyValue label="Paquetes">{fmtNumber(s.packages)}</KeyValue>
            <KeyValue label="Peso">{s.weightKg != null ? `${fmtNumber(s.weightKg)} kg` : "—"}</KeyValue>
            <KeyValue label="Valor declarado">{fmtMoney(s.declaredValue)}</KeyValue>
            <KeyValue label="Costo del flete">{s.shippingCost != null ? fmtMoney(s.shippingCost) : "—"}</KeyValue>
            <KeyValue label="Entrega estimada">{fmtDate(s.estimatedDelivery)}</KeyValue>
            <KeyValue label="Entregada">{fmtDate(s.deliveredAt)}</KeyValue>
            {s.contents && (
              <div className="col-span-2">
                <KeyValue label="Contenido">{s.contents}</KeyValue>
              </div>
            )}
            {s.notes && (
              <div className="col-span-2">
                <KeyValue label="Observaciones">{s.notes}</KeyValue>
              </div>
            )}
          </dl>

          <div className="border-t border-[var(--border)] px-4 py-2">
            <KeyValue label="Pedido">
              {s.order ? (
                <>
                  {s.order.number}
                  <span className="block text-[12.5px] text-[var(--text-secondary)]">
                    {fmtDate(s.order.date)} · {fmtMoney(s.order.total)}
                  </span>
                </>
              ) : (
                "Sin pedido asociado"
              )}
            </KeyValue>
            {s.company && (
              <KeyValue label="Cliente">
                <Link href={`/clientes/${s.company.id}`} className="hover:text-[var(--brand)] hover:underline">{s.company.name}</Link>
                {s.store && (
                  <Link href={`/tiendas/${s.store.id}`} className="block text-[12.5px] text-[var(--text-secondary)] hover:text-[var(--brand)] hover:underline">
                    {s.store.name}
                  </Link>
                )}
              </KeyValue>
            )}
          </div>

          {(s.labelUrl || !closed) && (
            <div className="flex flex-wrap gap-1.5 border-t border-[var(--border)] px-4 py-3">
              {s.labelUrl && (
                <a href={s.labelUrl} target="_blank" rel="noreferrer" className="btn btn-secondary !py-1 text-[12.5px]">
                  <IconExternal size={12} /> Rótulo de la guía
                </a>
              )}
              {!closed && <CancelForm id={s.id} />}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function SyncError({ message }: { message: string }) {
  return (
    <p className="flex items-start gap-1.5 rounded-md border border-[var(--tone-danger-bd)] bg-[var(--tone-danger-bg)] px-2 py-1.5 text-[12px] text-[var(--tone-danger-fg)]">
      <IconAlert size={13} className="mt-px shrink-0" />
      {message}
    </p>
  );
}
