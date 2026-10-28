import "server-only";
import crypto from "node:crypto";
import { prisma } from "./prisma";
import { decryptJson, encryptJson } from "./secrets";
import { asRecord, asText, type Json } from "./http";
import { SiigoLimitError, siigoAuth, siigoGet } from "./siigo";

/**
 * Sincronización de las facturas de venta de Siigo (módulo Facturación).
 *
 * Cada pasada recorre primero las facturas y después las notas crédito, que
 * entran aparte y restan de la facturación en Ventas.
 *
 * Cada factura de Siigo entra como un pedido FACTURADO con sus líneas y su
 * factura, ambos con el número de Siigo (FV-1-123): ese número es la llave para
 * reconocerla en la siguiente pasada y sólo actualizar saldo y estado.
 *
 * Corre por lotes cortos —una página de Siigo por invocación— porque un Worker
 * tiene tope de consultas a D1 y de peticiones salientes por invocación. El
 * avance queda en `ApiConnectionModule.syncCursor`, así que cada lote sigue
 * donde iba el anterior, lo lance el botón o el cron.
 *
 * D1 no tiene transacciones: si un lote se corta a medias, el siguiente
 * reconoce lo que ya entró por número de factura, NIT o SKU y no lo duplica.
 */

/** Primera fecha de factura que se trae; lo anterior queda fuera del portal. */
export const SIIGO_DESDE = "2026-01-01";

/** Facturas por lote: con ~4 líneas cada una, el lote cabe en unas 30 consultas a D1. */
const PAGE_SIZE = 20;
/** D1 acepta hasta 100 parámetros por consulta; se deja margen. */
const MAX_PARAMS = 90;
/** Margen al pedir novedades: lo modificado justo durante la última pasada no se pierde. */
const SOLAPE_MS = 24 * 60 * 60 * 1000;

const NOTA_CLIENTE = "Creado por la sincronización con Siigo: revisa tipo, canal y responsable.";
const POR_REVISAR = "Por revisar";

/** COMPLETA repasa todas las facturas desde SIIGO_DESDE; NOVEDADES, sólo lo modificado desde la última. */
export type SyncMode = "COMPLETA" | "NOVEDADES";

type Cursor = {
  modo: SyncMode;
  /** Qué listado de Siigo se está recorriendo. Sin valor, las facturas. */
  fase?: "FACTURAS" | "NOTAS";
  /** `updated_start` de una pasada de novedades. */
  desde?: string;
  page: number;
  startedAt: string;
  nuevas: number;
  actualizadas: number;
  clientes: number;
  productos: number;
  notas?: number;
  /** Token de Siigo cifrado: vale 24 h y así no se pide uno por lote. */
  token?: string;
  tokenHasta?: number;
};

export type SiigoSyncBatch = {
  done: boolean;
  modo: SyncMode;
  page: number;
  pages: number;
  total: number;
  nuevas: number;
  actualizadas: number;
  clientes: number;
  productos: number;
  notas: number;
  /** Qué listado recorrió este lote. */
  fase: "FACTURAS" | "NOTAS";
  error?: string;
  /** Siigo cortó por cuota: el lote no avanzó y hay que reintentar pasado este tiempo. */
  retryAfterSeconds?: number;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const lista = (v: unknown) => (Array.isArray(v) ? v.map(asRecord) : []);
/** NIT sin dígito de verificación ni separadores: así se cruza el de Siigo con el del portal. */
const nitBase = (v: unknown) => asText(v).split("-")[0].replace(/\D/g, "");
/** Las fechas de Siigo son días sin hora: se fijan al mediodía de Bogotá para que no cambien de día. */
function dia(v: unknown) {
  const s = asText(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00-05:00`) : null;
}

const id = () => crypto.randomUUID();

/** createMany partido para no pasar el tope de parámetros de D1. */
export async function enLotes<T extends object>(filas: T[], crear: (data: T[]) => Promise<unknown>) {
  if (!filas.length) return;
  // +3 por las columnas con valor por defecto que Prisma añade a cada fila.
  const porLote = Math.max(1, Math.floor(MAX_PARAMS / (Object.keys(filas[0]).length + 3)));
  for (let i = 0; i < filas.length; i += porLote) await crear(filas.slice(i, i + porLote));
}

function leerCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Cursor;
  } catch {
    return null;
  }
}

function nuevoCursor(modo: SyncMode, ultima: Date | null): Cursor {
  const desde = modo === "NOVEDADES" && ultima ? new Date(ultima.getTime() - SOLAPE_MS).toISOString().slice(0, 19) + "Z" : undefined;
  return {
    modo: desde ? "NOVEDADES" : "COMPLETA",
    desde,
    page: 1,
    startedAt: new Date().toISOString(),
    nuevas: 0,
    actualizadas: 0,
    clientes: 0,
    productos: 0,
  };
}

async function tokenVigente(c: Cursor, usuario: string, accessKey: string, partnerId: string) {
  const guardado = c.token && (c.tokenHasta ?? 0) > Date.now() + 10 * 60_000 ? decryptJson(c.token)?.token : undefined;
  if (guardado) return guardado;
  const auth = await siigoAuth(usuario, accessKey, partnerId);
  c.token = encryptJson({ token: auth.token });
  c.tokenHasta = Date.now() + (auth.expiresInSeconds || 3600) * 1000;
  return auth.token;
}

/** Nombre, NIT completo y ciudad de un tercero de Siigo. Si no se puede leer, queda un nombre provisional. */
async function clienteSiigo(token: string, partnerId: string, nit: string) {
  try {
    const body = await siigoGet(token, partnerId, "/v1/customers", { identification: nit });
    const c = lista(body.results)[0] ?? {};
    const partes = Array.isArray(c.name) ? c.name.map(asText) : [asText(c.name)];
    const nombre = partes.filter(Boolean).join(" ").trim() || asText(c.commercial_name);
    const dv = asText(c.check_digit);
    const ciudad = asText(asRecord(asRecord(c.address).city).city_name);
    return { name: nombre || `Cliente Siigo ${nit}`, taxId: dv ? `${nit}-${dv}` : nit, city: ciudad || null };
  } catch (e) {
    if (e instanceof SiigoLimitError) throw e;
    return { name: `Cliente Siigo ${nit}`, taxId: nit, city: null };
  }
}

/**
 * Clientes de un lote de documentos, por NIT: se cruzan con el portal y los que
 * no existen se crean con los datos del tercero en Siigo.
 */
async function empresasPorNit(documentos: Json[], token: string, partnerId: string, conteo: { clientes: number }) {
  const empresas = await prisma.company.findMany({
    where: { taxId: { not: null } },
    select: { id: true, taxId: true, paymentTermDays: true },
  });
  const porNit = new Map(empresas.map((c) => [nitBase(c.taxId), c]));
  const faltan = [...new Set(documentos.map((f) => nitBase(asRecord(f.customer).identification)))].filter((n) => !porNit.has(n));
  if (faltan.length) {
    const nuevas = [];
    for (const nit of faltan) {
      const datos = await clienteSiigo(token, partnerId, nit);
      nuevas.push({ id: id(), code: `SIIGO-${nit}`, type: "INDEPENDIENTE", channel: "TRADICIONAL", notes: NOTA_CLIENTE, ...datos });
    }
    // Un cliente creado por un lote que se cortó ya tiene su código, aunque su NIT no case.
    const yaCreados = new Set(
      (await prisma.company.findMany({ where: { code: { in: nuevas.map((c) => c.code) } }, select: { code: true } })).map((c) => c.code),
    );
    const crear = nuevas.filter((c) => !yaCreados.has(c.code));
    await enLotes(crear, (data) => prisma.company.createMany({ data }));
    conteo.clientes = crear.length;
    for (const c of await prisma.company.findMany({
      where: { code: { in: nuevas.map((n) => n.code) } },
      select: { id: true, code: true, paymentTermDays: true },
    })) {
      porNit.set(c.code.slice("SIIGO-".length), { id: c.id, taxId: null, paymentTermDays: c.paymentTermDays });
    }
  }

  return porNit;
}

type Conteo = { nuevas: number; actualizadas: number; clientes: number; productos: number };

/** Valor antes de IVA de los ítems de un documento de Siigo, con el descuento de cada línea. */
function netoItems(items: Json[]) {
  return round2(items.reduce((s, i) => s + num(i.quantity) * num(i.price) * (1 - num(asRecord(i.discount).percentage) / 100), 0));
}

/**
 * Notas crédito: se reconocen por número (NC-1-23). Si Siigo cambia una ya
 * importada, se actualizan sus valores; la factura afectada se cruza por número.
 */
async function importarNotas(notas: Json[], token: string, partnerId: string, conteo: { clientes: number }) {
  const validas = notas.filter((n) => asText(n.name) && dia(n.date) && nitBase(asRecord(n.customer).identification));
  if (!validas.length) return 0;
  const porNit = await empresasPorNit(validas, token, partnerId, conteo);

  const numerosFactura = [...new Set(validas.map((n) => asText(asRecord(n.invoice).name)).filter(Boolean))];
  const facturas = new Map(
    (await prisma.invoice.findMany({ where: { number: { in: numerosFactura } }, select: { id: true, number: true } })).map((i) => [i.number, i.id]),
  );
  const existentes = new Map(
    (
      await prisma.creditNote.findMany({
        where: { number: { in: validas.map((n) => asText(n.name)) } },
        select: { id: true, number: true, net: true, total: true, invoiceId: true, issueDate: true },
      })
    ).map((n) => [n.number, n]),
  );

  const nuevas = [];
  for (const n of validas) {
    const numero = asText(n.name);
    const items = lista(n.items);
    const net = netoItems(items);
    const tax = round2(items.reduce((s, i) => s + lista(i.taxes).reduce((t, x) => t + num(x.value), 0), 0));
    const datos = {
      companyId: porNit.get(nitBase(asRecord(n.customer).identification))!.id,
      invoiceId: facturas.get(asText(asRecord(n.invoice).name)) ?? null,
      issueDate: dia(n.date)!,
      net,
      total: num(n.total) || round2(net + tax),
      reason: asText(n.observations).trim() || null,
    };
    const previa = existentes.get(numero);
    if (!previa) {
      nuevas.push({ id: id(), number: numero, ...datos });
    } else if (
      previa.net !== datos.net ||
      previa.total !== datos.total ||
      previa.invoiceId !== datos.invoiceId ||
      previa.issueDate.getTime() !== datos.issueDate.getTime()
    ) {
      await prisma.creditNote.updateMany({ where: { id: previa.id }, data: datos });
    }
  }
  await enLotes(nuevas, (data) => prisma.creditNote.createMany({ data }));
  return nuevas.length;
}

async function importar(facturas: Json[], token: string, partnerId: string): Promise<Conteo> {
  const conteo: Conteo = { nuevas: 0, actualizadas: 0, clientes: 0, productos: 0 };
  const validas = facturas.filter((f) => asText(f.name) && dia(f.date) && nitBase(asRecord(f.customer).identification));
  if (!validas.length) return conteo;

  const porNit = await empresasPorNit(validas, token, partnerId, conteo);

  // Productos: el código de Siigo es el SKU del portal; los que no existen quedan por revisar.
  const items = validas.flatMap((f) => lista(f.items));
  const codigos = [...new Set(items.map((i) => asText(i.code).trim()).filter(Boolean))];
  const porSku = new Map<string, string>();
  for (let i = 0; i < codigos.length; i += 80) {
    for (const p of await prisma.product.findMany({ where: { sku: { in: codigos.slice(i, i + 80) } }, select: { id: true, sku: true } })) {
      porSku.set(p.sku, p.id);
    }
  }
  const productosNuevos = codigos
    .filter((code) => !porSku.has(code))
    .map((sku) => {
      const item = items.find((i) => asText(i.code).trim() === sku)!;
      return { id: id(), sku, name: asText(item.description).trim() || sku, brand: POR_REVISAR, category: POR_REVISAR, unitPrice: num(item.price), unitCost: 0 };
    });
  await enLotes(productosNuevos, (data) => prisma.product.createMany({ data }));
  for (const p of productosNuevos) porSku.set(p.sku, p.id);
  conteo.productos = productosNuevos.length;

  const existentes = new Map(
    (
      await prisma.salesOrder.findMany({
        where: { number: { in: validas.map((f) => asText(f.name)) } },
        select: { id: true, number: true, status: true, invoice: { select: { id: true, status: true, paidAmount: true, total: true, dueDate: true } } },
      })
    ).map((o) => [o.number, o]),
  );

  const hoy = new Date();
  const pedidos = [];
  const lineas = [];
  const facturasNuevas = [];

  for (const f of validas) {
    const numero = asText(f.name);
    const empresa = porNit.get(nitBase(asRecord(f.customer).identification))!;
    const fecha = dia(f.date)!;

    const lineasDe = lista(f.items)
      .filter((i) => porSku.has(asText(i.code).trim()))
      .map((i) => {
        const quantity = num(i.quantity);
        const unitPrice = num(i.price);
        const discountPct = num(asRecord(i.discount).percentage);
        return {
          productId: porSku.get(asText(i.code).trim())!,
          quantity: Math.round(quantity),
          unitPrice,
          discountPct,
          total: round2(quantity * unitPrice * (1 - discountPct / 100)),
          bruto: quantity * unitPrice,
          iva: lista(i.taxes).reduce((s, t) => s + num(t.value), 0),
        };
      });
    const subtotal = round2(lineasDe.reduce((s, l) => s + l.bruto, 0));
    const neto = round2(lineasDe.reduce((s, l) => s + l.total, 0));
    const tax = round2(lineasDe.reduce((s, l) => s + l.iva, 0));
    const total = num(f.total) || round2(neto + tax);
    const saldo = f.balance == null ? total : num(f.balance);
    const paidAmount = round2(Math.max(0, total - saldo));

    const vencimientos = lista(f.payments)
      .map((p) => dia(p.due_date))
      .filter((d): d is Date => Boolean(d));
    const dueDate = vencimientos.length
      ? new Date(Math.max(...vencimientos.map((d) => d.getTime())))
      : new Date(fecha.getTime() + empresa.paymentTermDays * 86_400_000);

    const anulada = f.annulled === true;
    const estadoFactura = anulada ? "ANULADA" : saldo <= 1 ? "PAGADA" : dueDate < hoy ? "VENCIDA" : paidAmount > 0 ? "PARCIAL" : "EMITIDA";
    const estadoPedido = anulada ? "ANULADO" : "FACTURADO";

    const previo = existentes.get(numero);
    if (previo) {
      // Ya entró: sólo cambian el saldo, el vencimiento y la anulación. Las líneas de una factura emitida no cambian.
      if (previo.status !== estadoPedido) await prisma.salesOrder.updateMany({ where: { id: previo.id }, data: { status: estadoPedido } });
      const inv = previo.invoice;
      if (!inv) {
        facturasNuevas.push({ id: id(), number: numero, orderId: previo.id, companyId: empresa.id, issueDate: fecha, dueDate, net: neto, total, paidAmount, status: estadoFactura });
        conteo.actualizadas++;
      } else if (inv.status !== estadoFactura || inv.paidAmount !== paidAmount || inv.total !== total || inv.dueDate.getTime() !== dueDate.getTime()) {
        await prisma.invoice.updateMany({ where: { id: inv.id }, data: { status: estadoFactura, paidAmount, total, dueDate } });
        conteo.actualizadas++;
      }
      continue;
    }

    const orderId = id();
    pedidos.push({
      id: orderId,
      number: numero,
      companyId: empresa.id,
      date: fecha,
      status: estadoPedido,
      subtotal,
      discount: round2(subtotal - neto),
      net: neto,
      tax,
      total,
      notes: asText(f.observations).trim() || null,
    });
    for (const l of lineasDe) {
      lineas.push({ id: id(), orderId, productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, total: l.total });
    }
    facturasNuevas.push({ id: id(), number: numero, orderId, companyId: empresa.id, issueDate: fecha, dueDate, net: neto, total, paidAmount, status: estadoFactura });
    conteo.nuevas++;
  }

  // En este orden por las llaves foráneas.
  await enLotes(pedidos, (data) => prisma.salesOrder.createMany({ data }));
  await enLotes(lineas, (data) => prisma.salesOrderLine.createMany({ data }));
  await enLotes(facturasNuevas, (data) => prisma.invoice.createMany({ data }));
  return conteo;
}

/**
 * Procesa una página de facturas y deja anotado el avance. `modo` sólo cuenta
 * al arrancar: si hay una pasada a medias, se continúa esa.
 */
export async function siigoSyncBatch(opts: { userId: string | null; modo: SyncMode }): Promise<SiigoSyncBatch> {
  const row = await prisma.apiConnection.findUnique({ where: { provider: "SIIGO" }, include: { modules: true } });
  const mod = row?.modules.find((m) => m.module === "FACTURACION");
  const secretos = decryptJson(row?.secretCipher);

  const cursor = leerCursor(mod?.syncCursor ?? null) ?? nuevoCursor(opts.modo, mod?.lastSyncAt ?? null);
  const resultado = (extra: Partial<SiigoSyncBatch>): SiigoSyncBatch => ({
    done: false,
    modo: cursor.modo,
    page: cursor.page,
    pages: 0,
    total: 0,
    nuevas: cursor.nuevas,
    actualizadas: cursor.actualizadas,
    clientes: cursor.clientes,
    productos: cursor.productos,
    notas: cursor.notas ?? 0,
    fase: cursor.fase ?? "FACTURAS",
    ...extra,
  });

  if (!row || !mod || !row.account || !secretos?.secret) return resultado({ done: true, error: "Siigo no tiene credenciales guardadas." });
  if (!mod.enabled || !mod.partnerId) return resultado({ done: true, error: "El módulo Facturación de Siigo está apagado o sin Partner-ID." });

  const guardar = (data: { syncCursor: string | null; lastSyncAt?: Date; lastDetail?: string; lastError?: string | null }) =>
    prisma.apiConnectionModule.update({ where: { id: mod.id }, data });

  try {
    const token = await tokenVigente(cursor, row.account, secretos.secret, mod.partnerId);
    const query: Record<string, string> = { date_start: SIIGO_DESDE, page: String(cursor.page), page_size: String(PAGE_SIZE) };
    if (cursor.modo === "NOVEDADES" && cursor.desde) query.updated_start = cursor.desde;

    const enNotas = cursor.fase === "NOTAS";
    const body = await siigoGet(token, mod.partnerId, enNotas ? "/v1/credit-notes" : "/v1/invoices", query);
    const documentos = lista(body.results);
    const total = num(asRecord(body.pagination).total_results) || documentos.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    if (enNotas) {
      const conteo = { clientes: 0 };
      cursor.notas = (cursor.notas ?? 0) + (await importarNotas(documentos, token, mod.partnerId, conteo));
      cursor.clientes += conteo.clientes;
    } else {
      const conteo = await importar(documentos, token, mod.partnerId);
      cursor.nuevas += conteo.nuevas;
      cursor.actualizadas += conteo.actualizadas;
      cursor.clientes += conteo.clientes;
      cursor.productos += conteo.productos;
    }

    const page = cursor.page;
    if (documentos.length === PAGE_SIZE && page < pages) {
      cursor.page++;
      await guardar({ syncCursor: JSON.stringify(cursor) });
      return resultado({ page, pages, total });
    }
    // Terminadas las facturas, el siguiente lote empieza las notas crédito.
    if (!enNotas) {
      cursor.fase = "NOTAS";
      cursor.page = 1;
      await guardar({ syncCursor: JSON.stringify(cursor) });
      return resultado({ page, pages, total, fase: "FACTURAS" });
    }

    const partes = [
      cursor.modo === "COMPLETA" ? "Facturas desde enero de 2026" : "Facturas con cambios",
      `${cursor.nuevas} nuevas`,
      `${cursor.actualizadas} actualizadas`,
    ];
    if (cursor.notas) partes.push(`${cursor.notas} notas crédito`);
    if (cursor.clientes) partes.push(`${cursor.clientes} clientes creados`);
    if (cursor.productos) partes.push(`${cursor.productos} productos por revisar`);
    const detalle = partes.join(" · ");
    // La próxima pasada de novedades parte de cuando arrancó esta, no de cuando terminó.
    await guardar({ syncCursor: null, lastSyncAt: new Date(cursor.startedAt), lastDetail: detalle, lastError: null });
    await prisma.apiConnectionEvent.create({
      data: {
        connectionId: row.id,
        action: cursor.modo === "COMPLETA" ? "Sincronización completa de facturas" : "Sincronización de facturas nuevas",
        result: "OK",
        detail: detalle,
        userId: opts.userId,
        durationMs: Date.now() - new Date(cursor.startedAt).getTime(),
      },
    });
    return resultado({ done: true, page, pages, total });
  } catch (e) {
    if (e instanceof SiigoLimitError) {
      await guardar({ syncCursor: JSON.stringify(cursor) });
      return resultado({ retryAfterSeconds: e.retryAfterSeconds });
    }
    // El avance se conserva: el siguiente intento reintenta esta misma página.
    const mensaje = e instanceof Error ? e.message : "Fallo desconocido";
    await guardar({ syncCursor: JSON.stringify(cursor), lastError: `Sincronización detenida en la página ${cursor.page}: ${mensaje}` });
    await prisma.apiConnectionEvent.create({
      data: { connectionId: row.id, action: "Sincronización de facturas", result: "FALLO", detail: `Página ${cursor.page} · ${mensaje}`, userId: opts.userId },
    });
    return resultado({ error: mensaje });
  }
}
