"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { actualizarPerfil, cambiarMiClave, type ProfileFormState } from "@/lib/actions-profile";
import { AVATAR_COLORS } from "@/lib/avatar";
import { Avatar } from "@/components/ui";
import { IconAlert, IconCheck } from "@/components/icons";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary self-start" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function Feedback({ state }: { state: ProfileFormState }) {
  if (state.error)
    return (
      <p className="flex items-start gap-1.5 rounded-md border border-[var(--tone-danger-bd)] bg-[var(--tone-danger-bg)] px-2 py-1.5 text-[12px] text-[var(--tone-danger-fg)]">
        <IconAlert size={13} className="mt-px shrink-0" />
        {state.error}
      </p>
    );
  if (state.ok)
    return (
      <p className="flex items-center gap-1.5 text-[12px] text-[var(--tone-success-fg)]">
        <IconCheck size={13} /> {state.ok}
      </p>
    );
  return null;
}

const labelCls = "text-[12px] font-medium text-[var(--text-secondary)]";

export function PersonalForm({ name, phone, avatarColor }: { name: string; phone: string | null; avatarColor: string }) {
  const [state, formAction] = useActionState<ProfileFormState, FormData>(actualizarPerfil, {});
  const [preview, setPreview] = useState({ name, color: AVATAR_COLORS.includes(avatarColor) ? avatarColor : AVATAR_COLORS[0] });

  return (
    <form action={formAction} className="flex flex-col gap-3 px-4 py-3.5">
      <div className="flex items-center gap-3">
        <Avatar name={preview.name || "?"} color={preview.color} size={44} />
        <fieldset className="flex flex-col gap-1">
          <legend className={labelCls}>Color del avatar</legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {AVATAR_COLORS.map((c) => (
              <label key={c} className="cursor-pointer">
                <input
                  type="radio"
                  name="avatarColor"
                  value={c}
                  checked={preview.color === c}
                  onChange={() => setPreview((p) => ({ ...p, color: c }))}
                  className="peer sr-only"
                />
                <span
                  aria-hidden
                  className="block h-6 w-6 rounded-full ring-offset-2 ring-offset-[var(--surface-1)] peer-checked:ring-2 peer-checked:ring-[var(--text-primary)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--brand)]"
                  style={{ background: c }}
                />
                <span className="sr-only">Color {c}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <label className="flex flex-col gap-1">
        <span className={labelCls}>Nombre</span>
        <input
          name="name"
          required
          maxLength={80}
          defaultValue={name}
          onChange={(e) => setPreview((p) => ({ ...p, name: e.target.value }))}
          autoComplete="name"
          className="field"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelCls}>Teléfono</span>
        <input name="phone" type="tel" defaultValue={phone ?? ""} autoComplete="tel" placeholder="+57 300 000 0000" className="field" />
      </label>

      <Feedback state={state} />
      <SubmitButton label="Guardar cambios" pendingLabel="Guardando…" />
    </form>
  );
}

export function PasswordForm() {
  const [state, formAction] = useActionState<ProfileFormState, FormData>(cambiarMiClave, {});

  return (
    // La key reinicia los campos tras un cambio exitoso, para no dejar la clave escrita.
    <form key={state.ok ?? "clave"} action={formAction} className="flex flex-col gap-3 px-4 py-3.5">
      <label className="flex flex-col gap-1">
        <span className={labelCls}>Clave actual</span>
        <input name="current" type="password" required autoComplete="current-password" className="field" />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelCls}>Clave nueva</span>
        <input name="password" type="password" required minLength={8} autoComplete="new-password" className="field" />
        <span className="text-[11.5px] text-[var(--text-muted)]">Mínimo 8 caracteres.</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelCls}>Repite la clave nueva</span>
        <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className="field" />
      </label>

      <Feedback state={state} />
      <SubmitButton label="Cambiar clave" pendingLabel="Cambiando…" />
    </form>
  );
}
