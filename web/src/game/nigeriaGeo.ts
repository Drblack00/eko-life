/**
 * Nigeria travel-map data: real geography for the 3D inter-city travel view.
 *
 * Data sources (fetched 2026-10-16, served from /geo/):
 * - nigeria-outline.json: simplified Nigeria border (Natural Earth), [[[lon,lat],...]]
 * - nigeria-states.json:  all 37 state borders (GADM level 1), [{name, polys}]
 * - nigeria-roads.json:   22 real OSRM driving routes, {"a|b": {km, hours, coords}}
 * - nigeria-rivers.json:  real river centerlines (Natural Earth), [{name, segs}]
 * - nigeria-hubs.json:    14 city coords {id: [lon, lat]}
 *
 * Fare formula matches the server EXACTLY
 * (server/src/game/cities.js → cityTravelFare).
 */

/** Country border rings: [[[lon, lat], ...], ...] */
export type NigeriaOutline = Array<Array<[number, number]>>;

export interface StateBorder {
  name: string;
  polys: Array<Array<[number, number]>>;
}

export interface RoadSegment {
  km: number;
  hours: number;
  coords: Array<[number, number]>;
}

/** Route keys are "a|b" (direction-agnostic lookup via roadKey). */
export type RoadNetwork = Record<string, RoadSegment>;

export interface River {
  name: string;
  major?: boolean;
  segs: Array<Array<[number, number]>>;
}

export type Hubs = Record<string, [number, number]>;

export interface NigeriaGeo {
  outline: NigeriaOutline;
  states: StateBorder[];
  roads: RoadNetwork;
  rivers: River[];
  hubs: Hubs;
}

const BASE = `${import.meta.env.BASE_URL}geo/`;

let cached: Promise<NigeriaGeo> | null = null;

/** Load (once, cached) all Nigeria geo JSONs. */
export function loadNigeriaGeo(): Promise<NigeriaGeo> {
  if (!cached) {
    cached = (async () => {
      const [outline, states, roads, rivers, hubs] = await Promise.all([
        fetch(`${BASE}nigeria-outline.json`).then((r) => r.json()),
        fetch(`${BASE}nigeria-states.json`).then((r) => r.json()),
        fetch(`${BASE}nigeria-roads.json`).then((r) => r.json()),
        fetch(`${BASE}nigeria-rivers.json`).then((r) => r.json()),
        fetch(`${BASE}nigeria-hubs.json`).then((r) => r.json()),
      ]);
      return { outline, states, roads, rivers, hubs } as NigeriaGeo;
    })();
  }
  return cached;
}

/* ---------------- map projection ----------------
 * Nigeria lon [2.6, 14.8] → x [-110, 110]
 *         lat [4.2, 13.8] → z [80, -80] (north = -z)
 */
const LON0 = 2.6;
const LON1 = 14.8;
const LAT0 = 4.2;
const LAT1 = 13.8;

/** Project [lon, lat] → [x, z] in 3D scene units. */
export function project(lon: number, lat: number): [number, number] {
  return [
    -110 + ((lon - LON0) / (LON1 - LON0)) * 220,
    80 + ((lat - LAT0) / (LAT1 - LAT0)) * -160,
  ];
}

/* ---------------- fares (mirror of server/src/game/cities.js) ---------------- */

/**
 * Straight-line road distances in km between playable cities,
 * exactly as the server defines them.
 */
export const CITY_KM: Record<string, number> = {
  "benin|lagos": 300,
  "lagos|ph": 610,
  "abuja|lagos": 750,
  "benin|ph": 280,
  "abuja|benin": 470,
  "abuja|ph": 560,
};

function cityDistanceKm(a: string, b: string): number {
  if (a === b) return 0;
  return CITY_KM[`${a}|${b}`] ?? CITY_KM[`${b}|${a}`] ?? 500;
}

export type TravelMode = "bus" | "flight";

/**
 * Inter-city fare in game coins. Bus is cheap/slow, flight is expensive/fast.
 * Same city → 0.
 */
export function cityTravelFare(
  fromId: string,
  toId: string,
  mode: TravelMode
): number {
  const km = cityDistanceKm(fromId, toId);
  if (km === 0) return 0;
  if (mode === "flight") return Math.round((4000 + 12 * km) / 100) * 100;
  return Math.round((800 + 4 * km) / 50) * 50; // bus (default)
}

/** Direction-agnostic road lookup: "lagos|benin" or "benin|lagos". */
export function roadKey(a: string, b: string): string {
  return `${a}|${b}`;
}

export function findRoad(
  roads: RoadNetwork,
  a: string,
  b: string
): RoadSegment | null {
  return roads[`${a}|${b}`] ?? roads[`${b}|${a}`] ?? null;
}

/** Game city id → state border name (for highlight outlines). */
export const CITY_STATE: Record<string, string> = {
  lagos: "Lagos",
  benin: "Edo",
  ph: "Rivers",
  abuja: "FederalCapitalTerritory",
};

/** The 6 playable hero routes between the 4 game cities. */
export const HERO_ROUTES = [
  "lagos|benin",
  "lagos|ph",
  "lagos|abuja",
  "benin|ph",
  "benin|abuja",
  "ph|abuja",
];

/** Playable city ids (the 4 game cities). */
export const PLAYABLE_CITIES = ["lagos", "benin", "ph", "abuja"];
