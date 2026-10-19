"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { fmtCompact, fmtMoney, fmtNumber } from "@/lib/format";

/* Los componentes de servidor no pueden pasar funciones a los de cliente:
   el formato viaja como clave y se resuelve aquí. */
export type FormatKey = "compact" | "money" | "number" | "minutes" | "percent" | "raw";

const FORMATTERS: Record<FormatKey, (v: number) => string> = {
  compact: fmtCompact,
  money: fmtMoney,
  number: fmtNumber,
  minutes: (v) => `${fmtNumber(Math.round(v))} min`,
  percent: (v) => `${v.toFixed(1).replace(".", ",")}%`,
  raw: (v) => String(Math.round(v)),
};

const useFormatter = (key: FormatKey = "number") => FORMATTERS[key] ?? FORMATTERS.number;

/* Las marcas del eje son cifras redondas: los decimales fijos de las tarjetas
   KPI (`$800,00 M`) sólo ensanchan la etiqueta. */
function trimDecimals(v: number) {
  return (Math.round(v * 100) / 100).toString().replace(".", ",");
}

const AXIS_FORMATTERS: Partial<Record<FormatKey, (v: number) => string>> = {
  compact: (v) => {
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `$${trimDecimals(v / 1_000_000)} M`;
    if (abs >= 1_000) return `$${trimDecimals(v / 1_000)} K`;
    return `$${Math.round(v)}`;
  },
  percent: (v) => `${trimDecimals(v)}%`,
};

const useAxisFormatter = (key: FormatKey = "number") => AXIS_FORMATTERS[key] ?? useFormatter(key);

/* El margen izquierdo sigue a la etiqueta más larga del eje en lugar de ser
   fijo; ~6,2 px por carácter a 10,5 px de cuerpo tabular. */
const axisPad = (labels: string[]) => Math.max(36, Math.ceil(Math.max(0, ...labels.map((l) => l.length)) * 6.2) + 14);

/* Ancho medido en cliente: evita distorsionar trazos con preserveAspectRatio. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

function niceTicks(max: number, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

export type Series = { name: string; color: string };

function Legend({ series, active }: { series: Series[]; active?: number | null }) {
  if (series.length < 2) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      {series.map((s, i) => (
        <span
          key={s.name}
          className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]"
          style={{ opacity: active == null || active === i ? 1 : 0.45 }}
        >
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ x, y, children, width }: { x: number; y: number; children: ReactNode; width: number }) {
  const flip = x > width * 0.62;
  return (
    <div
      className="pointer-events-none absolute z-20 min-w-[150px] rounded-lg border border-[var(--border-strong)] bg-[var(--surface-1)] px-2.5 py-2 text-[12px] shadow-[var(--shadow-lg)]"
      style={{ left: flip ? undefined : x + 12, right: flip ? width - x + 12 : undefined, top: Math.max(0, y - 14) }}
    >
      {children}
    </div>
  );
}

/* ───────────────────────────  Barras agrupadas  ─────────────────────────────
   Para comparar dos medidas de la MISMA escala (forecast vs facturación).
   Nunca dos ejes: si las escalas difieren, se usan dos gráficos. */

export function GroupedBarChart({
  data,
  series,
  height = 230,
  format = "number",
  labelEvery = 1,
}: {
  data: { label: string; values: number[] }[];
  series: Series[];
  height?: number;
  format?: FormatKey;
  labelEvery?: number;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const f = useFormatter(format);
  const fa = useAxisFormatter(format);

  // Con toda la serie en cero no hay escala que dibujar: una única línea base
  // evita un eje de etiquetas repetidas (US$ 0 · US$ 0 · US$ 1…).
  const peak = Math.max(0, ...data.flatMap((d) => d.values));
  const ticks = peak > 0 ? niceTicks(peak) : [0];
  const top = ticks[ticks.length - 1] || 1;
  const tickLabels = ticks.map(fa);

  const pad = { top: 12, right: 8, bottom: 26, left: axisPad(tickLabels) };
  const plotW = Math.max(40, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  const slot = plotW / Math.max(1, data.length);
  const groupW = Math.min(slot * 0.68, 46);
  const gap = 2;
  const barW = Math.max(3, (groupW - gap * (series.length - 1)) / series.length);

  const onMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left - pad.left;
      const idx = Math.floor(x / slot);
      setHover(idx >= 0 && idx < data.length ? idx : null);
    },
    [slot, data.length, pad.left],
  );

  return (
    <div>
      <Legend series={series} />
      <div ref={ref} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg width={width} height={height} role="img" aria-label={series.map((s) => s.name).join(" y ")}>
          {ticks.map((t, ti) => {
            const y = pad.top + plotH - (t / top) * plotH;
            return (
              <g key={t}>
                <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />
                <text x={pad.left - 8} y={y + 3.5} textAnchor="end" fontSize={10.5} fill="var(--text-muted)" className="tabular">
                  {tickLabels[ti]}
                </text>
              </g>
            );
          })}

          {data.map((d, i) => {
            const gx = pad.left + slot * i + (slot - groupW) / 2;
            return (
              <g key={d.label}>
                {hover === i && (
                  <rect x={pad.left + slot * i} y={pad.top} width={slot} height={plotH} fill="var(--surface-2)" opacity={0.75} />
                )}
                {d.values.map((v, si) => {
                  const h = Math.max(v > 0 ? 2 : 0, (v / top) * plotH);
                  const x = gx + si * (barW + gap);
                  const y = pad.top + plotH - h;
                  return (
                    <path
                      key={si}
                      // extremo superior redondeado 4px, base anclada a la línea cero
                      d={`M${x},${y + h} L${x},${y + Math.min(4, h)} Q${x},${y} ${x + Math.min(4, barW / 2)},${y} L${x + barW - Math.min(4, barW / 2)},${y} Q${x + barW},${y} ${x + barW},${y + Math.min(4, h)} L${x + barW},${y + h} Z`}
                      fill={series[si].color}
                      opacity={hover == null || hover === i ? 1 : 0.4}
                    />
                  );
                })}
                {i % labelEvery === 0 && (
                  <text x={pad.left + slot * i + slot / 2} y={height - 8} textAnchor="middle" fontSize={10.5} fill="var(--text-muted)">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={pad.left} x2={width - pad.right} y1={pad.top + plotH} y2={pad.top + plotH} stroke="var(--border-strong)" strokeWidth={1} />
        </svg>

        {hover != null && data[hover] && (
          <Tooltip x={pad.left + slot * hover + slot / 2} y={20} width={width}>
            <p className="mb-1 font-semibold">{data[hover].label}</p>
            {series.map((s, si) => (
              <p key={s.name} className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
                  <span className="h-2 w-2 rounded-[2px]" style={{ background: s.color }} />
                  {s.name}
                </span>
                <span className="font-semibold tabular">{f(data[hover].values[si] ?? 0)}</span>
              </p>
            ))}
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────  Línea / área  ───────────────────────────── */

export function LineChart({
  data,
  series,
  height = 230,
  format = "number",
  area = true,
  labelEvery = 1,
}: {
  data: { label: string; values: number[] }[];
  series: Series[];
  height?: number;
  format?: FormatKey;
  area?: boolean;
  labelEvery?: number;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const f = useFormatter(format);
  const fa = useAxisFormatter(format);

  // Con toda la serie en cero no hay escala que dibujar: una única línea base
  // evita un eje de etiquetas repetidas (US$ 0 · US$ 0 · US$ 1…).
  const peak = Math.max(0, ...data.flatMap((d) => d.values));
  const ticks = peak > 0 ? niceTicks(peak) : [0];
  const top = ticks[ticks.length - 1] || 1;
  const tickLabels = ticks.map(fa);

  const pad = { top: 12, right: 12, bottom: 26, left: axisPad(tickLabels) };
  const plotW = Math.max(40, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const stepX = data.length > 1 ? plotW / (data.length - 1) : 0;

  const px = (i: number) => pad.left + stepX * i;
  const py = (v: number) => pad.top + plotH - (v / top) * plotH;

  const paths = useMemo(
    () =>
      series.map((_, si) => {
        const pts = data.map((d, i) => `${px(i)},${py(d.values[si] ?? 0)}`);
        return {
          line: `M${pts.join(" L")}`,
          area: `M${pad.left},${pad.top + plotH} L${pts.join(" L")} L${px(data.length - 1)},${pad.top + plotH} Z`,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, series, width, height, top],
  );

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - pad.left;
    const idx = Math.round(x / (stepX || 1));
    setHover(idx >= 0 && idx < data.length ? idx : null);
  };

  return (
    <div>
      <Legend series={series} />
      <div ref={ref} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg width={width} height={height} role="img" aria-label={series.map((s) => s.name).join(" y ")}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={i} id={`grad-${i}-${s.color.replace("#", "")}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>

          {ticks.map((t, ti) => {
            const y = py(t);
            return (
              <g key={t}>
                <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />
                <text x={pad.left - 8} y={y + 3.5} textAnchor="end" fontSize={10.5} fill="var(--text-muted)" className="tabular">
                  {tickLabels[ti]}
                </text>
              </g>
            );
          })}

          {area && series.length === 1 && <path d={paths[0].area} fill={`url(#grad-0-${series[0].color.replace("#", "")})`} />}
          {paths.map((p, i) => (
            <path key={i} d={p.line} fill="none" stroke={series[i].color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          ))}

          {hover != null && (
            <>
              <line x1={px(hover)} x2={px(hover)} y1={pad.top} y2={pad.top + plotH} stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="3 3" />
              {series.map((s, si) => (
                <circle key={si} cx={px(hover)} cy={py(data[hover].values[si] ?? 0)} r={4.5} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
              ))}
            </>
          )}

          {data.map((d, i) =>
            i % labelEvery === 0 ? (
              <text key={d.label} x={px(i)} y={height - 8} textAnchor="middle" fontSize={10.5} fill="var(--text-muted)">
                {d.label}
              </text>
            ) : null,
          )}
        </svg>

        {hover != null && (
          <Tooltip x={px(hover)} y={20} width={width}>
            <p className="mb-1 font-semibold">{data[hover].label}</p>
            {series.map((s, si) => (
              <p key={s.name} className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  {s.name}
                </span>
                <span className="font-semibold tabular">{f(data[hover].values[si] ?? 0)}</span>
              </p>
            ))}
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/* ────────────────  Ranking horizontal (magnitud + identidad)  ───────────── */

export function RankingBars({
  items,
  format = "number",
  color = "var(--seq-400)",
  emptyLabel = "Sin datos en el período",
}: {
  items: { label: string; value: number; sub?: string; href?: string; badge?: ReactNode }[];
  format?: FormatKey;
  color?: string;
  emptyLabel?: string;
}) {
  const f = useFormatter(format);
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">{emptyLabel}</p>;

  return (
    <ol className="flex flex-col">
      {items.map((item, i) => (
        <li key={`${item.label}-${i}`} className="group px-4 py-2.5 transition-colors hover:bg-[var(--surface-2)]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="w-4 shrink-0 text-[11px] font-semibold tabular text-[var(--text-muted)]">{i + 1}</span>
              <span className="min-w-0 truncate text-[13px] font-medium" title={item.label}>
                {item.href ? (
                  <a href={item.href} className="hover:text-[var(--brand)] hover:underline">
                    {item.label}
                  </a>
                ) : (
                  item.label
                )}
              </span>
              {item.badge}
            </span>
            <span className="shrink-0 text-[13px] font-semibold tabular">{f(item.value)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
              <div className="h-full rounded-full" style={{ width: `${(item.value / max) * 100}%`, background: color }} />
            </div>
            {item.sub && <span className="shrink-0 text-[11.5px] text-[var(--text-muted)]">{item.sub}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ───────────  Composición: una barra apilada con separadores de 2px  ────── */

export function CompositionBar({
  segments,
  format = "number",
  height = 14,
}: {
  segments: { label: string; value: number; color: string; hint?: string }[];
  format?: FormatKey;
  height?: number;
}) {
  const f = useFormatter(format);
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (!segments.length)
    return <p className="px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">Sin datos en el período</p>;

  return (
    <div>
      <div className="flex w-full gap-[2px] overflow-hidden rounded-full" style={{ height }}>
        {segments.map((s) =>
          s.value > 0 ? (
            <div
              key={s.label}
              className="first:rounded-l-full last:rounded-r-full"
              style={{ width: `${(s.value / Math.max(1, total)) * 100}%`, background: s.color }}
              title={`${s.label}: ${f(s.value)}`}
            />
          ) : null,
        )}
        {total === 0 && <div className="w-full rounded-full bg-[var(--surface-3)]" />}
      </div>
      <ul className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-2 text-[12.5px]">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[var(--text-secondary)]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="shrink-0 font-semibold tabular">{f(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─────────────  Medidor de cumplimiento (una sola cifra + meta)  ────────── */

export function GaugeMeter({
  value,
  target,
  label,
  format = "number",
}: {
  value: number;
  target: number;
  label: string;
  format?: FormatKey;
}) {
  const f = useFormatter(format);
  const pct = target > 0 ? (value / target) * 100 : 0;
  const tone = pct >= 100 ? "var(--good)" : pct >= 85 ? "var(--warning)" : "var(--critical)";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] text-[var(--text-secondary)]">{label}</span>
        <span className="text-[15px] font-semibold tabular" style={{ color: tone }}>
          {pct.toFixed(0).replace(".", ",")}%
        </span>
      </div>
      <div className="relative mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: tone }} />
        {pct > 100 && <div className="absolute inset-y-0 right-0 w-[3px] bg-[var(--good)]" />}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-[var(--text-muted)] tabular">
        <span>Real {f(value)}</span>
        <span>Meta {f(target)}</span>
      </div>
    </div>
  );
}
