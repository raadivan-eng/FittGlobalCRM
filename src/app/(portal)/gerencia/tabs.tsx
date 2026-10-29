import Link from "next/link";

const TABS = [
  { href: "/gerencia", label: "Tablero" },
  { href: "/gerencia/resultados", label: "Estado de resultados" },
];

/** Las dos lecturas de Gerencia: la operativa del CRM y la contable. */
export function GerenciaTabs({ active }: { active: string }) {
  return (
    <nav className="mb-4 flex flex-wrap gap-2">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={`btn ${active === t.href ? "btn-primary" : "btn-secondary"} !py-1 text-[12.5px]`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
