import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ROLES } from "@/lib/enums";
import { fmtDate } from "@/lib/format";
import { Card, CardHeader, EnumBadge, KeyValue, PageHeader } from "@/components/ui";
import { PasswordForm, PersonalForm } from "./profile-forms";

export const metadata = { title: "Mi perfil" };
export const dynamic = "force-dynamic";

export default async function PerfilPage() {
  const me = await requireUser();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: me.id },
    select: { name: true, email: true, phone: true, role: true, zone: true, avatarColor: true, createdAt: true },
  });

  return (
    <>
      <PageHeader title="Mi perfil" subtitle="Tus datos personales y tu clave de acceso. El correo, el perfil y la zona los gestiona quien administra el portal." />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Datos personales" />
            <PersonalForm name={user.name} phone={user.phone} avatarColor={user.avatarColor} />
          </Card>

          <Card>
            <CardHeader title="Cuenta" subtitle="Sólo lectura" />
            <dl className="grid gap-x-6 px-4 py-2.5 sm:grid-cols-2">
              <KeyValue label="Correo">{user.email}</KeyValue>
              <KeyValue label="Perfil"><EnumBadge option={ROLES.get(user.role)} /></KeyValue>
              {user.zone && <KeyValue label="Zona">{user.zone}</KeyValue>}
              <KeyValue label="Alta">{fmtDate(user.createdAt)}</KeyValue>
            </dl>
          </Card>
        </div>

        <Card className="self-start">
          <CardHeader title="Cambiar clave" />
          <PasswordForm />
        </Card>
      </div>
    </>
  );
}
