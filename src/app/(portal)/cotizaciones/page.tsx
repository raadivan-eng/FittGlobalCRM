import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection, SUPPLIER_ROLES } from "@/lib/auth";
import { QUOTE_OPEN, QUOTE_STATUS } from "@/lib/enums";
import { lineComplete, totalLeadDays } from "@/lib/suppliers";
import { daysBetween, fmtNumber, relativeDays } from "@/lib/format";
import { anyOf, flatten, many, one, pageCount, pagination, type SearchParams } from "@/lib/params";
import { Card, EmptyState, EnumBadge, PageHeader, StatTile } from "@/components/ui";
import { Filters } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import { IconCheck, IconClock, IconFactory, IconPlus, IconQuote } from "@/components/icons";

export const metadata = { title: "Cotizaciones" };
export const dynamic = "force-dynamic";

/** Lapso con que se mide cuántas cotizaciones terminan en proveedor. */
const DIAS_APROBACION = 90;

export default async function CotizacionesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection("proveedores");
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const status = one(sp.estado);
  // «Sin asignar» se puede combinar con responsables concretos: va como OR con `ownerId: null`.
  const ownerParams = many(sp.responsable);
  const unassigned = ownerParams.includes("SIN_ASIGNAR");
  const ownerIds = ownerParams.filter((o) => o !== "SIN_ASIGNAR");
  const { page, pageSize, skip, take } = pagination(sp.page, 25);

  const now = new Date();
  const since = new Date(now.getTime() - DIAS_APROBACION * 86_400_000);

  const where = {
    ...(status === "ABIERTAS" ? { status: { in: [...QUOTE_OPEN] } } : status ? { status } : {}),
    // Va en AND para no chocar con el OR de la búsqueda.
    ...(unassigned && ownerIds.length
      ? { AND: [{ OR: [{ ownerId: null }, { ownerId: { in: ownerIds } }] }] }
      : unassigned
        ? { ownerId: null }
        : ownerIds.length
          ? { ownerId: anyOf(ownerIds) }
          : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { code: { contains: q } },
            { contactName: { contains: q } },
            { city: { contains: q } },
            { lines: { some: { OR: [{ sku: { contains: q } }, { description: { contains: q } }] } } },
          ],
        }
      : {}),
  };

  const [quotes, total, open, approved, discarded, waiting, owners] = await Promise.all([
    prisma.supplierQuote.findMany({
      where,
      orderBy: [{ lastActivityAt: "desc" }],
      skip,
      take,
      include: {
        owner: { select: { name: true } },
        supplier: { select: { id: true, code: true } },
        lines: { select: { minOrderQty: true, unitCost: true, productionLeadDays: true, transitDays: true } },
      },
    }),
    prisma.supplierQuote.count({ where }),
    prisma.supplierQuote.groupBy({ by: ["status"], where: { status: { in: [...QUOTE_OPEN] } }, _count: true }),
    prisma.supplierQuote.count({ where: { status: "APROBADA", convertedAt: { gte: since } } }),
    prisma.supplierQuote.count({ where: { status: "DESCARTADA", updatedAt: { gte: since } } }),
    // SKU de cotizaciones abiertas a los que el proveedor todavía no responde.
    prisma.supplierQuoteLine.count({
      where: {
        quote: { status: { in: [...QUOTE_OPEN] } },
        OR: [{ minOrderQty: null }, { unitCost: null }, { productionLeadDays: null }, { transitDays: null }],
      },
    }),
    prisma.user.findMany({ where: { active: true, role: { in: SUPPLIER_ROLES } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const openTotal = open.reduce((s, r) => s + r._count, 0);
  const negotiating = open.find((r) => r.status === "NEGOCIACION")?._count ?? 0;
  const closed = approved + discarded;
  const filtered = Boolean(q || status || ownerParams.length);

  return (
    <>
      <PageHeader
        title="Cotizaciones"
        subtitle="Proveedores nuevos en evaluación. Por cada SKU se pregunta cantidad mínima, costo, production lead time y transit time; con las condiciones de compra confirmadas, la cotización se aprueba y se vuelve proveedor con su RUT y su Cámara de Comercio."
        actions={
          <Link href="/cotizaciones/nueva" className="btn btn-primary">
            <IconPlus size={14} /> Nueva cotización
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Abiertas" value={fmtNumber(openTotal)} hint={`${fmtNumber(negotiating)} en negociación`} icon={<IconQuote size={15} />} href="/cotizaciones?estado=ABIERTAS" />
        <StatTile label="SKU sin respuesta" value={fmtNumber(waiting)} hint="El proveedor aún no contesta todo" icon={<IconClock size={15} />} href="/cotizaciones?estado=SOLICITADA" />
        <StatTile label={`Aprobadas · ${DIAS_APROBACION} días`} value={fmtNumber(approved)} hint="Ya son proveedores" icon={<IconFactory size={15} />} href="/cotizaciones?estado=APROBADA" />
        <StatTile
          label={`Aprobación · ${DIAS_APROBACION} días`}
          value={closed ? `${Math.round((approved / closed) * 100)}%` : "—"}
          hint={`${fmtNumber(approved)} aprobadas · ${fmtNumber(discarded)} descartadas`}
          icon={<IconCheck size={15} />}
        />
      </div>

      <div className="mt-5">
        <Filters
          fields={[
            { type: "search", name: "q", placeholder: "Proveedor, SKU, contacto, ciudad o código…", width: "w-full sm:w-80" },
            {
              type: "select", name: "estado", label: "Estado",
              options: [{ value: "ABIERTAS", label: "Abiertas (todas)" }, ...QUOTE_STATUS.options.map((o) => ({ value: o.value, label: o.label }))],
              width: "w-48",
            },
            {
              type: "select", name: "responsable", label: "Responsable",
              options: [{ value: "SIN_ASIGNAR", label: "Sin asignar" }, ...owners.map((u) => ({ value: u.id, label: u.name }))],
              width: "w-48",
              multi: true,
            },
          ]}
        />

        <Card>
          {quotes.length === 0 ? (
            <EmptyState
              icon={<IconQuote size={26} />}
              title={filtered ? "Ninguna cotización coincide" : "Todavía no hay cotizaciones"}
              description={filtered ? "Prueba con otro estado o responsable." : "Registra los SKU que le pides a un proveedor nuevo y lo que responda por cada uno."}
              action={
                <Link href="/cotizaciones/nueva" className="btn btn-primary">
                  <IconPlus size={14} /> Nueva cotización
                </Link>
              }
            />
          ) : (
            <>
              <div className="scroll-x">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Cotización</th>
                      <th>Estado</th>
                      <th className="num">SKU</th>
                      <th>Condiciones de compra</th>
                      <th className="num">Lead time</th>
                      <th>Responsable</th>
                      <th>Última actividad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quotes.map((c) => {
                      const answered = c.lines.filter(lineComplete).length;
                      const leads = c.lines.map(totalLeadDays).filter((d): d is number => d != null);
                      return (
                        <tr key={c.id}>
                          <td className="min-w-[200px]">
                            <Link href={`/cotizaciones/${c.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                              {c.name}
                            </Link>
                            <span className="block text-[11.5px] text-[var(--text-muted)]">
                              <span className="font-mono">{c.code}</span>
                              {c.contactName ? ` · ${c.contactName}` : ""}
                              {c.city ? ` · ${c.city}` : ""}
                            </span>
                          </td>
                          <td>
                            <EnumBadge option={QUOTE_STATUS.get(c.status)} dot />
                            {c.supplier && (
                              <Link href={`/proveedores/${c.supplier.id}`} className="mt-0.5 block text-[11.5px] text-[var(--brand)] hover:underline">
                                Proveedor {c.supplier.code}
                              </Link>
                            )}
                          </td>
                          <td className="num whitespace-nowrap">
                            {fmtNumber(c.lines.length)}
                            {answered < c.lines.length && (
                              <span className="block text-[11px] text-[var(--tone-warning-fg)]">{c.lines.length - answered} sin respuesta</span>
                            )}
                          </td>
                          <td className="text-[var(--text-secondary)]">{c.paymentTerms ?? <span className="text-[var(--text-muted)]">Sin definir</span>}</td>
                          <td className="num whitespace-nowrap">
                            {leads.length ? (
                              Math.min(...leads) === Math.max(...leads) ? `${leads[0]} días` : `${Math.min(...leads)}–${Math.max(...leads)} días`
                            ) : (
                              <span className="text-[var(--text-muted)]">—</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap text-[var(--text-secondary)]">{c.owner?.name ?? <span className="text-[var(--text-muted)]">Sin asignar</span>}</td>
                          <td className="whitespace-nowrap text-[var(--text-secondary)]">{relativeDays(daysBetween(c.lastActivityAt, now))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageCount={pageCount(total, pageSize)} total={total} params={flatten(sp)} basePath="/cotizaciones" />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
