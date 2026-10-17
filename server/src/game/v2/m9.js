// ============================================================
// v2/m9.js — M9: Daily retention (treasure hunt + Today's Hustle + perks)
// All code, copy, and riddles are original — written for Èkó Life.
// Integration contract: server/src/game/v2/README.md
//
// Coordinator wiring needed (see final report):
//   - actions.js: route the 6 intents before `err('Unknown action.')`
//   - app.js: 60s interval calling onTickMinute({broadcast, pushNews})
//   - hub boot: call ensureSchema() + bootM9()
//   - api.js: mount REST_SPEC
//   - db.js: ensureColumn characters.perk_stars / characters.perks,
//     extend harden() + youSnapshot()
// ============================================================
import { dbRun, dbGet, dbAll, getMeta, setMeta, getCharacter } from '../../db.js';
import { LOCATIONS } from '../data.js';
// PORT-P1: rep rewards on quest claims + Lagos-day helpers.
// PORT-P3 one-line fix (flagged for P1): lagosDayKey is ALSO declared locally
// below (identical Lagos YYYY-MM-DD behavior) — importing it too is a
// SyntaxError. addRep + msUntilLagosMidnight still come from vitality.js.
import { addRep, msUntilLagosMidnight } from '../vitality.js';

// ---------------- constants ----------------
export const HUNT_ROUND_MS = 21 * 3600 * 1000; // new riddle every 21h
export const HUSTLE_STAR_REWARD = 2;           // stars per completed mission
export const HUSTLE_MISSIONS_PER_DAY = 3;

// ---------------- storage ----------------
export const SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS hunt_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  riddle TEXT NOT NULL,
  location_id TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hunt_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  place INTEGER NOT NULL,
  claimed_at INTEGER NOT NULL,
  UNIQUE(round_id, user_id)
);
CREATE TABLE IF NOT EXISTS hustle_state (
  user_id INTEGER PRIMARY KEY,
  day_key TEXT NOT NULL,
  missions_json TEXT NOT NULL,
  done_json TEXT NOT NULL,
  claimed_stars INTEGER NOT NULL DEFAULT 0
);`;

export const SCHEMA_PG = `
CREATE TABLE IF NOT EXISTS hunt_rounds (
  id SERIAL PRIMARY KEY,
  riddle TEXT NOT NULL,
  location_id TEXT NOT NULL,
  starts_at BIGINT NOT NULL,
  ends_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS hunt_claims (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  place INTEGER NOT NULL,
  claimed_at BIGINT NOT NULL,
  UNIQUE(round_id, user_id)
);
CREATE TABLE IF NOT EXISTS hustle_state (
  user_id INTEGER PRIMARY KEY,
  day_key TEXT NOT NULL,
  missions_json TEXT NOT NULL,
  done_json TEXT NOT NULL,
  claimed_stars INTEGER NOT NULL DEFAULT 0
);`;

export async function ensureSchema() {
  // node:sqlite prepare() executes only ONE statement, so run each separately.
  const sqliteStmts = SCHEMA_SQLITE.split(';').map(s => s.trim()).filter(Boolean);
  const pgStmts = SCHEMA_PG.split(';').map(s => s.trim()).filter(Boolean);
  for (let i = 0; i < Math.max(sqliteStmts.length, pgStmts.length); i++) {
    await dbRun(sqliteStmts[i] || pgStmts[i], pgStmts[i] || sqliteStmts[i]);
  }
  // Defensive: re-adding a column is a no-op in SQLite/PG only if we catch;
  // the coordinator adds these via ensureColumn — this keeps direct module
  // use (tests, scripts) working even without the coordinator's change.
  try {
    await dbRun(
      'ALTER TABLE characters ADD COLUMN perk_stars INTEGER DEFAULT 0',
      'ALTER TABLE characters ADD COLUMN perk_stars INTEGER DEFAULT 0');
  } catch { /* exists */ }
  try {
    await dbRun(
      "ALTER TABLE characters ADD COLUMN perks TEXT DEFAULT '[]'",
      "ALTER TABLE characters ADD COLUMN perks TEXT DEFAULT '[]'");
  } catch { /* exists */ }
  // PORT-P1: hustle swap + all-three bonus columns — begin
  for (const ddl of [
    'ALTER TABLE hustle_state ADD COLUMN swap_day TEXT DEFAULT \'\'',
    'ALTER TABLE hustle_state ADD COLUMN swaps_used INTEGER DEFAULT 0',
    'ALTER TABLE hustle_state ADD COLUMN bonus_claimed INTEGER DEFAULT 0',
  ]) {
    try { await dbRun(ddl, ddl); } catch { /* exists */ }
  }
  // PORT-P1: hustle swap + all-three bonus columns — end
}

// ---------------- wall-clock helpers (Africa/Lagos) ----------------
export function lagosDayKey(now = Date.now()) {
  return new Date(now).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
}

export function lagosDayStartMs(now = Date.now()) {
  // Africa/Lagos is UTC+1 year-round (no DST): Lagos midnight = 23:00 UTC prior day.
  const [Y, M, D] = lagosDayKey(now).split('-').map(Number);
  return Date.UTC(Y, M - 1, D) - 3600 * 1000;
}

// ---------------- riddles (30 original, spread across the 68 locations) ----------------
// Each entry: playful, solvable, Lagos-flavored — never the reference's text.
export const RIDDLES = [
  { text: 'The roundabout that never sleeps — hold your phone tight and mind the danfo door. Where is the treasure buried?', locationId: 'ojuelegba' },
  { text: 'Fabrics stacked to the ceiling, tailors humming, Mama Put two corners away. Which market hides the gems?', locationId: 'tejuosho' },
  { text: 'Glass walls, a cinema, and air-con colder than harmattan. Shop till your battery dies — where?', locationId: 'ikeja_mall' },
  { text: 'Akokites roam these grounds — books by day, gbedu by night. Which campus holds the prize?', locationId: 'unilag' },
  { text: 'If you can survive this motor park’s chaos, you can survive anywhere. Conductors are shouting — where?', locationId: 'oshodi' },
  { text: 'Ninety minutes of dreams on green grass — street legends are made here. Which stadium?', locationId: 'surulere_stadium' },
  { text: 'The city’s giant pantry — wholesale tomatoes, pepper, everything fresh at dawn. Which market?', locationId: 'mushin' },
  { text: 'Every gadget has a price here, and every price is negotiable. Where do engineers resurrect dead screens?', locationId: 'alaba' },
  { text: 'Dawn queues for hot bread that melts in your mouth. Which junction smells like breakfast?', locationId: 'agege' },
  { text: 'Buses roll out east before the traffic wakes — last boarding call! Which motor park?', locationId: 'ketu' },
  { text: 'Marble banking halls where money never sleeps — forex bureaus on every corner. Which street?', locationId: 'kudi_row' },
  { text: 'Laptops glow past midnight in co-working lofts — startups dream big here. Which hub?', locationId: 'yaba_hub' },
  { text: 'White coats, long corridors, always hiring porters — health is wealth here. Which hospital?', locationId: 'lasuth' },
  { text: 'Eleven kilometres of asphalt floating on water — the city’s most famous traffic postcard. Which bridge?', locationId: 'third_mainland' },
  { text: 'Stilt houses bobbing on the lagoon — they call it the Venice of Lagos. Which village?', locationId: 'makoko' },
  { text: 'Ferries carry mainland hustle to island soft life from this old dock. Which jetty?', locationId: 'ebute_metta' },
  { text: 'Quick boats to dodge the bridge traffic — lifejackets on, hold tight! Which jetty?', locationId: 'falomo_jetty' },
  { text: 'Container ships on the horizon feed the whole city. Which wharf watches them roll in?', locationId: 'apapa_wharf' },
  { text: 'Palm trees, sea breeze, weekend owambe energy — toes in the sand. Which beach?', locationId: 'lekki_beach' },
  { text: 'Retail therapy with a lagoon breeze — window shopping counts as cardio. Which mall?', locationId: 'palms_mall' },
  { text: 'The historic commercial heart of old Lagos — traders older than your grandpa. Which square?', locationId: 'tinubu_sq' },
  { text: 'The beach where the music plays till mama calls you home. Which one?', locationId: 'elegushi' },
  { text: 'Legendary suya smoke and late-night crowds — bring extra pepper. Which spot?', locationId: 'obalende' },
  { text: 'Bottles, bass, and velvet ropes — the Island never truly sleeps. Which club?', locationId: 'club_kasanova' },
  { text: 'A hidden beach you can only reach by boat — no danfo, no keke. Which bay?', locationId: 'tarkwa_bay' },
  { text: 'A canopy walkway through the last green forest on the Island — the monkeys judge your fitness. Where?', locationId: 'lekki_nature' },
  { text: 'Lectures with a sea breeze drifting through the windows. Which Island campus?', locationId: 'etiosa_poly' },
  { text: 'Colonial waterfront — old boats, old banks, old Lagos stories. Where?', locationId: 'cms_marina' },
  { text: 'Marble lobbies and glass towers — corporate Lagos at full shine. Which district?', locationId: 'vgc_banks' },
  { text: 'Five floors of boutiques and cinemas stacked high. Which shopping complex?', locationId: 'ikota_complex' },
];

// Sanity: every riddle must point at a real location id.
export function riddlesValid() {
  const ids = new Set(LOCATIONS.map(l => l.id));
  return RIDDLES.filter(r => !ids.has(r.locationId)).map(r => r.locationId);
}

export function locName(id) {
  const l = LOCATIONS.find(x => x.id === id);
  return l ? l.name : String(id);
}

// Pure: prize by find order.
export function prizeForPlace(place) {
  if (place === 1) return 50000;
  if (place <= 3) return 25000;
  if (place <= 10) return 10000;
  return 3000;
}

export const HUNT_PRIZE_TIERS = [
  { label: '1st finder', amount: 50000 },
  { label: '2nd–3rd', amount: 25000 },
  { label: '4th–10th', amount: 10000 },
  { label: '11th+', amount: 3000 },
];

// ---------------- treasure hunt ----------------
export async function getActiveRound(now = Date.now()) {
  const id = await getMeta('hunt_round_id');
  if (!id) return null;
  const r = await dbGet(
    'SELECT * FROM hunt_rounds WHERE id=?',
    'SELECT * FROM hunt_rounds WHERE id=$1',
    [Number(id)]);
  if (!r) return null;
  if (Number(r.ends_at) <= now) return null;
  return r;
}

export async function claimCount(roundId) {
  const r = await dbGet(
    'SELECT COUNT(*) AS n FROM hunt_claims WHERE round_id=?',
    'SELECT COUNT(*) AS n FROM hunt_claims WHERE round_id=$1',
    [roundId]);
  return Number((r && r.n) || 0);
}

export async function myClaim(roundId, userId) {
  return dbGet(
    'SELECT * FROM hunt_claims WHERE round_id=? AND user_id=?',
    'SELECT * FROM hunt_claims WHERE round_id=$1 AND user_id=$2',
    [roundId, userId]);
}

export async function huntLeaders(roundId, limit = 10) {
  return dbAll(
    `SELECT hc.place, u.username FROM hunt_claims hc
     JOIN users u ON u.id = hc.user_id
     WHERE hc.round_id=? ORDER BY hc.place ASC LIMIT ?`,
    `SELECT hc.place, u.username FROM hunt_claims hc
     JOIN users u ON u.id = hc.user_id
     WHERE hc.round_id=$1 ORDER BY hc.place ASC LIMIT $2`,
    [roundId, limit]);
}

// Start the next riddle in the deterministic cycle.
export async function rotateHuntRound(ctx) {
  const now = Date.now();
  const lastRaw = await getMeta('hunt_round_idx');
  const idx = (((lastRaw === null ? -1 : Number(lastRaw)) + 1) % RIDDLES.length + RIDDLES.length) % RIDDLES.length;
  const riddle = RIDDLES[idx];
  await dbRun(
    'INSERT INTO hunt_rounds (riddle, location_id, starts_at, ends_at) VALUES (?,?,?,?)',
    'INSERT INTO hunt_rounds (riddle, location_id, starts_at, ends_at) VALUES ($1,$2,$3,$4)',
    [riddle.text, riddle.locationId, now, now + HUNT_ROUND_MS]);
  const row = await dbGet(
    'SELECT id FROM hunt_rounds WHERE starts_at=? AND location_id=? ORDER BY id DESC LIMIT 1',
    'SELECT id FROM hunt_rounds WHERE starts_at=$1 AND location_id=$2 ORDER BY id DESC LIMIT 1',
    [now, riddle.locationId]);
  await setMeta('hunt_round_id', String(row.id));
  await setMeta('hunt_round_idx', String(idx));
  ctx.broadcast({ t: 'sys', text: '🗺️ A new treasure riddle is live! Check the Daily tab.' });
  if (ctx.pushNews) ctx.pushNews('hunt', '🗺️ A new treasure riddle is live!');
  console.log(`[m9] hunt round ${row.id} → ${riddle.locationId}`);
  return { id: row.id, idx, riddle: riddle.text, location_id: riddle.locationId, starts_at: now, ends_at: now + HUNT_ROUND_MS };
}

// Tick hook (coordinator wires into a 60s interval): rotate when no active round.
export async function onTickMinute(ctx) {
  try {
    const active = await getActiveRound();
    if (!active) await rotateHuntRound(ctx);
  } catch (e) {
    console.error('[m9] hunt tick:', e.message);
  }
}

// Boot: ensure schema + guarantee a live round before players connect.
export async function bootM9(ctx) {
  await ensureSchema();
  await onTickMinute(ctx);
}

// ---------------- Today's Hustle ----------------
function missionApi(userId, dayStartMs) {
  return {
    userId,
    now: Date.now(),
    dayStartMs,
    countLedger: (kind) => countLedgerSince(userId, kind, dayStartMs),
    sumLedger: (kind) => sumLedgerSince(userId, kind, dayStartMs),
  };
}

export async function countLedgerSince(userId, kind, sinceMs) {
  const r = await dbGet(
    'SELECT COUNT(*) AS n FROM transactions WHERE user_id=? AND kind=? AND created_at>=?',
    'SELECT COUNT(*) AS n FROM transactions WHERE user_id=$1 AND kind=$2 AND created_at>=$3',
    [userId, kind, sinceMs]);
  return Number((r && r.n) || 0);
}

export async function sumLedgerSince(userId, kind, sinceMs) {
  const r = await dbGet(
    'SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE user_id=? AND kind=? AND created_at>=?',
    'SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE user_id=$1 AND kind=$2 AND created_at>=$3',
    [userId, kind, sinceMs]);
  return Number((r && r.s) || 0);
}

// 12 original missions — every check is verifiable server-side from today's ledger.
export const MISSIONS = [
  { id: 'shift_1',    label: 'Clock in: finish 1 work shift',        check: async (a) => (await a.countLedger('work_pay')) >= 1 },
  { id: 'shift_3',    label: 'Full grind: finish 3 work shifts',     check: async (a) => (await a.countLedger('work_pay')) >= 3 },
  { id: 'earn_10k',   label: 'Big hustle: earn ₦10,000+ from shifts', check: async (a) => (await a.sumLedger('work_pay')) >= 10000 },
  { id: 'meals_2',    label: 'Chop well: eat 2 meals',               check: async (a) => (await a.countLedger('food')) >= 2 },
  { id: 'treat_1',    label: 'Soft life: enjoy 1 fun activity',      check: async (a) => (await a.countLedger('fun')) >= 1 },
  { id: 'travel_2',   label: 'On the move: travel twice',            check: async (a) => (await a.countLedger('travel')) >= 2 },
  { id: 'finds_3',    label: 'Sharp eyes: grab 3 cash street finds', check: async (a) => (await a.countLedger('spawn_cash')) >= 3 },
  { id: 'deposit_1',  label: 'Save small: make 1 bank deposit',      check: async (a) => (await a.countLedger('deposit')) >= 1 },
  { id: 'save_5k',    label: 'Money moves: stash ₦5,000+ in savings', check: async (a) => (await a.sumLedger('deposit')) <= -5000 },
  { id: 'study_1',    label: 'Level up: complete 1 study session',   check: async (a) => (await a.countLedger('study')) >= 1 },
  { id: 'repay_1',    label: 'Debt-free-ish: repay a loan once',     check: async (a) => (await a.countLedger('repay')) >= 1 },
  { id: 'furniture_1',label: 'Home sweet home: buy 1 furniture piece', check: async (a) => (await a.countLedger('buy_furniture')) >= 1 },
];

export function missionById(id) {
  return MISSIONS.find(m => m.id === id) || null;
}

// Deterministic 3-mission pick per user per Lagos day (FNV-1a hash + coprime step).
export function pickMissions(userId, dayKey) {
  const ids = MISSIONS.map(m => m.id);
  let h = 2166136261;
  const s = `${userId}:${dayKey}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h >>>= 0;
  const out = [];
  let idx = h % ids.length;
  const step = 5; // coprime with 12 → full cycle, no repeats
  while (out.length < HUSTLE_MISSIONS_PER_DAY) {
    const id = ids[idx];
    if (!out.includes(id)) out.push(id);
    idx = (idx + step) % ids.length;
  }
  return out;
}

export async function getHustleState(userId, now = Date.now()) {
  const key = lagosDayKey(now);
  let st = await dbGet(
    'SELECT * FROM hustle_state WHERE user_id=?',
    'SELECT * FROM hustle_state WHERE user_id=$1',
    [userId]);
  if (!st || st.day_key !== key) {
    const missions = pickMissions(userId, key);
    await dbRun(
      `INSERT INTO hustle_state (user_id, day_key, missions_json, done_json, claimed_stars)
       VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
       day_key=excluded.day_key, missions_json=excluded.missions_json,
       done_json=excluded.done_json, claimed_stars=0,
       swap_day='', swaps_used=0, bonus_claimed=0`,
      `INSERT INTO hustle_state (user_id, day_key, missions_json, done_json, claimed_stars)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id) DO UPDATE SET
       day_key=excluded.day_key, missions_json=excluded.missions_json,
       done_json=excluded.done_json, claimed_stars=0,
       swap_day='', swaps_used=0, bonus_claimed=0`,
      [userId, key, JSON.stringify(missions), '[]', 0]);
    st = await dbGet(
      'SELECT * FROM hustle_state WHERE user_id=?',
      'SELECT * FROM hustle_state WHERE user_id=$1',
      [userId]);
  }
  return {
    user_id: st.user_id,
    day_key: st.day_key,
    missions: JSON.parse(st.missions_json),
    done: JSON.parse(st.done_json),
    claimed_stars: Number(st.claimed_stars) || 0,
    // PORT-P1: swap + bonus bookkeeping
    swapDay: st.swap_day || '',
    swapsUsed: Number(st.swaps_used) || 0,
    bonusClaimed: Number(st.bonus_claimed) || 0,
  };
}

async function markMissionDone(userId, missionId) {
  const st = await getHustleState(userId);
  if (st.done.includes(missionId)) return st;
  const done = [...st.done, missionId];
  await dbRun(
    'UPDATE hustle_state SET done_json=?, claimed_stars=claimed_stars+? WHERE user_id=?',
    'UPDATE hustle_state SET done_json=$1, claimed_stars=claimed_stars+$2 WHERE user_id=$3',
    [JSON.stringify(done), HUSTLE_STAR_REWARD, userId]);
  return { ...st, done, claimed_stars: st.claimed_stars + HUSTLE_STAR_REWARD };
}

// PORT-P1: daily quest reward tables — begin
// Per-mission game-money + rep rewards by difficulty tier.
export const HUSTLE_REWARDS = {
  easy:   { money: 3000,  rep: 20 },
  medium: { money: 6000,  rep: 35 },
  hard:   { money: 10000, rep: 50 },
};
export const HUSTLE_DIFFICULTY = {
  meals_2: 'easy', treat_1: 'easy', deposit_1: 'easy',
  shift_1: 'medium', travel_2: 'medium', finds_3: 'medium',
  study_1: 'medium', furniture_1: 'medium', repay_1: 'medium',
  shift_3: 'hard', earn_10k: 'hard', save_5k: 'hard',
};
export function hustleRewardFor(missionId) {
  const tier = HUSTLE_DIFFICULTY[missionId] || 'easy';
  return { tier, ...HUSTLE_REWARDS[tier] };
}
// All-three-missions bonus (game money + gems + rep).
export const HUSTLE_ALL_DONE_BONUS = { money: 15000, gems: 2, rep: 80 };

async function markBonusClaimed(userId) {
  await dbRun(
    'UPDATE hustle_state SET bonus_claimed=1 WHERE user_id=?',
    'UPDATE hustle_state SET bonus_claimed=1 WHERE user_id=$1',
    [userId]);
}
// PORT-P1: daily quest reward tables — end

// ---------------- perks ----------------
// 14 original perks. EFFECT CONTRACT (shared with M7/M8/M12):
//   {type:'decay_slow', need, pct}  — M8: this need's decay × (1 - pct/100)
//   {type:'decay_all', pct}          — M8: all needs' decay × (1 - pct/100)
//   {type:'work_pay', pct}           — M7: shift payout × (1 + pct/100)
//   {type:'discount', pct}           — shop/furniture buys × (1 - pct/100)
//   {type:'xp_boost', pct}           — M12: academy/skill XP × (1 + pct/100)
// PORT-P1 extended contract (consumed via game/perks.js getPerkEffects):
//   {type:'social_success', pct} — social success rolls × (1 + pct/100)
//   {type:'romance_success', pct} — romance/flirt rolls × (1 + pct/100)
//   {type:'jail_shorten', pct}   — jail sentences × (1 - pct/100)
//   {type:'mood_extend', pct}    — good-mood durations × (1 + pct/100)
//   {type:'sleep_boost', pct}    — sleep energy restore × (1 + pct/100)
// Multiplicative stacking when several of the same type are owned.
export const PERKS = [
  { id: 'slow_burn',       name: 'Slow Burn',       icon: '🍚', cost: 8,  effect: { type: 'decay_slow', need: 'hunger', pct: 25 },    desc: 'Hunger drains 25% slower. Lagos no dey rush food.' },
  { id: 'early_riser',     name: 'Early Riser',     icon: '🌅', cost: 8,  effect: { type: 'decay_slow', need: 'energy', pct: 25 },    desc: 'Energy drains 25% slower. Up before the danfo rush.' },
  { id: 'party_spirit',    name: 'Party Spirit',    icon: '🎉', cost: 8,  effect: { type: 'decay_slow', need: 'happiness', pct: 25 }, desc: 'Happiness drains 25% slower. Vibes on lock.' },
  { id: 'iron_body',       name: 'Iron Body',       icon: '💪', cost: 10, effect: { type: 'decay_slow', need: 'health', pct: 25 },    desc: 'Health drains 25% slower. Built different.' },
  { id: 'light_snacker',   name: 'Light Snacker',   icon: '🥜', cost: 6,  effect: { type: 'decay_slow', need: 'hunger', pct: 15 },    desc: 'Hunger drains 15% slower. Small chops, long day.' },
  { id: 'power_napper',    name: 'Power Napper',    icon: '😴', cost: 10, effect: { type: 'decay_slow', need: 'energy', pct: 15 },    desc: 'Energy drains 15% slower. Ten minutes, brand new person.' },
  { id: 'all_rounder',     name: 'All-Rounder',     icon: '🛡️', cost: 14, effect: { type: 'decay_all', pct: 15 },                    desc: 'All needs drain 15% slower. Balanced like good stew.' },
  { id: 'evergreen',       name: 'Evergreen',       icon: '🌿', cost: 22, effect: { type: 'decay_all', pct: 30 },                    desc: 'All needs drain 30% slower. Fresh all day, every day.' },
  { id: 'overtime',        name: 'Overtime',        icon: '💼', cost: 12, effect: { type: 'work_pay', pct: 20 },                     desc: '+20% pay on every work shift.' },
  { id: 'big_bag',         name: 'Big Bag',         icon: '💰', cost: 18, effect: { type: 'work_pay', pct: 35 },                     desc: '+35% pay on every work shift. Secure the bag.' },
  { id: 'market_whisperer',name: 'Market Whisperer',icon: '🛒', cost: 10, effect: { type: 'discount', pct: 10 },                     desc: '10% off shop and furniture buys. You sabi price.' },
  { id: 'plug_price',      name: 'Plug Price',      icon: '🤝', cost: 16, effect: { type: 'discount', pct: 20 },                     desc: '20% off shop and furniture buys. Your guy knows a guy.' },
  { id: 'fast_brain',      name: 'Fast Brain',      icon: '🧠', cost: 14, effect: { type: 'xp_boost', pct: 20 },                     desc: '+20% academy and skill XP. Brain sharp quick.' },
  { id: 'street_scholar',  name: 'Street Scholar',  icon: '🎓', cost: 20, effect: { type: 'xp_boost', pct: 35 },                     desc: '+35% academy and skill XP. Books plus street smarts.' },
];

export function perkById(id) {
  return PERKS.find(p => p.id === id) || null;
}

export function ownedPerks(c) {
  try {
    const a = JSON.parse(c.perks || '[]');
    return Array.isArray(a) ? a.filter(x => typeof x === 'string') : [];
  } catch { return []; }
}

export function starBalance(c) {
  return Math.max(0, Math.floor(Number(c.perk_stars) || 0));
}

// Persist stars + owned perk ids (stopgap until the coordinator extends
// saveCharacter/harden; harmless once that lands since values match).
export async function persistPerks(c) {
  await dbRun(
    'UPDATE characters SET perk_stars=?, perks=? WHERE user_id=?',
    'UPDATE characters SET perk_stars=$1, perks=$2 WHERE user_id=$3',
    [starBalance(c), JSON.stringify(ownedPerks(c)), c.user_id]);
}

// Owned effect objects for consumers (M7/M8/M12).
export function activePerkEffects(c) {
  const owned = new Set(ownedPerks(c));
  return PERKS.filter(p => owned.has(p.id)).map(p => ({ id: p.id, ...p.effect }));
}

// Multiplicative decay multiplier for one need — exact shape M8's decayTick needs.
export function decayMultiplier(need, effects) {
  let m = 1;
  for (const e of effects) {
    if (e.type === 'decay_slow' && e.need === need) m *= (1 - e.pct / 100);
    else if (e.type === 'decay_all') m *= (1 - e.pct / 100);
  }
  return m;
}

// Cost multipliers for other milestones (M7 work pay, shop discounts, M12 XP).
export function workPayMultiplier(c) {
  let m = 1;
  for (const e of activePerkEffects(c)) if (e.type === 'work_pay') m *= (1 + e.pct / 100);
  return m;
}
export function discountMultiplier(c) {
  let m = 1;
  for (const e of activePerkEffects(c)) if (e.type === 'discount') m *= (1 - e.pct / 100);
  return m;
}
export function xpBoostMultiplier(c) {
  let m = 1;
  for (const e of activePerkEffects(c)) if (e.type === 'xp_boost') m *= (1 + e.pct / 100);
  return m;
}

// ---------------- INTENTS ----------------
export const INTENTS = {
  hunt_status: async (api, msg) => {
    const { conn, send } = api;
    const round = await getActiveRound();
    if (!round) {
      send(conn, { t: 'm9_hunt_status', round: null, message: 'No riddle live yet — check back soon.' });
      return;
    }
    const claim = await myClaim(round.id, conn.user.id);
    send(conn, {
      t: 'm9_hunt_status',
      round: { id: round.id, riddle: round.riddle, endsAt: Number(round.ends_at), claims: await claimCount(round.id) },
      myPlace: claim ? Number(claim.place) : 0,
      prizes: HUNT_PRIZE_TIERS,
    });
  },

  hunt_claim: async (api, msg) => {
    const { conn, err, commit } = api;
    const c = conn.character;
    const round = await getActiveRound();
    if (!round) { err('No treasure hunt is live right now.'); return; }
    // Strict + simple: the player must be AT the riddle's location.
    if (c.location_id !== round.location_id) {
      err('Wrong spot! Solve the riddle and travel to the right place first. 🗺️');
      return;
    }
    const uid = conn.user.id;
    if (await myClaim(round.id, uid)) { err('You already claimed this riddle’s treasure.'); return; }
    // Insert first, then rank by monotonic row id — race-safe place assignment.
    try {
      await dbRun(
        'INSERT INTO hunt_claims (round_id, user_id, place, claimed_at) VALUES (?,?,?,?)',
        'INSERT INTO hunt_claims (round_id, user_id, place, claimed_at) VALUES ($1,$2,$3,$4)',
        [round.id, uid, 0, Date.now()]);
    } catch (e) {
      err('You already claimed this riddle’s treasure.');
      return;
    }
    const mine = await myClaim(round.id, uid);
    const rankRow = await dbGet(
      'SELECT COUNT(*) AS n FROM hunt_claims WHERE round_id=? AND id<=?',
      'SELECT COUNT(*) AS n FROM hunt_claims WHERE round_id=$1 AND id<=$2',
      [round.id, mine.id]);
    const place = Number(rankRow.n);
    await dbRun(
      'UPDATE hunt_claims SET place=? WHERE id=?',
      'UPDATE hunt_claims SET place=$1 WHERE id=$2',
      [place, mine.id]);
    const prize = prizeForPlace(place);
    c.money = Math.max(0, Math.floor(Number(c.money) || 0)) + prize;
    console.log(`[m9] ${conn.user.username} claimed hunt round ${round.id} — place ${place} → ₦${prize}`);
    await commit({
      kind: 'hunt_prize',
      amount: prize,
      meta: { round: round.id, place },
      note: `🗺️ Treasure found! You’re #${place} — +₦${prize.toLocaleString('en-NG')} at ${locName(round.location_id)}.`,
    });
  },

  hustle_status: async (api, msg) => {
    const { conn, send } = api;
    const st = await getHustleState(conn.user.id);
    const dayStart = lagosDayStartMs();
    const mapi = missionApi(conn.user.id, dayStart);
    const missions = [];
    for (const id of st.missions) {
      const m = missionById(id);
      if (!m) continue;
      missions.push({
        id: m.id,
        label: m.label,
        reward: HUSTLE_STAR_REWARD,
        // PORT-P1: per-mission game-money + rep rewards
        prize: hustleRewardFor(m.id),
        done: await m.check(mapi),
        claimed: st.done.includes(m.id),
      });
    }
    send(conn, {
      t: 'm9_hustle',
      dayKey: st.day_key,
      stars: starBalance(conn.character),
      missions,
      // PORT-P1: reset countdown + swap budget
      resetsInMs: msUntilLagosMidnight(),
      swapLeft: st.swapDay === lagosDayKey() ? Math.max(0, 1 - st.swapsUsed) : 1,
      allDoneBonus: HUSTLE_ALL_DONE_BONUS,
      bonusClaimed: !!st.bonusClaimed,
    });
  },

  hustle_claim: async (api, msg) => {
    const { conn, send, err, youSnapshot, commit } = api;
    const c = conn.character;
    const missionId = String((msg && msg.missionId) || '');
    const st = await getHustleState(conn.user.id);
    if (!st.missions.includes(missionId) || !missionById(missionId)) {
      err('That mission isn’t on today’s hustle list.');
      return;
    }
    if (st.done.includes(missionId)) { err('Already claimed — nice hustle though. ✨'); return; }
    const m = missionById(missionId);
    const ok = await m.check(missionApi(conn.user.id, lagosDayStartMs()));
    if (!ok) { err('Mission not complete yet — check the requirements. 💪'); return; }
    // PORT-P1: mission prize (game money + rep) on top of the 2 stars.
    const prize = hustleRewardFor(missionId);
    c.perk_stars = starBalance(c) + HUSTLE_STAR_REWARD;
    c.money = Math.max(0, Math.floor(Number(c.money) || 0)) + prize.money;
    const repRes = await addRep(conn.user.id, prize.rep);
    const after = await markMissionDone(conn.user.id, missionId);
    await persistPerks(c);
    // PORT-P1: all-three-missions bonus, once per day.
    let bonusNote = '';
    if (after.done.length >= HUSTLE_MISSIONS_PER_DAY && !after.bonusClaimed) {
      await markBonusClaimed(conn.user.id);
      c.money = Math.max(0, Math.floor(Number(c.money) || 0)) + HUSTLE_ALL_DONE_BONUS.money;
      c.perk_stars = starBalance(c) + HUSTLE_ALL_DONE_BONUS.gems;
      await addRep(conn.user.id, HUSTLE_ALL_DONE_BONUS.rep);
      await persistPerks(c);
      bonusNote = ` 🏆 ALL THREE DONE! Bonus +₦${HUSTLE_ALL_DONE_BONUS.money.toLocaleString('en-NG')} +${HUSTLE_ALL_DONE_BONUS.gems}✨ +${HUSTLE_ALL_DONE_BONUS.rep} rep!`;
    }
    console.log(`[m9] ${conn.user.username} completed hustle ${missionId} → +${HUSTLE_STAR_REWARD}✨ +₦${prize.money} +${prize.rep} rep${bonusNote ? ' +ALL-DONE BONUS' : ''}`);
    await commit({
      kind: 'hustle_reward',
      amount: prize.money + (bonusNote ? HUSTLE_ALL_DONE_BONUS.money : 0),
      meta: { mission: missionId, rep: prize.rep, bonus: !!bonusNote },
      note: `✨ Hustle complete: ${m.label} — +${HUSTLE_STAR_REWARD}✨ +₦${prize.money.toLocaleString('en-NG')} +${prize.rep} rep!${bonusNote}`,
    });
    send(conn, { t: 'you', you: youSnapshot(conn) });
  },

  // PORT-P1: swap one of today's missions for a fresh one (1 free/day).
  hustle_swap: async (api, msg) => {
    const { conn, send, err, youSnapshot } = api;
    const missionId = String((msg && msg.missionId) || '');
    const st = await getHustleState(conn.user.id);
    if (!st.missions.includes(missionId)) { err('That mission isn’t on today’s hustle list.'); return; }
    if (st.done.includes(missionId)) { err('Already claimed — no swap needed. 🎉'); return; }
    const today = lagosDayKey();
    const used = st.swapDay === today ? st.swapsUsed : 0;
    if (used >= 1) { err('Free swap used up — one per day. 🔄'); return; }
    const taken = new Set(st.missions);
    const replacement = MISSIONS.map(m => m.id).find(id => !taken.has(id));
    if (!replacement) { err('Nothing left to swap to.'); return; }
    const missions = st.missions.map(id => (id === missionId ? replacement : id));
    await dbRun(
      'UPDATE hustle_state SET missions_json=?, swap_day=?, swaps_used=? WHERE user_id=?',
      'UPDATE hustle_state SET missions_json=$1, swap_day=$2, swaps_used=$3 WHERE user_id=$4',
      [JSON.stringify(missions), today, used + 1, conn.user.id]);
    const nm = missionById(replacement);
    console.log(`[m9] ${conn.user.username} swapped hustle ${missionId} → ${replacement}`);
    send(conn, {
      t: 'you',
      you: youSnapshot(conn),
      note: `🔄 Swapped! New mission: ${nm.label}`,
    });
  },

  perk_list: async (api, msg) => {
    const { conn, send } = api;
    const c = conn.character;
    send(conn, {
      t: 'm9_perks',
      stars: starBalance(c),
      owned: ownedPerks(c),
      perks: PERKS,
    });
  },

  perk_buy: async (api, msg) => {
    const { conn, send, err, youSnapshot } = api;
    const c = conn.character;
    const perk = perkById(String((msg && msg.perk) || ''));
    if (!perk) { err('Unknown perk.'); return; }
    const owned = ownedPerks(c);
    if (owned.includes(perk.id)) { err('You already own that perk.'); return; }
    const bal = starBalance(c);
    if (bal < perk.cost) { err(`Need ${perk.cost}✨ for ${perk.name} — you have ${bal}✨.`); return; }
    c.perk_stars = bal - perk.cost;
    c.perks = JSON.stringify([...owned, perk.id]);
    await persistPerks(c);
    console.log(`[m9] ${conn.user.username} bought perk ${perk.id} for ${perk.cost}✨`);
    send(conn, {
      t: 'you',
      you: youSnapshot(conn),
      note: `${perk.icon} Perk unlocked: ${perk.name}! ${perk.desc}`,
    });
  },
};

// ---------------- REST ----------------
// Coordinator mounts these (auth: req.user set by the auth middleware).
async function restHunt(req, res) {
  const round = await getActiveRound();
  let myPlace = 0, leaders = [], claims = 0;
  if (round) {
    claims = await claimCount(round.id);
    const mine = req.user ? await myClaim(round.id, req.user.id) : null;
    myPlace = mine ? Number(mine.place) : 0;
    leaders = (await huntLeaders(round.id, 10)).map(r => ({ place: Number(r.place), username: r.username }));
  }
  res.json({
    round: round ? { id: round.id, riddle: round.riddle, endsAt: Number(round.ends_at), claims } : null,
    myPlace,
    leaders,
    prizes: HUNT_PRIZE_TIERS,
  });
}

async function restHustle(req, res) {
  const userId = req.user.id;
  const st = await getHustleState(userId);
  const dayStart = lagosDayStartMs();
  const mapi = missionApi(userId, dayStart);
  const missions = [];
  for (const id of st.missions) {
    const m = missionById(id);
    if (!m) continue;
    missions.push({ id: m.id, label: m.label, reward: HUSTLE_STAR_REWARD, prize: hustleRewardFor(m.id), done: await m.check(mapi), claimed: st.done.includes(m.id) });
  }
  // PORT-P1: reset countdown + swap budget + all-done bonus info
  res.json({
    dayKey: st.day_key, missions, stars: st.claimed_stars,
    resetsInMs: msUntilLagosMidnight(),
    swapLeft: st.swapDay === lagosDayKey() ? Math.max(0, 1 - st.swapsUsed) : 1,
    allDoneBonus: HUSTLE_ALL_DONE_BONUS,
    bonusClaimed: !!st.bonusClaimed,
  });
}

async function restPerks(req, res) {
  // Stars/owned come from the DB character row (kept current by intents).
  const c = (await getCharacter(req.user.id)) || {};
  res.json({ stars: starBalance(c), owned: ownedPerks(c), perks: PERKS });
}

export const REST_SPEC = [
  {
    method: 'GET', path: '/api/v2/m9/hunt', auth: true, admin: false,
    handler: restHunt,
    response: '{round:{id,riddle,endsAt,claims}|null, myPlace, leaders:[{place,username}], prizes:[{label,amount}]}',
  },
  {
    method: 'GET', path: '/api/v2/m9/hustle', auth: true, admin: false,
    handler: restHustle,
    response: '{dayKey, missions:[{id,label,reward,done,claimed}], stars}',
  },
  {
    method: 'GET', path: '/api/v2/m9/perks', auth: true, admin: false,
    handler: restPerks,
    response: '{stars, owned:[perkId], perks:[{id,name,icon,cost,effect,desc}]}',
  },
];
