"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { requireRole } from "./auth";
import { CHANNELS, COMPANY_TYPES, LEAD_OPEN, LEAD_SOURCES, LEAD_STATUS, LEAD_TEMPERATURE, STORE_FORMATS } from "./enums";
import { fmtMoney, fmtPeriod } from "./format";
import { parseCoordinates, resolveMapsLink, reverseGeocode } from "./geocoding";
import { createLeadWithCode, LEAD_ROLES, metaCredentials, normalizePhone, searchPlaces, type PlaceOption } from "./leads";
import { syncLeadForms } from "./meta";
import { readUploadedDocument } from "./lector-documentos";
import { pushCustomerToSiigo } from "./siigo-clientes";
import { formatTaxId, parseTaxData, type TaxReading } from "./rut";
import { seal, sealMatches } from "./secrets";

export type LeadFormState = { error?: string; ok?: string };

/** Medios que una persona puede registrar a mano; SALES_HUNT tiene su propio camino. */
const MANUAL_SOURCES = ["DIRECTO", "WHATSAPP", "FACEBOOK", "INSTAGRAM", "WEB"];

const texto = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim();
const opcional = (fd: FormData, name: string) => texto(fd, name) || null;

/** «12.500.000», «12500000» o «12500000,50» → número; vacío → null. */
function monto(fd: FormData, name: string) {
  const raw = texto(fd, name).replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
  if (!raw) return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : NaN;
}

const periodoActual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const plural = (n: number, palabra: string) => `${n} ${palabra}${n === 1 ? "" : "s"}`;

const mensaje = (e: unknown) => (e instanceof Error ? e.message : "Fallo desconocido");

/** Un lead toca el menú (contador de nuevos), el forecast y el panel: se revalida todo el portal. */
function revalidarLeads() {
  revalidatePath("/", "layout");
}

/**
 * Temperatura, mes de cierre y valor viajan juntos: un lead caliente sin mes o
 * sin valor no podría sumar al forecast, así que no se acepta.
 */
function leerCierre(fd: FormData) {
  const temperature = texto(fd, "temperature") || "FRIO";
  const closePeriod = opcional(fd, "closePeriod");
  const expectedValue = monto(fd, "expectedValue");
  if (!LEAD_TEMPERATURE.values.includes(temperature as never)) return { error: "Temperatura desconocida." };
  if (closePeriod && !/^\d{4}-\d{2}$/.test(closePeriod)) return { error: "Mes de cierre inválido." };
  if (Number.isNaN(expectedValue)) return { error: "El valor estimado no es un número." };
  if (temperature === "CALIENTE" && (!closePeriod || !expectedValue)) {
    return { error: "Un lead caliente necesita mes tentativo de cierre y valor: con ellos suma al forecast." };
  }
  return { temperature, closePeriod, expectedValue };
}

async function responsable(fd: FormData, fallback: string) {
  const id = texto(fd, "ownerId");
  if (!id) return fallback;
  const user = await prisma.user.findFirst({ where: { id, active: true, role: { in: LEAD_ROLES } }, select: { id: true } });
  return user?.id ?? fallback;
}

// ─────────────────────────────────  Alta  ────────────────────────────────────

/** Búsqueda en Google Maps para arrancar un sales hunt. */
export async function buscarLugares(query: string): Promise<{ places?: PlaceOption[]; error?: string }> {
  await requireRole(LEAD_ROLES);
  const q = query.trim();
  if (q.length < 3) return { error: "Escribe al menos el nombre del negocio y la ciudad." };
  try {
    return { places: await searchPlaces(q) };
  } catch (e) {
    return { error: mensaje(e) };
  }
}

/** Una ubicación pegada a mano (coordenadas o enlace de Maps) y la ciudad donde cae. */
export async function ubicarPunto(text: string): Promise<{ lat?: number; lng?: number; city?: string | null; address?: string | null; error?: string }> {
  await requireRole(LEAD_ROLES);
  const coords = parseCoordinates(await resolveMapsLink(text));
  if (!coords) return { error: "No reconozco esa ubicación: pega «4.6533, -74.0836» o el enlace de Google Maps." };
  return { ...coords, ...(await reverseGeocode(coords.lat, coords.lng)) };
}

/** Ubicación pegada (coordenadas o enlace de Maps) o elegida en Google Maps; null si no hay. */
async function leerUbicacion(fd: FormData) {
  const placeId = opcional(fd, "placeId");
  const lat = Number(texto(fd, "lat"));
  const lng = Number(texto(fd, "lng"));
  const pegado = texto(fd, "coords");
  const coords =
    placeId && texto(fd, "lat") && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : pegado ? parseCoordinates(await resolveMapsLink(pegado)) : null;
  if (!coords) return null;
  return { ...coords, placeId: coords && placeId ? placeId : null, mapsUrl: opcional(fd, "mapsUrl") ?? (/^https?:\/\//.test(pegado) ? pegado : null) };
}

/** Un lugar de Google Maps que ya es tienda de un cliente o de otro lead abierto no se prospecta dos veces. */
async function lugarOcupado(placeId: string, exceptLeadId?: string) {
  const [store, otro] = await Promise.all([
    prisma.store.findFirst({ where: { placeId }, select: { name: true, company: { select: { name: true } } } }),
    prisma.leadStore.findFirst({
      where: { placeId, lead: { status: { in: [...LEAD_OPEN] }, ...(exceptLeadId ? { id: { not: exceptLeadId } } : {}) } },
      select: { lead: { select: { code: true } } },
    }),
  ]);
  if (store) return `Esta tienda ya es cliente: ${store.name} de ${store.company.name}.`;
  if (otro) return `Esta tienda ya se está trabajando como ${otro.lead.code}.`;
  return null;
}

/** El teléfono ya es de un contacto de otro lead. */
async function telefonoOcupado(phone: string, exceptLeadId?: string) {
  const tail = phone.replace(/\D/g, "").slice(-10);
  const dup = await prisma.leadContact.findFirst({
    where: { phone: { endsWith: tail }, ...(exceptLeadId ? { leadId: { not: exceptLeadId } } : {}) },
    select: { lead: { select: { code: true } } },
  });
  return dup ? `Ese teléfono ya es de un contacto del lead ${dup.lead.code}.` : null;
}

/**
 * Alta manual. Un lead nace con una tienda y un contacto; los demás se agregan
 * en su ficha. Un sales hunt siempre parte de la ubicación de la tienda: un
 * lugar de Google Maps o, si el negocio no aparece ahí, las coordenadas del punto.
 */
export async function crearLead(_prev: LeadFormState, fd: FormData): Promise<LeadFormState> {
  const user = await requireRole(LEAD_ROLES);
  const hunt = texto(fd, "entry") === "SALES_HUNT";
  const name = texto(fd, "name");
  if (!name) return { error: "Falta el nombre del negocio." };

  const cierre = leerCierre(fd);
  if ("error" in cierre) return { error: cierre.error };

  const contactName = texto(fd, "contactName");
  if (!contactName) return { error: "Falta el contacto: con quién se habla en el negocio." };
  const phone = normalizePhone(texto(fd, "phone"));
  const email = opcional(fd, "email")?.toLowerCase() ?? null;
  const format = opcional(fd, "format");
  if (format && !STORE_FORMATS.values.includes(format as never)) return { error: "Formato de tienda desconocido." };

  const location = await leerUbicacion(fd);
  let source: string;
  let sourceDetail: string | null;

  if (hunt) {
    source = "SALES_HUNT";
    if (!location) return { error: "Un sales hunt arranca por la ubicación de la tienda: elígela en Google Maps o pega sus coordenadas." };
    // La ciudad sale del punto si nadie la escribió.
    if (!texto(fd, "city") || !texto(fd, "address")) {
      const lugar = await reverseGeocode(location.lat, location.lng);
      if (!texto(fd, "city") && lugar.city) fd.set("city", lugar.city);
      if (!texto(fd, "address") && lugar.address) fd.set("address", lugar.address);
    }
    sourceDetail = location.placeId ? "Tienda identificada en Google Maps" : "Ubicación marcada a mano";
  } else {
    source = texto(fd, "source");
    if (!MANUAL_SOURCES.includes(source)) return { error: "Elige el medio por el que llegó." };
    if (!phone && !email) return { error: "Hace falta un teléfono o un correo del contacto para poder hablarle." };
    if (!texto(fd, "city")) return { error: "Falta la ciudad de la tienda." };
    sourceDetail = opcional(fd, "sourceDetail");
  }
  if (location?.placeId) {
    const ocupado = await lugarOcupado(location.placeId);
    if (ocupado) return { error: ocupado };
  }
  if (phone) {
    const ocupado = await telefonoOcupado(phone);
    if (ocupado) return { error: ocupado };
  }

  const lead = await createLeadWithCode({
    entry: hunt ? "SALES_HUNT" : "INBOUND",
    source,
    sourceDetail,
    name,
    temperature: cierre.temperature,
    closePeriod: cierre.closePeriod,
    expectedValue: cierre.expectedValue,
    notes: opcional(fd, "notes"),
    ownerId: await responsable(fd, user.id),
    createdById: user.id,
  });
  await prisma.leadStore.create({
    data: {
      leadId: lead.id,
      name: texto(fd, "storeName") || name,
      city: opcional(fd, "city"),
      address: opcional(fd, "address"),
      format,
      lat: location?.lat ?? null,
      lng: location?.lng ?? null,
      placeId: location?.placeId ?? null,
      mapsUrl: location?.mapsUrl ?? null,
    },
  });
  await prisma.leadContact.create({
    data: { leadId: lead.id, name: contactName, position: opcional(fd, "position"), phone, email },
  });
  await prisma.leadEvent.create({
    data: {
      leadId: lead.id,
      type: "CREADO",
      body: hunt ? `Sales hunt: ${sourceDetail?.toLowerCase()}` : `Registrado a mano · llegó por ${LEAD_SOURCES.label(source)}`,
      source: "MANUAL",
      userId: user.id,
    },
  });

  revalidarLeads();
  redirect(`/leads/${lead.id}`);
}

// ──────────────────────────────  Seguimiento  ────────────────────────────────

/** Estado, temperatura, cierre y responsable. Cada cambio queda en la bitácora. */
export async function actualizarSeguimiento(_prev: LeadFormState, fd: FormData): Promise<LeadFormState> {
  const user = await requireRole(LEAD_ROLES);
  const lead = await prisma.lead.findUnique({ where: { id: texto(fd, "id") }, include: { owner: { select: { name: true } } } });
  if (!lead) return { error: "El lead ya no existe." };
  if (lead.status === "GANADO") return { error: "Este lead ya es cliente: el seguimiento sigue en su ficha." };

  const status = texto(fd, "status");
  if (!LEAD_OPEN.includes(status as never) && status !== "PERDIDO") return { error: "Para ganarlo, conviértelo en cliente." };
  const lostReason = status === "PERDIDO" ? opcional(fd, "lostReason") : null;
  if (status === "PERDIDO" && !lostReason) return { error: "Anota por qué se perdió: sirve para la próxima." };

  const cierre = leerCierre(fd);
  if ("error" in cierre) return { error: cierre.error };
  const ownerId = await responsable(fd, lead.ownerId ?? user.id);

  const cambios: string[] = [];
  if (status !== lead.status) cambios.push(`Estado: ${LEAD_STATUS.label(lead.status)} → ${LEAD_STATUS.label(status)}`);
  if (cierre.temperature !== lead.temperature) {
    cambios.push(`Temperatura: ${LEAD_TEMPERATURE.label(lead.temperature)} → ${LEAD_TEMPERATURE.label(cierre.temperature)}`);
  }
  if (cierre.closePeriod !== lead.closePeriod) cambios.push(`Cierre: ${cierre.closePeriod ? fmtPeriod(cierre.closePeriod) : "sin mes"}`);
  if ((cierre.expectedValue ?? null) !== lead.expectedValue) {
    cambios.push(`Valor: ${cierre.expectedValue != null ? fmtMoney(cierre.expectedValue) : "sin valor"}`);
  }
  if (ownerId !== lead.ownerId) {
    const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { name: true } });
    cambios.push(`Responsable: ${owner?.name ?? "—"}`);
  }
  if (lostReason && lostReason !== lead.lostReason) cambios.push(`Motivo: ${lostReason}`);
  if (!cambios.length) return { ok: "Sin cambios." };

  await prisma.lead.update({
    where: { id: lead.id },
    data: { status, lostReason, ownerId, ...cierre, lastActivityAt: new Date() },
  });
  await prisma.leadEvent.create({ data: { leadId: lead.id, type: "ESTADO", body: cambios.join(" · "), source: "MANUAL", userId: user.id } });

  revalidarLeads();
  return { ok: "Seguimiento guardado." };
}

/** Nombre del negocio y observaciones. No pasan por la bitácora: son correcciones. */
export async function actualizarDatos(_prev: LeadFormState, fd: FormData): Promise<LeadFormState> {
  await requireRole(LEAD_ROLES);
  const id = texto(fd, "id");
  const name = texto(fd, "name");
  if (!name) return { error: "Falta el nombre del negocio." };
  const { count } = await prisma.lead.updateMany({ where: { id }, data: { name, notes: opcional(fd, "notes") } });
  if (!count) return { error: "El lead ya no existe." };
  revalidarLeads();
  return { ok: "Datos guardados." };
}

// ─────────────────────────  Tiendas y contactos del lead  ─────────────────────

/** Lead que todavía se puede editar: uno ya convertido sigue en la ficha del cliente. */
async function leadEditable(id: string) {
  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true, companyId: true } });
  if (!lead) return { error: "El lead ya no existe." };
  if (lead.companyId) return { error: "Este lead ya es cliente: sus tiendas y contactos se editan en la ficha del cliente." };
  return { lead };
}

/** Agrega una tienda al lead o corrige una (con `storeId`). La ubicación es opcional. */
export async function guardarTiendaLead(_prev: LeadFormState, fd: FormData): Promise<LeadFormState> {
  await requireRole(LEAD_ROLES);
  const r = await leadEditable(texto(fd, "leadId"));
  if ("error" in r) return { error: r.error };
  const name = texto(fd, "name");
  if (!name) return { error: "Falta el nombre de la tienda." };
  const format = opcional(fd, "format");
  if (format && !STORE_FORMATS.values.includes(format as never)) return { error: "Formato de tienda desconocido." };

  const id = opcional(fd, "storeId");
  const data = { name, city: opcional(fd, "city"), address: opcional(fd, "address"), format };
  if (texto(fd, "coords")) {
    const location = await leerUbicacion(fd);
    if (!location) return { error: "No reconozco esa ubicación: pega «4.6533, -74.0836» o el enlace de Google Maps." };
    Object.assign(data, { lat: location.lat, lng: location.lng, mapsUrl: location.mapsUrl, placeId: null });
  }

  if (id) {
    const { count } = await prisma.leadStore.updateMany({ where: { id, leadId: r.lead.id }, data });
    if (!count) return { error: "La tienda ya no existe." };
  } else {
    await prisma.leadStore.create({ data: { ...data, leadId: r.lead.id } });
  }
  await prisma.lead.update({ where: { id: r.lead.id }, data: { lastActivityAt: new Date() } });
  revalidarLeads();
  return { ok: id ? "Tienda guardada." : "Tienda agregada." };
}

export async function quitarTiendaLead(fd: FormData) {
  await requireRole(LEAD_ROLES);
  const r = await leadEditable(texto(fd, "leadId"));
  if ("error" in r) return;
  // Un lead siempre conserva al menos una tienda.
  if ((await prisma.leadStore.count({ where: { leadId: r.lead.id } })) <= 1) return;
  await prisma.leadStore.deleteMany({ where: { id: texto(fd, "storeId"), leadId: r.lead.id } });
  revalidarLeads();
}

/** Agrega un contacto al lead o corrige uno (con `contactId`). */
export async function guardarContactoLead(_prev: LeadFormState, fd: FormData): Promise<LeadFormState> {
  await requireRole(LEAD_ROLES);
  const r = await leadEditable(texto(fd, "leadId"));
  if ("error" in r) return { error: r.error };
  const name = texto(fd, "name");
  if (!name) return { error: "Falta el nombre del contacto." };
  const phone = normalizePhone(texto(fd, "phone"));
  if (texto(fd, "phone") && !phone) return { error: "El teléfono no parece válido." };
  if (phone) {
    const ocupado = await telefonoOcupado(phone, r.lead.id);
    if (ocupado) return { error: ocupado };
  }

  const id = opcional(fd, "contactId");
  const data = { name, position: opcional(fd, "position"), phone, email: opcional(fd, "email")?.toLowerCase() ?? null };
  if (id) {
    const { count } = await prisma.leadContact.updateMany({ where: { id, leadId: r.lead.id }, data });
    if (!count) return { error: "El contacto ya no existe." };
  } else {
    await prisma.leadContact.create({ data: { ...data, leadId: r.lead.id } });
  }
  await prisma.lead.update({ where: { id: r.lead.id }, data: { lastActivityAt: new Date() } });
  revalidarLeads();
  return { ok: id ? "Contacto guardado." : "Contacto agregado." };
}

export async function quitarContactoLead(fd: FormData) {
  await requireRole(LEAD_ROLES);
  const r = await leadEditable(texto(fd, "leadId"));
  if ("error" in r) return;
  // Un lead siempre conserva al menos un contacto.
  if ((await prisma.leadContact.count({ where: { leadId: r.lead.id } })) <= 1) return;
  await prisma.leadContact.deleteMany({ where: { id: texto(fd, "contactId"), leadId: r.lead.id } });
  revalidarLeads();
}

export async function agregarNota(fd: FormData) {
  const user = await requireRole(LEAD_ROLES);
  const id = texto(fd, "id");
  const body = texto(fd, "body");
  if (!id || !body) return;
  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
  if (!lead) return;
  await prisma.leadEvent.create({ data: { leadId: id, type: "NOTA", body, source: "MANUAL", userId: user.id } });
  await prisma.lead.update({ where: { id }, data: { lastActivityAt: new Date() } });
  revalidarLeads();
}

// ───────────────────────────────  Conversión  ────────────────────────────────

/** NIT sin dígito de verificación ni separadores, como lo cruza la sincronización de Siigo. */
const nitBase = (v: string | null | undefined) => (v ?? "").split("-")[0].replace(/\D/g, "");

/**
 * Lee el RUT que se sube al convertir. Sin RUT no hay cliente: un certificado
 * de Cámara de Comercio u otro documento se rechaza. No guarda nada: devuelve lo
 * leído, sellado, para revisarlo en el formulario; cada lectura queda en la
 * bitácora de la conexión con Claude.
 */
export async function leerDocumento(fd: FormData): Promise<TaxReading> {
  const user = await requireRole(LEAD_ROLES);
  const lectura = await readUploadedDocument(fd.get("document"), user.id, "Elige el archivo del RUT.");
  if (!lectura.data) return lectura;
  if (lectura.data.documentType !== "RUT") {
    return { error: "Ese documento no es un RUT. Para convertir el lead en cliente hace falta su RUT de la DIAN." };
  }
  const raw = JSON.stringify(lectura.data);
  return { ...lectura, raw, seal: seal(raw) };
}

/** Siguiente CL-###. Si dos se crean a la vez, el índice único decide y se reintenta. */
async function siguienteCodigoCliente(intento: number) {
  const codes = await prisma.company.findMany({ where: { code: { startsWith: "CL-" } }, select: { code: true } });
  const max = codes.reduce((m, c) => Math.max(m, Number(c.code.slice(3)) || 0), 0);
  return `CL-${String(max + 1 + intento).padStart(3, "0")}`;
}

/**
 * Convierte el lead en cliente: crea la empresa con las tiendas y los contactos
 * del lead que se eligieron (al menos uno de cada), y vincula cada contacto a
 * cada tienda; luego se ajustan en la ficha. El valor esperado pasa a ser el forecast
 * manual del cliente nuevo para su mes de cierre, así el forecast no cae al
 * ganarse el lead. D1 no tiene transacciones: el lead se marca apenas existe la
 * empresa, para que repetir la acción no cree un segundo cliente.
 */
export async function convertirLead(_prev: LeadFormState, fd: FormData): Promise<LeadFormState> {
  const user = await requireRole(LEAD_ROLES);
  const lead = await prisma.lead.findUnique({
    where: { id: texto(fd, "id") },
    include: { stores: { orderBy: { createdAt: "asc" } }, contacts: { orderBy: { createdAt: "asc" } } },
  });
  if (!lead) return { error: "El lead ya no existe." };
  if (lead.companyId) redirect(`/clientes/${lead.companyId}`);
  if (lead.status === "PERDIDO") return { error: "Reabre el lead antes de convertirlo." };

  const elegidas = new Set(fd.getAll("storeIds").map(String));
  const elegidos = new Set(fd.getAll("contactIds").map(String));
  const stores = lead.stores.filter((s) => elegidas.has(s.id));
  const contacts = lead.contacts.filter((c) => elegidos.has(c.id));
  if (!stores.length) return { error: "Elige al menos una tienda para el cliente." };
  if (!contacts.length) return { error: "Elige al menos un contacto para el cliente." };

  const type = texto(fd, "type");
  const channel = texto(fd, "channel");
  if (!COMPANY_TYPES.values.includes(type as never) || !CHANNELS.values.includes(channel as never)) {
    return { error: "Elige el tipo de cliente y su canal." };
  }
  // Formato de cada tienda, elegido en el formulario (`format-<id>`).
  const formats = new Map(stores.map((s) => [s.id, texto(fd, `format-${s.id}`) || s.format || "MINIMARKET"]));
  if ([...formats.values()].some((f) => !STORE_FORMATS.values.includes(f as never))) return { error: "Formato de tienda desconocido." };
  const name = texto(fd, "companyName") || lead.name;

  // El RUT es obligatorio: sus datos vienen de leerDocumento, con el sello del servidor.
  const raw = texto(fd, "fiscal");
  if (!raw) return { error: "Sube el RUT del cliente: sin RUT no se puede convertir el lead." };
  const fiscal = sealMatches(raw, texto(fd, "seal")) ? parseTaxData(raw) : null;
  if (!fiscal || fiscal.documentType !== "RUT") return { error: "Los datos del RUT no son válidos; vuelve a subirlo." };
  fiscal.legalName = name;
  const taxId = formatTaxId(fiscal);

  // La sincronización de facturas crea clientes por NIT: si ya existe, no se duplica.
  const base = nitBase(taxId);
  const mismos = await prisma.company.findMany({ where: { taxId: { startsWith: base } }, select: { code: true, name: true, taxId: true } });
  const dup = mismos.find((c) => nitBase(c.taxId) === base);
  if (dup) return { error: `El NIT ${base} ya es del cliente ${dup.code} · ${dup.name}.` };

  // Dirección y contacto vienen del RUT, revisados en el formulario.
  const city = opcional(fd, "city");
  const address = opcional(fd, "address");
  const phone = normalizePhone(texto(fd, "phone"));
  const email = opcional(fd, "email")?.toLowerCase() ?? null;

  let company = null;
  for (let intento = 0; !company && intento < 5; intento++) {
    try {
      company = await prisma.company.create({
        data: {
          code: await siguienteCodigoCliente(intento),
          name,
          taxId,
          type,
          channel,
          tier: "C",
          city,
          address,
          phone,
          email,
          fiscalData: JSON.stringify(fiscal),
          notes: `Convertido desde el lead ${lead.code} (${LEAD_SOURCES.label(lead.source)}).`,
          ownerId: lead.ownerId ?? user.id,
        },
      });
    } catch (e) {
      if ((e as { code?: string })?.code !== "P2002") throw e;
    }
  }
  if (!company) return { error: "No se pudo asignar código al cliente; intenta de nuevo." };

  const now = new Date();
  await prisma.lead.update({
    where: { id: lead.id },
    data: { status: "GANADO", companyId: company.id, convertedAt: now, lastActivityAt: now },
  });

  const storeIds: string[] = [];
  for (const [i, s] of stores.entries()) {
    const storeFormat = formats.get(s.id)!;
    // Una tienda en línea no tiene ubicación física: queda DIGITAL y fuera de rutas.
    const digital = storeFormat === "ECOMMERCE";
    const located = !digital && s.lat != null && s.lng != null;
    const store = await prisma.store.create({
      data: {
        code: String(i + 1).padStart(3, "0"),
        name: s.name,
        companyId: company.id,
        address: digital ? null : s.address,
        city: s.city ?? city ?? "Sin ciudad",
        zone: digital ? "Digital" : (s.city ?? city ?? "Sin zona"),
        format: storeFormat,
        tier: "C",
        lat: located ? s.lat : null,
        lng: located ? s.lng : null,
        placeId: digital ? null : s.placeId,
        geoStatus: digital ? "DIGITAL" : located ? (s.placeId ? "UBICADA" : "MANUAL") : "PENDIENTE",
        geoSource: located ? (s.placeId ? "PLACES" : "MANUAL") : null,
        geocodedAt: located ? now : null,
      },
    });
    await prisma.leadStore.update({ where: { id: s.id }, data: { storeId: store.id, format: storeFormat } });
    storeIds.push(store.id);
  }

  for (const [i, c] of contacts.entries()) {
    const [firstName, ...rest] = c.name.split(/\s+/);
    const contact = await prisma.contact.create({
      data: {
        firstName,
        lastName: rest.join(" "),
        email: c.email,
        phone: c.phone,
        position: c.position ?? "Contacto comercial",
        companyId: company.id,
        isPrimary: i === 0,
        lastContactAt: lead.lastActivityAt,
      },
    });
    await prisma.leadContact.update({ where: { id: c.id }, data: { contactId: contact.id } });
    await prisma.storeContact.createMany({ data: storeIds.map((storeId) => ({ storeId, contactId: contact.id })) });
  }

  const forecastPeriod = lead.closePeriod && lead.expectedValue && lead.closePeriod >= periodoActual() ? lead.closePeriod : null;
  if (forecastPeriod) {
    await prisma.forecast.create({
      data: { period: forecastPeriod, companyId: company.id, amount: lead.expectedValue!, units: 0, notes: `Desde el lead ${lead.code}`, createdById: user.id },
    });
  }

  // Siigo va al final: si lo rechaza, el cliente ya existe y se reintenta desde su ficha.
  let siigo = "";
  if (fd.get("siigo") === "on") {
    const r = await pushCustomerToSiigo(company.id, user.id);
    siigo = "error" in r ? ` · Siigo no lo recibió: ${r.error}` : r.existed ? " · ya existía en Siigo y quedó enlazado" : " · creado en Siigo";
  }

  await prisma.leadEvent.create({
    data: {
      leadId: lead.id,
      type: "CONVERTIDO",
      body: `Convertido en el cliente ${company.code} con su RUT, ${plural(stores.length, "tienda")} y ${plural(contacts.length, "contacto")}${forecastPeriod ? ` · forecast de ${fmtPeriod(forecastPeriod)} por ${fmtMoney(lead.expectedValue!)}` : ""}${siigo}`,
      source: "MANUAL",
      userId: user.id,
    },
  });

  revalidarLeads();
  redirect(`/clientes/${company.id}`);
}

/** Reintenta desde la ficha el alta en Siigo de un cliente convertido con su documento. */
export async function enviarClienteASiigo(fd: FormData) {
  const user = await requireRole(LEAD_ROLES);
  const id = texto(fd, "companyId");
  if (!id) return;
  await pushCustomerToSiigo(id, user.id);
  revalidatePath(`/clientes/${id}`);
  revalidatePath("/conexiones");
}

// ─────────────────────────────────  Meta  ────────────────────────────────────

/** Trae los leads de formularios de los últimos 30 días que el webhook no haya entregado. */
export async function sincronizarMeta(_prev: LeadFormState): Promise<LeadFormState> {
  await requireRole(LEAD_ROLES);
  const creds = await metaCredentials();
  if (!creds) return { error: "Meta no está conectado: carga sus credenciales en Conexiones API." };
  try {
    const r = await syncLeadForms(creds);
    if (r.nuevos || r.mensajes) revalidarLeads();
    const partes = [
      `${r.formularios} formulario${r.formularios === 1 ? "" : "s"} en ${r.paginas} página${r.paginas === 1 ? "" : "s"}`,
      `${r.nuevos} lead${r.nuevos === 1 ? "" : "s"} nuevo${r.nuevos === 1 ? "" : "s"}`,
      r.mensajes ? `${r.mensajes} sumados a leads existentes` : null,
      r.truncado ? "quedaron formularios por revisar; vuelve a sincronizar" : null,
    ].filter(Boolean);
    if (r.errores.length) return { error: `${partes.join(" · ")}. Fallos: ${r.errores.slice(0, 3).join(" | ")}` };
    return { ok: `${partes.join(" · ")}.` };
  } catch (e) {
    return { error: `Meta respondió: ${mensaje(e)}` };
  }
}
