"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { eliminarVista, guardarVista } from "@/lib/actions-views";
import { joinList, splitList } from "@/lib/params";
import { IconBookmark, IconCheck, IconChevronDown, IconSearch, IconTrash, IconX } from "./icons";

type Option = { value: string; label: string };

/**
 * `multi` guarda varios valores separados por coma en la URL; la página los lee
 * con `many()` de src/lib/params.ts.
 */
export type FilterField =
  | { type: "search"; name: string; placeholder?: string; width?: string }
  | { type: "select"; name: string; label: string; options: Option[]; width?: string; multi?: boolean }
  | { type: "date"; name: string; label: string };

export type SavedViewRow = { id: string; path: string; name: string; query: string };

/** Query string comparable: sin paginación y con las claves ordenadas. */
function normalize(query: string) {
  const q = new URLSearchParams(query);
  q.delete("page");
  q.sort();
  return q.toString();
}

export function FilterBar({ fields, extra, views }: { fields: FilterField[]; extra?: React.ReactNode; views: SavedViewRow[] }) {
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
      <SavedViews
        views={views.filter((v) => v.path === pathname)}
        pathname={pathname}
        query={params.toString()}
        open={(q) => startTransition(() => router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false }))}
      />
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
          <SelectFilter key={f.name} field={f} value={params.get(f.name) ?? ""} onChange={(v) => apply(f.name, v)} />
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

/** Minúsculas y sin tildes, para que «aburra» encuentre «Aburrá». */
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Abre y cierra un desplegable: se cierra al hacer clic fuera o con Escape. */
function usePopover(onClose: (reason: "outside" | "escape") => void) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeRef.current("outside");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current("escape");
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const show = () => {
    // Si el panel no cabe a la derecha del botón, se alinea por su borde derecho.
    const left = ref.current?.getBoundingClientRect().left ?? 0;
    setAlignRight(left + 300 > window.innerWidth);
    setOpen(true);
  };

  return { open, show, hide: () => setOpen(false), ref, alignRight };
}

const panelClass = (alignRight: boolean) =>
  `card absolute top-[calc(100%+4px)] z-30 w-[min(18rem,calc(100vw-2rem))] !shadow-[var(--shadow-lg)] ${alignRight ? "right-0" : "left-0"}`;

/**
 * Desplegable con buscador. En modo `multi` muestra casillas y los atajos de
 * seleccionar o deseleccionar todo lo que coincide con la búsqueda; los cambios
 * se aplican al cerrar, para no recargar la página con cada casilla.
 */
function SelectFilter({
  field,
  value,
  onChange,
}: {
  field: Extract<FilterField, { type: "select" }>;
  value: string;
  onChange: (v: string) => void;
}) {
  const multi = Boolean(field.multi);
  const selected = useMemo(() => (multi ? splitList(value) : value ? [value] : []), [multi, value]);
  const allValues = field.options.map((o) => o.value);
  // Sin filtro, en modo múltiple todo cuenta como marcado, igual que en Excel.
  const initialDraft = () => new Set(multi && selected.length === 0 ? allValues : selected);

  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Set<string>>(initialDraft);

  const commit = (set: Set<string>) => {
    const values = allValues.filter((v) => set.has(v));
    // Todo marcado equivale a no filtrar: así la URL no carga cientos de IDs.
    onChange(values.length === allValues.length ? "" : joinList(values));
  };

  const pop = usePopover((reason) => {
    if (multi && reason === "outside" && draft.size > 0) commit(draft);
    pop.hide();
  });

  const toggleOpen = () => {
    if (pop.open) return pop.hide();
    setQuery("");
    setDraft(initialDraft());
    pop.show();
  };

  const needle = fold(query.trim());
  const visible = needle ? field.options.filter((o) => fold(o.label).includes(needle)) : field.options;

  const labelOf = (v: string) => field.options.find((o) => o.value === v)?.label ?? v;
  const buttonText =
    selected.length === 0 ? field.label : selected.length === 1 ? labelOf(selected[0]) : `${field.label} · ${selected.length}`;

  const setVisible = (on: boolean) =>
    setDraft((prev) => {
      const next = new Set(prev);
      for (const o of visible) {
        if (on) next.add(o.value);
        else next.delete(o.value);
      }
      return next;
    });

  const toggle = (v: string) =>
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });

  return (
    <div ref={pop.ref} className={`relative ${field.width ?? "w-auto"}`}>
      <button
        type="button"
        className={`field flex items-center justify-between gap-2 text-left ${selected.length ? "!border-[var(--brand)]" : ""}`}
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={pop.open}
        aria-label={field.label}
      >
        <span className="truncate">{buttonText}</span>
        <IconChevronDown size={14} className="shrink-0 text-[var(--text-muted)]" />
      </button>

      {pop.open && (
        <div className={panelClass(pop.alignRight)}>
          <div className="relative border-b border-[var(--border)] p-2">
            <IconSearch size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              autoFocus
              className="field pl-8"
              placeholder="Buscar…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Enter elige la única coincidencia en modo simple, o aplica en múltiple.
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (!multi && visible.length === 1) {
                  onChange(visible[0].value);
                  pop.hide();
                } else if (multi && draft.size > 0) {
                  commit(draft);
                  pop.hide();
                }
              }}
            />
          </div>

          {multi && (
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-1.5 text-[12.5px]">
              <button type="button" className="font-medium text-[var(--brand)] hover:underline" onClick={() => setVisible(true)}>
                Seleccionar todos
              </button>
              <button type="button" className="font-medium text-[var(--brand)] hover:underline" onClick={() => setVisible(false)}>
                Deseleccionar todos
              </button>
            </div>
          )}

          <ul role="listbox" aria-multiselectable={multi} className="max-h-72 overflow-y-auto py-1">
            {!multi && !needle && (
              <OptionRow
                label={field.label}
                checked={selected.length === 0}
                muted
                onClick={() => {
                  onChange("");
                  pop.hide();
                }}
              />
            )}
            {visible.map((o) => (
              <OptionRow
                key={o.value}
                label={o.label}
                checked={multi ? draft.has(o.value) : selected[0] === o.value}
                checkbox={multi}
                onClick={() => {
                  if (multi) return toggle(o.value);
                  onChange(o.value);
                  pop.hide();
                }}
              />
            ))}
            {visible.length === 0 && <li className="px-3 py-3 text-center text-[12.5px] text-[var(--text-muted)]">Sin coincidencias.</li>}
          </ul>

          {multi && (
            <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-2">
              <span className="text-[12px] text-[var(--text-muted)]">
                {draft.size === 0 ? "Elige al menos uno" : `${draft.size} de ${allValues.length}`}
              </span>
              <button
                type="button"
                className="btn btn-primary !px-3 !py-1 text-[12.5px]"
                disabled={draft.size === 0}
                onClick={() => {
                  commit(draft);
                  pop.hide();
                }}
              >
                Aplicar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OptionRow({ label, checked, checkbox, muted, onClick }: { label: string; checked: boolean; checkbox?: boolean; muted?: boolean; onClick: () => void }) {
  return (
    <li role="option" aria-selected={checked}>
      <button
        type="button"
        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-[var(--surface-2)] ${muted ? "text-[var(--text-muted)]" : ""}`}
        onClick={onClick}
      >
        {checkbox ? (
          <span
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
              checked ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-[var(--border-strong)]"
            }`}
          >
            {checked && <IconCheck size={11} strokeWidth={3} />}
          </span>
        ) : (
          <span className="flex w-4 shrink-0 justify-center text-[var(--brand)]">{checked && <IconCheck size={14} />}</span>
        )}
        <span className="truncate">{label}</span>
      </button>
    </li>
  );
}

/** Vistas guardadas: los filtros de la página con nombre, por usuario. */
function SavedViews({ views, pathname, query, open }: { views: SavedViewRow[]; pathname: string; query: string; open: (q: string) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, startBusy] = useTransition();
  const pop = usePopover(() => pop.hide());

  const current = normalize(query);
  const active = views.find((v) => normalize(v.query) === current);

  const save = () =>
    startBusy(async () => {
      const res = await guardarVista(pathname, name, query);
      if (res.error) return setError(res.error);
      setName("");
      setError("");
    });

  const remove = (id: string) =>
    startBusy(async () => {
      const res = await eliminarVista(id);
      setError(res.error ?? "");
    });

  return (
    <div ref={pop.ref} className="relative">
      <button
        type="button"
        className={`btn btn-secondary !py-[0.44rem] text-[13px] ${active ? "!border-[var(--brand)] text-[var(--brand)]" : ""}`}
        onClick={() => (pop.open ? pop.hide() : (setError(""), pop.show()))}
        aria-expanded={pop.open}
      >
        <IconBookmark size={14} />
        <span className="max-w-40 truncate">{active ? active.name : "Vistas"}</span>
        {!active && views.length > 0 && <span className="text-[var(--text-muted)]">{views.length}</span>}
      </button>

      {pop.open && (
        <div className={panelClass(pop.alignRight)}>
          {views.length === 0 ? (
            <p className="px-3 py-3 text-[12.5px] text-[var(--text-muted)]">
              Aún no tienes vistas en esta página. Ajusta los filtros y guárdalos con un nombre.
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1">
              {views.map((v) => (
                <li key={v.id} className="group flex items-center hover:bg-[var(--surface-2)]">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-[13px]"
                    onClick={() => {
                      open(v.query);
                      pop.hide();
                    }}
                  >
                    <span className="flex w-4 shrink-0 justify-center text-[var(--brand)]">{v === active && <IconCheck size={14} />}</span>
                    <span className="truncate">{v.name}</span>
                  </button>
                  <button
                    type="button"
                    className="mr-1 rounded p-1.5 text-[var(--text-muted)] hover:text-[var(--critical)] disabled:opacity-50"
                    onClick={() => remove(v.id)}
                    disabled={busy}
                    aria-label={`Eliminar la vista ${v.name}`}
                    title="Eliminar"
                  >
                    <IconTrash size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form
            className="border-t border-[var(--border)] p-2"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <p className="mb-1.5 px-1 text-[12px] text-[var(--text-muted)]">
              {active ? "Guardar con otro nombre, o el mismo para reemplazarla" : "Guardar los filtros actuales como"}
            </p>
            <div className="flex gap-1.5">
              <input
                className="field"
                placeholder="Nombre de la vista"
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
              />
              <button type="submit" className="btn btn-primary !px-3 text-[12.5px]" disabled={busy || !name.trim()}>
                Guardar
              </button>
            </div>
            {error && <p className="mt-1.5 px-1 text-[12px] text-[var(--critical)]">{error}</p>}
          </form>
        </div>
      )}
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
