import "server-only";
import { prisma } from "./prisma";
import { decryptJson } from "./secrets";
import { asRecord, asText } from "./http";
import { SiigoLimitError, siigoAuth, siigoGet, siigoPost } from "./siigo";
import { FISCAL_RESPONSIBILITIES, parseTaxData, vatResponsible, type TaxData } from "./rut";

/**
 * Alta en Siigo del tercero de un cliente o de un proveedor del portal (módulo
 * Clientes: en Siigo los dos son terceros y sólo cambia su `type`).
 *
 * Parte de los datos tributarios que se leyeron del RUT al convertir el lead o
 * la cotización. Antes de crear, busca el NIT en Siigo: si el tercero ya
 * existe, sólo lo enlaza. Así repetir el envío —tras un corte o desde la
 * ficha— nunca duplica el tercero.
 */

const ID_TYPES: Record<TaxData["idType"], string> = { NIT: "31", CC: "13", CE: "22" };

type Contacto = { firstName: string; lastName: string; email: string | null; phone: string | null } | null;
type Tercero = { code: string; name: string; address: string | null; phone: string | null; email: string | null };
type TipoTercero = "Customer" | "Supplier";

export type SiigoCustomerResult = { siigoId: string; existed: boolean } | { error: string };

/** Módulo Clientes de Siigo listo para crear terceros: credenciales, módulo activo y Partner-ID. */
export async function moduloClientes() {
  const row = await prisma.apiConnection.findUnique({ where: { provider: "SIIGO" }, include: { modules: true } });
  const mod = row?.modules.find((m) => m.module === "CLIENTES");
  const secretos = decryptJson(row?.secretCipher);
  if (!row?.account || !secretos?.secret || !mod?.enabled || !mod.partnerId) return null;
  return { connectionId: row.id, usuario: row.account, accessKey: secretos.secret, partnerId: mod.partnerId };
}

export async function siigoCustomersReady() {
  return Boolean(await moduloClientes());
}

export const telefono = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "").slice(-10);

export function partirNombre(completo: string) {
  const [first, ...rest] = completo.trim().split(/\s+/);
  return { first: first ?? "", last: rest.join(" ") };
}

/** Cuerpo de `POST /v1/customers` a partir del cliente o proveedor y de lo leído en su RUT. */
function terceroBody(tipo: TipoTercero, c: Tercero, d: TaxData, contacto: Contacto) {
  const empresa = d.personType === "JURIDICA";
  const persona = partirNombre(d.legalName);
  const nombre = empresa ? [d.legalName] : [d.firstNames ?? persona.first, d.lastNames ?? persona.last];
  const responsabilidades = d.responsibilities.filter((r) => FISCAL_RESPONSIBILITIES[r]).map((r) => ({ code: FISCAL_RESPONSIBILITIES[r].siigo }));
  const fono = telefono(c.phone ?? d.phone);
  const email = c.email ?? d.email;
  const quien = contacto
    ? { first: contacto.firstName, last: contacto.lastName }
    : d.legalRepresentative
      ? partirNombre(d.legalRepresentative)
      : empresa
        ? { first: d.legalName, last: "" }
        : persona;

  return {
    type: tipo,
    person_type: empresa ? "Company" : "Person",
    id_type: ID_TYPES[d.idType],
    identification: d.idNumber,
    ...(d.idType === "NIT" && d.checkDigit ? { check_digit: d.checkDigit } : {}),
    name: nombre,
    ...(d.tradeName ? { commercial_name: d.tradeName } : {}),
    branch_office: 0,
    active: true,
    vat_responsible: vatResponsible(d),
    fiscal_responsibilities: responsabilidades.length ? responsabilidades : [{ code: "R-99-PN" }],
    address: {
      address: c.address ?? d.address,
      city: { country_code: "Co", state_code: d.departmentCode ?? d.cityCode!.slice(0, 2), city_code: d.cityCode },
    },
    phones: fono ? [{ indicative: "57", number: fono }] : [],
    contacts: [
      {
        first_name: quien.first,
        last_name: quien.last,
        ...(contacto?.email ?? email ? { email: contacto?.email ?? email } : {}),
        ...(telefono(contacto?.phone) || fono ? { phone: { indicative: "57", number: telefono(contacto?.phone) || fono } } : {}),
      },
    ],
    comments: `Creado desde el CRM de Fitt Global (${c.code}).`,
  };
}

type Alta = {
  tipo: TipoTercero;
  /** Cómo queda en la bitácora de la conexión: «Alta de cliente», «Alta de proveedor». */
  accion: string;
  tercero: Tercero;
  fiscalData: string | null;
  contacto: Contacto;
  userId: string | null;
  /** Deja el resultado en la fila del portal: el id de Siigo o el motivo del rechazo. */
  guardar: (data: { siigoId?: string; siigoError: string | null }) => Promise<unknown>;
};

/**
 * Crea (o enlaza) el tercero en Siigo y deja el resultado en la fila del portal
 * y en la bitácora de la conexión. No lanza: el registro del portal ya existe y
 * un rechazo de Siigo se reintenta desde la ficha.
 */
async function altaTercero({ tipo, accion, tercero, fiscalData, contacto, userId, guardar }: Alta): Promise<SiigoCustomerResult> {
  const datos = parseTaxData(fiscalData);
  const fallar = async (mensaje: string, connectionId?: string) => {
    await guardar({ siigoError: mensaje });
    if (connectionId) {
      await prisma.apiConnectionEvent.create({
        data: { connectionId, action: accion, result: "FALLO", detail: `${tercero.name} · ${mensaje}`, userId },
      });
    }
    return { error: mensaje };
  };

  if (!datos) return fallar("Faltan los datos tributarios del RUT.");
  if (!datos.cityCode || !/^\d{5}$/.test(datos.cityCode)) return fallar("Falta el código DANE del municipio, que Siigo exige.");
  if (!(tercero.address ?? datos.address)) return fallar("Falta la dirección, que Siigo exige.");

  const modulo = await moduloClientes();
  if (!modulo) return fallar("El módulo Clientes de Siigo no está activo o no tiene Partner-ID: configúralo en Conexiones API.");

  const inicio = Date.now();
  try {
    const { token } = await siigoAuth(modulo.usuario, modulo.accessKey, modulo.partnerId);
    const encontrados = await siigoGet(token, modulo.partnerId, "/v1/customers", { identification: datos.idNumber });
    const previo = (Array.isArray(encontrados.results) ? encontrados.results : []).map(asRecord)[0];

    let siigoId = asText(previo?.id);
    const existed = Boolean(siigoId);
    if (!existed) {
      const creado = await siigoPost(token, modulo.partnerId, "/v1/customers", terceroBody(tipo, tercero, datos, contacto));
      siigoId = asText(creado.id);
      if (!siigoId) throw new Error("Siigo respondió sin el id del tercero.");
    }

    await guardar({ siigoId, siigoError: null });
    await prisma.apiConnectionEvent.create({
      data: {
        connectionId: modulo.connectionId,
        action: accion,
        result: "OK",
        detail: `${tercero.name} · NIT ${datos.idNumber} · ${existed ? "ya existía en Siigo, quedó enlazado" : "tercero creado"}`,
        userId,
        durationMs: Date.now() - inicio,
      },
    });
    return { siigoId, existed };
  } catch (e) {
    const mensaje =
      e instanceof SiigoLimitError
        ? `Siigo pidió una pausa: reintenta en ${e.retryAfterSeconds} s.`
        : e instanceof Error
          ? e.message
          : "Fallo desconocido";
    return fallar(mensaje, modulo.connectionId);
  }
}

/** Crea (o enlaza) en Siigo el tercero del cliente que nació de un lead. */
export async function pushCustomerToSiigo(companyId: string, userId: string | null): Promise<SiigoCustomerResult> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: { contacts: { where: { isPrimary: true }, take: 1 } },
  });
  if (!company) return { error: "El cliente ya no existe." };
  if (company.siigoId) return { siigoId: company.siigoId, existed: true };
  return altaTercero({
    tipo: "Customer",
    accion: "Alta de cliente",
    tercero: company,
    fiscalData: company.fiscalData,
    contacto: company.contacts[0] ?? null,
    userId,
    guardar: (data) => prisma.company.update({ where: { id: company.id }, data }),
  });
}

/** Crea (o enlaza) en Siigo el tercero del proveedor que nació de una cotización. */
export async function pushSupplierToSiigo(supplierId: string, userId: string | null): Promise<SiigoCustomerResult> {
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) return { error: "El proveedor ya no existe." };
  if (supplier.siigoId) return { siigoId: supplier.siigoId, existed: true };
  const quien = supplier.contactName ? partirNombre(supplier.contactName) : null;
  return altaTercero({
    tipo: "Supplier",
    accion: "Alta de proveedor",
    tercero: supplier,
    fiscalData: supplier.fiscalData,
    contacto: quien ? { firstName: quien.first, lastName: quien.last, email: supplier.email, phone: supplier.phone } : null,
    userId,
    guardar: (data) => prisma.supplier.update({ where: { id: supplier.id }, data }),
  });
}
