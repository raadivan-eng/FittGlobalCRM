import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ROLES } from "@/lib/enums";
import { DashboardComercial } from "./dashboard-comercial";
import { DashboardCampo } from "./dashboard-campo";
import { netOfCredits, type SearchParams } from "@/lib/params";
import { CreditNotesSelect } from "@/components/filters";

export const metadata = { title: "Panel" };
export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const isField = user.role === "MERCADERISTA";
  const credits = netOfCredits(await searchParams);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";

  return (
    <>
      <PageHeader
        title={`${greeting}, ${user.name.split(" ")[0]}`}
        subtitle={
          isField
            ? "Tu jornada priorizada: qué tiendas visitar hoy, en qué orden y por qué."
            : "Estado del negocio en una pantalla: resultado contra forecast, portafolio, red de puntos de venta y riesgos de inventario."
        }
        actions={
          <>
            {!isField && (
              <form className="flex items-center gap-2">
                <CreditNotesSelect net={credits} />
                <button className="btn btn-secondary">Aplicar</button>
              </form>
            )}
            <span className="badge badge-neutral">{ROLES.label(user.role)}</span>
          </>
        }
      />
      {isField ? <DashboardCampo userId={user.id} userName={user.name} /> : <DashboardComercial userName={user.name} credits={credits} />}
    </>
  );
}
