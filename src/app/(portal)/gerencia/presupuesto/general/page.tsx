import { requireSection } from "@/lib/auth";
import { budgetConfig, budgetYears, generalBudget, statementReference, yearMonths } from "@/lib/budget";
import { one, type SearchParams } from "@/lib/params";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { GerenciaTabs } from "../../tabs";
import { BudgetTabs } from "../shared";
import { YearSelect } from "../year-select";
import { GeneralEditor, type EditorAccount } from "./general-editor";

export const metadata = { title: "Presupuesto general" };
export const dynamic = "force-dynamic";

export default async function PresupuestoGeneralPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection("gerencia");
  const sp = await searchParams;
  const now = new Date();
  const year = Number(one(sp.anio)) || now.getFullYear();
  const months = yearMonths(year);

  const { rubros, settings } = await budgetConfig();
  const [years, budget, reference] = await Promise.all([budgetYears(now), generalBudget(year, rubros), statementReference(rubros, now)]);

  // Todas las cuentas que reporta la contabilidad más las que sólo existen en el presupuesto.
  const accounts = new Map<string, EditorAccount>();
  for (const r of reference.accounts) accounts.set(r.code, { code: r.code, name: r.name, budget: {}, reference: r.byMonth });
  for (const a of budget.accounts) {
    const e = accounts.get(a.code) ?? { code: a.code, name: a.name, budget: {}, reference: {} };
    e.name = a.name;
    for (const m of months) {
      const v = a.amounts.get(m.period);
      if (v) e.budget[m.mm] = v;
    }
    accounts.set(a.code, e);
  }

  return (
    <>
      <PageHeader
        title="Presupuesto general"
        subtitle="Lo que se espera del negocio completo, cuenta por cuenta del estado de resultados y mes a mes. Es el todo del que cada cliente toma su participación."
        actions={<YearSelect years={years} year={year} />}
      />
      <GerenciaTabs active="/gerencia/presupuesto" />
      <BudgetTabs active="/gerencia/presupuesto/general" year={year} />

      <Card>
        <CardHeader
          title={`Presupuesto ${year} por cuenta`}
          subtitle={
            reference.monthsWithData
              ? `En gris, como guía, lo que reportó la contabilidad en el mismo mes (${reference.label}).`
              : "Sin estado de resultados cargado para usar de guía: carga las cifras a mano o sube primero el estado de resultados."
          }
        />
        <GeneralEditor
          key={year}
          year={year}
          accounts={[...accounts.values()].sort((a, b) => a.code.localeCompare(b.code))}
          monthLabels={months.map((m) => m.label)}
          refLabel={reference.label}
          rubros={rubros}
          defaultSpread={settings.spread}
        />
      </Card>
    </>
  );
}
