import "server-only";
import { prisma } from "./prisma";
import { decryptJson } from "./secrets";
import { asRecord, asText } from "./http";
import { SiigoLimitError, siigoAuth, siigoGet, siigoPost } from "./siigo";
import { FISCAL_RESPONSIBILITIES, parseTaxData, vatResponsible, type TaxData } from "./rut";

/**
 * Alta en Siigo del tercero de un cliente del portal (módulo Clientes).
 *
 * Parte de los datos tributarios que se leyeron de su RUT o de su certificado
 * de Cámara de Comercio al convertir el lead. Antes de crear, busca el NIT en
 * Siigo: si el tercero ya existe, sólo lo enlaza. Así repetir el envío —tras un
 * corte o desde la ficha— nunca duplica el tercero.
 */

const ID_TYPES: Record<TaxData["idType"], string> = { NIT: "31", CC: "13", CE: "22" };

type Contacto = { firstName: string; lastName: string; email: string | null; phone: string | null } | null;
type Cliente = { code: string; name: string; address: string | null; phone: string | null; email: string | null };

export type SiigoCustomerResult = { siigoId: string; existed: boolean } | { error: string };

/** Módulo Clientes de Siigo listo para crear terceros: credenciales, módulo activo y Partner-ID. */
async function moduloClientes() {
  const row = await prisma.apiConnection.findUnique({ where: { provider: "SIIGO" }, include: { modules: true } });
  const mod = row?.modules.find((m) => m.module === "CLIENTES");
  const secretos = decryptJson(row?.secretCipher);
  if (!row?.account || !secretos?.secret || !mod?.enabled || !mod.partnerId) return null;
  return { connectionId: row.id, usuario: row.account, accessKey: secretos.secret, partnerId: mod.partnerId };
}

export async function siigoCustomersReady() {
  return Boolean(await moduloClientes());
}

const telefono = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "").slice(-10);

function partirNombre(completo: string) {
  const [first, ...rest] = completo.trim().split(/\s+/);
  return { first: first ?? "", last: rest.join(" ") };
}

/** Cuerpo de `POST /v1/customers` a partir del cliente y de lo leído en su documento. */
function customerBody(c: Cliente, d: TaxData, contacto: Contacto) {
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
    type: "Customer",
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

/**
 * Crea (o enlaza) el tercero del cliente en Siigo y deja el resultado en la
 * empresa y en la bitácora de la conexión. No lanza: el cliente del portal ya
 * existe y un rechazo de Siigo se reintenta desde la ficha.
 */
export async function pushCustomerToSiigo(companyId: string, userId: string | null): Promise<SiigoCustomerResult> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: { contacts: { where: { isPrimary: true }, take: 1 } },
  });
  if (!company) return { error: "El cliente ya no existe." };
  if (company.siigoId) return { siigoId: company.siigoId, existed: true };

  const datos = parseTaxData(company.fiscalData);
  const fallar = async (mensaje: string, connectionId?: string) => {
    await prisma.company.update({ where: { id: company.id }, data: { siigoError: mensaje } });
    if (connectionId) {
      await prisma.apiConnectionEvent.create({
        data: { connectionId, action: "Alta de cliente", result: "FALLO", detail: `${company.name} · ${mensaje}`, userId },
      });
    }
    return { error: mensaje };
  };

  if (!datos) return fallar("Faltan los datos tributarios del RUT del cliente.");
  if (!datos.cityCode || !/^\d{5}$/.test(datos.cityCode)) return fallar("Falta el código DANE del municipio, que Siigo exige.");
  if (!(company.address ?? datos.address)) return fallar("Falta la dirección, que Siigo exige.");

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
      const contacto = company.contacts[0] ?? null;
      const creado = await siigoPost(token, modulo.partnerId, "/v1/customers", customerBody(company, datos, contacto));
      siigoId = asText(creado.id);
      if (!siigoId) throw new Error("Siigo respondió sin el id del tercero.");
    }

    await prisma.company.update({ where: { id: company.id }, data: { siigoId, siigoError: null } });
    await prisma.apiConnectionEvent.create({
      data: {
        connectionId: modulo.connectionId,
        action: "Alta de cliente",
        result: "OK",
        detail: `${company.name} · NIT ${datos.idNumber} · ${existed ? "ya existía en Siigo, quedó enlazado" : "tercero creado"}`,
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
