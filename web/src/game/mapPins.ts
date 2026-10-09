import type { ApiLocation } from "../lib/api";
import type { PinLocation } from "./stubLocations";

/**
 * Map an API location record onto CityMap world coordinates, defensively.
 * Server shape: { id, name, region:"mainland"|"lagoon"|"island", icon, x:0..100, y:0..100, blurb }
 * World space: x,z in [-90, 90].
 */
export function toPin(loc: ApiLocation, index: number, total: number): PinLocation {
  const zone =
    loc.zone === "island" || loc.zone === "lagoon" || loc.zone === "mainland"
      ? loc.zone
      : loc.region === "island" || loc.region === "lagoon" || loc.region === "mainland"
        ? loc.region
        : undefined;

  let x: number;
  let z: number;

  if (typeof loc.x === "number" && typeof loc.y === "number") {
    // Server sends 0..100 map coords: normalize to world space (-86..86).
    x = (loc.x / 100) * 172 - 86;
    z = (loc.y / 100) * 172 - 86;
  } else if (typeof loc.x === "number" && typeof loc.z === "number") {
    x = loc.x;
    z = loc.z;
  } else if (typeof loc.lat === "number" && typeof loc.lng === "number") {
    // Spread across the map; keep out of the lagoon channel.
    const nx = ((loc.lng % 1) + 1) % 1;
    const nz = ((loc.lat % 1) + 1) % 1;
    x = -80 + nx * 160;
    if (Math.abs(x) < 20) x = x < 0 ? -20 - nx * 40 : 20 + nx * 40;
    z = -80 + nz * 160;
  } else {
    // Deterministic scatter: alternate masses, spread along z.
    const side = zone === "island" ? 1 : zone === "mainland" ? -1 : index % 2 === 0 ? -1 : 1;
    x = side * (22 + ((index * 37) % 55));
    z = -78 + ((index * 53) % Math.max(1, total)) * (156 / Math.max(1, total));
  }

  return {
    id: String(loc.id ?? `loc-${index}`),
    name: String(loc.name ?? "Mystery spot"),
    emoji: loc.emoji || loc.icon || "📍",
    blurb:
      loc.blurb ||
      loc.desc ||
      "One of the city's favourite hangouts. Create a character to step inside.",
    x: Math.max(-86, Math.min(86, x)),
    z: Math.max(-86, Math.min(86, z)),
    zone: zone ?? (x < 0 ? "mainland" : x > 0 ? "island" : "lagoon"),
  };
}

/** Server `pos` / `mv` coords are map coords 0..100 (lat = map y, lng = map x). */
export function mapToWorld(lat: number, lng: number): { x: number; z: number } {
  return {
    x: Math.max(-86, Math.min(86, (lng / 100) * 172 - 86)),
    z: Math.max(-86, Math.min(86, (lat / 100) * 172 - 86)),
  };
}

/** Location-style map coords (x,y in 0..100, same as `toPin` input) → world. */
export function mapXYToWorld(mx: number, my: number): { x: number; z: number } {
  return {
    x: Math.max(-86, Math.min(86, (mx / 100) * 172 - 86)),
    z: Math.max(-86, Math.min(86, (my / 100) * 172 - 86)),
  };
}
