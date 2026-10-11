import { describe, expect, it } from "vitest";
import { migrateAvatarLookToV1, repairAppearanceV1 } from "./migrate";
import { validateAppearance, DEFAULT_APPEARANCE_V1 } from "./validation";
import type { AppearanceV1 } from "./schema";

const LEGACY = {
  body: "man",
  skin: "deep_espresso",
  hair: "afro",
  outfit: "sitework",
  fabric: "ankara",
  topColor: "#22D3EE",
  bottomColor: "#334155",
};

describe("migrateAvatarLookToV1", () => {
  it("migrates a complete legacy look", () => {
    const a = migrateAvatarLookToV1(LEGACY, "char_9");
    expect(a.schemaVersion).toBe(1);
    expect(a.characterId).toBe("char_9");
    expect(a.base.bodyType).toBe("masculine");
    expect(a.base.bodyPresetId).toBe("man");
    expect(a.base.skinToneId).toBe("deep_espresso");
    expect(a.hair.styleId).toBe("afro");
    expect(a.hair.colorId).toBe("hair_black_01");
    expect(a.hair.facialHairId).toBe("facialhair_none_01");
    // sitework decomposition: cargo + hi-vis vest + boots.
    expect(a.clothing.topId).toBe("top_tee_01");
    expect(a.clothing.bottomId).toBe("bottom_cargo_01");
    expect(a.clothing.outerwearId).toBe("outer_hivis_vest_01");
    expect(a.clothing.shoeId).toBe("shoe_boot_01");
    expect(a.clothing.fabricId).toBe("ankara");
    expect(a.clothing.topColor).toBe("#22d3ee"); // normalized
    expect(a.accessories).toEqual([]);
    // Output always validates.
    expect(validateAppearance(a).ok).toBe(true);
  });

  it("maps office → shirt + oxfords, chill → shorts + sneakers, hoodie → hood", () => {
    const office = migrateAvatarLookToV1({ ...LEGACY, outfit: "office" });
    expect(office.clothing.topId).toBe("top_shirt_office_01");
    expect(office.clothing.shoeId).toBe("shoe_oxford_01");
    expect(office.clothing.outerwearId).toBeNull();

    const chill = migrateAvatarLookToV1({ ...LEGACY, outfit: "chill" });
    expect(chill.clothing.bottomId).toBe("bottom_short_01");
    expect(chill.clothing.shoeId).toBe("shoe_sneaker_01");

    const hoodie = migrateAvatarLookToV1({ ...LEGACY, outfit: "hoodie" });
    expect(hoodie.clothing.outerwearId).toBe("outer_hoodie_01");
  });

  it("maps a legacy #hex skin to the matching tone id", () => {
    const a = migrateAvatarLookToV1({ ...LEGACY, skin: "#8a5f38" });
    expect(a.base.skinToneId).toBe("cocoa");
  });

  it("falls back field-by-field on unknown legacy ids", () => {
    const a = migrateAvatarLookToV1({
      body: "dragon",
      skin: "dragon",
      hair: "dragon",
      outfit: "dragon",
      fabric: "dragon",
      topColor: "#123456",
      bottomColor: "not-a-color",
    });
    expect(a.base.bodyPresetId).toBe("woman");
    expect(a.base.skinToneId).toBe("cocoa");
    expect(a.hair.styleId).toBe("lowcut"); // mirrors pipeline unknown → lowcut
    expect(a.clothing.bottomId).toBe("bottom_trouser_01");
    expect(a.clothing.shoeId).toBe("shoe_sneaker_01");
    expect(a.clothing.fabricId).toBe("plain");
    expect(a.clothing.topColor).toBe("#22d3ee");
    expect(a.clothing.bottomColor).toBe("#334155");
    expect(validateAppearance(a).ok).toBe(true);
  });

  it("migrates null / garbage to defaults without throwing", () => {
    for (const bad of [null, undefined, "nope", 42, true, ["x"], {}]) {
      const a = migrateAvatarLookToV1(bad, "c1");
      expect(a.characterId).toBe("c1");
      expect(a.base.bodyPresetId).toBe(
        DEFAULT_APPEARANCE_V1.base.bodyPresetId
      );
      expect(a.hair.styleId).toBe("lowcut");
      expect(a.clothing.fabricId).toBe("plain");
      expect(validateAppearance(a).ok).toBe(true);
    }
  });

  it("ignores extra unknown fields", () => {
    const a = migrateAvatarLookToV1({ ...LEGACY, hornStyle: "big", glb: "x" });
    expect(validateAppearance(a).ok).toBe(true);
    expect(a.hair.styleId).toBe("afro");
  });
});

describe("repairAppearanceV1 (defect 4: facial hair is masculine-only)", () => {
  function womanWithBeard(): AppearanceV1 {
    const a = JSON.parse(
      JSON.stringify(DEFAULT_APPEARANCE_V1)
    ) as AppearanceV1;
    a.base.bodyPresetId = "woman";
    a.base.bodyType = "feminine";
    a.hair.facialHairId = "facialhair_beard_short_01";
    return a;
  }

  it("cleans a feminine body + styled facial hair to clean-shaven", () => {
    for (const id of [
      "facialhair_mustache_01",
      "facialhair_goatee_01",
      "facialhair_beard_short_01",
    ] as const) {
      const a = womanWithBeard();
      a.hair.facialHairId = id;
      const repaired = repairAppearanceV1(a);
      expect(repaired.hair.facialHairId).toBe("facialhair_none_01");
      // Nothing else touched.
      expect(repaired.base.bodyPresetId).toBe("woman");
      expect(repaired.hair.styleId).toBe(a.hair.styleId);
      expect(validateAppearance(repaired).ok).toBe(true);
    }
  });

  it("leaves valid combos untouched (same reference)", () => {
    const cleanWoman = JSON.parse(
      JSON.stringify(DEFAULT_APPEARANCE_V1)
    ) as AppearanceV1;
    expect(repairAppearanceV1(cleanWoman)).toBe(cleanWoman);

    const beardedMan = womanWithBeard();
    beardedMan.base.bodyPresetId = "man";
    beardedMan.base.bodyType = "masculine";
    expect(repairAppearanceV1(beardedMan)).toBe(beardedMan);
  });

  it("never throws on garbage and returns the input", () => {
    for (const bad of [null, undefined, "nope", 42, {}, { hair: null }]) {
      expect(() =>
        repairAppearanceV1(bad as unknown as AppearanceV1)
      ).not.toThrow();
      expect(repairAppearanceV1(bad as unknown as AppearanceV1)).toBe(bad);
    }
  });
});
