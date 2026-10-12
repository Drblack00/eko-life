// ============================================================
// v2/m8.js — M8: six needs + moodlets + city events
//
// Owns: the `moodlets` + `city_events` tables, the 6-need decay
// model (decayTick replacement — see INTEGRATION SPEC in the
// milestone report; the coordinator moves decayTick into sim.js),
// the perk/moodlet effect contract shared with M9, the moodlet
// trigger registry hooked into eat/fun/sleep/work/travel/loan/bank,
// and the wash/toilet/moodlets intents.
//
// Effect contract (M8 ↔ M9, both feed `mods = { moodlets, perks }`):
//   { type:'decay_slow', need:'hunger'|'energy'|'fun'|'social'|'hygiene'|'bladder', pct:25 }
//   { type:'decay_all', pct:10 }
//   { type:'stat_drain', stat, amount } / { type:'stat_boost', stat, amount }  (per tick)
// Unknown / malformed effects are ignored defensively.
// ============================================================
import { dbRun, dbAll, getMeta } from '../../db.js';
import { LOCATIONS } from '../data.js';
// M21: admin unlimited stealth money.
import { isAdminConn, canAfford, charge } from '../money.js';

// Local clamp (NOT imported from ../sim.js): sim.js will re-export this
// module's decayTick, so m8.js must not depend on sim.js (no module cycle).
function clamp(n, lo, hi) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------------- Storage ----------------

export const SCHEMA_SQLITE_MOODLETS = `
CREATE TABLE IF NOT EXISTS moodlets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  effects_json TEXT NOT NULL DEFAULT '[]',
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, key)
);
CREATE INDEX IF NOT EXISTS idx_moodlets_user ON moodlets(user_id);
CREATE INDEX IF NOT EXISTS idx_moodlets_exp ON moodlets(expires_at);`;

export const SCHEMA_SQLITE_EVENTS = `
CREATE TABLE IF NOT EXISTS city_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  effects_json TEXT NOT NULL DEFAULT '[]',
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);`;

// Kept for the coordinator's reference; ensureSchema runs the split
// variants below (dbRun executes one statement per call).
export const SCHEMA_SQLITE = SCHEMA_SQLITE_MOODLETS + '\n' + SCHEMA_SQLITE_EVENTS;

export const SCHEMA_PG_MOODLETS = `
CREATE TABLE IF NOT EXISTS moodlets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  effects_json TEXT NOT NULL DEFAULT '[]',
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(user_id, key)
);
CREATE INDEX IF NOT EXISTS idx_moodlets_user ON moodlets(user_id);
CREATE INDEX IF NOT EXISTS idx_moodlets_exp ON moodlets(expires_at);`;

export const SCHEMA_PG_EVENTS = `
CREATE TABLE IF NOT EXISTS city_events (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  effects_json TEXT NOT NULL DEFAULT '[]',
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);`;

export const SCHEMA_PG = SCHEMA_PG_MOODLETS + '\n' + SCHEMA_PG_EVENTS;

export async function ensureSchema() {
  // dbRun runs one statement per call — create each table separately.
  await dbRun(SCHEMA_SQLITE_MOODLETS, SCHEMA_PG_MOODLETS);
  await dbRun(SCHEMA_SQLITE_EVENTS, SCHEMA_PG_EVENTS);
}

/** Add (or replace the same-key) moodlet for a player. Never throws. */
export async function addMoodlet(userId, { key, label, effects, ttlMs }) {
  try {
    if (!userId || !key) return null;
    const exp = Date.now() + Math.max(1000, Number(ttlMs) || 60000);
    const ej = JSON.stringify(Array.isArray(effects) ? effects : []);
    const sqlite = `INSERT INTO moodlets (user_id, key, label, effects_json, expires_at, created_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(user_id, key) DO UPDATE SET
        label=excluded.label, effects_json=excluded.effects_json, expires_at=excluded.expires_at`;
    const pg = `INSERT INTO moodlets (user_id, key, label, effects_json, expires_at, created_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (user_id, key) DO UPDATE SET
        label=EXCLUDED.label, effects_json=EXCLUDED.effects_json, expires_at=EXCLUDED.expires_at`;
    await dbRun(sqlite, pg, [Number(userId), String(key), String(label || key), ej, exp, Date.now()]);
    return { key: String(key), expires_at: exp };
  } catch (e) {
    console.error('[m8] addMoodlet:', e.message);
    return null;
  }
}

function parseEffects(json) {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Active personal moodlets + active city-wide events (citywide:true). */
export async function listActiveMoodlets(userId) {
  const now = Date.now();
  let mine = [];
  try {
    const rows = await dbAll(
      `SELECT key, label, effects_json, expires_at FROM moodlets
       WHERE user_id=? AND expires_at>? ORDER BY expires_at ASC`,
      `SELECT key, label, effects_json, expires_at FROM moodlets
       WHERE user_id=$1 AND expires_at>$2 ORDER BY expires_at ASC`,
      [Number(userId), now]
    );
    mine = (rows || []).map(r => ({
      key: r.key,
      label: r.label,
      effects: parseEffects(r.effects_json),
      expires_at: Number(r.expires_at),
      citywide: false,
    }));
  } catch (e) {
    console.error('[m8] listActiveMoodlets:', e.message);
  }
  const city = (await listActiveCityEvents()).map(e => ({ ...e, citywide: true }));
  return [...mine, ...city];
}

export async function pruneMoodlets() {
  await dbRun(
    `DELETE FROM moodlets WHERE expires_at <= ?`,
    `DELETE FROM moodlets WHERE expires_at <= $1`,
    [Date.now()]
  );
}

// ---------------- City events ----------------

// Original city events (concepts only from the reference; all text is ours).
export const CITY_EVENTS = [
  {
    key: 'city_blackout',
    label: 'NEPA Took Light',
    effects: [{ type: 'stat_drain', stat: 'happiness', amount: 2 }],
    ttlMs: 3 * 3600 * 1000,
    text: '⚡ BREAKING: NEPA took light across the whole city! Dark rooms, hot air, mosquitoes — till further notice.',
  },
  {
    key: 'lagos_traffic',
    label: 'Hold-Up Everywhere',
    effects: [{ type: 'stat_drain', stat: 'energy', amount: 1 }],
    ttlMs: 2 * 3600 * 1000,
    text: '🚗 The Third Mainland hold-up spilled into every street — the whole city is crawling. Commuting is draining everyone.',
  },
  {
    key: 'owambe_weekend',
    label: 'Owambe Weekend',
    effects: [{ type: 'decay_all', pct: 10 }],
    ttlMs: 4 * 3600 * 1000,
    text: "🎉 It's Owambe Weekend! Parties on every street — the whole city is in high spirits and needs are draining slower.",
  },
];

export async function addCityEvent({ key, label, effects, ttlMs }) {
  if (!key) return null;
  const exp = Date.now() + Math.max(60000, Number(ttlMs) || 3600000);
  const ej = JSON.stringify(Array.isArray(effects) ? effects : []);
  const sqlite = `INSERT INTO city_events (key, label, effects_json, expires_at, created_at)
    VALUES (?,?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET
      label=excluded.label, effects_json=excluded.effects_json, expires_at=excluded.expires_at`;
  const pg = `INSERT INTO city_events (key, label, effects_json, expires_at, created_at)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (key) DO UPDATE SET
      label=EXCLUDED.label, effects_json=EXCLUDED.effects_json, expires_at=EXCLUDED.expires_at`;
  await dbRun(sqlite, pg, [String(key), String(label || key), ej, exp, Date.now()]);
  return { key: String(key), expires_at: exp };
}

export async function listActiveCityEvents() {
  try {
    const rows = await dbAll(
      `SELECT key, label, effects_json, expires_at FROM city_events WHERE expires_at>? ORDER BY expires_at ASC`,
      `SELECT key, label, effects_json, expires_at FROM city_events WHERE expires_at>$1 ORDER BY expires_at ASC`,
      [Date.now()]
    );
    return (rows || []).map(r => ({
      key: r.key,
      label: r.label,
      effects: parseEffects(r.effects_json),
      expires_at: Number(r.expires_at),
    }));
  } catch (e) {
    console.error('[m8] listActiveCityEvents:', e.message);
    return [];
  }
}

export async function pruneCityEvents() {
  await dbRun(
    `DELETE FROM city_events WHERE expires_at <= ?`,
    `DELETE FROM city_events WHERE expires_at <= $1`,
    [Date.now()]
  );
}

/**
 * Low-probability city event, called from onTickMinute.
 * Governor policy meta `event_mult` (M11) scales the probability; default 1.
 * ctx = { broadcast, pushNews? }.
 */
export async function maybeCityEvent(ctx = {}) {
  const multRaw = await getMeta('event_mult').catch(() => null);
  const mult = Number(multRaw);
  // Governor policy (M11) scales city-event frequency. Default 1; 0 disables.
  const scale = multRaw === null || multRaw === undefined || !Number.isFinite(mult) || mult < 0 ? 1 : mult;
  if (Math.random() >= 0.015 * scale) return null; // ~0.9 events/hour at mult 1
  const activeKeys = new Set((await listActiveCityEvents()).map(e => e.key));
  const cands = CITY_EVENTS.filter(e => !activeKeys.has(e.key));
  if (!cands.length) return null;
  const ev = cands[Math.floor(Math.random() * cands.length)];
  await addCityEvent({ key: ev.key, label: ev.label, effects: ev.effects, ttlMs: ev.ttlMs });
  try { ctx.broadcast({ t: 'sys', text: ev.text }); } catch { /* offline */ }
  try { if (typeof ctx.pushNews === 'function') await ctx.pushNews('city', ev.text); } catch { /* offline */ }
  console.log(`[m8] city event: ${ev.key}`);
  return ev;
}

// ---------------- Moodlet triggers (hooked into existing intents) ----------------

// Original names/text. Triggered by the intent blocks listed in the
// integration report (coordinator wires the one-line hooks).
export const MOODLET_TRIGGERS = {
  suya_spice_rush: {
    label: 'Suya Spice Rush',
    effects: [{ type: 'stat_boost', stat: 'happiness', amount: 2 }],
    ttlMs: 10 * 60 * 1000,
    note: '🔥 Suya Spice Rush — the pepper woke your whole mood up!',
  },
  food_coma: {
    label: 'Food Coma',
    effects: [{ type: 'stat_drain', stat: 'energy', amount: 1 }],
    ttlMs: 10 * 60 * 1000,
    note: '😮‍💨 Food Coma — that ofada is sitting heavy. Energy draining…',
  },
  shawarma_charge: {
    label: 'Shawarma Charge',
    effects: [{ type: 'stat_boost', stat: 'energy', amount: 1 }],
    ttlMs: 8 * 60 * 1000,
    note: '⚡ Shawarma Charge — chicken power loading!',
  },
  owambe_euphoria: {
    label: 'Owambe Euphoria',
    effects: [{ type: 'decay_slow', need: 'social', pct: 40 }],
    ttlMs: 20 * 60 * 1000,
    note: '🎉 Owambe Euphoria — your social battery is full for a while.',
  },
  beach_bliss: {
    label: 'Beach Bliss',
    effects: [{ type: 'decay_all', pct: 10 }],
    ttlMs: 15 * 60 * 1000,
    note: '🏖️ Beach Bliss — salt air fixes everything for a bit.',
  },
  club_hangover: {
    label: 'Club Hangover',
    effects: [{ type: 'stat_drain', stat: 'energy', amount: 2 }],
    ttlMs: 12 * 60 * 1000,
    note: '🥴 Club Hangover — last night was fun; today is billing you.',
  },
  arcade_in_the_zone: {
    label: 'In The Zone',
    effects: [{ type: 'decay_slow', need: 'fun', pct: 50 }],
    ttlMs: 10 * 60 * 1000,
    note: '🕹️ In The Zone — one more game… your fun lasts longer.',
  },
  movie_afterglow: {
    label: 'Movie Afterglow',
    effects: [{ type: 'decay_slow', need: 'fun', pct: 40 }],
    ttlMs: 15 * 60 * 1000,
    note: '🎬 Movie Afterglow — still living in that ending.',
  },
  payday_groove: {
    label: 'Payday Groove',
    effects: [{ type: 'decay_all', pct: 15 }],
    ttlMs: 10 * 60 * 1000,
    note: '💸 Payday Groove — money in pocket, worries slowed.',
  },
  home_sweet_home: {
    label: 'Home Sweet Home',
    effects: [{ type: 'decay_slow', need: 'energy', pct: 30 }],
    ttlMs: 15 * 60 * 1000,
    note: '🏠 Home Sweet Home — rested bones drain energy slower.',
  },
  far_from_home: {
    label: 'Far From Home',
    effects: [{ type: 'stat_drain', stat: 'happiness', amount: 1 }],
    ttlMs: 10 * 60 * 1000,
    note: '🧳 Far From Home — the city is loud without your people.',
  },
  loan_dread: {
    label: 'Loan Dread',
    effects: [{ type: 'stat_drain', stat: 'happiness', amount: 1 }],
    ttlMs: 30 * 60 * 1000,
    note: '😰 Loan Dread — debt sits on the chest until it is cleared.',
  },
  savings_smug: {
    label: 'Savings Smug',
    effects: [{ type: 'decay_all', pct: 10 }],
    ttlMs: 10 * 60 * 1000,
    note: '🏦 Savings Smug — money in the bank, peace in the mind.',
  },
};

/** Fire-and-forget trigger from an intent block. Returns the toast note or null. Never throws. */
export async function triggerMoodlet(userId, key) {
  const t = MOODLET_TRIGGERS[key];
  if (!t || !userId) return null;
  await addMoodlet(userId, { key, label: t.label, effects: t.effects, ttlMs: t.ttlMs });
  return t.note || null;
}

// ---------------- Six-need decay ----------------

export const NEEDS = ['hunger', 'energy', 'fun', 'social', 'hygiene', 'bladder'];

export const NEED_META = [
  { id: 'hunger', label: 'Hunger', icon: '🍲' },
  { id: 'energy', label: 'Energy', icon: '⚡' },
  { id: 'fun', label: 'Fun', icon: '🎮' },
  { id: 'social', label: 'Social', icon: '🗣️' },
  { id: 'hygiene', label: 'Hygiene', icon: '🚿' },
  { id: 'bladder', label: 'Bladder', icon: '🚻' },
];

// Per 60s tick, before mods. Tuned to be playable, not punishing:
// bladder needs a check-in every ~25 min; hygiene/social/fun ~50 min;
// energy drains slowly on its own (work/travel are the real costs).
// hunger keeps the M2 rate (3) so the starvation cascade still bites.
export const DECAY_RATES = {
  hunger: 3,
  energy: 1,
  fun: 2,
  social: 2,
  hygiene: 2,
  bladder: 4,
};

const BOOSTABLE_STATS = ['hunger', 'energy', 'fun', 'social', 'hygiene', 'bladder', 'happiness', 'health'];

/** Flatten mods ({moodlets, perks}) into a defensive effect list. */
export function collectEffects(mods) {
  const out = [];
  const push = (item) => {
    if (!item || typeof item !== 'object') return;
    const list = Array.isArray(item.effects) ? item.effects : (typeof item.type === 'string' ? [item] : []);
    for (const e of list) {
      if (e && typeof e === 'object' && typeof e.type === 'string') out.push(e);
    }
  };
  if (mods && typeof mods === 'object') {
    for (const m of mods.moodlets || []) push(m);
    for (const p of mods.perks || []) push(p);
  }
  return out;
}

function clampPct(p) {
  const v = Math.floor(Number(p));
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 90 ? 90 : v; // never fully stop decay
}

/** Combined decay multiplier for one need from decay_slow + decay_all. */
export function decayMultiplier(need, effects) {
  let mult = 1;
  for (const e of effects || []) {
    if (e.type === 'decay_slow' && e.need === need) mult *= 1 - clampPct(e.pct) / 100;
    else if (e.type === 'decay_all') mult *= 1 - clampPct(e.pct) / 100;
  }
  return mult;
}

function needVal(char, need) {
  const v = Number(char[need]);
  return Number.isFinite(v) ? v : 100; // pre-M8 rows default full-ish
}

/**
 * REPLACEMENT for sim.js decayTick (coordinator copies this verbatim).
 * New signature: decayTick(char, mods) where mods = { moodlets: [], perks: [] }.
 * Mutates char, clamps 0–100. Returns cascade flags for tick notes.
 */
export function decayTick(char, mods) {
  const effects = collectEffects(mods);

  for (const need of NEEDS) {
    const rate = DECAY_RATES[need] * decayMultiplier(need, effects);
    char[need] = clamp(needVal(char, need) - rate, 0, 100);
  }

  // per-tick stat boosts / drains from moodlets (defensive: unknown stats ignored)
  for (const e of effects) {
    if (e.type !== 'stat_boost' && e.type !== 'stat_drain') continue;
    if (!BOOSTABLE_STATS.includes(e.stat)) continue;
    const amt = Number(e.amount);
    if (!Number.isFinite(amt) || amt === 0) continue;
    const delta = e.type === 'stat_boost' ? Math.abs(amt) : -Math.abs(amt);
    const cur = Number(char[e.stat]);
    char[e.stat] = clamp((Number.isFinite(cur) ? cur : 100) + delta, 0, 100);
  }

  // cascades: a fully-depleted need drags the rest down
  const flags = {};
  flags.starving = Number(char.hunger) <= 0; // M2 behavior, unchanged
  if (flags.starving) {
    char.energy = clamp(char.energy - 5, 0, 100);
    char.happiness = clamp(char.happiness - 5, 0, 100);
    char.health = clamp(char.health - 2, 0, 100);
  }
  flags.desperate = Number(char.bladder) <= 0; // accidents: messy + miserable
  if (flags.desperate) {
    char.happiness = clamp(char.happiness - 5, 0, 100);
    char.hygiene = clamp(char.hygiene - 10, 0, 100);
  }
  flags.grimy = Number(char.hygiene) <= 0; // grime breeds gloom + sniffles
  if (flags.grimy) {
    char.happiness = clamp(char.happiness - 3, 0, 100);
    char.health = clamp(char.health - 1, 0, 100);
  }
  flags.lonely = Number(char.social) <= 0;
  if (flags.lonely) char.happiness = clamp(char.happiness - 3, 0, 100);
  flags.bored = Number(char.fun) <= 0; // boredom is draining
  if (flags.bored) {
    char.happiness = clamp(char.happiness - 2, 0, 100);
    char.energy = clamp(char.energy - 1, 0, 100);
  }
  return flags;
}

// ---------------- INTENTS ----------------

export const INTENTS = {
  // List active moodlets (personal + city-wide) with countdowns.
  moodlets: async (api, msg) => {
    const list = await listActiveMoodlets(api.conn.user.id);
    const now = Date.now();
    api.send(api.conn, {
      t: 'moodlets',
      moodlets: list.map(m => ({
        key: m.key,
        label: m.label,
        effects: m.effects,
        expires_at: m.expires_at,
        expires_in_ms: Math.max(0, m.expires_at - now),
        citywide: !!m.citywide,
      })),
    });
  },

  // Shower: hygiene → 100. Free at home-ish spots (residential / hospital
  // tags); ₦500 public-bathhouse fee everywhere else. 60s anti-spam cooldown.
  wash: async (api, msg) => {
    const { conn, err, commit } = api;
    const c = conn.character;
    const now = api.now || Date.now();
    conn.cds = conn.cds || {};
    const left = conn.cds.wash && conn.cds.wash > now ? Math.ceil((conn.cds.wash - now) / 1000) : 0;
    if (left) { err(`Fresh already — wash again in ${left}s.`); return; }
    if (Number(c.hygiene) >= 100) { err('You are already sparkling clean.'); return; }
    const loc = LOCATIONS.find(l => l.id === c.location_id);
    const tags = (loc && loc.tags) || [];
    const free = tags.includes('residential') || tags.includes('hospital');
    const FEE = 500;
    const m8admin = isAdminConn(conn);
    if (!free && !canAfford(c, FEE, m8admin)) { err(`A public bathhouse wash costs ₦${FEE}.`); return; }
    conn.cds.wash = now + 60 * 1000;
    c.hygiene = 100;
    let kind = null, amount = 0, note = '🚿 Squeaky clean! (hygiene 100)';
    if (!free) {
      charge(c, FEE, m8admin);
      kind = 'wash'; amount = -FEE;
      note += ` — ₦${FEE} bathhouse fee.`;
    } else {
      note += ' — home shower, free.';
    }
    await commit({ kind, amount, meta: kind ? { location: c.location_id } : null, note });
  },

  // Toilet: bladder → 100. Free, anywhere, no cooldown (no other gain,
  // so spamming is pointless). Client numbers are never read.
  toilet: async (api, msg) => {
    const { conn, err, commit } = api;
    const c = conn.character;
    if (Number(c.bladder) >= 100) { err('No pressure at all — you are fine.'); return; }
    c.bladder = 100;
    await commit({ note: '🚻 Relief! (bladder 100)' });
  },
};

// ---------------- Tick hook ----------------

// Called once per minute by the coordinator (wired into the 60s decay
// interval): prune expired moodlets/events, then maybe roll a city event.
export async function onTickMinute(ctx = {}) {
  try { await pruneMoodlets(); } catch (e) { console.error('[m8] pruneMoodlets:', e.message); }
  try { await pruneCityEvents(); } catch (e) { console.error('[m8] pruneCityEvents:', e.message); }
  try { await maybeCityEvent(ctx); } catch (e) { console.error('[m8] maybeCityEvent:', e.message); }
}

// ---------------- Config / REST ----------------

export const CONFIG_DATA = { needs: NEED_META };

export const REST_SPEC = [{
  method: 'GET',
  path: '/api/v2/m8/moodlets',
  auth: true,
  admin: false,
  handler: async (req, res) => {
    const list = await listActiveMoodlets(req.userId);
    const now = Date.now();
    res.json({
      moodlets: list.map(m => ({
        key: m.key,
        label: m.label,
        effects: m.effects,
        expires_at: m.expires_at,
        expires_in_ms: Math.max(0, m.expires_at - now),
        citywide: !!m.citywide,
      })),
    });
  },
  response: '{ moodlets:[{key,label,effects,expires_at,expires_in_ms,citywide}] }',
}];
