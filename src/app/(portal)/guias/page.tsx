import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { can, requireSection } from "@/lib/auth";
import { carrierCapabilities } from "@/lib/carriers";
import { CARRIERS, providerByKey } from "@/lib/integrations";
import { SHIPMENT_ACTIVE, SHIPMENT_SOURCE, SHIPMENT_STATUS } from "@/lib/enums";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { anyOf, flatten, many, one, pageCount, pagination, type SearchParams } from "@/lib/params";
import { Card, EmptyState, EnumBadge, PageHeader, StatTile } from "@/components/ui";
import { Filters } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import { IconAlert, IconCheck, IconClock, IconPlus, IconTruck } from "@/components/icons";
import { RefreshActiveButton } from "./shipment-controls";

export const metadata = { title: "Guías de envío" };
export const dynamic = "force-dynamic";

/** Una guía en curso sin movimientos en este lapso merece una llamada a la transportadora. */
const HORAS_SIN_MOVIMIENTO = 72;

export default async function GuiasPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireSection("guias");
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const status = one(sp.estado);
  const carriers = many(sp.transportadora);
  const { page, pageSize, skip, take } = pagination(sp.page, 25);

  const statusFilter =
    status === "EN_CURSO" ? { status: { in: [...SHIPMENT_ACTIVE] } } : status ? { status } : {};

  const where = {
    ...statusFilter,
    ...(carriers.length ? { carrier: anyOf(carriers) } : {}),
    ...(q
      ? {
          OR: [
            { code: { contains: q } },
            { trackingNumber: { contains: q } },
            { recipientName: { contains: q } },
            { destinationCity: { contains: q } },
            { order: { number: { contains: q } } },
          ],
        }
      : {}),
  };

  const now = new Date();
  const hace30 = new Date(now.getTime() - 30 * 86_400_000);

  const [shipments, total, counts, active, delivered, caps] = await Promise.all([
    prisma.shipment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        order: { select: { number: true } },
        company: { select: { name: true } },
        events: { orderBy: { occurredAt: "desc" }, take: 1, select: { description: true, occurredAt: true, location: true } },
      },
    }),
    prisma.shipment.count({ where }),
    prisma.shipment.groupBy({ by: ["status"], _count: true }),
    prisma.shipment.findMany({
      where: { status: { in: [...SHIPMENT_ACTIVE] } },
      select: { createdAt: true, events: { orderBy: { occurredAt: "desc" }, take: 1, select: { occurredAt: true } } },
    }),
    prisma.shipment.findMany({
      where: { status: "ENTREGADA", deliveredAt: { gte: hace30 } },
      select: { createdAt: true, deliveredAt: true },
    }),
    carrierCapabilities(),
  ]);

  const byStatus = new Map(counts.map((c) => [c.status, c._count]));
  const limite = now.getTime() - HORAS_SIN_MOVIMIENTO * 3_600_000;
  const quietas = active.filter((s) => (s.events[0]?.occurredAt ?? s.createdAt).getTime() < limite).length;
  const diasEntrega = delivered.length
    ? delivered.reduce((sum, s) => sum + (s.deliveredAt!.getTime() - s.createdAt.getTime()) / 86_400_000, 0) / delivered.length
    : null;

  const rastreables = caps.filter((c) => c.canTrack);
  const conApi = caps.filter((c) => c.connected).length;

  return (
    <>
      <PageHeader
        title="Guías de envío"
        subtitle="Control de los despachos que salen con transportadoras: número de guía, destino, pedido asociado y la trazabilidad de cada envío hasta su entrega."
        actions={
          <>
            {rastreables.length > 0 && <RefreshActiveButton />}
            <Link href="/guias/nueva" className="btn btn-primary">
              <IconPlus size={14} /> Nueva guía
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="En curso"
          value={fmtNumber(active.length)}
          hint={`${fmtNumber(byStatus.get("BORRADOR") ?? 0)} en borrador`}
          icon={<IconTruck size={15} />}
          href="/guias?estado=EN_CURSO"
        />
        <StatTile
          label="Con novedad"
          value={fmtNumber(byStatus.get("NOVEDAD") ?? 0)}
          hint="Requieren gestión con la transportadora"
          icon={<IconAlert size={15} />}
          href="/guias?estado=NOVEDAD"
        />
        <StatTile
          label="Sin movimiento"
          value={fmtNumber(quietas)}
          hint={`En curso, quietas más de ${HORAS_SIN_MOVIMIENTO} h`}
          icon={<IconClock size={15} />}
        />
        <StatTile
          label="Entregadas · 30 días"
          value={fmtNumber(delivered.length)}
          hint={diasEntrega != null ? `${diasEntrega.toFixed(1).replace(".", ",")} días en promedio` : "Sin entregas en el periodo"}
          icon={<IconCheck size={15} />}
          href="/guias?estado=ENTREGADA"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[12px]">
        <span className="font-semibold text-[var(--text-secondary)]">
          Integración por API · {conApi} de {caps.length}
        </span>
        {caps.map((c) => (
          <span key={c.key} className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
            <span className={`h-1.5 w-1.5 rounded-full ${c.connected ? "dot-success" : "dot-neutral"}`} />
            {c.name}
            <span className="text-[var(--text-muted)]">{c.connected ? "API" : c.integrated ? "sin conectar" : "manual"}</span>
          </span>
        ))}
        {can(user.role, "conexiones") && (
          <Link href="/conexiones" className="ml-auto text-[var(--brand)] hover:underline">
            Configurar conexiones
          </Link>
        )}
      </div>

      <div className="mt-5">
        <Filters
          fields={[
            { type: "search", name: "q", placeholder: "Número de guía, destinatario, ciudad o pedido…", width: "w-full sm:w-80" },
            {
              type: "select", name: "estado", label: "Estado",
              options: [
                { value: "EN_CURSO", label: "En curso (todas las activas)" },
                ...SHIPMENT_STATUS.options.map((o) => ({ value: o.value, label: o.label })),
              ],
              width: "w-56",
            },
            {
              type: "select", name: "transportadora", label: "Transportadora",
              options: CARRIERS.map((c) => ({ value: c.key, label: c.name })),
              width: "w-48",
              multi: true,
            },
          ]}
        />

        <Card>
          {shipments.length === 0 ? (
            <EmptyState
              icon={<IconTruck size={26} />}
              title={total === 0 && !q && !status && !carriers.length ? "Todavía no hay guías" : "Ninguna guía coincide"}
              description={
                total === 0 && !q && !status && !carriers.length
                  ? "Registra la primera guía de un despacho para empezar a seguirla."
                  : "Prueba con otro número, estado o transportadora."
              }
              action={
                <Link href="/guias/nueva" className="btn btn-primary">
                  <IconPlus size={14} /> Nueva guía
                </Link>
              }
            />
          ) : (
            <>
              <div className="scroll-x">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Guía</th>
                      <th>Transportadora</th>
                      <th>Destino</th>
                      <th>Pedido</th>
                      <th>Estado</th>
                      <th>Último movimiento</th>
                      <th>Origen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shipments.map((s) => {
                      const last = s.events[0];
                      return (
                        <tr key={s.id}>
                          <td className="whitespace-nowrap">
                            <Link href={`/guias/${s.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                              {s.trackingNumber ?? "Sin número"}
                            </Link>
                            <span className="block font-mono text-[11px] text-[var(--text-muted)]">{s.code}</span>
                          </td>
                          <td className="whitespace-nowrap">{providerByKey(s.carrier)?.name ?? s.carrier}</td>
                          <td className="min-w-[180px]">
                            <span className="block">{s.recipientName}</span>
                            <span className="block text-[11.5px] text-[var(--text-muted)]">
                              {s.destinationCity}
                              {s.company && !s.recipientName.startsWith(s.company.name) ? ` · ${s.company.name}` : ""}
                            </span>
                          </td>
                          <td className="whitespace-nowrap text-[var(--text-secondary)]">{s.order?.number ?? "—"}</td>
                          <td>
                            <EnumBadge option={SHIPMENT_STATUS.get(s.status)} dot />
                            {s.lastSyncError && (
                              <span className="mt-1 block text-[11px] text-[var(--tone-danger-fg)]" title={s.lastSyncError}>
                                Error en la última consulta
                              </span>
                            )}
                          </td>
                          <td className="min-w-[200px] max-w-[320px]">
                            {last ? (
                              <>
                                <span className="truncate-2 text-[var(--text-secondary)]">{last.description}</span>
                                <span className="block text-[11.5px] text-[var(--text-muted)]">
                                  {fmtDateTime(last.occurredAt)}
                                  {last.location ? ` · ${last.location}` : ""}
                                </span>
                              </>
                            ) : (
                              <span className="text-[var(--text-muted)]">Creada el {fmtDate(s.createdAt)}</span>
                            )}
                          </td>
                          <td><EnumBadge option={SHIPMENT_SOURCE.get(s.source)} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageCount={pageCount(total, pageSize)} total={total} params={flatten(sp)} basePath="/guias" />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
