/**
 * M14 client-side catalog fallback for the 16 home-room items.
 *
 * The server catalog (`config.furniture`) is the source of truth for names,
 * prices, icons, categories, and sizes. This table only fills gaps: if the
 * server hasn't shipped `category`/`size` metadata yet, the room still
 * renders with sensible footprints and buy-mode tabs.
 */
import {
  parseSize,
  normalizeCategory,
  type Footprint,
  type RoomCategory,
  type SizeSpec,
} from "./roomGrid";

export interface CatalogFallback {
  size: Footprint;
  category: RoomCategory;
}

export const CATALOG_FALLBACK: Record<string, CatalogFallback> = {
  bed: { size: [2, 2], category: "sleep" },
  mattress: { size: [2, 1], category: "sleep" },
  ac: { size: [1, 1], category: "sleep" },
  fridge: { size: [1, 1], category: "kitchen" },
  stove: { size: [1, 1], category: "kitchen" },
  cooler: { size: [1, 1], category: "kitchen" },
  dining_table: { size: [2, 1], category: "kitchen" },
  drum: { size: [1, 1], category: "bath" },
  mirror: { size: [1, 1], category: "bath" },
  tv: { size: [1, 1], category: "comfort" },
  sofa: { size: [2, 1], category: "comfort" },
  plastic_chair: { size: [1, 1], category: "comfort" },
  fan: { size: [1, 1], category: "comfort" },
  beanbag: { size: [1, 1], category: "comfort" },
  bookshelf: { size: [2, 1], category: "comfort" },
  gen: { size: [1, 1], category: "comfort" },
};

/** The 16 catalog item ids the room knows how to model. */
export const CATALOG_IDS: string[] = Object.keys(CATALOG_FALLBACK);

/** Footprint for a catalog entry: server size wins, fallback table fills gaps. */
export function roomSizeFor(entry: {
  id?: string;
  size?: SizeSpec;
}): Footprint {
  const fb = CATALOG_FALLBACK[String(entry?.id ?? "").toLowerCase()];
  return parseSize(entry?.size, fb?.size ?? [1, 1]);
}

/** Buy-mode tab for a catalog entry: server category wins, fallback fills gaps. */
export function roomCategoryFor(entry: {
  id?: string;
  category?: unknown;
}): RoomCategory {
  const fb = CATALOG_FALLBACK[String(entry?.id ?? "").toLowerCase()];
  return normalizeCategory(entry?.category, fb?.category);
}
