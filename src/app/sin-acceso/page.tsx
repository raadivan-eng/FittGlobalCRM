import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ROLES } from "@/lib/enums";

export const metadata = { title: "Sin acceso" };

export default async function NoAccessPage() {
  const user = await requireUser();
  return (
    <main className="flex min-h-dvh items-center justify-center px-5">
      <div className="card max-w-md px-6 py-7 text-center">
        <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">Acceso restringido</p>
        <h1 className="mt-2 text-[19px] font-semibold">Esta sección no está habilitada para tu rol</h1>
        <p className="mt-2 text-[13.5px] text-[var(--text-secondary)]">
          Tu cuenta tiene el perfil <strong>{ROLES.label(user.role)}</strong>. Si necesitas entrar aquí, pídele al
          administrador que ajuste tus permisos.
        </p>
        <Link href="/" className="btn btn-primary mt-5">
          Volver al panel
        </Link>
      </div>
    </main>
  );
}
