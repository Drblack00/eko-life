/**
 * Client unit tests — views/home/buySheet.ts M16 bottom-sheet snap math
 * (+ workstream B landscape widths, open predicate, data readiness).
 * Pure logic only; no DOM.
 */
import { describe, expect, it } from "vitest";
import {
  buyDataReady,
  buyModeNextSnap,
  isSheetOpen,
  nearestSnap,
  nextSnap,
  sheetHeights,
  sheetWidths,
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

describe("sheetWidths", () => {
  it("derives collapsed/half/full side-panel widths from the stage width", () => {
    const w = sheetWidths(800);
    expect(w.collapsed).toBe(52);
    expect(w.half).toBe(Math.round(Math.min(360, 800 * 0.42)));
    expect(w.full).toBe(Math.round(Math.min(600, 800 * 0.68)));
  });

  it("caps HALF at 360px and FULL at 600px on very wide stages", () => {
    expect(sheetWidths(2000).half).toBe(360);
    expect(sheetWidths(2000).full).toBe(600);
  });

  it("falls back to 480px for bogus widths", () => {
    expect(sheetWidths(0).half).toBe(Math.round(Math.min(360, 480 * 0.42)));
    expect(sheetWidths(NaN).full).toBe(Math.round(Math.min(600, 480 * 0.68)));
  });

  it("snap math is orientation-agnostic: portrait heights are unchanged", () => {
    // Regression guard — the landscape pass must not alter portrait snaps.
    const h = sheetHeights(340);
    expect(h).toEqual({
      collapsed: 48,
      half: Math.round(Math.min(300, 340 * 0.72)),
      full: 340,
    });
  });

  it("nearestSnap/nextSnap settle the same way on width snaps", () => {
    const w = sheetWidths(800); // { collapsed: 52, half: 336, full: 544 }
    expect(nearestSnap(0, w)).toBe("collapsed");
    expect(nearestSnap(200, w)).toBe("half");
    expect(nearestSnap(500, w)).toBe("full");
    expect(nextSnap("collapsed")).toBe("half");
    expect(nextSnap("half")).toBe("full");
    expect(nextSnap("full")).toBe("collapsed");
  });
});

describe("isSheetOpen", () => {
  it("is open at half/full unless explicitly hidden", () => {
    expect(isSheetOpen("collapsed", false)).toBe(false);
    expect(isSheetOpen("half", false)).toBe(true);
    expect(isSheetOpen("full", false)).toBe(true);
    expect(isSheetOpen("half", true)).toBe(false);
    expect(isSheetOpen("full", true)).toBe(false);
  });
});

describe("buyDataReady", () => {
  it("is false until the catalogue array arrives — the sheet shows a loader", () => {
    expect(buyDataReady(null)).toBe(false);
    expect(buyDataReady({})).toBe(false);
    expect(buyDataReady({ furniture: undefined })).toBe(false);
  });

  it("is true once furniture is an array, even an empty one", () => {
    expect(buyDataReady({ furniture: [] })).toBe(true);
    expect(buyDataReady({ furniture: [{ id: "bed" }] })).toBe(true);
  });
});

describe("buyModeNextSnap", () => {
  it("cycles half → full → half and never lands on collapsed", () => {
    expect(buyModeNextSnap("half")).toBe("full");
    expect(buyModeNextSnap("full")).toBe("half");
    expect(buyModeNextSnap("collapsed")).toBe("half");
  });
});
