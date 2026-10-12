/**
 * Èkó Life Avatar Engine — runtime assembler (Milestone 4).
 *
 * Turns a validated `AppearanceV1` into a live THREE.Group via the
 * procedural part builders in `../views/avatar/parts/`.
 *
 * CLIENT-ONLY: imports three.js. Do NOT re-export from `./index.ts`
 * (the M2 barrel is pure data, safe for server import).
 *
 * Design decisions (documented choice):
 * - Asset resolution: REQUIRED slots (body preset, face preset, skin
 *   tone) resolve STRICTLY via `resolveAsset` — a wrong body or face must
 *   never silently substitute. OPTIONAL slots (hair style/colour, facial
 *   hair, clothing pieces, fabric) resolve via `resolveAssetOrFallback`,
 *   and if even the fallback chain fails (e.g. a forged unknown id) they
 *   fall back to a per-slot safe default that mirrors the pipeline's own
 *   policy (unknown hair → lowcut, never a bare head). Only if a REQUIRED
 *   slot fails does the whole appearance fall back to
 *   DEFAULT_APPEARANCE_V1. Render paths never throw on bad ids.
 * - The clothing pipeline is OUTFIT-based (`dressBody(outfit)`), while v1
 *   decomposes clothing into top/bottom/outerwear/shoe slots. The
 *   assembler inverts the M2 decomposition table to recover the OutfitId;
 *   combos with no exact match render as "casual" and are reported in
 *   `notes` (never guessed at per-slot).
 * - MORPHS: all 9 schema morphs are STUBBED in M4 (see MORPH_SUPPORT).
 *   They are validated (0..1) and stored, but `buildHead`/`buildBody`
 *   take no morph parameters and every manifest entry lists
 *   `supportedMorphs: []`. The assembler validates-and-ignores them with
 *   a documented warning path (console.warn once per build + `notes`
 *   entry) rather than pretending to apply them.
 * - MATERIAL ISOLATION: every geometry/material/texture is allocated
 *   fresh per character build — verified: no module-level memoization
 *   exists in parts/ (materials.ts, faceTextures.ts, garmentTextures.ts,
 *   strandTextures.ts all allocate per call; canvas texture builders
 *   return null outside a DOM). Changing one avatar's skin tone can
 *   therefore never affect another avatar: there is nothing shared to
 *   mutate. Character-owned disposables are tracked per stage so
 *   diff-updates can dispose exactly what they remove.
 * - DISPOSAL: `dispose()` frees every geometry/material/texture created
 *   for THIS character. Because nothing is shared between characters,
 *   full dispose is a plain traverse-and-dispose. Stage disposal (used
 *   by diff updates) disposes geometries always, and disposes materials
 *   only when they are NOT in the character's live shared-material set
 *   (identity check) — e.g. re-dressing must not dispose the hairMat the
 *   kept hair meshes still reference. If a shared cross-character cache
 *   is ever introduced, it must be registered in an exclusion set here;
 *   until then the rule above is provably safe.
 * - Geometry contract (unchanged from avatarModel.ts): figure ~1.6 units,
 *   faces +Z, chin anchor (headMount origin) at y=1.4, feet ~0.09.
 *   studio.ts camera anchors depend on it.
 */

import type * as THREE from "three";
import type { AppearanceV1, MorphKey } from "./schema";
import { PERMITTED_MORPHS } from "./schema";
import { AVATAR_MANIFEST_BY_ID, type AvatarAsset } from "./manifest";
import {
  assertCompatible,
  resolveAsset,
  resolveAssetOrFallback,
} from "./resolver";
import { DEFAULT_APPEARANCE_V1 } from "./validation";
import type { AvatarLook } from "../game/types";
import {
  buildMaterials,
  shade,
  type AvatarMaterials,
} from "../views/avatar/parts/materials";
import { buildBody, type BuiltBody } from "../views/avatar/parts/body";
import { dressBody, type OutfitId } from "../views/avatar/parts/clothing";
import {
  HEAD_GROUP_SCALE,
  buildHead,
  type BuiltHead,
} from "../views/avatar/parts/head";
import {
  attachHair,
  buildHair,
} from "../views/avatar/parts/hair";
import {
  attachFacialHair,
  buildFacialHair,
} from "../views/avatar/parts/facialHair";
import {
  attachAccessories,
  buildAccessory,
} from "../views/avatar/parts/accessories";
import {
  EYE_COLOR_PALETTE,
  buildIrisImageWithPalette,
  hashSeed,
  toCanvasTexture,
} from "../views/avatar/parts/faceTextures";

/* ------------------------------------------------------------------ */
/* Rig                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Joints the animation system drives. `head` is `body.headMount` (the pivot
 * the old avatarModel rig used). M7 adds the hip pivots (walk), the
 * upper-lid pivots (lid-based blink) and the base pose snapshots the
 * controller blends back to.
 */
export interface AvatarRig {
  upper: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  eyeL: THREE.Group;
  eyeR: THREE.Group;
  /** M7: upper-lid pivots (head.ts) — blink rotates these about X. */
  lidL: THREE.Group;
  lidR: THREE.Group;
  /** M7: hip pivots (body.ts leg groups) — walk swings these about X. */
  legL: THREE.Group;
  legR: THREE.Group;
  baseArmLX: number;
  baseArmRX: number;
  baseArmLZ: number;
  baseArmRZ: number;
  baseLegLX: number;
  baseLegRX: number;
  baseUpperY: number;
}

/* ------------------------------------------------------------------ */
/* Morphs — validated, stored, NOT honored (honesty required)           */
/* ------------------------------------------------------------------ */

export type MorphSupport = "live" | "stubbed";

/**
 * M4 MORPH REPORT: every one of the 9 schema morphs is "stubbed".
 * `buildHead(T, { skin, mats })` and `buildBody(T, mats, { isMan,
 * limbScale })` accept no morph parameters; the sculpt terms named in
 * `PERMITTED_MORPHS[].pipelineTerm` exist inside the builders but are not
 * exposed as parameters, and every manifest entry lists
 * `supportedMorphs: []`. Wiring them is M3/M7 work — M4 must not pretend.
 * `applyMorphPolicy()` validates ranges (already done by validation.ts),
 * warns once per build when any morph is non-neutral, and records the
 * ignore in `notes`.
 */
export const MORPH_SUPPORT: Record<MorphKey, MorphSupport> = Object.fromEntries(
  PERMITTED_MORPHS.map((d) => [d.key, "stubbed"])
) as Record<MorphKey, MorphSupport>;

export function applyMorphPolicy(
  morphs: Record<MorphKey, number>,
  notes: string[]
): Record<MorphKey, MorphSupport> {
  const nonNeutral = (Object.keys(morphs) as MorphKey[]).filter(
    (k) => morphs[k] !== 0.5
  );
  if (nonNeutral.length > 0) {
    const detail = nonNeutral.map((k) => `${k}=${morphs[k]}`).join(", ");
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      console.warn(
        `[avatar] M4: morphs validated but NOT honored ` +
          `(no morph parameters in parts/ — all stubbed): ${detail}`
      );
    }
    notes.push(`morphs ignored (stubbed in M4, validated 0..1): ${detail}`);
  }
  return { ...MORPH_SUPPORT };
}

/* ------------------------------------------------------------------ */
/* Asset resolution                                                    */
/* ------------------------------------------------------------------ */

export interface ResolvedAssets {
  body: AvatarAsset;
  face: AvatarAsset;
  skin: AvatarAsset;
  /** M8: eye colour + brow style (validated texture/hair assets). */
  eyeColor: AvatarAsset;
  browStyle: AvatarAsset;
  hairStyle: AvatarAsset;
  hairColor: AvatarAsset;
  facialHair: AvatarAsset;
  top: AvatarAsset;
  bottom: AvatarAsset;
  outerwear: AvatarAsset | null;
  shoe: AvatarAsset;
  fabric: AvatarAsset;
  /** M8: resolved accessory assets (kind "accessory", available only). */
  accessories: AvatarAsset[];
  /** Outfit recovered by inverting the M2 decomposition table. */
  outfit: OutfitId;
  skinHex: string;
  hairHex: string;
  topColor: string;
  bottomColor: string;
  isMan: boolean;
}

/** Inverse of migrate.ts OUTFIT_DECOMPOSITION (exact keys). M8 adds gym/agbada/owambe; Phase 6 adds the 12 boutique outfits. */
const V1_TO_OUTFIT: Record<string, OutfitId> = {
  "top_tee_01|bottom_trouser_01||shoe_sneaker_01": "casual",
  "top_tee_01|bottom_trouser_01|outer_hoodie_01|shoe_sneaker_01": "hoodie",
  "top_shirt_office_01|bottom_trouser_01||shoe_oxford_01": "office",
  "top_tee_01|bottom_short_01||shoe_sneaker_01": "chill",
  "top_tee_01|bottom_cargo_01|outer_hivis_vest_01|shoe_boot_01": "sitework",
  "top_tank_01|bottom_short_01||shoe_sneaker_01": "gym",
  "top_agbada_01|bottom_trouser_01||shoe_sandal_01": "agbada",
  "top_dress_01|bottom_skirt_01||shoe_heel_01": "owambe",
  "top_agbada_01|bottom_trouser_01||shoe_oxford_01": "senator",
  "top_tee_01|bottom_trouser_01||shoe_sandal_01": "dashiki",
  "top_agbada_01|bottom_skirt_01||shoe_sandal_01": "kaftan",
  "top_dress_01|bottom_skirt_01||shoe_sneaker_01": "adire_gown",
  "top_dress_01|bottom_skirt_01||shoe_sandal_01": "ankara_set",
  "top_dress_01|bottom_short_01||shoe_heel_01": "asoebi",
  "top_shirt_office_01|bottom_cargo_01||shoe_oxford_01": "tuxedo",
  "top_tee_01|bottom_trouser_01||shoe_oxford_01": "suit",
  "top_tee_01|bottom_cargo_01||shoe_sneaker_01": "streetwear",
  "top_tank_01|bottom_trouser_01||shoe_sneaker_01": "denim",
  "top_tank_01|bottom_trouser_01|outer_hoodie_01|shoe_sneaker_01": "sport_luxe",
  "top_agbada_01|bottom_cargo_01||shoe_sandal_01": "royalty",
};

export function outfitIdForClothing(
  clothing: AppearanceV1["clothing"],
  notes: string[] = []
): OutfitId {
  const key = `${clothing.topId}|${clothing.bottomId}|${clothing.outerwearId ?? ""}|${clothing.shoeId}`;
  const outfit = V1_TO_OUTFIT[key];
  if (outfit) return outfit;
  notes.push(
    `clothing combo (${key}) has no exact outfit match — ` +
      `the pipeline is outfit-based, rendering as "casual"`
  );
  return "casual";
}

/**
 * Per-slot safe defaults mirroring the pipeline's own fallback policy
 * (e.g. buildHair renders lowcut for unknown ids — never a bare head).
 * Used only when even the manifest fallback chain fails (forged ids —
 * validated appearances can't reach this).
 */
const SLOT_DEFAULTS: Record<string, string> = {
  hairStyle: "lowcut",
  hairColor: "hair_black_01",
  facialHair: "facialhair_none_01",
  top: "top_tee_01",
  bottom: "bottom_trouser_01",
  shoe: "shoe_sneaker_01",
  fabric: "plain",
};

function lenient(
  id: string,
  slot: keyof typeof SLOT_DEFAULTS,
  notes: string[]
): AvatarAsset {
  try {
    const asset = resolveAssetOrFallback(id);
    if (asset.id !== id) {
      notes.push(`asset "${id}" unavailable → fallback "${asset.id}"`);
    }
    return asset;
  } catch {
    const fallback = SLOT_DEFAULTS[slot];
    notes.push(
      `asset "${id}" unresolvable (unknown id, no fallback chain) → ` +
        `slot default "${fallback}"`
    );
    return resolveAsset(fallback);
  }
}

/**
 * Resolve every asset id in the appearance. REQUIRED slots (body, face,
 * skin) are strict — failure throws and the caller falls back to
 * DEFAULT_APPEARANCE_V1. OPTIONAL slots degrade per-slot (see lenient).
 */
export function resolveAvatarAssets(
  appearance: AppearanceV1,
  notes: string[] = []
): ResolvedAssets {
  // Required — strict. A wrong body/face/skin must never silently swap.
  const body = resolveAsset(appearance.base.bodyPresetId);
  assertCompatible(body, appearance);
  const face = resolveAsset(appearance.base.facePresetId);
  assertCompatible(face, appearance);
  const skin = resolveAsset(appearance.base.skinToneId);

  // M8: eye colour + brow style — optional slots with safe defaults.
  const eyeColor = (() => {
    try {
      return resolveAssetOrFallback(appearance.base.eyeColorId);
    } catch {
      notes.push(`eyeColor "${appearance.base.eyeColorId}" unresolvable → eye_brown_01`);
      return resolveAsset("eye_brown_01");
    }
  })();
  const browStyle = (() => {
    try {
      return resolveAssetOrFallback(appearance.base.browStyleId);
    } catch {
      notes.push(`browStyle "${appearance.base.browStyleId}" unresolvable → brow_natural_01`);
      return resolveAsset("brow_natural_01");
    }
  })();

  // M8: accessories — validated appearances only carry available
  // kind-"accessory" ids; anything else is skipped with a note (never
  // rendered, never thrown).
  const accessories: AvatarAsset[] = [];
  for (const entry of appearance.accessories) {
    const asset = AVATAR_MANIFEST_BY_ID[entry.assetId];
    if (asset && asset.status === "available" && asset.kind === "accessory") {
      accessories.push(asset);
    } else {
      notes.push(`accessory "${entry.assetId}" unavailable → skipped`);
    }
  }

  // Optional — fallback chains, then per-slot safe defaults.
  const hairStyle = lenient(appearance.hair.styleId, "hairStyle", notes);
  const hairColor = lenient(appearance.hair.colorId, "hairColor", notes);
  // Defect 4 (defense in depth): facial hair is masculine-only per the
  // manifest's compatibleBodyTypes. A feminine body with facial hair set
  // (e.g. an old save, or a body switch that kept the draft value) falls
  // back to clean-shaven here — the render path can never draw a beard
  // on the Woman body, no matter what the caller passes.
  let facialHair = lenient(appearance.hair.facialHairId, "facialHair", notes);
  if (!facialHair.compatibleBodyTypes.includes(appearance.base.bodyType)) {
    notes.push(
      `facialHair "${facialHair.id}" is not compatible with bodyType ` +
        `"${appearance.base.bodyType}" → clean-shaven (facialhair_none_01)`
    );
    facialHair = resolveAsset("facialhair_none_01");
  }
  const top = lenient(appearance.clothing.topId, "top", notes);
  const bottom = lenient(appearance.clothing.bottomId, "bottom", notes);
  const shoe = lenient(appearance.clothing.shoeId, "shoe", notes);
  const fabric = lenient(appearance.clothing.fabricId, "fabric", notes);
  const outerwear = appearance.clothing.outerwearId
    ? (() => {
        try {
          return resolveAssetOrFallback(appearance.clothing.outerwearId);
        } catch {
          notes.push(
            `outerwear "${appearance.clothing.outerwearId}" unresolvable → none`
          );
          return null;
        }
      })()
    : null;

  const outfit = outfitIdForClothing(appearance.clothing, notes);
  const isMan = appearance.base.bodyPresetId === "man";

  return {
    body,
    face,
    skin,
    eyeColor,
    browStyle,
    hairStyle,
    hairColor,
    facialHair,
    top,
    bottom,
    outerwear,
    shoe,
    fabric,
    accessories,
    outfit,
    skinHex: skin.hex ?? "#8a5f38",
    hairHex: hairColor.hex ?? "#171110",
    topColor: appearance.clothing.topColor,
    bottomColor: appearance.clothing.bottomColor,
    isMan,
  };
}

/** Resolve with whole-appearance fallback: required-slot failure → default. */
export function resolveAvatarAssetsOrDefault(
  appearance: AppearanceV1,
  notes: string[]
): { resolved: ResolvedAssets; appearance: AppearanceV1 } {
  try {
    return { resolved: resolveAvatarAssets(appearance, notes), appearance };
  } catch (err) {
    notes.push(
      `required asset resolution failed (${err instanceof Error ? err.message : String(err)}); ` +
        `falling back to DEFAULT_APPEARANCE_V1`
    );
    const def = JSON.parse(
      JSON.stringify(DEFAULT_APPEARANCE_V1)
    ) as AppearanceV1;
    return { resolved: resolveAvatarAssets(def, notes), appearance: def };
  }
}

/* ------------------------------------------------------------------ */
/* Materials — one isolated set per character                          */
/* ------------------------------------------------------------------ */

/**
 * Build the character's material set. `buildMaterials` allocates fresh
 * materials (and fresh canvas textures where a DOM exists) on every
 * call — nothing is shared between characters, so recoloring one avatar
 * can never touch another.
 */
export function buildCharacterMaterials(
  T: typeof import("three"),
  resolved: ResolvedAssets
): AvatarMaterials {
  // Legacy-equivalent look: the part builders still speak AvatarLook.
  // skin is passed as the manifest hex (skinHex() resolves tone ids and
  // #hex identically, so migrated looks render byte-identical).
  const legacyLook: AvatarLook = {
    body: resolved.isMan ? "man" : "woman",
    skin: resolved.skinHex,
    hair: resolved.hairStyle.id,
    outfit: resolved.outfit,
    fabric: resolved.fabric.id,
    topColor: resolved.topColor,
    bottomColor: resolved.bottomColor,
  };
  return buildMaterials(T, legacyLook);
}

/* ------------------------------------------------------------------ */
/* Disposal                                                            */
/* ------------------------------------------------------------------ */

type Disposable = { dispose(): void };

function isTexture(v: unknown): v is THREE.Texture {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { isTexture?: boolean }).isTexture === true
  );
}

/**
 * Dispose geometries always; dispose materials/textures only when not in
 * `keep` (the character's live shared-material set, by identity).
 * Full-character dispose passes no `keep` — nothing is shared between
 * characters, so everything found is character-owned.
 */
export function disposeObjects(
  roots: THREE.Object3D[],
  keep?: Set<THREE.Material>
): void {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  const texs = new Set<THREE.Texture>();
  for (const root of roots) {
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geo = mesh.geometry as THREE.BufferGeometry | undefined;
      if (geo) geos.add(geo);
      const arr = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const m of arr) {
        if (!m || (keep && keep.has(m as THREE.Material))) continue;
        mats.add(m as THREE.Material);
      }
    });
  }
  for (const m of mats) {
    const sm = m as unknown as Record<string, unknown>;
    for (const key of ["map", "bumpMap", "roughnessMap", "normalMap", "emissiveMap"]) {
      const t = sm[key];
      if (isTexture(t)) texs.add(t);
    }
  }
  for (const t of texs) (t as Disposable).dispose();
  for (const m of mats) (m as Disposable).dispose();
  for (const g of geos) (g as Disposable).dispose();
}

/* ------------------------------------------------------------------ */
/* Assembly stages                                                     */
/* ------------------------------------------------------------------ */

export interface AssemblyStages {
  mats: AvatarMaterials;
  resolved: ResolvedAssets;
  body: BuiltBody;
  torsoMesh: THREE.Mesh;
  /** Objects dressBody() added (for stage-disposal on re-dress). */
  clothingObjects: THREE.Object3D[];
  head: BuiltHead;
  hairObjects: THREE.Object3D[];
  facialHair: THREE.Group | null;
  /** M8: accessory groups attached to the head (for stage-disposal on swap). */
  accessoryObjects: THREE.Object3D[];
  /** The iris material (for skin-tone recolor without rebuild). */
  irisMat: THREE.Material | null;
}

/* ------------------------------------------------------------------ */
/* Staged assembly — the loader yields between these stages           */
/* ------------------------------------------------------------------ */

/**
 * Mutable staged-assembly context. `beginStagedAssembly` resolves assets
 * and builds materials; `buildStagedBody` / `buildStagedHead` add the
 * subtrees; `finishStagedAssembly` wires the rig, idle update and
 * disposal. `assembleAppearance` runs all four synchronously.
 */
export interface StagedAssembly {
  T: typeof import("three");
  group: THREE.Group;
  notes: string[];
  appearance: AppearanceV1;
  resolved: ResolvedAssets;
  mats: AvatarMaterials;
  body: BuiltBody | null;
  torsoMesh: THREE.Mesh | null;
  clothingObjects: THREE.Object3D[];
  head: BuiltHead | null;
  hairObjects: THREE.Object3D[];
  facialHair: THREE.Group | null;
  accessoryObjects: THREE.Object3D[];
  irisMat: THREE.Material | null;
}

export function beginStagedAssembly(
  T: typeof import("three"),
  appearance: AppearanceV1,
  notes: string[] = []
): StagedAssembly {
  const { resolved, appearance: app } = resolveAvatarAssetsOrDefault(
    appearance,
    notes
  );
  applyMorphPolicy(app.morphs, notes);
  const mats = buildCharacterMaterials(T, resolved);
  return {
    T,
    group: new T.Group(),
    notes,
    appearance: app,
    resolved,
    mats,
    body: null,
    torsoMesh: null,
    clothingObjects: [],
    head: null,
    hairObjects: [],
    facialHair: null,
    accessoryObjects: [],
    irisMat: null,
  };
}

export function buildStagedBody(s: StagedAssembly): void {
  const { T, resolved, mats, group } = s;
  const limbScale = resolved.isMan ? 1 : 0.9;
  const body = buildBody(T, mats, { isMan: resolved.isMan, limbScale });
  group.add(body.group);
  const targets = clothingTargets(body);
  const before = snapshotChildren(targets);
  const { torsoMesh } = dressBody(T, mats, body, {
    outfit: resolved.outfit,
    isMan: resolved.isMan,
    limbScale,
    topColor: resolved.topColor,
  });
  s.body = body;
  s.torsoMesh = torsoMesh;
  s.clothingObjects = diffChildren(before, targets);
}

export function buildStagedHead(s: StagedAssembly): void {
  const { T, resolved, mats } = s;
  if (!s.body) throw new Error("buildStagedHead: body stage not built");
  const head = buildHead(T, {
    skin: resolved.skinHex,
    mats,
    eyeColorId: resolved.eyeColor.id,
    browStyleId: resolved.browStyle.id,
  });
  s.body.headMount.add(head.group);
  const hairObjects = buildHair(
    T,
    resolved.hairStyle.id,
    mats,
    resolved.hairColor.id
  );
  attachHair(head, hairObjects);
  const facialHair = buildFacialHair(T, resolved.facialHair.id, mats);
  attachFacialHair(head, facialHair);
  // M8: accessories attach into the head group (same subtree as hair).
  const accessoryObjects: THREE.Object3D[] = [];
  for (const asset of resolved.accessories) {
    const g = buildAccessory(T, asset.id);
    if (g) accessoryObjects.push(g);
  }
  attachAccessories(head, accessoryObjects);
  // Same as the legacy build: the whole head group (skull, face AND hair)
  // scales about the neck-top origin, so the chin anchor (y=1.4) is fixed.
  head.group.scale.setScalar(HEAD_GROUP_SCALE);
  s.head = head;
  s.hairObjects = hairObjects;
  s.facialHair = facialHair;
  s.accessoryObjects = accessoryObjects;
  s.irisMat = findIrisMaterial(head);
}

export function finishStagedAssembly(
  s: StagedAssembly,
  opts: AssembleOptions = {}
): AssembledAvatarInternal {
  if (!s.body || !s.head || !s.torsoMesh) {
    throw new Error("finishStagedAssembly: body/head stages not built");
  }
  const reduced = opts.reducedMotion ?? prefersReducedMotion();
  const stages: AssemblyStages = {
    mats: s.mats,
    resolved: s.resolved,
    body: s.body,
    torsoMesh: s.torsoMesh,
    clothingObjects: s.clothingObjects,
    head: s.head,
    hairObjects: s.hairObjects,
    facialHair: s.facialHair,
    accessoryObjects: s.accessoryObjects,
    irisMat: s.irisMat,
  };
  const assembled: AssembledAvatarInternal = {
    T: s.T,
    group: s.group,
    rig: {} as AvatarRig,
    appearance: s.appearance,
    notes: s.notes,
    morphStatus: { ...MORPH_SUPPORT },
    update: undefined,
    mats: s.mats,
    resolved: s.resolved,
    stages,
    dispose() {
      disposeObjects([s.group]);
    },
  };
  wireRigAndUpdate(assembled, reduced);
  s.group.userData.dispose = () => assembled.dispose();
  return assembled;
}

function snapshotChildren(
  groups: THREE.Object3D[]
): Map<THREE.Object3D, Set<THREE.Object3D>> {
  const snap = new Map<THREE.Object3D, Set<THREE.Object3D>>();
  for (const g of groups) snap.set(g, new Set(g.children));
  return snap;
}

function diffChildren(
  snap: Map<THREE.Object3D, Set<THREE.Object3D>>,
  groups: THREE.Object3D[]
): THREE.Object3D[] {
  const added: THREE.Object3D[] = [];
  for (const g of groups) {
    const before = snap.get(g);
    if (!before) continue;
    for (const c of g.children) if (!before.has(c)) added.push(c);
  }
  return added;
}

function clothingTargets(body: BuiltBody): THREE.Object3D[] {
  return [body.upper, body.legL, body.legR, body.armL, body.armR];
}

/** Find the iris material: tagged userData.irisMaterial (head.ts), falling
 * back to the legacy texture sniff (the only non-physical
 * MeshStandardMaterial with a canvas map in the head). */
function findIrisMaterial(head: BuiltHead): THREE.Material | null {
  let found: THREE.Material | null = null;
  head.group.traverse((node) => {
    if (found) return;
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const arr = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of arr) {
      const sm = m as THREE.MeshStandardMaterial & {
        isMeshStandardMaterial?: boolean;
        isMeshPhysicalMaterial?: boolean;
      };
      if ((sm as { userData?: { irisMaterial?: boolean } }).userData?.irisMaterial) {
        found = m as THREE.Material;
        return;
      }
      if (
        sm &&
        sm.isMeshStandardMaterial &&
        !sm.isMeshPhysicalMaterial &&
        sm.map &&
        isTexture(sm.map) &&
        (sm.map as THREE.CanvasTexture).isCanvasTexture
      ) {
        found = m as THREE.Material;
        return;
      }
    }
  });
  return found;
}

/* ------------------------------------------------------------------ */
/* Animation — procedural state machine (M7)                           */
/*                                                                     */
/* States: idle / walk / wave. Walk engages AUTOMATICALLY: the         */
/* controller watches the avatar root's translation each frame, so     */
/* HomeRoom's tap-to-walk glide (and ambient wandering) get a walk     */
/* cycle with zero room-code changes. `setAnimState("wave")` triggers  */
/* the wave gesture (auto-returns to idle); "idle" cancels it.         */
/*                                                                     */
/* HONEST LIMITATIONS (documented, not worked around):                 */
/* - No knee/elbow joints: legs are single rigid segments (a two-      */
/*   segment leg would need the trouser meshes in clothing.ts to bend  */
/*   with the shin — assessed, rejected). The walk is a hip-pendulum   */
/*   swing matched to stride frequency, i.e. stylized, not anatomical. */
/* - No morph targets: there is no honest lip-sync. `setAnimState`     */
/*   deliberately has no "talk" state — faking it is worse than        */
/*   omitting it.                                                      */
/* - The wave is shoulder-driven (no elbow joint): a side-to-side      */
/*   "royal" wave, not a forearm wave.                                 */
/* - Reduced motion: `wireRigAndUpdate` sets `update` to undefined,    */
/*   so the figure holds a static neutral pose. All animation below    */
/*   respects that by construction.                                    */
/* ------------------------------------------------------------------ */

/** States the controller can be in. "walk" is sensor-driven, never set. */
export type AnimStateName = "idle" | "walk" | "wave";

/** States a caller may request. */
export type AnimRequest = "idle" | "wave";

/**
 * The per-frame update function. Carries `setAnimState` so room code (or
 * future social hooks) can trigger gestures through the same handle it
 * already calls every frame (`group.userData.update`, `userData.setAnimState`).
 */
export interface AvatarUpdateFn {
  (t: number, dt: number): void;
  /**
   * Request the idle or wave state. "wave" plays once (~2.4s) then
   * returns to idle by itself. Walk engages automatically while the
   * avatar root is translating — it is never set explicitly.
   */
  setAnimState(s: AnimRequest): void;
}

export interface AnimationController {
  update: AvatarUpdateFn;
  setState(s: AnimRequest): void;
  readonly state: AnimStateName;
  /** Test/debug hook: start a blink on the next frame. */
  forceBlink(): void;
  /** Test/debug hook: trigger an eye saccade on the next frame. */
  forceSaccade(): void;
}

/* ---- tuning (module constants — no per-frame allocation) ---- */
/** Stride phase advance per unit travelled. Matches HomeRoom's walk.phase
 *  rate (step * 7) so the leg swing stays in sync with the room's bob. */
const STRIDE_K = 7.0;
/** Walk engage/disengage speeds (units/s) with hysteresis — no flicker. */
const WALK_ENTER_SPEED = 0.35;
const WALK_EXIT_SPEED = 0.15;
const LEG_SWING = 0.18; // rad, hip-pendulum amplitude
const ARM_SWING = 0.42; // rad, counter-swing amplitude
const WALK_LEAN = 0.06; // rad, forward lean of the upper body
const WALK_BOB_DIP = 0.012; // upper-body dip per stride (room bobs the group)
const BLINK_DUR = 0.18; // seconds, close+open
// Lid close angle (verified against the live scene graph AND pixels):
// with the lid hinged at the top of the eye opening, +0.3 rad swings the
// rim to just past the pupil — full visual close — while keeping the rim
// outside the eyeball surface. Larger angles drive the rim INTO the ball
// (the shell orbits the hinge on a tighter radius than the ball), hiding
// the lid inside the eye so the blink silently fails. Positive X rotation
// closes the lid (three.js Rx: below-pivot points swing down-forward).
const LID_CLOSE = 0.3; // rad of upper-lid pivot rotation at full blink
const WAVE_DUR = 2.4; // seconds, raise → wave → lower
const WAVE_RAISE = 1.95; // rad of arm abduction at wave apex

/** Smoothstep 0..1 (scalar, no allocation). */
function s01(x: number): number {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return c * c * (3 - 2 * c);
}

/**
 * Build the animation controller for a rig. The returned `update` keeps
 * the exact `(t, dt) => void` shape every existing caller uses.
 *
 * Hot-loop discipline: every piece of per-frame state lives in closure
 * scalars; the frame body performs zero allocations (no `new`, no object
 * literals, no array methods) — iPhone perf bar inherited from HomeRoom.
 */
export function createAnimationController(
  rig: AvatarRig,
  root: THREE.Object3D
): AnimationController {
  // ---- persistent state (allocated once) ----
  let nextBlink = 1.2 + Math.random() * 2.5;
  let blinkT = -1; // <0 idle; else 0..1 across BLINK_DUR
  let nextSaccade = 2 + Math.random() * 3;
  let saccT = -1; // <0 idle; else 0..1 across SACC_DUR
  const SACC_DUR = 0.12;
  let saccFromYaw = 0;
  let saccFromPitch = 0;
  let saccToYaw = 0;
  let saccToPitch = 0;
  let saccYaw = 0;
  let saccPitch = 0;
  let walkWeight = 0; // eased 0..1 blend — transitions never pop
  let walkSpeedSmooth = 0;
  let odo = 0; // distance travelled, drives stride phase
  let prevX = root.position.x;
  let prevZ = root.position.z;
  let prevInit = false;
  let explicit: AnimRequest = "idle";
  let waveT = 0;

  const startSaccade = (): void => {
    saccFromYaw = saccYaw;
    saccFromPitch = saccPitch;
    saccToYaw = (Math.random() - 0.5) * 0.18;
    saccToPitch = (Math.random() - 0.5) * 0.1;
    saccT = 0;
  };

  const update = ((t: number, dt: number) => {
    // Sanitize: a NaN/garbage clock must never poison the rig.
    t = Number.isFinite(t) ? t : 0;
    dt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
    const TAU = Math.PI * 2;

    // ---- walk sensing: translation of the avatar root ----
    const px = root.position.x;
    const pz = root.position.z;
    if (prevInit && dt > 0) {
      const dx = px - prevX;
      const dz = pz - prevZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      odo += dist;
      const speed = dist / dt;
      walkSpeedSmooth += (speed - walkSpeedSmooth) * Math.min(1, dt * 8);
    }
    prevX = px;
    prevZ = pz;
    prevInit = true;
    const walking =
      walkWeight > 0.5
        ? walkSpeedSmooth > WALK_EXIT_SPEED
        : walkSpeedSmooth > WALK_ENTER_SPEED;
    const walkTarget = walking ? 1 : 0;
    walkWeight += (walkTarget - walkWeight) * Math.min(1, dt * 5);
    if (walkWeight < 0.002) walkWeight = 0;
    else if (walkWeight > 0.998) walkWeight = 1;
    const wW = walkWeight;
    const phase = odo * STRIDE_K;

    // ---- wave gesture timing (auto-returns to idle) ----
    let waveEnv = 0;
    let waveOsc = 0;
    if (explicit === "wave") {
      waveT += dt;
      if (waveT >= WAVE_DUR) {
        explicit = "idle";
        waveT = 0;
      } else {
        waveEnv = s01(waveT / 0.45) * (1 - s01((waveT - 1.95) / 0.45));
        const wob =
          s01((waveT - 0.45) / 0.15) * (1 - s01((waveT - 1.8) / 0.15));
        waveOsc = wob * Math.sin(TAU * 2.5 * (waveT - 0.45));
      }
    }

    // ---- blink: real lid pivots (M7), not the old eye Y-scale squash ----
    if (blinkT < 0 && t >= nextBlink) {
      blinkT = 0;
      nextBlink = t + 3 + Math.random() * 3;
    }
    let lidAngle = 0;
    if (blinkT >= 0) {
      blinkT += dt / BLINK_DUR;
      if (blinkT >= 1) {
        blinkT = -1;
      } else {
        lidAngle = LID_CLOSE * Math.sin(Math.PI * blinkT);
      }
    }
    rig.lidL.rotation.x = lidAngle;
    rig.lidR.rotation.x = lidAngle;

    // ---- eye saccades: quick small conjugate rotations every 2–5s ----
    if (saccT < 0 && t >= nextSaccade) {
      startSaccade();
      nextSaccade = t + 2 + Math.random() * 3;
    }
    if (saccT >= 0) {
      saccT += dt / SACC_DUR;
      if (saccT >= 1) {
        saccT = -1;
        saccYaw = saccToYaw;
        saccPitch = saccToPitch;
      } else {
        const k = saccT * saccT * (3 - 2 * saccT);
        saccYaw = saccFromYaw + (saccToYaw - saccFromYaw) * k;
        saccPitch = saccFromPitch + (saccToPitch - saccFromPitch) * k;
      }
    }
    const eyeDamp = 1 - wW * 0.4; // steadier gaze while walking
    rig.eyeL.rotation.y = saccYaw * eyeDamp;
    rig.eyeR.rotation.y = saccYaw * eyeDamp;
    rig.eyeL.rotation.x = saccPitch * eyeDamp;
    rig.eyeR.rotation.x = saccPitch * eyeDamp;

    // ---- breathing: torso shell ±2.5% (visible but calm) ----
    const br = Math.sin((TAU * t) / 4.4);
    rig.torso.scale.x = 1 + 0.025 * br;
    rig.torso.scale.z = 0.74 * (1 + 0.025 * br);

    // ---- legs: hip-pendulum walk swing (rigid segments — no knees) ----
    const legSwing = wW * LEG_SWING * Math.sin(phase);
    rig.legL.rotation.x = rig.baseLegLX - legSwing;
    rig.legR.rotation.x = rig.baseLegRX + legSwing;

    // ---- arms: idle micro-sway + relaxed drift, walk counter-swing,
    // wave overrides R ----
    const swayDamp = 1 - wW * 0.7;
    const armSwing = wW * ARM_SWING * Math.sin(phase);
    let armLx =
      rig.baseArmLX + 0.045 * Math.sin((TAU * t) / 4.9) * swayDamp + armSwing;
    let armRx =
      rig.baseArmRX +
      0.045 * Math.sin((TAU * t) / 4.9 + Math.PI) * swayDamp -
      armSwing;
    let armLz =
      rig.baseArmLZ + 0.025 * Math.sin((TAU * t) / 7.1) + wW * 0.06;
    let armRz =
      rig.baseArmRZ +
      0.025 * Math.sin((TAU * t) / 7.1 + 1.4) +
      wW * 0.06;
    if (waveEnv > 0) {
      // Blend toward the raised wave pose — eased by waveEnv, never a pop.
      armRx = armRx * (1 - waveEnv) + (rig.baseArmRX - 0.25) * waveEnv;
      armRz =
        armRz * (1 - waveEnv) +
        (rig.baseArmRZ + WAVE_RAISE + 0.28 * waveOsc) * waveEnv;
    }
    rig.armL.rotation.x = armLx;
    rig.armR.rotation.x = armRx;
    rig.armL.rotation.z = armLz;
    rig.armR.rotation.z = armRz;

    // ---- head: bob + slow turn (steadied in walk), tilt into the wave ----
    rig.head.rotation.x = 0.045 * Math.sin((TAU * t) / 5.9 + 0.8) - wW * 0.03;
    rig.head.rotation.y =
      0.15 *
      Math.sin((TAU * t) / 21 + 1.2) *
      (0.6 + 0.4 * Math.sin((TAU * t) / 7.7)) *
      (1 - wW * 0.6);
    rig.head.rotation.z = 0.018 * Math.sin((TAU * t) / 11.5) + waveEnv * 0.1;

    // ---- weight shift + walk lean/bob on the hip pivot ----
    const wsDamp = 1 - wW * 0.5;
    const ws = Math.sin((TAU * t) / 8.6);
    rig.upper.rotation.z = 0.03 * ws * wsDamp;
    rig.upper.position.x = 0.024 * Math.sin((TAU * t) / 8.6 + 0.3) * wsDamp;
    rig.upper.rotation.y = 0.01 * Math.sin((TAU * t) / 13.5);
    rig.upper.rotation.x = wW * WALK_LEAN;
    rig.upper.position.y =
      rig.baseUpperY - wW * WALK_BOB_DIP * Math.abs(Math.sin(phase));
  }) as AvatarUpdateFn;

  const setState = (s: AnimRequest): void => {
    if (s === "wave") {
      explicit = "wave";
      waveT = 0;
    } else {
      explicit = "idle";
      waveT = 0;
    }
  };

  update.setAnimState = setState;

  const controller: AnimationController = {
    update,
    setState,
    get state(): AnimStateName {
      if (explicit === "wave") return "wave";
      return walkWeight > 0.5 ? "walk" : "idle";
    },
    forceBlink(): void {
      if (blinkT < 0) blinkT = 0;
    },
    forceSaccade(): void {
      if (saccT < 0) startSaccade();
    },
  };
  return controller;
}

/**
 * Legacy entry point (pre-M7 name). Builds the full animation controller
 * and returns its update function — same `(t, dt) => void` shape as the
 * old idle loop, plus `setAnimState` for gestures.
 */
export function createIdleUpdate(
  rig: AvatarRig,
  root: THREE.Object3D
): AvatarUpdateFn {
  return createAnimationController(rig, root).update;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/* ------------------------------------------------------------------ */
/* Assembled avatar                                                    */
/* ------------------------------------------------------------------ */

export interface AssembleOptions {
  /** Override the prefers-reduced-motion check (tests). */
  reducedMotion?: boolean;
}

export interface AssembledAvatar {
  group: THREE.Group;
  rig: AvatarRig;
  appearance: AppearanceV1;
  /** Human-readable notes: fallbacks used, morph warnings, outfit notes. */
  notes: string[];
  /** Per-morph support — all "stubbed" in M4 (see MORPH_SUPPORT). */
  morphStatus: Record<MorphKey, MorphSupport>;
  update?: AvatarUpdateFn;
  dispose(): void;
}

/** Internal mutable view (diff updates mutate stages/rig in place). */
export interface AssembledAvatarInternal extends AssembledAvatar {
  T: typeof import("three");
  mats: AvatarMaterials;
  resolved: ResolvedAssets;
  stages: AssemblyStages;
}

function wireRigAndUpdate(
  a: AssembledAvatarInternal,
  reducedMotion: boolean
): void {
  const { body, torsoMesh, head } = a.stages;
  const rig = a.rig;
  rig.upper = body.upper;
  rig.torso = torsoMesh;
  rig.head = body.headMount;
  rig.armL = body.armL;
  rig.armR = body.armR;
  rig.eyeL = head.eyeL;
  rig.eyeR = head.eyeR;
  rig.lidL = head.upperLidL;
  rig.lidR = head.upperLidR;
  rig.legL = body.legL;
  rig.legR = body.legR;
  rig.baseArmLX = body.armL.rotation.x;
  rig.baseArmRX = body.armR.rotation.x;
  rig.baseArmLZ = body.armL.rotation.z;
  rig.baseArmRZ = body.armR.rotation.z;
  rig.baseLegLX = body.legL.rotation.x;
  rig.baseLegRX = body.legR.rotation.x;
  rig.baseUpperY = body.upper.position.y;
  if (reducedMotion) {
    // prefers-reduced-motion: static neutral pose, no update loop at all.
    a.update = undefined;
    return;
  }
  const ctrl = createAnimationController(rig, a.group);
  a.update = ctrl.update;
  // Gesture trigger reachable through the same handle the room already
  // calls every frame — no room-code changes needed to wave later.
  (a.group.userData as { setAnimState?: (s: AnimRequest) => void }).setAnimState =
    ctrl.setState;
}

/**
 * Assemble a full avatar synchronously. Never throws on asset problems
 * (falls back per policy); throws only on unexpected builder failures,
 * in which case callers should fall back to a safe figure.
 */
export function assembleAppearance(
  T: typeof import("three"),
  appearance: AppearanceV1,
  opts: AssembleOptions = {}
): AssembledAvatarInternal {
  const s = beginStagedAssembly(T, appearance, []);
  buildStagedBody(s);
  buildStagedHead(s);
  return finishStagedAssembly(s, opts);
}

/* ------------------------------------------------------------------ */
/* Diff updates — minimal in-place updates, no full rebuild            */
/* ------------------------------------------------------------------ */

export interface DiffSummary {
  /** True when a structural change forced a full rebuild. */
  rebuilt: boolean;
  /** Stage names touched, in application order. */
  touched: string[];
  notes: string[];
}

/**
 * Skin-tone recolor WITHOUT rebuild. Every skin-derived material colour
 * in the character is remapped old→new (base tone + the exact shade()
 * offsets the part builders use), including sheenColor/emissive on the
 * physical skin materials. The iris texture is tone-seeded, so it is
 * regenerated for the new tone and swapped (old texture disposed).
 * The pore-multiplier canvases are tone-neutral, so they are kept.
 * No geometry is touched — head/body/hair object identity is preserved.
 */
export function recolorSkin(
  a: AssembledAvatarInternal,
  newSkinToneId: string,
  notes: string[]
): void {
  const T = a.T;
  const oldHex = a.resolved.skinHex.toLowerCase();
  const newAsset = AVATAR_MANIFEST_BY_ID[newSkinToneId];
  if (!newAsset || newAsset.status !== "available" || !newAsset.hex) {
    notes.push(`skin: unknown skin tone "${newSkinToneId}", recolor skipped`);
    return;
  }
  const newHex = newAsset.hex.toLowerCase();
  if (oldHex === newHex) {
    notes.push("skin: tone hex unchanged, nothing to recolor");
    return;
  }
  const pairs: Array<[string, string]> = [
    [oldHex, newHex],
    [shade(oldHex, -26), shade(newHex, -26)],
    [shade(oldHex, -42), shade(newHex, -42)],
    [shade(oldHex, -38), shade(newHex, -38)],
    [shade(oldHex, -58), shade(newHex, -58)],
  ];
  const remap = new Map(
    pairs.map(([o, n]) => [o.toLowerCase(), n.toLowerCase()])
  );
  const remapColor = (c: { getHexString(): string; set(v: string): void }) => {
    const hit = remap.get(("#" + c.getHexString()).toLowerCase());
    if (hit) c.set(hit);
  };
  a.group.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const arr = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of arr) {
      const sm = m as THREE.MeshStandardMaterial & {
        sheenColor?: { getHexString(): string; set(v: string): void };
        emissive?: { getHexString(): string; set(v: string): void };
      };
      if (!sm || !sm.color) continue;
      remapColor(sm.color);
      if (sm.sheenColor) remapColor(sm.sheenColor);
      if (sm.emissive) remapColor(sm.emissive);
    }
  });
  // Keep the shared material set consistent (some entries, e.g. lipMat,
  // are not referenced by any mesh but stay part of the character set).
  const setHex = (m: THREE.Material | undefined, hex: string) => {
    if (m) (m as THREE.MeshStandardMaterial).color.set(hex);
  };
  setHex(a.mats.skinMat, newHex);
  setHex(a.mats.skinDarkMat, shade(newHex, -26));
  setHex(a.mats.lipMat, shade(newHex, -42));

  // Iris texture is seeded by the skin tone — regenerate and swap.
  // M8: keep the character's chosen eye colour (palette), not a random one.
  const iris = a.stages.irisMat as THREE.MeshStandardMaterial | null;
  if (iris) {
    const oldTex = iris.map as THREE.Texture | null;
    const eyeId = a.resolved.eyeColor.id;
    const img = buildIrisImageWithPalette(
      128,
      hashSeed(newHex + ":iris:" + eyeId),
      EYE_COLOR_PALETTE[eyeId] ?? 0
    );
    const tex = toCanvasTexture(T, img);
    if (tex) {
      iris.map = tex;
      iris.needsUpdate = true;
    }
    if (oldTex) (oldTex as Disposable).dispose();
    notes.push("skin: recolored materials in place; iris texture regenerated");
  } else {
    notes.push("skin: recolored materials in place (iris material not found — left as-is)");
  }
  a.resolved = { ...a.resolved, skinHex: newHex, skin: newAsset };
}

/** Swap the hair group only (style and/or colour change). */
function swapHairStage(
  a: AssembledAvatarInternal,
  resolved: ResolvedAssets,
  notes: string[]
): void {
  const { T, mats, stages } = a;
  for (const o of stages.hairObjects) stages.head.group.remove(o);
  // Keep the character's live shared materials (e.g. mats.hairMat when
  // the old style used the default colour); dispose the rest.
  const keep = new Set<THREE.Material>(
    Object.values(mats).map((v) => v as THREE.Material)
  );
  disposeObjects(stages.hairObjects, keep);
  const parts = buildHair(T, resolved.hairStyle.id, mats, resolved.hairColor.id);
  attachHair(stages.head, parts);
  stages.hairObjects = parts;
  notes.push(
    `hair: swapped group only → ${resolved.hairStyle.id} / ${resolved.hairColor.id}`
  );
}

/** Swap the facial-hair group only. */
function swapFacialHairStage(
  a: AssembledAvatarInternal,
  resolved: ResolvedAssets,
  notes: string[]
): void {
  const { T, mats, stages } = a;
  if (stages.facialHair) {
    stages.head.group.remove(stages.facialHair);
    const keep = new Set<THREE.Material>(
      Object.values(mats).map((v) => v as THREE.Material)
    );
    disposeObjects([stages.facialHair], keep);
    stages.facialHair = null;
  }
  const fh = buildFacialHair(T, resolved.facialHair.id, mats);
  attachFacialHair(stages.head, fh);
  stages.facialHair = fh;
  notes.push(`facialHair: swapped group only → ${resolved.facialHair.id}`);
}

/**
 * M8: swap the iris texture in place for an eye-colour change. No
 * geometry touched — the iris material keeps its identity.
 */
function swapEyeColor(
  a: AssembledAvatarInternal,
  resolved: ResolvedAssets,
  notes: string[]
): void {
  const { T, stages } = a;
  const iris = stages.irisMat as THREE.MeshStandardMaterial | null;
  if (!iris) {
    notes.push("eyeColor: iris material not found — left as-is");
    return;
  }
  const eyeId = resolved.eyeColor.id;
  const oldTex = iris.map as THREE.Texture | null;
  const img = buildIrisImageWithPalette(
    128,
    hashSeed(stages.resolved.skinHex + ":iris:" + eyeId),
    EYE_COLOR_PALETTE[eyeId] ?? 0
  );
  const tex = toCanvasTexture(T, img);
  if (tex) {
    iris.map = tex;
    iris.needsUpdate = true;
    if (oldTex) (oldTex as Disposable).dispose();
    notes.push(`eyeColor: iris texture swapped → ${eyeId}`);
  } else {
    // No DOM (e.g. unit tests): canvas textures can't be built — the
    // resolved id is still recorded so the next real build renders it.
    notes.push(`eyeColor: no canvas in this environment — recorded ${eyeId}, texture unchanged`);
  }
}

/**
 * M8: rebuild the head subtree for a brow-style change. The head group
 * is detached from the headMount, disposed, and rebuilt (skull, eyes,
 * brows); hair, facial hair and accessories are re-attached fresh. The
 * rig's eye/lid references are re-pointed (the animation controller
 * reads them per-frame, so blinking keeps working).
 */
function swapHeadStage(
  a: AssembledAvatarInternal,
  resolved: ResolvedAssets,
  notes: string[]
): void {
  const { T, mats, stages } = a;
  const mount = stages.head.group.parent;
  if (mount) mount.remove(stages.head.group);
  const keep = new Set<THREE.Material>(
    Object.values(mats).map((v) => v as THREE.Material)
  );
  disposeObjects([stages.head.group], keep);

  const head = buildHead(T, {
    skin: resolved.skinHex,
    mats,
    eyeColorId: resolved.eyeColor.id,
    browStyleId: resolved.browStyle.id,
  });
  mount?.add(head.group);
  const hairObjects = buildHair(
    T,
    resolved.hairStyle.id,
    mats,
    resolved.hairColor.id
  );
  attachHair(head, hairObjects);
  const facialHair = buildFacialHair(T, resolved.facialHair.id, mats);
  attachFacialHair(head, facialHair);
  const accessoryObjects: THREE.Object3D[] = [];
  for (const asset of resolved.accessories) {
    const g = buildAccessory(T, asset.id);
    if (g) accessoryObjects.push(g);
  }
  attachAccessories(head, accessoryObjects);
  head.group.scale.setScalar(HEAD_GROUP_SCALE);

  stages.head = head;
  stages.hairObjects = hairObjects;
  stages.facialHair = facialHair;
  stages.accessoryObjects = accessoryObjects;
  stages.irisMat = findIrisMaterial(head);
  a.rig.eyeL = head.eyeL;
  a.rig.eyeR = head.eyeR;
  a.rig.lidL = head.upperLidL;
  a.rig.lidR = head.upperLidR;
  notes.push(`head: rebuilt subtree → brow ${resolved.browStyle.id}`);
}

/** M8: swap the accessory groups only (head/hair untouched). */
function swapAccessoryStage(
  a: AssembledAvatarInternal,
  resolved: ResolvedAssets,
  notes: string[]
): void {
  const { T, mats, stages } = a;
  for (const o of stages.accessoryObjects) stages.head.group.remove(o);
  const keep = new Set<THREE.Material>(
    Object.values(mats).map((v) => v as THREE.Material)
  );
  disposeObjects(stages.accessoryObjects, keep);
  const accessoryObjects: THREE.Object3D[] = [];
  for (const asset of resolved.accessories) {
    const g = buildAccessory(T, asset.id);
    if (g) accessoryObjects.push(g);
  }
  attachAccessories(stages.head, accessoryObjects);
  stages.accessoryObjects = accessoryObjects;
  notes.push(
    `accessories: swapped group only → [${resolved.accessories.map((x) => x.id).join(", ") || "none"}]`
  );
}

/** Garment-driven material fields — the only mats entries re-dress replaces. */
const GARMENT_MAT_FIELDS = [
  "shirtMat",
  "bottomMat",
  "shoeMat",
  "accentMat",
  "whiteMat",
  "soleMat",
  "vestMat",
  "stripeMat",
] as const;

/**
 * Re-dress: replace garment materials, remove + dispose the old clothing
 * objects, and run dressBody again. Body/head/hair subtrees are untouched.
 * The rig's torso (breathing target) is re-pointed at the new shirt mesh.
 */
function redressStage(
  a: AssembledAvatarInternal,
  resolved: ResolvedAssets,
  notes: string[]
): void {
  const { T, mats, stages } = a;
  const fresh = buildCharacterMaterials(T, resolved);
  // Assign the new garment materials BEFORE disposing, so the keep-set
  // (built from the live mats object) protects exactly the right entries.
  for (const f of GARMENT_MAT_FIELDS) {
    (mats as unknown as Record<string, THREE.Material>)[f] = fresh[
      f
    ] as unknown as THREE.Material;
  }
  // Fresh non-garment materials were allocated but are unused — dispose.
  for (const v of Object.values(fresh) as THREE.Material[]) {
    if (!Object.values(mats).includes(v)) (v as Disposable).dispose();
  }
  for (const o of stages.clothingObjects) o.parent?.remove(o);
  const keep = new Set<THREE.Material>(
    (Object.values(mats) as THREE.Material[]).filter(Boolean)
  );
  disposeObjects(stages.clothingObjects, keep);

  const body = stages.body;
  const targets = clothingTargets(body);
  const before = snapshotChildren(targets);
  const limbScale = resolved.isMan ? 1 : 0.9;
  const { torsoMesh } = dressBody(T, mats, body, {
    outfit: resolved.outfit,
    isMan: resolved.isMan,
    limbScale,
    topColor: resolved.topColor,
  });
  stages.clothingObjects = diffChildren(before, targets);
  stages.torsoMesh = torsoMesh;
  a.rig.torso = torsoMesh;
  notes.push(
    `clothing: re-dressed (outfit ${resolved.outfit}, fabric ${resolved.fabric.id})`
  );
}

/** Structural change (body/face preset): dispose everything and rebuild into the same group + rig. */
function rebuildInto(
  a: AssembledAvatarInternal,
  newAppearance: AppearanceV1,
  notes: string[]
): void {
  const reduced = !a.update; // keep the reduced-motion choice stable
  disposeObjects([a.group]);
  a.group.clear();
  const s = beginStagedAssembly(a.T, newAppearance, notes);
  // Rebuild into the caller's existing group (its transform/parent are
  // preserved); the fresh empty group from beginStagedAssembly is dropped.
  s.group = a.group;
  buildStagedBody(s);
  buildStagedHead(s);
  if (!s.body || !s.head || !s.torsoMesh) {
    throw new Error("rebuildInto: staged build failed");
  }
  a.mats = s.mats;
  a.resolved = s.resolved;
  a.stages = {
    mats: s.mats,
    resolved: s.resolved,
    body: s.body,
    torsoMesh: s.torsoMesh,
    clothingObjects: s.clothingObjects,
    head: s.head,
    hairObjects: s.hairObjects,
    facialHair: s.facialHair,
    accessoryObjects: s.accessoryObjects,
    irisMat: s.irisMat,
  };
  a.appearance = s.appearance;
  a.notes = s.notes;
  // Re-wire the EXISTING rig object in place (identity stable for
  // callers holding handle.rig) and rebuild the idle closure around it.
  wireRigAndUpdate(a, reduced);
  a.group.userData.dispose = () => a.dispose();
  notes.push("full rebuild (structural change: body or face preset)");
}

function clothingChanged(
  oldC: AppearanceV1["clothing"],
  newC: AppearanceV1["clothing"]
): boolean {
  return (
    oldC.topId !== newC.topId ||
    oldC.bottomId !== newC.bottomId ||
    oldC.outerwearId !== newC.outerwearId ||
    oldC.shoeId !== newC.shoeId ||
    oldC.fabricId !== newC.fabricId ||
    oldC.topColor !== newC.topColor ||
    oldC.bottomColor !== newC.bottomColor
  );
}

/** M8: accessory list changed (slot or asset differs, order-insensitive). */
function accessoriesChanged(
  oldA: AppearanceV1["accessories"],
  newA: AppearanceV1["accessories"]
): boolean {
  if (oldA.length !== newA.length) return true;
  const key = (e: AppearanceV1["accessories"][number]) =>
    `${e.slot}:${e.assetId}`;
  const oldKeys = oldA.map(key).sort().join("|");
  const newKeys = newA.map(key).sort().join("|");
  return oldKeys !== newKeys;
}

/**
 * Minimal in-place update from oldApp → newApp. Change classes:
 * - skin tone → recolor materials only (no rebuild, geometry identity kept)
 * - eye colour → swap the iris texture only
 * - brow style → rebuild the head subtree (skull/eyes/brows), re-attaching
 *   hair, facial hair and accessories; rig eye/lid refs re-pointed
 * - hair style/colour → swap the hair group only
 * - facial hair (or hair colour, which tints it) → swap that group only.
 *   (Group-swap, not colour-remap: the stubble/strand tint textures are
 *   baked at build time and cannot be recolored in place. Same minimal
 *   granularity as a style swap — head/body are never rebuilt.)
 * - accessories → swap the accessory groups only
 * - clothing/outfit/fabric/colours → re-dress (body/head/hair untouched)
 * - body/face preset → full rebuild (the head hangs off the body subtree)
 * - morphs → validated-and-ignored with notes (stubbed in M4)
 */
export function diffUpdateAssembled(
  a: AssembledAvatarInternal,
  oldApp: AppearanceV1,
  newApp: AppearanceV1
): DiffSummary {
  const touched: string[] = [];
  const notes: string[] = [];
  const { resolved } = resolveAvatarAssetsOrDefault(newApp, notes);

  if (newApp.base.bodyPresetId !== oldApp.base.bodyPresetId ||
    newApp.base.facePresetId !== oldApp.base.facePresetId ||
    newApp.base.bodyType !== oldApp.base.bodyType
  ) {
    rebuildInto(a, newApp, notes);
    touched.push("body");
    a.notes = notes;
    return { rebuilt: true, touched, notes };
  }

  if (newApp.base.skinToneId !== oldApp.base.skinToneId) {
    recolorSkin(a, newApp.base.skinToneId, notes);
    touched.push("skin");
  }

  if (newApp.base.eyeColorId !== oldApp.base.eyeColorId) {
    swapEyeColor(a, resolved, notes);
    touched.push("eyeColor");
  }

  if (newApp.base.browStyleId !== oldApp.base.browStyleId) {
    swapHeadStage(a, resolved, notes);
    touched.push("brows");
  }

  const hairStyleChanged = newApp.hair.styleId !== oldApp.hair.styleId;
  const hairColorChanged = newApp.hair.colorId !== oldApp.hair.colorId;
  const fhChanged = newApp.hair.facialHairId !== oldApp.hair.facialHairId;
  if (hairStyleChanged || hairColorChanged) {
    swapHairStage(a, resolved, notes);
    touched.push("hair");
  }
  if (fhChanged || hairColorChanged) {
    swapFacialHairStage(a, resolved, notes);
    touched.push("facialHair");
  }

  if (clothingChanged(oldApp.clothing, newApp.clothing)) {
    redressStage(a, resolved, notes);
    touched.push("clothing");
  }

  if (accessoriesChanged(oldApp.accessories, newApp.accessories)) {
    swapAccessoryStage(a, resolved, notes);
    touched.push("accessories");
  }

  applyMorphPolicy(newApp.morphs, notes);

  a.resolved = resolved;
  a.appearance = newApp;
  a.notes = notes;
  return { rebuilt: false, touched, notes };
}
