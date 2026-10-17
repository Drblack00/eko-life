// ============================================================
// game/elections.js — Èkó Life governor elections (M5)
// 7-game-day cycle: run (fee) → vote → tally → new governor.
// The DB layer owns persistence; this module owns the cycle
// lifecycle and the election state payload shape. tallyElection
// takes its realtime side effects as deps so it stays testable.
// ============================================================
import {
  currentElection, createElection, closeElection, listCandidates, hasVoted,
  addCandidate, castVote,
  getUserById, getMeta, setMeta, listRooms, deleteRoom,
  dbRun, dbGet, dbAll,
} from '../db.js';

// Re-export the DB election primitives so callers only import from here.
export {
  currentElection, createElection, closeElection, listCandidates, hasVoted,
  addCandidate, castVote,
};

export const ELECTION_DAYS = 7;
export const RUN_FEE = 50000;
export const GOV_SALARY = 25000;
export const GOV_BROADCAST_COOLDOWN_MS = 24 * 3600 * 1000;

// ---- pure state payload (shared by WS `init`, `election` pushes, admin) ----
export function electionState(el, candidates, { playerId = null, voted = false, governorId = 0, day = 1 } = {}) {
  if (!el) return { active: false };
  const cands = (candidates || []).map(c => ({
    player_id: Number(c.player_id),
    username: c.username,
    votes: Number(c.votes) || 0,
  }));
  return {
    active: true,
    id: Number(el.id),
    startDay: Number(el.start_day),
    endDay: Number(el.end_day),
    endsInDays: Math.max(0, Number(el.end_day) - Number(day)),
    candidates: cands,
    voted: !!voted,
    running: playerId != null && cands.some(c => c.player_id === Number(playerId)),
    governorId: Number(governorId) || 0,
  };
}

// Create the current cycle if none exists (boot + day-tick safety net).
export async function ensureElection(day) {
  let el = await currentElection();
  if (!el) el = await createElection(day, day + ELECTION_DAYS);
  return el;
}

// Per-player election payload (voted/running flags for this player).
// M11: also carries the sitting governor's policy + the commissioners
// cabinet, so every `{t:'election'}` push is self-contained.
export async function playerElectionState(playerId, day, governorId) {
  const el = await currentElection();
  if (!el) return { active: false };
  const cands = await listCandidates(el.id);
  const voted = playerId ? await hasVoted(el.id, playerId) : false;
  return {
    ...electionState(el, cands, { playerId, voted, governorId, day }),
    ...(await electionExtras(playerId, governorId)),
  };
}

// Async wrapper for REST (admin /election) — same payload as the WS pushes.
export async function fullElectionState(el, candidates, { governorId = 0, day = 1 } = {}) {
  return {
    ...electionState(el, candidates, { governorId, day }),
    ...(await electionExtras(null, governorId)),
  };
}

// ---- tally: most votes wins; ties → lowest player id ----
// deps: { day, broadcast(msg), pushNews(type, text)? }
// Broadcasts the sys announcement, {t:'gov'}, a fresh {t:'election'} and a
// news item; opens the next cycle; deletes the finished race's campaign
// rooms. Returns { winnerId, closedRoomIds }.
export async function tallyElection({ day, broadcast, pushNews }) {
  const el = await currentElection();
  if (!el) return { winnerId: 0, closedRoomIds: [] };
  const cands = await listCandidates(el.id);
  const sorted = [...cands].sort(
    (a, b) => (Number(b.votes) || 0) - (Number(a.votes) || 0)
      || Number(a.player_id) - Number(b.player_id));
  const top = sorted[0] || null;
  const winnerId = top ? Number(top.player_id) : 0;

  await closeElection(el.id, winnerId || null);

  // M11 — the term's policies expire with the tally: reset all five
  // multipliers to 1, clear the sitting policy, and open a fresh 48h
  // window for the new winner to pick (anchored at tally time).
  await resetPolicyMultipliers();
  await setMeta('gov_policy', '');
  await setMeta('gov_policy_picked', '');
  await setMeta('gov_policy_set_at', '');
  await setMeta('gov_policy_won_at', String(Date.now()));

  if (winnerId) {
    await setMeta('governor_id', winnerId);
    const w = await getUserById(winnerId);
    const name = w ? w.username : 'Someone';
    broadcast({ t: 'sys', text: `👑 ${name} is the new Governor of Èkó!` });
    broadcast({ t: 'gov', id: winnerId, name });
    if (pushNews) pushNews('governor', `👑 ${name} won the governorship!`);
  } else {
    broadcast({ t: 'sys', text: '🗳️ Election ended with no candidates. A new race begins!' });
    if (pushNews) pushNews('election', '🗳️ Election ended with no candidates.');
  }

  const next = await createElection(day, day + ELECTION_DAYS);
  broadcast({ t: 'election', ...(await fullElectionState(next, [], { governorId: winnerId, day })) });
  if (pushNews) pushNews('election', `🗳️ A new governor race is on — days ${day}–${day + ELECTION_DAYS}.`);

  // close the finished race's campaign rooms (auto-created on `run`)
  const closedRoomIds = [];
  try {
    const rooms = await listRooms();
    for (const r of rooms) {
      if (Number(r.creator_id) !== 0 && r.icon === '📣' && /'s Campaign$/.test(r.name)) {
        await deleteRoom(Number(r.id));
        closedRoomIds.push(Number(r.id));
      }
    }
  } catch (e) { console.error('[elections] campaign cleanup:', e.message); }

  console.log(`[elections] #${el.id} tallied, winner=${winnerId || 'none'} (day ${day})`);
  return { winnerId, closedRoomIds };
}

export async function currentGovernorId() {
  return Number((await getMeta('governor_id')) || 0);
}

export async function currentGovernorName() {
  const id = await currentGovernorId();
  if (!id) return null;
  const u = await getUserById(id);
  return u ? u.username : null;
}

// ============================================================
// M11 — Governance with teeth: winner's policy + commissioners
// The sitting governor picks ONE city-wide policy per term (within
// 48h of winning; the default applies automatically afterwards).
// Policies write five meta multiplier keys that other milestones
// read: wage_mult (M7 shift pay), tax_mult (M10 income tax),
// event_mult (M8 city-event probability), market_mult (shop/furniture
// buy prices), decay_mult (M8 needs decay). Every apply writes ALL
// five keys (unset → 1) so policies never stack across terms; the
// tally flow above resets them to 1 at term end.
// Commissioners are flavor + a chat badge: one holder per title,
// appointed/dismissed by the governor, persisted across terms.
// ============================================================

export const POLICY_META_KEYS = ['wage_mult', 'tax_mult', 'event_mult', 'market_mult', 'decay_mult'];
export const POLICY_PICK_WINDOW_MS = 48 * 3600 * 1000;
export const DEFAULT_POLICY_ID = 'wage_boost_10';

// Original policy definitions (names/icons/descriptions are ours).
export const POLICIES = {
  wage_boost_15: {
    name: 'Hustle Pay Rise', icon: '💪',
    desc: 'Shift and gig pay rises 15% across the whole city.',
    mults: { wage_mult: 1.15 },
  },
  tax_free: {
    name: 'Tax-Free Season', icon: '🕊️',
    desc: 'No income tax for the whole term. Keep everything you earn.',
    mults: { tax_mult: 0 },
  },
  market_boom: {
    name: 'Market Boom', icon: '🛒',
    desc: 'Shop and furniture prices drop 10% for buyers.',
    mults: { market_mult: 0.9 },
  },
  event_fever: {
    name: 'Owambe Fever', icon: '🥁',
    desc: 'City events happen twice as often. Turn up!',
    mults: { event_mult: 2 },
  },
  soft_life: {
    name: 'Soft Life Mode', icon: '🛋️',
    desc: 'Needs drain 15% slower — rest easy, Èkó.',
    mults: { decay_mult: 0.85 },
  },
  wage_boost_10: {
    name: 'Steady Hustle', icon: '📈',
    desc: 'Shift pay rises 10% — the safe default when the Governor stays quiet.',
    mults: { wage_mult: 1.1 },
  },
};
// The five the governor may actively pick (the default is automatic).
export const PICKABLE_POLICIES = ['wage_boost_15', 'tax_free', 'market_boom', 'event_fever', 'soft_life'];

// Original playful cabinet titles (one holder per title).
export const COMMISSIONER_TITLES = [
  { title: 'Commissioner for Hustle', icon: '💼' },
  { title: 'Commissioner for Enjoyment', icon: '🎉' },
  { title: 'Commissioner for Waka', icon: '🛵' },
  { title: 'Commissioner for Chop', icon: '🍲' },
  { title: 'Commissioner for Soft Life', icon: '🛋️' },
  { title: 'Commissioner for Street Matter', icon: '📣' },
];

export const COMMISSIONERS_SCHEMA_SQLITE = `CREATE TABLE IF NOT EXISTS commissioners (
  title TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  appointed_at INTEGER NOT NULL
)`;
export const COMMISSIONERS_SCHEMA_PG = `CREATE TABLE IF NOT EXISTS commissioners (
  title TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  appointed_at BIGINT NOT NULL
)`;

// Lazy, memoized schema ensure — the module is self-sufficient even if
// boot wiring is missed (CREATE TABLE IF NOT EXISTS is idempotent).
let _govSchemaReady = false;
export async function ensureGovernanceSchema() {
  if (_govSchemaReady) return;
  await dbRun(COMMISSIONERS_SCHEMA_SQLITE, COMMISSIONERS_SCHEMA_PG);
  _govSchemaReady = true;
}

// ---- policy writes/reads ----

// Write all five multiplier keys from a policy definition (unset → 1).
export async function applyPolicy(id) {
  const p = POLICIES[id];
  if (!p) throw new Error('unknown policy: ' + id);
  const mults = {};
  for (const k of POLICY_META_KEYS) {
    const v = (p.mults && p.mults[k] != null) ? Number(p.mults[k]) : 1;
    mults[k] = v;
    await setMeta(k, String(v));
  }
  await setMeta('gov_policy', id);
  await setMeta('gov_policy_set_at', String(Date.now()));
  return { id, name: p.name, icon: p.icon, desc: p.desc, mults };
}

export async function resetPolicyMultipliers() {
  for (const k of POLICY_META_KEYS) await setMeta(k, String(1));
}

// Lazy default: if the 48h window lapsed with no pick, the default
// policy applies automatically (idempotent — the meta marks it).
async function ensurePolicyDefault() {
  const id = await getMeta('gov_policy');
  if (id && POLICIES[id]) return id;
  const wonAt = Number(await getMeta('gov_policy_won_at')) || 0;
  const govId = await currentGovernorId();
  if (!govId || !wonAt) return null;
  if (Date.now() - wonAt < POLICY_PICK_WINDOW_MS) return null; // window still open
  await applyPolicy(DEFAULT_POLICY_ID);
  console.log(`[elections] policy window lapsed — default ${DEFAULT_POLICY_ID} applied`);
  return DEFAULT_POLICY_ID;
}

// Current effective multipliers (contract for M7/M8/M10). Applies the
// lazy default first so readers always see the term's real values.
export async function getPolicyMultipliers() {
  await ensurePolicyDefault();
  const out = {};
  for (const k of POLICY_META_KEYS) {
    const v = Number(await getMeta(k));
    out[k] = Number.isFinite(v) && v >= 0 ? v : 1;
  }
  return out;
}

// Full policy payload for the election state (viewer-aware can_pick).
export async function getPolicyState(viewerId = null, governorId = 0) {
  await ensureGovernanceSchema();
  const id = await ensurePolicyDefault();
  const wonAt = Number(await getMeta('gov_policy_won_at')) || 0;
  const setAt = Number(await getMeta('gov_policy_set_at')) || 0;
  const gov = Number(governorId) || 0;
  const isGov = gov !== 0 && Number(viewerId) === gov;
  const deadline = wonAt ? wonAt + POLICY_PICK_WINDOW_MS : 0;
  const picked = (await getMeta('gov_policy_picked')) === '1';
  const can_pick = isGov && !picked && wonAt > 0 && Date.now() < deadline;
  const mults = await getPolicyMultipliers();
  if (!id || !POLICIES[id]) {
    return {
      id: null, name: null, icon: '🏛️', desc: null, mults,
      picked: false, defaulted: false, set_at: 0,
      pick_deadline: deadline, can_pick,
    };
  }
  const p = POLICIES[id];
  return {
    id, name: p.name, icon: p.icon, desc: p.desc, mults,
    picked, defaulted: id === DEFAULT_POLICY_ID && !picked,
    set_at: setAt, pick_deadline: deadline, can_pick,
  };
}

// ---- commissioners ----

export async function listCommissioners() {
  await ensureGovernanceSchema();
  const rows = await dbAll(
    `SELECT c.title, c.user_id, c.appointed_at, u.username
     FROM commissioners c LEFT JOIN users u ON u.id = c.user_id
     ORDER BY c.title`,
    `SELECT c.title, c.user_id, c.appointed_at, u.username
     FROM commissioners c LEFT JOIN users u ON u.id = c.user_id
     ORDER BY c.title`);
  return (rows || []).map(r => ({
    title: r.title,
    user_id: Number(r.user_id),
    username: r.username || null,
    appointed_at: Number(r.appointed_at) || 0,
  }));
}

export async function appointCommissioner(title, userId) {
  if (!COMMISSIONER_TITLES.some(t => t.title === title)) throw new Error('unknown title: ' + title);
  await ensureGovernanceSchema();
  await dbRun(
    `INSERT INTO commissioners (title, user_id, appointed_at) VALUES (?,?,?)
     ON CONFLICT(title) DO UPDATE SET user_id=excluded.user_id, appointed_at=excluded.appointed_at`,
    `INSERT INTO commissioners (title, user_id, appointed_at) VALUES ($1,$2,$3)
     ON CONFLICT(title) DO UPDATE SET user_id=excluded.user_id, appointed_at=excluded.appointed_at`,
    [title, Number(userId), Date.now()]);
}

export async function dismissCommissioner(title) {
  await ensureGovernanceSchema();
  await dbRun(
    'DELETE FROM commissioners WHERE title = ?',
    'DELETE FROM commissioners WHERE title = $1',
    [title]);
}

// Chat-badge helper for the coordinator (hub marks commissioner messages).
export async function isCommissioner(userId) {
  await ensureGovernanceSchema();
  const r = await dbGet(
    'SELECT 1 AS x FROM commissioners WHERE user_id = ? LIMIT 1',
    'SELECT 1 AS x FROM commissioners WHERE user_id = $1 LIMIT 1',
    [Number(userId)]);
  return !!r;
}

// Merged into every election state push (WS + REST).
export async function electionExtras(viewerId = null, governorId = 0) {
  const [policy, commissioners] = await Promise.all([
    getPolicyState(viewerId, governorId),
    listCommissioners(),
  ]);
  // PORT-P5: world — begin
  const paused = await isElectionPaused();
  return { policy, commissioners, paused };
  // PORT-P5: world — end
}

// PORT-P5: world — begin
// Election pause: when paused, no tally runs, no new candidacies, no
// votes. The sitting governor keeps the seat until resume.
export const ELECTION_PAUSED_META = 'gov_election_paused';
export async function isElectionPaused() {
  return (await getMeta(ELECTION_PAUSED_META)) === '1';
}
export async function setElectionPaused(paused) {
  await setMeta(ELECTION_PAUSED_META, paused ? '1' : '0');
}
// PORT-P5: world — end
