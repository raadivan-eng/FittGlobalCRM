import Link from "next/link";
import { PURCHASE_ROLES, requireSection } from "@/lib/auth";
import { purchasePlan, FORECAST_MONTHS, type PlanRow } from "@/lib/purchase-plan";
import { DEFAULT_REVIEW, DEFAULT_SERVICE, HISTORY_MONTHS, MAX_GUARD_DAYS, MIN_REMAINING_LIFE, REVIEW_OPTIONS, SERVICE_LEVELS } from "@/lib/purchasing";
import { DEMAND_SOURCE, PURCHASE_SIGNAL } from "@/lib/enums";
import { generarOrdenesCompra } from "@/lib/actions-purchasing";
import { fmtCompact, fmtDateShort, fmtMoney, fmtNumber } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";
import { Card, CardHeader, EmptyState, EnumBadge, PageHeader, StatTile } from "@/components/ui";
import { Filters } from "@/components/filters";
import { RankingBars } from "@/components/charts";
import { IconAlert, IconCart, IconClock, IconExpiry } from "@/components/icons";
import { DemandCell } from "./demand-cell";

export const metadata = { title: "Forecast de compras" };
export const dynamic = "force-dynamic";

/** Orden en que se atiende la tabla: primero lo que se va a quebrar. */
const PRIORITY: Record<string, number> = { QUIEBRE: 0, PEDIR: 1, PROGRAMAR: 2, CUBIERTO: 3, SIN_PROVEEDOR: 4, SIN_DEMANDA: 5 };
/** Señales que piden comprar en este ciclo. */
const TO_BUY = ["QUIEBRE", "PEDIR", "PROGRAMAR"];
/** Las que vienen marcadas para generar la orden: no admiten esperar. */
const URGENT = ["QUIEBRE", "PEDIR"];

const FORM_ID = "plan-compras";

export default async function ComprasPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireSection("compras");
  const editable = PURCHASE_ROLES.includes(user.role);
  const sp = await searchParams;

  const reviewDays = REVIEW_OPTIONS.find((d) => String(d) === one(sp.ciclo)) ?? DEFAULT_REVIEW;
  const service = SERVICE_LEVELS.find((s) => s.value === one(sp.servicio)) ?? SERVICE_LEVELS.find((s) => s.value === DEFAULT_SERVICE)!;
  const signal = one(sp.senal);
  const supplierId = one(sp.proveedor);
  const q = one(sp.q).trim().toLowerCase();

  const now = new Date();
  const all = await purchasePlan({ reviewDays, z: service.z, now });

  const rows = all
    .filter((r) => !signal || r.plan.signal === signal)
    .filter((r) => !supplierId || r.condition?.supplierId === supplierId)
    .filter((r) => !q || r.product.sku.toLowerCase().includes(q) || r.product.name.toLowerCase().includes(q))
    .sort(
      (a, b) =>
        PRIORITY[a.plan.signal] - PRIORITY[b.plan.signal] ||
        (a.plan.orderBy?.getTime() ?? Infinity) - (b.plan.orderBy?.getTime() ?? Infinity) ||
        b.plan.value - a.plan.value,
    );

  const toBuy = all.filter((r) => TO_BUY.includes(r.plan.signal) && r.plan.suggested > 0);
  const urgent = toBuy.filter((r) => URGENT.includes(r.plan.signal));
  const breaking = all.filter((r) => r.plan.signal === "QUIEBRE");
  const unsellable = all.filter((r) => r.plan.unsellable > 0);
  const unsellableValue = unsellable.reduce((s, r) => s + r.plan.unsellable * r.product.unitCost, 0);
  const pending = all.filter((r) => r.plan.signal === "SIN_PROVEEDOR");

  const bySupplier = new Map<string, { name: string; value: number; skus: number; urgent: number }>();
  for (const r of toBuy) {
    const c = r.condition!;
    const acc = bySupplier.get(c.supplierId) ?? bySupplier.set(c.supplierId, { name: c.supplierName, value: 0, skus: 0, urgent: 0 }).get(c.supplierId)!;
    acc.value += r.plan.value;
    acc.skus += 1;
    if (URGENT.includes(r.plan.signal)) acc.urgent += r.plan.value;
  }
  const supplierOptions = [...new Map(all.filter((r) => r.condition).map((r) => [r.condition!.supplierId, r.condition!.supplierName])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, label]) => ({ value, label }));

  const selectable = rows.filter((r) => r.condition && r.plan.suggested > 0 && TO_BUY.includes(r.plan.signal));
  const share = Math.round(MIN_REMAINING_LIFE * 100);

  return (
    <>
      <PageHeader
        title="Forecast de compras"
        subtitle={`Qué pedir, a quién y cuándo. Cruza la demanda de cada SKU con el inventario que alcanza a venderse antes de vencer, lo que ya viene en camino y las condiciones del proveedor: mínimo de compra, costo y tiempos de producción y tránsito.`}
        actions={
          <Link href="/ordenes-compra" className="btn btn-secondary">
            Órdenes de compra
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Compra del ciclo"
          value={fmtCompact(toBuy.reduce((s, r) => s + r.plan.value, 0))}
          hint={`${fmtNumber(toBuy.length)} SKU a pedir en los próximos ${reviewDays} días`}
          icon={<IconCart size={15} />}
        />
        <StatTile
          label="Pedir ya"
          value={fmtNumber(urgent.length)}
          hint={urgent.length ? `${fmtCompact(urgent.reduce((s, r) => s + r.plan.value, 0))} en el punto de reorden o por debajo` : "Nada por debajo del punto de reorden"}
          icon={<IconClock size={15} />}
          href={urgent.length ? "/compras?senal=PEDIR" : undefined}
        />
        <StatTile
          label="Riesgo de quiebre"
          value={fmtNumber(breaking.length)}
          hint={breaking.length ? "Se agotan antes de que llegue la reposición" : "Todo alcanza a reponerse a tiempo"}
          icon={<IconAlert size={15} />}
          href={breaking.length ? "/compras?senal=QUIEBRE" : undefined}
        />
        <StatTile
          label="No alcanza a venderse"
          value={fmtCompact(unsellableValue)}
          hint={`${fmtNumber(unsellable.length)} SKU con stock que pierde vida útil antes de rotar`}
          icon={<IconExpiry size={15} />}
          href="/inventario"
        />
      </div>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Compra sugerida por proveedor" subtitle={`Valor sin IVA de lo que hay que pedir en los próximos ${reviewDays} días, con el costo de las condiciones vigentes`} />
          <RankingBars
            items={[...bySupplier.entries()]
              .sort((a, b) => b[1].value - a[1].value)
              .map(([id, s]) => ({
                label: s.name,
                value: s.value,
                sub: `${s.skus} SKU${s.urgent ? ` · ${fmtCompact(s.urgent)} ya` : ""}`,
                href: `/compras?proveedor=${id}`,
              }))}
            format="money"
            emptyLabel="Ningún SKU con proveedor necesita compra en este ciclo"
          />
        </Card>

        <Card>
          <CardHeader title="Cómo se calcula" />
          <ul className="space-y-2 px-4 py-3 text-[12.5px] text-[var(--text-secondary)]">
            <li>
              <b className="text-[var(--text-primary)]">Demanda.</b> El forecast por producto de los próximos {FORECAST_MONTHS} meses si está cargado; si no, el promedio vendido en los últimos {HISTORY_MONTHS} meses cerrados, sin los meses extraordinarios del forecast de ventas.
            </li>
            <li>
              <b className="text-[var(--text-primary)]">Vigencia.</b> Los lotes se consumen por vencimiento (FEFO). Un lote deja de contar cuando le queda menos de {share}% de su vida útil —como máximo {MAX_GUARD_DAYS} días—, porque las cadenas no lo reciben, y nunca se sugiere más de lo que alcanza a venderse antes de ese punto.
            </li>
            <li>
              <b className="text-[var(--text-primary)]">Proveedor.</b> El de menor costo. El lead time es producción más tránsito; la cantidad se redondea a cajas completas y nunca baja del mínimo de compra.
            </li>
            <li>
              <b className="text-[var(--text-primary)]">Nivel objetivo.</b> Demanda del lead time más un ciclo de {reviewDays} días, más un stock de seguridad al {service.label} de servicio, que nunca baja del stock mínimo del producto.
            </li>
          </ul>
          {pending.length > 0 && (
            <p className="border-t border-[var(--border)] px-4 py-2.5 text-[12px] text-[var(--text-muted)]">
              {fmtNumber(pending.length)} SKU con venta no tienen proveedor con condiciones.{" "}
              <Link href="/compras?senal=SIN_PROVEEDOR" className="text-[var(--brand)] hover:underline">Ver cuáles</Link>
            </p>
          )}
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader
          title="Plan por SKU"
          subtitle={
            editable
              ? "Marca lo que vas a pedir y ajusta la cantidad: se crea una orden en borrador por proveedor. La demanda se puede fijar a mano en cada SKU."
              : "Lo que hay que pedir de cada SKU y para cuándo."
          }
          action={
            editable && selectable.length > 0 ? (
              <button type="submit" form={FORM_ID} className="btn btn-primary">
                Generar órdenes de compra
              </button>
            ) : undefined
          }
        />
        <div className="px-4 pt-3">
          <Filters
            fields={[
              { type: "search", name: "q", placeholder: "SKU o producto…" },
              { type: "select", name: "senal", label: "Todas las señales", options: PURCHASE_SIGNAL.options.map((o) => ({ value: o.value, label: o.label })) },
              { type: "select", name: "proveedor", label: "Todos los proveedores", options: supplierOptions },
              {
                type: "select",
                name: "ciclo",
                label: `Ciclo de ${DEFAULT_REVIEW} días`,
                options: REVIEW_OPTIONS.filter((d) => d !== DEFAULT_REVIEW).map((d) => ({ value: String(d), label: `Ciclo de ${d} días` })),
              },
              {
                type: "select",
                name: "servicio",
                label: `Servicio ${SERVICE_LEVELS.find((s) => s.value === DEFAULT_SERVICE)!.label}`,
                options: SERVICE_LEVELS.filter((s) => s.value !== DEFAULT_SERVICE).map((s) => ({ value: s.value, label: `Servicio ${s.label}` })),
              },
            ]}
          />
        </div>
        {editable && <form id={FORM_ID} action={generarOrdenesCompra} />}
        {rows.length === 0 ? (
          <EmptyState title="Ningún SKU coincide" description="Cambia los filtros para ver el resto del catálogo." icon={<IconCart size={22} />} />
        ) : (
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  {editable && <th className="w-8" aria-label="Pedir" />}
                  <th>Producto</th>
                  <th>Señal</th>
                  <th className="num">Demanda / mes</th>
                  <th className="num">Disponible</th>
                  <th className="num">En camino</th>
                  <th className="num">Cobertura</th>
                  <th className="num">Lead time</th>
                  <th>Pedir antes de</th>
                  <th className="num">Sugerido</th>
                  <th className="num">Valor</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <PlanTableRow key={r.product.id} row={r} editable={editable} now={now} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function PlanTableRow({ row: r, editable, now }: { row: PlanRow; editable: boolean; now: Date }) {
  const p = r.plan;
  const buy = !!r.condition && p.suggested > 0 && TO_BUY.includes(p.signal);
  const today = p.orderBy != null && p.orderBy.getTime() - now.getTime() < 86_400_000;
  const breakdown = r.condition
    ? [
        `Stock de seguridad: ${fmtNumber(p.safetyStock)}`,
        `Punto de reorden: ${fmtNumber(p.reorderPoint)}`,
        `Nivel objetivo: ${fmtNumber(p.targetLevel)}`,
        `Necesario: ${fmtNumber(p.need)}`,
        `Mínimo del proveedor: ${fmtNumber(r.condition.minOrderQty)} · caja de ${r.product.unitsPerCase}`,
        p.sellableCap != null ? `Se vende antes de vencer: ${fmtNumber(p.sellableCap)}` : null,
      ].filter(Boolean).join("\n")
    : undefined;

  return (
    <tr>
      {editable && (
        <td>
          {buy && (
            <>
              <input type="checkbox" name="item" value={r.product.id} form={FORM_ID} defaultChecked={URGENT.includes(p.signal)} aria-label={`Pedir ${r.product.name}`} />
              <input type="hidden" name={`supplier-${r.product.id}`} value={r.condition!.supplierId} form={FORM_ID} />
              <input type="hidden" name={`suggested-${r.product.id}`} value={p.suggested} form={FORM_ID} />
            </>
          )}
        </td>
      )}
      <td className="min-w-[200px]">
        <Link href={`/productos/${r.product.id}`} className="font-medium hover:text-[var(--brand)] hover:underline">
          {r.product.imageEmoji} {r.product.name}
        </Link>
        <span className="block text-[11.5px] text-[var(--text-muted)]">
          {r.product.sku} ·{" "}
          {r.condition ? (
            <>
              {r.condition.supplierName}
              {r.suppliers > 1 && ` (+${r.suppliers - 1})`}
            </>
          ) : (
            "sin proveedor"
          )}
        </span>
      </td>
      <td>
        <span title={PURCHASE_SIGNAL.get(p.signal).hint}>
          <EnumBadge option={PURCHASE_SIGNAL.get(p.signal)} dot />
        </span>
      </td>
      <td className="num">
        <DemandCell productId={r.product.id} forecast={r.demand.forecast} history={r.demand.history} editable={editable} />
        <span
          className="block whitespace-nowrap text-[11px] text-[var(--text-muted)]"
          title={`${DEMAND_SOURCE.get(r.demand.source).hint}${r.demand.source === "FORECAST" ? `. Vendido en promedio: ${fmtNumber(r.demand.history)}` : ""}`}
        >
          {DEMAND_SOURCE.label(r.demand.source)}
        </span>
      </td>
      <td className="num whitespace-nowrap">
        {fmtNumber(p.usable)}
        {p.unsellable > 0 && (
          <span className="block whitespace-nowrap text-[11px] text-[var(--tone-warning-fg)]" title="Unidades que a este ritmo no alcanzan a venderse antes de perder vida útil comercial">
            +{fmtNumber(p.unsellable)} no rota
          </span>
        )}
      </td>
      <td className="num">{p.onOrder > 0 ? fmtNumber(p.onOrder) : <span className="text-[var(--text-muted)]">—</span>}</td>
      <td className="num whitespace-nowrap">
        {p.coverageDays == null ? (
          <span className="text-[var(--text-muted)]">—</span>
        ) : (
          <>
            {p.coverageDays > 999 ? "999+ d" : `${Math.floor(p.coverageDays)} d`}
            <span className="block text-[11px] text-[var(--text-muted)]">agota {fmtDateShort(p.stockoutAt)}</span>
          </>
        )}
      </td>
      <td className="num whitespace-nowrap">
        {p.leadDays != null ? (
          <span title={r.condition ? `${r.condition.productionLeadDays} d de producción + ${r.condition.transitDays} d de tránsito` : undefined}>{p.leadDays} d</span>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        )}
      </td>
      <td className="whitespace-nowrap">
        {p.orderBy == null || p.signal === "CUBIERTO" ? (
          <span className="text-[var(--text-muted)]">{p.orderBy ? fmtDateShort(p.orderBy) : "—"}</span>
        ) : today ? (
          <span className="font-semibold text-[var(--tone-danger-fg)]">Hoy</span>
        ) : (
          fmtDateShort(p.orderBy)
        )}
      </td>
      <td className="num whitespace-nowrap" title={breakdown}>
        {buy && editable ? (
          <input
            name={`qty-${r.product.id}`}
            form={FORM_ID}
            defaultValue={p.suggested}
            inputMode="numeric"
            className="field !w-24 !py-0.5 text-right"
            aria-label={`Cantidad de ${r.product.name}`}
          />
        ) : p.suggested > 0 ? (
          <span className="font-semibold">{fmtNumber(p.suggested)}</span>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        )}
        {p.signal === "QUIEBRE" && p.suggested === 0 && p.onOrder > 0 ? (
          <span className="block text-[11px] text-[var(--text-muted)]">Lo pedido llega tarde; pedir más no llega antes</span>
        ) : p.minOverCap ? (
          <span className="block text-[11px] text-[var(--tone-danger-fg)]">Mínimo &gt; venta antes de vencer</span>
        ) : p.capped ? (
          <span className="block text-[11px] text-[var(--tone-warning-fg)]">Recortado por vencimiento</span>
        ) : null}
      </td>
      <td className="num whitespace-nowrap">{p.value > 0 ? fmtMoney(p.value) : <span className="text-[var(--text-muted)]">—</span>}</td>
    </tr>
  );
}
