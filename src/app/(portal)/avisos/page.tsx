import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/auth";
import { NOTIFICATION_TYPES } from "@/lib/enums";
import { fmtDateTime } from "@/lib/format";
import { abrirAviso, marcarAvisosLeidos } from "@/lib/actions-locator";
import { Card, EmptyState, EnumBadge, PageHeader } from "@/components/ui";
import { IconBell, IconCheck } from "@/components/icons";

export const metadata = { title: "Avisos" };
export const dynamic = "force-dynamic";

export default async function AvisosPage() {
  const user = await requireSection("avisos");
  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <>
      <PageHeader
        title="Avisos"
        subtitle="Lo que el portal encontró o cambió sin que estuvieras mirando: tiendas nuevas en Google Maps, altas en el maestro y leads que llegan por redes, WhatsApp o la web."
        actions={
          unread > 0 && (
            <form action={marcarAvisosLeidos}>
              <button type="submit" className="btn btn-secondary">
                <IconCheck size={14} /> Marcar {unread === 1 ? "1 aviso" : `${unread} avisos`} como leídos
              </button>
            </form>
          )
        }
      />

      <Card>
        {notifications.length === 0 ? (
          <EmptyState icon={<IconBell size={26} />} title="Sin avisos" description="Cuando llegue un lead, el localizador encuentre una tienda nueva o se cree una, te avisaremos aquí." />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {notifications.map((n) => (
              <li key={n.id}>
                <form action={abrirAviso}>
                  <input type="hidden" name="id" value={n.id} />
                  <button
                    type="submit"
                    className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-2)] ${n.readAt ? "" : "bg-[var(--brand-soft)]"}`}
                  >
                    <span
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                      style={{ background: n.readAt ? "transparent" : "var(--brand)" }}
                      aria-label={n.readAt ? undefined : "Sin leer"}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={`text-[13.5px] ${n.readAt ? "" : "font-semibold"}`}>{n.title}</span>
                        <EnumBadge option={NOTIFICATION_TYPES.get(n.type)} />
                      </span>
                      {n.body && <span className="mt-0.5 block text-[12.5px] text-[var(--text-secondary)]">{n.body}</span>}
                      <span className="mt-0.5 block text-[11.5px] text-[var(--text-muted)]">{fmtDateTime(n.createdAt)}</span>
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
