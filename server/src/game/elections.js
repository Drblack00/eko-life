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
export async function playerElectionState(playerId, day, governorId) {
  const el = await currentElection();
  if (!el) return { active: false };
  const cands = await listCandidates(el.id);
  const voted = playerId ? await hasVoted(el.id, playerId) : false;
  return electionState(el, cands, { playerId, voted, governorId, day });
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
  broadcast({ t: 'election', ...electionState(next, [], { governorId: winnerId, day }) });
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
