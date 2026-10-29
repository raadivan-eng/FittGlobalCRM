const money = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const moneyPrecise = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const number = new Intl.NumberFormat("es-CO");

export const fmtMoney = (v: number) => money.format(v || 0);
export const fmtMoneyPrecise = (v: number) => moneyPrecise.format(v || 0);
export const fmtNumber = (v: number) => number.format(v || 0);

/** Compacta cifras grandes para tarjetas KPI: 1 240 000 → $1,24 M */
export function fmtCompact(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(2).replace(".", ",")} M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(1).replace(".", ",")} K`;
  return money.format(v || 0);
}

export const fmtPct = (v: number, digits = 1) =>
  `${v >= 0 ? "" : "−"}${Math.abs(v).toFixed(digits).replace(".", ",")}%`;

export const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export const fmtDateShort = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("es-CO", { day: "2-digit", month: "short" }) : "—";

export const fmtDateTime = (d: Date | string | null | undefined) =>
  d
    ? new Date(d).toLocaleString("es-CO", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export const fmtTime = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) : "—";

export function fmtPeriod(period: string) {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-CO", { month: "long", year: "numeric" });
}

/** Plata escrita a mano: el punto es separador de miles y la coma, de decimales. Vacío → null. */
export function parseAmount(raw: string) {
  const s = raw.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
  const v = Number(s);
  return s === "" || !Number.isFinite(v) ? null : v;
}

/** Porcentaje escrito a mano: acepta coma o punto decimal («32,5» o «32.5»). Vacío → null. */
export function parsePct(raw: string) {
  const s = raw.replace(/[^\d.,-]/g, "").replace(",", ".");
  const v = Number(s);
  return s === "" || !Number.isFinite(v) ? null : v;
}

export function daysBetween(from: Date, to: Date) {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export function relativeDays(days: number) {
  if (days === 0) return "hoy";
  if (days === 1) return "hace 1 día";
  if (days < 0) return `en ${Math.abs(days)} días`;
  return `hace ${days} días`;
}

export const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
