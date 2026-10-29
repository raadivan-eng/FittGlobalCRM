"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  IconAlert, IconBell, IconCart, IconClients, IconCompass, IconContacts, IconDashboard, IconExpiry, IconForecast, IconLead,
  IconMegaphone, IconMenu, IconOrder, IconPlug, IconReceive, IconRotation, IconShield, IconProduct, IconQuote, IconReports, IconFactory, IconRoute, IconSales, IconStore,
  IconTeam, IconTruck, IconVisit, IconX,
} from "./icons";
import { BrandTile } from "./brand-mark";

type Item = { section: string; href: string; label: string; Icon: typeof IconDashboard };

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Gerencia",
    items: [{ section: "gerencia", href: "/gerencia", label: "Tablero gerencial", Icon: IconCompass }],
  },
  {
    title: "Comercial",
    items: [
      { section: "dashboard", href: "/", label: "Panel", Icon: IconDashboard },
      { section: "avisos", href: "/avisos", label: "Avisos", Icon: IconBell },
      { section: "leads", href: "/leads", label: "Leads", Icon: IconLead },
      { section: "clientes", href: "/clientes", label: "Clientes", Icon: IconClients },
      { section: "contactos", href: "/contactos", label: "Contactos", Icon: IconContacts },
      { section: "tiendas", href: "/tiendas", label: "Tiendas", Icon: IconStore },
    ],
  },
  {
    title: "Operación en calle",
    items: [
      { section: "rutas", href: "/rutas", label: "Planificador de rutas", Icon: IconRoute },
      { section: "visitas", href: "/visitas", label: "Visitas", Icon: IconVisit },
      { section: "novedades", href: "/novedades", label: "Novedades", Icon: IconAlert },
      { section: "guias", href: "/guias", label: "Guías de envío", Icon: IconTruck },
      { section: "equipo", href: "/equipo", label: "Equipo de campo", Icon: IconTeam },
    ],
  },
  {
    title: "Bodega",
    items: [
      { section: "productos", href: "/productos", label: "Productos", Icon: IconProduct },
      { section: "inventario", href: "/inventario", label: "Inventario y vencimientos", Icon: IconExpiry },
      { section: "ingresos", href: "/ingresos", label: "Ingresos de mercancía", Icon: IconReceive },
    ],
  },
  {
    title: "Compras",
    items: [
      { section: "proveedores", href: "/cotizaciones", label: "Cotizaciones", Icon: IconQuote },
      { section: "proveedores", href: "/proveedores", label: "Proveedores", Icon: IconFactory },
      { section: "compras", href: "/compras", label: "Forecast de compras", Icon: IconCart },
      { section: "compras", href: "/ordenes-compra", label: "Órdenes de compra", Icon: IconOrder },
    ],
  },
  {
    title: "Resultados",
    items: [
      { section: "ventas", href: "/ventas", label: "Ventas y facturación", Icon: IconSales },
      { section: "forecast", href: "/forecast", label: "Forecast", Icon: IconForecast },
      { section: "reportes", href: "/reportes", label: "Reportes", Icon: IconReports },
    ],
  },
  {
    title: "Trade",
    items: [
      { section: "sellout", href: "/sell-out", label: "Sell out", Icon: IconRotation },
      { section: "trade", href: "/trade", label: "Actividades de trade", Icon: IconMegaphone },
    ],
  },
  {
    title: "Sistema",
    items: [
      { section: "conexiones", href: "/conexiones", label: "Conexiones API", Icon: IconPlug },
      { section: "usuarios", href: "/usuarios", label: "Usuarios y permisos", Icon: IconShield },
    ],
  },
];

/** `badges`: contador junto a una sección (avisos sin leer), por clave de sección. */
export function Sidebar({ allowed, footer, badges = {} }: { allowed: string[]; footer: React.ReactNode; badges?: Record<string, number> }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const nav = (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {GROUPS.map((group) => {
        const items = group.items.filter((i) => allowed.includes(i.section));
        if (!items.length) return null;
        return (
          <div key={group.title}>
            <p className="mb-1.5 px-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              {group.title}
            </p>
            <ul className="flex flex-col gap-0.5">
              {items.map(({ section, href, label, Icon }) => {
                const active = isActive(href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-2.5 rounded-lg px-2 py-[7px] text-[13px] transition-colors ${
                        active
                          ? "bg-[var(--brand-soft)] font-semibold text-[var(--brand-ink)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      <Icon size={16} className="shrink-0" />
                      <span className="truncate">{label}</span>
                      {badges[section] > 0 && (
                        <span className="ml-auto rounded-full bg-[var(--brand)] px-1.5 text-[10.5px] font-semibold leading-[17px] text-[var(--text-inverse)] tabular">
                          {badges[section] > 99 ? "99+" : badges[section]}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Disparador móvil */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-secondary fixed left-3 top-3 z-40 h-9 w-9 !px-0 lg:hidden"
        aria-label="Abrir menú"
      >
        <IconMenu size={17} />
      </button>

      {open && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col border-r border-[var(--border)] bg-[var(--surface-1)] transition-transform lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3.5">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandTile size={28} />
            <span className="leading-tight">
              <span className="block text-[13.5px] font-semibold">Fitt Global</span>
              <span className="block text-[10.5px] text-[var(--text-muted)]">Portal administrativo</span>
            </span>
          </Link>
          <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost h-7 w-7 !px-0 lg:hidden" aria-label="Cerrar menú">
            <IconX size={16} />
          </button>
        </div>
        {nav}
        <div className="border-t border-[var(--border)] p-3">{footer}</div>
      </aside>
    </>
  );
}
