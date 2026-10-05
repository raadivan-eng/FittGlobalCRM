import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { GEO_STATUS } from "@/lib/enums";
import { fmtNumber } from "@/lib/format";
import { flatten, one, pageCount, pagination, type SearchParams } from "@/lib/params";
import { confirmarUbicacion } from "@/lib/actions-stores";
import { Card, CardHeader, EmptyState, EnumBadge, PageHeader, StatTile } from "@/components/ui";
import { Filters } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import { IconCheck, IconPin } from "@/components/icons";
import { GeocodeRunner } from "./geocode-runner";
import { ManualLocation } from "./manual-location";

export const metadata = { title: "Ubicar tiendas" };
export const dynamic = "force-dynamic";

const REVIEWABLE = ["POR_REVISAR", "NO_ENCONTRADA"];

const mapsUrl = (s: { lat: number | null; lng: number | null; name: string; address: string | null; city: string }) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    s.lat != null && s.lng != null ? `${s.lat},${s.lng}` : [s.name, s.address, s.city].filter(Boolean).join(", "),
  )}`;

export default async function UbicarTiendasPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(["ADMIN", "SUPERVISOR"]);
  const sp = await searchParams;
  const estado = REVIEWABLE.includes(one(sp.estado)) ? one(sp.estado) : "POR_REVISAR";
  const companyId = one(sp.cliente);
  const q = one(sp.q);
  const { page, pageSize, skip, take } = pagination(sp.page, 25);

  const where = {
    active: true,
    geoStatus: estado,
    ...(companyId ? { companyId } : {}),
    ...(q ? { OR: [{ name: { contains: q } }, { code: { contains: q } }, { city: { contains: q } }] } : {}),
  };

  const [counts, connection, stores, total, companies] = await Promise.all([
    prisma.store.groupBy({ by: ["geoStatus"], where: { active: true }, _count: true }),
    prisma.apiConnection.findUnique({ where: { provider: "MAPS" }, select: { secretCipher: true } }),
    prisma.store.findMany({
      where,
      orderBy: [{ city: "asc" }, { name: "asc" }],
      skip,
      take,
      select: {
        id: true, code: true, name: true, address: true, city: true, lat: true, lng: true,
        geoStatus: true, geoMatch: true, geoSource: true,
        company: { select: { name: true } },
      },
    }),
    prisma.store.count({ where }),
    prisma.company.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const count = (s: string) => counts.find((c) => c.geoStatus === s)?._count ?? 0;
  const all = counts.reduce((acc, c) => acc + c._count, 0);
  const routable = count("UBICADA") + count("MANUAL") + count("POR_REVISAR");

  return (
    <>
      <PageHeader
        title="Ubicar tiendas"
        subtitle="Convierte la dirección de cada punto de venta en coordenadas con Google Maps. Sin coordenadas la tienda no entra al planificador de rutas."
        breadcrumb={[{ label: "Tiendas", href: "/tiendas" }, { label: "Ubicar" }]}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Con coordenadas" value={fmtNumber(routable)} hint={`de ${fmtNumber(all)} tiendas visitables`} icon={<IconPin size={15} />} />
        <StatTile label="Por revisar" value={fmtNumber(count("POR_REVISAR"))} hint="Entran a rutas; conviene confirmarlas" href="/tiendas/ubicar?estado=POR_REVISAR" />
        <StatTile label="No encontradas" value={fmtNumber(count("NO_ENCONTRADA"))} hint="Fíjalas a mano o completa la dirección" href="/tiendas/ubicar?estado=NO_ENCONTRADA" />
        <StatTile label="Pendientes" value={fmtNumber(count("PENDIENTE"))} hint="Aún sin geocodificar" />
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Geocodificación"
          subtitle="Primero por dirección (Geocoding API); si no hay dirección o el resultado es impreciso, por el nombre de la tienda (Places API)."
        />
        <GeocodeRunner pending={count("PENDIENTE")} notFound={count("NO_ENCONTRADA")} configured={!!connection?.secretCipher} />
      </Card>

      <div className="mt-5">
        <Filters
          fields={[
            { type: "search", name: "q", placeholder: "Tienda, código o ciudad…" },
            {
              type: "select",
              name: "estado",
              label: "Estado",
              options: REVIEWABLE.map((v) => ({ value: v, label: GEO_STATUS.label(v) })),
            },
            { type: "select", name: "cliente", label: "Cliente", options: companies.map((c) => ({ value: c.id, label: c.name })), width: "w-52" },
          ]}
        />
      </div>

      <Card>
        <CardHeader
          title={`${GEO_STATUS.label(estado)} · ${fmtNumber(total)}`}
          subtitle="Abre el punto en Google Maps; si está bien, confírmalo. Si no, busca la tienda, copia el enlace o las coordenadas y fíjalas."
        />
        {stores.length === 0 ? (
          <EmptyState icon={<IconCheck size={26} />} title="Nada por revisar" description="No hay tiendas en este estado con los filtros actuales." />
        ) : (
          <>
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Punto de venta</th>
                    <th>Dirección en la hoja</th>
                    <th>Lo que encontró Google</th>
                    <th>Revisar</th>
                    <th className="min-w-72">Fijar a mano</th>
                  </tr>
                </thead>
                <tbody>
                  {stores.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link href={`/tiendas/${s.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                          {s.name}
                        </Link>
                        <p className="text-[11.5px] text-[var(--text-muted)]">{s.company.name} · {s.code}</p>
                      </td>
                      <td className="text-[var(--text-secondary)]">
                        {s.address ?? <span className="text-[var(--text-muted)]">Sin dirección</span>}
                        <p className="text-[11.5px] text-[var(--text-muted)]">{s.city}</p>
                      </td>
                      <td className="text-[var(--text-secondary)]">
                        <EnumBadge option={GEO_STATUS.get(s.geoStatus)} />
                        <p className="mt-1 text-[11.5px]">{s.geoMatch ?? "—"}</p>
                        {s.geoSource && <p className="text-[11px] text-[var(--text-muted)]">vía {s.geoSource === "PLACES" ? "búsqueda por nombre" : "dirección"}</p>}
                      </td>
                      <td>
                        <div className="flex flex-col items-start gap-1.5">
                          <a href={mapsUrl(s)} target="_blank" rel="noreferrer" className="text-[12.5px] font-medium text-[var(--brand)] hover:underline">
                            Abrir en Maps ↗
                          </a>
                          {s.geoStatus === "POR_REVISAR" && (
                            <form action={confirmarUbicacion}>
                              <input type="hidden" name="id" value={s.id} />
                              <button type="submit" className="btn btn-ghost px-0 text-[12.5px]">
                                <IconCheck size={13} /> Está bien
                              </button>
                            </form>
                          )}
                        </div>
                      </td>
                      <td>
                        <ManualLocation id={s.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageCount={pageCount(total, pageSize)} total={total} params={flatten(sp)} basePath="/tiendas/ubicar" />
          </>
        )}
      </Card>
    </>
  );
}
