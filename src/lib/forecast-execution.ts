import "server-only";
import { prisma } from "./prisma";
import { NOT_VOID, companyForecasts, getForecastCriteria, periodKey, startOfMonth } from "./analytics";
import { criteriaWindow } from "./forecast-criteria";

/** Facturas sin renglones (sin pedido asociado): suman al cliente pero no a un producto. */
export const NO_PRODUCT = "SIN_DETALLE";

export type Cell = {
  companyId: string;
  productId: string;
  forecast: number;
  forecastUnits: number;
  real: number;
  realUnits: number;
};

const periodStart = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1);
};

type Bucket = { amount: number; units: number };
/** cliente → producto → período → venta. */
type Sales = Map<string, Map<string, Map<string, Bucket>>>;

/** La parte de una factura o nota crédito que le toca a un producto. */
export type DocShare = {
  kind: "FACTURA" | "NOTA";
  docId: string;
  number: string;
  /** Factura a la que pertenece el renglón: la propia, o la que afecta la nota crédito. */
  invoiceId: string | null;
  issueDate: Date;
  period: string;
  companyId: string;
  productId: string;
  /** Neto sin IVA del documento completo, en positivo. */
  docNet: number;
  amount: number;
  units: number;
};

type Line = { productId: string; quantity: number; total: number };

/**
 * Lo facturado entre dos fechas, renglón por renglón. Las facturas de Siigo
 * llegan con sus renglones (la sincronización les crea un pedido), y el neto de
 * cada factura se reparte entre ellos para que los descuentos y ajustes de
 * facturación queden dentro de cada producto. Las notas crédito no traen
 * renglones: restan con la mezcla de la factura que afectan, o quedan «sin
 * detalle» si no afectan ninguna. No devuelven unidades.
 */
export async function documentShares(from: Date, to: Date, credits = false): Promise<DocShare[]> {
  const lineSelect = { order: { select: { lines: { select: { productId: true, quantity: true, total: true } } } } };
  const [invoices, notes] = await Promise.all([
    prisma.invoice.findMany({
      where: { issueDate: { gte: from, lt: to }, status: NOT_VOID },
      select: { id: true, number: true, companyId: true, issueDate: true, net: true, ...lineSelect },
    }),
    credits
      ? prisma.creditNote.findMany({
          where: { issueDate: { gte: from, lt: to } },
          select: { id: true, number: true, companyId: true, issueDate: true, net: true, invoiceId: true, invoice: { select: lineSelect } },
        })
      : Promise.resolve([]),
  ]);

  const shares: DocShare[] = [];
  const split = (base: Omit<DocShare, "productId" | "amount" | "units">, lines: Line[], sign: 1 | -1) => {
    const gross = lines.reduce((s, l) => s + l.total, 0);
    if (!lines.length || gross <= 0) {
      shares.push({ ...base, productId: NO_PRODUCT, amount: sign * base.docNet, units: 0 });
      return;
    }
    for (const l of lines)
      shares.push({ ...base, productId: l.productId, amount: (sign * l.total * base.docNet) / gross, units: sign > 0 ? l.quantity : 0 });
  };
  for (const inv of invoices) {
    const base = { kind: "FACTURA" as const, docId: inv.id, number: inv.number, invoiceId: inv.id, issueDate: inv.issueDate, period: periodKey(inv.issueDate), companyId: inv.companyId, docNet: inv.net };
    split(base, inv.order?.lines ?? [], 1);
  }
  for (const n of notes) {
    const base = { kind: "NOTA" as const, docId: n.id, number: n.number, invoiceId: n.invoiceId, issueDate: n.issueDate, period: periodKey(n.issueDate), companyId: n.companyId, docNet: n.net };
    split(base, n.invoice?.order?.lines ?? [], -1);
  }
  return shares;
}

function aggregate(shares: DocShare[]): Sales {
  const sales: Sales = new Map();
  for (const d of shares) {
    let byProduct = sales.get(d.companyId);
    if (!byProduct) sales.set(d.companyId, (byProduct = new Map()));
    let byPeriod = byProduct.get(d.productId);
    if (!byPeriod) byProduct.set(d.productId, (byPeriod = new Map()));
    const b = byPeriod.get(d.period) ?? { amount: 0, units: 0 };
    b.amount += d.amount;
    b.units += d.units;
    byPeriod.set(d.period, b);
  }
  return sales;
}

/**
 * Forecast y ejecución por cliente × producto para cada período pedido.
 *
 * El forecast de cada producto dentro de un cliente es lo que ese cliente le
 * compró en promedio cada mes, con los mismos meses que entraron a la base
 * del cliente según el criterio (companyForecasts). Si al cliente le
 * fijaron un forecast a mano, se reparte con esa mezcla. Así los productos de
 * un cliente siempre suman su forecast, y producto, cliente y total cuadran.
 * Un cliente con forecast manual pero sin historia queda «sin detalle».
 *
 * Con `credits`, la ejecución descuenta las notas crédito; la mezcla del
 * forecast sale siempre de lo facturado, para que no cambie con el filtro.
 */
export async function forecastExecution(periods: string[], credits = false) {
  if (!periods.length) return new Map<string, Map<string, Cell>>();
  const criteria = await getForecastCriteria();
  const windows = periods.map((p) => criteriaWindow(p, criteria));
  const from = new Date(Math.min(...periods.map((p) => periodStart(p).getTime()), ...windows.map((w) => w.from.getTime())));
  const to = startOfMonth(1, periodStart([...periods].sort().at(-1)!));

  const [byClient, shares] = await Promise.all([companyForecasts(periods, undefined, { criteria }), documentShares(from, to, credits)]);
  const sales = aggregate(credits ? shares.filter((d) => d.kind === "FACTURA") : shares);
  const executed = credits ? aggregate(shares) : sales;

  const result = new Map<string, Map<string, Cell>>();
  for (const period of periods) {
    const cells = new Map<string, Cell>();
    const cell = (companyId: string, productId: string) => {
      const key = `${companyId}|${productId}`;
      let c = cells.get(key);
      if (!c) cells.set(key, (c = { companyId, productId, forecast: 0, forecastUnits: 0, real: 0, realUnits: 0 }));
      return c;
    };

    for (const [companyId, f] of byClient.get(period) ?? []) {
      if (f.amount <= 0) continue;
      // Los mismos meses que entraron a la base del cliente según el criterio.
      const span = f.span;

      const mix: { productId: string; amount: number; units: number }[] = [];
      for (const [productId, byPeriod] of sales.get(companyId) ?? []) {
        let amount = 0;
        let units = 0;
        for (const p of span) {
          amount += byPeriod.get(p)?.amount ?? 0;
          units += byPeriod.get(p)?.units ?? 0;
        }
        if (amount > 0) mix.push({ productId, amount: amount / span.length, units: units / span.length });
      }
      const base = mix.reduce((s, m) => s + m.amount, 0);
      if (base <= 0) {
        cell(companyId, NO_PRODUCT).forecast += f.amount;
        continue;
      }
      const scale = f.amount / base;
      for (const m of mix) {
        const c = cell(companyId, m.productId);
        c.forecast += m.amount * scale;
        c.forecastUnits += m.units * scale;
      }
    }

    for (const [companyId, byProduct] of executed) {
      for (const [productId, byPeriod] of byProduct) {
        const b = byPeriod.get(period);
        if (!b) continue;
        const c = cell(companyId, productId);
        c.real += b.amount;
        c.realUnits += b.units;
      }
    }
    result.set(period, cells);
  }
  return result;
}

/**
 * Qué parte del forecast de un período ya debería estar facturada: todo si el
 * mes cerró, nada si no ha empezado y, en el mes en curso, lo proporcional a
 * los días transcurridos. Contra eso se mide el avance de un rango.
 */
export function elapsedShare(period: string, now = new Date()) {
  const start = periodStart(period);
  const current = startOfMonth(0, now);
  if (start < current) return 1;
  if (start > current) return 0;
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return now.getDate() / days;
}

export type ExecutionRow = {
  key: string;
  forecast: number;
  forecastUnits: number;
  /** Forecast que ya debería estar facturado a la fecha. */
  expected: number;
  real: number;
  realUnits: number;
};

/** Suma las celdas de varios períodos agrupando por la clave que se pida. */
export function rollUp(
  byPeriod: Map<string, Map<string, Cell>>,
  periods: string[],
  key: (c: Cell) => string,
  keep: (c: Cell) => boolean = () => true,
  now = new Date(),
) {
  const rows = new Map<string, ExecutionRow>();
  for (const period of periods) {
    const share = elapsedShare(period, now);
    for (const c of byPeriod.get(period)?.values() ?? []) {
      if (!keep(c)) continue;
      const k = key(c);
      const r = rows.get(k) ?? { key: k, forecast: 0, forecastUnits: 0, expected: 0, real: 0, realUnits: 0 };
      r.forecast += c.forecast;
      r.forecastUnits += c.forecastUnits;
      r.expected += c.forecast * share;
      r.real += c.real;
      r.realUnits += c.realUnits;
      rows.set(k, r);
    }
  }
  return rows;
}
