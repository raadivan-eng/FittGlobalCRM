import Link from "next/link";

const TABS = [
  { href: "/forecast", label: "Proyección del mes" },
  { href: "/forecast/ejecucion", label: "Forecast vs ejecución" },
  { href: "/forecast/criterio", label: "Criterio" },
];

/** La proyección se edita mes a mes; la ejecución se lee por cliente, producto o ambos; el criterio rige cómo se proyecta todo. */
export function ForecastTabs({ active }: { active: string }) {
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
