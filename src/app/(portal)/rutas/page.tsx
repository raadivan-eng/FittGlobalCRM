import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { centroid, loadStoresForRouting } from "@/lib/field";
import { buildRoute, clockAt, scoreStores, WEIGHTS } from "@/lib/routing";
import { STORE_FORMATS, TIERS } from "@/lib/enums";
import { fmtNumber, relativeDays } from "@/lib/format";
import { generarVisitasDeRuta } from "@/lib/actions-field";
import { Card, CardHeader, EmptyState, PageHeader, StatTile } from "@/components/ui";
import { ScoreBadge } from "@/components/score-badge";
import { RouteMap } from "@/components/route-map";
import { RouteControls } from "./route-controls";
import { IconClock, IconPin, IconRoute, IconSparkle, IconTarget } from "@/components/icons";

export const metadata = { title: "Planificador de rutas" };
export const dynamic = "force-dynamic";

const START_HOUR = 8;

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function RutasPage({ searchParams }: { searchParams: SP }) {
  const user = await requireSection("rutas");
  const sp = await searchParams;

  const team = await prisma.user.findMany({
    where: { role: "MERCADERISTA", active: true },
    select: { id: true, name: true, zone: true, avatarColor: true },
    orderBy: { name: "asc" },
  });

  const isField = user.role === "MERCADERISTA";
  const requested = one(sp.mercaderista);
  const selectedId = isField ? user.id : requested && team.some((t) => t.id === requested) ? requested : (team[0]?.id ?? user.id);
  const selected = team.find((t) => t.id === selectedId) ?? { id: user.id, name: user.name, zone: user.zone, avatarColor: user.avatarColor };

  const hours = Math.min(12, Math.max(2, Number(one(sp.horas) ?? 8) || 8));
  const maxStops = Math.min(20, Math.max(2, Number(one(sp.paradas) ?? 10) || 10));
  const zone = one(sp.zona) ?? "";
  const today = new Date();
  const dateStr = one(sp.fecha) ?? today.toISOString().slice(0, 10);

  const candidates = await loadStoresForRouting({ userId: selectedId });
  const zones = [...new Set(candidates.map((c) => c.zone))].sort();
  const filtered = zone ? candidates.filter((c) => c.zone === zone) : candidates;

  const scored = scoreStores(filtered, today);
  const origin = centroid(filtered);
  const plan = buildRoute(scored, { origin, workdayMinutes: hours * 60, maxStops });

  const inRoute = new Set(plan.stops.map((s) => s.store.id));
  const totalMinutes = plan.totalTravelMinutes + plan.totalVisitMinutes;
  const travelShare = totalMinutes ? (plan.totalTravelMinutes / totalMinutes) * 100 : 0;
  const overdueCount = scored.filter((s) => s.overdueDays > 0).length;

  const planPayload = JSON.stringify(
    plan.stops.map((s) => ({ storeId: s.store.id, sequence: s.sequence, travelMinutes: s.travelMinutes })),
  );

  return (
    <>
      <PageHeader
        title="Planificador de rutas"
        subtitle="El orden de la jornada sale de un score explicable: frecuencia comprometida, peso en facturación, novedades abiertas, quiebres y producto por vencer. Después se secuencia para perder el mínimo de tiempo en traslados."
        actions={
          plan.stops.length > 0 && (
            <form action={generarVisitasDeRuta}>
              <input type="hidden" name="userId" value={selectedId} />
              <input type="hidden" name="fecha" value={dateStr} />
              <input type="hidden" name="plan" value={planPayload} />
              <button type="submit" className="btn btn-primary">
                <IconSparkle size={15} /> Agendar {plan.stops.length} visitas
              </button>
            </form>
          )
        }
      />

      <RouteControls team={team} selectedId={selectedId} lockTeam={isField} hours={hours} maxStops={maxStops} zone={zone} zones={zones} date={dateStr} />

      {candidates.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconRoute size={26} />}
            title="Sin tiendas asignadas"
            description="Este mercaderista todavía no tiene puntos de venta asignados. Asígnalos desde la ficha de cada tienda o desde el equipo de campo."
            action={
              <Link href="/equipo" className="btn btn-secondary">
                Ir al equipo de campo
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Paradas en la jornada" value={fmtNumber(plan.stops.length)} hint={`de ${fmtNumber(scored.length)} tiendas candidatas`} icon={<IconPin size={15} />} />
            <StatTile label="Tiempo comprometido" value={`${Math.floor(totalMinutes / 60)} h ${totalMinutes % 60} min`} hint={`${travelShare.toFixed(0)}% en traslados · ${plan.distanceKm} km`} icon={<IconClock size={15} />} />
            <StatTile label="Prioridad capturada" value={`${plan.availableScore ? ((plan.capturedScore / plan.availableScore) * 100).toFixed(0) : 0}%`} hint={`${fmtNumber(plan.capturedScore)} de ${fmtNumber(plan.availableScore)} puntos disponibles`} icon={<IconTarget size={15} />} />
            <StatTile label="Frecuencia vencida" value={fmtNumber(overdueCount)} hint={`tiendas por encima de su intervalo objetivo`} icon={<IconRoute size={15} />} />
          </div>

          <div className="grid items-start gap-4 xl:grid-cols-[1.15fr_1fr]">
            <Card>
              <CardHeader
                title="Recorrido propuesto"
                subtitle={`Inicio ${clockAt(START_HOUR, 0)} · cierre estimado ${clockAt(START_HOUR, totalMinutes)}`}
              />
              {plan.stops.length === 0 ? (
                <p className="px-4 py-10 text-center text-[13px] text-[var(--text-muted)]">
                  Ninguna tienda cabe en la jornada configurada. Amplía las horas disponibles.
                </p>
              ) : (
                <ol className="divide-y divide-[var(--border)]">
                  {plan.stops.map((stop) => (
                    <li key={stop.store.id} className="flex gap-3 px-4 py-3">
                      <div className="flex w-11 shrink-0 flex-col items-center gap-1">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--brand)] text-[12px] font-bold text-white">
                          {stop.sequence}
                        </span>
                        <span className="text-[10.5px] font-medium tabular text-[var(--text-secondary)]">
                          {clockAt(START_HOUR, stop.arrivalMinute)}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <Link href={`/tiendas/${stop.store.id}`} className="text-[13.5px] font-medium hover:text-[var(--brand)] hover:underline">
                              {stop.store.name}
                            </Link>
                            <p className="mt-0.5 truncate text-[12px] text-[var(--text-muted)]">
                              {stop.store.companyName} · {stop.store.zone} · {STORE_FORMATS.label(stop.store.format)}
                            </p>
                          </div>
                          <ScoreBadge score={stop.store.score} />
                        </div>
                        <ul className="mt-1.5 flex flex-wrap gap-1.5">
                          {stop.store.reasons.slice(0, 4).map((r) => (
                            <li key={r.label} className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
                              {r.label} <span className="tabular opacity-70">+{r.points}</span>
                            </li>
                          ))}
                        </ul>
                        <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                          {stop.travelMinutes} min de traslado · {stop.store.avgVisitMinutes} min en tienda · salida{" "}
                          {clockAt(START_HOUR, stop.departureMinute)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader title="Mapa de la jornada" subtitle={`${selected.name}${selected.zone ? ` · zona ${selected.zone}` : ""}`} />
                <div className="p-3">
                  <RouteMap
                    origin={origin}
                    stops={plan.stops.map((s) => ({
                      id: s.store.id,
                      name: s.store.name,
                      company: s.store.companyName,
                      lat: s.store.lat,
                      lng: s.store.lng,
                      score: s.store.score,
                      sequence: s.sequence,
                      arrival: clockAt(START_HOUR, s.arrivalMinute),
                    }))}
                    skipped={scored
                      .filter((s) => !inRoute.has(s.id))
                      .map((s) => ({ id: s.id, name: s.name, company: s.companyName, lat: s.lat, lng: s.lng, score: s.score }))}
                  />
                </div>
              </Card>

              <Card>
                <CardHeader title="Cómo se calcula la prioridad" subtitle="Pesos sobre 100 puntos" />
                <ul className="flex flex-col gap-2.5 px-4 py-3.5">
                  {[
                    { label: "Frecuencia comprometida vencida", w: WEIGHTS.frequency },
                    { label: "Peso en facturación (últimos 90 días)", w: WEIGHTS.value },
                    { label: "Novedades abiertas ponderadas por severidad", w: WEIGHTS.incidents },
                    { label: "SKU en quiebre en la última medición", w: WEIGHTS.outOfStock },
                    { label: "Producto próximo a vencer en góndola", w: WEIGHTS.expiry },
                  ].map((row) => (
                    <li key={row.label}>
                      <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                        <span className="text-[var(--text-secondary)]">{row.label}</span>
                        <span className="shrink-0 font-semibold tabular">{row.w}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                        <div className="h-full rounded-full bg-[var(--seq-400)]" style={{ width: `${row.w}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>

          <Card>
            <CardHeader
              title="Todas las tiendas candidatas"
              subtitle="Ordenadas por prioridad. Las que no entran hoy quedan arriba en la siguiente jornada."
            />
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Prioridad</th>
                    <th>Tienda</th>
                    <th>Cliente</th>
                    <th>Zona</th>
                    <th>Última visita</th>
                    <th className="num">Objetivo</th>
                    <th className="num">Novedades</th>
                    <th className="num">Quiebres</th>
                    <th>En ruta</th>
                  </tr>
                </thead>
                <tbody>
                  {scored.map((s) => (
                    <tr key={s.id}>
                      <td><ScoreBadge score={s.score} showLabel={false} /></td>
                      <td>
                        <Link href={`/tiendas/${s.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                          {s.name}
                        </Link>
                        <span className={`badge badge-${TIERS.get(s.tier).tone} ml-1.5`}>{s.tier}</span>
                      </td>
                      <td className="text-[var(--text-secondary)]">{s.companyName}</td>
                      <td className="text-[var(--text-secondary)]">{s.zone}</td>
                      <td className={s.overdueDays > 0 ? "font-medium text-[var(--critical)]" : "text-[var(--text-secondary)]"}>
                        {s.daysSinceVisit == null ? "Nunca" : relativeDays(s.daysSinceVisit)}
                      </td>
                      <td className="num text-[var(--text-secondary)]">cada {s.targetIntervalDays} d</td>
                      <td className="num">{s.openIncidents.length || "—"}</td>
                      <td className="num">{s.outOfStockSkus || "—"}</td>
                      <td>
                        {inRoute.has(s.id) ? (
                          <span className="badge badge-success">Sí</span>
                        ) : (
                          <span className="badge badge-neutral">No</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
