/**
 * Èkó Life Avatar Engine — legacy → v1 migration (Milestone 2).
 *
 * `migrateAvatarLookToV1(raw, characterId?)` converts the legacy flat
 * `AvatarLook` (web/src/game/types.ts — `{body, skin, hair, outfit,
 * fabric, topColor, bottomColor}`, stored as JSON in
 * `characters.avatar_look`) into a canonical `AppearanceV1`.
 *
 * Guarantees:
 * - Total: null, undefined, garbage (strings, numbers, arrays), and
 *   partially-invalid looks all migrate — never throws, never returns
 *   invalid output. Unknown legacy ids fall back field-by-field to the
 *   current defaults (mirroring the pipeline's own fallbacks, e.g.
 *   unknown hair → lowcut).
 * - The returned value ALWAYS passes `validateAppearance()`. Migration
 *   builds a v1 candidate and runs it through validation; if validation
 *   ever fails, it returns a clone of DEFAULT_APPEARANCE_V1.
 * - Honest slot mapping for slots that did not exist in the legacy shape:
 *   - `hair.colorId` → "hair_black_01" (M2 hair is always HAIR_HEX #171110).
 *   - `hair.facialHairId` → "facialhair_none_01" (no facial hair in M2).
 *   - `shoeId` → derived from the outfit (feet are never bare in M2;
 *     there is deliberately no `shoe_none_*` id).
 *   - `facePresetId` → "face_default_01"; `accessories` → []; morphs → 0.5.
 * - Legacy `skin` may be a tone id OR a #hex (the 3D builder tolerates
 *   both); a hex matching a known tone hex maps to that tone, otherwise
 *   the default.
 *
 * Pure: no DOM, no three.js imports. Importable from client and server.
 */

import {
  AVATAR_SCHEMA_VERSION,
  BODY_PRESET_TO_TYPE,
  type AppearanceV1,
  type BodyPresetId,
  type BodyType,
  type ClothingBottomId,
  type ClothingTopId,
  type FabricId,
  type HairStyleId,
  type OuterwearId,
  type ShoeId,
  type SkinToneId,
} from "./schema";
import { AVATAR_MANIFEST_BY_ID } from "./manifest";
import {
  AVATAR_BOTTOM_COLORS,
  AVATAR_TOP_COLORS,
  DEFAULT_APPEARANCE_V1,
  validateAppearance,
} from "./validation";

const LEGACY_BODY_PRESETS: readonly BodyPresetId[] = ["woman", "man"];
const LEGACY_HAIRS: readonly HairStyleId[] = [
  "lowcut",
  "bald",
  "curls",
  "afro",
  "locs",
  "braids",
  "classic",
];
const LEGACY_FABRICS: readonly FabricId[] = ["plain", "ankara", "adire", "asoke"];

interface OutfitDecomposition {
  topId: ClothingTopId;
  bottomId: ClothingBottomId;
  outerwearId: OuterwearId | null;
  shoeId: ShoeId;
}

/** Outfit → decomposed slots (mirrors parts/clothing.ts per-outfit builds). */
const OUTFIT_DECOMPOSITION: Record<string, OutfitDecomposition> = {
  casual: {
    topId: "top_tee_01",
    bottomId: "bottom_trouser_01",
    outerwearId: null,
    shoeId: "shoe_sneaker_01",
  },
  hoodie: {
    topId: "top_tee_01",
    bottomId: "bottom_trouser_01",
    outerwearId: "outer_hoodie_01",
    shoeId: "shoe_sneaker_01",
  },
  office: {
    topId: "top_shirt_office_01",
    bottomId: "bottom_trouser_01",
    outerwearId: null,
    shoeId: "shoe_oxford_01",
  },
  chill: {
    topId: "top_tee_01",
    bottomId: "bottom_short_01",
    outerwearId: null,
    shoeId: "shoe_sneaker_01",
  },
  sitework: {
    topId: "top_tee_01",
    bottomId: "bottom_cargo_01",
    outerwearId: "outer_hivis_vest_01",
    shoeId: "shoe_boot_01",
  },
  // Phase 6: boutique premium outfits (novel combos, invertible).
  senator: {
    topId: "top_agbada_01",
    bottomId: "bottom_trouser_01",
    outerwearId: null,
    shoeId: "shoe_oxford_01",
  },
  dashiki: {
    topId: "top_tee_01",
    bottomId: "bottom_trouser_01",
    outerwearId: null,
    shoeId: "shoe_sandal_01",
  },
  kaftan: {
    topId: "top_agbada_01",
    bottomId: "bottom_skirt_01",
    outerwearId: null,
    shoeId: "shoe_sandal_01",
  },
  adire_gown: {
    topId: "top_dress_01",
    bottomId: "bottom_skirt_01",
    outerwearId: null,
    shoeId: "shoe_sneaker_01",
  },
  ankara_set: {
    topId: "top_dress_01",
    bottomId: "bottom_skirt_01",
    outerwearId: null,
    shoeId: "shoe_sandal_01",
  },
  asoebi: {
    topId: "top_dress_01",
    bottomId: "bottom_short_01",
    outerwearId: null,
    shoeId: "shoe_heel_01",
  },
  tuxedo: {
    topId: "top_shirt_office_01",
    bottomId: "bottom_cargo_01",
    outerwearId: null,
    shoeId: "shoe_oxford_01",
  },
  suit: {
    topId: "top_tee_01",
    bottomId: "bottom_trouser_01",
    outerwearId: null,
    shoeId: "shoe_oxford_01",
  },
  streetwear: {
    topId: "top_tee_01",
    bottomId: "bottom_cargo_01",
    outerwearId: null,
    shoeId: "shoe_sneaker_01",
  },
  denim: {
    topId: "top_tank_01",
    bottomId: "bottom_trouser_01",
    outerwearId: null,
    shoeId: "shoe_sneaker_01",
  },
  sport_luxe: {
    topId: "top_tank_01",
    bottomId: "bottom_trouser_01",
    outerwearId: "outer_hoodie_01",
    shoeId: "shoe_sneaker_01",
  },
  royalty: {
    topId: "top_agbada_01",
    bottomId: "bottom_cargo_01",
    outerwearId: null,
    shoeId: "shoe_sandal_01",
  },
};

const DEFAULT_OUTFIT = OUTFIT_DECOMPOSITION.casual;

/** Hex (lowercased) → skin tone id, for legacy looks that stored a #hex. */
const SKIN_HEX_TO_ID: Record<string, SkinToneId> = (() => {
  const map: Record<string, SkinToneId> = {};
  for (const asset of Object.values(AVATAR_MANIFEST_BY_ID)) {
    if (
      asset.kind === "texture" &&
      asset.status === "available" &&
      asset.hex &&
      !asset.id.startsWith("hair_") &&
      !["plain", "ankara", "adire", "asoke"].includes(asset.id)
    ) {
      map[asset.hex.toLowerCase()] = asset.id as SkinToneId;
    }
  }
  return map;
})();

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function cloneDefault(characterId: string): AppearanceV1 {
  const c = JSON.parse(JSON.stringify(DEFAULT_APPEARANCE_V1)) as AppearanceV1;
  c.characterId = characterId;
  return c;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function pickColor(value: unknown, palette: readonly string[], fallback: string): string {
  if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) {
    const norm = value.toLowerCase();
    if (palette.includes(norm)) return norm;
  }
  return fallback;
}

/**
 * Defect 4 — v1 repair migration: facial hair is masculine-only.
 *
 * Cleans saves written before the compatibility rule existed: a
 * feminine body (`woman` preset) with a styled facial-hair id falls
 * back to clean-shaven (`facialhair_none_01`). Everything else passes
 * through untouched.
 *
 * Never throws and never invalidates: the input is expected to be a
 * validated AppearanceV1 (validateAppearance fills defaults), so the
 * output is validated again before return — on any surprise, the input
 * is returned unchanged rather than risk corrupting a save.
 */
export function repairAppearanceV1(appearance: AppearanceV1): AppearanceV1 {
  try {
    const hair = appearance?.hair;
    const base = appearance?.base;
    if (!hair || !base) return appearance;
    const isFeminine = base.bodyType === "feminine";
    const hasBeard =
      typeof hair.facialHairId === "string" &&
      hair.facialHairId !== "facialhair_none_01";
    if (!isFeminine || !hasBeard) return appearance;
    const repaired: AppearanceV1 = JSON.parse(JSON.stringify(appearance));
    repaired.hair.facialHairId = "facialhair_none_01";
    const v = validateAppearance(repaired);
    return v.ok && v.appearance ? v.appearance : appearance;
  } catch {
    return appearance;
  }
}
/**
 * Migrate a legacy flat AvatarLook (or null/garbage) to AppearanceV1.
 * Never throws; output always passes validateAppearance().
 */
export function migrateAvatarLookToV1(
  raw: unknown,
  characterId = ""
): AppearanceV1 {
  if (!isRecord(raw)) {
    return cloneDefault(characterId);
  }

  const bodyPresetId = pick<BodyPresetId>(
    raw.body,
    LEGACY_BODY_PRESETS,
    DEFAULT_APPEARANCE_V1.base.bodyPresetId
  );
  const bodyType: BodyType = BODY_PRESET_TO_TYPE[bodyPresetId];

  // skin: tone id, or a #hex matching a known tone hex.
  let skinToneId: SkinToneId = DEFAULT_APPEARANCE_V1.base.skinToneId;
  if (typeof raw.skin === "string") {
    if ((Object.values(SKIN_HEX_TO_ID) as string[]).includes(raw.skin)) {
      skinToneId = raw.skin as SkinToneId;
    } else if (/^#[0-9a-fA-F]{6}$/.test(raw.skin)) {
      const mapped = SKIN_HEX_TO_ID[raw.skin.toLowerCase()];
      if (mapped) skinToneId = mapped;
    }
  }

  const hairStyleId = pick<HairStyleId>(
    raw.hair,
    LEGACY_HAIRS,
    DEFAULT_APPEARANCE_V1.hair.styleId
  );

  const outfit =
    typeof raw.outfit === "string" && OUTFIT_DECOMPOSITION[raw.outfit]
      ? OUTFIT_DECOMPOSITION[raw.outfit]
      : DEFAULT_OUTFIT;

  const fabricId = pick<FabricId>(
    raw.fabric,
    LEGACY_FABRICS,
    DEFAULT_APPEARANCE_V1.clothing.fabricId
  );

  const candidate = {
    schemaVersion: AVATAR_SCHEMA_VERSION,
    characterId: typeof raw.characterId === "string" ? raw.characterId : characterId,
    base: {
      bodyType,
      bodyPresetId,
      facePresetId: "face_default_01",
      skinToneId,
    },
    morphs: {},
    hair: {
      styleId: hairStyleId,
      colorId: "hair_black_01",
      facialHairId: "facialhair_none_01",
    },
    clothing: {
      topId: outfit.topId,
      bottomId: outfit.bottomId,
      outerwearId: outfit.outerwearId,
      shoeId: outfit.shoeId,
      fabricId,
      topColor: pickColor(raw.topColor, AVATAR_TOP_COLORS, DEFAULT_APPEARANCE_V1.clothing.topColor),
      bottomColor: pickColor(raw.bottomColor, AVATAR_BOTTOM_COLORS, DEFAULT_APPEARANCE_V1.clothing.bottomColor),
    },
    accessories: [],
  };

  const result = validateAppearance(candidate);
  if (result.ok && result.appearance) {
    return result.appearance;
  }
  // Belt and braces: validation should never fail on our own candidate,
  // but if it does, return clean defaults rather than invalid data.
  return cloneDefault(characterId);
}
