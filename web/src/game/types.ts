/**
 * Shared Èkó Life game types (client side).
 * Wire shapes follow docs/API_SPEC.md — the server is authoritative;
 * the client only displays what the server sends.
 */

/** Authoritative character snapshot pushed by the server (`init` / `you`). */
export interface You {
  id: number;
  /** Character row id (server youSnapshot/characterBody; for /api/characters/:id/appearance). */
  character_id?: number;
  username: string;
  name: string;
  class: string;
  avatar: string;
  color: string;
  money: number;
  energy: number;
  health: number;
  happiness: number;
  hunger: number;
  housing: string;
  /** Owned property / vehicle / business — string id on M2, richer refs on M3. */
  property: NamedRef | null;
  vehicle: NamedRef | null;
  /** M3: owned business (string id or rich ref). */
  biz?: NamedRef | null;
  savings: number;
  loan: number;
  cert: number;
  /** M3: owned furniture instances. */
  furniture?: FurnitureEntry[] | null;
  /** M3: one-time starter loan still claimable. */
  starter_loan_available?: boolean;
  locationId: string;
  lat: number;
  lng: number;
  x?: number;
  y?: number;
  is_admin: boolean;
  guest: boolean;
  /** Character panel: masked account email (null when the account has none). */
  email_masked?: string | null;
  /* ---------------- V2 ---------------- */
  /** M8: six needs (hunger is legacy). */
  fun?: number;
  social?: number;
  hygiene?: number;
  bladder?: number;
  /** M8: active moodlets (pushed on the decay tick). */
  moodlets?: Array<{ key: string; label: string; effects?: unknown; expires_at?: number }>;
  /** M9: perk stars + owned perk ids. */
  perk_stars?: number;
  perks?: string[];
  /** M10: rent-to-own flag. */
  housing_owned?: boolean;
  /** M7: active shift (null when not clocked in). */
  shift?: { job: string; name: string; trackId?: string | null; startedAt?: number | null; endsAt: number; secondsLeft: number } | null;
  /** M12: skills + academy progress (merged by the coordinator). */
  skills?: Record<string, { level: number; xp: number }>;
  academy?: { lessonsToday?: number; certs?: string[] } | null;
  /** M15: staged 3D avatar look (server contract: character.avatar_look). */
  avatar_look?: AvatarLook | null;
  /** M15: purchased wall/floor style ids (server contract: character.home_wall/home_floor). */
  home_wall?: string | null;
  home_floor?: string | null;
}

/** A server-side named reference — either a bare id or an expanded object. */
export type NamedRef = string | { id?: string; name?: string } | null;

/** One owned furniture instance (M3 `you.furniture[]`). */
export interface FurnitureEntry {
  /** Instance id (numeric from the server). */
  id?: string | number;
  /** Catalog item id (server may send `item`, `itemId`, or reuse `id`). */
  item?: string;
  itemId?: string;
  name?: string;
  icon?: string;
  effect?: string;
  placed?: boolean;
  /** M14 grid placement: cell coords 0..5 on the 6×6 home room grid. */
  x?: number | null;
  z?: number | null;
  /** Quarter-turns clockwise; odd rotations swap the w/d footprint. */
  rot?: 0 | 1 | 2 | 3 | null;
}

/** A street-find spawn from the server (`spawn {s}` / `despawn {id}`).
 *  Coordinates are 0..100 map coords; the M3 server sends `x`/`y`
 *  (same convention as locations), `lat`/`lng` is the legacy fallback. */
export interface StreetSpawn {
  id: string | number;
  kind?: string;
  lat?: number;
  lng?: number;
  x?: number;
  y?: number;
  amount?: number;
  label?: string;
  icon?: string;
}

/** Map coords (0..100) of a spawn, tolerating both server shapes. */
export function spawnMapXY(s: StreetSpawn): { mx: number; my: number } | null {
  const mx = typeof s.x === "number" ? s.x : typeof s.lng === "number" ? s.lng : NaN;
  const my = typeof s.y === "number" ? s.y : typeof s.lat === "number" ? s.lat : NaN;
  if (!Number.isFinite(mx) || !Number.isFinite(my)) return null;
  return { mx, my };
}

/** Defensive name for a NamedRef (id / object / null / missing). */
export function refName(ref: NamedRef | undefined, fallback = "—"): string {
  if (ref == null) return fallback;
  if (typeof ref === "string") return ref || fallback;
  return ref.name || ref.id || fallback;
}

/** Bare id for a NamedRef (used to match catalog entries). */
export function refId(ref: NamedRef | undefined): string | null {
  if (ref == null) return null;
  if (typeof ref === "string") return ref || null;
  return ref.id ?? null;
}

/** Emoji for a street-find spawn by kind (server-validated; display only). */
export function spawnEmoji(s: StreetSpawn): string {
  if (s.icon) return s.icon;
  const k = String(s.kind ?? "").toLowerCase();
  if (k.includes("food") || k.includes("meal")) return "🍲";
  if (k.includes("drink") || k.includes("soda") || k.includes("water")) return "🥤";
  return "💵";
}

/** Label for a street-find spawn (display only). */
export function spawnLabel(s: StreetSpawn): string {
  if (s.label) return s.label;
  const k = String(s.kind ?? "").toLowerCase();
  if (k.includes("snack") || k.includes("food") || k.includes("meal")) return "Free snack!";
  if (k.includes("energy") || k.includes("drink") || k.includes("soda") || k.includes("water"))
    return "Free energy drink!";
  return s.amount ? `₦${Number(s.amount).toLocaleString("en-NG")} on the ground!` : "Cash on the ground!";
}

/** Catalog id / instance id for a furniture entry (server shapes vary). */
export function furnitureItemId(f: FurnitureEntry): string {
  return String(f.item ?? f.itemId ?? f.id ?? "");
}

/** Instance key for a furniture entry (prefers instance `id`). */
export function furnitureKey(f: FurnitureEntry): string {
  return String(f.id ?? f.item ?? f.itemId ?? "");
}

/** Presence-lite record for another player on the map. */
export interface PlayerLite {
  id: number;
  name: string;
  lat: number;
  lng: number;
  avatar: string;
  color: string;
}

export interface ChatEntry {
  id: number | string;
  /** Sender player id (null when the server doesn't name one). */
  senderId?: number | null;
  name: string;
  text: string;
  ts: number;
  /** Server-flagged governor message (`gov:true`) — renders the 👑 badge. */
  gov?: boolean;
}

/* ------------------------------------------------------------------ */
/* M5 — social + elections (contract: task brief + docs/API_SPEC.md).  */
/* The server is authoritative; shapes are parsed defensively.         */
/* ------------------------------------------------------------------ */

/** Election state (`{t:'election'}`). */
export interface ElectionState {
  /** Is a race currently open. */
  active: boolean;
  /** Candidates: server may send ids and/or usernames. */
  candidates: ElectionCandidate[];
  /** Have I already voted in this race. */
  voted: boolean;
  /** Am I running in this race. */
  running: boolean;
  /** Game days left in the race. */
  endsInDays?: number;
  /** M11: the sitting governor's signed policy (if any). */
  policy?: { id: string; name: string; desc: string; effectLine?: string } | null;
  /** M11: pickable policies for the PolicyPicker. */
  pickablePolicies?: Array<{ id: string; name: string; desc: string; icon: string }>;
  /** M11: the governor's cabinet. */
  commissioners?: Array<{ title: string; icon: string; holder: string | null }>;
  /** M11: whether the 48h policy-pick window is still open. */
  policyWindowOpen?: boolean;
}

export interface ElectionCandidate {
  id: number;
  name: string;
  votes?: number;
}

/** Governor announcement (`{t:'gov'}`). */
export interface GovernorInfo {
  id?: number | null;
  name: string | null;
}

/** One friend record (`{t:'friends'}`). */
export interface FriendEntry {
  id: number;
  username: string;
  name?: string;
  online?: boolean;
}

/** Incoming friend request (`{t:'friend_request'}`). */
export interface FriendRequest {
  id: number;
  username: string;
  name?: string;
  ts?: number;
}

/** A topic room (`{t:'rooms'}`). */
export interface RoomEntry {
  id: string | number;
  name: string;
  topic?: string;
  icon?: string;
  members?: number;
  ownerId?: number | null;
  unread?: number;
  /** Whether I have joined this room (server `roomListFor`). */
  joined?: boolean;
}

/** A member of a room (`{t:'room_members'}`). */
export interface RoomMember {
  id: number;
  username: string;
  name?: string;
  online?: boolean;
  muted?: boolean;
  isOwner?: boolean;
}

/** One room message (`{t:'room_msg'}`). */
export interface RoomMessage {
  id: number | string;
  roomId: string | number;
  senderId?: number | null;
  name: string;
  text: string;
  ts: number;
  /** Server-flagged governor message — renders the 👑 badge. */
  gov?: boolean;
}

/** A DM thread row (`{t:'dm_threads'}`). */
export interface DmThread {
  id: number;
  username: string;
  name?: string;
  lastText?: string;
  lastTs?: number;
  unread?: number;
}

/** One DM (`{t:'dm'}` / `{t:'dm_history'}`). */
export interface DmMessage {
  id: number | string;
  /** Who this is with (the other side of the thread). */
  with: number;
  /** Sender player id. */
  fromId: number;
  fromName: string;
  text: string;
  ts: number;
  /** Did I send this. */
  mine: boolean;
}

/** Landing presence dot (`GET /api/presence`, public, capped). */
export interface PresenceEntry {
  id: number;
  username: string;
  x: number;
  y: number;
  avatar?: string;
  color?: string;
}

/** Public news ticker item (`GET /api/news`). */
export interface NewsItem {
  id?: string | number;
  text: string;
  ts?: number;
}

/** Leaderboard row (`GET /api/leaderboard`). */
export interface LeaderEntry {
  id?: number;
  username: string;
  money: number;
}

/** Gameplay intents the client may send as `{ t:"act", a, ...params }`. */
export type ActName =
  | "work"
  | "eat"
  | "fun"
  | "sleep"
  | "rest"
  | "travel"
  | "study"
  | "rent"
  | "buy_property"
  | "buy_biz"
  | "buy_vehicle"
  | "buy_furniture"
  | "place_furniture"
  | "sell_furniture"
  | "buy_home_style"
  | "save_avatar"
  | "loan"
  | "repay"
  | "bank"
  | "collect"
  | "run"
  | "vote"
  | "gov_broadcast"
  /* ---------------- V2 ---------------- */
  | "shift_start"
  | "shift_leave"
  | "shift_status"
  | "moodlet_list"
  | "hunt_claim"
  | "hunt_status"
  | "hustle_status"
  | "hustle_claim"
  | "perk_list"
  | "perk_buy"
  | "shop_create"
  | "shop_stock"
  | "shop_buy"
  | "shop_rate"
  | "shop_browse"
  | "shop_mine"
  | "buy_rental"
  | "lapo_borrow"
  | "lapo_status"
  | "lapo_repay"
  | "lapo_repay_all"
  | "gov_policy"
  | "gov_appoint"
  | "gov_dismiss"
  | "skill_train"
  | "academy_lesson"
  | "academy_quiz"
  /* ---------------- Phase 5: venue activities ---------------- */
  | "venue_activity";

/** Server → client message envelope (only fields we route). */
export interface ServerMsg {
  t: string;
  you?: You;
  note?: string;
  text?: string;
  day?: number;
  endsIn?: number;
  online?: number;
  players?: PlayerLite[];
  chat?: ChatEntry[];
  config?: Record<string, unknown>;
  election?: unknown;
  /** `init` sends `{id,name} | null`; the API_SPEC string shape is the fallback. */
  governor?: string | { id?: number; name?: string } | null;
  visits?: number;
  /** Total unread DMs (`init` + `{t:'dm_unread', n}`). */
  unreadDm?: number;
  p?: PlayerLite;
  id?: number;
  name?: string;
  lat?: number;
  lng?: number;
  avatar?: string;
  color?: string;
  ts?: number;
  /** Street-find spawn payload (`spawn {s}`) / despawn id (`despawn {id}`). */
  s?: StreetSpawn;
  /** `despawn` may carry the id here. */
  spawnId?: string | number;
  /* --- M5 extras (defensively parsed; see hooks/useGameSocket.ts) --- */
  /** friends / rooms / dm_threads payloads (array, various shapes). */
  friends?: unknown;
  friend_request?: unknown;
  from?: { id?: number; username?: string; name?: string } | number | string;
  rooms?: unknown;
  room?: unknown;
  roomId?: string | number;
  room_members?: unknown;
  room_unread?: unknown;
  dm_threads?: unknown;
  dm_history?: unknown;
  dm?: unknown;
  dm_sent?: unknown;
  dm_unread?: unknown;
  to?: number | string;
  with?: { id?: number; username?: string } | number | string;
  /** Candidate payloads for elections. */
  candidates?: unknown;
  candidate?: number | string;
  votes?: number;
  voted?: boolean;
  running?: boolean;
  endsInDays?: number;
  active?: boolean;
  unread?: number;
  n?: number;
  textMsg?: unknown;
  /** DM payload aliases (server snake_case). */
  fromName?: string;
  from_id?: number;
  /** Server governor flag on chat / room messages. */
  gov?: boolean;
  /** room_joined history / dm_history payloads (server shapes). */
  history?: unknown;
  msgs?: unknown;
  withName?: string;
  /** Server block list push (`{t:'blocks', blocks:[{blocked_id,username}]}`). */
  blocks?: unknown;
  /** mention location ('city' | 'room:<id>'). */
  where?: string;
  roomName?: string;
  /** Sender id aliases used by social messages. */
  playerId?: number;
  senderId?: number;
  sender?: unknown;
  isGov?: boolean;
  members?: unknown;
  username?: string;
  /** M21: live notification payload (`{t:'notification:new', notification}`). */
  notification?: unknown;
}

/* ------------------------------------------------------------------ */
/* M21 — notifications (in-app; web-push hook comes later).             */
/* ------------------------------------------------------------------ */

/** Notification type ids (server source of truth). */
export type NotificationType = "friend_online" | "room_message" | "money_received";

/** One notification row. */
export interface NotificationEntry {
  id: number;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  read: boolean;
  created_at: number;
}

/** Per-user notification toggles (all default true). */
export interface NotificationPrefs {
  friend_online: boolean;
  room_message: boolean;
  money_received: boolean;
}

export const NOTIFICATION_PREF_LABELS: Record<keyof NotificationPrefs, { title: string; hint: string }> = {
  friend_online: { title: "Friend online", hint: "When a friend comes online" },
  room_message: { title: "Room messages", hint: "New messages in rooms you joined" },
  money_received: { title: "Coins received", hint: "When someone sends you coins" },
};

/** Defensive parse of a server notification payload. */
export function normalizeNotification(p: unknown): NotificationEntry | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  const id = Number(o.id);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    type: typeof o.type === "string" ? o.type : "unknown",
    title: typeof o.title === "string" ? o.title : "Notification",
    body: typeof o.body === "string" ? o.body : null,
    data: o.data && typeof o.data === "object" ? (o.data as Record<string, unknown>) : null,
    read: o.read === true || o.read === 1,
    created_at: Number(o.created_at) || Date.now(),
  };
}

/** Icon per notification type. */
export function notificationIcon(type: string): string {
  switch (type) {
    case "friend_online": return "🟢";
    case "room_message": return "💬";
    case "money_received": return "💰";
    default: return "🔔";
  }
}

/** Format integer naira with ₦. Never compute money — display only. */
export function naira(n: number): string {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return `₦${v.toLocaleString("en-NG")}`;
}

/* ------------------------------------------------------------------ */
/* M15 — avatar studio (contract: task brief; server implements it).    */
/* character.avatar_look = {body,skin,hair,outfit,fabric,topColor,      */
/* bottomColor}; /api/config exposes avatarLook with the option lists. */
/* ------------------------------------------------------------------ */

/** The staged 3D avatar look — the payload shape sent to `save_avatar`. */
export interface AvatarLook {
  body: "woman" | "man";
  /** Skin tone option id (or a #hex; the 3D builder tolerates both). */
  skin: string;
  /** Hairstyle option id. */
  hair: string;
  /** Outfit option id. */
  outfit: string;
  /** Fabric option id (`plain` = solid, others = canvas pattern). */
  fabric: string;
  /** Top garment colour (#rrggbb). */
  topColor: string;
  /** Bottom garment colour (#rrggbb). */
  bottomColor: string;
}

export interface AvatarBodyOption {
  id: string;
  name: string;
}

export interface AvatarSkinOption {
  id: string;
  name: string;
  hex: string;
}

export interface AvatarNamedOption {
  id: string;
  name: string;
}

/** Option lists from `/api/config` → `avatarLook` (all original content). */
export interface AvatarLookOptions {
  bodies: AvatarBodyOption[];
  skins: AvatarSkinOption[];
  hairs: AvatarNamedOption[];
  outfits: AvatarNamedOption[];
  fabrics: AvatarNamedOption[];
  topColors: string[];
  bottomColors: string[];
  defaults: AvatarLook;
}

/** Client-safe defaults used when the server hasn't sent its option lists. */
export const AVATAR_LOOK_DEFAULTS: AvatarLook = {
  body: "woman",
  skin: "cocoa",
  hair: "lowcut",
  outfit: "casual",
  fabric: "plain",
  topColor: "#22d3ee",
  bottomColor: "#334155",
};

/** Local fallback option lists (used until /api/config serves avatarLook).
 *  Ids mirror the server allowlists exactly so fallback saves also validate. */
export const AVATAR_LOOK_FALLBACK_OPTIONS: AvatarLookOptions = {
  bodies: [
    { id: "woman", name: "Woman" },
    { id: "man", name: "Man" },
  ],
  skins: [
    { id: "deep_espresso", name: "Deep Espresso", hex: "#3b2314" },
    { id: "dark_cocoa", name: "Dark Cocoa", hex: "#4a2c17" },
    { id: "burnt_caramel", name: "Burnt Caramel", hex: "#5d3a1f" },
    { id: "mahogany", name: "Mahogany", hex: "#6f4426" },
    { id: "walnut", name: "Walnut", hex: "#7d5330" },
    { id: "cocoa", name: "Cocoa", hex: "#8a5f38" },
    { id: "coffee", name: "Coffee", hex: "#9a6f45" },
    { id: "latte", name: "Latte", hex: "#ab8054" },
    { id: "honey", name: "Honey", hex: "#bc9066" },
    { id: "sand", name: "Sand", hex: "#cda077" },
    { id: "amber", name: "Amber", hex: "#dcb07e" },
    { id: "cream", name: "Cream", hex: "#e8cfa3" },
  ],
  hairs: [
    { id: "lowcut", name: "Low cut" },
    { id: "bald", name: "Bald" },
    { id: "curls", name: "Curls" },
    { id: "afro", name: "Afro" },
    { id: "locs", name: "Locs" },
    { id: "braids", name: "Braids" },
    { id: "classic", name: "Classic" },
  ],
  outfits: [
    { id: "casual", name: "Casual" },
    { id: "hoodie", name: "Hoodie" },
    { id: "office", name: "Office" },
    { id: "chill", name: "Chill" },
    { id: "sitework", name: "Site work" },
  ],
  fabrics: [
    { id: "plain", name: "Plain" },
    { id: "ankara", name: "Ankara" },
    { id: "adire", name: "Adire" },
    { id: "asoke", name: "Aso-oke" },
  ],
  topColors: [
    "#22d3ee", "#f472b6", "#a3e635", "#fbbf24", "#c084fc",
    "#fb7185", "#34d399", "#60a5fa", "#ef4444", "#fb923c",
  ],
  bottomColors: [
    "#334155", "#111827", "#f8fafc", "#1e3a8a", "#64748b",
    "#78350f", "#14532d", "#7c2d12", "#831843", "#3b0764",
  ],
  defaults: AVATAR_LOOK_DEFAULTS,
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function pickId(
  value: unknown,
  allowed: readonly string[] | undefined,
  fallback: string
): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) return fallback;
  if (allowed && allowed.length > 0 && !allowed.includes(v)) return fallback;
  return v;
}

function pickBody(value: unknown, opts: Partial<AvatarLookOptions> | undefined): "woman" | "man" {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  const allowed = opts?.bodies?.length
    ? opts.bodies.map((b) => b.id)
    : ["woman", "man"];
  if (v === "man" && allowed.includes("man")) return "man";
  if (v === "woman" && allowed.includes("woman")) return "woman";
  return opts?.defaults?.body === "man" ? "man" : "woman";
}

/** Colour pick: must be a valid #hex; when a list is given it must be on it. */
function pickColor(
  value: unknown,
  allowed: readonly string[] | undefined,
  fallback: string
): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!HEX_RE.test(v)) return fallback;
  if (allowed && allowed.length > 0) {
    const hit = allowed.find((c) => c.toLowerCase() === v.toLowerCase());
    return hit ?? fallback;
  }
  return v;
}

/**
 * Coerce/validate a raw avatar look against the option lists, falling back
 * to the defaults field-by-field. Never throws; unknown junk → defaults.
 */
export function sanitizeAvatarLook(
  raw: unknown,
  opts?: Partial<AvatarLookOptions>
): AvatarLook {
  const r =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = opts?.defaults ?? AVATAR_LOOK_DEFAULTS;
  const ids = (list: { id: string }[] | undefined) =>
    list && list.length > 0 ? list.map((o) => o.id) : undefined;
  return {
    body: pickBody(r.body, opts),
    skin: pickId(r.skin, ids(opts?.skins), d.skin),
    hair: pickId(r.hair, ids(opts?.hairs), d.hair),
    outfit: pickId(r.outfit, ids(opts?.outfits), d.outfit),
    fabric: pickId(r.fabric, ids(opts?.fabrics), d.fabric),
    topColor: pickColor(r.topColor, opts?.topColors, d.topColor),
    bottomColor: pickColor(r.bottomColor, opts?.bottomColors, d.bottomColor),
  };
}
