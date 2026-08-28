/**
 * Motor de priorización y ruteo de visitas.
 *
 * Responde a dos preguntas distintas y las mantiene separadas a propósito:
 *   1. ¿A qué tienda vale más la pena ir hoy?  → scoreStores()
 *   2. Dado ese criterio, ¿en qué orden y cuántas caben en la jornada? → buildRoute()
 *
 * El score es explicable: cada tienda devuelve las razones que lo componen para
 * que el mercaderista y su supervisor entiendan por qué está arriba en la lista.
 */

export const SPEED_KMH = 22; // velocidad media urbana puerta a puerta
export const PARKING_MINUTES = 4; // fricción fija por parada (estacionar, entrar, ubicar al encargado)

export type StoreForRouting = {
  id: string;
  code: string;
  name: string;
  companyName: string;
  lat: number;
  lng: number;
  zone: string;
  city: string;
  tier: string;
  format: string;
  visitsPerMonth: number;
  avgVisitMinutes: number;
  lastVisitAt: Date | null;
  openIncidents: { severity: string }[];
  outOfStockSkus: number;
  nearExpiryUnits: number;
  sales90d: number;
};

export type ScoreReason = { label: string; points: number };

export type ScoredStore = StoreForRouting & {
  score: number;
  targetIntervalDays: number;
  daysSinceVisit: number | null;
  overdueDays: number;
  reasons: ScoreReason[];
};

export const WEIGHTS = {
  frequency: 35, // cumplir la frecuencia comprometida con el cliente
  value: 25, // proteger la facturación: tiendas que más venden pesan más
  incidents: 20, // novedades abiertas sin resolver
  outOfStock: 12, // quiebres detectados en la última visita
  expiry: 8, // producto próximo a vencer en góndola
} as const;

const SEVERITY_POINTS: Record<string, number> = { CRITICA: 1, ALTA: 0.7, MEDIA: 0.4, BAJA: 0.15 };

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function travelMinutes(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const km = haversineKm(a, b) * 1.3; // factor de trazado real vs línea recta
  return Math.round((km / SPEED_KMH) * 60) + PARKING_MINUTES;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Convierte el estado de cada tienda en un score 0–100 comparable entre sí.
 * El componente de valor es relativo al conjunto evaluado, no absoluto: lo que
 * importa es cuál de *estas* tiendas mueve más plata.
 */
export function scoreStores(stores: StoreForRouting[], today = new Date()): ScoredStore[] {
  const maxSales = Math.max(1, ...stores.map((s) => s.sales90d));

  return stores
    .map((store) => {
      const targetIntervalDays = Math.max(1, Math.round(30 / Math.max(1, store.visitsPerMonth)));
      const daysSinceVisit = store.lastVisitAt
        ? Math.floor((today.getTime() - new Date(store.lastVisitAt).getTime()) / 86_400_000)
        : null;
      // Sin historial la tratamos como si llevara un ciclo y medio sin visita.
      const effectiveDays = daysSinceVisit ?? Math.round(targetIntervalDays * 1.5);
      const overdueDays = effectiveDays - targetIntervalDays;

      const reasons: ScoreReason[] = [];

      // 1. Frecuencia comprometida
      const freqRatio = clamp(effectiveDays / targetIntervalDays, 0, 2) / 2;
      const freqPoints = freqRatio * WEIGHTS.frequency;
      reasons.push({
        label:
          daysSinceVisit === null
            ? "Sin visitas registradas"
            : overdueDays > 0
              ? `${overdueDays} día${overdueDays === 1 ? "" : "s"} de atraso (objetivo cada ${targetIntervalDays})`
              : `Al día — visitada hace ${daysSinceVisit} día${daysSinceVisit === 1 ? "" : "s"}`,
        points: freqPoints,
      });

      // 2. Valor comercial relativo (raíz para no aplastar a las tiendas medianas)
      const valueRatio = Math.sqrt(store.sales90d / maxSales);
      const valuePoints = valueRatio * WEIGHTS.value;
      if (store.sales90d > 0) {
        reasons.push({ label: `Facturación 90 d: ${Math.round(store.sales90d).toLocaleString("es-CO")}`, points: valuePoints });
      }

      // 3. Novedades abiertas
      const severityLoad = store.openIncidents.reduce((sum, i) => sum + (SEVERITY_POINTS[i.severity] ?? 0.2), 0);
      const incidentPoints = clamp(severityLoad / 2.5, 0, 1) * WEIGHTS.incidents;
      if (store.openIncidents.length) {
        reasons.push({
          label: `${store.openIncidents.length} novedad${store.openIncidents.length === 1 ? "" : "es"} abierta${store.openIncidents.length === 1 ? "" : "s"}`,
          points: incidentPoints,
        });
      }

      // 4. Quiebres en la última medición de góndola
      const oosPoints = clamp(store.outOfStockSkus / 4, 0, 1) * WEIGHTS.outOfStock;
      if (store.outOfStockSkus > 0) {
        reasons.push({ label: `${store.outOfStockSkus} SKU en quiebre`, points: oosPoints });
      }

      // 5. Producto por vencer en el punto de venta
      const expiryPoints = clamp(store.nearExpiryUnits / 40, 0, 1) * WEIGHTS.expiry;
      if (store.nearExpiryUnits > 0) {
        reasons.push({ label: `${store.nearExpiryUnits} u. próximas a vencer en góndola`, points: expiryPoints });
      }

      const score = Math.round(freqPoints + valuePoints + incidentPoints + oosPoints + expiryPoints);

      return {
        ...store,
        score,
        targetIntervalDays,
        daysSinceVisit,
        overdueDays,
        reasons: reasons.sort((a, b) => b.points - a.points).map((r) => ({ ...r, points: Math.round(r.points) })),
      };
    })
    .sort((a, b) => b.score - a.score);
}

export type RouteStop = {
  store: ScoredStore;
  sequence: number;
  travelMinutes: number;
  arrivalMinute: number; // minutos desde el inicio de la jornada
  departureMinute: number;
};

export type RoutePlan = {
  stops: RouteStop[];
  skipped: ScoredStore[];
  totalTravelMinutes: number;
  totalVisitMinutes: number;
  capturedScore: number;
  availableScore: number;
  distanceKm: number;
};

export type RouteOptions = {
  origin: { lat: number; lng: number };
  workdayMinutes?: number;
  maxStops?: number;
  returnToOrigin?: boolean;
};

/**
 * Selección + secuenciación.
 *
 * Selección greedy por *eficiencia* (score ganado por minuto invertido), no por
 * score puro: una tienda excelente al otro lado de la ciudad puede costar tres
 * paradas cercanas. Después se afina el orden con 2-opt, que sólo reduce
 * desplazamiento y no cambia qué tiendas se visitan.
 */
export function buildRoute(scored: ScoredStore[], opts: RouteOptions): RoutePlan {
  const workdayMinutes = opts.workdayMinutes ?? 8 * 60;
  const maxStops = opts.maxStops ?? 12;

  const pending = [...scored];
  const selected: ScoredStore[] = [];
  let cursor = opts.origin;
  let spent = 0;

  while (selected.length < maxStops && pending.length) {
    let bestIndex = -1;
    let bestEfficiency = -Infinity;
    let bestCost = 0;

    for (let i = 0; i < pending.length; i++) {
      const candidate = pending[i];
      const travel = travelMinutes(cursor, candidate);
      const cost = travel + candidate.avgVisitMinutes;
      const returnCost = opts.returnToOrigin ? travelMinutes(candidate, opts.origin) : 0;
      if (spent + cost + returnCost > workdayMinutes) continue;

      const efficiency = candidate.score / cost;
      if (efficiency > bestEfficiency) {
        bestEfficiency = efficiency;
        bestIndex = i;
        bestCost = cost;
      }
    }

    if (bestIndex === -1) break;
    const chosen = pending.splice(bestIndex, 1)[0];
    selected.push(chosen);
    spent += bestCost;
    cursor = chosen;
  }

  const ordered = twoOpt(selected, opts.origin);

  const stops: RouteStop[] = [];
  let clock = 0;
  let from = opts.origin;
  let distanceKm = 0;

  ordered.forEach((store, index) => {
    const travel = travelMinutes(from, store);
    distanceKm += haversineKm(from, store) * 1.3;
    const arrivalMinute = clock + travel;
    const departureMinute = arrivalMinute + store.avgVisitMinutes;
    stops.push({ store, sequence: index + 1, travelMinutes: travel, arrivalMinute, departureMinute });
    clock = departureMinute;
    from = store;
  });

  if (opts.returnToOrigin && stops.length) {
    distanceKm += haversineKm(from, opts.origin) * 1.3;
  }

  const totalTravelMinutes = stops.reduce((s, x) => s + x.travelMinutes, 0);
  const totalVisitMinutes = stops.reduce((s, x) => s + x.store.avgVisitMinutes, 0);

  return {
    stops,
    skipped: pending,
    totalTravelMinutes,
    totalVisitMinutes,
    capturedScore: stops.reduce((s, x) => s + x.store.score, 0),
    availableScore: scored.reduce((s, x) => s + x.score, 0),
    distanceKm: Math.round(distanceKm * 10) / 10,
  };
}

/** Mejora local clásica: deshace cruces en el recorrido sin alterar la selección. */
function twoOpt<T extends { lat: number; lng: number }>(route: T[], origin: { lat: number; lng: number }): T[] {
  if (route.length < 4) return route;
  let best = [...route];
  let improved = true;
  let guard = 0;

  const length = (path: T[]) => {
    let total = haversineKm(origin, path[0]);
    for (let i = 0; i < path.length - 1; i++) total += haversineKm(path[i], path[i + 1]);
    return total;
  };

  let bestLength = length(best);

  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        const candidateLength = length(candidate);
        if (candidateLength < bestLength - 0.001) {
          best = candidate;
          bestLength = candidateLength;
          improved = true;
        }
      }
    }
  }
  return best;
}

/** Convierte minutos desde el inicio de jornada en hora de reloj. */
export function clockAt(startHour: number, minutes: number) {
  const total = startHour * 60 + minutes;
  const h = Math.floor(total / 60) % 24;
  const m = Math.round(total % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
