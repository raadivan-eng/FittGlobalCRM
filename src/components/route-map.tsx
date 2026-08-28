"use client";

import { useMemo, useState } from "react";

export type MapPoint = {
  id: string;
  name: string;
  company: string;
  lat: number;
  lng: number;
  score: number;
  sequence?: number;
  arrival?: string;
};

/**
 * Mapa esquemático de la ruta. No usa tiles externos a propósito: proyecta las
 * coordenadas sobre el área disponible, corrigiendo la longitud por el coseno
 * de la latitud para que las distancias relativas no se deformen.
 */
export function RouteMap({
  stops,
  skipped = [],
  origin,
  height = 340,
}: {
  stops: MapPoint[];
  skipped?: MapPoint[];
  origin?: { lat: number; lng: number };
  height?: number;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const all = useMemo(() => [...stops, ...skipped, ...(origin ? [{ ...origin, id: "__origin", name: "Inicio", company: "", score: 0 }] : [])], [stops, skipped, origin]);

  const bounds = useMemo(() => {
    if (!all.length) return null;
    const lats = all.map((p) => p.lat);
    const lngs = all.map((p) => p.lng);
    const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const k = Math.cos((midLat * Math.PI) / 180);
    return {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minX: Math.min(...lngs) * k,
      maxX: Math.max(...lngs) * k,
      k,
    };
  }, [all]);

  if (!bounds || !all.length) {
    return (
      <div className="flex items-center justify-center rounded-lg bg-[var(--surface-2)] text-[13px] text-[var(--text-muted)]" style={{ height }}>
        Sin puntos para mostrar
      </div>
    );
  }

  const pad = 26;
  const W = 640;
  const H = height;
  const spanLat = Math.max(0.0025, bounds.maxLat - bounds.minLat);
  const spanX = Math.max(0.0025, bounds.maxX - bounds.minX);

  const project = (p: { lat: number; lng: number }) => ({
    x: pad + ((p.lng * bounds.k - bounds.minX) / spanX) * (W - pad * 2),
    y: H - pad - ((p.lat - bounds.minLat) / spanLat) * (H - pad * 2),
  });

  const path = stops.map(project);
  const originPt = origin ? project(origin) : null;
  const line = originPt && path.length ? `M${originPt.x},${originPt.y} L${path.map((p) => `${p.x},${p.y}`).join(" L")}` : path.length ? `M${path.map((p) => `${p.x},${p.y}`).join(" L")}` : "";

  const active = hover ? all.find((p) => p.id === hover) : null;
  const activePt = active ? project(active) : null;

  return (
    <div className="relative overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-2)]">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} role="img" aria-label="Mapa esquemático de la ruta">
        <defs>
          <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M32 0H0V32" fill="none" stroke="var(--border)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#grid)" opacity={0.55} />

        {/* Tiendas descartadas: presentes pero recesivas */}
        {skipped.map((p) => {
          const pt = project(p);
          return (
            <circle
              key={p.id}
              cx={pt.x}
              cy={pt.y}
              r={4}
              fill="var(--surface-1)"
              stroke="var(--border-strong)"
              strokeWidth={1.5}
              onMouseEnter={() => setHover(p.id)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}

        {line && <path d={line} fill="none" stroke="var(--brand)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 0" opacity={0.75} />}

        {originPt && (
          <g>
            <circle cx={originPt.x} cy={originPt.y} r={6} fill="var(--surface-1)" stroke="var(--text-muted)" strokeWidth={2} />
            <text x={originPt.x} y={originPt.y - 11} textAnchor="middle" fontSize={9.5} fill="var(--text-muted)">
              inicio
            </text>
          </g>
        )}

        {stops.map((p, i) => {
          const pt = path[i];
          return (
            <g key={p.id} onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }}>
              <circle cx={pt.x} cy={pt.y} r={11} fill="var(--brand)" stroke="var(--surface-1)" strokeWidth={2} />
              <text x={pt.x} y={pt.y + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff">
                {p.sequence ?? i + 1}
              </text>
            </g>
          );
        })}
      </svg>

      {active && activePt && (
        <div
          className="pointer-events-none absolute z-10 max-w-[220px] rounded-lg border border-[var(--border-strong)] bg-[var(--surface-1)] px-2.5 py-1.5 text-[12px] shadow-[var(--shadow-lg)]"
          style={{ left: `${(activePt.x / W) * 100}%`, top: `${(activePt.y / H) * 100}%`, transform: "translate(-50%, -125%)" }}
        >
          <p className="font-semibold">{active.name}</p>
          {active.company && <p className="text-[var(--text-muted)]">{active.company}</p>}
          <p className="mt-0.5 tabular text-[var(--text-secondary)]">
            Prioridad {active.score}
            {active.arrival ? ` · llegada ${active.arrival}` : " · fuera de la jornada"}
          </p>
        </div>
      )}

      <div className="absolute bottom-2 right-2 flex items-center gap-3 rounded-md bg-[var(--surface-1)]/92 px-2 py-1 text-[11px] text-[var(--text-secondary)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--brand)]" /> En ruta
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-[var(--border-strong)] bg-[var(--surface-1)]" /> Fuera de jornada
        </span>
      </div>
    </div>
  );
}
