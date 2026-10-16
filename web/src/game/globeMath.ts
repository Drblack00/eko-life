/**
 * Pure (three.js-free) math for the travel globe. Kept dependency-free so it
 * can be unit-tested without WebGL.
 *
 * Coordinate convention (matches three.js SphereGeometry UVs, same as the
 * approved mockup): x = r·cos(lat)·cos(lon), y = r·sin(lat),
 * z = −r·cos(lat)·sin(lon). Nigeria at (9.08, 8.68) lands on Nigeria on the
 * bundled blue-marble texture.
 */

export const GLOBE_R = 100;
export const NIGERIA_LAT = 9.08;
export const NIGERIA_LON = 8.68;

/** Playable cities as [lat, lon] (real coordinates, from the mockup). */
export const CITY_LATLON: Record<string, [number, number]> = {
  lagos: [6.5244, 3.3792],
  benin: [6.335, 5.6037],
  ph: [4.8156, 7.0498],
  abuja: [9.0579, 7.4951],
};

export const CITY_DISPLAY: Record<string, string> = {
  lagos: "Lagos",
  benin: "Benin City",
  ph: "Port Harcourt",
  abuja: "Abuja",
};

export interface LockedCountry {
  id: string;
  name: string;
  /** Flag emoji. */
  flag: string;
  lat: number;
  lon: number;
}

/** Countries visible on the globe but not yet travelable. */
export const LOCKED_COUNTRIES: LockedCountry[] = [
  { id: "ghana", name: "Ghana", flag: "🇬🇭", lat: 7.9, lon: -1.2 },
  { id: "cameroon", name: "Cameroon", flag: "🇨🇲", lat: 5.7, lon: 12.7 },
  { id: "benin-country", name: "Benin", flag: "🇧🇯", lat: 9.3, lon: 2.3 },
  { id: "niger", name: "Niger", flag: "🇳🇪", lat: 17.6, lon: 8.1 },
  { id: "uk", name: "United Kingdom", flag: "🇬🇧", lat: 54, lon: -2 },
];

/** Journey-rail stages for the dive: Space → Orbit → Nigeria → State → City. */
export const JOURNEY_STAGES = [
  { id: "space", icon: "🛰️", label: "SPACE" },
  { id: "orbit", icon: "🌍", label: "ORBIT" },
  { id: "nigeria", icon: "🇳🇬", label: "NIGERIA" },
  { id: "state", icon: "🏙️", label: "STATE" },
  { id: "city", icon: "📍", label: "CITY" },
] as const;

export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

/** Smoothstep in [0, 1] between edges a and b. */
export function smooth(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Ease-in-out for cinematic moves. */
export function easeIO(x: number): number {
  const t = clamp(x, 0, 1);
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** [lat, lon] in degrees → [x, y, z] on a sphere of radius r. */
export function latLonToVec3(
  lat: number,
  lon: number,
  r: number
): [number, number, number] {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  return [
    r * Math.cos(la) * Math.cos(lo),
    r * Math.sin(la),
    -r * Math.cos(la) * Math.sin(lo),
  ];
}

/** Which journey stage a master-zoom value T ∈ [0, 1] sits in. */
export function zoomStage(t: number): number {
  if (t < 0.18) return 0;
  if (t < 0.42) return 1;
  if (t < 0.62) return 2;
  if (t < 0.85) return 3;
  return 4;
}

/**
 * Great-circle arc points between two lat/lon pairs, lifted above the globe
 * (sinusoidal lift, higher for longer hops). Returns [x, y, z] tuples on a
 * sphere of radius r. Pure math — the component turns these into a tube.
 */
export function greatCirclePoints(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  r: number,
  n = 72
): Array<[number, number, number]> {
  const a = latLonToVec3(lat1, lon1, 1);
  const b = latLonToVec3(lat2, lon2, 1);
  const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
  const ang = Math.acos(dot);
  const sinA = Math.sin(ang) || 1e-6;
  const lift = 9 + ang * 90;
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const k1 = Math.sin((1 - t) * ang) / sinA;
    const k2 = Math.sin(t * ang) / sinA;
    const px = a[0] * k1 + b[0] * k2;
    const py = a[1] * k1 + b[1] * k2;
    const pz = a[2] * k1 + b[2] * k2;
    const len = Math.hypot(px, py, pz) || 1;
    const target = r + 1.2 + Math.sin(t * Math.PI) * lift;
    pts.push([(px / len) * target, (py / len) * target, (pz / len) * target]);
  }
  return pts;
}

/**
 * Tangent-space pan that centers the deep-zoom camera on a city, given the
 * flat projection used by the Nigeria detail group.
 * (project is injected so this stays three-free.)
 */
export function cityPanOffset(
  project: (lon: number, lat: number) => [number, number],
  cityId: string
): [number, number] {
  const ll = CITY_LATLON[cityId];
  if (!ll) return [0, 0];
  const [lx, lz] = project(CITY_LATLON.lagos[1], CITY_LATLON.lagos[0]);
  const [cx, cz] = project(ll[1], ll[0]);
  // Calibrated: (-5.65, 2.45) centers Lagos at max zoom (from the mockup).
  return [-5.65 + (cx - lx) * 0.06, 2.45 + (cz - lz) * 0.06];
}
