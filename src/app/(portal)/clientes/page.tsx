import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { NOT_VOID, startOfMonth } from "@/lib/analytics";
import { CHANNELS, COMPANY_TYPES, TIERS } from "@/lib/enums";
import { fmtCompact, fmtNumber } from "@/lib/format";
import { anyOf, flatten, many, one, pageCount, pagination, type SearchParams } from "@/lib/params";
import { Card, EmptyState, EnumBadge, PageHeader } from "@/components/ui";
import { Filters } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import { IconClients } from "@/components/icons";
import { ClassificationGuide } from "./classification-guide";

export const metadata = { title: "Clientes" };
export const dynamic = "force-dynamic";

export default async function ClientesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection("clientes");
  const sp = await searchParams;
  const q = one(sp.q);
  const tiers = many(sp.tier);
  const channels = many(sp.canal);
  const types = many(sp.tipo);
  const { page, pageSize, skip, take } = pagination(sp.page, 20);

  const where = {
    active: true,
    ...(q ? { OR: [{ name: { contains: q } }, { code: { contains: q } }, { city: { contains: q } }] } : {}),
    ...(tiers.length ? { tier: anyOf(tiers) } : {}),
    ...(channels.length ? { channel: anyOf(channels) } : {}),
    ...(types.length ? { type: anyOf(types) } : {}),
  };

  const since = startOfMonth(-11);
  const [companies, total] = await Promise.all([
    prisma.company.findMany({
      where,
      orderBy: { name: "asc" },
      skip,
      take,
      include: {
        owner: { select: { name: true } },
        _count: { select: { stores: true, contacts: true } },
      },
    }),
    prisma.company.count({ where }),
  ]);

  const ids = companies.map((c) => c.id);
  const [billing, pending] = await Promise.all([
    prisma.invoice.groupBy({
      by: ["companyId"],
      where: { companyId: { in: ids }, issueDate: { gte: since }, status: NOT_VOID },
      _sum: { net: true },
    }),
    prisma.invoice.findMany({
      where: { companyId: { in: ids }, status: { in: ["EMITIDA", "PARCIAL", "VENCIDA"] } },
      select: { companyId: true, total: true, paidAmount: true },
    }),
  ]);

  const billed = new Map(billing.map((b) => [b.companyId, b._sum.net ?? 0]));
  const owed = new Map<string, number>();
  for (const i of pending) owed.set(i.companyId, (owed.get(i.companyId) ?? 0) + (i.total - i.paidAmount));

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle="Empresas y cadenas que compran al por mayor. Cada una agrupa sus puntos de venta y sus contactos."
        actions={<span className="badge badge-neutral">{fmtNumber(total)} activos</span>}
      />

      <ClassificationGuide />

      <Filters
        fields={[
          { type: "search", name: "q", placeholder: "Buscar por nombre, código o ciudad…" },
          { type: "select", name: "tier", label: "Clasificación ABC", options: TIERS.options.map((o) => ({ value: o.value, label: o.label })), multi: true },
          { type: "select", name: "canal", label: "Canal", options: CHANNELS.options.map((o) => ({ value: o.value, label: o.label })), multi: true },
          { type: "select", name: "tipo", label: "Tipo", options: COMPANY_TYPES.options.map((o) => ({ value: o.value, label: o.label })), multi: true },
        ]}
      />

      <Card>
        {companies.length === 0 ? (
          <EmptyState icon={<IconClients size={26} />} title="Sin resultados" description="Ajusta los filtros para ver otros clientes." />
        ) : (
          <>
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Tipo</th>
                    <th>Canal</th>
                    <th>ABC</th>
                    <th className="num">Tiendas</th>
                    <th className="num">Contactos</th>
                    <th className="num">Facturación 12 m</th>
                    <th className="num">Por cobrar</th>
                    <th>Responsable</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/clientes/${c.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                          {c.name}
                        </Link>
                        <p className="text-[11.5px] text-[var(--text-muted)]">
                          {c.code} · {c.city ?? "—"} · {c.paymentTermDays} días
                        </p>
                      </td>
                      <td title={COMPANY_TYPES.get(c.type).hint}><EnumBadge option={COMPANY_TYPES.get(c.type)} /></td>
                      <td className="text-[var(--text-secondary)]" title={CHANNELS.get(c.channel).hint}>{CHANNELS.label(c.channel)}</td>
                      <td><EnumBadge option={TIERS.get(c.tier)} /></td>
                      <td className="num">{c._count.stores}</td>
                      <td className="num">{c._count.contacts}</td>
                      <td className="num font-semibold">{fmtCompact(billed.get(c.id) ?? 0)}</td>
                      <td className="num">
                        {(owed.get(c.id) ?? 0) > 0 ? (
                          <span className="text-[var(--critical)]">{fmtCompact(owed.get(c.id) ?? 0)}</span>
                        ) : (
                          <span className="text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                      <td className="text-[var(--text-secondary)]">{c.owner?.name ?? "Sin asignar"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageCount={pageCount(total, pageSize)} total={total} params={flatten(sp)} basePath="/clientes" />
          </>
        )}
      </Card>
    </>
  );
}
