/**
 * M16 — bottom-sheet snap math for the Buy catalogue.
 *
 * Pure logic (no DOM): snap points COLLAPSED (handle bar) → HALF (tabs +
 * cards) → FULL (near-full height). The sheet overlays the room stage so
 * the catalogue never pushes the room off screen.
 */

export type SheetSnap = "collapsed" | "half" | "full";

export const SHEET_SNAPS: readonly SheetSnap[] = ["collapsed", "half", "full"];

export interface SheetHeights {
  collapsed: number;
  half: number;
  full: number;
}

/** Pixel heights for each snap, from the stage's measured height. */
export function sheetHeights(stageH: number): SheetHeights {
  const h = Math.max(200, Number.isFinite(stageH) && stageH > 0 ? stageH : 340);
  return {
    collapsed: 48,
    half: Math.round(Math.min(300, h * 0.72)),
    full: h,
  };
}

/** After a handle drag, settle on the nearest snap point. */
export function nearestSnap(height: number, heights: SheetHeights): SheetSnap {
  let best: SheetSnap = "collapsed";
  let bestD = Infinity;
  for (const s of SHEET_SNAPS) {
    const d = Math.abs(heights[s] - height);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** Tapping the handle cycles collapsed → half → full → collapsed. */
export function nextSnap(s: SheetSnap): SheetSnap {
  return s === "collapsed" ? "half" : s === "half" ? "full" : "collapsed";
}
