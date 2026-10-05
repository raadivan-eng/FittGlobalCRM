import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { PROVIDERS } from "@/lib/integrations";
import { CONNECTION_EVENTS, CONNECTION_STATUS } from "@/lib/enums";
import { fmtDateTime } from "@/lib/format";
import { Card, CardHeader, EmptyState, EnumBadge, PageHeader, StatTile } from "@/components/ui";
import { IconCheck, IconClock, IconPlug } from "@/components/icons";
import { ConnectionCard, type ConnectionView } from "./connection-card";

export const metadata = { title: "Conexiones API" };
export const dynamic = "force-dynamic";

/**
 * Color de marca de cada proveedor: sale de la paleta de series en el mismo
 * orden fijo que los gráficos, para no inventar tonos nuevos.
 */
const MARKS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];

export default async function ConexionesPage() {
  await requireSection("conexiones");

  const [rows, events] = await Promise.all([
    prisma.apiConnection.findMany(),
    prisma.apiConnectionEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 15,
      include: { connection: { select: { provider: true } }, user: { select: { name: true } } },
    }),
  ]);

  const byProvider = new Map(rows.map((r) => [r.provider, r]));

  const cards = PROVIDERS.map((provider, i) => {
    const row = byProvider.get(provider.key);
    const view: ConnectionView = {
      status: row?.status ?? "SIN_CONFIGURAR",
      account: row?.account ?? null,
      secretHint: row?.secretHint ?? null,
      lastCheck: row?.lastCheckAt ? fmtDateTime(row.lastCheckAt) : null,
      lastDetail: row?.lastDetail ?? null,
      lastError: row?.lastError ?? null,
    };
    return { provider, color: MARKS[i], view };
  });

  const conectadas = cards.filter((c) => c.view.status === "CONECTADA").length;
  const conError = cards.filter((c) => c.view.status === "ERROR").length;
  const ultima = rows
    .map((r) => r.lastCheckAt)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const providerName = (key: string) => PROVIDERS.find((p) => p.key === key)?.name ?? key;

  return (
    <>
      <PageHeader
        title="Conexiones vía API"
        subtitle="Credenciales de los servicios externos con los que trabaja el portal. Se guardan cifradas con el secreto de sesión y nunca vuelven al navegador: la interfaz sólo muestra sus últimos cuatro caracteres. «Probar conexión» consulta de verdad al proveedor y anota lo que respondió."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Conexiones activas"
          value={`${conectadas} de ${PROVIDERS.length}`}
          hint={conError ? `${conError} con error` : "Ninguna con error"}
          icon={<IconPlug size={15} />}
        />
        <StatTile
          label="Última verificación"
          value={ultima ? fmtDateTime(ultima) : "—"}
          hint={ultima ? "Prueba más reciente contra un proveedor" : "Todavía no se ha probado ninguna"}
          icon={<IconClock size={15} />}
        />
        <StatTile
          label="Pruebas registradas"
          value={events.filter((e) => e.action === "Prueba de conexión").length}
          hint="En la bitácora reciente"
          icon={<IconCheck size={15} />}
        />
      </div>

      <div className="mt-5 grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {cards.map(({ provider, color, view }) => (
          <ConnectionCard key={provider.key} provider={provider} color={color} state={view} />
        ))}
      </div>

      <Card className="mt-5">
        <CardHeader
          title="Bitácora de conexiones"
          subtitle="Cada guardado, prueba y desconexión queda registrado con su autor"
        />
        {events.length ? (
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Cuándo</th>
                  <th>Conexión</th>
                  <th>Acción</th>
                  <th>Resultado</th>
                  <th>Detalle</th>
                  <th className="num">Duración</th>
                  <th>Autor</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap text-[var(--text-secondary)]">{fmtDateTime(e.createdAt)}</td>
                    <td className="font-medium">{providerName(e.connection.provider)}</td>
                    <td className="text-[var(--text-secondary)]">{e.action}</td>
                    <td><EnumBadge option={CONNECTION_EVENTS.get(e.result)} /></td>
                    <td className="max-w-[420px] text-[var(--text-secondary)]"><span className="truncate-2">{e.detail ?? "—"}</span></td>
                    <td className="num tabular text-[var(--text-secondary)]">{e.durationMs != null ? `${e.durationMs} ms` : "—"}</td>
                    <td className="whitespace-nowrap text-[var(--text-secondary)]">{e.user?.name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<IconPlug size={26} />}
            title="Todavía no hay movimientos"
            description="Cuando cargues credenciales o pruebes una conexión, el registro aparecerá aquí."
          />
        )}
      </Card>

      <p className="mt-4 text-[12px] leading-relaxed text-[var(--text-muted)]">
        Los estados posibles son: {CONNECTION_STATUS.options.map((o) => `${o.label} (${o.hint})`).join(" · ")}.
      </p>
    </>
  );
}
