import "server-only";
import { prisma } from "./prisma";
import { brandOf, cityKey, cleanAddress, cleanStoreName, inCity, mapsFetch, mapsKey, MapsApiError } from "./geocoding";
import { haversineKm } from "./routing";
import { norm } from "./store-import";
import { notify } from "./notifications";

/**
 * Localizador de tiendas: encuentra en Google Maps los puntos de venta de las
 * cadenas que el maestro todavía no tiene.
 *
 * Por cada cadena y cada ciudad donde ya hay tiendas suyas se busca la marca en
 * Places API (Text Search). Cada lugar que devuelve Google cae en uno de tres
 * casos:
 *
 * 1. Ya es una tienda del maestro (mismo `placeId`): no pasa nada.
 * 2. Se parece sin ambigüedad a una tienda sin `placeId` —está a menos de
 *    150 m o se llama igual—: se vincula, y si la tienda no tenía coordenadas
 *    las toma de Google. Así el localizador también geocodifica.
 * 3. No se parece a ninguna: queda como tienda descubierta, se avisa y una
 *    persona decide si se crea, se vincula a mano o se descarta.
 *
 * Google corta cada búsqueda en 60 resultados. Si una ciudad los llena
 * (Olímpica o Colsubsidio en Bogotá), se parte en cuadrantes y se busca la
 * marca dentro de cada uno.
 */

const PAGE_SIZE = 20;
const MAX_PAGES = 3; // tope de Google: 60 resultados por búsqueda
const MAX_DEPTH = 2; // ciudad → 4 cuadrantes → 16
const MAX_REQUESTS = 30; // por búsqueda, para que una ciudad no se coma la cuota

const LINK_METERS = 150;
const SUGGEST_METERS = 400;

/**
 * Reglas por cadena. `types`, si está, exige que Google clasifique el lugar
 * con alguno de esos tipos: Colsubsidio también es caja de compensación, con
 * sedes, clínicas y supermercados que no son clientes.
 */
const CHAIN_RULES: Record<string, { types?: string[] }> = {
  "Droguería Colsubsidio": { types: ["pharmacy", "drugstore"] },
};

/** Lugares que llevan la marca pero nunca son un punto de venta. */
const NOT_A_STORE = new Set([
  "atm", "bank", "parking", "gas_station", "corporate_office", "insurance_agency",
  "finance", "lodging", "hospital", "doctor", "school", "university", "event_venue",
  "travel_agency", "car_repair", "car_wash", "storage", "moving_company",
]);

type Place = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  mapsUrl: string | null;
  types: string[];
};

type Box = { low: { latitude: number; longitude: number }; high: { latitude: number; longitude: number } };

type Json = Record<string, unknown>;

// ────────────────────────────  Búsqueda en Google  ───────────────────────────

const FIELDS = [
  "places.id", "places.displayName", "places.formattedAddress", "places.location",
  "places.businessStatus", "places.googleMapsUri", "places.types", "nextPageToken",
].join(",");

class Budget {
  used = 0;
  truncated = false;
  take() {
    if (this.used >= MAX_REQUESTS) {
      this.truncated = true;
      return false;
    }
    this.used++;
    return true;
  }
}

/** Hasta 60 lugares de una consulta; `saturated` si Google tenía más. */
async function textSearch(key: string, textQuery: string, box: Box | null, budget: Budget) {
  const places: Json[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (!budget.take()) break;
    const { res, body } = await mapsFetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS },
      body: JSON.stringify({
        textQuery,
        regionCode: "CO",
        languageCode: "es",
        pageSize: PAGE_SIZE,
        ...(box ? { locationRestriction: { rectangle: box } } : {}),
        ...(pageToken ? { pageToken } : {}),
      }),
    });
    if (res.status === 403) throw new MapsApiError("Places API (New) no está habilitada para esta clave.");
    if (res.status === 429) throw new MapsApiError("Places API: cuota agotada, intenta más tarde.");
    if (!res.ok) throw new MapsApiError(`Places API: ${res.status} ${String((body.error as Json | undefined)?.message ?? "")}`.trim());

    places.push(...((body.places as Json[] | undefined) ?? []));
    pageToken = body.nextPageToken as string | undefined;
    if (!pageToken) return { places, saturated: false };
  }
  return { places, saturated: !!pageToken };
}

/** Rectángulo que Google le da a la ciudad, para partirla cuando se satura. */
async function cityBox(key: string, city: string, budget: Budget): Promise<Box | null> {
  if (!budget.take()) return null;
  const { body } = await mapsFetch(
    `https://maps.googleapis.com/maps/api/geocode/json?${new URLSearchParams({ address: `${city}, Colombia`, components: "country:CO", language: "es", key })}`,
  );
  const viewport = ((body.results as Json[] | undefined)?.[0]?.geometry as Json | undefined)?.viewport as
    | { northeast: { lat: number; lng: number }; southwest: { lat: number; lng: number } }
    | undefined;
  if (!viewport) return null;
  return {
    low: { latitude: viewport.southwest.lat, longitude: viewport.southwest.lng },
    high: { latitude: viewport.northeast.lat, longitude: viewport.northeast.lng },
  };
}

function quadrants(b: Box): Box[] {
  const midLat = (b.low.latitude + b.high.latitude) / 2;
  const midLng = (b.low.longitude + b.high.longitude) / 2;
  return [
    { low: b.low, high: { latitude: midLat, longitude: midLng } },
    { low: { latitude: b.low.latitude, longitude: midLng }, high: { latitude: midLat, longitude: b.high.longitude } },
    { low: { latitude: midLat, longitude: b.low.longitude }, high: { latitude: b.high.latitude, longitude: midLng } },
    { low: { latitude: midLat, longitude: midLng }, high: b.high },
  ];
}

/** ¿El lugar es una tienda abierta de la cadena, en la ciudad buscada? */
function asStore(raw: Json, brand: string, city: string): Place | null {
  const name = String((raw.displayName as Json | undefined)?.text ?? "");
  const address = String(raw.formattedAddress ?? "");
  const location = raw.location as { latitude: number; longitude: number } | undefined;
  const types = (raw.types as string[] | undefined) ?? [];
  if (!raw.id || !location || raw.businessStatus === "CLOSED_PERMANENTLY") return null;

  const brandWord = norm(brand).split(" ").pop()!;
  if (!norm(name).includes(brandWord)) return null;
  if (types.some((t) => NOT_A_STORE.has(t))) return null;
  const required = CHAIN_RULES[brand]?.types;
  if (required && !types.some((t) => required.includes(t))) return null;
  if (!inCity(address.split(","), city)) return null;

  return {
    id: String(raw.id),
    name,
    address,
    lat: location.latitude,
    lng: location.longitude,
    mapsUrl: (raw.googleMapsUri as string | undefined) ?? null,
    types,
  };
}

/** Todos los lugares de la cadena en la ciudad, partiendo el mapa si hace falta. */
async function findChainInCity(key: string, brand: string, city: string) {
  const budget = new Budget();
  const found = new Map<string, Place>();
  const keep = (raws: Json[]) => {
    for (const raw of raws) {
      const p = asStore(raw, brand, city);
      if (p) found.set(p.id, p);
    }
  };

  const first = await textSearch(key, `${brand} ${city}`, null, budget);
  keep(first.places);

  if (first.saturated) {
    const box = await cityBox(key, city, budget);
    const queue: { box: Box; depth: number }[] = box ? quadrants(box).map((b) => ({ box: b, depth: 1 })) : [];
    while (queue.length && !budget.truncated) {
      const cell = queue.shift()!;
      const r = await textSearch(key, brand, cell.box, budget);
      keep(r.places);
      if (r.saturated && cell.depth < MAX_DEPTH) queue.push(...quadrants(cell.box).map((b) => ({ box: b, depth: cell.depth + 1 })));
    }
  }

  return { places: [...found.values()], requests: budget.used, truncated: budget.truncated };
}

// ───────────────────────────  Casar con el maestro  ──────────────────────────

const ABBREVIATIONS: Record<string, string> = {
  CL: "CALLE", CLL: "CALLE", CR: "CARRERA", CRA: "CARRERA", KR: "CARRERA", KRA: "CARRERA",
  AV: "AVENIDA", AVDA: "AVENIDA", DG: "DIAGONAL", TV: "TRANSVERSAL", CC: "CENTRO COMERCIAL",
};
const STOPWORDS = new Set([
  "DE", "LA", "EL", "DEL", "LOS", "LAS", "Y", "EN", "CON", "SUR", "NORTE", "NTE",
  "SUPERTIENDA", "SUPERMERCADO", "DROGUERIA", "FARMACIA", "TIENDA", "COLOMBIA",
]);

function tokens(text: string, drop: Set<string>) {
  return new Set(
    norm(text)
      .replace(/[^A-Z0-9 ]+/g, " ")
      .split(" ")
      .flatMap((w) => (ABBREVIATIONS[w] ?? w).split(" "))
      .filter((w) => w && !STOPWORDS.has(w) && !drop.has(w)),
  );
}

/** Lo que distingue a la sede: «STO 402 CL 100» → {CALLE, 100}; «PRICESMART MENGA» → {MENGA}. */
function storeTokens(name: string, brand: string, city: string) {
  const drop = new Set([...norm(brand).split(" "), ...cityKey(city).split(" ")]);
  return tokens(cleanStoreName(norm(name), brand), drop);
}

/** Los dos primeros números de la dirección: «CRA 53 # 106-280» → «53 106». */
function plate(address: string | null) {
  const nums = norm(cleanAddress(address ?? "")).match(/\d+/g) ?? [];
  return nums.length >= 2 ? `${nums[0]} ${nums[1]}` : null;
}

type Known = { id: string; name: string; lat: number | null; lng: number | null; tokens: Set<string>; plate: string | null };

type Match = { kind: "link"; store: Known; exact: boolean } | { kind: "suggest"; store: Known } | null;

/**
 * Google suele nombrar las sedes sólo con la marca («PriceSmart») y el barrio
 * va en la dirección, así que la sede se busca en nombre + dirección. Los
 * números distinguen sedes («Calle 72» no es «Calle 100»): deben estar todos.
 */
function match(place: Place, pool: Known[], brand: string, city: string): Match {
  const placeInfo = tokens(`${place.name} ${place.address}`, new Set(norm(brand).split(" ")));
  const placePlate = plate(place.address.split(",")[0]);
  const ranked = pool
    .map((s) => {
      const words = [...s.tokens];
      const hits = words.filter((w) => placeInfo.has(w)).length;
      const numbersOk = words.filter((w) => /\d/.test(w)).every((w) => placeInfo.has(w));
      return {
        store: s,
        meters: s.lat != null && s.lng != null ? haversineKm(place, { lat: s.lat, lng: s.lng }) * 1000 : null,
        score: words.length && numbersOk ? hits / words.length : 0,
        sameAddress: !!placePlate && placePlate === s.plate,
      };
    })
    .sort((x, y) => (x.meters ?? Infinity) - (y.meters ?? Infinity) || y.score - x.score);

  const near = ranked.filter((r) => r.meters != null && r.meters <= LINK_METERS);
  if (near.length === 1 || (near.length > 1 && near[0].meters! < 40)) return { kind: "link", store: near[0].store, exact: true };

  // Fuera de rango si la tienda ya está ubicada en otro sitio.
  const plausible = ranked.filter((r) => r.meters == null || r.meters <= SUGGEST_METERS);
  const byAddress = plausible.filter((r) => r.sameAddress);
  if (byAddress.length === 1) return { kind: "link", store: byAddress[0].store, exact: true };

  const [best, second] = [...plausible].sort((x, y) => y.score - x.score);
  if (best && best.score === 1 && (!second || second.score < 1)) return { kind: "link", store: best.store, exact: false };

  const close = ranked.find((r) => r.meters != null && r.meters <= SUGGEST_METERS);
  if (close) return { kind: "suggest", store: close.store };
  if (best && best.score >= 0.5) return { kind: "suggest", store: best.store };
  // Única tienda de la cadena sin casar en la ciudad: buen candidato para confirmar a ojo.
  if (pool.length === 1) return { kind: "suggest", store: pool[0] };
  return null;
}

/**
 * Nombre para la tienda que se crea desde Maps. Si Google sólo da la marca
 * («PriceSmart»), se completa con la calle para distinguir la sede.
 */
export function storeNameFor(c: { name: string; address: string | null; city: string }, companyName: string) {
  const brand = brandOf(companyName) ?? companyName;
  if (storeTokens(c.name, brand, c.city).size || !c.address) return c.name;
  return `${c.name} ${c.address.split(",")[0].trim()}`;
}

// ─────────────────────────────  Búsquedas a correr  ──────────────────────────

/** Cadenas que el localizador sabe buscar: tipo CADENA y marca conocida. */
async function chains() {
  const companies = await prisma.company.findMany({ where: { type: "CADENA", active: true }, select: { id: true, name: true } });
  return companies.flatMap((c) => {
    const brand = brandOf(c.name);
    return brand ? [{ ...c, brand }] : [];
  });
}

/** Una búsqueda por cada ciudad donde la cadena ya tiene tiendas. */
async function syncSearches(list: { id: string; brand: string }[]) {
  const [cities, existing] = await Promise.all([
    prisma.store.groupBy({ by: ["companyId", "city"], where: { companyId: { in: list.map((c) => c.id) }, city: { not: "Sin ciudad" } } }),
    prisma.locatorSearch.findMany({ select: { companyId: true, city: true } }),
  ]);
  const have = new Set(existing.map((s) => `${s.companyId}|${s.city}`));
  const brand = new Map(list.map((c) => [c.id, c.brand]));
  const missing = cities.filter((c) => !have.has(`${c.companyId}|${c.city}`));
  if (missing.length) {
    await prisma.locatorSearch.createMany({
      data: missing.map((c) => ({ companyId: c.companyId, city: c.city, query: `${brand.get(c.companyId)} ${c.city}` })),
    });
  }
}

// ─────────────────────────────────  Por lotes  ───────────────────────────────

export type LocatorBatch = {
  processed: number;
  remaining: number;
  places: number;
  linked: number;
  found: number;
  requests: number;
  error?: string;
};

/**
 * Corre las búsquedas más viejas que `before`. El navegador la llama en bucle
 * (con `before` = inicio de la corrida) y el cron una vez por tanda (con
 * `before` = hace una semana). Avisa al final de cada lote, agrupado por cadena.
 */
export async function locatorBatch(opts: { size: number; before: Date }): Promise<LocatorBatch> {
  const result: LocatorBatch = { processed: 0, remaining: 0, places: 0, linked: 0, found: 0, requests: 0 };
  const key = await mapsKey();
  if (!key) return { ...result, error: "Configura la API key de Google Maps en Conexiones." };

  const list = await chains();
  if (!list.length) return result;
  await syncSearches(list);
  const brand = new Map(list.map((c) => [c.id, c]));

  const where = {
    companyId: { in: list.map((c) => c.id) },
    OR: [{ lastRunAt: null }, { lastRunAt: { lt: opts.before } }],
  };
  const searches = await prisma.locatorSearch.findMany({ where, orderBy: [{ lastRunAt: "asc" }, { createdAt: "asc" }], take: opts.size });

  const newByCompany = new Map<string, number>();

  for (const search of searches) {
    const chain = brand.get(search.companyId)!;
    let outcome;
    try {
      outcome = await findChainInCity(key, chain.brand, search.city);
    } catch (e) {
      result.error = e instanceof Error ? e.message : "Error de Google Maps";
      await prisma.locatorSearch.update({ where: { id: search.id }, data: { lastError: result.error } });
      break;
    }
    result.requests += outcome.requests;

    const ids = outcome.places.map((p) => p.id);
    const [linkedStores, candidates, unlinked] = await Promise.all([
      prisma.store.findMany({ where: { placeId: { in: ids } }, select: { id: true, placeId: true } }),
      prisma.storeCandidate.findMany({ where: { placeId: { in: ids } }, select: { id: true, placeId: true, status: true, suggestedStoreId: true } }),
      prisma.store.findMany({
        where: { companyId: search.companyId, city: search.city, placeId: null, geoStatus: { not: "DIGITAL" } },
        select: { id: true, name: true, address: true, lat: true, lng: true, geoStatus: true },
      }),
    ]);
    const linkedIds = new Set(linkedStores.map((s) => s.placeId));
    const candidateOf = new Map(candidates.map((c) => [c.placeId, c]));
    // Pendiente cuyo lugar ya tiene una tienda (se vinculó por otro camino): queda resuelta.
    for (const s of linkedStores) {
      const c = candidateOf.get(s.placeId!);
      if (c?.status === "NUEVA") await prisma.storeCandidate.update({ where: { id: c.id }, data: { status: "VINCULADA", storeId: s.id, lastSeenAt: new Date() } });
    }

    let pool: Known[] = unlinked.map((s) => ({ ...s, tokens: storeTokens(s.name, chain.brand, search.city), plate: plate(s.address) }));
    const geoStatus = new Map(unlinked.map((s) => [s.id, s.geoStatus]));
    let fresh = 0;

    // Las ya revisadas no se tocan; las que siguen sin decidir se vuelven a casar, porque el maestro mejora.
    const reviewed = outcome.places.filter((p) => !linkedIds.has(p.id) && (candidateOf.get(p.id)?.status ?? "NUEVA") !== "NUEVA");
    if (reviewed.length) await prisma.storeCandidate.updateMany({ where: { placeId: { in: reviewed.map((p) => p.id) } }, data: { lastSeenAt: new Date() } });
    const open = outcome.places.filter((p) => !linkedIds.has(p.id) && !reviewed.includes(p));

    // Dos pasadas: primero los vínculos seguros; las sugerencias, con lo que quede sin casar.
    const sure = open.filter((p) => match(p, pool, chain.brand, search.city)?.kind === "link");
    const rest = open.filter((p) => !sure.includes(p));

    for (const place of [...sure, ...rest]) {
      const previous = candidateOf.get(place.id);
      const m = match(place, pool, chain.brand, search.city);

      if (m?.kind === "link") {
        const located = !["PENDIENTE", "NO_ENCONTRADA"].includes(geoStatus.get(m.store.id) ?? "");
        await prisma.store.update({
          where: { id: m.store.id },
          data: {
            placeId: place.id,
            // Una tienda sin coordenadas las toma del lugar con el que se casó.
            ...(located
              ? {}
              : {
                  lat: place.lat,
                  lng: place.lng,
                  geoStatus: m.exact ? "UBICADA" : "POR_REVISAR",
                  geoSource: "PLACES",
                  geoMatch: `${place.name} · ${place.address}`,
                  geocodedAt: new Date(),
                }),
          },
        });
        if (previous) await prisma.storeCandidate.update({ where: { id: previous.id }, data: { status: "VINCULADA", storeId: m.store.id, lastSeenAt: new Date() } });
        pool = pool.filter((s) => s.id !== m.store.id);
        result.linked++;
        continue;
      }

      if (previous) {
        await prisma.storeCandidate.update({
          where: { id: previous.id },
          data: { lastSeenAt: new Date(), suggestedStoreId: m?.store.id ?? previous.suggestedStoreId },
        });
        continue;
      }

      // upsert: si dos ciudades vecinas devuelven el mismo lugar, sólo cuenta una vez.
      await prisma.storeCandidate.upsert({
        where: { placeId: place.id },
        update: { lastSeenAt: new Date() },
        create: {
          placeId: place.id,
          companyId: search.companyId,
          name: place.name,
          address: place.address,
          city: search.city,
          lat: place.lat,
          lng: place.lng,
          mapsUrl: place.mapsUrl,
          types: place.types.join(","),
          suggestedStoreId: m?.store.id ?? null,
        },
      });
      fresh++;
    }

    await prisma.locatorSearch.update({
      where: { id: search.id },
      data: {
        lastRunAt: new Date(),
        lastResults: outcome.places.length,
        lastNew: fresh,
        lastError: outcome.truncated ? `Búsqueda recortada a ${MAX_REQUESTS} consultas: puede haber más tiendas` : null,
      },
    });
    if (fresh) newByCompany.set(search.companyId, (newByCompany.get(search.companyId) ?? 0) + fresh);
    result.processed++;
    result.places += outcome.places.length;
    result.found += fresh;
  }

  for (const [companyId, count] of newByCompany) {
    const chain = brand.get(companyId)!;
    await notify({
      type: "TIENDA_ENCONTRADA",
      title: `${chain.brand}: ${count === 1 ? "1 tienda nueva" : `${count} tiendas nuevas`} en Google Maps`,
      body: "No están en el maestro. Revísalas para crearlas, vincularlas a una existente o descartarlas.",
      href: `/tiendas/descubiertas?cliente=${companyId}`,
    });
  }

  result.remaining = await prisma.locatorSearch.count({ where });
  return result;
}
