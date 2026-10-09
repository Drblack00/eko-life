/**
 * Shared Èkó Life game types (client side).
 * Wire shapes follow docs/API_SPEC.md — the server is authoritative;
 * the client only displays what the server sends.
 */

/** Authoritative character snapshot pushed by the server (`init` / `you`). */
export interface You {
  id: number;
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
  | "loan"
  | "repay"
  | "bank"
  | "collect"
  | "run"
  | "vote"
  | "gov_broadcast";

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
}

/** Format integer naira with ₦. Never compute money — display only. */
export function naira(n: number): string {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return `₦${v.toLocaleString("en-NG")}`;
}
