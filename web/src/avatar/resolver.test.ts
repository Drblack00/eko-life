import { describe, expect, it } from "vitest";
import {
  assertCompatible,
  AvatarAssetError,
  isSafeAssetRef,
  resolveAsset,
  resolveAssetOrFallback,
} from "./resolver";
import { AVATAR_MANIFEST, AVATAR_MANIFEST_BY_ID } from "./manifest";
import { DEFAULT_APPEARANCE_V1 } from "./validation";

describe("resolver", () => {
  it("resolves a known available asset", () => {
    const a = resolveAsset("afro");
    expect(a.id).toBe("afro");
    expect(a.status).toBe("available");
    expect(a.source).toBe("procedural");
  });

  it("throws UNKNOWN_ASSET on unknown ids", () => {
    expect(() => resolveAsset("dragon")).toThrowError(AvatarAssetError);
    try {
      resolveAsset("dragon");
    } catch (e) {
      expect((e as AvatarAssetError).code).toBe("UNKNOWN_ASSET");
    }
  });

  it("throws ASSET_UNAVAILABLE on pending licensed-GLB entries", () => {
    expect(() => resolveAsset("body_glb_base")).toThrowError(AvatarAssetError);
    try {
      resolveAsset("body_glb_base");
    } catch (e) {
      expect((e as AvatarAssetError).code).toBe("ASSET_UNAVAILABLE");
    }
  });

  it("resolveAssetOrFallback walks the fallback chain", () => {
    // oxford → sneaker (available).
    const a = resolveAssetOrFallback("shoe_oxford_01");
    expect(a.id).toBe("shoe_oxford_01");
    // Unknown id with no fallback chain → throws.
    expect(() => resolveAssetOrFallback("nope")).toThrowError(AvatarAssetError);
  });

  it("assertCompatible rejects bodyType mismatches", () => {
    const man = AVATAR_MANIFEST_BY_ID["man"];
    const feminine = {
      ...DEFAULT_APPEARANCE_V1,
      base: { ...DEFAULT_APPEARANCE_V1.base, bodyType: "feminine" as const },
    };
    expect(() => assertCompatible(man, feminine)).toThrowError(AvatarAssetError);
    // Matching type passes silently.
    const masculine = {
      ...DEFAULT_APPEARANCE_V1,
      base: { ...DEFAULT_APPEARANCE_V1.base, bodyType: "masculine" as const, bodyPresetId: "man" as const },
    };
    expect(() => assertCompatible(man, masculine)).not.toThrow();
  });

  it("isSafeAssetRef rejects paths, URLs, and non-strings", () => {
    expect(isSafeAssetRef("../../etc/passwd")).toBe(false);
    expect(isSafeAssetRef("https://evil.com/x.glb")).toBe(false);
    expect(isSafeAssetRef("file:///tmp/x.glb")).toBe(false);
    expect(isSafeAssetRef("")).toBe(false);
    expect(isSafeAssetRef(null)).toBe(false);
    expect(isSafeAssetRef(42)).toBe(false);
    expect(isSafeAssetRef({ id: "afro" })).toBe(false);
    // Manifest ids pass (including pending — wearability is a separate check).
    expect(isSafeAssetRef("afro")).toBe(true);
    expect(isSafeAssetRef("body_glb_base")).toBe(true);
  });
});

describe("manifest integrity", () => {
  it("has unique ids and valid statuses/licenses", () => {
    const ids = AVATAR_MANIFEST.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of AVATAR_MANIFEST) {
      expect(["available", "pending", "deprecated"]).toContain(a.status);
      expect(["original-procedural", "tbd-licensed"]).toContain(a.license);
      expect(a.version).toBe(1);
    }
  });

  it("registers every real procedural part as available", () => {
    const ids = new Set(AVATAR_MANIFEST.filter((a) => a.status === "available").map((a) => a.id));
    // 2 bodies + 1 head + 7 hair + 1 hair colour + 1 facial hair
    // + 12 skin tones + 4 fabrics + 2 tops + 3 bottoms + 2 outerwear + 3 shoes
    for (const id of [
      "woman", "man", "face_default_01",
      "lowcut", "bald", "curls", "afro", "locs", "braids", "classic",
      "hair_black_01", "facialhair_none_01",
      "deep_espresso", "dark_cocoa", "burnt_caramel", "mahogany",
      "walnut", "cocoa", "coffee", "latte",
      "honey", "sand", "amber", "cream",
      "plain", "ankara", "adire", "asoke",
      "top_tee_01", "top_shirt_office_01",
      "bottom_trouser_01", "bottom_short_01", "bottom_cargo_01",
      "outer_hoodie_01", "outer_hivis_vest_01",
      "shoe_sneaker_01", "shoe_oxford_01", "shoe_boot_01",
    ]) {
      expect(ids.has(id), `missing available asset ${id}`).toBe(true);
    }
  });

  it("pending GLB entries are never available and carry integration notes", () => {
    for (const id of ["body_glb_base", "hair_glb_pack", "clothing_glb_pack", "accessory_glb_pack"]) {
      const a = AVATAR_MANIFEST_BY_ID[id];
      expect(a.status).toBe("pending");
      expect(a.source).toBe("licensed-glb");
      expect(a.license).toBe("tbd-licensed");
      expect(a.integration).toMatch(/glTF 2\.0/);
      expect(a.integration).toMatch(/license/i);
    }
  });

  it("every fallbackAssetId resolves to an available asset", () => {
    for (const a of AVATAR_MANIFEST) {
      if (a.fallbackAssetId) {
        const f = AVATAR_MANIFEST_BY_ID[a.fallbackAssetId];
        expect(f, `${a.id} fallback`).toBeDefined();
        expect(f.status).toBe("available");
      }
    }
  });

  it("procedural assets honestly name the Group-pivot rig", () => {
    for (const a of AVATAR_MANIFEST) {
      if (a.source === "procedural") {
        expect(a.skeletonId).toBe("eko-proc-rig-v1");
      }
    }
  });

  it("no M2 procedural asset claims to honor morphs", () => {
    for (const a of AVATAR_MANIFEST) {
      if (a.status === "available") {
        expect(a.supportedMorphs).toEqual([]);
      }
    }
  });
});
