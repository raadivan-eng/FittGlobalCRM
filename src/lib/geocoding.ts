import "server-only";
import { prisma } from "./prisma";
import { decryptJson } from "./secrets";
import { norm } from "./store-import";

/**
 * Ubicación de los puntos de venta con Google Maps.
 *
 * Primero se intenta la dirección (Geocoding API). Si no hay dirección, si
 * Google sólo encuentra la ciudad o si el resultado cae en otra ciudad, se
 * busca la tienda por nombre (Places API): para una cadena, «Olímpica Calle
 * 100 Bogotá» suele ser más certero que una dirección escrita a mano.
 *
 * Un resultado en otra ciudad nunca se acepta: una tienda mal ubicada arruina
 * la ruta entera, una sin ubicar sólo se queda fuera de ella.
 */

const TIMEOUT_MS = 10_000;
const CONCURRENCY = 5;

export type GeoResult = {
  status: "UBICADA" | "POR_REVISAR" | "NO_ENCONTRADA";
  source: "GEOCODING" | "PLACES" | null;
  lat: number | null;
  lng: number | null;
  match: string;
};

/** Error de la API (clave rechazada, cuota agotada): detiene el lote en vez de marcar tiendas. */
export class MapsApiError extends Error {}

type StoreToLocate = {
  id: string;
  name: string;
  address: string | null;
  city: string;
  department: string | null;
  company: { name: string };
};

export async function mapsKey(): Promise<string | null> {
  const row = await prisma.apiConnection.findUnique({ where: { provider: "MAPS" } });
  return decryptJson(row?.secretCipher)?.secret ?? null;
}

// ───────────────────────────  Limpieza de textos  ────────────────────────────

/**
 * Quita lo que confunde al geocodificador: locales, pisos, torres, bloques.
 * «CRA 68 A No. 24-10 LOCALES 1-9» → «CRA 68 A # 24-10».
 */
export function cleanAddress(address: string) {
  return address
    .replace(/\bN[°ºo]\.?\s*(?=\d)/gi, "# ")
    .replace(/#\s*#/g, "#")
    .replace(/\s*[-–,]?\s*\b(?:(?:LOCAL(?:ES)?|LC|PISO|OF(?:ICINA)?|INT(?:ERIOR)?|TORRE|EDF|EDIFICIO|BQ|BLOQUE|SOT(?:ANO)?)\b|L-\s?\d).*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Marca con la que la gente (y Google) conoce cada cadena. */
const BRANDS: [RegExp, string][] = [
  [/OLIMPICA/, "Olímpica"],
  [/COLSUBSIDIO/, "Droguería Colsubsidio"],
  [/BRECCIA|LOCATEL/, "Locatel"],
  [/FARMATODO/, "Farmatodo"],
  [/PRICESMART/, "PriceSmart"],
];

export function brandOf(companyName: string) {
  const key = norm(companyName);
  return BRANDS.find(([re]) => re.test(key))?.[1] ?? null;
}

/** «STO 402 CALLE 100» → «CALLE 100»; «DROG CALLE 72 - MIXTA» → «CALLE 72». */
export function cleanStoreName(name: string, brand: string | null) {
  let n = name
    .replace(/^(STO|SAO|SDO|SOF|DO|DIS|TDP)\s+\d+\s*/i, "")
    .replace(/\b(DROG(UERIA)?|DISP|MIXTA|A C)\b\.?/gi, " ")
    .replace(/\/\s*COLSUBSIDIO/gi, " ")
    .replace(/\s+-\s+/g, " ");
  if (brand) n = n.replace(new RegExp(`\\b${norm(brand).split(" ").pop()}\\b`, "i"), " ");
  return n.replace(/\s+/g, " ").trim();
}

export const cityKey = (city: string) => norm(city).replace(/\bD\.?C\.?$/, "").replace(/,/g, "").trim();

/** ¿El texto devuelto por Google menciona la ciudad de la tienda? */
export function inCity(texts: string[], city: string) {
  const want = cityKey(city);
  if (!want || want === "SIN CIUDAD") return true;
  return texts.some((t) => {
    const got = cityKey(t);
    return got.length >= 4 && (got === want || got.includes(want) || want.includes(got));
  });
}

// ─────────────────────────────  Llamadas a Google  ───────────────────────────

type Json = Record<string, unknown>;

export async function mapsFetch(url: string, init: RequestInit = {}) {
  try {
    const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = (await res.json().catch(() => ({}))) as Json;
    return { res, body };
  } catch (e) {
    throw new MapsApiError(e instanceof Error && e.name === "TimeoutError" ? "Google no respondió a tiempo." : "No se pudo alcanzar Google Maps.");
  }
}

async function geocodeAddress(store: StoreToLocate, key: string): Promise<GeoResult | null> {
  if (!store.address) return null;
  const query = [cleanAddress(store.address), store.city !== "Sin ciudad" ? store.city : null, store.department, "Colombia"]
    .filter(Boolean)
    .join(", ");
  const { body } = await mapsFetch(
    `https://maps.googleapis.com/maps/api/geocode/json?${new URLSearchParams({ address: query, components: "country:CO", region: "co", language: "es", key })}`,
  );

  const status = String(body.status ?? "");
  if (status === "ZERO_RESULTS") return null;
  if (status !== "OK") throw new MapsApiError(`Geocoding API: ${status} ${String(body.error_message ?? "")}`.trim());

  const r = (body.results as Json[])[0];
  const geometry = r.geometry as { location: { lat: number; lng: number }; location_type: string };
  const components = (r.address_components as { long_name: string }[]).map((c) => c.long_name);
  const formatted = String(r.formatted_address ?? "");

  // Sólo la ciudad o una ciudad equivocada: no sirve para rutear.
  if (geometry.location_type === "APPROXIMATE" || !inCity(components, store.city)) return null;

  const precise = ["ROOFTOP", "RANGE_INTERPOLATED"].includes(geometry.location_type) && !r.partial_match;
  return {
    status: precise ? "UBICADA" : "POR_REVISAR",
    source: "GEOCODING",
    lat: geometry.location.lat,
    lng: geometry.location.lng,
    match: formatted,
  };
}

/** `null` = sin resultado; lanza `PlacesUnavailable` si la API no está habilitada. */
class PlacesUnavailable extends Error {}

async function searchPlace(store: StoreToLocate, key: string): Promise<GeoResult | null> {
  const brand = brandOf(store.company.name);
  const name = cleanStoreName(store.name, brand);
  const textQuery = [brand, name, store.city !== "Sin ciudad" ? store.city : null].filter(Boolean).join(" ");

  const { res, body } = await mapsFetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
    },
    body: JSON.stringify({ textQuery, regionCode: "CO", languageCode: "es" }),
  });

  if (res.status === 403) throw new PlacesUnavailable();
  if (res.status === 429) throw new MapsApiError("Places API: cuota agotada, intenta más tarde.");
  if (!res.ok) throw new MapsApiError(`Places API: ${res.status} ${String((body.error as Json | undefined)?.message ?? "")}`.trim());

  const place = (body.places as Json[] | undefined)?.[0];
  if (!place) return null;
  const address = String(place.formattedAddress ?? "");
  const display = String((place.displayName as Json | undefined)?.text ?? "");
  const location = place.location as { latitude: number; longitude: number } | undefined;
  if (!location || !inCity(address.split(","), store.city)) return null;

  // Si la marca aparece en el nombre que devuelve Google, el lugar es la tienda.
  const brandWord = brand ? norm(brand).split(" ").pop()! : null;
  const confirmed = !brandWord || norm(display).includes(brandWord);
  return {
    status: confirmed ? "UBICADA" : "POR_REVISAR",
    source: "PLACES",
    lat: location.latitude,
    lng: location.longitude,
    match: `${display} · ${address}`,
  };
}

export async function locateStore(store: StoreToLocate, key: string, opts: { places: boolean }): Promise<GeoResult & { placesUnavailable?: boolean }> {
  const byAddress = await geocodeAddress(store, key);
  if (byAddress?.status === "UBICADA") return byAddress;

  if (opts.places) {
    try {
      const byName = await searchPlace(store, key);
      if (byName?.status === "UBICADA" || (byName && !byAddress)) return byName;
    } catch (e) {
      if (!(e instanceof PlacesUnavailable)) throw e;
      if (byAddress) return { ...byAddress, placesUnavailable: true };
      return { ...notFound(store), placesUnavailable: true };
    }
  }

  return byAddress ?? notFound(store);
}

function notFound(store: StoreToLocate): GeoResult {
  return {
    status: "NO_ENCONTRADA",
    source: null,
    lat: null,
    lng: null,
    match: store.address ? `Google no encontró la dirección en ${store.city}` : "Sin dirección y sin coincidencia por nombre",
  };
}

// ───────────────────────────────  Por lotes  ─────────────────────────────────

export type GeocodeBatch = {
  processed: number;
  remaining: number;
  located: number;
  review: number;
  notFound: number;
  placesUnavailable: boolean;
  error?: string;
};

/**
 * Procesa un lote de tiendas activas pendientes (o no encontradas, si se pide
 * reintentar). Se llama en bucle desde el navegador para mostrar avance y
 * poder detenerse sin perder lo ya ubicado.
 */
export async function geocodeBatch(opts: { size: number; retryNotFound: boolean; places: boolean; startedAt: Date }): Promise<GeocodeBatch> {
  const key = await mapsKey();
  const statuses = opts.retryNotFound ? ["NO_ENCONTRADA"] : ["PENDIENTE"];
  const empty = { processed: 0, located: 0, review: 0, notFound: 0, placesUnavailable: false };
  if (!key) return { ...empty, remaining: 0, error: "Configura la API key de Google Maps en Conexiones." };

  const where = {
    active: true,
    geoStatus: { in: statuses },
    // Al reintentar, no volver sobre las que ya se intentaron en esta misma corrida.
    ...(opts.retryNotFound ? { geocodedAt: { lt: opts.startedAt } } : {}),
  };
  const stores = await prisma.store.findMany({
    where,
    take: opts.size,
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, address: true, city: true, department: true, company: { select: { name: true } } },
  });

  const result = { ...empty };
  let places = opts.places;
  let error: string | undefined;

  for (let i = 0; i < stores.length && !error; i += CONCURRENCY) {
    const chunk = stores.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(chunk.map((s) => locateStore(s, key, { places })));

    for (const [j, outcome] of settled.entries()) {
      if (outcome.status === "rejected") {
        error = outcome.reason instanceof Error ? outcome.reason.message : "Error de Google Maps";
        continue;
      }
      const r = outcome.value;
      if (r.placesUnavailable) {
        places = false;
        result.placesUnavailable = true;
      }
      await prisma.store.update({
        where: { id: chunk[j].id },
        data: { geoStatus: r.status, geoSource: r.source, geoMatch: r.match, lat: r.lat, lng: r.lng, geocodedAt: new Date() },
      });
      result.processed++;
      if (r.status === "UBICADA") result.located++;
      else if (r.status === "POR_REVISAR") result.review++;
      else result.notFound++;
    }
  }

  const remaining = await prisma.store.count({ where });
  return { ...result, remaining, error };
}

// ─────────────────────────────  Ubicación manual  ────────────────────────────

/**
 * Acepta lo que alguien copia de Google Maps: «4.6533, -74.0836», un enlace con
 * «@4.6533,-74.0836» o con «!3d4.6533!4d-74.0836», o «?q=4.6533,-74.0836».
 */
export function parseCoordinates(text: string): { lat: number; lng: number } | null {
  const t = text.trim();
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i,
    /^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    // Colombia continental e insular, con margen.
    if (lat > -5 && lat < 14 && lng > -82 && lng < -66) return { lat, lng };
    return null;
  }
  return null;
}

/**
 * Los enlaces cortos que comparte la app de Maps («maps.app.goo.gl/…») no traen
 * las coordenadas: hay que seguir la redirección hasta el enlace largo. Sólo se
 * siguen dominios de Google, nunca una URL cualquiera.
 */
export async function resolveMapsLink(text: string): Promise<string> {
  let url = text.trim();
  for (let salto = 0; salto < 3; salto++) {
    if (!/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(url)) break;
    try {
      const res = await fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
      const next = res.headers.get("location");
      if (!next) break;
      url = next;
    } catch {
      break;
    }
  }
  return url;
}

export type ReversePlace = { city: string | null; address: string | null };

/** «Bogotá ciudad» o «Perímetro Urbano Medellín» (OpenStreetMap) → el nombre de siempre. */
const cleanCity = (city: string) => city.replace(/^Per[ií]metro Urbano\s+/i, "").replace(/\s+ciudad$/i, "").trim();

/**
 * Ciudad y dirección de un punto. Con Google Maps conectado se usa su
 * Geocoding API; si no, OpenStreetMap, que no pide clave. Nunca falla: si no
 * hay respuesta, los campos quedan para llenarse a mano.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<ReversePlace> {
  const empty = { city: null, address: null };
  try {
    const key = await mapsKey();
    if (key) {
      const { body } = await mapsFetch(
        `https://maps.googleapis.com/maps/api/geocode/json?${new URLSearchParams({ latlng: `${lat},${lng}`, language: "es", key })}`,
      );
      if (body.status === "OK") {
        const results = body.results as { types: string[]; formatted_address: string; address_components: { long_name: string; types: string[] }[] }[];
        const all = results.flatMap((r) => r.address_components);
        const city =
          all.find((c) => c.types.includes("locality"))?.long_name ??
          all.find((c) => c.types.includes("administrative_area_level_2"))?.long_name ??
          null;
        const street = results.find((r) => r.types.some((t) => ["street_address", "premise", "route"].includes(t)));
        return { city: city ? cleanCity(city) : null, address: street?.formatted_address.split(",")[0].trim() ?? null };
      }
    }

    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?${new URLSearchParams({ lat: String(lat), lon: String(lng), format: "jsonv2", zoom: "18", "accept-language": "es" })}`,
      { headers: { "User-Agent": "FittGlobalCRM/1.0 (crm.fittglobal.com)" }, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!res.ok) return empty;
    const a = ((await res.json()) as { address?: Record<string, string> }).address ?? {};
    const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? null;
    const address = a.road ? [a.road, a.house_number && `# ${a.house_number}`].filter(Boolean).join(" ") : null;
    return { city: city ? cleanCity(city) : null, address };
  } catch {
    return empty;
  }
}
