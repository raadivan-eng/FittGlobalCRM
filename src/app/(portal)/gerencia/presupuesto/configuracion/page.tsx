import { requireSection } from "@/lib/auth";
import { budgetConfig, knownAccounts } from "@/lib/budget";
import { fmtDateTime } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";
import { PageHeader } from "@/components/ui";
import { GerenciaTabs } from "../../tabs";
import { BudgetTabs } from "../shared";
import { ConfigEditor } from "./config-editor";

export const metadata = { title: "Configuración del presupuesto" };
export const dynamic = "force-dynamic";

export default async function ConfiguracionPresupuestoPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSection("gerencia");
  const sp = await searchParams;
  const year = Number(one(sp.anio)) || new Date().getFullYear();
  const [config, accounts] = await Promise.all([budgetConfig(), knownAccounts()]);
  const custom = config.customRubros || config.customSettings;

  return (
    <>
      <PageHeader
        title="Configuración del presupuesto"
        subtitle={
          custom
            ? `Rubros y criterios ajustados${config.updatedAt ? ` · última modificación ${fmtDateTime(config.updatedAt)}` : ""}.`
            : "Rigen los rubros y criterios de siempre. Cámbialos aquí cuando el presupuesto se arme o se mida con otros criterios."
        }
      />
      <GerenciaTabs active="/gerencia/presupuesto" />
      <BudgetTabs active="/gerencia/presupuesto/configuracion" year={year} />
      {/* Sólo restaurar reinicia el formulario; guardar conserva el mensaje de confirmación. */}
      <ConfigEditor key={one(sp.restaurado) || "config"} rubros={config.rubros} settings={config.settings} accounts={accounts} />
    </>
  );
}
