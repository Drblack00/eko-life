/**
 * M16 — bottom-sheet snap math for the Buy catalogue (+ B workstream:
 * landscape side-panel widths).
 *
 * Pure logic (no DOM): snap points COLLAPSED (handle bar) → HALF (tabs +
 * cards) → FULL (near-full height). The sheet overlays the room stage so
 * the catalogue never pushes the room off screen.
 *
 * In portrait the sheet docks to the stage bottom (heights); in landscape
 * it docks to the stage's right edge as a side panel (widths). Both share
 * the same snap-point shape, so nearestSnap/nextSnap work for either.
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

/**
 * Pixel widths for each snap of the landscape side panel, from the stage's
 * measured width. Collapsed is a slim icon rail; half fits one card column;
 * full fits two.
 */
export function sheetWidths(stageW: number): SheetHeights {
  const w = Math.max(280, Number.isFinite(stageW) && stageW > 0 ? stageW : 480);
  return {
    collapsed: 52,
    half: Math.round(Math.min(360, w * 0.42)),
    full: Math.round(Math.min(600, w * 0.68)),
  };
}

/** The sheet counts as "open" (covering stage content) at half/full snaps. */
export function isSheetOpen(snap: SheetSnap, hidden: boolean): boolean {
  return !hidden && snap !== "collapsed";
}

/**
 * True once the catalogue config arrays have arrived. Until then the sheet
 * body renders a loading placeholder instead of a tall blank panel.
 */
export function buyDataReady(config: {
  furniture?: unknown;
  walls?: unknown;
  floors?: unknown;
} | null): boolean {
  return !!config && Array.isArray(config.furniture);
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
