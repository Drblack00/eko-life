/** M14 "Home Room" grid math — pure, UI-free helpers for the 8×8 room. */

export const ROOM_GRID = 8;

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

/* ============ Bugfix round C: tap-to-walk path helpers ============ */

/** A world-space point on the floor plane. */
export interface WalkPoint {
  x: number;
  z: number;
}

/** World-space center of a grid cell. */
export function cellCenterWorld(
  cell: GridCell,
  grid: number = ROOM_GRID
): WalkPoint {
  return { x: cell[0] - grid / 2 + 0.5, z: cell[1] - grid / 2 + 0.5 };
}

/**
 * Clamp a world point into the walkable floor rect (kept `margin` units
 * inside the walls so the avatar never clips them).
 */
export function clampToWalkArea(
  x: number,
  z: number,
  margin = 0.7,
  grid: number = ROOM_GRID
): WalkPoint {
  const half = grid / 2;
  const lo = -half + margin;
  const hi = half - margin;
  return {
    x: Math.min(hi, Math.max(lo, x)),
    z: Math.min(hi, Math.max(lo, z)),
  };
}

function cellKey(x: number, z: number): string {
  return `${x},${z}`;
}

/**
 * Nearest walkable cell to the desired (possibly fractional/blocked) coords.
 * Ring-searches outward from the desired cell; returns null when the whole
 * grid is blocked.
 */
export function nearestWalkableCell(
  taken: GridCell[],
  wantX: number,
  wantZ: number,
  grid: number = ROOM_GRID
): GridCell | null {
  const blocked = new Set(taken.map(([x, z]) => cellKey(x, z)));
  const gx = Math.max(0, Math.min(grid - 1, Math.floor(wantX)));
  const gz = Math.max(0, Math.min(grid - 1, Math.floor(wantZ)));
  if (!blocked.has(cellKey(gx, gz))) return [gx, gz];
  for (let r = 1; r < grid; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = gx + dx;
        const z = gz + dz;
        if (x < 0 || z < 0 || x >= grid || z >= grid) continue;
        if (!blocked.has(cellKey(x, z))) return [x, z];
      }
    }
  }
  return null;
}

/* ---- segment vs blocked-cell geometry (avatar has a body radius) ---- */

function segSegDist(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number
): number {
  // Distance between segments AB and CD (2D).
  const rX = bx - ax;
  const rZ = bz - az;
  const sX = dx - cx;
  const sZ = dz - cz;
  const denom = rX * sZ - rZ * sX;
  if (Math.abs(denom) < 1e-9) {
    // Parallel — fall back to endpoint distances.
    return Math.min(
      ptSegDist(ax, az, cx, cz, dx, dz),
      ptSegDist(bx, bz, cx, cz, dx, dz)
    );
  }
  const t = ((cx - ax) * sZ - (cz - az) * sX) / denom;
  const u = ((cx - ax) * rZ - (cz - az) * rX) / denom;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  return Math.min(
    ptSegDist(ax, az, cx, cz, dx, dz),
    ptSegDist(bx, bz, cx, cz, dx, dz),
    ptSegDist(cx, cz, ax, az, bx, bz),
    ptSegDist(dx, dz, ax, az, bx, bz)
  );
}

function ptSegDist(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx - px;
  const qz = az + t * dz - pz;
  return Math.hypot(qx, qz);
}

function ptRectDist(
  px: number,
  pz: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number
): number {
  const dx = Math.max(x0 - px, 0, px - x1);
  const dz = Math.max(z0 - pz, 0, pz - z1);
  return Math.hypot(dx, dz);
}

function segRectDist(
  a: WalkPoint,
  b: WalkPoint,
  x0: number,
  z0: number,
  x1: number,
  z1: number
): number {
  // Zero when the segment touches/crosses the rect.
  if (
    segSegDist(a.x, a.z, b.x, b.z, x0, z0, x1, z0) === 0 ||
    segSegDist(a.x, a.z, b.x, b.z, x1, z0, x1, z1) === 0 ||
    segSegDist(a.x, a.z, b.x, b.z, x1, z1, x0, z1) === 0 ||
    segSegDist(a.x, a.z, b.x, b.z, x0, z1, x0, z0) === 0
  )
    return 0;
  return Math.min(
    ptRectDist(a.x, a.z, x0, z0, x1, z1),
    ptRectDist(b.x, b.z, x0, z0, x1, z1),
    ptSegDist(x0, z0, a.x, a.z, b.x, b.z),
    ptSegDist(x1, z0, a.x, a.z, b.x, b.z),
    ptSegDist(x1, z1, a.x, a.z, b.x, b.z),
    ptSegDist(x0, z1, a.x, a.z, b.x, b.z)
  );
}

/**
 * True when the walk segment a→b comes within `radius` of any blocked cell.
 * Cells are treated as 1×1 world squares.
 */
export function segmentBlockedByCells(
  a: WalkPoint,
  b: WalkPoint,
  blocked: GridCell[],
  radius = 0.35,
  grid: number = ROOM_GRID
): boolean {
  const half = grid / 2;
  for (const [cx, cz] of blocked) {
    const x0 = cx - half;
    const z0 = cz - half;
    if (segRectDist(a, b, x0, z0, x0 + 1, z0 + 1) < radius) return true;
  }
  return false;
}

/**
 * Plan a short waypoint list from `from` to `to` avoiding blocked cells.
 * Straight line when clear; otherwise BFS across the grid for a free
 * cell path, then string-pulling to cut it back to a few waypoints.
 * Falls back to the straight line (best effort) when no free path exists.
 */
export function planWalkPath(
  from: WalkPoint,
  to: WalkPoint,
  blocked: GridCell[],
  radius = 0.35,
  grid: number = ROOM_GRID
): WalkPoint[] {
  if (!segmentBlockedByCells(from, to, blocked, radius, grid)) return [to];
  const blockedSet = new Set(blocked.map(([x, z]) => cellKey(x, z)));
  const toCell = (p: WalkPoint): GridCell => [
    Math.max(0, Math.min(grid - 1, Math.floor(p.x + grid / 2))),
    Math.max(0, Math.min(grid - 1, Math.floor(p.z + grid / 2))),
  ];
  const start = toCell(from);
  const goal = toCell(to);
  // BFS over free cells (4-directional). The start cell is walkable even if
  // a stale blocked list claims otherwise — the avatar is standing there.
  const prev = new Map<string, string | null>();
  const queue: GridCell[] = [start];
  prev.set(cellKey(start[0], start[1]), null);
  const dirs: GridCell[] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  while (queue.length > 0) {
    const [cx, cz] = queue.shift() as GridCell;
    if (cx === goal[0] && cz === goal[1]) break;
    for (const [dx, dz] of dirs) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= grid || nz >= grid) continue;
      const k = cellKey(nx, nz);
      if (prev.has(k)) continue;
      if (blockedSet.has(k)) continue;
      prev.set(k, cellKey(cx, cz));
      queue.push([nx, nz]);
    }
  }
  const goalKey = cellKey(goal[0], goal[1]);
  if (!prev.has(goalKey)) return [to]; // boxed in — best effort
  // Reconstruct the cell path, then convert to world waypoints.
  const cells: GridCell[] = [];
  let cur: string | null | undefined = goalKey;
  while (cur != null) {
    const [sx, sz] = cur.split(",").map(Number);
    cells.unshift([sx, sz]);
    cur = prev.get(cur);
  }
  const pts: WalkPoint[] = cells.map((c) => cellCenterWorld(c, grid));
  pts[pts.length - 1] = { x: to.x, z: to.z }; // end exactly on target
  // String-pulling: greedily skip to the furthest reachable waypoint.
  const out: WalkPoint[] = [];
  let i = 0;
  const at = (idx: number): WalkPoint =>
    idx === 0 ? { x: from.x, z: from.z } : pts[idx - 1];
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && segmentBlockedByCells(at(i), pts[j], blocked, radius, grid))
      j--;
    out.push(pts[j]);
    i = j + 1;
  }
  return out.length > 0 ? out : [to];
}
