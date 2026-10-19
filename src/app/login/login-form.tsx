"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "@/lib/actions-auth";
import { IconAlert, IconArrowRight, IconRoute, IconExpiry, IconForecast } from "@/components/icons";
import { BrandTile } from "@/components/brand-mark";

const HIGHLIGHTS = [
  { Icon: IconRoute, title: "Rutas con criterio", text: "El planificador ordena las visitas por urgencia real: frecuencia vencida, quiebres, novedades abiertas y peso en facturación." },
  { Icon: IconForecast, title: "Forecast contra facturación", text: "Proyección y resultado en la misma escala, por mes, cliente y producto." },
  { Icon: IconExpiry, title: "Vencimientos bajo control", text: "Semáforo de caducidad por lote con el valor en riesgo, antes de que se convierta en merma." },
];

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_minmax(420px,44%)]">
      {/* Panel de contexto */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-[var(--surface-1)] p-10 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.55]"
          style={{ background: "radial-gradient(900px 420px at 12% -5%, var(--brand-soft), transparent 62%)" }}
        />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <BrandTile size={36} className="rounded-xl" />
            <span className="text-[15px] font-semibold">Fitt Global</span>
          </div>
          <h1 className="mt-12 max-w-lg text-[34px] font-semibold leading-[1.15] tracking-[-0.022em]">
            El portal que conecta la góndola con la decisión comercial.
          </h1>
          <p className="mt-4 max-w-md text-[14.5px] leading-relaxed text-[var(--text-secondary)]">
            Clientes, contactos y puntos de venta en una sola estructura; el trabajo de los mercaderistas priorizado por
            impacto; y los resultados —forecast, facturación, inventario y vencimientos— listos para decidir.
          </p>
          <ul className="mt-10 flex max-w-md flex-col gap-5">
            {HIGHLIGHTS.map(({ Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--brand)]">
                  <Icon size={16} />
                </span>
                <span>
                  <span className="block text-[13.5px] font-semibold">{title}</span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-[var(--text-secondary)]">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-[12px] text-[var(--text-muted)]">Portal interno de Fitt Global. Acceso restringido al equipo.</p>
      </section>

      {/* Formulario */}
      <section className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-[380px]">
          <div className="mb-7 lg:hidden">
            <BrandTile size={36} className="rounded-xl" />
          </div>
          <h2 className="text-[21px] font-semibold tracking-[-0.015em]">Ingresar al portal</h2>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">Entra con tu correo corporativo. Lo que ves depende de tu rol.</p>

          <form action={formAction} className="mt-6 flex flex-col gap-3.5">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium">Correo corporativo</span>
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
                className="field"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium">Contraseña</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="field"
              />
            </label>

            {state.error && (
              <p className="flex items-start gap-2 rounded-lg border border-[var(--tone-danger-bd)] bg-[var(--tone-danger-bg)] px-3 py-2 text-[12.5px] text-[var(--tone-danger-fg)]">
                <IconAlert size={15} className="mt-px shrink-0" />
                {state.error}
              </p>
            )}

            <button type="submit" className="btn btn-primary mt-1 h-9" disabled={pending}>
              {pending ? "Verificando…" : "Ingresar"}
              {!pending && <IconArrowRight size={15} />}
            </button>
          </form>

          <p className="mt-6 text-[12px] leading-relaxed text-[var(--text-muted)]">
            ¿Sin acceso o clave olvidada? El administrador del portal la restablece.
          </p>
        </div>
      </section>
    </main>
  );
}
