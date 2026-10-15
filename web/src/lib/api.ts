import type {
  AvatarLook,
  AvatarLookOptions,
  LeaderEntry,
  NewsItem,
  NotificationEntry,
  NotificationPrefs,
  PresenceEntry,
} from "../game/types";

/** Thin fetch wrapper against the same-origin Èkó Life API (see docs/API_SPEC.md). */

export interface ApiLocation {
  id: string;
  name: string;
  zone?: string;
  region?: string;
  emoji?: string;
  icon?: string;
  blurb?: string;
  desc?: string;
  /** M3: gameplay tags, e.g. "market", "campus", "bank", "housing_office", "beach", "club". */
  tags?: string[];
  /** M3: travel fare in naira (optional). */
  fare?: number;
  lat?: number;
  lng?: number;
  x?: number;
  y?: number;
  z?: number;
}

export interface ClassInfo {
  id: string;
  name: string;
  icon: string;
  tagline: string;
  startMoney: number;
  housing: string;
  happinessBonus: number;
  payMult: number;
  starterLoan: number;
  perks: string[];
}

export interface JobInfo {
  id: string;
  name: string;
  locationId: string;
  /** M3 career path group: "Market" | "Transport" | "Campus" | "Corporate" (server-defined). */
  path?: string;
  pay: number;
  energyCost: number;
  cooldownSec: number;
  certRequired?: boolean;
  icon: string;
}

export interface FoodInfo {
  id: string;
  name: string;
  cost: number;
  hunger: number;
  energy: number;
  happy: number;
  icon: string;
}

export interface FunInfo {
  id: string;
  name: string;
  cost: number;
  happy: number;
  energyDelta: number;
  locationId: string;
  icon: string;
}

export interface HousingInfo {
  id: string;
  name: string;
  rent: number;
  icon: string;
}

/** M3 catalog entries — all prices/names come from /api/config (or WS init).
 *  Field names tolerate both the task-brief shapes (price/speedMult) and the
 *  live server shapes (cost/mult); use priceOf()/speedOf() below. */
export interface PropertyInfo {
  id: string;
  name: string;
  price: number;
  /** Daily income the property pays (0 = none). */
  incomeDaily?: number;
  income?: number;
  /** Happiness bonus from owning (server PROPERTIES shape). */
  happy?: number;
  icon?: string;
  desc?: string;
}

export interface BusinessInfo {
  id: string;
  name: string;
  price?: number;
  /** Server BIZ shape uses `cost`. */
  cost?: number;
  /** Daily income the business pays. */
  dailyIncome?: number;
  income?: number;
  icon?: string;
  desc?: string;
}

export interface VehicleInfo {
  id: string;
  name: string;
  price?: number;
  /** Server VEHICLES shape uses `cost`. */
  cost?: number;
  /** Travel speed multiplier (1 = normal). */
  speedMult?: number;
  speed?: number;
  /** Server VEHICLES shape uses `mult`. */
  mult?: number;
  icon?: string;
  desc?: string;
}

export interface FurnitureInfo {
  id: string;
  name: string;
  price: number;
  /** Server effect code (e.g. "sleep_health"); `desc` is the human text. */
  effect?: string;
  desc?: string;
  icon?: string;
  /** M14 buy-mode metadata (optional; the client falls back to its table). */
  category?: string;
  /** Footprint on the 6×6 room grid: [w, d], "2x1", or { w, d }. */
  size?: [number, number] | string | { w?: number; d?: number } | null;
}

/** Price for any catalog entry (price | cost). */
export function priceOf(e: { price?: number; cost?: number }): number {
  const p = typeof e.price === "number" ? e.price : e.cost;
  return Math.max(0, Math.round(p ?? 0));
}

/** Travel speed multiplier for a vehicle entry (speedMult | speed | mult). */
export function speedOf(v: { speedMult?: number; speed?: number; mult?: number }): number {
  const s =
    typeof v.speedMult === "number"
      ? v.speedMult
      : typeof v.speed === "number"
        ? v.speed
        : v.mult;
  return Number.isFinite(s) && (s as number) > 0 ? (s as number) : 1;
}

export interface BankInfo {
  savingsRate?: number;
  loanRate?: number;
  loanMax?: number;
}

export interface TravelFares {
  sameRegion?: number;
  crossRegion?: number;
  boat?: number;
}

/**
 * Display-only mirror of the server's travelFare(): same region → sameRegion,
 * any lagoon leg → boat, otherwise crossRegion. Server re-validates on travel.
 */
export function travelFare(
  from: ApiLocation | null | undefined,
  to: ApiLocation | null | undefined,
  fares?: TravelFares
): number {
  const same = fares?.sameRegion ?? 0;
  const cross = fares?.crossRegion ?? 200;
  const boat = fares?.boat ?? 500;
  if (!from || !to) return cross;
  if (from.id === to.id) return 0;
  if (from.region === to.region) return same;
  if (from.region === "lagoon" || to.region === "lagoon") return boat;
  return cross;
}

/** One row of the money ledger (GET /api/transactions). */
export interface TransactionInfo {
  id: number;
  kind: string;
  amount: number;
  /** Balance right after this transaction. */
  balance_after?: number;
  balanceAfter?: number;
  /** ms epoch (server may send `created_at` instead). */
  created_at?: number;
  ts?: number;
  meta?: unknown;
}

/** M15 home-style option (walls / floors) from /api/config. */
export interface WallFloorOption {
  id: string;
  name: string;
  price: number;
  hex: string;
  desc?: string;
}

/** Phase 5: one venue activity (server is the source of truth; see v2/venues.js). */
export interface VenueActivity {
  id: string;
  name: string;
  icon: string;
  cost: number;
  needs: Record<string, number>;
  skillXp?: { skill: string; xp: number };
  blurb: string;
  teaser: string;
  tags: string[];
}

export interface GameConfig {
  classes: Record<string, ClassInfo>;
  locations: ApiLocation[];
  jobs: JobInfo[];
  food: FoodInfo[];
  fun: FunInfo[];
  housing: Record<string, HousingInfo>;
  /** M3 catalogs (optional until the M3 server lands). */
  properties?: PropertyInfo[];
  businesses?: BusinessInfo[];
  vehicles?: VehicleInfo[];
  furniture?: FurnitureInfo[];
  /** M3 economy knobs (WS init carries these; REST may not). */
  homeSlots?: number;
  bank?: BankInfo;
  travelFares?: TravelFares;
  studyCost?: number;
  spawn: string;
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number };
  avatars?: string[];
  colors?: string[];
  /** M15: avatar-studio option lists (optional until the server lands). */
  avatarLook?: AvatarLookOptions;
  /** M15: home wall / floor style catalogs for `buy_home_style`. */
  walls?: WallFloorOption[];
  floors?: WallFloorOption[];
  /** Phase 5: venue activities — flat list; match against a location's tags. */
  venueActivities?: VenueActivity[];
}

/**
 * Normalize raw config (from WS `init` or GET /api/config) into GameConfig,
 * defensively: every catalog tolerates arrays or keyed objects and may be absent.
 */
export function normalizeConfig(raw: Record<string, unknown> | undefined): GameConfig | null {
  if (!raw) return null;
  const r = raw;
  const classes =
    r.classes && typeof r.classes === "object"
      ? (r.classes as GameConfig["classes"])
      : {};
  const housing =
    r.housing && typeof r.housing === "object"
      ? (r.housing as GameConfig["housing"])
      : {};
  const bounds =
    r.bounds && typeof r.bounds === "object"
      ? (r.bounds as GameConfig["bounds"])
      : { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };
  // Catalog key aliases: the live server sends `biz`/`furn`; the contract
  // brief said `businesses`/`furniture`. Accept both.
  const bank =
    r.bank && typeof r.bank === "object" ? (r.bank as GameConfig["bank"]) : undefined;
  const travelFares =
    r.travelFares && typeof r.travelFares === "object"
      ? (r.travelFares as GameConfig["travelFares"])
      : undefined;
  const avatarLook =
    r.avatarLook && typeof r.avatarLook === "object"
      ? (r.avatarLook as GameConfig["avatarLook"])
      : undefined;
  return {
    classes,
    locations: asList(r.locations as GameConfig["locations"]),
    jobs: asList(r.jobs as GameConfig["jobs"]),
    food: asList(r.food as GameConfig["food"]),
    fun: asList(r.fun as GameConfig["fun"]),
    housing,
    properties: asList(r.properties as GameConfig["properties"]),
    businesses:
      asList(r.businesses as GameConfig["businesses"]).length > 0
        ? asList(r.businesses as GameConfig["businesses"])
        : asList(r.biz as GameConfig["businesses"]),
    vehicles: asList(r.vehicles as GameConfig["vehicles"]),
    furniture:
      asList(r.furniture as GameConfig["furniture"]).length > 0
        ? asList(r.furniture as GameConfig["furniture"])
        : asList(r.furn as GameConfig["furniture"]),
    homeSlots: typeof r.homeSlots === "number" ? r.homeSlots : 6,
    bank,
    travelFares,
    studyCost: typeof r.studyCost === "number" ? r.studyCost : 5000,
    spawn: typeof r.spawn === "string" ? r.spawn : "ojuelegba",
    bounds,
    avatarLook,
    walls: asList(r.walls as GameConfig["walls"]),
    floors: asList(r.floors as GameConfig["floors"]),
    venueActivities: asList(r.venueActivities as GameConfig["venueActivities"]),
  };
}

/** Defensive: the wire may carry an array or a keyed object. */
export function asList<T>(v: T[] | Record<string, T> | undefined | null): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : Object.values(v);
}

/** Authoritative character state (GET /api/me). */
export interface Me {
  id: number;
  /** Character row id (for /api/characters/:id/appearance). */
  character_id?: number;
  username: string;
  name: string;
  /** Cloud-save wiring: true for guest accounts (cloud sync stays local-only). */
  is_guest?: boolean;
  /** Character panel: masked account email (null when the account has none). */
  email_masked?: string | null;
  class: string | null;
  avatar: string;
  color: string;
  money: number;
  energy: number;
  health: number;
  happiness: number;
  hunger: number;
  housing: string;
  property: string | { id?: string; name?: string } | null;
  vehicle: string | { id?: string; name?: string } | null;
  /** M3: owned business id/ref. */
  biz?: string | { id?: string; name?: string } | null;
  savings: number;
  loan: number;
  cert: number;
  /** M3: owned furniture instances. */
  furniture?: Array<{
    id?: string;
    item?: string;
    itemId?: string;
    name?: string;
    icon?: string;
    effect?: string;
    placed?: boolean;
  }> | null;
  starter_loan_available?: boolean;
  locationId: string;
  day: number;
  is_admin: boolean;
  guest: boolean;
  customized?: boolean;
  /** M15: staged 3D avatar look (server contract: character.avatar_look). */
  avatar_look?: AvatarLook | null;
}

export interface PublicStats {
  online: number;
  visits: number;
  governor: string | null;
  homes: number;
  homesOnline: number;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return body as T;
}

/**
 * One row of the admin roster (GET /api/admin/players). Field names are
 * defensive — the server may use `banned`/`is_banned` and `online` flags.
 */
export interface AdminPlayer {
  id: number;
  username: string;
  money: number;
  energy: number;
  housing: string | null;
  online?: boolean;
  banned?: boolean;
  is_admin?: boolean;
  last_seen?: number;
}

/** Bearer-auth GET helper. */
export async function authGet<T>(path: string, token: string): Promise<T> {
  return request<T>(path, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
}

/** Bearer-auth POST-with-JSON helper. */
export async function authPost<T>(path: string, token: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

/** Bearer-auth PUT-with-JSON helper. */
export async function authPut<T>(path: string, token: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

/** Bearer-auth DELETE helper. */
export async function authDelete<T>(path: string, token: string): Promise<T> {
  return request<T>(path, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
}

/**
 * M4 admin endpoints — require is_admin; the server answers 403 otherwise.
 * Contract: docs/API_SPEC.md ("Admin (Bearer, is_admin only) — M4").
 */
export const adminApi = {
  players: (token: string) =>
    authGet<{ players: Array<AdminPlayer & { stats?: Record<string, number> }> }>(
      "/api/admin/players",
      token
    ).then((body) => {
      const rows = Array.isArray(body?.players) ? body.players : [];
      // Server nests stats as {energy,health,...}; flatten defensively.
      return rows.map((p) => ({
        ...p,
        energy: p.energy ?? p.stats?.energy ?? 0,
      }));
    }),
  broadcast: (token: string, text: string) =>
    authPost<{ ok?: boolean }>("/api/admin/broadcast", token, { text }),
  ban: (token: string, username: string, banned: boolean) =>
    authPost<{ ok?: boolean; banned?: boolean }>("/api/admin/ban", token, {
      username,
      banned,
    }),
  makeAdmin: (token: string, username: string) =>
    authPost<{ ok?: boolean; is_admin?: boolean }>(
      "/api/admin/make-admin",
      token,
      { username }
    ),
  election: (token: string) =>
    authGet<unknown>("/api/admin/election", token),
};

/** Defensive M5 payload pickers — tolerate server shape drift. */
function pickLeaders(body: unknown): LeaderEntry[] | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const list = asList(b.leaders as LeaderEntry[] | Record<string, LeaderEntry> | undefined);
  if (list.length === 0) return null;
  return list
    .filter((l) => l && typeof (l as LeaderEntry).username === "string")
    .slice(0, 10)
    .map((l) => ({
      id: typeof l.id === "number" ? l.id : undefined,
      username: l.username,
      money: Math.max(0, Math.round(Number(l.money) || 0)),
    }));
}

function pickNews(body: unknown): NewsItem[] | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const list = asList(b.news as NewsItem[] | Record<string, NewsItem> | undefined);
  if (list.length === 0) return null;
  return list
    .filter((n) => n && typeof (n as NewsItem).text === "string")
    .map((n) => ({ id: n.id, text: String(n.text).slice(0, 220), ts: typeof n.ts === "number" ? n.ts : undefined }))
    .slice(0, 20);
}

function pickPresence(body: unknown): PresenceEntry[] | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const list = asList(b.presence as PresenceEntry[] | Record<string, PresenceEntry> | undefined);
  if (list.length === 0) return null;
  return list
    .filter((p) => p && typeof p.id === "number" && typeof p.username === "string")
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({
      id: p.id,
      username: p.username,
      x: Math.max(0, Math.min(100, p.x)),
      y: Math.max(0, Math.min(100, p.y)),
      avatar: typeof p.avatar === "string" ? p.avatar : undefined,
      color: typeof p.color === "string" ? p.color : undefined,
    }))
    .slice(0, 200);
}

export const api = {
  health: () => request<{ ok: boolean; online: number; day: number; db: string; version: string }>("/api/health"),
  stats: () => request<PublicStats>("/api/stats"),
  config: () => request<GameConfig>("/api/config"),
  guest: (ageConfirm: boolean) =>
    request<{ token: string; username: string }>("/api/auth/guest", {
      method: "POST",
      body: JSON.stringify({ ageConfirm }),
    }),
  register: (body: {
    username: string;
    email?: string;
    password: string;
    dob: string;
    guestToken?: string;
    /** W3: referral code from a ?ref= invite link (invalid codes are ignored). */
    ref?: string;
  }) =>
    request<{ token: string; username: string; is_admin?: boolean }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  login: (body: { username: string; password: string }) =>
    request<{ token: string; username: string; is_admin?: boolean }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  me: (token: string) =>
    request<Me>("/api/me", {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    }),
  /** M2 character creation — once per character. Server validates & applies class stats. */
  createCharacter: (
    token: string,
    body: {
      name: string;
      class: string;
      avatar: string;
      color: string;
      /** M15: staged 3D look (sanitized client-side; server re-validates). */
      avatar_look?: AvatarLook;
    }
  ) =>
    request<{ ok: boolean; character?: Me }>("/api/characters", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }),
  /** M3 money ledger — newest first. The server wraps rows in `{transactions}`. */
  transactions: (token: string, limit = 50) =>
    request<{ transactions: TransactionInfo[] }>(
      `/api/transactions?limit=${limit}`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    ).then((body) =>
      Array.isArray(body?.transactions) ? body.transactions : []
    ),
  /**
   * M5 leaderboard — top players by money. The server may return
   * `{leaders:[...]}` or `stats.leaders`; null when the endpoint isn't live.
   */
  leaderboard: (token: string, limit = 10): Promise<LeaderEntry[] | null> =>
    authGet<unknown>(`/api/leaderboard?limit=${limit}`, token)
      .then((body) => pickLeaders(body))
      .catch(() =>
        // Auth-less servers may serve it publicly.
        request<unknown>("/api/leaderboard")
          .then((body) => pickLeaders(body))
          .catch(() => null)
      ),
  /**
   * M5 public news ticker. `{news:[{id?,text,ts?}]}`; null when not live.
   */
  news: (): Promise<NewsItem[] | null> =>
    request<unknown>("/api/news")
      .then((body) => pickNews(body))
      .catch(() => null),
  /**
   * M5 public presence — capped player dots for the landing map.
   * `{presence:[{id,username,x,y,avatar?,color?}]}` (x/y are 0..100 map
   * coords). Null when the server team hasn't built the endpoint —
   * the landing simply renders no presence dots.
   */
  presence: (): Promise<PresenceEntry[] | null> =>
    request<unknown>("/api/presence")
      .then((body) => pickPresence(body))
      .catch(() => null),
};

/**
 * W3 — Friends page + referral links.
 * Contract: server/src/routes/friends.js (+ GET /api/referral/:code).
 * Referral attribution is data-only: no coins, no rewards, no payouts.
 */
export interface FriendEntry {
  id: number;
  other_id: number;
  other_username: string;
  status: "pending" | "accepted" | "declined";
  /** True when the other side sent the request (incoming to me). */
  incoming: boolean;
  /** Live WS presence (false when the endpoint can't tell). */
  online: boolean;
  /** Other side's last WS connect timestamp (ms), null when unknown. */
  last_seen: number | null;
  created_ts: number;
}

export interface FriendLookup {
  id: number;
  username: string;
  avatar: string;
  color: string;
  is_self: boolean;
}

export interface InviteInfo {
  code: string;
  link: string;
  joined: number;
}

export const friendsApi = {
  /** Pending + accepted friendships for me, with online flags. */
  list: (token: string) =>
    authGet<{ friends: FriendEntry[] }>("/api/friends", token),
  /** Pending requests split into incoming / outgoing. */
  requests: (token: string) =>
    authGet<{ incoming: FriendEntry[]; outgoing: FriendEntry[] }>(
      "/api/friends/requests",
      token
    ),
  /** Exact-username lookup → profile snippet (for "add by username"). */
  lookup: (token: string, username: string) =>
    authGet<FriendLookup>(
      `/api/friends/lookup?username=${encodeURIComponent(username)}`,
      token
    ),
  /** Send a friend request (idempotent — duplicate returns the existing row). */
  sendRequest: (token: string, username: string) =>
    authPost<{
      ok: boolean;
      result: "ok" | "exists" | "accepted";
      friendship: FriendEntry | null;
    }>("/api/friends/request", token, { username }),
  /** Accept an incoming request (recipient only). */
  accept: (token: string, id: number) =>
    authPost<{ ok: boolean }>(`/api/friends/${id}/accept`, token, {}),
  /** Decline an incoming request (recipient only). */
  decline: (token: string, id: number) =>
    authPost<{ ok: boolean }>(`/api/friends/${id}/decline`, token, {}),
  /** Cancel an outgoing request or unfriend. */
  remove: (token: string, id: number) =>
    authDelete<{ ok: boolean }>(`/api/friends/${id}`, token),
  /** My referral code + shareable invite link + join count. */
  invite: (token: string) => authGet<InviteInfo>("/api/friends/invite", token),
  /** Resolve a public ?ref= code → the inviter's username (404 when unknown). */
  resolveReferral: (code: string) =>
    request<{ username: string }>(
      `/api/referral/${encodeURIComponent(code)}`
    ),
};

/* ------------------------------------------------------------------ */
/* Character panel: username + display name changes.                   */
/* ------------------------------------------------------------------ */
export const profileApi = {
  /** Change username and/or display name (server validates like registration). */
  update: (token: string, body: { username?: string; name?: string }) =>
    authPut<{ ok: boolean; username?: string; name?: string }>(
      "/api/me/profile",
      token,
      body
    ),
};

/* ------------------------------------------------------------------ */
/* M21 — notifications API.                                            */
/* ------------------------------------------------------------------ */
export const notificationsApi = {
  /** Newest-first page + unread count. */
  list: (token: string, limit = 30, offset = 0) =>
    authGet<{ notifications: NotificationEntry[]; unread: number; limit: number; offset: number }>(
      `/api/notifications?limit=${limit}&offset=${offset}`,
      token
    ),
  /** Mark one notification read. */
  markRead: (token: string, id: number) =>
    authPost<{ ok: boolean }>(`/api/notifications/${id}/read`, token, {}),
  /** Mark everything read (clears the badge). */
  markAllRead: (token: string) =>
    authPost<{ ok: boolean }>(`/api/notifications/read-all`, token, {}),
  /** Current preference toggles. */
  getPrefs: (token: string) =>
    authGet<{ preferences: NotificationPrefs }>(
      `/api/notifications/preferences`,
      token
    ),
  /** Save preference toggles. */
  setPrefs: (token: string, prefs: Partial<NotificationPrefs>) =>
    request<{ preferences: NotificationPrefs }>(`/api/notifications/preferences`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(prefs),
    }),
};

/* ------------------------------------------------------------------ */
/* Phase 3 — Gist social feed + News tab. Contract: server/src/routes/ */
/* gists.js. Text is plain (server strips markup); render as text.     */
/* ------------------------------------------------------------------ */

export type GistTab = "latest" | "trending" | "following" | "me" | "news";

export interface GistEntry {
  id: number;
  user_id: number;
  username: string;
  avatar: string;
  color: string;
  badge: string;
  text: string;
  created_at: number;
  like_count: number;
  comment_count: number;
  liked: boolean;
  mine: boolean;
}

export interface GistComment {
  id: number;
  gist_id: number;
  user_id: number;
  username: string;
  avatar: string;
  color: string;
  badge: string;
  text: string;
  created_at: number;
}

export interface HeadlineItem {
  id: number;
  source: string;
  title: string;
  link: string;
  snippet: string;
  published_at: number | null;
  fetched_at: number;
}

export const GIST_MAX = 280;

export const gistsApi = {
  /** Cursor-paged feed for one tab. */
  list: (token: string, tab: Exclude<GistTab, "news">, cursor?: string | null, limit = 15) => {
    const q = new URLSearchParams({ tab, limit: String(limit) });
    if (cursor) q.set("cursor", cursor);
    return authGet<{ gists: GistEntry[]; next_cursor: string | null; tab: string }>(
      `/api/gists?${q.toString()}`,
      token
    );
  },
  /** Post a gist (server validates 1–280 chars, 30s/user rate limit). */
  create: (token: string, text: string) =>
    authPost<{ gist: GistEntry }>("/api/gists", token, { text }),
  /** Idempotent like. */
  like: (token: string, id: number) =>
    authPost<{ ok: boolean; liked: boolean; like_count: number }>(
      `/api/gists/${id}/like`,
      token,
      {}
    ),
  /** Idempotent unlike. */
  unlike: (token: string, id: number) =>
    authDelete<{ ok: boolean; liked: boolean; like_count: number }>(
      `/api/gists/${id}/like`,
      token
    ),
  /** Delete own gist (admins can delete any). */
  remove: (token: string, id: number) =>
    authDelete<{ ok: boolean }>(`/api/gists/${id}`, token),
  /** Oldest-first comments, cursor paged. */
  comments: (token: string, id: number, cursor?: string | null, limit = 20) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (cursor) q.set("cursor", cursor);
    return authGet<{ comments: GistComment[]; next_cursor: string | null }>(
      `/api/gists/${id}/comments?${q.toString()}`,
      token
    );
  },
  /** Add a comment (server validates 1–280 chars). */
  addComment: (token: string, id: number, text: string) =>
    authPost<{ comment: GistComment }>(`/api/gists/${id}/comments`, token, { text }),
  /** Report a gist (records a row for admins). */
  report: (token: string, id: number, reason: string) =>
    authPost<{ ok: boolean; report_id: number }>(`/api/gists/${id}/report`, token, {
      reason,
    }),
};

/* ------------------------------------------------------------------ */
/* Phase 7 — Èkó Rich List: top players by net worth.               */
/* ------------------------------------------------------------------ */
export interface RichListEntry {
  id: number;
  username: string;
  avatar: string;
  color: string;
  netWorth: number;
  isGovernor?: boolean;
}

export const richListApi = {
  /** Ranked leaders + the caller's own rank and total ranked players. */
  list: (token: string, limit = 25) =>
    authGet<{
      leaders: RichListEntry[];
      yourRank: number | null;
      totalPlayers: number;
    }>(`/api/richlist?limit=${limit}`, token),
};

export const headlinesApi = {
  /** Newest-first headlines + cache metadata. */
  list: (token: string, cursor?: string | null, limit = 20) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (cursor) q.set("cursor", cursor);
    return authGet<{
      items: HeadlineItem[];
      next_cursor: string | null;
      stale: boolean;
      updated_minutes_ago: number | null;
    }>(`/api/headlines?${q.toString()}`, token);
  },
  /** Manual refresh (server re-fetches only when the cache is stale). */
  refresh: (token: string) =>
    authPost<{ ok: boolean; refreshed: boolean; updated_minutes_ago?: number }>(
      "/api/headlines/refresh",
      token,
      {}
    ),
};

/* ------------------------------------------------------------------ */
/* Phase 4 — Èkó Reserve bank app (gameplay coins only)                 */
/* ------------------------------------------------------------------ */

/** One bond row as returned by /api/bank. */
export interface BankBond {
  id: number;
  user_id: number;
  principal: number;
  rate: number;
  start_day: number;
  term_days: number;
  matured: boolean;
  matured_day: number | null;
  /** First day the bond can pay out. */
  matures_day: number;
  /** Flat interest earned at maturity. */
  interest: number;
  /** Principal + interest credited at maturity. */
  payout: number;
}

export interface BankTaxInfo {
  weekEarnings: number;
  bill: number;
  rawBill: number;
  taxMult: number;
  holiday: boolean;
  free: number;
  band2: number;
  rate2: number;
  rate3: number;
  bracket: { label: string; rate: number };
}

export interface BankBillsInfo {
  weeklyBill: number;
  weekEndsDay: number;
  currentWeek: number;
  arrears: number;
  arrearsCap: number;
  base: number;
  propRate: number;
  capWeeks: number;
}

/** Overview bundle from GET /api/bank. */
export interface BankOverview {
  balance: number;
  savings: number;
  /** coins + savings + active bond principal (see bank.js netWorth). */
  netWorth: number;
  lastReceipt: TransactionInfo | null;
  bonds: {
    active: BankBond[];
    matured: BankBond[];
    terms: Record<string, { rate: number; label: string }>;
    min: number;
  };
  tax: BankTaxInfo;
  bills: BankBillsInfo;
  /** Savings interest credited since the current week started. */
  interestWeek: number;
  day: number;
  isAdmin: boolean;
}

export const bankApi = {
  /** Full bank overview bundle. */
  overview: (token: string) =>
    authGet<BankOverview>("/api/bank", token),
  /** All bonds, newest first. */
  bonds: (token: string) =>
    authGet<{
      bonds: BankBond[];
      terms: Record<string, { rate: number; label: string }>;
      min: number;
    }>("/api/bank/bonds", token),
  /** Buy a bond — server validates amount ≥ min, known term, affordability. */
  buyBond: (token: string, amount: number, termDays: number) =>
    authPost<{ bond: BankBond; balance: number }>(
      "/api/bank/bonds",
      token,
      { amount, termDays }
    ),
};

/* ------------------------------------------------------------------ */
/* Phase 6 — Boutique clothing shop.                                   */
/* ------------------------------------------------------------------ */

export interface BoutiqueItem {
  id: string;
  outfitId: string;
  name: string;
  price: number;
  occasion: "owambe" | "street" | "office" | "traditional";
  blurb: string;
  owned: boolean;
}

export const boutiqueApi = {
  /** Catalog + owned flags + coin balance. */
  catalog: (token: string) =>
    authGet<{ items: BoutiqueItem[]; balance: number }>("/api/boutique", token),
  /** Buy an outfit — server validates existence, ownership, affordability. */
  buy: (token: string, itemId: string) =>
    authPost<{ item: BoutiqueItem; balance: number }>(
      "/api/boutique/buy",
      token,
      { itemId }
    ),
};

/* ------------------------------------------------------------------ */
/* Phase 8 — Èkó Gov: governor election + governance.                  */
/* ------------------------------------------------------------------ */

export interface GovCandidate {
  playerId: number;
  username: string;
  votes: number;
}

export interface GovPolicyInfo {
  id: string | null;
  name: string | null;
  icon: string;
  desc: string | null;
  picked: boolean;
  defaulted: boolean;
  pickDeadline: number;
  canPick: boolean;
  effects: string;
}

export interface GovCommissioner {
  title: string;
  user_id: number;
  username: string | null;
  appointed_at: number;
}

export interface GovPolicyOption {
  id: string;
  name: string;
  icon: string;
  desc: string;
  effects: string;
}

export interface GovCommissionerTitle {
  title: string;
  icon: string;
}

export interface GovState {
  election: {
    id: number;
    status: string;
    startDay: number;
    endDay: number;
    daysLeft: number;
  } | null;
  candidates: GovCandidate[];
  myVote: number | null;
  isCandidate: boolean;
  governor: { id: number; username: string | null } | null;
  lastWinner: { username: string | null; electionId: number } | null;
  policy: GovPolicyInfo;
  commissioners: GovCommissioner[];
  commissionerTitles: GovCommissionerTitle[];
  policies: GovPolicyOption[];
  runFee: number;
  canRun: boolean;
}

export const govApi = {
  /** Full governance state (election, candidates, governor, policy, cabinet). */
  state: (token: string) => authGet<GovState>("/api/gov", token),
  /** Enter the governor race — server charges the candidacy fee. */
  run: (token: string) =>
    authPost<{ ok: boolean; state: GovState }>("/api/gov/run", token, {}),
  /** Cast one vote for a candidate. */
  vote: (token: string, candidateId: number) =>
    authPost<{ ok: boolean; state: GovState }>("/api/gov/vote", token, {
      candidateId,
    }),
  /** Governor signs a city policy (within the pick window). */
  pickPolicy: (token: string, policyId: string) =>
    authPost<{ ok: boolean; state: GovState }>("/api/gov/policy", token, {
      policyId,
    }),
  /** Governor appoints a commissioner. */
  appoint: (token: string, title: string, username: string) =>
    authPost<{ ok: boolean; state: GovState }>(
      "/api/gov/commissioners/appoint",
      token,
      { title, username }
    ),
  /** Governor dismisses a commissioner. */
  dismiss: (token: string, title: string) =>
    authPost<{ ok: boolean; state: GovState }>(
      "/api/gov/commissioners/dismiss",
      token,
      { title }
    ),
};

/* ------------------------------------------------------------------ */
/* UGC Design Contests — duel voting, ranked leaderboard, 2-tap entry. */
/* ------------------------------------------------------------------ */
export interface ContestDesign {
  emoji: string;
  colors: [string, string];
  blurb: string;
}

export interface ContestEntry {
  id: number;
  title: string;
  design: ContestDesign;
  /** Optional player-snapped photo (data URL); shown instead of the emoji art. */
  photo: string | null;
  username: string;
  votes: number;
  /** 0..1 — fraction of the leader's votes, drives the vote bar. */
  share: number;
  isMine: boolean;
}

export interface ContestSummary {
  id: number;
  title: string;
  category: "outfit" | "apartment";
  status: string;
  endsAt: string;
  daysLeft: number;
  prizeText: string;
  voteBudgetPerDay: number;
  entryCount: number;
  totalVotes: number;
}

export interface ContestDetail {
  contest: ContestSummary;
  entries: ContestEntry[];
  votesLeft: number;
  streak: number;
}

export interface DuelPair {
  pair: [ContestEntry, ContestEntry] | null;
  reason: string | null;
  duelNo: number;
  votesLeft: number;
  streak: number;
}

export interface ContestVoteResult {
  ok: boolean;
  entryId: number;
  votes: number;
  votesLeft: number;
  streak: number;
}

export const contestsApi = {
  /** Active contests first, then past. */
  list: (token: string) => authGet<ContestSummary[]>("/api/contests", token),
  /** Ranked leaderboard + viewer's votes-left today + streak. */
  detail: (token: string, id: number) =>
    authGet<ContestDetail>(`/api/contests/${id}`, token),
  /** Random head-to-head pair the viewer hasn't voted on. */
  duel: (token: string, id: number) =>
    authGet<DuelPair>(`/api/contests/${id}/duel`, token),
  /** Tap-the-winner vote for one entry. */
  vote: (token: string, id: number, entryId: number) =>
    authPost<ContestVoteResult>(`/api/contests/${id}/vote`, token, {
      entry_id: entryId,
    }),
  /** 2-tap entry submit: title + emoji/colors/blurb design + optional photo. */
  enter: (token: string, id: number, title: string, design: ContestDesign, photo?: string | null) =>
    authPost<{ ok: boolean; entry: ContestEntry }>(
      `/api/contests/${id}/entries`,
      token,
      { title, design, photo: photo ?? null }
    ),
};

/* ------------------------------------------------------------------ */
/* Phase 9 — Daily Gem Hunt: riddle clue + search current location.    */
/* ------------------------------------------------------------------ */
export interface GemState {
  day: number;
  clue: string;
  nextGemInMs: number;
  foundCount: number;
  firstFinders: string[];
  myFound: boolean;
  myPrize: number | null;
  myRank: number | null;
  nextPrize: number;
  prizeLadder: { label: string; prize: number }[];
}

export interface GemSearchResult {
  ok: boolean;
  found: boolean;
  prize: number;
  rank: number;
}

export const gemApi = {
  /** Today's hunt state: clue, countdown, finders, ladder (no location leak). */
  state: (token: string) => authGet<GemState>("/api/gem", token),
  /** Search the player's current location for today's gem. */
  search: (token: string) =>
    authPost<GemSearchResult>("/api/gem/search", token, {}),
};

/* ------------------------------------------------------------------ */
/* Crews: player clans — discover, create, join, shared goal, league.  */
/* ------------------------------------------------------------------ */

/** One crew in the discover list. */
export interface CrewSummary {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  foundedAt: number;
  memberCount: number;
  weeklyXp: number;
  totalXp: number;
  rank: number;
  myRole: string | null;
}

/** One member of a crew. */
export interface CrewMember {
  userId: number;
  username: string;
  role: string;
  xp: number;
  joinedAt: number;
}

/** The crew's active shared goal. */
export interface CrewGoal {
  title: string;
  target: number;
  raised: number;
  pct: number;
  endsAt: number;
  daysLeft: number;
}

/** One row of the weekly league leaderboard. */
export interface CrewBoardEntry {
  id: string;
  name: string;
  icon: string;
  memberCount: number;
  weeklyXp: number;
  rank: number;
  movement: number;
  isMine: boolean;
}

/** Full crew detail payload (GET /api/crews/:id). */
export interface CrewDetail {
  crew: CrewSummary;
  goal: CrewGoal | null;
  members: CrewMember[];
  board: CrewBoardEntry[];
  my: { crewId: string | null; role: string | null };
}

export type CrewSort = "active" | "members" | "xp";

export const crewsApi = {
  /** Discover crews, sorted (crews start empty until players create them). */
  list: (token: string, sort: CrewSort = "active") =>
    authGet<{ crews: CrewSummary[]; myCrewId: string | null; sort: CrewSort }>(
      `/api/crews?sort=${sort}`,
      token
    ),
  /** Create a crew (name 3–24 chars) — the creator becomes founder. */
  create: (token: string, args: { name: string; tagline: string; icon: string }) =>
    authPost<{ ok: boolean; crew: CrewSummary }>("/api/crews", token, args),
  /** Full crew detail: info, members, shared goal, league board. */
  detail: (token: string, id: string) =>
    authGet<CrewDetail>(`/api/crews/${encodeURIComponent(id)}`, token),
  /** Join a crew (one crew at a time). */
  join: (token: string, id: string) =>
    authPost<{ ok: boolean; crewId: string; notice?: string }>(
      `/api/crews/${encodeURIComponent(id)}/join`,
      token,
      {}
    ),
  /** Leave a crew (last one out disbands it). */
  leave: (token: string, id: string) =>
    authPost<{ ok: boolean; disbanded?: boolean; notice?: string }>(
      `/api/crews/${encodeURIComponent(id)}/leave`,
      token,
      {}
    ),
  /** Chip gameplay coins into the crew's shared goal. */
  contribute: (token: string, id: string, amount: number) =>
    authPost<{
      ok: boolean;
      raised: number;
      target: number;
      pct: number;
      balance: number;
      xpEarned: number;
      notice?: string;
    }>(`/api/crews/${encodeURIComponent(id)}/contribute`, token, { amount }),
};

/* ---------------- Story Questlines (chat-thread story arcs) ---------------- */

export interface StoryChoice {
  id: number;
  label: string;
  consequenceHint: string | null;
  rewardCoins: number;
  rewardXp: number;
}

export interface StoryScene {
  id: number;
  sceneNo: number;
  speaker: string;
  text: string;
  choicePrompt: string | null;
  choices: StoryChoice[];
}

export interface StoryChapter {
  id: number;
  chapterNo: number;
  title: string;
  locked: boolean;
  scenes: StoryScene[];
}

export interface StoryListItem {
  id: number;
  title: string;
  synopsis: string;
  chaptersCount: number;
  coverEmoji: string;
  unread: number;
  completed: boolean;
  progress: { chapterNo: number; sceneNo: number } | null;
}

export interface StoryDetail {
  story: {
    id: number;
    title: string;
    synopsis: string;
    chaptersCount: number;
    coverEmoji: string;
  };
  completed: boolean;
  progress: { chapterNo: number; sceneNo: number; completedAt: number | null } | null;
  chapters: StoryChapter[];
}

export interface StoryAdvanceResult {
  ok: boolean;
  completed: boolean;
  progress: { chapterNo: number; sceneNo: number };
  reward: { coins: number; xp: number; leveledUp: boolean; skill: string; skillLevel: number };
}

export const storyApi = {
  /** Story threads with per-user unread/progress badges. */
  list: (token: string) => authGet<{ stories: StoryListItem[] }>("/api/stories", token),
  /** Chapters + scenes up to the reader's progress. */
  detail: (token: string, id: number) => authGet<StoryDetail>(`/api/stories/${id}`, token),
  /** Tap a reply bubble (choiceId null = continue a narrative scene). */
  advance: (token: string, id: number, chapterNo: number, sceneNo: number, choiceId: number | null) =>
    authPost<StoryAdvanceResult>(`/api/stories/${id}/advance`, token, {
      chapter_no: chapterNo,
      scene_no: sceneNo,
      choice_id: choiceId,
    }),
};

/* ------------------------------------------------------------------ */
/* Live Events Calendar — seasons, day-grouped timeline, RSVPs.        */
/* ------------------------------------------------------------------ */
export interface EventSeason {
  tag: string;
  title: string;
  window: string;
  blurb: string | null;
  emoji: string;
}

export interface EventSummary {
  id: string;
  title: string;
  emoji: string;
  venue: string;
  timeLabel: string;
  startsAt: number;
  endsAt: number;
  isLive: boolean;
  isRecurring: boolean;
  recurringRule: string | null;
  prizeText: string | null;
  attendees: number;
  myStatus: "going" | "remind" | null;
}

export interface EventDayGroup {
  key: string;
  label: string;
  events: EventSummary[];
}

export interface EventDetailRow {
  icon: string;
  rich: string;
}

export interface EventDetail extends EventSummary {
  details: EventDetailRow[];
  seasonTag: string | null;
}

export interface EventAttendee {
  username: string;
  initials: string;
}

export const eventsApi = {
  /** Upcoming events, grouped by day (server labels: TODAY · THU / SATURDAY / NEXT WEEK). */
  list: (token: string) =>
    authGet<{ now: number; seasons: EventSeason[]; days: EventDayGroup[] }>(
      "/api/events",
      token
    ),
  /** Event detail + attendee sample. */
  detail: (token: string, id: string) =>
    authGet<{ event: EventDetail; goingCount: number; attendees: EventAttendee[] }>(
      `/api/events/${encodeURIComponent(id)}`,
      token
    ),
  /** Join or remind — upserts the viewer's RSVP. */
  rsvp: (token: string, id: string, status: "going" | "remind") =>
    authPost<{ ok: boolean; myStatus: "going" | "remind"; attendees: number; goingCount: number }>(
      `/api/events/${encodeURIComponent(id)}/rsvp`,
      token,
      { status }
    ),
  /** Cancel the viewer's RSVP. */
  cancelRsvp: (token: string, id: string) =>
    authDelete<{ ok: boolean; myStatus: null }>(
      `/api/events/${encodeURIComponent(id)}/rsvp`,
      token
    ),
};
