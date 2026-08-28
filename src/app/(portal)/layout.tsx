import { ACCESS, requireUser } from "@/lib/auth";
import { logoutAction } from "@/lib/actions-auth";
import { Sidebar } from "@/components/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar } from "@/components/ui";
import { ROLES } from "@/lib/enums";
import { IconLogout } from "@/components/icons";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const allowed = ACCESS[user.role] ?? [];

  return (
    <div className="min-h-dvh">
      <Sidebar
        allowed={allowed}
        footer={
          <div className="flex items-center gap-2.5">
            <Avatar name={user.name} color={user.avatarColor} size={32} />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[12.5px] font-semibold">{user.name}</p>
              <p className="truncate text-[11px] text-[var(--text-muted)]">{ROLES.label(user.role)}</p>
            </div>
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
