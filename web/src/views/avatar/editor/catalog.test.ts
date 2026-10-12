/**
 * Èkó Life avatar studio — catalog honesty tests (Milestone 5, expanded M8).
 *
 * The M5 brief's top rule: every control must drive a real supported
 * parameter. These tests pin that:
 * - every catalog id resolves to an AVAILABLE manifest asset;
 * - every outfit card maps to the EXACT decomposed row the assembler
 *   renders (assembler.outfitIdForClothing, zero fallback notes);
 * - palettes match the server palettes mirrored in validation.ts;
 * - the face-morph omission is backed by manifest facts
 *   (1 head asset, all morphs stubbed); accessories now ship (3 assets).
 */
import { describe, expect, it } from "vitest";
import {
  ACCESSORY_SLOT_OPTIONS,
  BODY_OPTIONS,
  BOTTOM_COLOR_OPTIONS,
  BROW_STYLE_OPTIONS,
  EDITOR_CATEGORIES,
  EYE_COLOR_OPTIONS,
  FABRIC_OPTIONS,
  FACIAL_HAIR_OPTIONS,
  facialHairOptionsForBody,
  HAIR_COLOR_OPTIONS,
  HAIR_STYLE_OPTIONS,
  OUTFIT_ROWS,
  SKIN_TONE_OPTIONS,
  TOP_COLOR_OPTIONS,
  accessoryIdForSlot,
  applyOutfitRow,
  assertCatalogIds,
  catalogAssetKinds,
  outfitRowForClothing,
  setAccessorySlot,
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
      ...EYE_COLOR_OPTIONS.map((o) => o.id),
      ...BROW_STYLE_OPTIONS.map((o) => o.id),
      ...HAIR_STYLE_OPTIONS.map((o) => o.id),
      ...HAIR_COLOR_OPTIONS.map((o) => o.id),
      ...FACIAL_HAIR_OPTIONS.map((o) => o.id),
      ...FABRIC_OPTIONS.map((o) => o.id),
    ];
    for (const r of OUTFIT_ROWS) {
      ids.push(r.topId, r.bottomId, r.shoeId);
      if (r.outerwearId) ids.push(r.outerwearId);
    }
    for (const s of ACCESSORY_SLOT_OPTIONS) {
      for (const o of s.options) if (o.id !== "none") ids.push(o.id);
    }
    expect(() => assertCatalogIds(ids)).not.toThrow();
    // …and of the expected kinds.
    const kinds = catalogAssetKinds();
    for (const o of BODY_OPTIONS) expect(kinds[o.id]).toBe("body");
    for (const o of SKIN_TONE_OPTIONS) expect(kinds[o.id]).toBe("texture");
    for (const o of HAIR_STYLE_OPTIONS) expect(kinds[o.id]).toBe("hair");
    for (const o of EYE_COLOR_OPTIONS) expect(kinds[o.id]).toBe("texture");
    for (const o of BROW_STYLE_OPTIONS) expect(kinds[o.id]).toBe("hair");
  });

  it("body options cover both binary presets and nothing else", () => {
    expect(BODY_OPTIONS.map((o) => o.id).sort()).toEqual(["man", "woman"]);
  });

  it("skin tones: 18, hexes match the manifest exactly", () => {
    expect(SKIN_TONE_OPTIONS).toHaveLength(18);
    for (const o of SKIN_TONE_OPTIONS) {
      expect(o.hex).toBe(AVATAR_MANIFEST_BY_ID[o.id].hex);
    }
  });

  it("hair: 13 styles, 6 colours, 4 facial-hair options", () => {
    expect(HAIR_STYLE_OPTIONS).toHaveLength(13);
    expect(HAIR_STYLE_OPTIONS.map((o) => o.id)).toContain("hair_taper_fade_01");
    expect(HAIR_STYLE_OPTIONS.map((o) => o.id)).toContain("hair_waves_01");
    expect(HAIR_STYLE_OPTIONS.map((o) => o.id)).toContain("hair_bun_01");
    expect(HAIR_STYLE_OPTIONS.map((o) => o.id)).toContain("hair_ponytail_01");
    expect(HAIR_STYLE_OPTIONS.map((o) => o.id)).toContain("hair_mohawk_01");
    expect(HAIR_STYLE_OPTIONS.map((o) => o.id)).toContain("hair_bantu_knots_01");
    expect(HAIR_COLOR_OPTIONS).toHaveLength(6);
    expect(FACIAL_HAIR_OPTIONS).toHaveLength(4);
    // Hair styles and facial hair share kind "hair" but occupy different slots.
    for (const o of HAIR_STYLE_OPTIONS) {
      expect(AVATAR_MANIFEST_BY_ID[o.id].slots).toContain("hair");
    }
    for (const o of FACIAL_HAIR_OPTIONS) {
      expect(AVATAR_MANIFEST_BY_ID[o.id].slots).toContain("facialHair");
    }
  });

  it("face: 4 eye colours + 4 brow styles, all honored by the builder", () => {
    expect(EYE_COLOR_OPTIONS).toHaveLength(4);
    for (const o of EYE_COLOR_OPTIONS) {
      expect(AVATAR_MANIFEST_BY_ID[o.id].kind).toBe("texture");
    }
    expect(BROW_STYLE_OPTIONS).toHaveLength(4);
    for (const o of BROW_STYLE_OPTIONS) {
      expect(AVATAR_MANIFEST_BY_ID[o.id].slots).toContain("brows");
    }
  });

  it("accessories: 3 slots, one pick each, all available in the manifest", () => {
    expect(ACCESSORY_SLOT_OPTIONS.map((s) => s.slot)).toEqual([
      "head",
      "face",
      "ears",
    ]);
    const ids = ACCESSORY_SLOT_OPTIONS.flatMap((s) =>
      s.options.map((o) => o.id).filter((id) => id !== "none")
    );
    expect(ids).toHaveLength(3);
    for (const id of ids) {
      expect(AVATAR_MANIFEST_BY_ID[id].kind).toBe("accessory");
      expect(AVATAR_MANIFEST_BY_ID[id].status).toBe("available");
    }
    // Slot helpers: set + clear round-trip.
    const app = cloneApp();
    expect(accessoryIdForSlot(app.accessories, "face")).toBe("none");
    const withGlasses = setAccessorySlot(app, "face", "acc_glasses_01");
    expect(accessoryIdForSlot(withGlasses.accessories, "face")).toBe(
      "acc_glasses_01"
    );
    const cleared = setAccessorySlot(withGlasses, "face", "none");
    expect(accessoryIdForSlot(cleared.accessories, "face")).toBe("none");
    expect(cleared.accessories).toHaveLength(0);
    // Setting one slot never touches another.
    const two = setAccessorySlot(withGlasses, "head", "acc_cap_01");
    expect(two.accessories).toHaveLength(2);
  });

  it("outfit cards: each row resolves to its exact outfit with no fallback", () => {
    expect(OUTFIT_ROWS).toHaveLength(20); // 8 free + 12 boutique premium
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

  it("premium rows carry boutique linkage and unique decompositions", () => {
    const premium = OUTFIT_ROWS.filter((r) => r.premium);
    expect(premium).toHaveLength(12);
    const keys = premium.map(
      (r) => `${r.topId}|${r.bottomId}|${r.outerwearId ?? ""}|${r.shoeId}`
    );
    expect(new Set(keys).size).toBe(12); // all invertible, no collisions
    for (const r of premium) {
      expect(r.premium!.price).toBeGreaterThanOrEqual(15000);
      expect(r.premium!.price).toBeLessThanOrEqual(1800000);
      expect(["owambe", "street", "office", "traditional"]).toContain(
        r.premium!.occasion
      );
      // signature garment colors: the try-on look is the worn look.
      expect(r.premium!.signature.topColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(r.premium!.signature.bottomColor).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("applyOutfitRow applies premium signature colors, leaves free rows alone", () => {
    const app = cloneApp();
    const origTop = app.clothing.topColor;
    const premium = OUTFIT_ROWS.find((r) => r.outfitId === "tuxedo")!;
    const worn = applyOutfitRow(app, premium);
    expect(worn.clothing.topColor).toBe("#111418");
    expect(worn.clothing.bottomColor).toBe("#111418");
    const free = OUTFIT_ROWS.find((r) => r.outfitId === "casual")!;
    expect(applyOutfitRow(app, free).clothing.topColor).toBe(origTop);
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
    // Phase 6: palettes grew to include boutique signature garment colors.
    expect(TOP_COLOR_OPTIONS).toHaveLength(21);
    expect(BOTTOM_COLOR_OPTIONS).toHaveLength(20);
  });

  it("categories shipped: face/body/skin/hair/accessories/clothing — morph sliders omitted for cause", () => {
    expect(EDITOR_CATEGORIES.map((c) => c.id)).toEqual([
      "face",
      "body",
      "skin",
      "hair",
      "accessories",
      "clothing",
    ]);
    // Face morphs: only one head asset exists and every morph is stubbed —
    // there is nothing real a morph slider could control. (Eye colour and
    // brow style ARE honored, so the Face category ships with those.)
    const heads = manifestByKind("head", "available");
    expect(heads.map((a) => a.id)).toEqual(["face_default_01"]);
    expect(Object.values(MORPH_SUPPORT).every((s) => s === "stubbed")).toBe(
      true
    );
    // Accessories: 3 procedural assets now ship (M8).
    expect(manifestByKind("accessory", "available").map((a) => a.id).sort()).toEqual([
      "acc_cap_01",
      "acc_earrings_01",
      "acc_glasses_01",
    ]);
  });
});

describe("defect 4: facial-hair compatibility metadata", () => {
  it("styled facial hair is masculine-only in the manifest metadata", () => {
    const compat = new Map(
      FACIAL_HAIR_OPTIONS.map((o) => [o.id, o.compatibleBodyTypes])
    );
    expect(compat.get("facialhair_none_01")).toEqual([
      "masculine",
      "feminine",
    ]);
    for (const id of [
      "facialhair_mustache_01",
      "facialhair_goatee_01",
      "facialhair_beard_short_01",
    ]) {
      expect(compat.get(id)).toEqual(["masculine"]);
    }
    // Wired from the resolver's metadata, not hardcoded in the catalog:
    // the manifest is the source of truth.
    for (const o of FACIAL_HAIR_OPTIONS) {
      expect(AVATAR_MANIFEST_BY_ID[o.id].compatibleBodyTypes).toEqual(
        o.compatibleBodyTypes
      );
    }
  });

  it("facialHairOptionsForBody hides styled options for feminine bodies", () => {
    expect(facialHairOptionsForBody("feminine").map((o) => o.id)).toEqual([
      "facialhair_none_01",
    ]);
    expect(facialHairOptionsForBody("masculine").map((o) => o.id)).toEqual([
      "facialhair_none_01",
      "facialhair_mustache_01",
      "facialhair_goatee_01",
      "facialhair_beard_short_01",
    ]);
  });
});
