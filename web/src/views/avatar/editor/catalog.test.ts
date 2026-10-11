/**
 * Èkó Life avatar studio — catalog honesty tests (Milestone 5).
 *
 * The M5 brief's top rule: every control must drive a real supported
 * parameter. These tests pin that:
 * - every catalog id resolves to an AVAILABLE manifest asset;
 * - every outfit card maps to the EXACT decomposed row the assembler
 *   renders (assembler.outfitIdForClothing, zero fallback notes);
 * - palettes match the server palettes mirrored in validation.ts;
 * - the Face/Accessories omissions are backed by manifest facts
 *   (1 head asset, 0 available accessories, all morphs stubbed).
 */
import { describe, expect, it } from "vitest";
import {
  BODY_OPTIONS,
  BOTTOM_COLOR_OPTIONS,
  EDITOR_CATEGORIES,
  FABRIC_OPTIONS,
  FACIAL_HAIR_OPTIONS,
  HAIR_COLOR_OPTIONS,
  HAIR_STYLE_OPTIONS,
  OUTFIT_ROWS,
  SKIN_TONE_OPTIONS,
  TOP_COLOR_OPTIONS,
  applyOutfitRow,
  assertCatalogIds,
  catalogAssetKinds,
  outfitRowForClothing,
} from "./catalog";
import {
  AVATAR_MANIFEST_BY_ID,
  manifestByKind,
} from "../../../avatar/manifest";
import {
  AVATAR_BOTTOM_COLORS,
  AVATAR_TOP_COLORS,
  DEFAULT_APPEARANCE_V1,
} from "../../../avatar/validation";
import { MORPH_SUPPORT, outfitIdForClothing } from "../../../avatar/assembler";
import type { AppearanceV1 } from "../../../avatar/schema";

function cloneApp(): AppearanceV1 {
  return JSON.parse(JSON.stringify(DEFAULT_APPEARANCE_V1)) as AppearanceV1;
}

describe("catalog honesty", () => {
  it("every catalog id is an available manifest asset", () => {
    const ids = [
      ...BODY_OPTIONS.map((o) => o.id),
      ...SKIN_TONE_OPTIONS.map((o) => o.id),
      ...HAIR_STYLE_OPTIONS.map((o) => o.id),
      ...HAIR_COLOR_OPTIONS.map((o) => o.id),
      ...FACIAL_HAIR_OPTIONS.map((o) => o.id),
      ...FABRIC_OPTIONS.map((o) => o.id),
    ];
    for (const r of OUTFIT_ROWS) {
      ids.push(r.topId, r.bottomId, r.shoeId);
      if (r.outerwearId) ids.push(r.outerwearId);
    }
    expect(() => assertCatalogIds(ids)).not.toThrow();
    // …and of the expected kinds.
    const kinds = catalogAssetKinds();
    for (const o of BODY_OPTIONS) expect(kinds[o.id]).toBe("body");
    for (const o of SKIN_TONE_OPTIONS) expect(kinds[o.id]).toBe("texture");
    for (const o of HAIR_STYLE_OPTIONS) expect(kinds[o.id]).toBe("hair");
  });

  it("body options cover both binary presets and nothing else", () => {
    expect(BODY_OPTIONS.map((o) => o.id).sort()).toEqual(["man", "woman"]);
  });

  it("skin tones: 12, hexes match the manifest exactly", () => {
    expect(SKIN_TONE_OPTIONS).toHaveLength(12);
    for (const o of SKIN_TONE_OPTIONS) {
      expect(o.hex).toBe(AVATAR_MANIFEST_BY_ID[o.id].hex);
    }
  });

  it("hair: 9 styles, 3 colours, 4 facial-hair options", () => {
    expect(HAIR_STYLE_OPTIONS).toHaveLength(9);
    expect(HAIR_STYLE_OPTIONS.map((o) => o.id)).toContain("hair_taper_fade_01");
    expect(HAIR_STYLE_OPTIONS.map((o) => o.id)).toContain("hair_waves_01");
    expect(HAIR_COLOR_OPTIONS).toHaveLength(3);
    expect(FACIAL_HAIR_OPTIONS).toHaveLength(4);
    // Hair styles and facial hair share kind "hair" but occupy different slots.
    for (const o of HAIR_STYLE_OPTIONS) {
      expect(AVATAR_MANIFEST_BY_ID[o.id].slots).toContain("hair");
    }
    for (const o of FACIAL_HAIR_OPTIONS) {
      expect(AVATAR_MANIFEST_BY_ID[o.id].slots).toContain("facialHair");
    }
  });

  it("outfit cards: each row resolves to its exact outfit with no fallback", () => {
    expect(OUTFIT_ROWS).toHaveLength(5);
    for (const row of OUTFIT_ROWS) {
      const app = applyOutfitRow(cloneApp(), row);
      const notes: string[] = [];
      const outfit = outfitIdForClothing(app.clothing, notes);
      // What the card promises is what the pipeline renders — no silent
      // "no exact match → casual" fallback for any card we show.
      expect(outfit).toBe(row.outfitId);
      expect(notes).toEqual([]);
    }
  });

  it("outfitRowForClothing round-trips every card; unknown combos → null (honest)", () => {
    for (const row of OUTFIT_ROWS) {
      const app = applyOutfitRow(cloneApp(), row);
      expect(outfitRowForClothing(app.clothing)?.outfitId).toBe(row.outfitId);
    }
    // A combo with no exact row (e.g. office shirt + shorts) must NOT
    // highlight a card — the UI shows "custom → renders as casual".
    const app = cloneApp();
    app.clothing.topId = "top_shirt_office_01";
    app.clothing.bottomId = "bottom_short_01";
    expect(outfitRowForClothing(app.clothing)).toBeNull();
    expect(outfitIdForClothing(app.clothing, [])).toBe("casual");
  });

  it("applyOutfitRow is field-level: skin/hair/face/morphs untouched", () => {
    const app = cloneApp();
    app.base.skinToneId = "deep_espresso";
    app.hair.styleId = "locs";
    const next = applyOutfitRow(app, OUTFIT_ROWS[2]); // office
    expect(next.clothing.topId).toBe("top_shirt_office_01");
    expect(next.clothing.shoeId).toBe("shoe_oxford_01");
    expect(next.base.skinToneId).toBe("deep_espresso");
    expect(next.hair.styleId).toBe("locs");
    expect(next.base.facePresetId).toBe(app.base.facePresetId);
    expect(next.morphs).toEqual(app.morphs);
  });

  it("garment palettes match the server palettes in validation.ts", () => {
    expect(TOP_COLOR_OPTIONS.map((o) => o.hex)).toEqual([...AVATAR_TOP_COLORS]);
    expect(BOTTOM_COLOR_OPTIONS.map((o) => o.hex)).toEqual([
      ...AVATAR_BOTTOM_COLORS,
    ]);
    expect(TOP_COLOR_OPTIONS).toHaveLength(10);
    expect(BOTTOM_COLOR_OPTIONS).toHaveLength(10);
  });

  it("categories shipped: body/skin/hair/clothing — face + accessories omitted for cause", () => {
    expect(EDITOR_CATEGORIES.map((c) => c.id)).toEqual([
      "body",
      "skin",
      "hair",
      "clothing",
    ]);
    // Face: only one head asset exists and every morph is stubbed — there
    // is nothing real a Face category could control.
    const heads = manifestByKind("head", "available");
    expect(heads.map((a) => a.id)).toEqual(["face_default_01"]);
    expect(Object.values(MORPH_SUPPORT).every((s) => s === "stubbed")).toBe(
      true
    );
    // Accessories: the manifest carries zero available accessory assets
    // (only a pending licensed-GLB pack).
    expect(manifestByKind("accessory", "available")).toEqual([]);
  });
});
