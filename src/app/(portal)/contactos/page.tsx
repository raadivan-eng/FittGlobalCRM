import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { fmtDate, fmtNumber, initials } from "@/lib/format";
import { anyOf, flatten, many, one, pageCount, pagination, type SearchParams } from "@/lib/params";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { Filters } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import { IconContacts, IconMail, IconPhone } from "@/components/icons";

export const metadata = { title: "Contactos" };
export const dynamic = "force-dynamic";

export default async function ContactosPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection("contactos");
  const sp = await searchParams;
  const q = one(sp.q);
  const companyIds = many(sp.cliente);
  const scope = one(sp.ambito); // CORPORATIVO | TIENDA
  const { page, pageSize, skip, take } = pagination(sp.page, 25);

  const where = {
    ...(q
      ? { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }, { email: { contains: q } }, { position: { contains: q } }] }
      : {}),
    ...(companyIds.length ? { companyId: anyOf(companyIds) } : {}),
    ...(scope === "CORPORATIVO" ? { stores: { none: {} } } : scope === "TIENDA" ? { stores: { some: {} } } : {}),
  };

  const [contacts, total, companies] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: [{ isPrimary: "desc" }, { lastName: "asc" }],
      skip,
      take,
      include: { company: { select: { id: true, name: true, tier: true } }, stores: { include: { store: { select: { id: true, name: true } } } } },
    }),
    prisma.contact.count({ where }),
    prisma.company.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title="Contactos"
        subtitle="Las personas detrás de cada cliente. Un contacto pertenece a un solo cliente y puede atender varias de sus tiendas; sin tiendas es corporativo."
        actions={<span className="badge badge-neutral">{fmtNumber(total)} contactos</span>}
      />

      <Filters
        fields={[
          { type: "search", name: "q", placeholder: "Nombre, cargo o correo…" },
          { type: "select", name: "cliente", label: "Todos los clientes", options: companies.map((c) => ({ value: c.id, label: c.name })), width: "w-56", multi: true },
          {
            type: "select",
            name: "ambito",
            label: "Ámbito",
            options: [
              { value: "CORPORATIVO", label: "Corporativo" },
              { value: "TIENDA", label: "En punto de venta" },
            ],
          },
        ]}
      />

      <Card>
        {contacts.length === 0 ? (
          <EmptyState icon={<IconContacts size={26} />} title="Sin contactos" description="Prueba con otros filtros de búsqueda." />
        ) : (
          <>
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Contacto</th>
                    <th>Cargo</th>
                    <th>Cliente</th>
                    <th>Tiendas</th>
                    <th>Datos</th>
                    <th>Último contacto</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <span className="flex items-center gap-2.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface-3)] text-[11px] font-semibold text-[var(--text-secondary)]">
                            {initials(`${c.firstName} ${c.lastName}`)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {c.firstName} {c.lastName}
                            </span>
                            <span className="flex gap-1">
                              {c.isPrimary && <span className="badge badge-info">Principal</span>}
                              {c.isDecisionMaker && <span className="badge badge-purple">Decide</span>}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="text-[var(--text-secondary)]">{c.position}</td>
                      <td>
                        <Link href={`/clientes/${c.company.id}`} className="hover:text-[var(--brand)] hover:underline">
                          {c.company.name}
                        </Link>
                      </td>
                      <td className="text-[var(--text-secondary)]">
                        {c.stores.length ? (
                          c.stores.map((sc, i) => (
                            <span key={sc.storeId}>
                              {i > 0 && ", "}
                              <Link href={`/tiendas/${sc.store.id}`} className="hover:text-[var(--brand)] hover:underline">
                                {sc.store.name}
                              </Link>
                            </span>
                          ))
                        ) : (
                          <span className="badge badge-neutral">Corporativo</span>
                        )}
                      </td>
                      <td>
                        <span className="flex flex-col gap-0.5 text-[11.5px] text-[var(--text-secondary)]">
                          {c.phone && <span className="inline-flex items-center gap-1"><IconPhone size={11} /> {c.phone}</span>}
                          {c.email && <span className="inline-flex items-center gap-1"><IconMail size={11} /> {c.email}</span>}
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-[var(--text-secondary)]">{fmtDate(c.lastContactAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageCount={pageCount(total, pageSize)} total={total} params={flatten(sp)} basePath="/contactos" />
          </>
        )}
      </Card>
    </>
  );
}
