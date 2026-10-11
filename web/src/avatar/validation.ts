/**
 * Èkó Life Avatar Engine — appearance validation (Milestone 2).
 *
 * `validateAppearance(raw): { ok, appearance?, errors[] }`
 *
 * POLICY (documented, applied consistently):
 * - REJECT (never silently clamp): unknown ids, unknown morph keys,
 *   out-of-range or non-numeric morph values, wrong types, colours outside
 *   the server palettes, bodyType/bodyPresetId mismatches, non-object input.
 * - DEFAULT: missing optional fields are filled with safe defaults
 *   (DEFAULT_APPEARANCE_V1); a missing `schemaVersion` is treated as 1.
 * - NORMALIZE: top/bottom colours are lowercased (#RRGGBB → #rrggbb).
 * - NEVER ACCEPT: renderer objects, filesystem paths, URLs — any string
 *   that is not a known manifest id is rejected outright.
 *
 * Pure: no DOM, no three.js imports. Importable from client and server.
 */

import {
  AVATAR_SCHEMA_VERSION,
  BODY_PRESET_TO_TYPE,
  PERMITTED_MORPHS,
  type AccessorySlot,
  type AppearanceV1,
  type BodyPresetId,
  type BodyType,
  type MorphKey,
} from "./schema";
import { AVATAR_MANIFEST_BY_ID } from "./manifest";

/* ------------------------------------------------------------------ */
/* Palettes — mirror server AVATAR_TOP_COLORS / AVATAR_BOTTOM_COLORS    */
/* (server/src/game/data.js). Kept in sync manually; drift = rejected. */
/* ------------------------------------------------------------------ */

export const AVATAR_TOP_COLORS: readonly string[] = [
  "#22d3ee", "#f472b6", "#a3e635", "#fbbf24", "#c084fc",
  "#fb7185", "#34d399", "#60a5fa", "#ef4444", "#fb923c",
];

export const AVATAR_BOTTOM_COLORS: readonly string[] = [
  "#334155", "#111827", "#f8fafc", "#1e3a8a", "#64748b",
  "#78350f", "#14532d", "#7c2d12", "#831843", "#3b0764",
];

const ACCESSORY_SLOTS: readonly AccessorySlot[] = [
  "head",
  "face",
  "ears",
  "neck",
  "wrist",
];

/** Fabric texture ids — the verbatim legacy fabric ids. */
const FABRIC_IDS: readonly string[] = ["plain", "ankara", "adire", "asoke"];

/** Skin-tone texture ids — the verbatim legacy skin ids. */
const SKIN_TONE_IDS: readonly string[] = [
  "deep_espresso", "dark_cocoa", "burnt_caramel", "mahogany",
  "walnut", "cocoa", "coffee", "latte",
  "honey", "sand", "amber", "cream",
];

/* ------------------------------------------------------------------ */
/* Canonical defaults — mirror server DEFAULT_AVATAR                   */
/* (woman / cocoa / lowcut / casual / plain / #22d3ee / #334155).       */
/* ------------------------------------------------------------------ */

function defaultMorphs(): Record<MorphKey, number> {
  const m = {} as Record<MorphKey, number>;
  for (const def of PERMITTED_MORPHS) m[def.key as MorphKey] = def.default;
  return m;
}

export const DEFAULT_APPEARANCE_V1: AppearanceV1 = {
  schemaVersion: AVATAR_SCHEMA_VERSION,
  characterId: "",
  base: {
    bodyType: "feminine",
    bodyPresetId: "woman",
    facePresetId: "face_default_01",
    skinToneId: "cocoa",
  },
  morphs: defaultMorphs(),
  hair: {
    styleId: "lowcut",
    colorId: "hair_black_01",
    facialHairId: "facialhair_none_01",
  },
  clothing: {
    topId: "top_tee_01",
    bottomId: "bottom_trouser_01",
    outerwearId: null,
    shoeId: "shoe_sneaker_01",
    fabricId: "plain",
    topColor: "#22d3ee",
    bottomColor: "#334155",
  },
  accessories: [],
};

/* ------------------------------------------------------------------ */
/* validateAppearance                                                  */
/* ------------------------------------------------------------------ */

export interface ValidationResult {
  ok: boolean;
  appearance?: AppearanceV1;
  errors: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const BODY_TYPES: readonly BodyType[] = ["masculine", "feminine"];
const BODY_PRESETS: readonly BodyPresetId[] = ["woman", "man"];

export function validateAppearance(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const err = (path: string, msg: string) => errors.push(`${path}: ${msg}`);

  if (!isRecord(raw)) {
    return { ok: false, errors: ["appearance: must be an object"] };
  }

  // schemaVersion: missing → 1; present but ≠ 1 → reject.
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== AVATAR_SCHEMA_VERSION) {
    err("schemaVersion", `unsupported schemaVersion '${String(raw.schemaVersion)}' (expected 1)`);
  }

  // characterId: optional, must be a string.
  let characterId = "";
  if (raw.characterId !== undefined) {
    if (typeof raw.characterId !== "string") {
      err("characterId", "must be a string");
    } else {
      characterId = raw.characterId;
    }
  }

  /* ---------------- base ---------------- */
  const d = DEFAULT_APPEARANCE_V1;
  const base: AppearanceV1["base"] = { ...d.base };
  const rawBase = raw.base;
  if (rawBase === undefined) {
    // all defaults
  } else if (!isRecord(rawBase)) {
    err("base", "must be an object");
  } else {
    if (rawBase.bodyType !== undefined) {
      if (typeof rawBase.bodyType !== "string" || !(BODY_TYPES as readonly string[]).includes(rawBase.bodyType)) {
        err("base.bodyType", `unknown bodyType '${String(rawBase.bodyType)}'`);
      } else {
        base.bodyType = rawBase.bodyType as BodyType;
      }
    }
    if (rawBase.bodyPresetId !== undefined) {
      if (typeof rawBase.bodyPresetId !== "string" || !(BODY_PRESETS as readonly string[]).includes(rawBase.bodyPresetId)) {
        err("base.bodyPresetId", `unknown body preset '${String(rawBase.bodyPresetId)}'`);
      } else {
        base.bodyPresetId = rawBase.bodyPresetId as BodyPresetId;
      }
    }
    // Consistency: preset and type must agree (man↔masculine, woman↔feminine).
    if (BODY_PRESET_TO_TYPE[base.bodyPresetId] !== base.bodyType) {
      err("base", `bodyPresetId '${base.bodyPresetId}' conflicts with bodyType '${base.bodyType}'`);
    }
    if (rawBase.facePresetId !== undefined) {
      const id = rawBase.facePresetId;
      const asset = typeof id === "string" ? AVATAR_MANIFEST_BY_ID[id] : undefined;
      if (!asset || asset.status !== "available" || asset.kind !== "head") {
        err("base.facePresetId", `unknown face preset '${String(id)}'`);
      } else {
        base.facePresetId = id as AppearanceV1["base"]["facePresetId"];
      }
    }
    if (rawBase.skinToneId !== undefined) {
      const id = rawBase.skinToneId;
      const asset = typeof id === "string" ? AVATAR_MANIFEST_BY_ID[id] : undefined;
      if (!asset || asset.status !== "available" || asset.kind !== "texture" || !SKIN_TONE_IDS.includes(asset.id)) {
        err("base.skinToneId", `unknown skin tone '${String(id)}'`);
      } else {
        base.skinToneId = id as AppearanceV1["base"]["skinToneId"];
      }
    }
  }

  /* ---------------- morphs ---------------- */
  const morphs = defaultMorphs();
  const permitted = new Map(PERMITTED_MORPHS.map((m) => [m.key, m]));
  const rawMorphs = raw.morphs;
  if (rawMorphs === undefined) {
    // all defaults
  } else if (!isRecord(rawMorphs)) {
    err("morphs", "must be an object");
  } else {
    for (const [key, value] of Object.entries(rawMorphs)) {
      const def = permitted.get(key);
      if (!def) {
        err(`morphs.${key}`, "unknown morph key");
        continue;
      }
      if (typeof value !== "number" || !Number.isFinite(value)) {
        err(`morphs.${key}`, "must be a finite number");
        continue;
      }
      if (value < def.min || value > def.max) {
        err(`morphs.${key}`, `out of range [${def.min}, ${def.max}] (got ${value})`);
        continue;
      }
      morphs[key as MorphKey] = value;
    }
  }

  /* ---------------- hair ---------------- */
  const hair: AppearanceV1["hair"] = { ...d.hair };
  const rawHair = raw.hair;
  if (rawHair === undefined) {
    // defaults
  } else if (!isRecord(rawHair)) {
    err("hair", "must be an object");
  } else {
    const checkAsset = (
      path: string,
      value: unknown,
      kind: "hair" | "texture",
      slot: string
    ): string | undefined => {
      if (typeof value !== "string") {
        err(path, "must be a manifest asset id string");
        return undefined;
      }
      const asset = AVATAR_MANIFEST_BY_ID[value];
      if (!asset || asset.status !== "available" || asset.kind !== kind || !asset.slots.includes(slot)) {
        err(path, `unknown ${kind} asset '${value}'`);
        return undefined;
      }
      return value;
    };
    if (rawHair.styleId !== undefined) {
      const v = checkAsset("hair.styleId", rawHair.styleId, "hair", "hair");
      if (v) hair.styleId = v as AppearanceV1["hair"]["styleId"];
    }
    if (rawHair.colorId !== undefined) {
      // Hair colours are texture assets with no wearable slot; accept any
      // available texture whose id starts with "hair_".
      const id = rawHair.colorId;
      if (typeof id !== "string") {
        err("hair.colorId", "must be a manifest asset id string");
      } else {
        const asset = AVATAR_MANIFEST_BY_ID[id];
        if (!asset || asset.status !== "available" || asset.kind !== "texture" || !id.startsWith("hair_")) {
          err("hair.colorId", `unknown hair colour '${id}'`);
        } else {
          hair.colorId = id as AppearanceV1["hair"]["colorId"];
        }
      }
    }
    if (rawHair.facialHairId !== undefined) {
      const v = checkAsset("hair.facialHairId", rawHair.facialHairId, "hair", "facialHair");
      if (v) hair.facialHairId = v as AppearanceV1["hair"]["facialHairId"];
    }
  }

  /* ---------------- clothing ---------------- */
  const clothing: AppearanceV1["clothing"] = { ...d.clothing };
  const rawClothing = raw.clothing;
  if (rawClothing === undefined) {
    // defaults
  } else if (!isRecord(rawClothing)) {
    err("clothing", "must be an object");
  } else {
    const checkClothing = (
      path: string,
      value: unknown,
      slot: string
    ): string | undefined => {
      if (typeof value !== "string") {
        err(path, "must be a manifest asset id string");
        return undefined;
      }
      const asset = AVATAR_MANIFEST_BY_ID[value];
      if (!asset || asset.status !== "available" || asset.kind !== "clothing" || !asset.slots.includes(slot)) {
        err(path, `unknown clothing asset '${value}'`);
        return undefined;
      }
      return value;
    };
    if (rawClothing.topId !== undefined) {
      const v = checkClothing("clothing.topId", rawClothing.topId, "top");
      if (v) clothing.topId = v as AppearanceV1["clothing"]["topId"];
    }
    if (rawClothing.bottomId !== undefined) {
      const v = checkClothing("clothing.bottomId", rawClothing.bottomId, "bottom");
      if (v) clothing.bottomId = v as AppearanceV1["clothing"]["bottomId"];
    }
    if (rawClothing.outerwearId !== undefined) {
      if (rawClothing.outerwearId === null) {
        clothing.outerwearId = null;
      } else {
        const v = checkClothing("clothing.outerwearId", rawClothing.outerwearId, "outerwear");
        if (v) clothing.outerwearId = v as NonNullable<AppearanceV1["clothing"]["outerwearId"]>;
      }
    }
    if (rawClothing.shoeId !== undefined) {
      const v = checkClothing("clothing.shoeId", rawClothing.shoeId, "shoe");
      if (v) clothing.shoeId = v as AppearanceV1["clothing"]["shoeId"];
    }
    if (rawClothing.fabricId !== undefined) {
      const v = rawClothing.fabricId;
      const asset = typeof v === "string" ? AVATAR_MANIFEST_BY_ID[v] : undefined;
      // Fabrics are the texture assets named exactly like the legacy ids.
      if (!asset || asset.status !== "available" || asset.kind !== "texture" || !FABRIC_IDS.includes(asset.id)) {
        err("clothing.fabricId", `unknown fabric '${String(v)}'`);
      } else {
        clothing.fabricId = v as AppearanceV1["clothing"]["fabricId"];
      }
    }
    const checkPalette = (
      path: string,
      value: unknown,
      palette: readonly string[]
    ): string | undefined => {
      if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
        err(path, "must be a #rrggbb colour string");
        return undefined;
      }
      const norm = value.toLowerCase();
      if (!palette.includes(norm)) {
        err(path, `colour '${norm}' is not in the palette`);
        return undefined;
      }
      return norm;
    };
    if (rawClothing.topColor !== undefined) {
      const v = checkPalette("clothing.topColor", rawClothing.topColor, AVATAR_TOP_COLORS);
      if (v) clothing.topColor = v;
    }
    if (rawClothing.bottomColor !== undefined) {
      const v = checkPalette("clothing.bottomColor", rawClothing.bottomColor, AVATAR_BOTTOM_COLORS);
      if (v) clothing.bottomColor = v;
    }
  }

  /* ---------------- accessories ---------------- */
  const accessories: AppearanceV1["accessories"] = [];
  const rawAcc = raw.accessories;
  if (rawAcc === undefined) {
    // none
  } else if (!Array.isArray(rawAcc)) {
    err("accessories", "must be an array");
  } else {
    const seen = new Set<string>();
    rawAcc.forEach((entry, i) => {
      const path = `accessories[${i}]`;
      if (!isRecord(entry)) {
        err(path, "must be an object {slot, assetId}");
        return;
      }
      const { slot, assetId } = entry;
      if (typeof slot !== "string" || !(ACCESSORY_SLOTS as readonly string[]).includes(slot)) {
        err(`${path}.slot`, `unknown accessory slot '${String(slot)}'`);
        return;
      }
      if (seen.has(slot)) {
        err(`${path}.slot`, `duplicate accessory slot '${slot}'`);
        return;
      }
      const asset = typeof assetId === "string" ? AVATAR_MANIFEST_BY_ID[assetId] : undefined;
      if (!asset || asset.status !== "available" || asset.kind !== "accessory") {
        err(`${path}.assetId`, `unknown accessory asset '${String(assetId)}'`);
        return;
      }
      seen.add(slot);
      accessories.push({ slot: slot as AccessorySlot, assetId: asset.id });
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    appearance: {
      schemaVersion: AVATAR_SCHEMA_VERSION,
      characterId,
      base,
      morphs,
      hair,
      clothing,
      accessories,
    },
    errors: [],
  };
}
