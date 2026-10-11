/**
 * Èkó Life avatar studio — honest UI catalog (Milestone 5).
 *
 * Every control in the rebuilt studio is generated from this module, and
 * every entry here maps 1:1 to a manifest asset (or palette colour) the
 * assembler actually honors TODAY. Nothing in this catalog is aspirational:
 *
 * - Body: woman/man — real (structural change, assembler rebuilds).
 * - Skin: 12 tones — real (assembler recolors materials in place).
 * - Hair: 9 styles + 3 colours + 4 facial-hair options — real
 *   (assembler swaps the hair / facial-hair groups).
 * - Clothing: 5 OUTFIT cards + 4 fabrics + top/bottom colours — real.
 *   The pipeline is outfit-based (assembler inverts the decomposition
 *   table to recover the OutfitId), so the cards below carry the EXACT
 *   decomposed rows from migrate.ts OUTFIT_DECOMPOSITION. Picking a card
 *   can never render a different outfit — see the honesty test in
 *   catalog.test.ts (each row must resolve via
 *   assembler.outfitIdForClothing with zero fallback notes).
 *   Shoes are outfit-implied (sneakers/oxfords/boots per outfit), so there
 *   is deliberately NO separate shoe picker.
 *
 * Deliberately OMITTED (documented, not shipped as dead controls):
 * - Face category: all 9 schema morphs are STUBBED in the assembler
 *   (MORPH_SUPPORT: every entry "stubbed") and only face_default_01
 *   exists in the manifest. A slider would move nothing on screen.
 * - Accessories category: the manifest has zero available accessory
 *   assets (only a pending licensed-GLB pack). An accessories tab would
 *   be an empty shelf.
 *
 * Pure data: no DOM, no three.js. Safe for vitest node env.
 */

import {
  AVATAR_MANIFEST_BY_ID,
  type AvatarAsset,
} from "../../../avatar/manifest";
import {
  AVATAR_BOTTOM_COLORS,
  AVATAR_TOP_COLORS,
} from "../../../avatar/validation";
import type {
  AppearanceV1,
  BodyPresetId,
  BodyType,
  ClothingBottomId,
  ClothingTopId,
  FabricId,
  FacialHairId,
  HairColorId,
  HairStyleId,
  OuterwearId,
  ShoeId,
  SkinToneId,
} from "../../../avatar/schema";

/* ------------------------------------------------------------------ */
/* Option shapes                                                       */
/* ------------------------------------------------------------------ */

export interface CatalogOption {
  id: string;
  name: string;
}

export interface SwatchOption extends CatalogOption {
  hex: string;
}

export interface OutfitRow {
  /** Legacy outfit id — what the pipeline's dressBody() renders. */
  outfitId: "casual" | "hoodie" | "office" | "chill" | "sitework";
  name: string;
  /** What the card actually puts on the figure (honest caption). */
  caption: string;
  topId: ClothingTopId;
  bottomId: ClothingBottomId;
  outerwearId: OuterwearId | null;
  shoeId: ShoeId;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function available(id: string): AvatarAsset {
  const asset = AVATAR_MANIFEST_BY_ID[id];
  if (!asset || asset.status !== "available") {
    throw new Error(`catalog: manifest asset "${id}" is not available`);
  }
  return asset;
}

/** Every id in `ids` must resolve to an available manifest asset. */
export function assertCatalogIds(ids: readonly string[]): void {
  for (const id of ids) available(id);
}

/* ------------------------------------------------------------------ */
/* Body — 2 presets (verbatim legacy ids)                               */
/* ------------------------------------------------------------------ */

export const BODY_OPTIONS: ReadonlyArray<{
  id: BodyPresetId;
  name: string;
}> = [
  { id: "woman", name: "Woman" },
  { id: "man", name: "Man" },
];

/* ------------------------------------------------------------------ */
/* Skin — 12 tones, hex + name straight from the manifest               */
/* ------------------------------------------------------------------ */

/** Canonical order (mirrors server AVATAR_SKINS). */
const SKIN_TONE_IDS: readonly SkinToneId[] = [
  "deep_espresso",
  "dark_cocoa",
  "burnt_caramel",
  "mahogany",
  "walnut",
  "cocoa",
  "coffee",
  "latte",
  "honey",
  "sand",
  "amber",
  "cream",
];

export const SKIN_TONE_OPTIONS: readonly SwatchOption[] = SKIN_TONE_IDS.map(
  (id) => {
    const asset = available(id);
    if (!asset.hex) throw new Error(`catalog: skin tone "${id}" has no hex`);
    return { id, name: asset.name, hex: asset.hex };
  }
);

/* ------------------------------------------------------------------ */
/* Hair — 9 styles / 3 colours / 4 facial-hair options                  */
/* ------------------------------------------------------------------ */

/** styleId → short UI label (manifest names are the long form). */
const HAIR_STYLE_LABELS: Readonly<Record<HairStyleId, string>> = {
  lowcut: "Low cut",
  bald: "Bald",
  curls: "Curls",
  afro: "Afro",
  locs: "Locs",
  braids: "Braids",
  classic: "Classic",
  hair_taper_fade_01: "Taper fade",
  hair_waves_01: "Waves",
};

export const HAIR_STYLE_OPTIONS: readonly CatalogOption[] = (
  Object.keys(HAIR_STYLE_LABELS) as HairStyleId[]
).map((id) => {
  available(id);
  return { id, name: HAIR_STYLE_LABELS[id] };
});

const HAIR_COLOR_LABELS: Readonly<Record<HairColorId, string>> = {
  hair_black_01: "Black",
  hair_dark_brown_01: "Dark brown",
  hair_brown_01: "Brown",
};

export const HAIR_COLOR_OPTIONS: readonly SwatchOption[] = (
  Object.keys(HAIR_COLOR_LABELS) as HairColorId[]
).map((id) => {
  const asset = available(id);
  if (!asset.hex) throw new Error(`catalog: hair colour "${id}" has no hex`);
  return { id, name: HAIR_COLOR_LABELS[id], hex: asset.hex };
});

const FACIAL_HAIR_LABELS: Readonly<Record<FacialHairId, string>> = {
  facialhair_none_01: "None",
  facialhair_mustache_01: "Mustache",
  facialhair_goatee_01: "Goatee",
  facialhair_beard_short_01: "Short beard",
};

export interface BodyCompatOption extends CatalogOption {
  /** Manifest compatibleBodyTypes, wired through for the editor UI. */
  compatibleBodyTypes: readonly BodyType[];
}

export const FACIAL_HAIR_OPTIONS: readonly BodyCompatOption[] = (
  Object.keys(FACIAL_HAIR_LABELS) as FacialHairId[]
).map((id) => {
  const asset = available(id);
  return {
    id,
    name: FACIAL_HAIR_LABELS[id],
    compatibleBodyTypes: asset.compatibleBodyTypes,
  };
});

/**
 * Defect 4: facial-hair options valid for a body type. The styled options
 * are masculine-only per the manifest — for the feminine body only
 * "None" is returned, so the editor hides the rest.
 */
export function facialHairOptionsForBody(
  bodyType: BodyType
): readonly CatalogOption[] {
  return FACIAL_HAIR_OPTIONS.filter((o) =>
    o.compatibleBodyTypes.includes(bodyType)
  );
}

/* ------------------------------------------------------------------ */
/* Clothing — 5 outfit cards = the exact decomposition rows.            */
/*                                                                     */
/* The M4 assembler inverts v1 clothing to an OutfitId via              */
/* V1_TO_OUTFIT (assembler.ts), which is the inverse of                 */
/* migrate.ts OUTFIT_DECOMPOSITION. Only these 5 combos render          */
/* exactly; anything else silently renders as "casual". The cards      */
/* therefore expose exactly these rows — no decomposed top/bottom/    */
/* shoe pickers that could promise a combo the pipeline can't keep.    */
/* ------------------------------------------------------------------ */

export const OUTFIT_ROWS: readonly OutfitRow[] = [
  {
    outfitId: "casual",
    name: "Casual",
    caption: "Tee · trousers · sneakers",
    topId: "top_tee_01",
    bottomId: "bottom_trouser_01",
    outerwearId: null,
    shoeId: "shoe_sneaker_01",
  },
  {
    outfitId: "hoodie",
    name: "Hoodie",
    caption: "Tee · trousers · hoodie · sneakers",
    topId: "top_tee_01",
    bottomId: "bottom_trouser_01",
    outerwearId: "outer_hoodie_01",
    shoeId: "shoe_sneaker_01",
  },
  {
    outfitId: "office",
    name: "Office",
    caption: "Shirt + tie · trousers · oxfords",
    topId: "top_shirt_office_01",
    bottomId: "bottom_trouser_01",
    outerwearId: null,
    shoeId: "shoe_oxford_01",
  },
  {
    outfitId: "chill",
    name: "Chill",
    caption: "Tee · shorts · sneakers",
    topId: "top_tee_01",
    bottomId: "bottom_short_01",
    outerwearId: null,
    shoeId: "shoe_sneaker_01",
  },
  {
    outfitId: "sitework",
    name: "Site work",
    caption: "Tee · cargo · hi-vis vest · boots",
    topId: "top_tee_01",
    bottomId: "bottom_cargo_01",
    outerwearId: "outer_hivis_vest_01",
    shoeId: "shoe_boot_01",
  },
];

/**
 * Which outfit card (if any) a v1 clothing block corresponds to.
 * Returns null for combos with no exact row — the assembler renders
 * those as "casual" (with a note), so the UI shows no card active and
 * says so honestly instead of highlighting the wrong card.
 */
export function outfitRowForClothing(
  clothing: AppearanceV1["clothing"]
): OutfitRow | null {
  const key = `${clothing.topId}|${clothing.bottomId}|${clothing.outerwearId ?? ""}|${clothing.shoeId}`;
  return (
    OUTFIT_ROWS.find(
      (r) =>
        `${r.topId}|${r.bottomId}|${r.outerwearId ?? ""}|${r.shoeId}` === key
    ) ?? null
  );
}

/** Apply an outfit card to a draft (field-level — nothing else touched). */
export function applyOutfitRow(
  draft: AppearanceV1,
  row: OutfitRow
): AppearanceV1 {
  return {
    ...draft,
    clothing: {
      ...draft.clothing,
      topId: row.topId,
      bottomId: row.bottomId,
      outerwearId: row.outerwearId,
      shoeId: row.shoeId,
    },
  };
}

/* ---------------- fabrics + garment colours ---------------- */

const FABRIC_LABELS: Readonly<Record<FabricId, string>> = {
  plain: "Plain",
  ankara: "Ankara",
  adire: "Adire",
  asoke: "Aso-oke",
};

export const FABRIC_OPTIONS: readonly CatalogOption[] = (
  Object.keys(FABRIC_LABELS) as FabricId[]
).map((id) => {
  available(id);
  return { id, name: FABRIC_LABELS[id] };
});

/** Server palettes (validation.ts mirrors server/src/game/data.js). */
export const TOP_COLOR_OPTIONS: readonly SwatchOption[] = AVATAR_TOP_COLORS.map(
  (hex) => ({ id: hex, name: hex, hex })
);

export const BOTTOM_COLOR_OPTIONS: readonly SwatchOption[] =
  AVATAR_BOTTOM_COLORS.map((hex) => ({ id: hex, name: hex, hex }));

/* ------------------------------------------------------------------ */
/* Category metadata                                                   */
/* ------------------------------------------------------------------ */

export type EditorCategory = "body" | "skin" | "hair" | "clothing";

export const EDITOR_CATEGORIES: ReadonlyArray<{
  id: EditorCategory;
  name: string;
}> = [
  { id: "body", name: "Body" },
  { id: "skin", name: "Skin" },
  { id: "hair", name: "Hair" },
  { id: "clothing", name: "Clothing" },
];

/**
 * Sanity hook for tests / future assets: every catalog id (except raw
 * palette hexes) must be an available manifest asset of the expected kind.
 */
export function catalogAssetKinds(): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (ids: readonly string[]) => {
    for (const id of ids) out[id] = available(id).kind;
  };
  put(BODY_OPTIONS.map((o) => o.id));
  put(SKIN_TONE_OPTIONS.map((o) => o.id));
  put(HAIR_STYLE_OPTIONS.map((o) => o.id));
  put(HAIR_COLOR_OPTIONS.map((o) => o.id));
  put(FACIAL_HAIR_OPTIONS.map((o) => o.id));
  put(FABRIC_OPTIONS.map((o) => o.id));
  for (const r of OUTFIT_ROWS) {
    put([r.topId, r.bottomId, r.shoeId]);
    if (r.outerwearId) put([r.outerwearId]);
  }
  return out;
}
