import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { budgetConfig, budgetYears, clientShares, generalBudget, realSalesShare, salesRubro, sumLines, val } from "@/lib/budget";
import { CHANNELS } from "@/lib/enums";
import { fmtCompact } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { GerenciaTabs } from "../../tabs";
import { BudgetTabs } from "../shared";
import { YearSelect } from "../year-select";
import { ShareEditor, type ShareRow } from "./share-editor";

export const metadata = { title: "Participación por cliente" };
export const dynamic = "force-dynamic";

export default async function ParticipacionPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection("gerencia");
  const sp = await searchParams;
  const now = new Date();
  const year = Number(one(sp.anio)) || now.getFullYear();

  const { rubros, settings } = await budgetConfig();
  const [years, general, shares, reference, companies] = await Promise.all([
    budgetYears(now),
    generalBudget(year, rubros),
    clientShares(year),
    realSalesShare(settings.referenceMonths, settings.creditNotes, now),
    prisma.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, channel: true, active: true } }),
  ]);
  // La participación base se aplica al rubro de la venta.
  const budgetSales = val(sumLines(general.byPeriod.values()), salesRubro(rubros)?.key ?? "");

  // Los activos y los que ya tengan participación aunque se hayan desactivado.
  const rows: ShareRow[] = companies
    .filter((c) => c.active || shares.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      channel: c.channel,
      channelLabel: CHANNELS.label(c.channel),
      reference: reference.share.get(c.id) ?? 0,
      base: shares.get(c.id)?.base ?? null,
      overrides: shares.get(c.id)?.overrides ?? {},
    }))
    .sort((a, b) => (b.base ?? 0) - (a.base ?? 0) || b.reference - a.reference);

  return (
    <>
      <PageHeader
        title="Participación por cliente"
        subtitle="Qué parte del presupuesto general le corresponde a cada cliente. Su presupuesto es cada rubro del general multiplicado por su participación."
        actions={<YearSelect years={years} year={year} />}
      />
      <GerenciaTabs active="/gerencia/presupuesto" />
      <BudgetTabs active="/gerencia/presupuesto/participacion" year={year} />

      {budgetSales <= 0 && (
        <p className="card mb-4 px-4 py-3 text-[13px]">
          El presupuesto general {year} todavía no tiene ingresos: puedes fijar las participaciones, pero no habrá cifras por cliente hasta{" "}
          <Link href={`/gerencia/presupuesto/general?anio=${year}`} className="font-medium text-[var(--brand)] hover:underline">cargarlo</Link>.
        </p>
      )}

      <Card>
        <CardHeader
          title={`Participaciones ${year}`}
          subtitle={`Ingresos del presupuesto general: ${fmtCompact(budgetSales)}. El peso real es la participación de cada cliente en la venta neta de ${reference.label}.`}
        />
        <ShareEditor
          key={year}
          year={year}
          rows={rows}
          channels={CHANNELS.options.map((o) => ({ value: o.value, label: o.label }))}
          budgetSales={budgetSales}
          refLabel={reference.label}
          adjustable={rubros.filter((r) => r.source !== "VENTAS").map((r) => ({ key: r.key, label: r.label }))}
        />
      </Card>
    </>
  );
}
