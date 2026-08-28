import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { NOT_VOID, startOfMonth } from "@/lib/analytics";
import { loadStoresForRouting } from "@/lib/field";
import { scoreStores } from "@/lib/routing";
import { INCIDENT_TYPES, SEVERITIES, STORE_FORMATS, TIERS, VISIT_STATUS } from "@/lib/enums";
import { fmtCompact, fmtDate, fmtMoneyPrecise, fmtNumber, relativeDays } from "@/lib/format";
import { Card, CardHeader, EnumBadge, KeyValue, PageHeader, StatTile } from "@/components/ui";
import { ScoreBadge } from "@/components/score-badge";
import { IconAlert, IconClock, IconPin, IconRoute, IconVisit } from "@/components/icons";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await prisma.store.findUnique({ where: { id }, select: { name: true } });
  return { title: s?.name ?? "Tienda" };
}

export default async function TiendaDetalle({ params }: { params: Promise<{ id: string }> }) {
  await requireSection("tiendas");
  const { id } = await params;

  const store = await prisma.store.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true, tier: true, channel: true } },
      assignments: { include: { user: { select: { id: true, name: true, phone: true, zone: true, avatarColor: true } } } },
      contacts: { orderBy: { lastName: "asc" } },
    },
  });
  if (!store) notFound();

  const since = startOfMonth(-2);
  const [visits, openIncidents, orderTotals, signals] = await Promise.all([
    prisma.visit.findMany({
      where: { storeId: id },
      orderBy: { plannedDate: "desc" },
      take: 10,
      include: {
        user: { select: { name: true } },
        _count: { select: { shelfReports: true, incidents: true } },
      },
    }),
    prisma.incident.findMany({
      where: { storeId: id, status: { in: ["ABIERTA", "EN_PROCESO"] } },
      orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
      include: { product: { select: { name: true, imageEmoji: true } }, reportedBy: { select: { name: true } } },
    }),
    prisma.salesOrder.aggregate({ where: { storeId: id, date: { gte: since }, status: NOT_VOID }, _sum: { total: true }, _count: true }),
    loadStoresForRouting({ storeIds: [id] }),
  ]);

  const scored = scoreStores(signals)[0];

  const lastCompleted = visits.find((v) => v.status === "COMPLETADA");
  const shelf = lastCompleted
    ? await prisma.shelfReport.findMany({
        where: { visitId: lastCompleted.id },
        include: { product: { select: { name: true, sku: true, imageEmoji: true, unitPrice: true } } },
        orderBy: { outOfStock: "desc" },
      })
    : [];

  const oosCount = shelf.filter((s) => s.outOfStock).length;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Tiendas", href: "/tiendas" }, { label: store.name }]}
        title={store.name}
        subtitle={
          <>
            {store.code} · <Link href={`/clientes/${store.company.id}`} className="hover:text-[var(--brand)] hover:underline">{store.company.name}</Link> ·{" "}
            {STORE_FORMATS.label(store.format)} · {store.zone}, {store.city}
          </>
        }
        actions={
          <>
            <EnumBadge option={TIERS.get(store.tier)} />
            {scored && <ScoreBadge score={scored.score} />}
            <Link href={`/rutas?mercaderista=${store.assignments[0]?.userId ?? ""}&zona=${encodeURIComponent(store.zone)}`} className="btn btn-secondary">
              <IconRoute size={15} /> Ver en ruta
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Prioridad de visita"
          value={scored ? `${scored.score}/100` : "—"}
          hint={scored?.reasons[0]?.label ?? "Sin señales registradas"}
          icon={<IconRoute size={15} />}
        />
        <StatTile
          label="Última visita"
          value={scored?.daysSinceVisit == null ? "Nunca" : relativeDays(scored.daysSinceVisit)}
          hint={`Objetivo: ${store.visitsPerMonth} visitas al mes (cada ${Math.round(30 / Math.max(1, store.visitsPerMonth))} días)`}
          icon={<IconVisit size={15} />}
        />
        <StatTile label="Novedades abiertas" value={fmtNumber(openIncidents.length)} hint={`${fmtNumber(openIncidents.filter((i) => ["CRITICA", "ALTA"].includes(i.severity)).length)} de severidad alta o crítica`} icon={<IconAlert size={15} />} />
        <StatTile label="Pedido directo 3 meses" value={fmtCompact(orderTotals._sum.total ?? 0)} hint={`${fmtNumber(orderTotals._count)} pedidos con entrega en esta tienda`} icon={<IconPin size={15} />} />
      </div>

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Ficha del punto de venta" />
            <dl className="grid grid-cols-2 gap-x-4 px-4 py-3">
              <KeyValue label="Dirección">{store.address ?? "—"}</KeyValue>
              <KeyValue label="Horario">{store.openTime} – {store.closeTime}</KeyValue>
              <KeyValue label="Duración media de visita">{store.avgVisitMinutes} min</KeyValue>
              <KeyValue label="Coordenadas">{store.lat.toFixed(4)}, {store.lng.toFixed(4)}</KeyValue>
              <KeyValue label="Canal del cliente">{store.company.channel}</KeyValue>
              <KeyValue label="Frecuencia">{store.visitsPerMonth} visitas/mes</KeyValue>
            </dl>
          </Card>

          {scored && (
            <Card>
              <CardHeader title="Por qué está priorizada" subtitle="Composición del score de visita" />
              <ul className="flex flex-col gap-2 px-4 py-3.5">
                {scored.reasons.map((r) => (
                  <li key={r.label} className="flex items-center justify-between gap-3 text-[12.5px]">
                    <span className="text-[var(--text-secondary)]">{r.label}</span>
                    <span className="shrink-0 font-semibold tabular">+{r.points}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader title="Equipo asignado" />
            {store.assignments.length === 0 ? (
              <p className="px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">Sin mercaderista asignado.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {store.assignments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-3">
                    <div>
                      <p className="text-[13px] font-medium">{a.user.name}</p>
                      <p className="text-[11.5px] text-[var(--text-muted)]">Zona {a.user.zone ?? "—"} · {a.user.phone ?? "sin teléfono"}</p>
                    </div>
                    <span className="badge badge-neutral">Prioridad {a.priority}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Contactos en la tienda" />
            {store.contacts.length === 0 ? (
              <p className="px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">Sin contactos registrados en este punto.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {store.contacts.map((c) => (
                  <li key={c.id} className="px-4 py-2.5">
                    <p className="text-[13px] font-medium">{c.firstName} {c.lastName}</p>
                    <p className="text-[11.5px] text-[var(--text-muted)]">{c.position} · {c.phone ?? c.email ?? "sin datos"}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Última medición de góndola"
              subtitle={lastCompleted ? `Visita del ${fmtDate(lastCompleted.plannedDate)} · ${lastCompleted.user.name} · ${oosCount} SKU en quiebre` : "Sin visitas completadas"}
            />
            {shelf.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">Todavía no hay reportes de góndola para esta tienda.</p>
            ) : (
              <div className="scroll-x">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th className="num">Caras</th>
                      <th className="num">Unid.</th>
                      <th className="num">Precio góndola</th>
                      <th className="num">Competencia</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shelf.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <span className="font-medium">{r.product.imageEmoji} {r.product.name}</span>
                          <p className="font-mono text-[11px] text-[var(--text-muted)]">{r.product.sku}</p>
                        </td>
                        <td className="num">{r.facings}</td>
                        <td className="num">{r.unitsOnShelf}</td>
                        <td className="num">{r.shelfPrice ? fmtMoneyPrecise(r.shelfPrice) : "—"}</td>
                        <td className="num text-[var(--text-secondary)]">{r.competitorPrice ? fmtMoneyPrecise(r.competitorPrice) : "—"}</td>
                        <td>
                          <span className="flex flex-wrap gap-1">
                            {r.outOfStock && <span className="badge badge-danger">Quiebre</span>}
                            {!r.planogramOk && <span className="badge badge-warning">Planograma</span>}
                            {!r.priceTagOk && <span className="badge badge-warning">Precio</span>}
                            {r.nearExpiryUnits > 0 && <span className="badge badge-danger">{r.nearExpiryUnits} u. por vencer</span>}
                            {r.outOfStock === false && r.planogramOk && r.priceTagOk && r.nearExpiryUnits === 0 && (
                              <span className="badge badge-success">Conforme</span>
                            )}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Novedades abiertas" action={<Link href={`/novedades?tienda=${store.id}`} className="btn btn-ghost !px-2 text-[12.5px]">Gestionar</Link>} />
            {openIncidents.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">Sin novedades pendientes en este punto de venta.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {openIncidents.map((i) => (
                  <li key={i.id} className="px-4 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium">{i.product?.imageEmoji ? `${i.product.imageEmoji} ` : ""}{i.title}</p>
                        <p className="mt-0.5 text-[11.5px] text-[var(--text-muted)]">
                          {i.code} · {INCIDENT_TYPES.label(i.type)} · reportó {i.reportedBy.name} el {fmtDate(i.createdAt)}
                        </p>
                      </div>
                      <EnumBadge option={SEVERITIES.get(i.severity)} dot />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Historial de visitas" subtitle="Últimas 10" />
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Mercaderista</th>
                    <th>Estado</th>
                    <th className="num">Duración</th>
                    <th className="num">SKU</th>
                    <th>Resumen</th>
                  </tr>
                </thead>
                <tbody>
                  {visits.map((v) => (
                    <tr key={v.id}>
                      <td className="whitespace-nowrap">{fmtDate(v.plannedDate)}</td>
                      <td className="text-[var(--text-secondary)]">{v.user.name}</td>
                      <td><EnumBadge option={VISIT_STATUS.get(v.status)} /></td>
                      <td className="num text-[var(--text-secondary)]">{v.durationMinutes ? `${v.durationMinutes} min` : "—"}</td>
                      <td className="num text-[var(--text-secondary)]">{v._count.shelfReports || "—"}</td>
                      <td className="max-w-[260px] truncate text-[var(--text-secondary)]" title={v.summary ?? ""}>{v.summary ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
