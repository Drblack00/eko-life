// ============================================================
// game/v2/gem.js — Daily Gem Hunt (Phase 9).
//
// One gem hides at a random travelable location each game day.
// The location is picked by a day-seeded RNG (stable for the day)
// and revealed ONLY through an original riddle clue — the location
// id/name never leaves the server. Players search their CURRENT
// location; the first finders each day earn the biggest prizes.
//
// Gameplay coins only. One find per player per day (PK enforced).
// ============================================================
import { LOCATIONS } from '../data.js';
import {
  dbGet, dbAll, dbRun,
  getCharacter, saveCharacter, addTransaction,
} from '../../db.js';

/** Prize ladder by find order within the day (matches the audit). */
export const GEM_PRIZES = [
  { minRank: 1, maxRank: 1, prize: 50000, label: '1st' },
  { minRank: 2, maxRank: 3, prize: 25000, label: '2nd–3rd' },
  { minRank: 4, maxRank: 10, prize: 10000, label: '4th–10th' },
  { minRank: 11, maxRank: Number.MAX_SAFE_INTEGER, prize: 3000, label: '11th+' },
];

/** Prize for a 1-based find rank. */
export function prizeForRank(rank) {
  const r = Math.max(1, Math.floor(Number(rank) || 1));
  const row = GEM_PRIZES.find((p) => r >= p.minRank && r <= p.maxRank);
  return row ? row.prize : 3000;
}

/** Anti-spam: one search attempt per player per 60s (in-memory is fine). */
export const SEARCH_COOLDOWN_MS = 60_000;
const searchCooldowns = new Map(); // userId -> epoch ms of last attempt
/** Test hook: clear in-memory search cooldowns. */
export function _resetGemCooldowns() { searchCooldowns.clear(); }

/** Deterministic PRNG (mulberry32) so the daily pick is stable. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick the gem's location for a game day. Every entry in LOCATIONS is a
 * travelable map pin, so the gem is always reachable.
 */
export function pickGemLocation(day) {
  const rng = mulberry32((Number(day) * 2654435761) >>> 0);
  return LOCATIONS[Math.floor(rng() * LOCATIONS.length)];
}

/* ------------------------------------------------------------------ */
/* Original riddles, keyed by location tag. They hint at the KIND of   */
/* place, never the location's name.                                  */
/* ------------------------------------------------------------------ */
export const GEM_RIDDLES = [
  { tags: ['market'], text: 'A thousand voices rise as one where the pepper burns beneath the sun. Stalls in rows like soldiers stand — bring your haggle, cash in hand.' },
  { tags: ['market'], text: 'Tomatoes, lace and second-hand jeans, the loudest bargains ever seen. Where traders call from every side, the gem is where the crowds collide.' },
  { tags: ['motor_park'], text: 'Yellow buses cough in line, conductors shout "this seat is mine!" Engines roar from night till day — where every journey starts its way.' },
  { tags: ['motor_park'], text: 'Horns and hawkers, smoke and haste, no traveller here has time to waste. Where danfos queue to leave the town, the gem is where they gather round.' },
  { tags: ['mall'], text: 'Glass and marble, cold and bright, where cinemas glow through day and night. Escalators climb the air — a gem is hiding with the shoppers there.' },
  { tags: ['campus'], text: 'Books by day, loud parties late, young minds gather at the gate. Where lecturers and freshers tread, a gem lies where big dreams are fed.' },
  { tags: ['stadium'], text: 'Ninety minutes, drums and cheers, where football glory drowns the fears. The pitch is green, the crowd is loud — a gem waits where fans are proud.' },
  { tags: ['bank'], text: 'Behind the glass where money sleeps, the city’s wealth in silence keeps. Count the notes both old and new — the gem is where the tellers queue.' },
  { tags: ['office'], text: 'Nine to five the printers sing, where busy workers do their thing. Ties are knotted, plans are drawn — find the gem where deals are born.' },
  { tags: ['housing_office'], text: 'Paper stacks and queues that wind, a rented home is what you’ll find. Sign the dotted line with care — a gem is waiting for you there.' },
  { tags: ['hospital'], text: 'White coats rushing down the hall, they answer every urgent call. Where the weary come to mend, a gem hides where the nurses tend.' },
  { tags: ['tech_hub'], text: 'Screens aglow past midnight’s bell, where startup dreams begin to swell. Code and coffee, bugs to mend — the gem is where the builders bend their minds.' },
  { tags: ['residential'], text: 'Behind high fences, calm and neat, far away from the noisome street. Where quiet families plant their trees, a gem hides in the evening breeze.' },
  { tags: ['landmark'], text: 'A storied spot both old and grand, the pride and joy of all the land. Where cameras flash and tourists roam, a gem is resting far from home.' },
  { tags: ['beach'], text: 'Where lagoon meets golden sand and palm trees sway across the land, the waves keep time both soft and free — a gem is where the tide runs free.' },
  { tags: ['club'], text: 'When the night is young and beats are loud, I hide within the dancing crowd. The DJ spins, the strobes ignite — a gem is where they own the night.' },
  { tags: ['boat'], text: 'No wheels, no road, just open blue, I rock the waves the whole day through. The ferryman will know the way — a gem is where the jetties sway.' },
];

const GENERIC_RIDDLES = [
  'I hide where Lagosians roam, far away from hearth and home. The city’s pulse both loud and deep — a gem is where the secrets sleep.',
  'Not in a palace, not in a shed, I rest where busy feet have tread. Follow whispers, not the crowd — a gem is where the bold are proud.',
];

/** Pick a riddle for the day's location (seeded; kind-hinting, never naming). */
export function pickRiddle(day, location) {
  const tags = location.tags || [];
  const pool = GEM_RIDDLES.filter((r) => r.tags.some((t) => tags.includes(t)));
  const list = pool.length > 0 ? pool : GENERIC_RIDDLES.map((text) => ({ text }));
  const rng = mulberry32(((Number(day) * 40503) + 97) >>> 0);
  return list[Math.floor(rng() * list.length)].text;
}

/** Fetch (creating if needed) the gem row for a game day. Race-safe. */
export async function ensureGemDay(day) {
  const d = Math.floor(Number(day));
  let row = await dbGet(
    'SELECT day, location_id, clue FROM gem_days WHERE day = ?',
    'SELECT day, location_id, clue FROM gem_days WHERE day = $1',
    [d],
  );
  if (row) return row;
  const loc = pickGemLocation(d);
  const clue = pickRiddle(d, loc);
  try {
    await dbRun(
      'INSERT INTO gem_days (day, location_id, clue, created_at) VALUES (?, ?, ?, ?)',
      'INSERT INTO gem_days (day, location_id, clue, created_at) VALUES ($1, $2, $3, $4)',
      [d, loc.id, clue, Date.now()],
    );
  } catch {
    /* lost a race with another worker — re-read below */
  }
  row = await dbGet(
    'SELECT day, location_id, clue FROM gem_days WHERE day = ?',
    'SELECT day, location_id, clue FROM gem_days WHERE day = $1',
    [d],
  );
  return row;
}

/** How many players have found today's gem. */
export async function gemFindCount(day) {
  const r = await dbGet(
    'SELECT COUNT(*) AS n FROM gem_finds WHERE day = ?',
    'SELECT COUNT(*) AS n FROM gem_finds WHERE day = $1',
    [Math.floor(Number(day))],
  );
  return Number(r?.n) || 0;
}

/** First N finder usernames for a day (for the "found it today" list). */
export async function firstFinders(day, limit = 5) {
  const lim = Math.max(1, Math.min(10, Math.floor(Number(limit) || 5)));
  const rows = await dbAll(
    `SELECT u.username AS username FROM gem_finds f
     JOIN users u ON u.id = f.user_id
     WHERE f.day = ? ORDER BY f.finder_rank ASC LIMIT ?`,
    `SELECT u.username AS username FROM gem_finds f
     JOIN users u ON u.id = f.user_id
     WHERE f.day = $1 ORDER BY f.finder_rank ASC LIMIT $2`,
    [Math.floor(Number(day)), lim],
  );
  return rows.map((r) => r.username).filter(Boolean);
}

/** The viewer's own find row for a day (or null). */
export async function myFind(day, userId) {
  return dbGet(
    'SELECT prize, finder_rank FROM gem_finds WHERE day = ? AND user_id = ?',
    'SELECT prize, finder_rank FROM gem_finds WHERE day = $1 AND user_id = $2',
    [Math.floor(Number(day)), Number(userId)],
  );
}

/**
 * Attempt a gem search. The player searches their CURRENT location
 * (server-read from the character row — the client never sends one).
 * Returns { found, prize, rank } on success, { found:false } on a miss,
 * or { error, cooldownMs? } when the attempt is rejected.
 */
export async function searchGem({ day, userId }) {
  const d = Math.floor(Number(day));
  const uid = Number(userId);
  const gem = await ensureGemDay(d);
  if (!gem) return { error: 'The hunt is not ready yet — try again soon.' };

  const c = await getCharacter(uid);
  if (!c || !c.location_id) {
    return { error: 'You are nowhere right now — travel somewhere first.' };
  }

  const now = Date.now();
  const last = searchCooldowns.get(uid) || 0;
  const leftMs = SEARCH_COOLDOWN_MS - (now - last);
  if (leftMs > 0) {
    return { error: `Catch your breath — search again in ${Math.ceil(leftMs / 1000)}s.`, cooldownMs: leftMs };
  }
  searchCooldowns.set(uid, now);

  const mine = await myFind(d, uid);
  if (mine) return { error: 'You already found today’s gem — come back tomorrow.' };

  if (c.location_id !== gem.location_id) {
    return { found: false };
  }

  const rank = (await gemFindCount(d)) + 1;
  const prize = prizeForRank(rank);
  try {
    await dbRun(
      'INSERT INTO gem_finds (day, user_id, found_at, prize, finder_rank) VALUES (?, ?, ?, ?, ?)',
      'INSERT INTO gem_finds (day, user_id, found_at, prize, finder_rank) VALUES ($1, $2, $3, $4, $5)',
      [d, uid, Date.now(), prize, rank],
    );
  } catch {
    // Lost a PK race (double-submit): treat as already found.
    return { error: 'You already found today’s gem — come back tomorrow.' };
  }

  c.money = Math.max(0, Math.floor(Number(c.money) || 0) + prize);
  await saveCharacter(c);
  await addTransaction(uid, 'gem', prize, c.money, { day: d, rank });

  return { found: true, prize, rank };
}
