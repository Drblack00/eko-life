import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE_V1,
  validateAppearance,
} from "./validation";
import { PERMITTED_MORPHS } from "./schema";

const VALID = {
  schemaVersion: 1,
  characterId: "char_123",
  base: {
    bodyType: "masculine",
    bodyPresetId: "man",
    facePresetId: "face_default_01",
    skinToneId: "deep_espresso",
  },
  morphs: { jawWidth: 0.7, noseWidth: 0.3 },
  hair: { styleId: "afro", colorId: "hair_black_01", facialHairId: "facialhair_none_01" },
  clothing: {
    topId: "top_tee_01",
    bottomId: "bottom_cargo_01",
    outerwearId: "outer_hivis_vest_01",
    shoeId: "shoe_boot_01",
    fabricId: "ankara",
    topColor: "#22d3ee",
    bottomColor: "#334155",
  },
  accessories: [],
};

describe("validateAppearance", () => {
  it("accepts a fully valid appearance", () => {
    const r = validateAppearance(VALID);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.appearance?.base.bodyType).toBe("masculine");
    expect(r.appearance?.hair.styleId).toBe("afro");
    expect(r.appearance?.morphs.jawWidth).toBe(0.7);
    // Unspecified morphs get defaults.
    expect(r.appearance?.morphs.cheekboneHeight).toBe(0.5);
  });

  it("accepts the canonical default", () => {
    const r = validateAppearance(DEFAULT_APPEARANCE_V1);
    expect(r.ok).toBe(true);
  });

  it("rejects non-object input", () => {
    for (const bad of [null, undefined, "nope", 42, ["x"]]) {
      const r = validateAppearance(bad);
      expect(r.ok).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
    }
  });

  it("rejects unknown ids in every section", () => {
    const r = validateAppearance({
      ...VALID,
      base: { ...VALID.base, skinToneId: "dragon" },
      hair: { ...VALID.hair, styleId: "../../etc/passwd" },
      clothing: { ...VALID.clothing, shoeId: "https://evil.com/x.glb" },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("base.skinToneId"))).toBe(true);
    expect(r.errors.some((e) => e.includes("hair.styleId"))).toBe(true);
    expect(r.errors.some((e) => e.includes("clothing.shoeId"))).toBe(true);
  });

  it("rejects renderer objects / non-string ids", () => {
    const r = validateAppearance({
      ...VALID,
      hair: { ...VALID.hair, styleId: { glb: "x" } },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects unknown morph keys", () => {
    const r = validateAppearance({ ...VALID, morphs: { eyeLaser: 0.5 } });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("morphs.eyeLaser"))).toBe(true);
  });

  it("rejects out-of-range morph values (no silent clamping)", () => {
    for (const v of [-0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = validateAppearance({ ...VALID, morphs: { jawWidth: v } });
      expect(r.ok).toBe(false);
      expect(r.errors.some((e) => e.includes("morphs.jawWidth"))).toBe(true);
    }
  });

  it("rejects non-numeric morph values", () => {
    const r = validateAppearance({ ...VALID, morphs: { jawWidth: "wide" } });
    expect(r.ok).toBe(false);
  });

  it("rejects bodyType/bodyPresetId mismatch", () => {
    const r = validateAppearance({
      ...VALID,
      base: { ...VALID.base, bodyType: "feminine", bodyPresetId: "man" },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("base"))).toBe(true);
  });

  it("rejects colours outside the server palettes", () => {
    const r = validateAppearance({
      ...VALID,
      clothing: { ...VALID.clothing, topColor: "#123456" },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("clothing.topColor"))).toBe(true);
  });

  it("normalizes uppercase palette colours", () => {
    const r = validateAppearance({
      ...VALID,
      clothing: { ...VALID.clothing, topColor: "#22D3EE" },
    });
    expect(r.ok).toBe(true);
    expect(r.appearance?.clothing.topColor).toBe("#22d3ee");
  });

  it("applies safe defaults for missing optionals", () => {
    const r = validateAppearance({
      base: { bodyType: "masculine", bodyPresetId: "man" },
    });
    expect(r.ok).toBe(true);
    const a = r.appearance!;
    expect(a.schemaVersion).toBe(1);
    expect(a.base.skinToneId).toBe("cocoa");
    expect(a.hair.styleId).toBe("lowcut");
    expect(a.clothing.shoeId).toBe("shoe_sneaker_01");
    expect(a.accessories).toEqual([]);
    // Every permitted morph present at default.
    for (const def of PERMITTED_MORPHS) {
      expect(a.morphs[def.key as keyof typeof a.morphs]).toBe(def.default);
    }
  });

  it("rejects an unsupported schemaVersion", () => {
    const r = validateAppearance({ ...VALID, schemaVersion: 2 });
    expect(r.ok).toBe(false);
  });

  it("rejects duplicate accessory slots", () => {
    const r = validateAppearance({
      ...VALID,
      accessories: [
        { slot: "neck", assetId: "accessory_glb_pack" },
        { slot: "neck", assetId: "accessory_glb_pack" },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects pending-status assets as unwearable", () => {
    // body_glb_base is pending — must not validate as a face preset or asset.
    const r = validateAppearance({
      ...VALID,
      base: { ...VALID.base, facePresetId: "body_glb_base" },
    });
    expect(r.ok).toBe(false);
  });
});
