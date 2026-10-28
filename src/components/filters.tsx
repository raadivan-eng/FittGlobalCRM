"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { IconSearch, IconX } from "./icons";

export type FilterField =
  | { type: "search"; name: string; placeholder?: string; width?: string }
  | { type: "select"; name: string; label: string; options: { value: string; label: string }[]; width?: string }
  | { type: "date"; name: string; label: string };

/**
 * Barra de filtros sincronizada con la URL: el estado vive en la query string,
 * así los filtros son compartibles y sobreviven a recargar la página.
 */
export function Filters({ fields, extra }: { fields: FilterField[]; extra?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const apply = (name: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  const activeCount = fields.filter((f) => params.get(f.name)).length;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {fields.map((f) =>
        f.type === "date" ? (
          <label key={f.name} className="flex items-center gap-1.5 text-[12.5px] text-[var(--text-muted)]">
            {f.label}
            <input
              type="date"
              className="field w-auto"
              value={params.get(f.name) ?? ""}
              onChange={(e) => apply(f.name, e.target.value)}
            />
          </label>
        ) : f.type === "search" ? (
          <SearchInput
            key={f.name}
            value={params.get(f.name) ?? ""}
            placeholder={f.placeholder ?? "Buscar…"}
            onChange={(v) => apply(f.name, v)}
            width={f.width ?? "w-full sm:w-64"}
          />
        ) : (
          <select
            key={f.name}
            className={`field ${f.width ?? "w-auto"}`}
            value={params.get(f.name) ?? ""}
            onChange={(e) => apply(f.name, e.target.value)}
            aria-label={f.label}
          >
            <option value="">{f.label}</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ),
      )}
      {extra}
      {activeCount > 0 && (
        <button
          type="button"
          className="btn btn-ghost !px-2 text-[12.5px]"
          onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))}
        >
          <IconX size={13} /> Limpiar
        </button>
      )}
      {pending && <span className="text-[12px] text-[var(--text-muted)]">Actualizando…</span>}
    </div>
  );
}

function SearchInput({ value, placeholder, onChange, width }: { value: string; placeholder: string; onChange: (v: string) => void; width: string }) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setLocal(value), [value]);

  const handle = (v: string) => {
    setLocal(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(v), 280);
  };

  return (
    <div className={`relative ${width}`}>
      <IconSearch size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
      <input className="field pl-8" placeholder={placeholder} value={local} onChange={(e) => handle(e.target.value)} />
    </div>
  );
}
