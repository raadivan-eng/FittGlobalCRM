import { prisma } from "@/lib/prisma";
import { ACCESS, requireSection } from "@/lib/auth";
import { ROLES } from "@/lib/enums";
import { fmtDate } from "@/lib/format";
import { Avatar, Card, CardHeader, EnumBadge, PageHeader } from "@/components/ui";
import { IconCheck } from "@/components/icons";
import { ActiveToggle, NewUserForm, ResetPassword, RoleSelect } from "./user-controls";

export const metadata = { title: "Usuarios y permisos" };
export const dynamic = "force-dynamic";

/** Mismo orden y nombres que el menú lateral, para leer la matriz contra lo que se ve. */
const SECTIONS: { key: string; label: string }[] = [
  { key: "dashboard", label: "Panel" },
  { key: "clientes", label: "Clientes" },
  { key: "contactos", label: "Contactos" },
  { key: "tiendas", label: "Tiendas" },
  { key: "rutas", label: "Planificador de rutas" },
  { key: "visitas", label: "Visitas" },
  { key: "novedades", label: "Novedades" },
  { key: "guias", label: "Guías de envío" },
  { key: "equipo", label: "Equipo de campo" },
  { key: "productos", label: "Productos" },
  { key: "inventario", label: "Inventario y vencimientos" },
  { key: "ventas", label: "Ventas y facturación" },
  { key: "forecast", label: "Forecast" },
  { key: "reportes", label: "Reportes" },
  { key: "sellout", label: "Sell out" },
  { key: "trade", label: "Actividades de trade" },
  { key: "conexiones", label: "Conexiones API" },
  { key: "usuarios", label: "Usuarios y permisos" },
];

export default async function UsuariosPage() {
  const me = await requireSection("usuarios");

  const users = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true, active: true, avatarColor: true, createdAt: true },
  });
  const order = new Map(ROLES.values.map((v, i) => [v as string, i]));
  users.sort((a, b) => Number(b.active) - Number(a.active) || (order.get(a.role) ?? 9) - (order.get(b.role) ?? 9) || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title="Usuarios y permisos"
        subtitle="Quién entra al portal y qué ve cada uno. Los cambios de perfil aplican en la siguiente página que abra la persona; deshabilitar corta su acceso de inmediato y habilitar lo devuelve con la misma clave."
      />

      <Card>
        <CardHeader title="Usuarios" subtitle={`${users.filter((u) => u.active).length} habilitados de ${users.length}`} />
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Perfil</th>
                <th>Estado</th>
                <th>Alta</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const self = u.id === me.id;
                return (
                  <tr key={u.id}>
                    <td className={u.active ? "" : "opacity-55"}>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={u.name} color={u.avatarColor} size={30} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{u.name}{self && <span className="ml-1.5 text-[11px] font-normal text-[var(--text-muted)]">(tú)</span>}</p>
                          <p className="truncate text-[12px] text-[var(--text-muted)]">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      {self ? <EnumBadge option={ROLES.get(u.role)} /> : <RoleSelect id={u.id} role={u.role} />}
                    </td>
                    <td>
                      <ActiveToggle id={u.id} active={u.active} disabled={self} />
                    </td>
                    <td className="whitespace-nowrap text-[12.5px] text-[var(--text-secondary)]">{fmtDate(u.createdAt)}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                        {u.active && <ResetPassword id={u.id} />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>


      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader title="Nuevo usuario" subtitle="Si dejas la clave vacía, se genera una temporal para compartir." />
          <NewUserForm />
        </Card>
        <Card className="min-w-0">
          <CardHeader
            title="Qué ve cada perfil"
            subtitle="Secciones del menú habilitadas por perfil. Basic sólo consulta: no puede crear ni editar registros."
          />
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Sección</th>
                  {ROLES.options.map((r) => (
                    <th key={r.value} className="text-center" title={r.hint}>{r.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SECTIONS.map((s) => (
                  <tr key={s.key}>
                    <td>{s.label}</td>
                    {ROLES.options.map((r) => {
                      const ok = (ACCESS[r.value] ?? []).includes(s.key);
                      return (
                        <td key={r.value} className="text-center">
                          {ok ? (
                            <><IconCheck size={15} className="inline text-[var(--good)]" /><span className="sr-only">Con acceso</span></>
                          ) : (
                            <span className="text-[var(--text-muted)]"><span aria-hidden>—</span><span className="sr-only">Sin acceso</span></span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
