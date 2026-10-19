"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { cambiarEstado, cambiarPerfil, crearUsuario, restablecerClave, type UserFormState } from "@/lib/actions-users";
import { ROLES } from "@/lib/enums";
import { IconAlert, IconCheck, IconKey, IconPlus } from "@/components/icons";

function SubmitButton({ label, pendingLabel, className }: { label: React.ReactNode; pendingLabel: string; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 rounded-md border border-[var(--tone-danger-bd)] bg-[var(--tone-danger-bg)] px-2 py-1.5 text-[12px] text-[var(--tone-danger-fg)]">
      <IconAlert size={13} className="mt-px shrink-0" />
      {children}
    </p>
  );
}

/**
 * La clave sólo existe en claro en esta respuesta: en la base queda el hash.
 * Por eso se muestra una vez, con botón de copiar y el aviso de que no vuelve.
 */
function Credentials({ email, password }: { email: string; password: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(`Portal Fitt Global: https://crm.fittglobal.com\nUsuario: ${email}\nClave temporal: ${password}`);
    setCopied(true);
  };
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-[var(--tone-success-bd)] bg-[var(--tone-success-bg)] px-2.5 py-2 text-[12px] text-[var(--tone-success-fg)]">
      <span>
        Clave de <strong>{email}</strong>: <code className="select-all whitespace-nowrap rounded bg-[var(--surface-1)] px-1.5 py-0.5 font-mono text-[12.5px] text-[var(--text-primary)]">{password}</code>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={copy} className="btn btn-secondary !py-0.5 text-[11.5px]">
          {copied ? <><IconCheck size={12} /> Copiado</> : "Copiar acceso"}
        </button>
        <span>Cópiala ahora: no se vuelve a mostrar.</span>
      </span>
    </div>
  );
}

export function NewUserForm() {
  const [state, formAction] = useActionState<UserFormState, FormData>(crearUsuario, {});
  const [role, setRole] = useState("BASIC");

  return (
    <form action={formAction} className="flex flex-col gap-3 px-4 py-3.5">
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-[var(--text-secondary)]">Correo</span>
        <input name="email" type="email" required autoComplete="off" placeholder="nombre@fittglobal.com" className="field" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-[var(--text-secondary)]">Nombre</span>
        <input name="name" required autoComplete="off" className="field" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-[var(--text-secondary)]">Perfil</span>
        <select name="role" value={role} onChange={(e) => setRole(e.target.value)} className="field">
          {ROLES.options.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <span className="text-[11.5px] leading-snug text-[var(--text-muted)]">{ROLES.get(role).hint}</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-[var(--text-secondary)]">Clave inicial</span>
        <input name="password" type="text" autoComplete="new-password" placeholder="Vacía = se genera una temporal" className="field font-mono text-[12.5px]" />
      </label>

      {state.error && <ErrorNote>{state.error}</ErrorNote>}
      {state.ok && !state.password && <p className="text-[12px] text-[var(--tone-success-fg)]">{state.ok}</p>}
      {state.ok && state.password && state.email && <Credentials email={state.email} password={state.password} />}

      <SubmitButton label={<><IconPlus size={14} /> Crear usuario</>} pendingLabel="Creando…" className="btn btn-primary self-start" />
    </form>
  );
}

export function RoleSelect({ id, role, disabled }: { id: string; role: string; disabled?: boolean }) {
  return (
    <form action={cambiarPerfil}>
      <input type="hidden" name="id" value={id} />
      <select
        name="role"
        defaultValue={role}
        disabled={disabled}
        title={disabled ? "No puedes cambiar tu propio perfil" : undefined}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="field !h-8 min-w-[168px] !py-0 text-[12.5px]"
        aria-label="Perfil"
      >
        {ROLES.options.map((r) => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>
    </form>
  );
}

function SwitchButton({ active, disabled }: { active: boolean; disabled?: boolean }) {
  const { pending } = useFormStatus();
  // Mientras guarda ya se pinta el estado nuevo, para que el clic se note al instante.
  const on = pending ? !active : active;
  return (
    <button
      type="submit"
      role="switch"
      aria-checked={on}
      disabled={disabled || pending}
      title={disabled ? "No puedes deshabilitar tu propia cuenta" : on ? "Deshabilitar acceso" : "Habilitar acceso"}
      className="group inline-flex items-center gap-2 text-[12.5px] disabled:cursor-not-allowed"
    >
      <span
        aria-hidden
        className="relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors group-disabled:opacity-60"
        style={{ background: on ? "var(--good)" : "var(--surface-3)", boxShadow: "inset 0 0 0 1px var(--border-strong)" }}
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-[var(--surface-1)] shadow transition-[left]"
          style={{ left: on ? "18px" : "2px" }}
        />
      </span>
      <span className={on ? "font-medium" : "text-[var(--text-muted)]"}>{on ? "Habilitado" : "Deshabilitado"}</span>
    </button>
  );
}

/** Deshabilitar corta el acceso al instante; habilitar lo devuelve con la misma clave. */
export function ActiveToggle({ id, active, disabled }: { id: string; active: boolean; disabled?: boolean }) {
  return (
    <form action={cambiarEstado}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? "0" : "1"} />
      <SwitchButton active={active} disabled={disabled} />
    </form>
  );
}

export function ResetPassword({ id }: { id: string }) {
  const [state, formAction] = useActionState<UserFormState, FormData>(restablecerClave, {});
  const [confirming, setConfirming] = useState(false);

  if (state.password && state.email) return <Credentials email={state.email} password={state.password} />;

  return confirming ? (
    <form action={formAction} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="id" value={id} />
      <span className="text-[12px] text-[var(--text-secondary)]">¿Generar clave nueva?</span>
      <SubmitButton label="Sí" pendingLabel="…" className="btn btn-primary !px-2 !py-0.5 text-[12px]" />
      <button type="button" onClick={() => setConfirming(false)} className="btn btn-ghost !px-2 !py-0.5 text-[12px]">No</button>
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
    </form>
  ) : (
    <button type="button" onClick={() => setConfirming(true)} className="btn btn-ghost !px-2 !py-1 text-[12px]">
      <IconKey size={13} /> Restablecer clave
    </button>
  );
}
