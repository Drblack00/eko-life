/**
 * Client unit tests — views/home/buySheet.ts M16 bottom-sheet snap math.
 * Pure logic only; no DOM.
 */
import { describe, expect, it } from "vitest";
import {
  nearestSnap,
  nextSnap,
  sheetHeights,
  type SheetSnap,
} from "./buySheet";

describe("sheetHeights", () => {
  it("derives collapsed/half/full from the stage height", () => {
    const h = sheetHeights(340);
    expect(h.collapsed).toBe(48);
    expect(h.half).toBe(Math.round(Math.min(300, 340 * 0.72)));
    expect(h.full).toBe(340);
  });

  it("caps HALF at 300px on tall stages", () => {
    expect(sheetHeights(900).half).toBe(300);
  });

  it("falls back to 340px for bogus heights", () => {
    expect(sheetHeights(0).full).toBe(340);
    expect(sheetHeights(NaN).full).toBe(340);
  });
});

describe("nearestSnap", () => {
  it("settles a handle drag on the nearest snap point", () => {
    const h = sheetHeights(340);
    expect(nearestSnap(0, h)).toBe("collapsed");
    expect(nearestSnap(60, h)).toBe("collapsed");
    expect(nearestSnap(160, h)).toBe("half");
    expect(nearestSnap(320, h)).toBe("full");
  });
});

describe("nextSnap", () => {
  it("tapping the handle cycles collapsed → half → full → collapsed", () => {
    const seq: SheetSnap[] = ["collapsed"];
    for (let i = 0; i < 4; i++) seq.push(nextSnap(seq[seq.length - 1]));
    expect(seq).toEqual(["collapsed", "half", "full", "collapsed", "half"]);
  });
});
