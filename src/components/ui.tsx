import Link from "next/link";
import type { ReactNode } from "react";
import type { Option, Tone } from "@/lib/enums";
import { fmtPct, initials } from "@/lib/format";
import { IconArrowDown, IconArrowUp } from "./icons";

export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`badge badge-${tone} ${className}`}>{children}</span>;
}

/** Badge que toma etiqueta y tono directamente del catálogo de enums. */
export function EnumBadge({ option, dot = false }: { option: Option; dot?: boolean }) {
  return (
    <span className={`badge badge-${option.tone}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full dot-${option.tone}`} />}
      {option.label}
    </span>
  );
}

export function Card({ children, className = "", as: As = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" }) {
  return <As className={`card ${className}`}>{children}</As>;
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-4 py-3">
      <div className="min-w-0">
        <h3 className="text-[13.5px] font-semibold">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, breadcrumb }: { title: string; subtitle?: ReactNode; actions?: ReactNode; breadcrumb?: { label: string; href?: string }[] }) {
  return (
    <header className="mb-5">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="mb-1.5 flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
          {breadcrumb.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden>/</span>}
              {c.href ? (
                <Link href={c.href} className="hover:text-[var(--brand)] hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span>{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em]">{title}</h1>
          {subtitle && <p className="mt-1 max-w-2xl text-[13px] text-[var(--text-secondary)]">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/**
 * Tarjeta KPI. La variación siempre lleva flecha + signo además del color,
 * para que el sentido no dependa sólo del matiz.
 */
export function StatTile({
  label,
  value,
  delta,
  hint,
  icon,
  invertDelta = false,
  href,
}: {
  label: string;
  value: ReactNode;
  delta?: number | null;
  hint?: ReactNode;
  icon?: ReactNode;
  invertDelta?: boolean;
  href?: string;
}) {
  const good = delta == null ? null : invertDelta ? delta <= 0 : delta >= 0;
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.045em] text-[var(--text-muted)]">{label}</span>
        {icon && <span className="text-[var(--text-muted)]">{icon}</span>}
      </div>
      <div className="mt-2 text-[25px] font-semibold leading-none tracking-[-0.02em] tabular">{value}</div>
      <div className="mt-2 flex items-center gap-2 text-[12px]">
        {delta != null && (
          <span
            className="inline-flex items-center gap-0.5 font-semibold"
            style={{ color: good ? "var(--good)" : "var(--critical)" }}
          >
            {delta >= 0 ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />}
            {fmtPct(delta)}
          </span>
        )}
        {hint && <span className="min-w-0 truncate text-[var(--text-muted)]">{hint}</span>}
      </div>
    </>
  );

  const cls = "card block px-4 py-3.5 transition-colors";
  return href ? (
    <Link href={href} className={`${cls} hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Barra de progreso con extremo redondeado anclado a la línea base. */
export function Meter({ value, max, color = "var(--brand)", height = 6, track = "var(--surface-3)" }: { value: number; max: number; color?: string; height?: number; track?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="w-full overflow-hidden rounded-full" style={{ height, background: track }}>
      <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function Avatar({ name, color = "#2a78d6", size = 28 }: { name: string; color?: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

export function EmptyState({ title, description, icon, action }: { title: string; description?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon && <div className="mb-1 text-[var(--text-muted)]">{icon}</div>}
      <p className="text-[14px] font-semibold">{title}</p>
      {description && <p className="max-w-sm text-[13px] text-[var(--text-secondary)]">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-center gap-2">{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[15px] font-semibold">{children}</h2>
      {action}
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5">
      <dt className="text-[11.5px] font-medium uppercase tracking-[0.04em] text-[var(--text-muted)]">{label}</dt>
      <dd className="text-[13.5px]">{children}</dd>
    </div>
  );
}

/** Etiqueta de estado con icono textual: el color nunca es el único portador. */
export function StatusDot({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px]">
      <span className={`h-2 w-2 shrink-0 rounded-full dot-${tone}`} />
      {label}
    </span>
  );
}

/** Variación en línea para tablas: flecha + signo además del color; «—» sin base. */
export function Delta({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value == null) return <span className="text-[var(--text-muted)]">—</span>;
  const good = invert ? value <= 0 : value >= 0;
  return (
    <span className="inline-flex items-center gap-0.5 font-medium tabular" style={{ color: good ? "var(--good)" : "var(--critical)" }}>
      {value >= 0 ? <IconArrowUp size={11} /> : <IconArrowDown size={11} />}
      {fmtPct(value, 0)}
    </span>
  );
}
