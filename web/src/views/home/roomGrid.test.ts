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
  it("accepts in-bounds cells 0..5", () => {
    expect(fitsInGrid([[0, 0], [5, 5]])).toBe(true);
    expect(fitsInGrid(footprintCells([2, 2], 0, 4, 4))).toBe(true);
  });

  it("rejects out-of-bounds cells", () => {
    expect(fitsInGrid([[6, 0]])).toBe(false);
    expect(fitsInGrid([[-1, 0]])).toBe(false);
    expect(fitsInGrid([[0, 6]])).toBe(false);
    expect(fitsInGrid(footprintCells([2, 1], 0, 5, 0))).toBe(false);
    expect(fitsInGrid(footprintCells([2, 1], 1, 0, 5))).toBe(false);
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

  it("clamps to the 6×6 room", () => {
    expect(parseSize([99, 99])).toEqual([6, 6]);
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
    for (let gz = 0; gz < 6; gz++)
      for (let gx = 0; gx < 6; gx++)
        full.push({ key: `f${k++}`, itemId: "x", size: [1, 1], rot: 0, x: gx, z: gz });
    const out = layoutPlaced([...full, { key: "extra", itemId: "bed", size: [2, 2], rot: 0 }]);
    expect(out).toHaveLength(36);
    expect(out.find((e) => e.key === "extra")).toBeUndefined();
  });
});
