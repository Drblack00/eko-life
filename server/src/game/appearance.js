// ============================================================
// game/appearance.js — Èkó Life avatar appearance: server-side
// validation + versioned persistence (Milestone 6).
//
// SYNC NOTE: the allowlists and policies below MUST be kept in sync
// with the canonical M2 client data layer in web/src/avatar/*
// (schema.ts ids, manifest.ts ids, validation.ts rules:
//   unknown ids → invalid; morphs 0..1; safe defaults; lowercase
//   colour normalization; renderer objects / paths / URLs never
//   accepted). The M2 modules are pure TS (no DOM/three.js) and are
//   the canonical source — this file mirrors them in plain JS because
//   the server and client do not share a package yet.
//   Future: extract web/src/avatar/* + this module into a shared package.
//
// Exports:
//   validateAppearanceV1(raw) -> { ok, appearance?, errors[] }
//   legacyLookToV1(raw, characterId) -> AppearanceV1 (never throws)
//   persistAppearance({userId, characterId, appearance, expectedRev})
//     -> Promise<{appearance, revision}> (throws coded errors)
//   buildCatalog() -> catalog payload for GET /api/avatar/catalog
//   AppearanceValidationError / AppearanceConflictError / AppearanceNotFoundError
// ============================================================
import { dbGet, dbRun, dbMode } from '../db.js';

/* ------------------------------------------------------------------ */
/* Error types — routes map `code` → HTTP status.                      */
/* ------------------------------------------------------------------ */

export class AppearanceValidationError extends Error {
  constructor(errors) {
    super(errors && errors.length ? errors[0] : 'Invalid appearance.');
    this.name = 'AppearanceValidationError';
    this.code = 'validation_failed';
    this.errors = Array.isArray(errors) ? errors : [String(errors)];
  }
}

export class AppearanceConflictError extends Error {
  constructor(currentRevision) {
    super(`Appearance revision conflict (current revision ${currentRevision}).`);
    this.name = 'AppearanceConflictError';
    this.code = 'revision_conflict';
    this.revision = Number(currentRevision);
  }
}

export class AppearanceNotFoundError extends Error {
  constructor(message = 'Character not found.') {
    super(message);
    this.name = 'AppearanceNotFoundError';
    this.code = 'not_found';
  }
}

/* ------------------------------------------------------------------ */
/* Allowlists — mirror web/src/avatar/manifest.ts ids EXACTLY.         */
/* Keep every permitted id in this one section.                        */
/* ------------------------------------------------------------------ */

export const AVATAR_SCHEMA_VERSION = 1;

const BODY_TYPES = ['masculine', 'feminine'];
const BODY_PRESETS = ['woman', 'man'];
const BODY_PRESET_TO_TYPE = { woman: 'feminine', man: 'masculine' };
const FACE_PRESETS = ['face_default_01'];

// Skin tones (texture assets, verbatim legacy ids + hexes).
const SKIN_TONES = [
  ['deep_espresso', '#3b2314'],
  ['dark_cocoa', '#4a2c17'],
  ['burnt_caramel', '#5d3a1f'],
  ['mahogany', '#6f4426'],
  ['walnut', '#7d5330'],
  ['cocoa', '#8a5f38'],
  ['coffee', '#9a6f45'],
  ['latte', '#ab8054'],
  ['honey', '#bc9066'],
  ['sand', '#cda077'],
  ['amber', '#dcb07e'],
  ['cream', '#e8cfa3'],
];
const SKIN_TONE_IDS = SKIN_TONES.map(([id]) => id);
const SKIN_HEX_TO_ID = Object.fromEntries(SKIN_TONES.map(([id, hex]) => [hex.toLowerCase(), id]));

// Hair styles (hair assets, verbatim legacy ids + v1 procedural ids, slot "hair").
const HAIR_STYLES = ['lowcut', 'bald', 'curls', 'afro', 'locs', 'braids', 'classic', 'hair_taper_fade_01', 'hair_waves_01'];
// Hair colours (v1 texture assets).
const HAIR_COLORS = ['hair_black_01', 'hair_dark_brown_01', 'hair_brown_01'];
// Facial hair (v1 hair-slot assets; none_01 = honestly nothing).
const FACIAL_HAIRS = ['facialhair_none_01', 'facialhair_mustache_01', 'facialhair_goatee_01', 'facialhair_beard_short_01'];

// Clothing, decomposed from the 5 legacy outfits (mirror manifest.ts).
const TOPS = ['top_tee_01', 'top_shirt_office_01'];
const BOTTOMS = ['bottom_trouser_01', 'bottom_short_01', 'bottom_cargo_01'];
const OUTERWEARS = ['outer_hoodie_01', 'outer_hivis_vest_01'];
const SHOES = ['shoe_sneaker_01', 'shoe_oxford_01', 'shoe_boot_01'];
// Fabrics (texture assets, verbatim legacy ids).
const FABRICS = ['plain', 'ankara', 'adire', 'asoke'];
// Legacy outfits (kept for the catalog + legacy→v1 mapper only).
const LEGACY_OUTFITS = ['casual', 'hoodie', 'office', 'chill', 'sitework'];

const ACCESSORY_SLOTS = ['head', 'face', 'ears', 'neck', 'wrist'];

// Colour palettes — mirror server AVATAR_TOP_COLORS / AVATAR_BOTTOM_COLORS
// (game/data.js) and web/src/avatar/validation.ts.
const AVATAR_TOP_COLORS = [
  '#22d3ee', '#f472b6', '#a3e635', '#fbbf24', '#c084fc',
  '#fb7185', '#34d399', '#60a5fa', '#ef4444', '#fb923c',
];
const AVATAR_BOTTOM_COLORS = [
  '#334155', '#111827', '#f8fafc', '#1e3a8a', '#64748b',
  '#78350f', '#14532d', '#7c2d12', '#831843', '#3b0764',
];

// Permitted morphs — mirror web/src/avatar/schema.ts PERMITTED_MORPHS
// (each 0..1, default 0.5; validated+stored, applied by the M3 builder).
const PERMITTED_MORPHS = [
  { key: 'jawWidth', default: 0.5, min: 0, max: 1, description: 'Jaw width / taper strength' },
  { key: 'cheekboneHeight', default: 0.5, min: 0, max: 1, description: 'Cheekbone lift height' },
  { key: 'noseWidth', default: 0.5, min: 0, max: 1, description: 'Nose width (dorsum + alae)' },
  { key: 'noseLength', default: 0.5, min: 0, max: 1, description: 'Nose length (bridge to tip)' },
  { key: 'lipFullness', default: 0.5, min: 0, max: 1, description: 'Lip fullness' },
  { key: 'browProminence', default: 0.5, min: 0, max: 1, description: 'Brow ridge prominence' },
  { key: 'chinLength', default: 0.5, min: 0, max: 1, description: 'Chin length / projection' },
  { key: 'eyeSpacing', default: 0.5, min: 0, max: 1, description: 'Eye spacing (interpupillary distance)' },
  { key: 'foreheadSlope', default: 0.5, min: 0, max: 1, description: 'Forehead slope' },
];

/* ------------------------------------------------------------------ */
/* Defaults — mirror web/src/avatar/validation.ts DEFAULT_APPEARANCE_V1 */
/* (woman / cocoa / lowcut / casual / plain / #22d3ee / #334155).       */
/* ------------------------------------------------------------------ */

function defaultMorphs() {
  const m = {};
  for (const def of PERMITTED_MORPHS) m[def.key] = def.default;
  return m;
}

export function defaultAppearanceV1(characterId = '') {
  return JSON.parse(JSON.stringify({
    schemaVersion: AVATAR_SCHEMA_VERSION,
    characterId,
    base: {
      bodyType: 'feminine',
      bodyPresetId: 'woman',
      facePresetId: 'face_default_01',
      skinToneId: 'cocoa',
    },
    morphs: defaultMorphs(),
    hair: {
      styleId: 'lowcut',
      colorId: 'hair_black_01',
      facialHairId: 'facialhair_none_01',
    },
    clothing: {
      topId: 'top_tee_01',
      bottomId: 'bottom_trouser_01',
      outerwearId: null,
      shoeId: 'shoe_sneaker_01',
      fabricId: 'plain',
      topColor: '#22d3ee',
      bottomColor: '#334155',
    },
    accessories: [],
  }));
}

/* ------------------------------------------------------------------ */
/* validateAppearanceV1 — mirrors web/src/avatar/validation.ts policy: */
/* REJECT unknown ids / unknown morph keys / out-of-range or non-      */
/* numeric morphs / wrong types / colours outside the palettes /       */
/* bodyType-bodyPresetId mismatches / non-object input; DEFAULT        */
/* missing optional fields; NORMALIZE colours to lowercase; NEVER      */
/* accept renderer objects, paths or URLs (only known ids pass).       */
/* ------------------------------------------------------------------ */

function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateAppearanceV1(raw) {
  const errors = [];
  const err = (path, msg) => errors.push(`${path}: ${msg}`);

  if (!isRecord(raw)) {
    return { ok: false, errors: ['appearance: must be an object'] };
  }

  // schemaVersion: missing → 1; present but ≠ 1 → reject.
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== AVATAR_SCHEMA_VERSION) {
    err('schemaVersion', `unsupported schemaVersion '${String(raw.schemaVersion)}' (expected 1)`);
  }

  // characterId: optional, must be a string.
  let characterId = '';
  if (raw.characterId !== undefined) {
    if (typeof raw.characterId !== 'string') {
      err('characterId', 'must be a string');
    } else {
      characterId = raw.characterId;
    }
  }

  /* ---------------- base ---------------- */
  const d = defaultAppearanceV1();
  const base = { ...d.base };
  const rawBase = raw.base;
  if (rawBase === undefined) {
    // all defaults
  } else if (!isRecord(rawBase)) {
    err('base', 'must be an object');
  } else {
    if (rawBase.bodyType !== undefined) {
      if (typeof rawBase.bodyType !== 'string' || !BODY_TYPES.includes(rawBase.bodyType)) {
        err('base.bodyType', `unknown bodyType '${String(rawBase.bodyType)}'`);
      } else {
        base.bodyType = rawBase.bodyType;
      }
    }
    if (rawBase.bodyPresetId !== undefined) {
      if (typeof rawBase.bodyPresetId !== 'string' || !BODY_PRESETS.includes(rawBase.bodyPresetId)) {
        err('base.bodyPresetId', `unknown body preset '${String(rawBase.bodyPresetId)}'`);
      } else {
        base.bodyPresetId = rawBase.bodyPresetId;
      }
    }
    if (BODY_PRESET_TO_TYPE[base.bodyPresetId] !== base.bodyType) {
      err('base', `bodyPresetId '${base.bodyPresetId}' conflicts with bodyType '${base.bodyType}'`);
    }
    if (rawBase.facePresetId !== undefined) {
      if (typeof rawBase.facePresetId !== 'string' || !FACE_PRESETS.includes(rawBase.facePresetId)) {
        err('base.facePresetId', `unknown face preset '${String(rawBase.facePresetId)}'`);
      } else {
        base.facePresetId = rawBase.facePresetId;
      }
    }
    if (rawBase.skinToneId !== undefined) {
      if (typeof rawBase.skinToneId !== 'string' || !SKIN_TONE_IDS.includes(rawBase.skinToneId)) {
        err('base.skinToneId', `unknown skin tone '${String(rawBase.skinToneId)}'`);
      } else {
        base.skinToneId = rawBase.skinToneId;
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
    err('morphs', 'must be an object');
  } else {
    for (const [key, value] of Object.entries(rawMorphs)) {
      const def = permitted.get(key);
      if (!def) {
        err(`morphs.${key}`, 'unknown morph key');
        continue;
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        err(`morphs.${key}`, 'must be a finite number');
        continue;
      }
      if (value < def.min || value > def.max) {
        err(`morphs.${key}`, `out of range [${def.min}, ${def.max}] (got ${value})`);
        continue;
      }
      morphs[key] = value;
    }
  }

  /* ---------------- hair ---------------- */
  const hair = { ...d.hair };
  const rawHair = raw.hair;
  if (rawHair === undefined) {
    // defaults
  } else if (!isRecord(rawHair)) {
    err('hair', 'must be an object');
  } else {
    if (rawHair.styleId !== undefined) {
      if (typeof rawHair.styleId !== 'string' || !HAIR_STYLES.includes(rawHair.styleId)) {
        err('hair.styleId', `unknown hairstyle '${String(rawHair.styleId)}'`);
      } else {
        hair.styleId = rawHair.styleId;
      }
    }
    if (rawHair.colorId !== undefined) {
      if (typeof rawHair.colorId !== 'string' || !HAIR_COLORS.includes(rawHair.colorId)) {
        err('hair.colorId', `unknown hair colour '${String(rawHair.colorId)}'`);
      } else {
        hair.colorId = rawHair.colorId;
      }
    }
    if (rawHair.facialHairId !== undefined) {
      if (typeof rawHair.facialHairId !== 'string' || !FACIAL_HAIRS.includes(rawHair.facialHairId)) {
        err('hair.facialHairId', `unknown facial hair '${String(rawHair.facialHairId)}'`);
      } else {
        hair.facialHairId = rawHair.facialHairId;
      }
    }
  }

  /* ---------------- clothing ---------------- */
  const clothing = { ...d.clothing };
  const rawClothing = raw.clothing;
  if (rawClothing === undefined) {
    // defaults
  } else if (!isRecord(rawClothing)) {
    err('clothing', 'must be an object');
  } else {
    const check = (path, value, list) => {
      if (typeof value !== 'string' || !list.includes(value)) {
        err(path, `unknown asset '${String(value)}'`);
        return undefined;
      }
      return value;
    };
    if (rawClothing.topId !== undefined) {
      const v = check('clothing.topId', rawClothing.topId, TOPS);
      if (v) clothing.topId = v;
    }
    if (rawClothing.bottomId !== undefined) {
      const v = check('clothing.bottomId', rawClothing.bottomId, BOTTOMS);
      if (v) clothing.bottomId = v;
    }
    if (rawClothing.outerwearId !== undefined) {
      if (rawClothing.outerwearId === null) {
        clothing.outerwearId = null;
      } else {
        const v = check('clothing.outerwearId', rawClothing.outerwearId, OUTERWEARS);
        if (v) clothing.outerwearId = v;
      }
    }
    if (rawClothing.shoeId !== undefined) {
      const v = check('clothing.shoeId', rawClothing.shoeId, SHOES);
      if (v) clothing.shoeId = v;
    }
    if (rawClothing.fabricId !== undefined) {
      const v = check('clothing.fabricId', rawClothing.fabricId, FABRICS);
      if (v) clothing.fabricId = v;
    }
    const checkPalette = (path, value, palette) => {
      if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
        err(path, 'must be a #rrggbb colour string');
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
      const v = checkPalette('clothing.topColor', rawClothing.topColor, AVATAR_TOP_COLORS);
      if (v) clothing.topColor = v;
    }
    if (rawClothing.bottomColor !== undefined) {
      const v = checkPalette('clothing.bottomColor', rawClothing.bottomColor, AVATAR_BOTTOM_COLORS);
      if (v) clothing.bottomColor = v;
    }
  }

  /* ---------------- accessories ---------------- */
  const accessories = [];
  const rawAcc = raw.accessories;
  if (rawAcc === undefined) {
    // none
  } else if (!Array.isArray(rawAcc)) {
    err('accessories', 'must be an array');
  } else {
    const seen = new Set();
    rawAcc.forEach((entry, i) => {
      const path = `accessories[${i}]`;
      if (!isRecord(entry)) {
        err(path, 'must be an object {slot, assetId}');
        return;
      }
      const { slot, assetId } = entry;
      if (typeof slot !== 'string' || !ACCESSORY_SLOTS.includes(slot)) {
        err(`${path}.slot`, `unknown accessory slot '${String(slot)}'`);
        return;
      }
      if (seen.has(slot)) {
        err(`${path}.slot`, `duplicate accessory slot '${slot}'`);
        return;
      }
      // M2 ships NO available accessory assets — every assetId rejects.
      err(`${path}.assetId`, `unknown accessory asset '${String(assetId)}'`);
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

/* ------------------------------------------------------------------ */
/* Legacy flat look → v1 — mirrors web/src/avatar/migrate.ts policy:   */
/* total (null/garbage/partial never throws), unknown legacy ids fall  */
/* back field-by-field to defaults, honest slot mapping for slots     */
/* that did not exist in the legacy shape. Output always validates.    */
/* ------------------------------------------------------------------ */

// Outfit → decomposed slots (mirrors parts/clothing.ts per-outfit builds).
const OUTFIT_DECOMPOSITION = {
  casual: { topId: 'top_tee_01', bottomId: 'bottom_trouser_01', outerwearId: null, shoeId: 'shoe_sneaker_01' },
  hoodie: { topId: 'top_tee_01', bottomId: 'bottom_trouser_01', outerwearId: 'outer_hoodie_01', shoeId: 'shoe_sneaker_01' },
  office: { topId: 'top_shirt_office_01', bottomId: 'bottom_trouser_01', outerwearId: null, shoeId: 'shoe_oxford_01' },
  chill: { topId: 'top_tee_01', bottomId: 'bottom_short_01', outerwearId: null, shoeId: 'shoe_sneaker_01' },
  sitework: { topId: 'top_tee_01', bottomId: 'bottom_cargo_01', outerwearId: 'outer_hivis_vest_01', shoeId: 'shoe_boot_01' },
};

function pick(value, allowed, fallback) {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

function pickColor(value, palette, fallback) {
  if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
    const norm = value.toLowerCase();
    if (palette.includes(norm)) return norm;
  }
  return fallback;
}

/** Convert a legacy flat AvatarLook to AppearanceV1. Never throws. */
export function legacyLookToV1(raw, characterId = '') {
  const d = defaultAppearanceV1(characterId);
  if (!isRecord(raw)) return d;

  const bodyPresetId = pick(raw.body, BODY_PRESETS, d.base.bodyPresetId);
  const bodyType = BODY_PRESET_TO_TYPE[bodyPresetId];

  // skin: tone id, or a #hex matching a known tone hex.
  let skinToneId = d.base.skinToneId;
  if (typeof raw.skin === 'string') {
    if (SKIN_TONE_IDS.includes(raw.skin)) {
      skinToneId = raw.skin;
    } else if (/^#[0-9a-fA-F]{6}$/.test(raw.skin)) {
      const mapped = SKIN_HEX_TO_ID[raw.skin.toLowerCase()];
      if (mapped) skinToneId = mapped;
    }
  }

  const hairStyleId = pick(raw.hair, HAIR_STYLES, d.hair.styleId);
  const outfit = (typeof raw.outfit === 'string' && OUTFIT_DECOMPOSITION[raw.outfit])
    ? OUTFIT_DECOMPOSITION[raw.outfit]
    : OUTFIT_DECOMPOSITION.casual;
  const fabricId = pick(raw.fabric, FABRICS, d.clothing.fabricId);

  const candidate = {
    schemaVersion: AVATAR_SCHEMA_VERSION,
    characterId: typeof raw.characterId === 'string' ? raw.characterId : characterId,
    base: {
      bodyType,
      bodyPresetId,
      facePresetId: 'face_default_01',
      skinToneId,
    },
    morphs: {},
    hair: {
      styleId: hairStyleId,
      colorId: 'hair_black_01',
      facialHairId: 'facialhair_none_01',
    },
    clothing: {
      topId: outfit.topId,
      bottomId: outfit.bottomId,
      outerwearId: outfit.outerwearId,
      shoeId: outfit.shoeId,
      fabricId,
      topColor: pickColor(raw.topColor, AVATAR_TOP_COLORS, d.clothing.topColor),
      bottomColor: pickColor(raw.bottomColor, AVATAR_BOTTOM_COLORS, d.clothing.bottomColor),
    },
    accessories: [],
  };

  const result = validateAppearanceV1(candidate);
  if (result.ok && result.appearance) return result.appearance;
  return d; // belt and braces — our own candidate should always validate
}

/**
 * True when `raw` already looks like a v1 appearance (not legacy flat).
 * Legacy shapes keep `hair` as a bare string; v1 shapes use section
 * objects — so a v1-shaped-but-invalid payload must NOT be silently
 * migrated (it should hit strict validation → 400).
 */
export function isV1Shape(raw) {
  if (!isRecord(raw)) return false;
  if (raw.schemaVersion === AVATAR_SCHEMA_VERSION) return true;
  return (
    isRecord(raw.base) ||
    isRecord(raw.hair) ||
    isRecord(raw.clothing) ||
    isRecord(raw.morphs) ||
    Array.isArray(raw.accessories)
  );
}

/** Parse a stored `avatar_look` TEXT value (legacy flat, v1, or garbage). */
export function parseStoredLook(text) {
  if (text == null) return null;
  if (typeof text === 'object') return text;
  try {
    return JSON.parse(String(text));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Catalog — GET /api/avatar/catalog payload (ids match the M2         */
/* manifest exactly).                                                  */
/* ------------------------------------------------------------------ */

export function buildCatalog() {
  return {
    schemaVersion: AVATAR_SCHEMA_VERSION,
    bodies: ['woman', 'man'],
    bodyPresets: ['woman', 'man'],
    facePresets: ['face_default_01'],
    skins: SKIN_TONE_IDS,
    hairs: HAIR_STYLES,
    hairColors: HAIR_COLORS,
    facialHair: FACIAL_HAIRS,
    outfits: LEGACY_OUTFITS, // legacy decomposition keys (v1 uses tops/bottoms/outerwear/shoes)
    fabrics: FABRICS,
    tops: TOPS,
    bottoms: BOTTOMS,
    outerwear: OUTERWEARS,
    shoes: SHOES,
    accessories: [], // M2 ships no accessory assets
    morphs: PERMITTED_MORPHS.map((m) => ({
      key: m.key,
      default: m.default,
      min: m.min,
      max: m.max,
      description: m.description,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* persistAppearance — THE single server-side persist path.            */
/*                                                                     */
/* { userId, characterId, appearance, expectedRev }                    */
/* - characterId lookup is by DB id; ownership verified against        */
/*   userId — client-supplied user ids are never trusted.              */
/* - legacy flat looks are converted to v1 server-side                 */
/*   (mirroring web/src/avatar/migrate.ts).                            */
/* - expectedRev must equal the current appearance_rev, or             */
/*   AppearanceConflictError (carrying the current revision) is        */
/*   thrown. expectedRev === null/undefined = force-write (legacy      */
/*   paths) — still bumps the revision.                                */
/* - Writes canonical JSON + rev+1 + updated_at atomically: the        */
/*   UPDATE is conditional on the revision we read, so a lost race     */
/*   degrades to a conflict error instead of silent last-write-wins.   */
/* - Returns { appearance, revision }.                                 */
/* ------------------------------------------------------------------ */

export async function persistAppearance({ userId, characterId, appearance, expectedRev }) {
  const cid = Number(characterId);
  if (!Number.isInteger(cid) || cid <= 0) {
    throw new AppearanceNotFoundError('Character not found.');
  }

  const row = await dbGet(
    'SELECT id, user_id, avatar_look, appearance_rev FROM characters WHERE id = ?',
    'SELECT id, user_id, avatar_look, appearance_rev FROM characters WHERE id = $1',
    [cid]);
  if (!row || Number(row.user_id) !== Number(userId)) {
    throw new AppearanceNotFoundError('Character not found.');
  }

  const v1Input = isV1Shape(appearance)
    ? appearance
    : legacyLookToV1(appearance, String(cid));
  const res = validateAppearanceV1({ ...v1Input, characterId: String(cid) });
  if (!res.ok) {
    throw new AppearanceValidationError(res.errors);
  }
  const canonical = res.appearance;
  const canonicalJson = JSON.stringify(canonical);

  const current = Number(row.appearance_rev ?? 0) || 0;
  if (expectedRev !== null && expectedRev !== undefined && Number(expectedRev) !== current) {
    throw new AppearanceConflictError(current);
  }
  const next = current + 1;
  const now = Date.now();

  // Conditional write: only applies if the revision we read is still
  // current, so concurrent writes surface as conflicts, not overwrites.
  const isPg = dbMode() === 'postgres';
  if (!isPg) {
    const r = await dbRun(
      'UPDATE characters SET avatar_look = ?, appearance_rev = ?, updated_at = ? WHERE id = ? AND appearance_rev = ?',
      'UPDATE characters SET avatar_look = $1, appearance_rev = $2, updated_at = $3 WHERE id = $4 AND appearance_rev = $5',
      [canonicalJson, next, now, cid, current]);
    if (!r || Number(r.changes) === 0) {
      const fresh = await dbGet(
        'SELECT appearance_rev FROM characters WHERE id = ?',
        'SELECT appearance_rev FROM characters WHERE id = $1',
        [cid]);
      throw new AppearanceConflictError(Number(fresh?.appearance_rev ?? 0) || 0);
    }
  } else {
    // PG runQ cannot report affected rows: write, then verify BOTH the
    // revision and the payload landed exactly. A raced concurrent write can
    // leave the revision at `next` with a DIFFERENT payload (both writers
    // read the same `current`) — without the payload check that lost race
    // would falsely report success.
    await dbRun(
      'UPDATE characters SET avatar_look = ?, appearance_rev = ?, updated_at = ? WHERE id = ? AND appearance_rev = ?',
      'UPDATE characters SET avatar_look = $1, appearance_rev = $2, updated_at = $3 WHERE id = $4 AND appearance_rev = $5',
      [canonicalJson, next, now, cid, current]);
    const fresh = await dbGet(
      'SELECT appearance_rev, avatar_look FROM characters WHERE id = ?',
      'SELECT appearance_rev, avatar_look FROM characters WHERE id = $1',
      [cid]);
    const freshRev = Number(fresh?.appearance_rev ?? 0) || 0;
    if (freshRev !== next || fresh?.avatar_look !== canonicalJson) {
      throw new AppearanceConflictError(freshRev);
    }
  }

  console.log(`[appearance] character ${cid} saved rev ${current} → ${next}`);
  return { appearance: canonical, revision: next };
}
