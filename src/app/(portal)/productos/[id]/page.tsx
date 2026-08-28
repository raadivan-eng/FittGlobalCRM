import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { lastMonths, NOT_VOID, periodKey } from "@/lib/analytics";
import { EXPIRY_BANDS, expiryBand, LOT_STATUS } from "@/lib/enums";
import { fmtCompact, fmtDate, fmtMoney, fmtMoneyPrecise, fmtNumber, fmtPct } from "@/lib/format";
import { Card, CardHeader, EnumBadge, KeyValue, PageHeader, StatTile } from "@/components/ui";
import { LineChart, RankingBars } from "@/components/charts";
import { IconExpiry, IconInventory, IconSales, IconTarget } from "@/components/icons";

export const dynamic = "force-dynamic";

const BAND_TONE: Record<string, string> = { VENCIDO: "danger", CRITICO: "danger", ALERTA: "warning", VIGILAR: "info", SANO: "success" };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await prisma.product.findUnique({ where: { id }, select: { name: true } });
  return { title: p?.name ?? "Producto" };
}

export default async function ProductoDetalle({ params }: { params: Promise<{ id: string }> }) {
  await requireSection("productos");
  const { id } = await params;

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) notFound();

  const range = lastMonths(12);
  const since = range[0].start;

  const [lines, lots, topClients, shelfStats, forecasts] = await Promise.all([
    prisma.salesOrderLine.findMany({
      where: { productId: id, order: { date: { gte: since }, status: NOT_VOID } },
      select: { total: true, quantity: true, order: { select: { date: true } } },
    }),
    prisma.inventoryLot.findMany({
      where: { productId: id, quantity: { gt: 0 } },
      include: { warehouse: { select: { name: true, city: true } } },
      orderBy: { expiryDate: "asc" },
    }),
    prisma.salesOrderLine.groupBy({
      by: ["orderId"],
      where: { productId: id, order: { date: { gte: since }, status: NOT_VOID } },
      _sum: { total: true },
    }),
    prisma.shelfReport.aggregate({
      where: { productId: id },
      _avg: { facings: true, shelfPrice: true, competitorPrice: true },
      _count: true,
    }),
    prisma.forecast.findMany({ where: { productId: id, period: { in: range.map((r) => r.period) } }, select: { period: true, amount: true } }),
  ]);

  const oosCount = await prisma.shelfReport.count({ where: { productId: id, outOfStock: true } });

  const orderIds = topClients.map((t) => t.orderId);
  const orders = await prisma.salesOrder.findMany({
    where: { id: { in: orderIds } },
    select: { id: true, companyId: true, company: { select: { name: true } } },
  });
  const byCompany = new Map<string, { name: string; total: number }>();
  const orderById = new Map(orders.map((o) => [o.id, o]));
  for (const t of topClients) {
    const o = orderById.get(t.orderId);
    if (!o) continue;
    const acc = byCompany.get(o.companyId) ?? { name: o.company.name, total: 0 };
    acc.total += t._sum.total ?? 0;
    byCompany.set(o.companyId, acc);
  }
  const clientRanking = [...byCompany.entries()].map(([cid, v]) => ({ id: cid, ...v })).sort((a, b) => b.total - a.total).slice(0, 7);

  const revenueByPeriod = new Map<string, number>();
  const unitsByPeriod = new Map<string, number>();
  for (const l of lines) {
    const k = periodKey(l.order.date);
    revenueByPeriod.set(k, (revenueByPeriod.get(k) ?? 0) + l.total);
    unitsByPeriod.set(k, (unitsByPeriod.get(k) ?? 0) + l.quantity);
  }

  const totalUnits = lots.filter((l) => l.status !== "MERMA").reduce((s, l) => s + l.quantity, 0);
  const stockValue = lots.filter((l) => l.status !== "MERMA").reduce((s, l) => s + l.quantity * l.unitCost, 0);
  const revenue12 = lines.reduce((s, l) => s + l.total, 0);
  const units12 = lines.reduce((s, l) => s + l.quantity, 0);
  const margin = product.unitPrice > 0 ? ((product.unitPrice - product.unitCost) / product.unitPrice) * 100 : 0;
  const monthlyRun = units12 / 12;
  const coverageMonths = monthlyRun > 0 ? totalUnits / monthlyRun : null;
  const forecastTotal = forecasts.reduce((s, f) => s + f.amount, 0);
  const shelfCount = shelfStats._count;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Productos", href: "/productos" }, { label: product.name }]}
        title={`${product.imageEmoji} ${product.name}`}
        subtitle={`${product.sku} · ${product.brand} · ${product.category}${product.subcategory ? ` / ${product.subcategory}` : ""}`}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Facturación 12 meses" value={fmtCompact(revenue12)} hint={`${fmtNumber(units12)} unidades vendidas`} icon={<IconSales size={15} />} />
        <StatTile label="Margen bruto" value={fmtPct(margin, 0)} hint={`${fmtMoneyPrecise(product.unitPrice)} lista · ${fmtMoneyPrecise(product.unitCost)} costo`} icon={<IconTarget size={15} />} />
        <StatTile label="Existencias" value={fmtNumber(totalUnits)} hint={`${fmtCompact(stockValue)} al costo${coverageMonths ? ` · ${coverageMonths.toFixed(1)} meses de cobertura` : ""}`} icon={<IconInventory size={15} />} />
        <StatTile label="Quiebre en góndola" value={shelfCount ? `${((oosCount / shelfCount) * 100).toFixed(1)}%` : "—"} hint={`${fmtNumber(shelfCount)} mediciones · ${(shelfStats._avg.facings ?? 0).toFixed(1)} caras promedio`} icon={<IconExpiry size={15} />} invertDelta />
      </div>

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title="Evolución de la venta" subtitle="Facturación mensual de los últimos doce meses" />
          <div className="px-4 py-4">
            <LineChart
              data={range.map((r) => ({ label: r.label, values: [Math.round(revenueByPeriod.get(r.period) ?? 0)] }))}
              series={[{ name: "Facturación", color: "var(--series-1)" }]}
              format="compact"
              height={220}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Ficha técnica" />
          <dl className="grid grid-cols-2 gap-x-4 px-4 py-3">
            <KeyValue label="Código de barras">{product.barcode ?? "—"}</KeyValue>
            <KeyValue label="Unidades por caja">{product.unitsPerCase}</KeyValue>
            <KeyValue label="Vida útil">{product.shelfLifeDays} días</KeyValue>
            <KeyValue label="Stock mínimo">{fmtNumber(product.minStock)} u.</KeyValue>
            <KeyValue label="Precio de lista">{fmtMoneyPrecise(product.unitPrice)}</KeyValue>
            <KeyValue label="Costo unitario">{fmtMoneyPrecise(product.unitCost)}</KeyValue>
            <KeyValue label="Precio medio en góndola">{shelfStats._avg.shelfPrice ? fmtMoneyPrecise(shelfStats._avg.shelfPrice) : "—"}</KeyValue>
            <KeyValue label="Precio medio competencia">{shelfStats._avg.competitorPrice ? fmtMoneyPrecise(shelfStats._avg.competitorPrice) : "—"}</KeyValue>
            <KeyValue label="Forecast 12 m">{fmtMoney(forecastTotal)}</KeyValue>
            <KeyValue label="Lotes activos">{lots.length}</KeyValue>
          </dl>
        </Card>
      </div>

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Lotes en bodega" subtitle="Ordenados por fecha de vencimiento" />
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Lote</th>
                  <th>Bodega</th>
                  <th className="num">Unidades</th>
                  <th>Vence</th>
                  <th className="num">Días</th>
                  <th className="num">Valor</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((l) => {
                  const days = Math.floor((l.expiryDate.getTime() - Date.now()) / 86_400_000);
                  const band = expiryBand(days);
                  return (
                    <tr key={l.id}>
                      <td className="font-mono text-[12px]">{l.lotCode}</td>
                      <td className="text-[var(--text-secondary)]">{l.warehouse.name}</td>
                      <td className="num">{fmtNumber(l.quantity)}</td>
                      <td className="whitespace-nowrap">{fmtDate(l.expiryDate)}</td>
                      <td className="num">
                        <span className={`badge badge-${BAND_TONE[band.key]}`}>{days < 0 ? `${Math.abs(days)} d vencido` : `${days} d`}</span>
                      </td>
                      <td className="num">{fmtMoney(l.quantity * l.unitCost)}</td>
                      <td><EnumBadge option={LOT_STATUS.get(l.status)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Clientes que más lo compran" subtitle="Últimos 12 meses" />
          <RankingBars
            items={clientRanking.map((c) => ({ label: c.name, value: c.total, href: `/clientes/${c.id}` }))}
            format="compact"
          />
        </Card>
      </div>
    </>
  );
}
