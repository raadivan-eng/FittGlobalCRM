"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  desconectarConexion,
  guardarConexion,
  probarConexion,
  probarModulo,
  sincronizarSiigo,
  type ConnectionState,
} from "@/lib/actions-integrations";
import { CONNECTION_STATUS } from "@/lib/enums";
import type { Provider, ProviderModule } from "@/lib/integrations";
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

/** Estado de un módulo de un proveedor con varias APIs. `status` ya trae INACTIVO si está apagado. */
export type ModuleView = {
  key: string;
  partnerId: string | null;
  enabled: boolean;
  status: string;
  lastCheck: string | null;
  lastSync: string | null;
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

export function ConnectionCard({
  provider,
  color,
  state,
  ready = true,
  modules,
}: {
  provider: Provider;
  color: string;
  state: ConnectionView;
  ready?: boolean;
  modules?: ModuleView[];
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, formAction] = useActionState<ConnectionState, FormData>(guardarConexion, {});

  const configured = state.status !== "SIN_CONFIGURAR";

  // Guardado correcto: cierra el editor, el aviso queda en el cuerpo de la tarjeta.
  useEffect(() => {
    if (result.ok) setEditing(false);
  }, [result]);

  return (
    // Con módulos la tarjeta ocupa la fila entera: cada módulo lleva su propia columna.
    <div className={`card flex flex-col ${modules ? "md:col-span-2 xl:col-span-3" : ""}`}>
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

          {provider.modules && modules && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[12px] font-medium text-[var(--text-secondary)]">Módulos</legend>
              <p className="-mt-1 text-[11px] text-[var(--text-muted)]">
                Cada módulo usa las mismas credenciales con su propio Partner-ID, el que Siigo asignó a la aplicación
                al registrarla. Apaga los que el portal no deba usar.
              </p>
              <div className="grid gap-2 md:grid-cols-3">
                {provider.modules.map((m) => {
                  const actual = modules.find((v) => v.key === m.key);
                  return (
                    <div key={m.key} className="flex flex-col gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
                      <label className="flex items-center gap-1.5 text-[12.5px] font-medium">
                        <input type="checkbox" name={`enabled:${m.key}`} defaultChecked={actual?.enabled ?? true} />
                        {m.name}
                      </label>
                      <input
                        name={`partnerId:${m.key}`}
                        aria-label={`Partner-ID de ${m.name}`}
                        autoComplete="off"
                        spellCheck={false}
                        className="field font-mono text-[12.5px]"
                        defaultValue={actual?.partnerId ?? ""}
                        placeholder={`Partner-ID, p. ej. ${m.suggestedPartnerId}`}
                      />
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )}

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
          {provider.modules && modules ? (
            <ModuleList
              provider={provider}
              modules={modules}
              canTest={configured && ready}
            />
          ) : (
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
          )}

          {/* En la tarjeta ancha, credenciales y última prueba van lado a lado. */}
          <div className={modules ? "grid items-start gap-3 md:grid-cols-2" : "contents"}>
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
                  label={provider.modules ? "Probar todos los módulos" : "Probar conexión"}
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

function ModuleList({ provider, modules, canTest }: { provider: Provider; modules: ModuleView[]; canTest: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.045em] text-[var(--text-muted)]">Módulos</p>
      <div className="mt-1.5 grid gap-2 md:grid-cols-3">
        {provider.modules!.map((m) => (
          <ModuleBox key={m.key} provider={provider} module={m} view={modules.find((v) => v.key === m.key)} canTest={canTest} />
        ))}
      </div>
    </div>
  );
}

function ModuleBox({ provider, module, view, canTest }: { provider: Provider; module: ProviderModule; view?: ModuleView; canTest: boolean }) {
  const enabled = view?.enabled ?? true;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">{module.name}</p>
          <p className="truncate font-mono text-[11px] text-[var(--text-muted)]">{view?.partnerId ?? "Sin Partner-ID"}</p>
        </div>
        <EnumBadge option={CONNECTION_STATUS.get(view?.status ?? "SIN_CONFIGURAR")} dot />
      </div>
      <ul className="flex flex-col gap-1">
        {module.brings.map((b) => (
          <li key={b} className="flex gap-1.5 text-[12px] leading-snug text-[var(--text-secondary)]">
            <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--border-strong)]" />
            {b}
          </li>
        ))}
      </ul>
      <div className="mt-auto text-[11.5px]">
        <p className="text-[var(--text-muted)]">
          Última prueba: <span className="text-[var(--text-secondary)]">{view?.lastCheck ?? "nunca"}</span>
        </p>
        {view?.lastSync && (
          <p className="text-[var(--text-muted)]">
            Última sincronización: <span className="text-[var(--text-secondary)]">{view.lastSync}</span>
          </p>
        )}
        {enabled && view?.lastDetail && !view.lastError && (
          <p className="mt-1 flex items-start gap-1.5 text-[var(--tone-success-fg)]">
            <IconCheck size={12} className="mt-px shrink-0" />
            {view.lastDetail}
          </p>
        )}
        {enabled && view?.lastError && (
          <p className="mt-1 rounded-md border border-[var(--tone-danger-bd)] bg-[var(--tone-danger-bg)] px-2 py-1 leading-snug text-[var(--tone-danger-fg)]">
            {view.lastError}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <form action={probarModulo}>
          <input type="hidden" name="provider" value={provider.key} />
          <input type="hidden" name="module" value={module.key} />
          <SubmitButton
            label="Probar"
            pendingLabel="Probando…"
            className="btn btn-secondary !py-0.5 text-[12px]"
            icon={<IconRefresh size={11} />}
            disabled={!canTest || !enabled || !view?.partnerId}
          />
        </form>
        {module.sync && <SyncButton hint={module.sync} disabled={!canTest || view?.status !== "CONECTADA"} />}
      </div>
    </div>
  );
}

/**
 * Encadena lotes de sincronización desde el navegador: cada uno es una
 * petición aparte con sus propios límites. Si se cierra la página, el avance
 * queda guardado y el siguiente clic sigue donde iba.
 */
function SyncButton({ hint, disabled }: { hint: string; disabled: boolean }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    setProgress("Conectando con Siigo…");
    try {
      for (;;) {
        const b = await sincronizarSiigo();
        if (b.error) {
          setError(b.error);
          break;
        }
        if (b.retryAfterSeconds) {
          setProgress(`Siigo pidió una pausa: sigue en ${b.retryAfterSeconds} s…`);
          await new Promise((r) => setTimeout(r, b.retryAfterSeconds! * 1000));
          continue;
        }
        if (b.done) break;
        setProgress(
          b.fase === "NOTAS"
            ? `Notas crédito: página ${b.page} de ${b.pages} · ${b.notas} nuevas`
            : `Facturas: página ${b.page} de ${b.pages} · ${b.nuevas} nuevas, ${b.actualizadas} actualizadas`,
        );
      }
    } catch {
      setError("Se cortó la comunicación con el portal. Vuelve a sincronizar: sigue donde iba.");
    }
    setProgress(null);
    setRunning(false);
  }

  return (
    <>
      <button type="button" className="btn btn-primary !py-0.5 text-[12px]" onClick={run} disabled={disabled || running} title={hint}>
        {running ? "Sincronizando…" : (<><IconRefresh size={11} />Sincronizar</>)}
      </button>
      {progress && <p className="w-full text-[11.5px] tabular text-[var(--text-secondary)]" aria-live="polite">{progress}</p>}
      {error && (
        <p className="w-full rounded-md border border-[var(--tone-danger-bd)] bg-[var(--tone-danger-bg)] px-2 py-1 text-[11.5px] leading-snug text-[var(--tone-danger-fg)]">
          {error}
        </p>
      )}
    </>
  );
}
