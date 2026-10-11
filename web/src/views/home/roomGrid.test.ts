/**
 * Client unit tests — views/home/roomGrid.ts grid math + catalog fallbacks.
 * Pure logic only; no DOM / no Three.js.
 */
import { describe, expect, it } from "vitest";
import {
  footprintCells,
  fitsInGrid,
  overlaps,
  parseSize,
  normalizeCategory,
  useActFor,
  layoutPlaced,
  ROOM_CATEGORIES,
  type GridCell,
} from "./roomGrid";
import { roomSizeFor, roomCategoryFor, CATALOG_IDS } from "./catalogue";

describe("footprintCells", () => {
  it("covers w×d cells from the anchor", () => {
    expect(footprintCells([2, 1], 0, 0, 0)).toEqual([
      [0, 0],
      [1, 0],
    ]);
    expect(footprintCells([1, 1], 0, 5, 5)).toEqual([[5, 5]]);
  });

  it("swaps w/d for odd rotations (1 and 3)", () => {
    const r1 = footprintCells([2, 1], 1, 0, 0);
    expect(r1).toEqual([
      [0, 0],
      [0, 1],
    ]);
    const r3 = footprintCells([2, 1], 3, 2, 2);
    expect(r3).toEqual([
      [2, 2],
      [2, 3],
    ]);
    // Even rotations keep the base footprint.
    expect(footprintCells([2, 1], 2, 0, 0)).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });

  it("handles negative rot by normalizing modulo 2", () => {
    expect(footprintCells([2, 1], -1, 0, 0)).toEqual([
      [0, 0],
      [0, 1],
    ]);
  });
});

describe("fitsInGrid", () => {
  it("accepts in-bounds cells 0..7", () => {
    expect(fitsInGrid([[0, 0], [7, 7]])).toBe(true);
    expect(fitsInGrid(footprintCells([2, 2], 0, 6, 6))).toBe(true);
  });

  it("rejects out-of-bounds cells", () => {
    expect(fitsInGrid([[8, 0]])).toBe(false);
    expect(fitsInGrid([[-1, 0]])).toBe(false);
    expect(fitsInGrid([[0, 8]])).toBe(false);
    expect(fitsInGrid(footprintCells([2, 1], 0, 7, 0))).toBe(false);
    expect(fitsInGrid(footprintCells([2, 1], 1, 0, 7))).toBe(false);
  });

  it("rejects empty and non-integer cells", () => {
    expect(fitsInGrid([])).toBe(false);
    expect(fitsInGrid([[0.5, 0]])).toBe(false);
  });
});

describe("overlaps", () => {
  it("detects shared cells", () => {
    const a: GridCell[] = [
      [0, 0],
      [1, 0],
    ];
    expect(overlaps(a, [[1, 0]])).toBe(true);
    expect(overlaps(a, [[2, 0]])).toBe(false);
    expect(overlaps([], [])).toBe(false);
  });
});

describe("parseSize", () => {
  it("accepts [w, d] arrays", () => {
    expect(parseSize([2, 1])).toEqual([2, 1]);
  });

  it("accepts \"2x1\" strings", () => {
    expect(parseSize("2x1")).toEqual([2, 1]);
    expect(parseSize("2×1")).toEqual([2, 1]);
  });

  it("accepts { w, d } objects", () => {
    expect(parseSize({ w: 2, d: 1 })).toEqual([2, 1]);
  });

  it("falls back gracefully on junk or missing sizes", () => {
    expect(parseSize(undefined)).toEqual([1, 1]);
    expect(parseSize(null)).toEqual([1, 1]);
    expect(parseSize("huge")).toEqual([1, 1]);
    expect(parseSize("huge", [2, 2])).toEqual([2, 2]);
    expect(parseSize([0, -3])).toEqual([1, 1]);
  });

  it("clamps to the 8×8 room", () => {
    expect(parseSize([99, 99])).toEqual([8, 8]);
  });
});

describe("normalizeCategory", () => {
  it("maps server category strings onto the four tabs", () => {
    expect(normalizeCategory("Sleep")).toBe("sleep");
    expect(normalizeCategory("kitchen")).toBe("kitchen");
    expect(normalizeCategory("BATHROOM")).toBe("bath");
    expect(normalizeCategory("comfort")).toBe("comfort");
  });

  it("uses the fallback, then comfort, for unknown input", () => {
    expect(normalizeCategory("???", "bath")).toBe("bath");
    expect(normalizeCategory(undefined)).toBe("comfort");
    expect(normalizeCategory(null)).toBe("comfort");
  });
});

describe("useActFor", () => {
  it("maps usable items to their gameplay act", () => {
    expect(useActFor("bed")).toBe("sleep");
    expect(useActFor("mattress")).toBe("sleep");
    expect(useActFor("stove")).toBe("eat");
    expect(useActFor("fridge")).toBe("eat");
    expect(useActFor("cooler")).toBe("eat");
    expect(useActFor("dining_table")).toBe("eat");
    expect(useActFor("tv")).toBe("fun");
    expect(useActFor("sofa")).toBe("fun");
    expect(useActFor("bookshelf")).toBe("fun");
  });

  it("returns null for decor-only items and unknowns", () => {
    expect(useActFor("ac")).toBe(null);
    expect(useActFor("gen")).toBe(null);
    expect(useActFor("drum")).toBe(null);
    expect(useActFor("mirror")).toBe(null);
    expect(useActFor("nope")).toBe(null);
    expect(useActFor(null)).toBe(null);
  });
});

describe("catalogue fallbacks", () => {
  it("knows all 16 model ids", () => {
    expect(CATALOG_IDS).toHaveLength(16);
  });

  it("uses server size/category when present", () => {
    expect(roomSizeFor({ id: "bed", size: [1, 1] })).toEqual([1, 1]);
    expect(roomCategoryFor({ id: "bed", category: "kitchen" })).toBe("kitchen");
  });

  it("falls back per item id when the server omits metadata", () => {
    expect(roomSizeFor({ id: "bed" })).toEqual([2, 2]);
    expect(roomSizeFor({ id: "dining_table" })).toEqual([2, 1]);
    expect(roomCategoryFor({ id: "drum" })).toBe("bath");
    expect(roomCategoryFor({ id: "gen" })).toBe("comfort");
  });

  it("degrades to 1×1/comfort for completely unknown entries", () => {
    expect(roomSizeFor({})).toEqual([1, 1]);
    expect(roomCategoryFor({})).toBe("comfort");
  });

  it("has exactly the four expected buy-mode tabs", () => {
    expect(ROOM_CATEGORIES.map((c) => c.id)).toEqual([
      "sleep",
      "kitchen",
      "bath",
      "comfort",
    ]);
  });
});

describe("layoutPlaced", () => {
  it("keeps valid fixed coords", () => {
    const out = layoutPlaced([
      { key: "a", itemId: "fridge", size: [1, 1], rot: 0, x: 2, z: 3 },
    ]);
    expect(out).toEqual([
      { key: "a", itemId: "fridge", size: [1, 1], rot: 0, x: 2, z: 3 },
    ]);
  });

  it("auto-slots entries missing coords into the first free spot", () => {
    const out = layoutPlaced([
      { key: "a", itemId: "fridge", size: [1, 1], rot: 0, x: 0, z: 0 },
      { key: "b", itemId: "bed", size: [2, 2], rot: 0 },
    ]);
    const b = out.find((e) => e.key === "b");
    expect(b?.x).toBe(1);
    expect(b?.z).toBe(0);
  });

  it("drops entries that fit nowhere", () => {
    const full: Array<{
      key: string;
      itemId: string;
      size: [number, number];
      rot: number;
      x: number;
      z: number;
    }> = [];
    let k = 0;
    for (let gz = 0; gz < 8; gz++)
      for (let gx = 0; gx < 8; gx++)
        full.push({ key: `f${k++}`, itemId: "x", size: [1, 1], rot: 0, x: gx, z: gz });
    const out = layoutPlaced([...full, { key: "extra", itemId: "bed", size: [2, 2], rot: 0 }]);
    expect(out).toHaveLength(64);
    expect(out.find((e) => e.key === "extra")).toBeUndefined();
  });
});

/* Bugfix round C — tap-to-walk path helpers. */
import {
  cellCenterWorld,
  clampToWalkArea,
  nearestWalkableCell,
  planWalkPath,
  segmentBlockedByCells,
  ROOM_GRID,
  type GridCell as WalkGridCell,
} from "./roomGrid";

describe("walk area helpers", () => {
  it("ROOM_GRID is 8 (wider room)", () => {
    expect(ROOM_GRID).toBe(8);
  });

  it("cellCenterWorld maps cells to world coords", () => {
    expect(cellCenterWorld([0, 0])).toEqual({ x: -3.5, z: -3.5 });
    expect(cellCenterWorld([7, 7])).toEqual({ x: 3.5, z: 3.5 });
  });

  it("clampToWalkArea keeps points off the walls", () => {
    expect(clampToWalkArea(99, -99)).toEqual({ x: 3.3, z: -3.3 });
    expect(clampToWalkArea(0, 0)).toEqual({ x: 0, z: 0 });
  });
});

describe("nearestWalkableCell", () => {
  it("returns the desired cell when free", () => {
    expect(nearestWalkableCell([[0, 0]], 3, 3)).toEqual([3, 3]);
  });

  it("finds the nearest free cell when the desired one is taken", () => {
    // Block (3,3): nearest free ring cell should be adjacent.
    const got = nearestWalkableCell([[3, 3]], 3, 3);
    expect(got).not.toBeNull();
    const [x, z] = got as WalkGridCell;
    expect(Math.max(Math.abs(x - 3), Math.abs(z - 3))).toBe(1);
  });

  it("returns null when the whole grid is blocked", () => {
    const all: WalkGridCell[] = [];
    for (let z = 0; z < 8; z++)
      for (let x = 0; x < 8; x++) all.push([x, z]);
    expect(nearestWalkableCell(all, 4, 4)).toBeNull();
  });

  it("clamps fractional/out-of-range wants into the grid", () => {
    expect(nearestWalkableCell([], 99, 99)).toEqual([7, 7]);
    expect(nearestWalkableCell([], 2.7, 5.2)).toEqual([2, 5]);
  });
});

describe("segmentBlockedByCells", () => {
  it("is clear with no blocked cells", () => {
    expect(
      segmentBlockedByCells({ x: -3, z: 0 }, { x: 3, z: 0 }, [])
    ).toBe(false);
  });

  it("detects a segment crossing a blocked cell", () => {
    // Cell (4,4) spans world x,z in [0,1] — the segment crosses it.
    expect(
      segmentBlockedByCells({ x: -3, z: 0.5 }, { x: 3, z: 0.5 }, [[4, 4]])
    ).toBe(true);
  });

  it("ignores cells far from the segment", () => {
    expect(
      segmentBlockedByCells({ x: -3, z: -3 }, { x: 3, z: -3 }, [[4, 4]])
    ).toBe(false);
  });

  it("respects the avatar body radius near a cell corner", () => {
    // Segment passes 0.2 from the cell corner: blocked at radius 0.35,
    // clear at radius 0.1.
    const a = { x: -3, z: 1.2 };
    const b = { x: 3, z: 1.2 };
    expect(segmentBlockedByCells(a, b, [[4, 4]], 0.35)).toBe(true);
    expect(segmentBlockedByCells(a, b, [[4, 4]], 0.1)).toBe(false);
  });
});

describe("planWalkPath", () => {
  it("goes straight when nothing blocks the way", () => {
    const from = { x: -3, z: -3 };
    const to = { x: 3, z: 3 };
    expect(planWalkPath(from, to, [])).toEqual([to]);
  });

  it("detours around a single blocked cell", () => {
    // Bed-like 2×2 block around world (0.5, 0.5): cells (4,4),(5,4),(4,5),(5,5).
    const blocked: WalkGridCell[] = [
      [4, 4],
      [5, 4],
      [4, 5],
      [5, 5],
    ];
    const from = { x: -3, z: 0.5 };
    const to = { x: 3, z: 0.5 };
    expect(segmentBlockedByCells(from, to, blocked)).toBe(true);
    const path = planWalkPath(from, to, blocked);
    // Ends exactly on the target and every leg avoids the block.
    expect(path[path.length - 1]).toEqual(to);
    expect(path.length).toBeGreaterThan(1);
    let prev = from;
    for (const wp of path) {
      expect(segmentBlockedByCells(prev, wp, blocked)).toBe(false);
      prev = wp;
    }
  });

  it("falls back to the straight line when fully boxed in", () => {
    const all: WalkGridCell[] = [];
    for (let z = 0; z < 8; z++)
      for (let x = 0; x < 8; x++) all.push([x, z]);
    const from = { x: -3, z: 0 };
    const to = { x: 3, z: 0 };
    expect(planWalkPath(from, to, all)).toEqual([to]);
  });
});
