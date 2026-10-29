import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { NOT_VOID, startOfMonth } from "@/lib/analytics";
import { fmtCompact, fmtMoneyPrecise, fmtNumber, fmtPct } from "@/lib/format";
import { anyOf, flatten, many, one, pageCount, pagination, type SearchParams } from "@/lib/params";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { Filters } from "@/components/filters";
import { Pagination } from "@/components/pagination";
import { IconProduct } from "@/components/icons";

export const metadata = { title: "Productos" };
export const dynamic = "force-dynamic";

export default async function ProductosPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection("productos");
  const sp = await searchParams;
  const q = one(sp.q);
  const categoryFilter = many(sp.categoria);
  const brandFilter = many(sp.marca);
  const { page, pageSize, skip, take } = pagination(sp.page, 25);

  const where = {
    active: true,
    ...(q ? { OR: [{ name: { contains: q } }, { sku: { contains: q } }, { brand: { contains: q } }] } : {}),
    ...(categoryFilter.length ? { category: anyOf(categoryFilter) } : {}),
    ...(brandFilter.length ? { brand: anyOf(brandFilter) } : {}),
  };

  const [products, total, categories, brands] = await Promise.all([
    prisma.product.findMany({ where, orderBy: [{ category: "asc" }, { name: "asc" }], skip, take }),
    prisma.product.count({ where }),
    prisma.product.findMany({ where: { active: true }, select: { category: true }, distinct: ["category"], orderBy: { category: "asc" } }),
    prisma.product.findMany({ where: { active: true }, select: { brand: true }, distinct: ["brand"], orderBy: { brand: "asc" } }),
  ]);

  const ids = products.map((p) => p.id);
  const horizon = new Date(Date.now() + 60 * 86_400_000);
  const [sales, stock, nearExpiry] = await Promise.all([
    prisma.salesOrderLine.groupBy({
      by: ["productId"],
      where: { productId: { in: ids }, order: { date: { gte: startOfMonth(-2) }, status: NOT_VOID } },
      _sum: { total: true, quantity: true },
    }),
    prisma.inventoryLot.groupBy({ by: ["productId"], where: { productId: { in: ids }, quantity: { gt: 0 }, status: { not: "MERMA" } }, _sum: { quantity: true } }),
    prisma.inventoryLot.groupBy({
      by: ["productId"],
      where: { productId: { in: ids }, quantity: { gt: 0 }, status: { not: "MERMA" }, expiryDate: { lte: horizon } },
      _sum: { quantity: true },
    }),
  ]);

  const salesById = new Map(sales.map((s) => [s.productId, s]));
  const stockById = new Map(stock.map((s) => [s.productId, s._sum.quantity ?? 0]));
  const expiryById = new Map(nearExpiry.map((s) => [s.productId, s._sum.quantity ?? 0]));

  return (
    <>
      <PageHeader
        title="Productos"
        subtitle="Catálogo mayorista con precio de lista, margen, existencias y exposición a vencimiento."
        actions={<span className="badge badge-neutral">{fmtNumber(total)} SKU activos</span>}
      />

      <Filters
        fields={[
          { type: "search", name: "q", placeholder: "Nombre, SKU o marca…" },
          { type: "select", name: "categoria", label: "Categoría", options: categories.map((c) => ({ value: c.category, label: c.category })), multi: true },
          { type: "select", name: "marca", label: "Marca", options: brands.map((b) => ({ value: b.brand, label: b.brand })), multi: true },
        ]}
      />

      <Card>
        {products.length === 0 ? (
          <EmptyState icon={<IconProduct size={26} />} title="Sin productos" description="Ajusta los filtros de búsqueda." />
        ) : (
          <>
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Categoría</th>
                    <th className="num">Precio</th>
                    <th className="num">Costo</th>
                    <th className="num">Margen</th>
                    <th className="num">Stock</th>
                    <th className="num">Por vencer ≤60 d</th>
                    <th className="num">Venta 3 m</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => {
                    const margin = p.unitPrice > 0 ? ((p.unitPrice - p.unitCost) / p.unitPrice) * 100 : 0;
                    const units = stockById.get(p.id) ?? 0;
                    const risky = expiryById.get(p.id) ?? 0;
                    const low = units < p.minStock;
                    return (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/productos/${p.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
                            {p.imageEmoji} {p.name}
                          </Link>
                          <p className="font-mono text-[11px] text-[var(--text-muted)]">{p.sku} · {p.brand} · {p.unitsPerCase} u/caja</p>
                        </td>
                        <td className="text-[var(--text-secondary)]">{p.category}</td>
                        <td className="num">{fmtMoneyPrecise(p.unitPrice)}</td>
                        <td className="num text-[var(--text-secondary)]">{fmtMoneyPrecise(p.unitCost)}</td>
                        <td className="num font-medium">{fmtPct(margin, 0)}</td>
                        <td className="num">
                          <span className={low ? "font-semibold text-[var(--critical)]" : ""}>{fmtNumber(units)}</span>
                          {low && <span className="badge badge-danger ml-1.5">Bajo</span>}
                        </td>
                        <td className="num">
                          {risky > 0 ? <span className="text-[var(--serious)]">{fmtNumber(risky)}</span> : <span className="text-[var(--text-muted)]">—</span>}
                        </td>
                        <td className="num font-semibold">{fmtCompact(salesById.get(p.id)?._sum.total ?? 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageCount={pageCount(total, pageSize)} total={total} params={flatten(sp)} basePath="/productos" />
          </>
        )}
      </Card>
    </>
  );
}
