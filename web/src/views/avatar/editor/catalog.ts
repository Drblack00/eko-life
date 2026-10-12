/**
 * Èkó Life avatar studio — honest UI catalog (Milestone 5, expanded M8).
 *
 * Every control in the rebuilt studio is generated from this module, and
 * every entry here maps 1:1 to a manifest asset (or palette colour) the
 * assembler actually honors TODAY. Nothing in this catalog is aspirational:
 *
 * - Face: 4 eye colours + 4 brow styles — real (assembler honors both).
 * - Body: woman/man — real (structural change, assembler rebuilds).
 * - Skin: 18 tones — real (assembler recolors materials in place).
 * - Hair: 13 styles + 6 colours + 4 facial-hair options — real
 *   (assembler swaps the hair / facial-hair groups).
 * - Extras: 3 accessories (cap, shades, hoops) — real (assembler swaps
 *   the accessory groups; parts/accessories.ts).
 * - Outfit: 8 OUTFIT cards + 4 fabrics + top/bottom colours — real.
 *   The pipeline is outfit-based (assembler inverts the decomposition
 *   table to recover the OutfitId), so the cards below carry the EXACT
 *   decomposed rows. Picking a card can never render a different outfit
 *   — see the honesty test in catalog.test.ts (each row must resolve via
 *   assembler.outfitIdForClothing with zero fallback notes).
 *   Shoes are outfit-implied, so there is deliberately NO separate shoe
 *   picker.
 *
 * Deliberately OMITTED (documented, not shipped as dead controls):
 * - Face morph sliders: all 9 schema morphs are STUBBED in the assembler
 *   (MORPH_SUPPORT: every entry "stubbed") and only face_default_01
 *   exists in the manifest. A slider would move nothing on screen.
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
  AccessorySlot,
  AppearanceV1,
  BodyPresetId,
  BodyType,
  BrowStyleId,
  ClothingBottomId,
  ClothingTopId,
  EyeColorId,
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
  /** M8: 8 outfits (legacy 5 + gym/agbada/owambe). */
  outfitId:
    | "casual"
    | "hoodie"
    | "office"
    | "chill"
    | "sitework"
    | "gym"
    | "agbada"
    | "owambe";
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
  "onyx",
  "deep_espresso",
  "dark_cocoa",
  "truffle",
  "burnt_caramel",
  "mahogany",
  "walnut",
  "sienna",
  "cocoa",
  "coffee",
  "caramel",
  "latte",
  "honey",
  "sand",
  "butterscotch",
  "amber",
  "cream",
  "ivory",
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
  hair_bun_01: "Top bun",
  hair_ponytail_01: "Ponytail",
  hair_mohawk_01: "Mohawk",
  hair_bantu_knots_01: "Bantu knots",
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
  hair_auburn_01: "Auburn",
  hair_blonde_01: "Blonde",
  hair_grey_01: "Grey",
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
/* Face — eye colours + brow styles (M8, both HONORED by the builder)  */
/* ------------------------------------------------------------------ */

const EYE_COLOR_LABELS: Readonly<Record<EyeColorId, string>> = {
  eye_brown_01: "Brown",
  eye_hazel_01: "Hazel",
  eye_amber_01: "Amber",
  eye_green_01: "Green",
};

/** Swatch hexes: the "base" tone of each IRIS_PALETTES entry. */
const EYE_COLOR_HEX: Readonly<Record<EyeColorId, string>> = {
  eye_brown_01: "#4a2c12",
  eye_hazel_01: "#6e4a20",
  eye_amber_01: "#8c6228",
  eye_green_01: "#4a5828",
};

export const EYE_COLOR_OPTIONS: readonly SwatchOption[] = (
  Object.keys(EYE_COLOR_LABELS) as EyeColorId[]
).map((id) => {
  available(id);
  return { id, name: EYE_COLOR_LABELS[id], hex: EYE_COLOR_HEX[id] };
});

const BROW_STYLE_LABELS: Readonly<Record<BrowStyleId, string>> = {
  brow_natural_01: "Natural",
  brow_bold_01: "Bold",
  brow_arched_01: "Arched",
  brow_trimmed_01: "Trimmed",
};

export const BROW_STYLE_OPTIONS: readonly CatalogOption[] = (
  Object.keys(BROW_STYLE_LABELS) as BrowStyleId[]
).map((id) => {
  available(id);
  return { id, name: BROW_STYLE_LABELS[id] };
});

/* ------------------------------------------------------------------ */
/* Accessories — one pick per slot (M8, parts/accessories.ts)          */
/* ------------------------------------------------------------------ */

export interface AccessorySlotOption {
  slot: AccessorySlot;
  name: string;
  options: readonly CatalogOption[];
}

const ACCESSORY_LABELS: Readonly<Record<string, string>> = {
  none: "None",
  acc_glasses_01: "Shades",
  acc_cap_01: "Snapback cap",
  acc_earrings_01: "Hoop earrings",
};

export const ACCESSORY_SLOT_OPTIONS: readonly AccessorySlotOption[] = [
  {
    slot: "head",
    name: "Head",
    options: [{ id: "none", name: "None" }, { id: "acc_cap_01", name: ACCESSORY_LABELS.acc_cap_01 }],
  },
  {
    slot: "face",
    name: "Face",
    options: [{ id: "none", name: "None" }, { id: "acc_glasses_01", name: ACCESSORY_LABELS.acc_glasses_01 }],
  },
  {
    slot: "ears",
    name: "Ears",
    options: [{ id: "none", name: "None" }, { id: "acc_earrings_01", name: ACCESSORY_LABELS.acc_earrings_01 }],
  },
];

// Validate at module load: every real accessory id is an available
// kind-"accessory" manifest asset.
for (const slot of ACCESSORY_SLOT_OPTIONS) {
  for (const o of slot.options) {
    if (o.id === "none") continue;
    const asset = available(o.id);
    if (asset.kind !== "accessory" || !asset.slots.includes(slot.slot)) {
      throw new Error(`catalog: accessory "${o.id}" is not a ${slot.slot}-slot accessory`);
    }
  }
}

/** Current asset id for a slot ("none" when empty). */
export function accessoryIdForSlot(
  accessories: AppearanceV1["accessories"],
  slot: AccessorySlot
): string {
  return accessories.find((a) => a.slot === slot)?.assetId ?? "none";
}

/** Set (or clear with "none") the accessory for one slot. */
export function setAccessorySlot(
  draft: AppearanceV1,
  slot: AccessorySlot,
  id: string
): AppearanceV1 {
  const rest = draft.accessories.filter((a) => a.slot !== slot);
  if (id === "none") return { ...draft, accessories: rest };
  return { ...draft, accessories: [...rest, { slot, assetId: id }] };
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
  {
    outfitId: "gym",
    name: "Gym",
    caption: "Tank · shorts · sneakers",
    topId: "top_tank_01",
    bottomId: "bottom_short_01",
    outerwearId: null,
    shoeId: "shoe_sneaker_01",
  },
  {
    outfitId: "agbada",
    name: "Agbada",
    caption: "Flowing agbada · trousers · sandals",
    topId: "top_agbada_01",
    bottomId: "bottom_trouser_01",
    outerwearId: null,
    shoeId: "shoe_sandal_01",
  },
  {
    outfitId: "owambe",
    name: "Owambe",
    caption: "Party dress · wrapper skirt · heels",
    topId: "top_dress_01",
    bottomId: "bottom_skirt_01",
    outerwearId: null,
    shoeId: "shoe_heel_01",
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

export type EditorCategory =
  | "face"
  | "body"
  | "skin"
  | "hair"
  | "accessories"
  | "clothing";

export const EDITOR_CATEGORIES: ReadonlyArray<{
  id: EditorCategory;
  name: string;
}> = [
  { id: "face", name: "Face" },
  { id: "body", name: "Body" },
  { id: "skin", name: "Skin" },
  { id: "hair", name: "Hair" },
  { id: "accessories", name: "Extras" },
  { id: "clothing", name: "Outfit" },
];

/**
 * Sanity hook for tests / future assets: every catalog id (except raw
 * palette hexes and the "none" accessory placeholder) must be an
 * available manifest asset of the expected kind.
 */
export function catalogAssetKinds(): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (ids: readonly string[]) => {
    for (const id of ids) out[id] = available(id).kind;
  };
  put(BODY_OPTIONS.map((o) => o.id));
  put(SKIN_TONE_OPTIONS.map((o) => o.id));
  put(EYE_COLOR_OPTIONS.map((o) => o.id));
  put(BROW_STYLE_OPTIONS.map((o) => o.id));
  put(HAIR_STYLE_OPTIONS.map((o) => o.id));
  put(HAIR_COLOR_OPTIONS.map((o) => o.id));
  put(FACIAL_HAIR_OPTIONS.map((o) => o.id));
  put(FABRIC_OPTIONS.map((o) => o.id));
  for (const r of OUTFIT_ROWS) {
    put([r.topId, r.bottomId, r.shoeId]);
    if (r.outerwearId) put([r.outerwearId]);
  }
  for (const slot of ACCESSORY_SLOT_OPTIONS) {
    put(slot.options.map((o) => o.id).filter((id) => id !== "none"));
  }
  return out;
}
