"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  desconectarConexion,
  guardarConexion,
  probarConexion,
  type ConnectionState,
} from "@/lib/actions-integrations";
import { CONNECTION_STATUS } from "@/lib/enums";
import type { Provider } from "@/lib/integrations";
import { EnumBadge } from "@/components/ui";
import { IconAlert, IconCheck, IconKey, IconPlug, IconRefresh, IconX } from "@/components/icons";

/** Lo que el servidor sabe de la conexión. Las fechas llegan ya formateadas. */
export type ConnectionView = {
  status: string;
  account: string | null;
  secretHint: string | null;
  lastCheck: string | null;
  lastDetail: string | null;
  lastError: string | null;
};

function SubmitButton({ label, pendingLabel, className, icon, disabled }: { label: string; pendingLabel: string; className: string; icon?: React.ReactNode; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || disabled}>
      {pending ? pendingLabel : (<>{icon}{label}</>)}
    </button>
  );
}

/**
 * Qué se puede enseñar de cada campo ya guardado. Sólo la credencial principal
 * lleva máscara —es la única de la que se guarda pista—; el resto viaja cifrado
 * y ni siquiera vuelve enmascarado.
 */
function resumen(name: string, state: ConnectionView) {
  if (name === "account") return state.account ?? "—";
  if (name === "secret") return `•••• ${state.secretHint ?? ""}`;
  return "guardado";
}

export function ConnectionCard({ provider, color, state, ready = true }: { provider: Provider; color: string; state: ConnectionView; ready?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, formAction] = useActionState<ConnectionState, FormData>(guardarConexion, {});

  const configured = state.status !== "SIN_CONFIGURAR";

  // Guardado correcto: cierra el editor, el aviso queda en el cuerpo de la tarjeta.
  useEffect(() => {
    if (result.ok) setEditing(false);
  }, [result]);

  return (
    <div className="card flex flex-col">
      <div className="flex items-start gap-3 border-b border-[var(--border)] px-4 py-3">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[15px] font-bold"
          style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
        >
          {provider.name[0]}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold">{provider.name}</p>
          <p className="mt-0.5 text-[12px] leading-snug text-[var(--text-muted)]">{provider.tagline}</p>
        </div>
        <EnumBadge option={CONNECTION_STATUS.get(state.status)} dot />
      </div>

      {editing ? (
        <form action={formAction} className="flex flex-1 flex-col gap-3 px-4 py-3.5">
          <input type="hidden" name="provider" value={provider.key} />
          {provider.fields.map((field) => (
            <label key={field.name} className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-[var(--text-secondary)]">{field.label}</span>
              <input
                name={field.name}
                type={field.secret ? "password" : "text"}
                autoComplete="off"
                spellCheck={false}
                className="field font-mono text-[12.5px]"
                defaultValue={field.name === "account" ? (state.account ?? "") : ""}
                placeholder={
                  configured && field.name !== "account"
                    ? `${resumen(field.name, state)} — déjalo vacío para conservarlo`
                    : field.hint
                }
              />
              <span className="text-[11px] text-[var(--text-muted)]">{field.hint}</span>
            </label>
          ))}

          {result.error && (
            <p className="flex items-start gap-1.5 rounded-md border border-[var(--tone-danger-bd)] bg-[var(--tone-danger-bg)] px-2 py-1.5 text-[11.5px] text-[var(--tone-danger-fg)]">
              <IconAlert size={13} className="mt-px shrink-0" />
              {result.error}
            </p>
          )}

          <div className="mt-auto flex gap-1.5 pt-1">
            <SubmitButton label="Guardar" pendingLabel="Guardando…" className="btn btn-primary !py-1 text-[12.5px]" />
            <button type="button" className="btn btn-ghost !py-1 text-[12.5px]" onClick={() => setEditing(false)}>
              <IconX size={12} /> Cancelar
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-1 flex-col gap-3 px-4 py-3.5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.045em] text-[var(--text-muted)]">Qué trae al portal</p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {provider.brings.map((b) => (
                <li key={b} className="flex gap-1.5 text-[12.5px] leading-snug text-[var(--text-secondary)]">
                  <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--border-strong)]" />
                  {b}
                </li>
              ))}
            </ul>
          </div>

          <dl className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.045em] text-[var(--text-muted)]">
              <IconKey size={12} /> Credenciales
            </div>
            {configured ? (
              <div className="mt-1.5 flex flex-col gap-1">
                {provider.fields.map((field) => (
                  <div key={field.name} className="flex items-baseline justify-between gap-2 text-[12px]">
                    <dt className="shrink-0 text-[var(--text-muted)]">{field.label}</dt>
                    <dd className="truncate font-mono text-[11.5px]">{resumen(field.name, state)}</dd>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
                Sin credenciales cargadas. Se guardan cifradas y sólo vuelve al navegador su máscara.
              </p>
            )}
          </dl>

          <div className="text-[12px]">
            <p className="text-[var(--text-muted)]">
              Última prueba: <span className="text-[var(--text-secondary)]">{state.lastCheck ?? "nunca"}</span>
            </p>
            {state.lastDetail && (
              <p className="mt-1 flex items-start gap-1.5 text-[var(--tone-success-fg)]">
                <IconCheck size={13} className="mt-px shrink-0" />
                {state.lastDetail}
              </p>
            )}
            {state.lastError && (
              <p className="mt-1 rounded-md border border-[var(--tone-danger-bd)] bg-[var(--tone-danger-bg)] px-2 py-1.5 text-[11.5px] leading-snug text-[var(--tone-danger-fg)]">
                {state.lastError}
              </p>
            )}
            {result.ok && !state.lastDetail && !state.lastError && (
              <p className="mt-1 text-[var(--text-secondary)]">{result.ok}</p>
            )}
          </div>

          {ready ? (
            provider.endpoint && <p className="mt-auto pt-1 font-mono text-[10.5px] leading-snug text-[var(--text-muted)]">{provider.endpoint}</p>
          ) : (
            <p className="mt-auto rounded-md border border-[var(--tone-info-bd)] bg-[var(--tone-info-bg)] px-2 py-1.5 text-[11.5px] leading-snug text-[var(--tone-info-fg)]">
              Integración en preparación. Puedes dejar cargadas las credenciales; la prueba se habilita cuando el portal
              tenga el adaptador de {provider.name}.
            </p>
          )}

          {confirming ? (
            <div className="flex flex-col gap-2 rounded-lg border border-[var(--tone-danger-bd)] bg-[var(--tone-danger-bg)] p-2.5">
              <p className="text-[12px] text-[var(--tone-danger-fg)]">Se borrarán las credenciales guardadas de {provider.name}.</p>
              <div className="flex gap-1.5">
                <form action={desconectarConexion}>
                  <input type="hidden" name="provider" value={provider.key} />
                  <SubmitButton label="Desconectar" pendingLabel="Borrando…" className="btn btn-danger !py-1 text-[12.5px]" />
                </form>
                <button type="button" className="btn btn-ghost !py-1 text-[12.5px]" onClick={() => setConfirming(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <form action={probarConexion}>
                <input type="hidden" name="provider" value={provider.key} />
                <SubmitButton
                  label="Probar conexión"
                  pendingLabel="Probando…"
                  className="btn btn-primary !py-1 text-[12.5px]"
                  icon={<IconRefresh size={12} />}
                  disabled={!configured || !ready}
                />
              </form>
              <button type="button" className="btn btn-secondary !py-1 text-[12.5px]" onClick={() => setEditing(true)}>
                <IconPlug size={12} /> {configured ? "Editar credenciales" : "Conectar"}
              </button>
              {configured && (
                <button type="button" className="btn btn-ghost !py-1 text-[12.5px]" onClick={() => setConfirming(true)}>
                  Desconectar
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
