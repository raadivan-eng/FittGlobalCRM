import "server-only";
import crypto from "node:crypto";
import { prisma } from "./prisma";
import { asRecord, asText } from "./http";
import { SiigoLimitError, siigoAuth, siigoGet } from "./siigo";
import { moduloClientes } from "./siigo-clientes";
import { enLotes } from "./siigo-sync";

/**
 * Trae a Proveedores los terceros que en Siigo ya son proveedores (módulo
 * Clientes: los terceros de Siigo llevan `type` Customer, Supplier u Other).
 *
 * Va por páginas, una por invocación, por los topes de D1 y de peticiones de un
 * Worker: el botón la llama en bucle con la página siguiente. Cada proveedor se
 * cruza por NIT, así que repetir la importación —completa o tras un corte— sólo
 * enlaza y nunca duplica. Lo que ya está en el portal no se pisa: sólo se le
 * completa el id de Siigo y los datos que tenga vacíos.
 */

const PAGE_SIZE = 100;

export type SupplierImportBatch = {
  done: boolean;
  page: number;
  pages: number;
  /** Terceros revisados en esta página, de cualquier tipo. */
  revisados: number;
  nuevos: number;
  enlazados: number;
  error?: string;
  retryAfterSeconds?: number;
};

const lista = (v: unknown) => (Array.isArray(v) ? v.map(asRecord) : []);
/** NIT sin dígito de verificación ni separadores: así se cruza el de Siigo con el del portal. */
export const nitBase = (v: unknown) => asText(v).split("-")[0].replace(/\D/g, "");

/** Siguiente número de PR-###; el índice único decide si dos altas chocan. */
export async function siguienteNumeroProveedor() {
  const codes = await prisma.supplier.findMany({ where: { code: { startsWith: "PR-" } }, select: { code: true } });
  return codes.reduce((m, c) => Math.max(m, Number(c.code.slice(3)) || 0), 0) + 1;
}

export const codigoProveedor = (n: number) => `PR-${String(n).padStart(3, "0")}`;

/** Lo que el portal guarda de un tercero de Siigo. */
function leerTercero(t: Record<string, unknown>) {
  const partes = Array.isArray(t.name) ? t.name.map(asText) : [asText(t.name)];
  const nombre = partes.filter(Boolean).join(" ").trim() || asText(t.commercial_name).trim();
  const nit = nitBase(t.identification);
  const dv = asText(t.check_digit);
  const direccion = asRecord(t.address);
  const contacto = lista(t.contacts)[0] ?? {};
  const fono = lista(t.phones)[0];
  const contactName = [asText(contacto.first_name), asText(contacto.last_name)].filter(Boolean).join(" ").trim();
  return {
    siigoId: asText(t.id),
    nit,
    name: nombre || `Proveedor Siigo ${nit}`,
    taxId: dv ? `${nit}-${dv}` : nit,
    city: asText(asRecord(direccion.city).city_name) || null,
    address: asText(direccion.address) || null,
    phone: fono ? asText(fono.number) || null : null,
    email: asText(contacto.email).toLowerCase() || null,
    contactName: contactName || null,
    active: t.active !== false,
  };
}

/** Procesa una página de terceros de Siigo y crea o enlaza los proveedores que traiga. */
export async function importSuppliersBatch(page: number, userId: string): Promise<SupplierImportBatch> {
  const resultado = (extra: Partial<SupplierImportBatch>): SupplierImportBatch => ({
    done: false, page, pages: 0, revisados: 0, nuevos: 0, enlazados: 0, ...extra,
  });
  const modulo = await moduloClientes();
  if (!modulo) return resultado({ done: true, error: "El módulo Clientes de Siigo no está activo o no tiene Partner-ID: configúralo en Conexiones API." });

  const inicio = Date.now();
  try {
    const { token } = await siigoAuth(modulo.usuario, modulo.accessKey, modulo.partnerId);
    const body = await siigoGet(token, modulo.partnerId, "/v1/customers", { page: String(page), page_size: String(PAGE_SIZE) });
    const terceros = lista(body.results);
    const total = Number(asRecord(body.pagination).total_results) || terceros.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const proveedores = terceros
      .filter((t) => asText(t.type) === "Supplier")
      .map(leerTercero)
      .filter((p) => p.nit && p.siigoId);

    let nuevos = 0;
    let enlazados = 0;
    if (proveedores.length) {
      // Se cruzan por NIT contra todo el maestro: son cientos de filas, no miles.
      const existentes = await prisma.supplier.findMany({
        select: { id: true, taxId: true, siigoId: true, city: true, address: true, phone: true, email: true, contactName: true },
      });
      const porNit = new Map(existentes.filter((s) => s.taxId).map((s) => [nitBase(s.taxId), s]));

      const crear = [];
      let numero = await siguienteNumeroProveedor();
      for (const p of proveedores) {
        const previo = porNit.get(p.nit);
        if (previo) {
          if (previo.siigoId) continue;
          await prisma.supplier.update({
            where: { id: previo.id },
            data: {
              siigoId: p.siigoId,
              siigoError: null,
              city: previo.city ?? p.city,
              address: previo.address ?? p.address,
              phone: previo.phone ?? p.phone,
              email: previo.email ?? p.email,
              contactName: previo.contactName ?? p.contactName,
            },
          });
          enlazados++;
          continue;
        }
        // Siigo puede repetir un NIT en dos sucursales: entra una sola vez.
        porNit.set(p.nit, { id: "", taxId: p.taxId, siigoId: p.siigoId, city: null, address: null, phone: null, email: null, contactName: null });
        const { nit: _nit, ...datos } = p;
        crear.push({ id: crypto.randomUUID(), code: codigoProveedor(numero++), origin: "SIIGO", ...datos });
      }
      await enLotes(crear, (data) => prisma.supplier.createMany({ data }));
      nuevos = crear.length;
    }

    const done = terceros.length < PAGE_SIZE || page >= pages;
    if (done || nuevos || enlazados) {
      await prisma.apiConnectionEvent.create({
        data: {
          connectionId: modulo.connectionId,
          action: "Importación de proveedores",
          result: "OK",
          detail: `Página ${page} de ${pages} · ${nuevos} proveedores nuevos · ${enlazados} enlazados`,
          userId,
          durationMs: Date.now() - inicio,
        },
      });
    }
    return resultado({ done, pages, revisados: terceros.length, nuevos, enlazados });
  } catch (e) {
    if (e instanceof SiigoLimitError) return resultado({ retryAfterSeconds: e.retryAfterSeconds });
    const mensaje = e instanceof Error ? e.message : "Fallo desconocido";
    await prisma.apiConnectionEvent.create({
      data: { connectionId: modulo.connectionId, action: "Importación de proveedores", result: "FALLO", detail: `Página ${page} · ${mensaje}`, userId },
    });
    return resultado({ error: mensaje });
  }
}
