/**
 * Èkó Life Avatar Engine — canonical versioned appearance schema (Milestone 2).
 *
 * Pure data model: no DOM, no three.js imports. Safe to import from the web
 * client AND (later) the Node server — keep it that way.
 *
 * Design notes:
 * - Existing ids are kept VERBATIM as canonical ids (skin tones, hairstyles,
 *   outfits, fabrics, body presets). Stability protects existing saves in
 *   `characters.avatar_look`. One correction: the real server id for Aso-oke
 *   is `asoke` (server/src/game/data.js AVATAR_FABRICS), not `aso-oke`.
 * - Morphs are validated and stored from v1, but the Milestone-2 procedural
 *   builder does NOT read them (there is no morph-target/blendshape system in
 *   the pipeline — see docs/AVATAR_ENGINE_AUDIT.md). Each permitted morph maps
 *   1:1 to a sculpt term that already exists in web/src/views/avatar/parts/
 *   (head.ts sculptSkull / nose / mouth geometry), so Milestone 3 can wire
 *   them in without a schema change.
 * - `clothing` carries `fabricId`, `topColor`, `bottomColor` in addition to
 *   the requested slots: the current procedural pipeline (clothing.ts +
 *   materials.ts) requires all three, and dropping them would lose the
 *   ankara/adire/aso-oke fabric feature.
 */

export const AVATAR_SCHEMA_VERSION = 1 as const;

/* ------------------------------------------------------------------ */
/* Base                                                                */
/* ------------------------------------------------------------------ */

export type BodyType = "masculine" | "feminine";

/** Verbatim legacy ids: `woman` / `man` (server AVATAR_BODIES). */
export type BodyPresetId = "woman" | "man";

export const BODY_PRESET_TO_TYPE: Record<BodyPresetId, BodyType> = {
  woman: "feminine",
  man: "masculine",
};

export type FacePresetId = "face_default_01";

/** Verbatim legacy skin-tone ids (server AVATAR_SKINS). */
export type SkinToneId =
  | "deep_espresso"
  | "dark_cocoa"
  | "burnt_caramel"
  | "mahogany"
  | "walnut"
  | "cocoa"
  | "coffee"
  | "latte"
  | "honey"
  | "sand"
  | "amber"
  | "cream";

export interface AppearanceBase {
  bodyType: BodyType;
  bodyPresetId: BodyPresetId;
  facePresetId: FacePresetId;
  skinToneId: SkinToneId;
}

/* ------------------------------------------------------------------ */
/* Morphs                                                              */
/* ------------------------------------------------------------------ */

/**
 * Permitted morph keys. Every morph is a 0..1 scalar, default 0.5
 * (current procedural geometry ≈ neutral 0.5). `pipelineTerm` names the
 * existing sculpt term in parts/head.ts the morph will drive in M3.
 *
 * ACCEPTED BUT NOT HONORED in M2: the builder ignores morphs entirely.
 * Manifest entries therefore list `supportedMorphs: []` until M3 wires
 * them in.
 */
export interface MorphDef {
  key: string;
  default: number;
  min: number;
  max: number;
  description: string;
  /** Existing sculpt term in parts/head.ts this morph will drive (M3). */
  pipelineTerm: string;
}

export const PERMITTED_MORPHS: readonly MorphDef[] = [
  { key: "jawWidth", default: 0.5, min: 0, max: 1, description: "Jaw width / taper strength", pipelineTerm: "sculptSkull jaw-taper factor (0.24)" },
  { key: "cheekboneHeight", default: 0.5, min: 0, max: 1, description: "Cheekbone lift height", pipelineTerm: "sculptSkull cheekBoost centre (ny 0.03)" },
  { key: "noseWidth", default: 0.5, min: 0, max: 1, description: "Nose width (dorsum + alae)", pipelineTerm: "nose dorsum/ala mesh scale.x" },
  { key: "noseLength", default: 0.5, min: 0, max: 1, description: "Nose length (bridge to tip)", pipelineTerm: "nose tip/dorsum mesh scale.y + y offset" },
  { key: "lipFullness", default: 0.5, min: 0, max: 1, description: "Lip fullness", pipelineTerm: "mouth upper/lower lip mesh scale" },
  { key: "browProminence", default: 0.5, min: 0, max: 1, description: "Brow ridge prominence", pipelineTerm: "sculptSkull brow-ridge term (0.0022)" },
  { key: "chinLength", default: 0.5, min: 0, max: 1, description: "Chin length / projection", pipelineTerm: "sculptSkull chin forward/down term" },
  { key: "eyeSpacing", default: 0.5, min: 0, max: 1, description: "Eye spacing (interpupillary distance)", pipelineTerm: "buildEye group x offset (±0.0415)" },
  { key: "foreheadSlope", default: 0.5, min: 0, max: 1, description: "Forehead slope", pipelineTerm: "sculptSkull forehead slope-back term" },
] as const;

export type MorphKey = (typeof PERMITTED_MORPHS)[number]["key"];

/** Partial morph input (client may send only the morphs it changed). */
export type AppearanceMorphInput = Partial<Record<MorphKey, number>>;

/* ------------------------------------------------------------------ */
/* Hair                                                                */
/* ------------------------------------------------------------------ */

/** Verbatim legacy ids (server AVATAR_HAIRS; pipeline unknown → lowcut),
 * plus the M3 procedural styles (taper fade, waves). */
export type HairStyleId =
  | "lowcut"
  | "bald"
  | "curls"
  | "afro"
  | "locs"
  | "braids"
  | "classic"
  | "hair_taper_fade_01"
  | "hair_waves_01";

/**
 * `hair_black_01` = the default hair colour (HAIR_HEX `#171110` in
 * parts/materials.ts). M3b adds dark brown and brown; buildHair(colorId)
 * in parts/hair.ts tints the hair and the facial hair follows
 * mats.hairMat.
 */
export type HairColorId = "hair_black_01" | "hair_dark_brown_01" | "hair_brown_01";

/**
 * Procedural facial hair (M3b, parts/facialHair.ts). buildFacialHair()
 * returns null for "facialhair_none_01" / unknown ids.
 */
export type FacialHairId =
  | "facialhair_none_01"
  | "facialhair_mustache_01"
  | "facialhair_goatee_01"
  | "facialhair_beard_short_01";

export interface AppearanceHair {
  styleId: HairStyleId;
  colorId: HairColorId;
  facialHairId: FacialHairId;
}

/* ------------------------------------------------------------------ */
/* Clothing                                                            */
/* ------------------------------------------------------------------ */

/**
 * Decomposed from the 5 legacy outfits. Honest mapping notes:
 * - Footwear is OUTFIT-IMPLIED in the M2 pipeline (clothing.ts
 *   buildFootwear: casual/hoodie/chill → sneaker, office → oxford,
 *   sitework → boot). Feet are NEVER bare today, so there is no
 *   `shoe_none_*` id — shoeId is derived from the outfit at migration.
 * - Outerwear is null unless the outfit builds one (hoodie → hood/cowl,
 *   sitework → hi-vis vest).
 */
export type ClothingTopId = "top_tee_01" | "top_shirt_office_01";
export type ClothingBottomId =
  | "bottom_trouser_01"
  | "bottom_short_01"
  | "bottom_cargo_01";
export type OuterwearId = "outer_hoodie_01" | "outer_hivis_vest_01";
/** Verbatim legacy ids (server AVATAR_FABRICS). */
export type FabricId = "plain" | "ankara" | "adire" | "asoke";

export interface AppearanceClothing {
  topId: ClothingTopId;
  bottomId: ClothingBottomId;
  outerwearId: OuterwearId | null;
  shoeId: ShoeId;
  fabricId: FabricId;
  /** #rrggbb, must be in the server top-color palette. */
  topColor: string;
  /** #rrggbb, must be in the server bottom-color palette. */
  bottomColor: string;
}

export type ShoeId = "shoe_sneaker_01" | "shoe_oxford_01" | "shoe_boot_01";

/* ------------------------------------------------------------------ */
/* Accessories                                                         */
/* ------------------------------------------------------------------ */

export type AccessorySlot = "head" | "face" | "ears" | "neck" | "wrist";

export interface AppearanceAccessory {
  slot: AccessorySlot;
  /** Manifest asset id (kind "accessory"). No accessory assets ship in M2. */
  assetId: string;
}

/* ------------------------------------------------------------------ */
/* Root                                                                */
/* ------------------------------------------------------------------ */

export interface AppearanceV1 {
  schemaVersion: typeof AVATAR_SCHEMA_VERSION;
  /** Server character id (opaque string); "" when unknown. */
  characterId: string;
  base: AppearanceBase;
  /** Canonical form: every permitted morph key present, each 0..1. */
  morphs: Record<MorphKey, number>;
  hair: AppearanceHair;
  clothing: AppearanceClothing;
  accessories: AppearanceAccessory[];
}

/** Unknown-shape input accepted by validateAppearance(). */
export type AppearanceInput = unknown;
