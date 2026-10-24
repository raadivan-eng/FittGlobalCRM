import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { QUOTE_OPEN, SIIGO_CUSTOMER, SUPPLIER_ORIGIN } from "@/lib/enums";
import { siigoCustomersReady } from "@/lib/siigo-clientes";
import { fmtNumber } from "@/lib/format";
import { flatten, one, pageCount, pagination, type SearchParams } from "@/lib/params";
import { Card, EmptyState, EnumBadge, PageHeader, StatTile } from "@/components/ui";
import { Filters } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import { IconFactory, IconPlug, IconPlus, IconProduct, IconQuote } from "@/components/icons";
import { ImportSiigoButton } from "./supplier-controls";

export const metadata = { title: "Proveedores" };
export const dynamic = "force-dynamic";

/** Estado en Siigo derivado de la fila, igual que en la ficha. */
const siigoState = (s: { siigoId: string | null; siigoError: string | null }) => (s.siigoId ? "EN_SIIGO" : s.siigoError ? "RECHAZADO" : "SIN_ENVIAR");

export default async function ProveedoresPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection("proveedores");
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const origin = one(sp.origen);
  const siigo = one(sp.siigo);
  const estado = one(sp.estado) || "ACTIVOS";
  const { page, pageSize, skip, take } = pagination(sp.page, 25);

  const where = {
    ...(estado === "ACTIVOS" ? { active: true } : estado === "INACTIVOS" ? { active: false } : {}),
    ...(origin ? { origin } : {}),
    ...(siigo === "EN_SIIGO" ? { siigoId: { not: null } } : siigo === "RECHAZADO" ? { siigoId: null, siigoError: { not: null } } : siigo === "SIN_ENVIAR" ? { siigoId: null, siigoError: null } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { code: { contains: q } },
            { taxId: { contains: q } },
            { contactName: { contains: q } },
            { city: { contains: q } },
            { products: { some: { OR: [{ sku: { contains: q } }, { description: { contains: q } }] } } },
          ],
        }
      : {}),
  };

  const [suppliers, total, active, withTerms, notInSiigo, skus, openQuotes, siigoReady] = await Promise.all([
    prisma.supplier.findMany({
      where,
      orderBy: [{ name: "asc" }],
      skip,
      take,
      include: { owner: { select: { name: true } }, _count: { select: { products: true } } },
    }),
    prisma.supplier.count({ where }),
    prisma.supplier.count({ where: { active: true } }),
    prisma.supplier.count({ where: { active: true, products: { some: {} } } }),
    prisma.supplier.count({ where: { active: true, siigoId: null } }),
    prisma.supplierProduct.groupBy({ by: ["sku"], where: { supplier: { active: true } } }),
    prisma.supplierQuote.count({ where: { status: { in: [...QUOTE_OPEN] } } }),
    siigoCustomersReady(),
  ]);

  const filtered = Boolean(q || origin || siigo || estado !== "ACTIVOS");

  return (
    <>
      <PageHeader
        title="Proveedores"
        subtitle="A quién se le compra y en qué condiciones por SKU. Los que ya existen en Siigo se traen de allá; los nuevos nacen de una cotización aprobada, con su RUT y su Cámara de Comercio, y se crean también en Siigo."
        actions={
          <>
            {siigoReady && <ImportSiigoButton />}
            <Link href="/cotizaciones/nueva" className="btn btn-primary">
              <IconPlus size={14} /> Nueva cotización
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Proveedores activos" value={fmtNumber(active)} hint={`${fmtNumber(withTerms)} con condiciones por SKU`} icon={<IconFactory size={15} />} />
        <StatTile label="SKU con proveedor" value={fmtNumber(skus.length)} hint="Con mínimo, costo y lead time vigentes" icon={<IconProduct size={15} />} />
        <StatTile
          label="Sin tercero en Siigo"
          value={fmtNumber(notInSiigo)}
          hint={notInSiigo ? "Créalos desde su ficha" : "Todos están en Siigo"}
          icon={<IconPlug size={15} />}
          href="/proveedores?siigo=SIN_ENVIAR"
        />
        <StatTile label="Cotizaciones abiertas" value={fmtNumber(openQuotes)} hint="Proveedores nuevos en evaluación" icon={<IconQuote size={15} />} href="/cotizaciones?estado=ABIERTAS" />
      </div>

      {!siigoReady && (
        <p className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[12.5px] text-[var(--text-secondary)]">
          Para traer los proveedores que ya existen en Siigo, activa el módulo Clientes de Siigo en{" "}
          <Link href="/conexiones" className="text-[var(--brand)] hover:underline">Conexiones API</Link>.
        </p>
      )}

      <div className="mt-5">
        <Filters
          fields={[
            { type: "search", name: "q", placeholder: "Proveedor, NIT, SKU, contacto o ciudad…", width: "w-full sm:w-80" },
            {
              type: "select", name: "estado", label: "Activos",
              options: [{ value: "TODOS", label: "Todos" }, { value: "INACTIVOS", label: "Inactivos" }],
              width: "w-36",
            },
            { type: "select", name: "origen", label: "Origen", options: SUPPLIER_ORIGIN.options.map((o) => ({ value: o.value, label: o.label })), width: "w-36" },
            { type: "select", name: "siigo", label: "Siigo", options: SIIGO_CUSTOMER.options.map((o) => ({ value: o.value, label: o.label })), width: "w-44" },
          ]}
        />

        <Card>
          {suppliers.length === 0 ? (
            <EmptyState
              icon={<IconFactory size={26} />}
              title={filtered ? "Ningún proveedor coincide" : "Todavía no hay proveedores"}
              description={
                filtered
                  ? "Prueba con otro filtro."
                  : siigoReady
                    ? "Trae los que ya existen en Siigo, o cotiza uno nuevo y apruébalo."
                    : "Cotiza un proveedor nuevo y apruébalo, o conecta Siigo para traer los que ya existen."
              }
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
                      <th>Proveedor</th>
                      <th>NIT</th>
                      <th>Origen</th>
                      <th>Condiciones de compra</th>
                      <th className="num">SKU</th>
                      <th>Siigo</th>
                      <th>Responsable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.map((s) => (
                      <tr key={s.id}>
                        <td className="min-w-[200px]">
                          <Link href={`/proveedores/${s.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                            {s.name}
                          </Link>
                          <span className="block text-[11.5px] text-[var(--text-muted)]">
                            <span className="font-mono">{s.code}</span>
                            {s.city ? ` · ${s.city}` : ""}
                            {!s.active ? " · inactivo" : ""}
                          </span>
                        </td>
                        <td className="whitespace-nowrap tabular-nums">{s.taxId ?? <span className="text-[var(--text-muted)]">—</span>}</td>
                        <td><EnumBadge option={SUPPLIER_ORIGIN.get(s.origin)} /></td>
                        <td className="text-[var(--text-secondary)]">{s.paymentTerms ?? <span className="text-[var(--text-muted)]">Sin definir</span>}</td>
                        <td className="num">{s._count.products ? fmtNumber(s._count.products) : <span className="text-[var(--text-muted)]">—</span>}</td>
                        <td><EnumBadge option={SIIGO_CUSTOMER.get(siigoState(s))} /></td>
                        <td className="whitespace-nowrap text-[var(--text-secondary)]">{s.owner?.name ?? <span className="text-[var(--text-muted)]">Sin asignar</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageCount={pageCount(total, pageSize)} total={total} params={flatten(sp)} basePath="/proveedores" />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
