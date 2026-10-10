/** M14 "Home Room" grid math — pure, UI-free helpers for the 6×6 room. */

export const ROOM_GRID = 6;

/** A room footprint size: [cells wide, cells deep]. */
export type Footprint = [number, number];

/** A single grid cell as [x, z]. */
export type GridCell = [number, number];

/**
 * Cells occupied by a footprint anchored at cell (x, z).
 * `rot` is quarter-turns clockwise; odd rotations swap w/d, matching the
 * client-side model rotation (see HomeRoom).
 */
export function footprintCells(
  size: Footprint,
  rot: number,
  x: number,
  z: number
): GridCell[] {
  const w = Math.max(1, Math.floor(Math.abs(size[0]) || 1));
  const d = Math.max(1, Math.floor(Math.abs(size[1]) || 1));
  const swapped = ((Math.floor(rot) % 2) + 2) % 2 === 1;
  const wEff = swapped ? d : w;
  const dEff = swapped ? w : d;
  const cells: GridCell[] = [];
  for (let dx = 0; dx < wEff; dx++) {
    for (let dz = 0; dz < dEff; dz++) {
      cells.push([x + dx, z + dz]);
    }
  }
  return cells;
}

/** True when every cell is an integer cell inside the 0..grid-1 square. */
export function fitsInGrid(
  cells: GridCell[],
  grid: number = ROOM_GRID
): boolean {
  if (cells.length === 0) return false;
  return cells.every(
    ([cx, cz]) =>
      Number.isInteger(cx) &&
      Number.isInteger(cz) &&
      cx >= 0 &&
      cz >= 0 &&
      cx < grid &&
      cz < grid
  );
}

/** True when the two cell lists share at least one cell. */
export function overlaps(a: GridCell[], b: GridCell[]): boolean {
  const set = new Set(b.map(([x, z]) => `${x},${z}`));
  return a.some(([x, z]) => set.has(`${x},${z}`));
}

/** Any size spec the server may send for a catalog entry. */
export type SizeSpec =
  | Footprint
  | string
  | { w?: number; d?: number }
  | null
  | undefined;

function clampCell(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.min(ROOM_GRID, Math.max(1, Math.floor(n)));
}

/**
 * Resolve a server size spec to a concrete [w, d] footprint.
 * Accepts [w, d] arrays, "2x1"/"2×1" strings, or { w, d } objects.
 * Anything unparseable (or missing) falls back so rendering never breaks.
 */
export function parseSize(
  size: SizeSpec,
  fallback: Footprint = [1, 1]
): Footprint {
  if (Array.isArray(size) && size.length >= 2) {
    const w = clampCell(size[0]);
    const d = clampCell(size[1]);
    if (w != null && d != null) return [w, d];
  }
  if (typeof size === "string") {
    const m = size.match(/(\d+)\s*[x×]\s*(\d+)/i);
    if (m) {
      const w = clampCell(Number(m[1]));
      const d = clampCell(Number(m[2]));
      if (w != null && d != null) return [w, d];
    }
  }
  if (size != null && typeof size === "object" && !Array.isArray(size)) {
    const w = clampCell(size.w);
    const d = clampCell(size.d);
    if (w != null && d != null) return [w, d];
  }
  return fallback;
}

/** Buy-mode catalog tabs. */
export type RoomCategory = "sleep" | "kitchen" | "bath" | "comfort";

export const ROOM_CATEGORIES: Array<{ id: RoomCategory; emoji: string; label: string }> = [
  { id: "sleep", emoji: "🛏️", label: "Sleep" },
  { id: "kitchen", emoji: "🍳", label: "Kitchen" },
  { id: "bath", emoji: "🛁", label: "Bath" },
  { id: "comfort", emoji: "🛋️", label: "Comfort" },
];

/**
 * Normalize a server `category` string onto a buy-mode tab.
 * Unknown/missing categories use the fallback (then "comfort").
 */
export function normalizeCategory(
  category: unknown,
  fallback?: RoomCategory
): RoomCategory {
  const c = String(category ?? "").toLowerCase();
  if (/sleep|bed|mattress|rest/.test(c)) return "sleep";
  if (/kitchen|cook|food|fridge|stove|dining/.test(c)) return "kitchen";
  if (/bath|toilet|water|wash|shower/.test(c)) return "bath";
  if (/comfort|living|fun|decor|energy|power/.test(c)) return "comfort";
  return fallback ?? "comfort";
}

/** Gameplay act a placed item's "Use" button fires, or null for decor-only. */
export type UseAct = "sleep" | "eat" | "fun";

const USE_BY_ITEM: Record<string, UseAct> = {
  bed: "sleep",
  mattress: "sleep",
  stove: "eat",
  fridge: "eat",
  cooler: "eat",
  dining_table: "eat",
  tv: "fun",
  sofa: "fun",
  fan: "fun",
  beanbag: "fun",
  plastic_chair: "fun",
  bookshelf: "fun",
  // ac, gen, drum, mirror are decor-only: no "Use", popup shows effect text.
};

/** Which gameplay act (if any) an owned item's Use button should fire. */
export function useActFor(itemId: string | null | undefined): UseAct | null {
  return USE_BY_ITEM[String(itemId ?? "").toLowerCase()] ?? null;
}

/** Human label for a use act. */
export function useLabel(act: UseAct): string {
  return act === "sleep" ? "😴 Use (sleep)" : act === "eat" ? "🍽️ Use (eat)" : "🎮 Use (fun)";
}

/** Raw placement record before auto-layout (x/z may be missing). */
export interface RawPlaced {
  key: string;
  itemId: string;
  size: Footprint;
  rot: number;
  x?: number | null;
  z?: number | null;
}

/** Placement with resolved grid coords. */
export interface PlacedLayout extends RawPlaced {
  x: number;
  z: number;
}

/**
 * Resolve every entry onto the grid. Entries with valid coords keep them;
 * entries missing coords (legacy placed items) are auto-slotted into the
 * first free spot, row-major. Entries that fit nowhere are dropped.
 */
export function layoutPlaced(raw: RawPlaced[]): PlacedLayout[] {
  const out: PlacedLayout[] = [];
  const taken: GridCell[] = [];
  const fixed: RawPlaced[] = [];
  const loose: RawPlaced[] = [];
  for (const r of raw) {
    if (Number.isInteger(r.x) && Number.isInteger(r.z)) fixed.push(r);
    else loose.push(r);
  }
  for (const r of fixed) {
    const cells = footprintCells(r.size, r.rot, r.x as number, r.z as number);
    if (!fitsInGrid(cells) || overlaps(cells, taken)) continue;
    out.push({ ...r, x: r.x as number, z: r.z as number });
    taken.push(...cells);
  }
  for (const r of loose) {
    let spot: GridCell | null = null;
    for (let gz = 0; gz < ROOM_GRID && !spot; gz++) {
      for (let gx = 0; gx < ROOM_GRID && !spot; gx++) {
        const cells = footprintCells(r.size, r.rot, gx, gz);
        if (fitsInGrid(cells) && !overlaps(cells, taken)) spot = [gx, gz];
      }
    }
    if (!spot) continue;
    out.push({ ...r, x: spot[0], z: spot[1] });
    taken.push(...footprintCells(r.size, r.rot, spot[0], spot[1]));
  }
  return out;
}
