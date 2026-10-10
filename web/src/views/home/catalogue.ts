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

/* ============ M15 Buy-mode v2 tabs ============ */

/**
 * Buy-mode v2 tab ids. "design" hosts the wall/floor swatch groups;
 * the other five host furniture items.
 */
export type BuyTabId =
  | "design"
  | "sleep"
  | "kitchen"
  | "bath"
  | "comfort"
  | "decor";

export interface BuyTab {
  id: BuyTabId;
  emoji: string;
  label: string;
}

export const BUY_TABS: BuyTab[] = [
  { id: "design", emoji: "🎨", label: "Design" },
  { id: "sleep", emoji: "🛏️", label: "Sleep" },
  { id: "kitchen", emoji: "🍳", label: "Kitchen" },
  { id: "bath", emoji: "🛁", label: "Bath" },
  { id: "comfort", emoji: "🛋️", label: "Comfort" },
  { id: "decor", emoji: "🪴", label: "Decor" },
];

function fallbackBuyTab(entry: { id?: string }): RoomCategory | undefined {
  return CATALOG_FALLBACK[String(entry?.id ?? "").toLowerCase()]?.category;
}

/**
 * Map a catalog entry's category onto a buy-mode v2 tab.
 * The M14 sleep/kitchen/bath/comfort set keeps its tabs; extra server
 * categories fold in — fun/entertainment → comfort, light/pets/luxury/
 * skill/decor-ish → decor. Unknown categories → decor (never drops an item).
 */
export function buyTabFor(entry: {
  id?: string;
  category?: unknown;
}): BuyTabId {
  const c = String(entry?.category ?? "").toLowerCase().trim();
  if (!c) return fallbackBuyTab(entry) ?? "decor";
  if (
    /decor|decoration|ornament|plant|light|lamp|pet|luxury|rug|curtain|painting|poster|art|skill|statue|vase|flower|frame/.test(
      c
    )
  )
    return "decor";
  if (/fun|game|play|toy|music|entertain|sport/.test(c)) return "comfort";
  return normalizeCategory(c, fallbackBuyTab(entry));
}

/** Which buy tabs to render: design only when styles exist; item tabs only when non-empty. */
export function visibleBuyTabs(
  entries: Array<{ id?: string; category?: unknown }>,
  hasDesign: boolean
): BuyTab[] {
  const counts = new Map<BuyTabId, number>();
  for (const e of entries) {
    const t = buyTabFor(e);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return BUY_TABS.filter((t) => {
    if (t.id === "design") return hasDesign;
    return (counts.get(t.id) ?? 0) > 0;
  });
}

/** A wall/floor style entry (server `config.walls` / `config.floors`). */
export interface HomeStyleEntry {
  id: string;
  name: string;
  price: number;
  hex: string;
  desc?: string;
}

/** Normalize a raw wall/floor style entry defensively; null when unusable. */
export function normalizeStyleEntry(raw: unknown): HomeStyleEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  if (!id) return null;
  const hexRaw = String(r.hex ?? "").trim();
  const priceRaw = r.price;
  return {
    id,
    name: String(r.name ?? id),
    price:
      typeof priceRaw === "number" && Number.isFinite(priceRaw)
        ? Math.max(0, Math.floor(priceRaw))
        : 0,
    hex: validHex(hexRaw) ?? "#ffffff",
    desc: typeof r.desc === "string" ? r.desc : undefined,
  };
}

/** Canonical "#rrggbb" for a CSS hex string, or null when invalid. */
export function validHex(hex: unknown): string | null {
  const s = String(hex ?? "").trim();
  const m = s.match(/^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3)
    h = h
      .split("")
      .map((ch) => ch + ch)
      .join("");
  return `#${h.toLowerCase()}`;
}

/* ============ Item action rows (tap-a-placed-item dialog) ============ */

/** One tappable action row derived from a catalog item's effect. */
export interface ItemAction {
  act: "sleep" | "eat" | "fun";
  title: string;
  /** Effect label, e.g. "+20 Health". */
  hint: string;
}

const ACTION_DEFS: Array<{
  re: RegExp;
  act: "sleep" | "eat" | "fun";
  title: string;
  stat: string;
}> = [
  { re: /\bsleep\b|\brest\b/, act: "sleep", title: "😴 Sleep", stat: "Health" },
  {
    re: /\beat\b|\bfood\b|\bhunger\b|\bcook\b/,
    act: "eat",
    title: "🍽️ Eat",
    stat: "Hunger",
  },
  {
    re: /\bfun\b|\bplay\b|\bhappy\b|\bhappiness\b|\bentertain\b/,
    act: "fun",
    title: "🎮 Have fun",
    stat: "Happiness",
  },
];

/** Normalize an effect code for keyword matching ("sleep_health" → "sleep health"). */
function effectWords(code: string): string {
  return code.toLowerCase().replace(/[_-]+/g, " ");
}

/** "+N Stat" from an effect code carrying a number (e.g. "sleep_health20"). */
function effectBonus(code: string, stat: string): string {
  const m = code.match(/([+-]?\d+)/);
  return m ? `+${m[1].replace(/^\+/, "")} ${stat}` : `+${stat}`;
}

/**
 * Action rows for a catalog entry, derived from its server effect code
 * (e.g. "sleep_health"). Falls back to the use-act table when the code
 * carries no recognized keyword. Empty for pure decor.
 */
export function itemActionsFor(
  entry: { id?: string; effect?: unknown },
  useAct: "sleep" | "eat" | "fun" | null
): ItemAction[] {
  const code = effectWords(String(entry?.effect ?? ""));
  const rows: ItemAction[] = [];
  for (const d of ACTION_DEFS) {
    if (d.re.test(code) && !rows.some((r) => r.act === d.act)) {
      rows.push({ act: d.act, title: d.title, hint: effectBonus(code, d.stat) });
    }
  }
  if (rows.length === 0 && useAct) {
    const d = ACTION_DEFS.find((x) => x.act === useAct);
    if (d) rows.push({ act: d.act, title: d.title, hint: `+${d.stat}` });
  }
  return rows;
}

/** True when the item's effect works automatically each day (no tap needed). */
export function isDailyEffect(entry: {
  effect?: unknown;
  desc?: unknown;
}): boolean {
  const s = effectWords(`${entry?.effect ?? ""} ${entry?.desc ?? ""}`);
  return /\bdaily\b|every day|per day|\/\s*day\b/.test(s);
}
