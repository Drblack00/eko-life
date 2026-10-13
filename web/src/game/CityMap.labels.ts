/**
 * CityMap place-label data + pure helpers.
 *
 * Real Lagos place names rendered as pill chips on the 3D city map, plus the
 * geometry/color helpers the renderer needs. Deliberately DOM- and
 * Three.js-free so the node vitest suite can import this module directly
 * (the suite is pure-logic only: no DOM, no Three.js).
 *
 * World space: x in [-86, 86] (-x = mainland/west, +x = island/east),
 * z in [-86, 86] (-z = north, +z = south). The lagoon channel is |x| < 13.
 */

export interface DistrictLabel {
  /** Display name — a real Lagos place. */
  name: string;
  x: number;
  z: number;
  zone: "mainland" | "island";
  /** Major districts render larger and are the anchor labels of the map. */
  size: "major" | "minor";
}

/**
 * Popular Lagos places at real-world relative positions. Island vs mainland
 * follows the 3D city's geography: Lekki / Victoria Island / Ikoyi on the
 * island side (east, +x), Ikeja / Yaba / Surulere / Apapa / Oshodi /
 * Maryland / Agege / Ikorodu on the mainland side (west, -x).
 */
export const DISTRICT_LABELS: DistrictLabel[] = [
  // ---- Mainland (west, -x) ----
  { name: "Agege", x: -70, z: -56, zone: "mainland", size: "minor" },
  { name: "Ikeja", x: -40, z: -56, zone: "mainland", size: "major" },
  { name: "Ikorodu", x: -22, z: -66, zone: "mainland", size: "minor" },
  { name: "Maryland", x: -28, z: -32, zone: "mainland", size: "minor" },
  { name: "Oshodi", x: -38, z: -10, zone: "mainland", size: "minor" },
  { name: "Surulere", x: -70, z: -20, zone: "mainland", size: "major" },
  { name: "Yaba", x: -42, z: 24, zone: "mainland", size: "minor" },
  { name: "Apapa", x: -64, z: 36, zone: "mainland", size: "minor" },
  // ---- Island (east, +x) ----
  { name: "Ikoyi", x: 28, z: -46, zone: "island", size: "major" },
  { name: "Victoria Island", x: 58, z: -16, zone: "island", size: "major" },
  { name: "Lekki", x: 70, z: 36, zone: "island", size: "major" },
];

/** Canvas font shared by every pill label (matches the app's display font). */
export const PILL_FONT =
  "700 52px 'Baloo 2','Comic Sans MS',system-ui,sans-serif";

/** Canvas pixel height of a pill texture. */
export const PILL_CANVAS_H = 112;

/** Minimum canvas pixel width of a pill texture (keeps short names round). */
export const PILL_CANVAS_MIN_W = 160;

/**
 * Size a pill texture's canvas for `text`. `measure` is injected so this
 * stays pure (the renderer passes canvas measureText; tests pass a stub).
 */
export function pillTextSize(
  text: string,
  measure: (text: string, font: string) => number
): { w: number; h: number } {
  const h = PILL_CANVAS_H;
  const textW = Math.max(1, measure(text, PILL_FONT));
  const w = Math.ceil(textW + 76); // horizontal padding inside the pill
  return { w: Math.max(PILL_CANVAS_MIN_W, w), h };
}

/** World-space sprite scale for a pill canvas, preserving its aspect ratio. */
export function pillWorldScale(
  canvasW: number,
  canvasH: number,
  worldH: number
): { x: number; y: number } {
  return { x: (worldH * canvasW) / canvasH, y: worldH };
}

/** Theme-aware pill colors: background, text, and outline ring. */
export interface PillColors {
  bg: string;
  fg: string;
  ring: string;
}

/**
 * Resolve pill colors from the app's theme tokens (day/night switch via
 * `data-theme` on <html>). `getVar` is injected to stay pure — the renderer
 * passes getComputedStyle; blank/missing tokens fall back to safe defaults.
 */
export function resolvePillColors(
  getVar: (name: string) => string | null | undefined
): PillColors {
  const v = (name: string, fallback: string): string => {
    const raw = getVar(name);
    return raw && raw.trim() ? raw.trim() : fallback;
  };
  return {
    bg: v("--surface", "#ffffff"),
    fg: v("--text", "#1c1814"),
    ring: v("--ring", "#0ea5e9"),
  };
}

/**
 * Camera distance (world units) below which per-pin name pills appear.
 * The renderer zooms 55 (min) … ~141 (default framing) … 230 (max), so 120
 * keeps the default view decluttered and reveals names as the user pinches in.
 */
export const PIN_LABEL_ZOOM_DIST = 120;

/** World units below a pin icon's center where its name pill sits. */
export const PIN_PILL_DY = 5.4;

/** World-space height of a per-pin name pill. */
export const PIN_PILL_WORLD_H = 2.6;

/** World-space height of a major / minor district pill. */
export const DISTRICT_WORLD_H: Record<DistrictLabel["size"], number> = {
  major: 4.4,
  minor: 3.6,
};
