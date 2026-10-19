import Link from "next/link";
import { ACCESS, can, requireUser } from "@/lib/auth";
import { unreadCount } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { logoutAction } from "@/lib/actions-auth";
import { Sidebar } from "@/components/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar } from "@/components/ui";
import { ROLES } from "@/lib/enums";
import { IconLogout } from "@/components/icons";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const allowed = ACCESS[user.role] ?? [];
  // Leads nuevos: los que todavía nadie ha contactado.
  const [unread, newLeads] = await Promise.all([
    can(user.role, "avisos") ? unreadCount(user.id) : 0,
    can(user.role, "leads") ? prisma.lead.count({ where: { status: "NUEVO" } }) : 0,
  ]);

  return (
    <div className="min-h-dvh">
      <Sidebar
        allowed={allowed}
        badges={{ avisos: unread, leads: newLeads }}
        footer={
          <div className="flex items-center gap-2.5">
            <Link
              href="/perfil"
              title="Mi perfil"
              className="-m-1 flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1 transition-colors hover:bg-[var(--surface-2)]"
            >
              <Avatar name={user.name} color={user.avatarColor} size={32} />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-[12.5px] font-semibold">{user.name}</p>
                <p className="truncate text-[11px] text-[var(--text-muted)]">{ROLES.label(user.role)}</p>
              </div>
            </Link>
            <ThemeToggle />
            <form action={logoutAction}>
              <button type="submit" className="btn btn-ghost h-8 w-8 !px-0" title="Cerrar sesión" aria-label="Cerrar sesión">
                <IconLogout size={16} />
              </button>
            </form>
          </div>
        }
      />
      <main className="lg:pl-[248px]">
        <div className="mx-auto w-full max-w-[1360px] px-4 pb-16 pt-16 sm:px-6 lg:pt-7">{children}</div>
      </main>
    </div>
  );
}
