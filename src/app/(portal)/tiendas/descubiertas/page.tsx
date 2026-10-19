import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { CANDIDATE_STATUS } from "@/lib/enums";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { flatten, one, pageCount, pagination, type SearchParams } from "@/lib/params";
import { crearTiendaDescubierta, descartarTiendaDescubierta, vincularTiendaDescubierta } from "@/lib/actions-locator";
import { Card, CardHeader, EmptyState, EnumBadge, PageHeader, StatTile } from "@/components/ui";
import { Filters } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import { IconCheck, IconPlus, IconSearch, IconStore, IconX } from "@/components/icons";
import { LocatorRunner } from "./locator-runner";

export const metadata = { title: "Tiendas descubiertas" };
export const dynamic = "force-dynamic";

export default async function TiendasDescubiertasPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(["ADMIN", "SUPERVISOR"]);
  const sp = await searchParams;
  const raw = one(sp.estado);
  const estado = raw === "TODAS" || CANDIDATE_STATUS.values.includes(raw as never) ? raw : "NUEVA";
  const companyId = one(sp.cliente);
  const q = one(sp.q);
  const { page, pageSize, skip, take } = pagination(sp.page, 25);

  const where = {
    ...(estado !== "TODAS" ? { status: estado } : {}),
    ...(companyId ? { companyId } : {}),
    ...(q ? { OR: [{ name: { contains: q } }, { address: { contains: q } }, { city: { contains: q } }] } : {}),
  };

  const [counts, connection, candidates, total, companies, coverage, lastRun, warnings] = await Promise.all([
    prisma.storeCandidate.groupBy({ by: ["status"], _count: true }),
    prisma.apiConnection.findUnique({ where: { provider: "MAPS" }, select: { secretCipher: true } }),
    prisma.storeCandidate.findMany({
      where,
      orderBy: [{ foundAt: "desc" }, { name: "asc" }],
      skip,
      take,
      include: {
        company: { select: { name: true } },
        suggestedStore: { select: { id: true, code: true, name: true, address: true } },
        store: { select: { id: true, name: true } },
        reviewedBy: { select: { name: true } },
      },
    }),
    prisma.storeCandidate.count({ where }),
    prisma.company.findMany({ where: { finds: { some: {} } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.locatorSearch.groupBy({ by: ["companyId"], _count: true, _max: { lastRunAt: true } }),
    prisma.locatorSearch.findFirst({ where: { lastRunAt: { not: null } }, orderBy: { lastRunAt: "desc" }, select: { lastRunAt: true } }),
    prisma.locatorSearch.findMany({
      where: { lastError: { not: null } },
      select: { id: true, query: true, lastError: true, lastRunAt: true },
      orderBy: { query: "asc" },
      take: 10,
    }),
  ]);

  // Para vincular a mano: tiendas de la misma cadena sin lugar de Google. El maestro a veces trae la ciudad
  // equivocada, así que se ofrecen todas las de la cadena, primero las de la misma ciudad.
  const open = candidates.filter((c) => c.status === "NUEVA");
  const linkable = open.length
    ? await prisma.store.findMany({
        where: { companyId: { in: [...new Set(open.map((c) => c.companyId))] }, placeId: null },
        select: { id: true, code: true, name: true, city: true, companyId: true },
        orderBy: [{ city: "asc" }, { name: "asc" }],
      })
    : [];
  const linkOptions = (c: { companyId: string; city: string; suggestedStoreId: string | null }) => {
    const mine = linkable.filter((s) => s.companyId === c.companyId && s.id !== c.suggestedStoreId);
    return [...mine.filter((s) => s.city === c.city), ...mine.filter((s) => s.city !== c.city)];
  };

  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const searches = coverage.reduce((acc, c) => acc + c._count, 0);
  // Antes de la primera corrida no hay búsquedas creadas: se estiman con las ciudades de las cadenas.
  const estimated = searches || (await prisma.store.groupBy({ by: ["companyId", "city"], where: { company: { type: "CADENA" } } })).length;

  return (
    <>
      <PageHeader
        title="Tiendas descubiertas"
        subtitle="Puntos de venta de tus cadenas que aparecen en Google Maps y no están en el maestro. Revísalos: crea la tienda, dila por buena como una que ya tienes o descártala."
        breadcrumb={[{ label: "Tiendas", href: "/tiendas" }, { label: "Descubiertas" }]}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Por revisar" value={fmtNumber(count("NUEVA"))} hint="Encontradas y sin decidir" icon={<IconSearch size={15} />} href="/tiendas/descubiertas" />
        <StatTile label="Creadas" value={fmtNumber(count("CREADA"))} hint="Dadas de alta desde Maps" href="/tiendas/descubiertas?estado=CREADA" />
        <StatTile label="Vinculadas" value={fmtNumber(count("VINCULADA"))} hint="Ya estaban en el maestro" href="/tiendas/descubiertas?estado=VINCULADA" />
        <StatTile label="Descartadas" value={fmtNumber(count("DESCARTADA"))} hint="No vuelven a avisarse" href="/tiendas/descubiertas?estado=DESCARTADA" />
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Localizador"
          subtitle={
            <>
              Busca cada cadena en cada ciudad donde ya tiene tiendas. Corre solo cada mañana y repasa cada ciudad una vez por semana
              {lastRun?.lastRunAt ? <> · última búsqueda {fmtDateTime(lastRun.lastRunAt)}</> : <> · todavía no ha corrido.</>}
            </>
          }
        />
        <LocatorRunner searches={estimated} configured={!!connection?.secretCipher} />
        {warnings.length > 0 && (
          <div className="border-t border-[var(--border)] px-4 py-3 text-[12px] text-[var(--text-secondary)]">
            <p className="mb-1 font-semibold">Búsquedas con observaciones</p>
            <ul className="flex flex-col gap-0.5">
              {warnings.map((w) => (
                <li key={w.id}>
                  {w.query}: <span className="text-[var(--text-muted)]">{w.lastError}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <div className="mt-5">
        <Filters
          fields={[
            { type: "search", name: "q", placeholder: "Nombre, dirección o ciudad…" },
            {
              type: "select",
              name: "estado",
              label: "Estado",
              options: [...CANDIDATE_STATUS.options.map((o) => ({ value: o.value, label: o.label })), { value: "TODAS", label: "Todas" }],
            },
            { type: "select", name: "cliente", label: "Cliente", options: companies.map((c) => ({ value: c.id, label: c.name })), width: "w-52" },
          ]}
        />
      </div>

      <Card>
        <CardHeader
          title={`${estado === "TODAS" ? "Todas" : CANDIDATE_STATUS.label(estado)} · ${fmtNumber(total)}`}
          subtitle="Abre el lugar en Google Maps para confirmar. Si Google lo asocia a una tienda tuya, aparece en «Se parece a»."
        />
        {candidates.length === 0 ? (
          <EmptyState
            icon={<IconCheck size={26} />}
            title={estado === "NUEVA" ? "Nada por revisar" : "Sin resultados"}
            description={estado === "NUEVA" ? "Cuando el localizador encuentre una tienda nueva aparecerá aquí y te llegará un aviso." : "No hay tiendas en este estado con los filtros actuales."}
          />
        ) : (
          <>
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>En Google Maps</th>
                    <th>Cliente</th>
                    <th>Se parece a</th>
                    <th>Encontrada</th>
                    <th className="min-w-56">Decisión</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <p className="font-medium">{c.name}</p>
                        <p className="text-[11.5px] text-[var(--text-muted)]">{c.address}</p>
                        {c.mapsUrl && (
                          <a href={c.mapsUrl} target="_blank" rel="noreferrer" className="text-[12px] font-medium text-[var(--brand)] hover:underline">
                            Abrir en Maps ↗
                          </a>
                        )}
                      </td>
                      <td className="text-[var(--text-secondary)]">
                        {c.company.name}
                        <p className="text-[11.5px] text-[var(--text-muted)]">{c.city}</p>
                      </td>
                      <td className="text-[var(--text-secondary)]">
                        {c.suggestedStore ? (
                          <>
                            <Link href={`/tiendas/${c.suggestedStore.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                              {c.suggestedStore.name}
                            </Link>
                            <p className="text-[11.5px] text-[var(--text-muted)]">
                              {c.suggestedStore.code}
                              {c.suggestedStore.address ? ` · ${c.suggestedStore.address}` : ""}
                            </p>
                          </>
                        ) : (
                          <span className="text-[var(--text-muted)]">Ninguna parecida</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-[var(--text-secondary)]">{fmtDate(c.foundAt)}</td>
                      <td>
                        {c.status === "NUEVA" ? (
                          <div className="flex flex-col items-start gap-1">
                            <form action={crearTiendaDescubierta}>
                              <input type="hidden" name="id" value={c.id} />
                              <button type="submit" className="btn btn-secondary h-7 text-[12.5px]">
                                <IconPlus size={13} /> Crear tienda
                              </button>
                            </form>
                            {c.suggestedStore && (
                              <form action={vincularTiendaDescubierta}>
                                <input type="hidden" name="id" value={c.id} />
                                <input type="hidden" name="storeId" value={c.suggestedStore.id} />
                                <button type="submit" className="btn btn-ghost px-0 text-[12.5px]">
                                  <IconStore size={13} /> Sí, es esa
                                </button>
                              </form>
                            )}
                            {linkOptions(c).length > 0 && (
                              <form action={vincularTiendaDescubierta} className="flex items-center gap-1">
                                <input type="hidden" name="id" value={c.id} />
                                <select name="storeId" required defaultValue="" className="field h-8 w-44 !py-0 text-[12px]" aria-label="Vincular a otra tienda del maestro">
                                  <option value="" disabled>Es otra tienda…</option>
                                  {linkOptions(c).map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name}{s.city !== c.city ? ` (${s.city})` : ""}
                                    </option>
                                  ))}
                                </select>
                                <button type="submit" className="btn btn-ghost h-7 px-1.5 text-[12px]">Vincular</button>
                              </form>
                            )}
                            <form action={descartarTiendaDescubierta}>
                              <input type="hidden" name="id" value={c.id} />
                              <button type="submit" className="btn btn-ghost px-0 text-[12.5px] text-[var(--text-muted)]">
                                <IconX size={13} /> Descartar
                              </button>
                            </form>
                          </div>
                        ) : (
                          <div className="flex flex-col items-start gap-1">
                            <EnumBadge option={CANDIDATE_STATUS.get(c.status)} />
                            {c.store && (
                              <Link href={`/tiendas/${c.store.id}`} className="text-[12px] font-medium text-[var(--brand)] hover:underline">
                                {c.store.name}
                              </Link>
                            )}
                            {c.reviewedBy && <p className="text-[11px] text-[var(--text-muted)]">{c.reviewedBy.name} · {fmtDate(c.reviewedAt)}</p>}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageCount={pageCount(total, pageSize)} total={total} params={flatten(sp)} basePath="/tiendas/descubiertas" />
          </>
        )}
      </Card>
    </>
  );
}
