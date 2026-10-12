/**
 * Èkó Life Avatar Engine — typed asset registry (Milestone 2).
 *
 * Every real procedural part in web/src/views/avatar/parts/ is registered as
 * `status: "available"` with `source: "procedural"`. Future licensed-GLB
 * assets are registered as `status: "pending"` with `integration` notes —
 * NEVER as available.
 *
 * Honest rig note: `skeletonId: "eko-proc-rig-v1"` names the Group-pivot rig
 * (upper, headMount, armL, armR, eyeL, eyeR). It is NOT a skinned skeleton:
 * no SkinnedMesh, no bones, no skinning weights (see AVATAR_ENGINE_AUDIT.md).
 *
 * Pure data: no DOM, no three.js imports. Importable from client and server.
 */

import type { BodyType, MorphKey } from "./schema";

export type AssetKind =
  | "body"
  | "head"
  | "hair"
  | "clothing"
  | "accessory"
  | "texture"
  | "material-profile";

export type AssetStatus = "available" | "pending" | "deprecated";

export type AssetSource = "procedural" | "licensed-glb";

export type AssetLicense = "original-procedural" | "tbd-licensed";

export interface AvatarAsset {
  /** Canonical id. Only manifest ids are ever accepted as asset refs. */
  id: string;
  name: string;
  kind: AssetKind;
  status: AssetStatus;
  /**
   * "procedural" = generated at runtime by web/src/views/avatar/parts/.
   * "licensed-glb" = future external model (pending entries only).
   */
  source: AssetSource;
  version: 1;
  /**
   * "eko-proc-rig-v1" for procedural assets: the Group-pivot rig, NOT a
   * skinned skeleton. Pending GLB entries name their required skeleton in
   * `integration` instead.
   */
  skeletonId: string;
  /** Id of a "material-profile" asset in this manifest. */
  materialProfile: string;
  compatibleBodyTypes: BodyType[];
  /**
   * Morph keys the asset's builder actually honors TODAY. Empty for all M2
   * procedural assets — morphs are validated/stored but not yet applied
   * (Milestone 3 wires them into the sculpt terms).
   */
  supportedMorphs: MorphKey[];
  /** Wearable slots this asset occupies (empty for textures/profiles). */
  slots: string[];
  /** Safe fallback used by resolveAssetOrFallback(). Null = none. */
  fallbackAssetId: string | null;
  license: AssetLicense;
  /** For texture assets (skin tones, hair colours): the base colour. */
  hex?: string;
  /** Procedural builder reference, e.g. "parts/hair.ts:buildAfro". */
  proceduralRef?: string;
  /** Pending assets: what integration requires before they can go live. */
  integration?: string;
}

/* ------------------------------------------------------------------ */
/* Material profiles (mirror parts/materials.ts material families)      */
/* ------------------------------------------------------------------ */

const MAT = {
  skin: "mat_skin_01",
  hair: "hair_mat_01",
  garmentSolid: "mat_garment_solid_01",
  garmentPattern: "mat_garment_pattern_01",
  shoe: "mat_shoe_01",
  eye: "mat_eye_01",
} as const;

const RIG = "eko-proc-rig-v1";
const BOTH: BodyType[] = ["masculine", "feminine"];

function proc(
  id: string,
  name: string,
  kind: AvatarAsset["kind"],
  materialProfile: string,
  opts: Partial<AvatarAsset> = {}
): AvatarAsset {
  return {
    id,
    name,
    kind,
    status: "available",
    source: "procedural",
    version: 1,
    skeletonId: RIG,
    materialProfile,
    compatibleBodyTypes: BOTH,
    supportedMorphs: [],
    slots: [],
    fallbackAssetId: null,
    license: "original-procedural",
    ...opts,
  };
}

function pending(
  id: string,
  name: string,
  kind: AvatarAsset["kind"],
  integration: string,
  opts: Partial<AvatarAsset> = {}
): AvatarAsset {
  return {
    id,
    name,
    kind,
    status: "pending",
    source: "licensed-glb",
    version: 1,
    skeletonId: "tbd — see integration notes",
    materialProfile: MAT.garmentSolid,
    compatibleBodyTypes: BOTH,
    supportedMorphs: [],
    slots: [],
    fallbackAssetId: null,
    license: "tbd-licensed",
    integration,
    ...opts,
  };
}

const GLB_INTEGRATION = [
  "Required format: glTF 2.0 (.glb), Y-up, meters.",
  "Skeleton: Mixamo-compatible, OR a documented eko skeleton (bone names, rest pose, unit scale).",
  "License: the license field is MANDATORY — commercial redistribution rights for in-game avatars must be on file before the asset leaves 'pending'.",
  "PBR texture channels expected: baseColor, normal, metallicRoughness (or separate metallic + roughness), occlusion; emissive optional.",
  "Textures: power-of-two, max 2048px. Meshes must be manifold; triangle budget counts against the avatar total (≤ ~25k).",
].join(" ");

const SKIN_TONES: Array<[string, string, string]> = [
  // [id, name, hex] — verbatim from server AVATAR_SKINS, plus the M8
  // expansion pack (onyx → ivory).
  ["onyx", "Onyx", "#291709"],
  ["deep_espresso", "Deep Espresso", "#3b2314"],
  ["dark_cocoa", "Dark Cocoa", "#4a2c17"],
  ["truffle", "Truffle", "#553521"],
  ["burnt_caramel", "Burnt Caramel", "#5d3a1f"],
  ["mahogany", "Mahogany", "#6f4426"],
  ["walnut", "Walnut", "#7d5330"],
  ["sienna", "Sienna", "#835c36"],
  ["cocoa", "Cocoa", "#8a5f38"],
  ["coffee", "Coffee", "#9a6f45"],
  ["caramel", "Caramel", "#a37a4e"],
  ["latte", "Latte", "#ab8054"],
  ["honey", "Honey", "#bc9066"],
  ["sand", "Sand", "#cda077"],
  ["butterscotch", "Butterscotch", "#d4a878"],
  ["amber", "Amber", "#dcb07e"],
  ["cream", "Cream", "#e8cfa3"],
  ["ivory", "Ivory", "#f2e0bd"],
];

export const AVATAR_MANIFEST: AvatarAsset[] = [
  /* ---------------- material profiles ---------------- */
  proc("mat_skin_01", "Skin (MeshPhysical, pore overlay)", "material-profile", "mat_skin_01", {
    proceduralRef: "parts/head.ts:skinPhys (clearcoat + sheen, canvas pore map)",
  }),
  proc("hair_mat_01", "Hair (MeshStandard, strand textures)", "material-profile", "hair_mat_01", {
    proceduralRef: "parts/materials.ts:hairMat (#171110)",
  }),
  proc(MAT.garmentSolid, "Garment solid (MeshStandard, woven bump)", "material-profile", MAT.garmentSolid, {
    proceduralRef: "parts/clothing.ts:buildGarmentMats weave",
  }),
  proc(MAT.garmentPattern, "Garment pattern (ankara/adire/aso-oke canvas map)", "material-profile", MAT.garmentPattern, {
    proceduralRef: "parts/materials.ts:fabricTexture + garmentTextures.ts",
  }),
  proc(MAT.shoe, "Footwear (MeshStandard + tread bump)", "material-profile", MAT.shoe, {
    proceduralRef: "parts/clothing.ts:buildFootwear",
  }),
  proc(MAT.eye, "Eye (sclera/catchlight physical)", "material-profile", MAT.eye, {
    proceduralRef: "parts/head.ts:buildEye",
  }),

  /* ---------------- bodies (verbatim legacy ids) ---------------- */
  proc("woman", "Woman body", "body", MAT.skin, {
    slots: ["body"],
    proceduralRef: "parts/body.ts:buildBody (isMan=false, limbScale 0.9)",
    compatibleBodyTypes: ["feminine"],
    fallbackAssetId: null,
  }),
  proc("man", "Man body", "body", MAT.skin, {
    slots: ["body"],
    proceduralRef: "parts/body.ts:buildBody (isMan=true, limbScale 1)",
    compatibleBodyTypes: ["masculine"],
    fallbackAssetId: "woman",
  }),

  /* ---------------- head ---------------- */
  proc("face_default_01", "Default sculpted face", "head", MAT.skin, {
    slots: ["head"],
    proceduralRef: "parts/head.ts:buildHead (sculptSkull M20 rebuild)",
  }),

  /* ---------------- hair styles (verbatim legacy ids) ---------------- */
  ...(
    [
      ["lowcut", "Low cut", "parts/hair.ts:buildLowcut"],
      ["bald", "Bald", "parts/hair.ts:buildBald"],
      ["curls", "Curls", "parts/hair.ts:buildCurls"],
      ["afro", "Afro", "parts/hair.ts:buildAfro"],
      ["locs", "Locs", "parts/hair.ts:buildLocs"],
      ["braids", "Braids", "parts/hair.ts:buildBraids"],
      ["classic", "Classic", "parts/hair.ts:buildClassic"],
      ["hair_taper_fade_01", "Taper fade", "parts/hair.ts:buildTaperFade"],
      ["hair_waves_01", "Waves", "parts/hair.ts:buildWaves"],
      ["hair_bun_01", "Top bun", "parts/hair.ts:buildBun"],
      ["hair_ponytail_01", "Ponytail", "parts/hair.ts:buildPonytail"],
      ["hair_mohawk_01", "Mohawk", "parts/hair.ts:buildMohawk"],
      ["hair_bantu_knots_01", "Bantu knots", "parts/hair.ts:buildBantuKnots"],
    ] as Array<[string, string, string]>
  ).map(([id, name, ref]) =>
    proc(id, name, "hair", "hair_mat_01", {
      slots: ["hair"],
      proceduralRef: ref,
      // Matches the pipeline: unknown hair id renders lowcut, never a bare head.
      fallbackAssetId: id === "lowcut" ? null : "lowcut",
    })
  ),

  /* ---------------- hair colour ---------------- */
  proc("hair_black_01", "Black hair", "texture", "hair_mat_01", {
    hex: "#171110",
    proceduralRef: "parts/hair.ts:HAIR_COLOR_HEX — buildHair() default; buildHair(colorId) tints hair + facial hair (M3b)",
    fallbackAssetId: null,
  }),
  proc("hair_dark_brown_01", "Dark brown hair", "texture", "hair_mat_01", {
    hex: "#3b2417",
    proceduralRef: "parts/hair.ts:buildHair(colorId) tint (M3b)",
    fallbackAssetId: "hair_black_01",
  }),
  proc("hair_brown_01", "Brown hair", "texture", "hair_mat_01", {
    hex: "#5b3a21",
    proceduralRef: "parts/hair.ts:buildHair(colorId) tint (M3b)",
    fallbackAssetId: "hair_black_01",
  }),
  proc("hair_auburn_01", "Auburn hair", "texture", "hair_mat_01", {
    hex: "#6e2f16",
    proceduralRef: "parts/hair.ts:buildHair(colorId) tint (M8)",
    fallbackAssetId: "hair_black_01",
  }),
  proc("hair_blonde_01", "Blonde hair", "texture", "hair_mat_01", {
    hex: "#b98a3e",
    proceduralRef: "parts/hair.ts:buildHair(colorId) tint (M8)",
    fallbackAssetId: "hair_black_01",
  }),
  proc("hair_grey_01", "Grey hair", "texture", "hair_mat_01", {
    hex: "#8d8d94",
    proceduralRef: "parts/hair.ts:buildHair(colorId) tint (M8)",
    fallbackAssetId: "hair_black_01",
  }),

  /* ---------------- facial hair ----------------
   * NOTE: kind is "hair" (there is no "facialHair" kind) with the
   * "facialHair" slot — this is what validation.ts checks, and it
   * matches the existing facialhair_none_01 entry.
   *
   * Compatibility (defect 4, 2026-10-11): the three styled options are
   * masculine-only — a beard on the feminine body renders as a dark
   * patch under the chin, so the metadata marks them ["masculine"] and
   * the editor hides them for the Woman body, the assembler falls back
   * to clean-shaven, and migrate.ts repairs old saves. "No facial hair"
   * stays available to both body types.
   */
  proc("facialhair_none_01", "No facial hair", "hair", "hair_mat_01", {
    slots: ["facialHair"],
    proceduralRef: "none — buildFacialHair() returns null (no geometry)",
    fallbackAssetId: null,
  }),
  proc("facialhair_mustache_01", "Light mustache", "hair", "hair_mat_01", {
    slots: ["facialHair"],
    proceduralRef: "parts/facialHair.ts:buildFacialHair (tapered tubes, ~160 tris)",
    fallbackAssetId: "facialhair_none_01",
    compatibleBodyTypes: ["masculine"],
  }),
  proc("facialhair_goatee_01", "Mustache + chin goatee", "hair", "hair_mat_01", {
    slots: ["facialHair"],
    proceduralRef: "parts/facialHair.ts:buildFacialHair (mustache + soul patch + chin tuft, ~420 tris)",
    fallbackAssetId: "facialhair_none_01",
    compatibleBodyTypes: ["masculine"],
  }),
  proc("facialhair_beard_short_01", "Short boxed beard", "hair", "hair_mat_01", {
    slots: ["facialHair"],
    proceduralRef: "parts/facialHair.ts:buildFacialHair (goatee + curved jaw shells, ~560 tris)",
    fallbackAssetId: "facialhair_none_01",
    compatibleBodyTypes: ["masculine"],
  }),

  /* ---------------- eye colours (M8 — index into IRIS_PALETTES) ---------------- */
  ...(
    [
      ["eye_brown_01", "Brown eyes", 0],
      ["eye_hazel_01", "Hazel eyes", 1],
      ["eye_amber_01", "Amber eyes", 2],
      ["eye_green_01", "Green eyes", 3],
    ] as Array<[string, string, number]>
  ).map(([id, name, palette]) =>
    proc(id, name, "texture", MAT.eye, {
      proceduralRef: `parts/faceTextures.ts:IRIS_PALETTES[${palette}] via buildIrisImageWithPalette (M8)`,
      fallbackAssetId: id === "eye_brown_01" ? null : "eye_brown_01",
    })
  ),

  /* ---------------- eyebrow styles (M8 — parts/head.ts brow builder) ---------------- */
  ...(
    [
      ["brow_natural_01", "Natural brows", "16 strands, soft arc"],
      ["brow_bold_01", "Bold brows", "20 strands, thicker + darker"],
      ["brow_arched_01", "Arched brows", "higher peak, tapered"],
      ["brow_trimmed_01", "Trimmed brows", "12 strands, shorter + neat"],
    ] as Array<[string, string, string]>
  ).map(([id, name, ref]) =>
    proc(id, name, "hair", "hair_mat_01", {
      slots: ["brows"],
      proceduralRef: `parts/head.ts:buildBrows (${ref})`,
      fallbackAssetId: id === "brow_natural_01" ? null : "brow_natural_01",
    })
  ),

  /* ---------------- skin tones (texture entries) ---------------- */
  ...SKIN_TONES.map(([id, name, hex]) =>
    proc(id, name, "texture", MAT.skin, {
      hex,
      proceduralRef: "parts/materials.ts:skinHex → skinMat/skinPhys",
      fallbackAssetId: id === "cocoa" ? null : "cocoa",
    })
  ),

  /* ---------------- fabrics (texture entries, verbatim legacy ids) ---------------- */
  proc("plain", "Plain (solid colour)", "texture", MAT.garmentSolid, {
    proceduralRef: 'parts/materials.ts:fabricTexture (fabric === "plain" → no map)',
  }),
  ...(
    [
      ["ankara", "Ankara", "parts/garmentTextures.ts"],
      ["adire", "Adire", "parts/garmentTextures.ts"],
      ["asoke", "Aso-oke", "parts/garmentTextures.ts"],
    ] as Array<[string, string, string]>
  ).map(([id, name, ref]) =>
    proc(id, name, "texture", MAT.garmentPattern, {
      proceduralRef: ref,
      fallbackAssetId: "plain",
    })
  ),

  /* ---------------- clothing: decomposed from the 5 outfits ---------------- */
  proc("top_tee_01", "Tee (casual/chill/hoodie/sitework)", "clothing", MAT.garmentSolid, {
    slots: ["top"],
    proceduralRef: "parts/clothing.ts:buildShirt + dressTeeTrim",
  }),
  proc("top_shirt_office_01", "Office shirt (collar, placket, tie)", "clothing", MAT.garmentSolid, {
    slots: ["top"],
    proceduralRef: "parts/clothing.ts:buildShirt + dressOfficeExtras",
    fallbackAssetId: "top_tee_01",
  }),
  proc("top_tank_01", "Tank top (gym)", "clothing", MAT.garmentSolid, {
    slots: ["top"],
    proceduralRef: "parts/clothing.ts:buildShirt (tank variant, no sleeves)",
    fallbackAssetId: "top_tee_01",
  }),
  proc("top_agbada_01", "Agbada (flowing, wide sleeves)", "clothing", MAT.garmentSolid, {
    slots: ["top"],
    proceduralRef: "parts/clothing.ts:buildShirt (agbada variant + wide sleeves)",
    fallbackAssetId: "top_tee_01",
  }),
  proc("top_dress_01", "Party dress bodice", "clothing", MAT.garmentSolid, {
    slots: ["top"],
    proceduralRef: "parts/clothing.ts:buildShirt (dress variant, fitted)",
    fallbackAssetId: "top_tee_01",
  }),
  proc("bottom_trouser_01", "Trousers", "clothing", MAT.garmentSolid, {
    slots: ["bottom"],
    proceduralRef: "parts/clothing.ts:dressLegs + dressHips (long)",
  }),
  proc("bottom_short_01", "Shorts", "clothing", MAT.garmentSolid, {
    slots: ["bottom"],
    proceduralRef: "parts/clothing.ts:dressLegs + dressHips (shorts)",
    fallbackAssetId: "bottom_trouser_01",
  }),
  proc("bottom_cargo_01", "Cargo trousers", "clothing", MAT.garmentSolid, {
    slots: ["bottom"],
    proceduralRef: "parts/clothing.ts:dressLegs + dressHips (cargo pockets)",
    fallbackAssetId: "bottom_trouser_01",
  }),
  proc("bottom_skirt_01", "Wrapper skirt", "clothing", MAT.garmentSolid, {
    slots: ["bottom"],
    proceduralRef: "parts/clothing.ts:dressSkirt (flared lathe, knee length)",
    fallbackAssetId: "bottom_trouser_01",
  }),
  proc("outer_hoodie_01", "Hoodie (hood cowl + kangaroo pocket)", "clothing", MAT.garmentSolid, {
    slots: ["outerwear"],
    proceduralRef: "parts/clothing.ts:dressHoodieExtras",
    fallbackAssetId: null,
  }),
  proc("outer_hivis_vest_01", "Hi-vis vest", "clothing", MAT.garmentSolid, {
    slots: ["outerwear"],
    proceduralRef: "parts/clothing.ts:dressSiteworkExtras",
    fallbackAssetId: null,
  }),

  /* ---------------- footwear: outfit-implied, feet never bare in M2 ---------------- */
  proc("shoe_sneaker_01", "Sneakers (casual/hoodie/chill)", "clothing", MAT.shoe, {
    slots: ["shoe"],
    proceduralRef: "parts/clothing.ts:buildFootwear(sneaker)",
  }),
  proc("shoe_oxford_01", "Oxfords (office)", "clothing", MAT.shoe, {
    slots: ["shoe"],
    proceduralRef: "parts/clothing.ts:buildFootwear(oxford)",
    fallbackAssetId: "shoe_sneaker_01",
  }),
  proc("shoe_boot_01", "Work boots (sitework)", "clothing", MAT.shoe, {
    slots: ["shoe"],
    proceduralRef: "parts/clothing.ts:buildFootwear(boot)",
    fallbackAssetId: "shoe_sneaker_01",
  }),
  proc("shoe_sandal_01", "Leather sandals (agbada)", "clothing", MAT.shoe, {
    slots: ["shoe"],
    proceduralRef: "parts/clothing.ts:buildFootwear(sandal)",
    fallbackAssetId: "shoe_sneaker_01",
  }),
  proc("shoe_heel_01", "Block heels (owambe)", "clothing", MAT.shoe, {
    slots: ["shoe"],
    proceduralRef: "parts/clothing.ts:buildFootwear(heel)",
    fallbackAssetId: "shoe_sneaker_01",
  }),

  /* ---------------- accessories (M8 — procedural, parts/accessories.ts) ---------------- */
  proc("acc_glasses_01", "Shades", "accessory", MAT.eye, {
    slots: ["face"],
    proceduralRef: "parts/accessories.ts:buildGlasses (tinted lenses + frame)",
  }),
  proc("acc_cap_01", "Snapback cap", "accessory", MAT.garmentSolid, {
    slots: ["head"],
    proceduralRef: "parts/accessories.ts:buildCap (crown + brim + strap)",
  }),
  proc("acc_earrings_01", "Hoop earrings", "accessory", MAT.garmentSolid, {
    slots: ["ears"],
    proceduralRef: "parts/accessories.ts:buildEarrings (gold hoops at the lobes)",
  }),

  /* ---------------- future licensed-GLB path (PENDING — not available) ---------------- */
  pending("body_glb_base", "Licensed base body (GLB)", "body", GLB_INTEGRATION, {
    slots: ["body"],
  }),
  pending("hair_glb_pack", "Licensed hairstyle pack (GLB)", "hair", GLB_INTEGRATION, {
    slots: ["hair"],
  }),
  pending("clothing_glb_pack", "Licensed garment pack (GLB)", "clothing", GLB_INTEGRATION, {
    slots: ["top", "bottom", "outerwear", "shoe"],
  }),
  pending("accessory_glb_pack", "Licensed accessory pack (GLB)", "accessory", GLB_INTEGRATION, {
    slots: ["head", "face", "ears", "neck", "wrist"],
  }),
];

/** O(1) lookup by id. */
export const AVATAR_MANIFEST_BY_ID: Record<string, AvatarAsset> =
  Object.fromEntries(AVATAR_MANIFEST.map((a) => [a.id, a]));

/** All assets of a kind with the given status (default: available). */
export function manifestByKind(
  kind: AvatarAsset["kind"],
  status: AssetStatus = "available"
): AvatarAsset[] {
  return AVATAR_MANIFEST.filter((a) => a.kind === kind && a.status === status);
}

/** Available ids of a kind — handy for validation allowlists. */
export function availableIds(kind: AvatarAsset["kind"]): string[] {
  return manifestByKind(kind, "available").map((a) => a.id);
}
