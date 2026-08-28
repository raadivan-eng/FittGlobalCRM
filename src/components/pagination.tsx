import Link from "next/link";
import { IconChevronRight } from "./icons";

export function Pagination({ page, pageCount, total, params, basePath }: { page: number; pageCount: number; total: number; params: Record<string, string | undefined>; basePath: string }) {
  if (pageCount <= 1) return <p className="border-t border-[var(--border)] px-4 py-2.5 text-[12px] text-[var(--text-muted)]">{total} registros</p>;

  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") q.set(k, v);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  return (
    <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-2.5">
      <p className="text-[12px] text-[var(--text-muted)]">
        Página {page} de {pageCount} · {total} registros
      </p>
      <div className="flex items-center gap-1.5">
        {page > 1 && (
          <Link href={href(page - 1)} className="btn btn-secondary !px-2.5 text-[12.5px]">
            <IconChevronRight size={13} className="rotate-180" /> Anterior
          </Link>
        )}
        {page < pageCount && (
          <Link href={href(page + 1)} className="btn btn-secondary !px-2.5 text-[12.5px]">
            Siguiente <IconChevronRight size={13} />
          </Link>
        )}
      </div>
    </div>
  );
}
