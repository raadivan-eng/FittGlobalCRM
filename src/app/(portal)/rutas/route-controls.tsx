"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export function RouteControls({
  team, selectedId, lockTeam, hours, maxStops, zone, zones, date,
}: {
  team: { id: string; name: string; zone: string | null }[];
  selectedId: string;
  lockTeam: boolean;
  hours: number;
  maxStops: number;
  zone: string;
  zones: string[];
  date: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  return (
    <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3">
      <Labeled label="Mercaderista">
        <select className="field w-52" value={selectedId} disabled={lockTeam} onChange={(e) => set("mercaderista", e.target.value)}>
          {team.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.zone ? ` — ${t.zone}` : ""}
            </option>
          ))}
        </select>
      </Labeled>

      <Labeled label="Fecha de la ruta">
        <input type="date" className="field w-40" value={date} onChange={(e) => set("fecha", e.target.value)} />
      </Labeled>

      <Labeled label={`Jornada · ${hours} h`}>
        <input type="range" min={2} max={12} step={1} value={hours} className="w-36 accent-[var(--brand)]" onChange={(e) => set("horas", e.target.value)} />
      </Labeled>

      <Labeled label={`Máx. paradas · ${maxStops}`}>
        <input type="range" min={2} max={20} step={1} value={maxStops} className="w-36 accent-[var(--brand)]" onChange={(e) => set("paradas", e.target.value)} />
      </Labeled>

      <Labeled label="Zona">
        <select className="field w-44" value={zone} onChange={(e) => set("zona", e.target.value)}>
          <option value="">Todas las zonas</option>
          {zones.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
      </Labeled>

      {pending && <span className="pb-2 text-[12px] text-[var(--text-muted)]">Recalculando…</span>}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">{label}</span>
      {children}
    </label>
  );
}
