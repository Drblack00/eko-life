import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "../components";
import { normalizeConfig, type GameConfig } from "../lib/api";
import type {
  ActName,
  ChatEntry,
  DmMessage,
  DmThread,
  ElectionCandidate,
  ElectionState,
  FriendEntry,
  FriendRequest,
  GovernorInfo,
  PlayerLite,
  RoomEntry,
  RoomMember,
  RoomMessage,
  ServerMsg,
  StreetSpawn,
  You,
} from "../game/types";
import { spawnMapXY } from "../game/types";

export type SocketStatus = "connecting" | "open" | "retrying" | "failed";

const MAX_ATTEMPTS = 5;
/** Chat history kept per surface (city chat + room threads + DM threads). */
const MSG_KEEP = 100;
/** Street-find spawns are kept in a bounded map (server may emit many). */
const SPAWN_KEEP = 60;
/** localStorage key for client-side block list (defense in depth). */
const BLOCK_KEY = "eko:blocked:v1";

function wsUrl(token: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
}

/** Normalize a `spawn {s}` payload defensively (id + coords required).
 *  The M3 server sends map coords as `x`/`y`; `lat`/`lng` is the fallback. */
function normalizeSpawn(raw: unknown): StreetSpawn | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const id = s.id;
  if (id === undefined || id === null || id === "") return null;
  const norm: StreetSpawn = { id: id as string | number };
  for (const k of ["x", "y", "lat", "lng", "amount"] as const) {
    const v = Number(s[k]);
    if (Number.isFinite(v)) (norm as unknown as Record<string, number>)[k] = v;
  }
  if (!spawnMapXY(norm)) return null;
  if (typeof s.kind === "string") norm.kind = s.kind;
  if (typeof s.label === "string") norm.label = s.label;
  if (typeof s.icon === "string") norm.icon = s.icon;
  return norm;
}

/* ---------------- M5 defensive normalizers ---------------- */

/** Sender player id from a social message (aliases: playerId / senderId / from). */
function senderIdOf(msg: ServerMsg): number | null {
  if (typeof msg.playerId === "number") return msg.playerId;
  if (typeof msg.senderId === "number") return msg.senderId;
  const f = msg.from;
  if (typeof f === "number") return f;
  if (f && typeof f === "object" && typeof f.id === "number") return f.id;
  return null;
}

/**
 * Sender id for chat-family messages. The M5 server puts the SENDER's player
 * id in `id` on `{t:'chat'}` / `{t:'room_msg'}` (and in history entries) —
 * so `id` is checked first; the aliases are the fallback for other shapes.
 */
function chatSenderId(msg: ServerMsg): number | null {
  const aliased = senderIdOf(msg);
  if (aliased !== null) return aliased;
  return typeof msg.id === "number" ? msg.id : null;
}

/** Normalize a city-chat or room-history entry into a ChatEntry. */
function normalizeChatEntry(msg: ServerMsg): ChatEntry | null {
  if (typeof msg.text !== "string" || !msg.text.trim()) return null;
  const sid = chatSenderId(msg);
  const ts = typeof msg.ts === "number" ? msg.ts : Date.now();
  return {
    id: sid !== null ? `${sid}:${ts}` : `x:${ts}:${Math.random().toString(36).slice(2)}`,
    senderId: sid,
    name: senderNameOf(msg, "?"),
    text: msg.text,
    ts,
    gov: msg.gov === true,
  };
}

function senderNameOf(msg: ServerMsg, fallback: string): string {
  const f = msg.from;
  if (typeof f === "string") return f || fallback;
  if (f && typeof f === "object" && typeof f.username === "string") return f.username;
  if (f && typeof f === "object" && typeof f.name === "string") return f.name;
  if (typeof msg.fromName === "string") return msg.fromName;
  if (typeof msg.username === "string") return msg.username;
  if (typeof msg.name === "string") return msg.name;
  return fallback;
}

function normalizeCandidate(raw: unknown): ElectionCandidate | null {
  if (typeof raw === "number") return { id: raw, name: `Player ${raw}` };
  if (typeof raw === "string") return { id: -1, name: raw };
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  // Server shape: {player_id, username, votes}; legacy guesses: {id,name}.
  const id =
    typeof c.player_id === "number"
      ? c.player_id
      : typeof c.id === "number"
        ? c.id
        : typeof c.playerId === "number"
          ? c.playerId
          : -1;
  const name =
    typeof c.username === "string"
      ? c.username
      : typeof c.name === "string"
        ? c.name
        : `Player ${id}`;
  if (id < 0) return null;
  return {
    id,
    name,
    votes: typeof c.votes === "number" ? c.votes : undefined,
  };
}

/**
 * Normalize election state. The server sends `{t:'election', ...}` where the
 * fields may sit on `msg.election` (object) or directly on the message.
 */
function normalizeElection(msg: ServerMsg): ElectionState | null {
  const src =
    msg.election && typeof msg.election === "object"
      ? (msg.election as Record<string, unknown>)
      : (msg as unknown as Record<string, unknown>);
  const rawCands = Array.isArray(src.candidates)
    ? src.candidates
    : Array.isArray(msg.candidates)
      ? msg.candidates
      : [];
  const candidates = rawCands
    .map(normalizeCandidate)
    .filter((c): c is ElectionCandidate => c !== null);
  const active =
    typeof src.active === "boolean"
      ? src.active
      : typeof msg.active === "boolean"
        ? msg.active
        : candidates.length > 0;
  return {
    active,
    candidates,
    voted: src.voted === true || msg.voted === true,
    running: src.running === true || msg.running === true,
    endsInDays:
      typeof src.endsInDays === "number"
        ? src.endsInDays
        : typeof msg.endsInDays === "number"
          ? msg.endsInDays
          : undefined,
  };
}

function normalizeFriend(raw: unknown): FriendEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  // Server shape: {other_id, other_username, status, incoming, online}.
  const id =
    typeof f.other_id === "number" ? f.other_id : typeof f.id === "number" ? f.id : null;
  if (id === null) return null;
  const username =
    typeof f.other_username === "string"
      ? f.other_username
      : typeof f.username === "string"
        ? f.username
        : typeof f.name === "string"
          ? f.name
          : null;
  if (!username) return null;
  return {
    id,
    username,
    name: typeof f.name === "string" ? f.name : undefined,
    online: f.online === true,
  };
}

/** Incoming pending request from a `friends` roster row (server shape). */
function pendingRequestFromRow(raw: unknown): FriendRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  if (f.status !== "pending" || f.incoming !== true) return null;
  const fr = normalizeFriend(raw);
  if (!fr) return null;
  return { id: fr.id, username: fr.username, ts: Date.now() };
}

function normalizeFriendRequest(msg: ServerMsg): FriendRequest | null {
  const raw = msg.friend_request;
  if (raw && typeof raw === "object") {
    const f = raw as Record<string, unknown>;
    if (typeof f.id === "number" && typeof f.username === "string")
      return { id: f.id, username: f.username, name: typeof f.name === "string" ? f.name : undefined, ts: Date.now() };
  }
  const id = senderIdOf(msg);
  if (id === null) return null;
  return { id, username: senderNameOf(msg, `Player ${id}`), ts: Date.now() };
}

function normalizeRoom(raw: unknown): RoomEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = r.id;
  if (typeof id !== "string" && typeof id !== "number") return null;
  const name = typeof r.name === "string" ? r.name : null;
  if (!name) return null;
  return {
    id,
    name,
    topic: typeof r.topic === "string" ? r.topic : undefined,
    icon: typeof r.icon === "string" ? r.icon : undefined,
    members: typeof r.members === "number" ? r.members : undefined,
    ownerId:
      typeof r.creator_id === "number"
        ? r.creator_id
        : typeof r.ownerId === "number"
          ? r.ownerId
          : null,
    unread: typeof r.unread === "number" ? r.unread : 0,
    joined: r.joined === true,
  };
}

function normalizeRoomMessage(msg: ServerMsg): RoomMessage | null {
  if (msg.roomId === undefined || msg.roomId === null) return null;
  if (typeof msg.text !== "string" || !msg.text.trim()) return null;
  // Server puts the sender's player id in `id` on room messages + history.
  const sid = chatSenderId(msg);
  const ts = typeof msg.ts === "number" ? msg.ts : Date.now();
  return {
    id: sid !== null ? `${msg.roomId}:${ts}:${sid}` : `x:${ts}:${Math.random().toString(36).slice(2)}`,
    roomId: msg.roomId,
    senderId: sid,
    name: senderNameOf(msg, "?"),
    text: msg.text,
    ts,
    gov: msg.gov === true,
  };
}

function normalizeRoomMember(raw: unknown): RoomMember | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  // Server shape: {player_id, username, role, muted_until}; legacy: {id,...}.
  const id = typeof m.player_id === "number" ? m.player_id : typeof m.id === "number" ? m.id : null;
  if (id === null) return null;
  const username = typeof m.username === "string" ? m.username : typeof m.name === "string" ? m.name : `Player ${id}`;
  const role = typeof m.role === "string" ? m.role : "";
  return {
    id,
    username,
    name: typeof m.name === "string" ? m.name : undefined,
    online: m.online === true,
    muted:
      m.muted === true ||
      (typeof m.muted_until === "number" && m.muted_until > Date.now()),
    isOwner: role === "owner" || m.isOwner === true || m.owner === true,
  };
}

function normalizeDmThread(raw: unknown): DmThread | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  // Server shape: {pid, username, last_text, last_ts, unread}.
  const id =
    typeof t.pid === "number" ? t.pid : typeof t.id === "number" ? t.id : null;
  if (id === null) return null;
  const username =
    typeof t.username === "string" ? t.username : typeof t.name === "string" ? t.name : `Player ${id}`;
  return {
    id,
    username,
    name: typeof t.name === "string" ? t.name : undefined,
    lastText:
      typeof t.last_text === "string"
        ? t.last_text
        : typeof t.lastText === "string"
          ? t.lastText
          : typeof t.last === "string"
            ? t.last
            : undefined,
    lastTs: typeof t.last_ts === "number" ? t.last_ts : typeof t.lastTs === "number" ? t.lastTs : undefined,
    unread: typeof t.unread === "number" ? t.unread : 0,
  };
}

/**
 * Normalize a DM row. Server history rows are `{from_id, to_id, text, ts}`
 * (no id); live `{t:'dm'}` rows carry `from` + `fromName`.
 */
function normalizeDmMessage(
  raw: unknown,
  myId: number | null,
  peer: number,
  peerName?: string
): DmMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const text = typeof m.text === "string" ? m.text : null;
  if (!text) return null;
  const fromRaw = m.from;
  const fromId =
    typeof fromRaw === "number"
      ? fromRaw
      : fromRaw && typeof fromRaw === "object" && typeof (fromRaw as Record<string, unknown>).id === "number"
        ? ((fromRaw as Record<string, unknown>).id as number)
        : typeof m.from_id === "number"
          ? m.from_id
          : typeof m.fromId === "number"
            ? m.fromId
            : typeof m.senderId === "number"
              ? m.senderId
              : null;
  const fromName =
    typeof m.fromName === "string"
      ? m.fromName
      : fromRaw && typeof fromRaw === "object" && typeof (fromRaw as Record<string, unknown>).username === "string"
        ? String((fromRaw as Record<string, unknown>).username)
        : typeof m.name === "string"
          ? m.name
          : (peerName ?? "Player");
  const mine = fromId !== null && myId !== null && fromId === myId;
  const ts = typeof m.ts === "number" ? m.ts : Date.now();
  return {
    id: typeof m.id === "number" ? m.id : `${peer}:${ts}:${fromId ?? "x"}`,
    with: peer,
    fromId: fromId ?? (mine && myId !== null ? myId : -1),
    fromName: mine ? "You" : fromName,
    text,
    ts,
    mine,
  };
}

function loadBlocked(): Record<number, string> {
  try {
    const raw = window.localStorage.getItem(BLOCK_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<number, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const id = Number(k);
      if (Number.isFinite(id) && id > 0 && typeof v === "string") out[id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export interface GameSocket {
  status: SocketStatus;
  connected: boolean;
  attempts: number;
  you: You | null;
  players: PlayerLite[];
  day: number;
  endsIn: number;
  online: number;
  config: GameConfig | null;
  chat: ChatEntry[];
  /** Live street-find spawns (💵/🍲/🥤) from `spawn`/`despawn`. */
  spawns: StreetSpawn[];
  queued: number;
  lastError: string | null;
  sendAct: (a: ActName, params?: Record<string, unknown>) => void;
  /** Pick up a street-find spawn — sent as `act` a:"collect" (server checks proximity). */
  sendCollect: (id: string | number) => void;
  sendChat: (text: string) => void;
  retryNow: () => void;

  /* ---------------- M5: elections ---------------- */
  election: ElectionState | null;
  governor: GovernorInfo | null;
  /** Fresh `{t:'gov'}` announcement waiting to be shown as a banner. */
  govBanner: GovernorInfo | null;
  clearGovBanner: () => void;
  runForGovernor: () => void;
  voteFor: (candidateId: number) => void;
  sendGovBroadcast: (text: string) => void;

  /* ---------------- M5: friends ---------------- */
  friends: FriendEntry[];
  friendRequests: FriendRequest[];
  addFriend: (username: string) => void;
  acceptFriend: (playerId: number) => void;
  declineFriend: (playerId: number) => void;
  removeFriend: (playerId: number) => void;
  isFriend: (playerId: number) => boolean;

  /* ---------------- M5: rooms ---------------- */
  rooms: RoomEntry[];
  roomMessages: Record<string, RoomMessage[]>;
  roomMembers: Record<string, RoomMember[]>;
  roomUnread: Record<string, number>;
  setActiveRoom: (roomId: string | number | null) => void;
  createRoom: (name: string, topic: string, icon: string) => void;
  joinRoom: (roomId: string | number) => void;
  leaveRoom: (roomId: string | number) => void;
  sendRoomChat: (roomId: string | number, text: string) => void;
  readRoom: (roomId: string | number) => void;
  requestRoomMembers: (roomId: string | number) => void;
  kickRoomMember: (roomId: string | number, playerId: number) => void;
  muteRoomMember: (roomId: string | number, playerId: number, minutes: number) => void;

  /* ---------------- M5: DMs ---------------- */
  dmThreads: DmThread[];
  dmMessages: Record<string, DmMessage[]>;
  /** Unread count for one thread (peer player id). */
  dmUnreadFor: (peerId: number) => number;
  /** Total unread DMs (tab badge). */
  dmUnreadTotal: number;
  setActiveDm: (peerId: number | null) => void;
  sendDm: (to: number, text: string) => void;
  requestDmThreads: () => void;
  requestDmHistory: (peerId: number) => void;
  readDm: (peerId: number) => void;

  /* ---------------- M5: safety ---------------- */
  /** Client-side block list (also enforced server-side when the M5 server lands). */
  blocked: Record<number, string>;
  isBlocked: (playerId: number | null | undefined) => boolean;
  blockUser: (playerId: number, username?: string) => void;
  unblockUser: (playerId: number) => void;
  reportUser: (playerId: number, reason: string) => void;

  /** Top-level social sender for message types not covered above. */
  sendSocial: (t: string, params?: Record<string, unknown>) => void;
}

/**
 * WebSocket client for the Èkó Life game hub.
 * - Connects with `?token=`; auto-reconnects with backoff (max 5 tries, then manual retry).
 * - Routes `init`/`you`/`chat`/`sys`/`err`/`day`/`stats`/presence into state + toasts.
 * - M5: routes election/friends/rooms/DM/safety messages; filters blocked senders.
 * - `sendAct` queues while offline and flushes on reconnect.
 * - Never computes game state: it only displays server snapshots.
 */
export function useGameSocket(token: string | null): GameSocket {
  const { toast } = useToast();
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const [attempts, setAttempts] = useState(0);
  const [you, setYou] = useState<You | null>(null);
  const [players, setPlayers] = useState<PlayerLite[]>([]);
  const [day, setDay] = useState(1);
  const [endsIn, setEndsIn] = useState(0);
  const [online, setOnline] = useState(0);
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [spawns, setSpawns] = useState<StreetSpawn[]>([]);
  const [queued, setQueued] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  // --- M5 state ---
  const [election, setElection] = useState<ElectionState | null>(null);
  const [governor, setGovernor] = useState<GovernorInfo | null>(null);
  const [govBanner, setGovBanner] = useState<GovernorInfo | null>(null);
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [rooms, setRooms] = useState<RoomEntry[]>([]);
  const [roomMessages, setRoomMessages] = useState<Record<string, RoomMessage[]>>({});
  const [roomMembers, setRoomMembers] = useState<Record<string, RoomMember[]>>({});
  const [roomUnread, setRoomUnread] = useState<Record<string, number>>({});
  const [dmThreads, setDmThreads] = useState<DmThread[]>([]);
  const [dmMessages, setDmMessages] = useState<Record<string, DmMessage[]>>({});
  const [dmUnread, setDmUnread] = useState<Record<string, number>>({});
  /** Server-authoritative total (`{t:'dm_unread', n}`) — null until first push. */
  const [dmTotal, setDmTotal] = useState<number | null>(null);
  const [blocked, setBlocked] = useState<Record<number, string>>(loadBlocked);

  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const queueRef = useRef<string[]>([]);
  const cancelledRef = useRef(false);
  const connectRef = useRef<() => void>(() => {});
  const toastRef = useRef(toast);
  toastRef.current = toast;
  /** My player id (for DM direction); set from `you`. */
  const myIdRef = useRef<number | null>(null);
  /** Which room/DM the UI has open — incoming messages bump unread instead. */
  const activeRoomRef = useRef<string | number | null>(null);
  const activeDmRef = useRef<number | null>(null);
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  /** Lets handleMessage (inside the token effect) send top-level messages. */
  const sendViaRef = useRef<(t: string, params?: Record<string, unknown>) => void>(
    () => {}
  );

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const closeSocket = () => {
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.onopen = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  };

  useEffect(() => {
    if (!token) {
      setStatus("failed");
      setLastError("No session. Please sign in again.");
      return;
    }
    cancelledRef.current = false;
    const cancelled = () => cancelledRef.current;

    const scheduleRetry = () => {
      const n = attemptRef.current;
      if (n >= MAX_ATTEMPTS) {
        setStatus("failed");
        setLastError("Lost connection to the city. Tap retry to reconnect.");
        return;
      }
      attemptRef.current = n + 1;
      setAttempts(n + 1);
      setStatus("retrying");
      const delay = Math.min(1000 * 2 ** n, 15_000);
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        if (!cancelled()) connectRef.current();
      }, delay);
    };

    const isBlocked = (id: number | null | undefined) =>
      id !== null && id !== undefined && id in blockedRef.current;

    const handleMessage = (msg: ServerMsg) => {
      const say = toastRef.current;
      switch (msg.t) {
        case "init":
          if (msg.you) {
            setYou(msg.you);
            myIdRef.current = msg.you.id;
          }
          if (msg.players) setPlayers(msg.players);
          if (typeof msg.day === "number") setDay(msg.day);
          if (typeof msg.endsIn === "number") setEndsIn(msg.endsIn);
          if (typeof msg.online === "number") setOnline(msg.online);
          if (msg.chat) {
            const entries = (Array.isArray(msg.chat) ? msg.chat : [])
              .map((c) => normalizeChatEntry(c as unknown as ServerMsg))
              .filter((c): c is ChatEntry => c !== null);
            setChat(entries.slice(-MSG_KEEP));
          }
          if (msg.config) {
            const cfg = normalizeConfig(msg.config);
            if (cfg) setConfig(cfg);
          }
          if (msg.governor !== undefined) {
            const g = msg.governor;
            if (g && typeof g === "object")
              setGovernor({
                id: typeof g.id === "number" ? g.id : null,
                name: typeof g.name === "string" ? g.name : null,
              });
            else setGovernor(g ? { id: null, name: String(g) } : null);
          }
          if (msg.election) {
            const e = normalizeElection({ t: "election", election: msg.election });
            if (e) setElection(e);
          }
          if (msg.friends && Array.isArray(msg.friends)) {
            const fs = msg.friends
              .map(normalizeFriend)
              .filter((f): f is FriendEntry => f !== null);
            setFriends(fs);
            // Incoming pending requests surface from the roster rows too —
            // they carry {status:'pending', incoming:true}.
            const incoming = msg.friends
              .map(pendingRequestFromRow)
              .filter((r): r is FriendRequest => r !== null);
            if (incoming.length > 0) setFriendRequests(incoming);
          }
          if (msg.rooms && Array.isArray(msg.rooms)) {
            const rs = msg.rooms
              .map(normalizeRoom)
              .filter((r): r is RoomEntry => r !== null);
            setRooms(rs);
          }
          if (typeof msg.unreadDm === "number") setDmTotal(msg.unreadDm);
          break;
        case "you":
          if (msg.you) {
            setYou(msg.you);
            myIdRef.current = msg.you.id;
          }
          if (msg.note) say(msg.note, "info");
          break;
        case "chat": {
          const entry = normalizeChatEntry(msg);
          if (!entry || isBlocked(entry.senderId)) break;
          setChat((prev) => [...prev, entry].slice(-MSG_KEEP));
          break;
        }
        case "sys":
          if (msg.text) say(msg.text, "info");
          break;
        case "err":
          if (msg.text) say(msg.text, "error");
          break;
        case "day":
          // The Game view renders the day banner; the hook only tracks state.
          if (typeof msg.day === "number") setDay(msg.day);
          if (typeof msg.endsIn === "number") setEndsIn(msg.endsIn);
          break;
        case "stats":
          if (typeof msg.online === "number") setOnline(msg.online);
          break;
        case "spawn": {
          const s = normalizeSpawn(msg.s);
          if (s) {
            setSpawns((prev) => {
              const next = prev.filter((p) => p.id !== s.id);
              next.push(s);
              return next.slice(-SPAWN_KEEP);
            });
          }
          break;
        }
        case "despawn": {
          const id = msg.id ?? msg.spawnId ?? msg.s?.id;
          if (id !== undefined && id !== null) {
            setSpawns((prev) => prev.filter((p) => p.id !== id));
          }
          break;
        }
        case "join":
          if (msg.p)
            setPlayers((prev) =>
              prev.some((p) => p.id === msg.p!.id) ? prev : [...prev, msg.p!]
            );
          break;
        case "leave":
          if (typeof msg.id === "number")
            setPlayers((prev) => prev.filter((p) => p.id !== msg.id));
          break;
        case "mv":
          if (
            typeof msg.id === "number" &&
            typeof msg.lat === "number" &&
            typeof msg.lng === "number"
          ) {
            setPlayers((prev) =>
              prev.map((p) =>
                p.id === msg.id ? { ...p, lat: msg.lat!, lng: msg.lng! } : p
              )
            );
          }
          break;

        /* ---------------- M5: elections ---------------- */
        case "election": {
          const e = normalizeElection(msg);
          if (e) setElection(e);
          break;
        }
        case "gov": {
          // Server: broadcast({ t:'gov', id: winnerId, name }).
          const info: GovernorInfo = {
            id: typeof msg.id === "number" ? msg.id : null,
            name: typeof msg.name === "string" ? msg.name : null,
          };
          setGovernor(info);
          setGovBanner(info);
          say(info.name ? `👑 @${info.name} is the new governor of Èkó Life!` : "👑 A new governor has been elected!", "success");
          break;
        }

        /* ---------------- M5: friends ---------------- */
        case "friends":
          if (Array.isArray(msg.friends)) {
            setFriends(
              msg.friends
                .map(normalizeFriend)
                .filter((f): f is FriendEntry => f !== null)
            );
            const incoming = msg.friends
              .map(pendingRequestFromRow)
              .filter((r): r is FriendRequest => r !== null);
            setFriendRequests((prev) => {
              const seen = new Set(incoming.map((r) => r.id));
              const kept = prev.filter((r) => !seen.has(r.id));
              return [...kept, ...incoming];
            });
          }
          break;
        case "friend_request": {
          const req = normalizeFriendRequest(msg);
          if (!req || isBlocked(req.id)) break;
          setFriendRequests((prev) =>
            prev.some((r) => r.id === req.id) ? prev : [...prev, req]
          );
          say(`🤝 Friend request from @${req.username}`, "info");
          break;
        }
        case "friend_removed":
        case "friend_accepted":
        case "friend_declined":
          // Server tells us the roster changed — re-render from the next
          // `friends` push; drop the matching pending request if present.
          if (typeof msg.id === "number") {
            const pid = msg.id;
            setFriendRequests((prev) => prev.filter((r) => r.id !== pid));
          }
          break;

        /* ---------------- M5: rooms ---------------- */
        case "rooms":
          if (Array.isArray(msg.rooms)) {
            setRooms(
              msg.rooms
                .map(normalizeRoom)
                .filter((r): r is RoomEntry => r !== null)
            );
          }
          break;
        case "room_joined": {
          // Server shape: {t:'room_joined', roomId, history?[, election]} —
          // the refreshed room list arrives via broadcast `{t:'rooms'}`.
          const rid = msg.roomId;
          if (rid === undefined || rid === null) break;
          const key = String(rid);
          if (Array.isArray(msg.history)) {
            const rows = msg.history
              .map((h) =>
                normalizeRoomMessage({
                  t: "room_msg",
                  roomId: rid,
                  ...(h as Record<string, unknown>),
                } as unknown as ServerMsg)
              )
              .filter((m): m is RoomMessage => m !== null)
              .slice(-MSG_KEEP);
            setRoomMessages((prev) => ({ ...prev, [key]: rows }));
          }
          if (msg.election) {
            const e = normalizeElection({ t: "election", election: msg.election });
            if (e) setElection(e);
          }
          say("🚪 Joined the room", "info");
          break;
        }
        case "room_left": {
          const rid = msg.roomId;
          if (rid !== undefined && rid !== null) {
            setRooms((prev) => prev.filter((r) => String(r.id) !== String(rid)));
            if (String(activeRoomRef.current) === String(rid)) activeRoomRef.current = null;
          }
          break;
        }
        case "room_msg": {
          const rm = normalizeRoomMessage(msg);
          if (!rm || isBlocked(rm.senderId)) break;
          const key = String(rm.roomId);
          setRoomMessages((prev) => ({
            ...prev,
            [key]: [...(prev[key] ?? []), rm].slice(-MSG_KEEP),
          }));
          if (String(activeRoomRef.current) !== key) {
            setRoomUnread((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
            setRooms((prev) =>
              prev.map((r) =>
                String(r.id) === key ? { ...r, unread: (r.unread ?? 0) + 1 } : r
              )
            );
          }
          break;
        }
        case "room_unread": {
          // Server may send {roomId, n} or a map of roomId->count.
          const raw = msg.room_unread;
          if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            const map: Record<string, number> = {};
            for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
              if (typeof v === "number") map[k] = v;
            }
            setRoomUnread((prev) => ({ ...prev, ...map }));
          } else if (msg.roomId !== undefined && typeof (msg.n ?? msg.unread) === "number") {
            setRoomUnread((prev) => ({ ...prev, [String(msg.roomId)]: (msg.n ?? msg.unread) as number }));
          }
          break;
        }
        case "room_members": {
          if (msg.roomId !== undefined && msg.room_members !== undefined) {
            const members = (Array.isArray(msg.room_members) ? msg.room_members : [])
              .map(normalizeRoomMember)
              .filter((m): m is RoomMember => m !== null);
            setRoomMembers((prev) => ({ ...prev, [String(msg.roomId)]: members }));
          }
          break;
        }

        /* ---------------- M5: DMs ---------------- */
        case "dm": {
          // Server shape: {t:'dm', from:<id>, fromName, text, ts}.
          const fromId = senderIdOf(msg);
          if (fromId === null || isBlocked(fromId)) break;
          const peer = fromId;
          const dm = normalizeDmMessage(msg, myIdRef.current, peer, senderNameOf(msg, "?"));
          if (!dm) break;
          const key = String(peer);
          setDmMessages((prev) => ({
            ...prev,
            [key]: [...(prev[key] ?? []), dm].slice(-MSG_KEEP),
          }));
          setDmTotal(null); // per-thread counts now authoritative-ish; server sends totals on read
          // Keep thread list alive even before dm_threads loads.
          setDmThreads((prev) =>
            prev.some((t) => t.id === peer)
              ? prev.map((t) =>
                  t.id === peer
                    ? {
                        ...t,
                        lastText: dm.text,
                        lastTs: dm.ts,
                        unread: activeDmRef.current === peer ? (t.unread ?? 0) : (t.unread ?? 0) + 1,
                      }
                    : t
                )
              : [
                  ...prev,
                  {
                    id: peer,
                    username: dm.fromName,
                    lastText: dm.text,
                    lastTs: dm.ts,
                    unread: activeDmRef.current === peer ? 0 : 1,
                  },
                ]
          );
          if (activeDmRef.current === peer) {
            // Already reading it — mark read so the total stays accurate.
            sendViaRef.current("dm_read", { with: peer });
          } else {
            say(`💬 @${dm.fromName}: ${dm.text.slice(0, 80)}`, "info");
          }
          break;
        }
        case "dm_sent": {
          // Server echo is just {t:'dm_sent', to} — the optimistic echo in
          // sendDm already rendered the message; refresh the thread list.
          sendViaRef.current("dm_threads");
          break;
        }
        case "dm_threads":
          if (Array.isArray(msg.dm_threads)) {
            const threads = msg.dm_threads
              .map(normalizeDmThread)
              .filter((t): t is DmThread => t !== null);
            setDmThreads(threads);
            const counts: Record<string, number> = {};
            for (const t of threads) {
              if (t.unread && t.unread > 0) counts[String(t.id)] = t.unread;
            }
            setDmUnread(counts);
          }
          break;
        case "dm_history": {
          // Server shape: {t:'dm_history', with, withName, msgs:[{from_id,to_id,text,ts}]}.
          const rawWith = msg.with;
          const peer =
            typeof rawWith === "number"
              ? rawWith
              : rawWith && typeof rawWith === "object" && typeof rawWith.id === "number"
                ? rawWith.id
                : null;
          const arr = Array.isArray(msg.msgs)
            ? msg.msgs
            : Array.isArray(msg.dm_history)
              ? msg.dm_history
              : null;
          if (peer === null || !arr) break;
          const peerName =
            typeof msg.withName === "string" ? msg.withName : undefined;
          const rows: DmMessage[] = arr
            .map((r, i): DmMessage | null => {
              const dm = normalizeDmMessage(r, myIdRef.current, peer, peerName);
              if (!dm) return null;
              // History rows carry no id — key on position so React stays stable.
              dm.id = `${peer}:${i}:${dm.ts}:${dm.fromId}`;
              return dm;
            })
            .filter((m): m is DmMessage => m !== null)
            .slice(-MSG_KEEP);
          setDmMessages((prev) => ({ ...prev, [String(peer)]: rows }));
          break;
        }
        case "dm_unread": {
          // Server sends the TOTAL: {t:'dm_unread', n}.
          if (typeof msg.n === "number") setDmTotal(msg.n);
          break;
        }
        case "mention": {
          // Server shape: {t:'mention', from:<name string>, where:'city'|'room:<id>',
          //   roomName?, text:<snippet>}.
          const sid = senderIdOf(msg);
          if (isBlocked(sid)) break;
          const from = typeof msg.from === "string" ? msg.from : senderNameOf(msg, "?");
          const whereLabel =
            typeof msg.where === "string" && msg.where.startsWith("room:")
              ? ` in ${msg.roomName ?? "a room"}`
              : "";
          say(`📣 @${from} mentioned you${whereLabel}`, "info");
          break;
        }
        case "blocks": {
          // Authoritative block list from the server.
          if (Array.isArray(msg.blocks)) {
            const next: Record<number, string> = {};
            for (const b of msg.blocks) {
              if (!b || typeof b !== "object") continue;
              const r = b as Record<string, unknown>;
              const id =
                typeof r.blocked_id === "number"
                  ? r.blocked_id
                  : typeof r.id === "number"
                    ? r.id
                    : null;
              if (id !== null)
                next[id] =
                  typeof r.username === "string" ? r.username : `Player ${id}`;
            }
            setBlocked(next);
            try {
              window.localStorage.setItem(BLOCK_KEY, JSON.stringify(next));
            } catch {
              /* ignore */
            }
          }
          break;
        }

        default:
          // Future message types are ignored safely (client stays forward-compatible).
          break;
      }
    };

    const authFailure = (code: number) => {
      setStatus("failed");
      if (code === 4403) setLastError("This account is banned.");
      else if (code === 4409)
        setLastError("Signed in on another device — this session was closed.");
      else setLastError("Session expired. Please sign in again.");
    };

    const connect = () => {
      if (cancelled()) return;
      clearTimer();
      closeSocket();
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl(token));
      } catch {
        scheduleRetry();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled()) return;
        attemptRef.current = 0;
        setAttempts(0);
        setStatus("open");
        setLastError(null);
        // Flush queued acts in order.
        const pending = queueRef.current;
        queueRef.current = [];
        setQueued(0);
        for (const raw of pending) {
          try {
            ws.send(raw);
          } catch {
            queueRef.current.push(raw);
          }
        }
        setQueued(queueRef.current.length);
        if (pending.length && queueRef.current.length === 0)
          toastRef.current("Back online — queued actions sent.", "success");
        // M5: pull social lists once the session is up (server ignores
        // unknown types safely; no-ops when M5 isn't live yet).
        for (const t of ["friends", "rooms", "dm_threads", "blocks"]) {
          try {
            ws.send(JSON.stringify({ t }));
          } catch {
            /* ignore */
          }
        }
      };

      ws.onmessage = (ev) => {
        let msg: ServerMsg | null = null;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg && typeof msg.t === "string") handleMessage(msg);
      };

      ws.onclose = (ev) => {
        if (cancelled()) return;
        wsRef.current = null;
        if (ev.code === 4401 || ev.code === 4403 || ev.code === 4409) {
          authFailure(ev.code); // won't heal by retrying
          return;
        }
        scheduleRetry();
      };

      ws.onerror = () => {
        // onclose follows; nothing to do here.
      };
    };

    connectRef.current = connect;
    setStatus("connecting");
    connect();

    return () => {
      cancelledRef.current = true;
      clearTimer();
      closeSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const sendRaw = useCallback((raw: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(raw);
        return;
      } catch {
        /* fall through to queue */
      }
    }
    queueRef.current.push(raw);
    setQueued(queueRef.current.length);
  }, []);

  const sendAct = useCallback(
    (a: ActName, params?: Record<string, unknown>) => {
      sendRaw(JSON.stringify({ t: "act", a, ...(params ?? {}) }));
    },
    [sendRaw]
  );

  /** Top-level social sender (friends / rooms / dm / safety intents). */
  const sendSocial = useCallback(
    (t: string, params?: Record<string, unknown>) => {
      sendRaw(JSON.stringify({ t, ...(params ?? {}) }));
    },
    [sendRaw]
  );
  // HandleMessage (inside the token effect) uses this ref to send reads.
  sendViaRef.current = sendSocial;

  const sendChat = useCallback(
    (text: string) => {
      const clean = text.trim().slice(0, 200);
      if (!clean) return;
      sendRaw(JSON.stringify({ t: "chat", text: clean }));
    },
    [sendRaw]
  );

  const sendCollect = useCallback(
    (id: string | number) => {
      // `collect` rides the standard act envelope; the server validates
      // proximity and consumes the spawn.
      sendRaw(JSON.stringify({ t: "act", a: "collect", id }));
    },
    [sendRaw]
  );

  /* ---------------- M5 outgoing helpers ---------------- */
  const runForGovernor = useCallback(() => sendAct("run"), [sendAct]);
  const voteFor = useCallback(
    (candidateId: number) => sendAct("vote", { candidate: candidateId }),
    [sendAct]
  );
  const sendGovBroadcast = useCallback(
    (text: string) => {
      const clean = text.trim().slice(0, 200);
      if (clean) sendAct("gov_broadcast", { text: clean });
    },
    [sendAct]
  );
  const clearGovBanner = useCallback(() => setGovBanner(null), []);

  const addFriend = useCallback(
    (username: string) => {
      const clean = username.trim().slice(0, 16);
      if (clean) sendSocial("friend_add", { username: clean });
    },
    [sendSocial]
  );
  const acceptFriend = useCallback(
    (playerId: number) => {
      sendSocial("friend_accept", { playerId });
      setFriendRequests((prev) => prev.filter((r) => r.id !== playerId));
    },
    [sendSocial]
  );
  const declineFriend = useCallback(
    (playerId: number) => {
      sendSocial("friend_decline", { playerId });
      setFriendRequests((prev) => prev.filter((r) => r.id !== playerId));
    },
    [sendSocial]
  );
  const removeFriend = useCallback(
    (playerId: number) => {
      sendSocial("friend_remove", { playerId });
      setFriends((prev) => prev.filter((f) => f.id !== playerId));
    },
    [sendSocial]
  );
  const isFriend = useCallback(
    (playerId: number) => friends.some((f) => f.id === playerId),
    [friends]
  );

  const createRoom = useCallback(
    (name: string, topic: string, icon: string) =>
      sendSocial("create_room", {
        name: name.trim().slice(0, 40),
        topic: topic.trim().slice(0, 120),
        icon: icon || "💬",
      }),
    [sendSocial]
  );
  const joinRoom = useCallback(
    (roomId: string | number) => sendSocial("join_room", { roomId }),
    [sendSocial]
  );
  const leaveRoom = useCallback(
    (roomId: string | number) => sendSocial("leave_room", { roomId }),
    [sendSocial]
  );
  const sendRoomChat = useCallback(
    (roomId: string | number, text: string) => {
      const clean = text.trim().slice(0, 200);
      if (clean) sendSocial("room_chat", { roomId, text: clean });
    },
    [sendSocial]
  );
  const readRoom = useCallback(
    (roomId: string | number) => {
      const key = String(roomId);
      setRoomUnread((prev) => ({ ...prev, [key]: 0 }));
      setRooms((prev) => prev.map((r) => (String(r.id) === key ? { ...r, unread: 0 } : r)));
      sendSocial("room_read", { roomId });
    },
    [sendSocial]
  );
  const requestRoomMembers = useCallback(
    (roomId: string | number) => sendSocial("room_members", { roomId }),
    [sendSocial]
  );
  const kickRoomMember = useCallback(
    (roomId: string | number, playerId: number) =>
      sendSocial("kick_room", { roomId, playerId }),
    [sendSocial]
  );
  const muteRoomMember = useCallback(
    (roomId: string | number, playerId: number, minutes: number) =>
      sendSocial("mute_room", { roomId, playerId, minutes }),
    [sendSocial]
  );
  const setActiveRoom = useCallback(
    (roomId: string | number | null) => {
      activeRoomRef.current = roomId;
    },
    []
  );

  const sendDm = useCallback(
    (to: number, text: string) => {
      const clean = text.trim().slice(0, 200);
      if (!clean) return;
      sendSocial("dm", { to, text: clean });
      // Optimistic echo — replaced/confirmed by `dm_sent` / `dm_history`.
      const myId = myIdRef.current;
      const dm: DmMessage = {
        id: Date.now() + Math.random(),
        with: to,
        fromId: myId ?? -1,
        fromName: "You",
        text: clean,
        ts: Date.now(),
        mine: true,
      };
      const key = String(to);
      setDmMessages((prev) => ({
        ...prev,
        [key]: [...(prev[key] ?? []), dm].slice(-MSG_KEEP),
      }));
      setDmThreads((prev) =>
        prev.some((t) => t.id === to)
          ? prev.map((t) => (t.id === to ? { ...t, lastText: clean, lastTs: Date.now() } : t))
          : prev
      );
    },
    [sendSocial]
  );
  const requestDmThreads = useCallback(() => sendSocial("dm_threads"), [sendSocial]);
  const requestDmHistory = useCallback(
    (peerId: number) => sendSocial("dm_history", { with: peerId }),
    [sendSocial]
  );
  const readDm = useCallback(
    (peerId: number) => {
      setDmUnread((prev) => ({ ...prev, [String(peerId)]: 0 }));
      setDmThreads((prev) =>
        prev.map((t) => (t.id === peerId ? { ...t, unread: 0 } : t))
      );
      sendSocial("dm_read", { with: peerId });
    },
    [sendSocial]
  );
  const setActiveDm = useCallback((peerId: number | null) => {
    activeDmRef.current = peerId;
  }, []);

  const isBlocked = useCallback(
    (playerId: number | null | undefined) =>
      typeof playerId === "number" && playerId in blocked,
    [blocked]
  );
  const blockUser = useCallback(
    (playerId: number, username?: string) => {
      setBlocked((prev) => {
        const next = { ...prev, [playerId]: username ?? `Player ${playerId}` };
        try {
          window.localStorage.setItem(BLOCK_KEY, JSON.stringify(next));
        } catch {
          /* private mode — state still holds */
        }
        return next;
      });
      sendSocial("block", { playerId });
    },
    [sendSocial]
  );
  const unblockUser = useCallback(
    (playerId: number) => {
      setBlocked((prev) => {
        const next = { ...prev };
        delete next[playerId];
        try {
          window.localStorage.setItem(BLOCK_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
      sendSocial("unblock", { playerId });
    },
    [sendSocial]
  );
  const reportUser = useCallback(
    (playerId: number, reason: string) => {
      sendSocial("report", { playerId, reason: reason.slice(0, 120) });
    },
    [sendSocial]
  );

  const retryNow = useCallback(() => {
    attemptRef.current = 0;
    setAttempts(0);
    setStatus("connecting");
    setLastError(null);
    clearTimer();
    connectRef.current();
  }, []);

  const perThreadUnread = Object.values(dmUnread).reduce(
    (a, b) => a + (b || 0),
    0
  );
  /** Badge total: server's authoritative `{t:'dm_unread', n}`, falling back
   *  to summed per-thread counts before the first push arrives. */
  const dmUnreadTotal = dmTotal ?? perThreadUnread;
  const dmUnreadFor = useCallback(
    (peerId: number) => dmUnread[String(peerId)] ?? 0,
    [dmUnread]
  );

  return {
    status,
    connected: status === "open",
    attempts,
    you,
    players,
    day,
    endsIn,
    online,
    config,
    chat,
    spawns,
    queued,
    lastError,
    sendAct,
    sendCollect,
    sendChat,
    retryNow,

    election,
    governor,
    govBanner,
    clearGovBanner,
    runForGovernor,
    voteFor,
    sendGovBroadcast,

    friends,
    friendRequests,
    addFriend,
    acceptFriend,
    declineFriend,
    removeFriend,
    isFriend,

    rooms,
    roomMessages,
    roomMembers,
    roomUnread,
    setActiveRoom,
    createRoom,
    joinRoom,
    leaveRoom,
    sendRoomChat,
    readRoom,
    requestRoomMembers,
    kickRoomMember,
    muteRoomMember,

    dmThreads,
    dmMessages,
    dmUnreadFor,
    dmUnreadTotal,
    setActiveDm,
    sendDm,
    requestDmThreads,
    requestDmHistory,
    readDm,

    blocked,
    isBlocked,
    blockUser,
    unblockUser,
    reportUser,

    sendSocial,
  };
}
