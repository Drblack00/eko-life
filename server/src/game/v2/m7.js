// ============================================================
// v2/m7.js — M7: real-time game clock + 1-hour work shifts
//
// (a) Game clock synced to real wall time in Africa/Lagos.
// (b) Career tracks (~24): the 10 legacy jobs kept as entry roles
//     (same ids), plus 14 new mid-tier roles (original names/values).
// (c) 1-hour real-time shifts replacing the old instant-pay `work`.
//
// Server-authoritative: every money/stat mutation is validated from
// server state; clients only send intents. Money moves always write
// a transactions ledger row (kind `shift_pay`).
// ============================================================
import {
  dbRun, getMeta, addTransaction, getCharacter, listCharacters,
} from '../../db.js';
import { CLASSES, LOCATIONS } from '../data.js';

const naira = (n) => '₦' + Number(n).toLocaleString('en-NG');

function locName(id) {
  const l = LOCATIONS.find((x) => x.id === id);
  return l ? l.name : String(id);
}

// ------------------------------------------------------------
// 1. Storage — shift state lives on the characters row.
//    (The coordinator adds these columns via ensureColumn; this
//    module's ensureSchema() only guarantees them for tests and
//    fresh boots that skipped the coordinator step.)
// ------------------------------------------------------------
export const SHIFT_COLUMNS = [
  ['shift_job', 'TEXT', 'TEXT'],        // active shift's role id (NULL = no shift)
  ['shift_started_at', 'BIGINT', 'BIGINT'], // ms epoch the shift started
  ['shift_ends_at', 'BIGINT', 'BIGINT'],    // ms epoch the 1-hour shift completes
];

export const SCHEMA_SQLITE = SHIFT_COLUMNS
  .map(([c, t]) => `ALTER TABLE characters ADD COLUMN ${c} ${t};`).join('\n');
export const SCHEMA_PG = SCHEMA_SQLITE; // same DDL is valid Postgres

export async function ensureSchema() {
  for (const [col, lite, pg] of SHIFT_COLUMNS) {
    try {
      await dbRun(
        `ALTER TABLE characters ADD COLUMN ${col} ${lite}`,
        `ALTER TABLE characters ADD COLUMN ${col} ${pg}`,
        [],
      );
    } catch (e) {
      if (/duplicate|already exists/i.test(e.message || '')) continue; // already there
      throw e;
    }
  }
}

// Explicit shift-column persist. The coordinator extends saveCharacter()
// with these columns, but this helper is the belt-and-suspenders path:
// shift state must survive even if a save misses the new columns.
export async function persistShiftState(userId, { shift_job = null, shift_started_at = null, shift_ends_at = null } = {}) {
  await dbRun(
    'UPDATE characters SET shift_job=?, shift_started_at=?, shift_ends_at=? WHERE user_id=?',
    'UPDATE characters SET shift_job=$1, shift_started_at=$2, shift_ends_at=$3 WHERE user_id=$4',
    [shift_job, shift_started_at, shift_ends_at, Number(userId)],
  );
}

// ------------------------------------------------------------
// 2. Game clock — real wall time in Africa/Lagos.
//    Label shape: "Sat · 3:16 AM".
// ------------------------------------------------------------
export function lagosLabel(ts = Date.now()) {
  const d = new Date(Number(ts));
  const weekday = d.toLocaleString('en-US', { timeZone: 'Africa/Lagos', weekday: 'short' });
  const time = d.toLocaleString('en-US', {
    timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit', hour12: true,
  });
  return `${weekday} · ${time}`;
}

// Server helper: { ts, label } — feeds both the REST endpoint and the
// 30s WS `clock` broadcast (see REST_SPEC + hub wiring in the report).
export function lagosNow(nowMs = Date.now()) {
  const ts = Number(nowMs);
  return { ts, label: lagosLabel(ts) };
}

// ------------------------------------------------------------
// 3. Career tracks
//
// The 10 legacy jobs (market_porter … campus_tutor) are kept with the
// SAME ids as entry roles, re-valued to the per-shift pay scale
// (entry ₦5,700–₦10,400; mid ₦12,000–₦18,500). The old JOBS export in
// data.js stays untouched (deprecated).
//
// SKILL ID CONTRACT (must match M12 exactly):
export const SKILL_IDS = [
  'cooking', 'charisma', 'fitness', 'coding', 'music',
  'hustle', 'dance', 'comedy', 'photography',
];

export const SKILL_LABELS = {
  cooking: 'Cooking', charisma: 'Charisma', fitness: 'Fitness',
  coding: 'Coding', music: 'Music', hustle: 'Hustle',
  dance: 'Dance', comedy: 'Comedy', photography: 'Photography',
};

export const SHIFT_MS = 60 * 60 * 1000; // 1-hour real-time shifts

// Role shape: { id, trackId, name, locationId, payPerShift, energyCost,
//               icon, skillGate?: { skill, level }, certRequired? }
// Track shape: { id, name, path, icon, blurb, tier: 'entry'|'mid', roles }
export const CAREER_TRACKS = [
  // ---- entry tracks (legacy jobs, same ids) ----
  { id: 'trk_market_hustle', name: 'Market Hustle', path: 'market', icon: '🧺', tier: 'entry',
    blurb: 'Carry loads, run errands, learn the market from the ground up.',
    roles: [
      { id: 'market_porter', trackId: 'trk_market_hustle', name: 'Market Porter', locationId: 'tejuosho', payPerShift: 5700, energyCost: 25, icon: '🧺' },
    ] },
  { id: 'trk_danfo_crew', name: 'Danfo Crew', path: 'transport', icon: '🚌', tier: 'entry',
    blurb: 'Shout destinations, collect fares, keep the danfo moving.',
    roles: [
      { id: 'danfo_conductor', trackId: 'trk_danfo_crew', name: 'Danfo Conductor', locationId: 'oshodi', payPerShift: 6400, energyCost: 30, icon: '🚌' },
    ] },
  { id: 'trk_campus_brains', name: 'Campus Brains', path: 'campus', icon: '📚', tier: 'entry',
    blurb: 'Turn your certificate into steady campus cash.',
    roles: [
      { id: 'campus_tutor', trackId: 'trk_campus_brains', name: 'Campus Tutor', locationId: 'unilag', payPerShift: 7200, energyCost: 25, icon: '📚', certRequired: true },
    ] },
  { id: 'trk_mall_retail', name: 'Mall Retail', path: 'corporate', icon: '🏬', tier: 'entry',
    blurb: 'Fold shirts, charm customers, stack the shelves.',
    roles: [
      { id: 'shop_assistant', trackId: 'trk_mall_retail', name: 'Shop Assistant', locationId: 'ikeja_mall', payPerShift: 7200, energyCost: 25, icon: '🏬' },
    ] },
  { id: 'trk_hospital_hands', name: 'Hospital Hands', path: 'service', icon: '🏥', tier: 'entry',
    blurb: 'The wards always need strong hands and steady nerves.',
    roles: [
      { id: 'hospital_orderly', trackId: 'trk_hospital_hands', name: 'Hospital Orderly', locationId: 'lasuth', payPerShift: 7900, energyCost: 30, icon: '🏥' },
    ] },
  { id: 'trk_beach_watch', name: 'Beach Watch', path: 'leisure', icon: '🛟', tier: 'entry',
    blurb: 'Sun, sea and saving swimmers — the coolest job in Lagos.',
    roles: [
      { id: 'beach_lifeguard', trackId: 'trk_beach_watch', name: 'Beach Lifeguard', locationId: 'lekki_beach', payPerShift: 6900, energyCost: 30, icon: '🛟' },
    ] },
  { id: 'trk_lounge_life', name: 'Lounge Life', path: 'corporate', icon: '☕', tier: 'entry',
    blurb: 'Espresso shots and small talk on the Island circuit.',
    roles: [
      { id: 'lounge_barista', trackId: 'trk_lounge_life', name: 'Lounge Barista', locationId: 'palms_mall', payPerShift: 8600, energyCost: 30, icon: '☕' },
    ] },
  { id: 'trk_wholesale', name: 'Wholesale Trade', path: 'market', icon: '💰', tier: 'entry',
    blurb: 'Buy low in the morning, sell high by noon.',
    roles: [
      { id: 'market_trader', trackId: 'trk_wholesale', name: 'Market Trader', locationId: 'mushin', payPerShift: 9000, energyCost: 35, icon: '💰' },
    ] },
  { id: 'trk_tech_ladder', name: 'Tech Ladder', path: 'corporate', icon: '💻', tier: 'entry',
    blurb: 'Ship code, fix bugs, climb the tech ladder.',
    roles: [
      { id: 'junior_dev', trackId: 'trk_tech_ladder', name: 'Junior Dev Intern', locationId: 'ikoyi', payPerShift: 9800, energyCost: 35, icon: '💻', certRequired: true },
    ] },
  { id: 'trk_banking_ranks', name: 'Banking Ranks', path: 'corporate', icon: '🏦', tier: 'entry',
    blurb: 'Count cash, balance ledgers, wear the tie.',
    roles: [
      { id: 'bank_teller', trackId: 'trk_banking_ranks', name: 'Bank Teller', locationId: 'kudi_row', payPerShift: 10400, energyCost: 35, icon: '🏦', certRequired: true },
    ] },

  // ---- mid-tier tracks (14 NEW original roles, all gated) ----
  { id: 'trk_kitchen_command', name: 'Kitchen Command', path: 'service', icon: '🍲', tier: 'mid',
    blurb: 'Run the pots at a legendary food court — speed is everything.',
    roles: [
      { id: 'head_cook', trackId: 'trk_kitchen_command', name: 'Mama Put Head Cook', locationId: 'ikeja_underbridge', payPerShift: 12800, energyCost: 30, icon: '🍲', skillGate: { skill: 'cooking', level: 2 } },
    ] },
  { id: 'trk_grill_masters', name: 'Grill Masters', path: 'service', icon: '🔥', tier: 'mid',
    blurb: 'Smoke, spice and a queue that never ends.',
    roles: [
      { id: 'bole_grill_master', trackId: 'trk_grill_masters', name: 'Bole Grill Master', locationId: 'obalende', payPerShift: 12300, energyCost: 30, icon: '🔥', skillGate: { skill: 'cooking', level: 2 } },
    ] },
  { id: 'trk_property_game', name: 'Property Game', path: 'corporate', icon: '🏘️', tier: 'mid',
    blurb: 'Close deals on duplexes and smile all the way to the bank.',
    roles: [
      { id: 'estate_agent', trackId: 'trk_property_game', name: 'Estate Agent', locationId: 'ikoyi', payPerShift: 16600, energyCost: 30, icon: '🏘️', skillGate: { skill: 'charisma', level: 3 } },
    ] },
  { id: 'trk_owambe_stage', name: 'Owambe Stage', path: 'leisure', icon: '🎤', tier: 'mid',
    blurb: 'Hold the mic, hype the crowd, keep the party alive.',
    roles: [
      { id: 'owambe_mc', trackId: 'trk_owambe_stage', name: 'Owambe MC', locationId: 'surulere_stadium', payPerShift: 15800, energyCost: 35, icon: '🎤', skillGate: { skill: 'charisma', level: 3 } },
    ] },
  { id: 'trk_beauty_chair', name: 'Beauty Chair', path: 'service', icon: '💇', tier: 'mid',
    blurb: 'Braids, fades and flawless finishes — booked out weekly.',
    roles: [
      { id: 'salon_stylist', trackId: 'trk_beauty_chair', name: 'Salon Stylist', locationId: 'ajah', payPerShift: 12900, energyCost: 30, icon: '💇', skillGate: { skill: 'charisma', level: 2 } },
    ] },
  { id: 'trk_fitness_floor', name: 'Fitness Floor', path: 'service', icon: '🏋️', tier: 'mid',
    blurb: 'Count reps, fix form, build the next street champion.',
    roles: [
      { id: 'gym_coach', trackId: 'trk_fitness_floor', name: 'Gym Floor Coach', locationId: 'ajegunle_arena', payPerShift: 14600, energyCost: 35, icon: '🏋️', skillGate: { skill: 'fitness', level: 3 } },
    ] },
  { id: 'trk_private_care', name: 'Private Care', path: 'service', icon: '🩺', tier: 'mid',
    blurb: 'Certified hands for the Island\'s private wards.',
    roles: [
      { id: 'ward_nurse', trackId: 'trk_private_care', name: 'Private Ward Nurse', locationId: 'victoria_hospital', payPerShift: 18300, energyCost: 35, icon: '🩺', certRequired: true },
    ] },
  { id: 'trk_product_ladder', name: 'Product Ladder', path: 'corporate', icon: '📊', tier: 'mid',
    blurb: 'Roadmaps, standups and shipping features at a fintech.',
    roles: [
      { id: 'assoc_pm', trackId: 'trk_product_ladder', name: 'Associate Product Manager', locationId: 'yaba_hub', payPerShift: 17400, energyCost: 35, icon: '📊', skillGate: { skill: 'coding', level: 3 } },
    ] },
  { id: 'trk_afrobeat_nights', name: 'Afrobeat Nights', path: 'leisure', icon: '🥁', tier: 'mid',
    blurb: 'Keep the rhythm for the city\'s hottest live sets.',
    roles: [
      { id: 'session_drummer', trackId: 'trk_afrobeat_nights', name: 'Afrobeat Session Drummer', locationId: 'club_kasanova', payPerShift: 15200, energyCost: 35, icon: '🥁', skillGate: { skill: 'music', level: 2 } },
    ] },
  { id: 'trk_street_dance', name: 'Street Dance', path: 'leisure', icon: '💃', tier: 'mid',
    blurb: 'Teach the steps the whole beach is copying.',
    roles: [
      { id: 'dance_instructor', trackId: 'trk_street_dance', name: 'Street Dance Instructor', locationId: 'elegushi', payPerShift: 14200, energyCost: 35, icon: '💃', skillGate: { skill: 'dance', level: 2 } },
    ] },
  { id: 'trk_skit_economy', name: 'Skit Economy', path: 'leisure', icon: '🎬', tier: 'mid',
    blurb: 'Write the punchlines, shoot the skits, break the internet.',
    roles: [
      { id: 'skit_creator', trackId: 'trk_skit_economy', name: 'Skit Creator', locationId: 'ikate_night', payPerShift: 13600, energyCost: 30, icon: '🎬', skillGate: { skill: 'comedy', level: 2 } },
    ] },
  { id: 'trk_event_lens', name: 'Event Lens', path: 'leisure', icon: '📸', tier: 'mid',
    blurb: 'Shoot the owambes, the launches, the moments.',
    roles: [
      { id: 'event_photographer', trackId: 'trk_event_lens', name: 'Event Photographer', locationId: 'palms_mall', payPerShift: 14800, energyCost: 30, icon: '📸', skillGate: { skill: 'photography', level: 2 } },
    ] },
  { id: 'trk_keke_fleet', name: 'Keke Fleet', path: 'transport', icon: '🛺', tier: 'mid',
    blurb: 'Own the roundabout run — speed plus street smarts.',
    roles: [
      { id: 'keke_rider', trackId: 'trk_keke_fleet', name: 'Keke Fleet Rider', locationId: 'agungi_round', payPerShift: 12400, energyCost: 35, icon: '🛺', skillGate: { skill: 'hustle', level: 2 } },
    ] },
  { id: 'trk_dispatch_runs', name: 'Dispatch Runs', path: 'transport', icon: '📦', tier: 'mid',
    blurb: 'Parcels across the city, beat the traffic, beat the clock.',
    roles: [
      { id: 'dispatch_rider', trackId: 'trk_dispatch_runs', name: 'Dispatch Rider', locationId: 'ojota_park', payPerShift: 12100, energyCost: 35, icon: '📦' },
    ] },
];

// Flat role index for O(1) lookup by role id.
const ROLE_INDEX = new Map();
for (const track of CAREER_TRACKS) {
  for (const role of track.roles) ROLE_INDEX.set(role.id, role);
}

// PORT-P3: careers — begin
// P3 career-rank roles (server/src/game/careers.js) register here so the
// 1-hour shift engine — shift_start gates, activeShiftOf, stale settle,
// tick settlement — treats them exactly like built-in roles. Registered
// roles use the same object shape as ROLE_INDEX entries and may carry a
// `careerId` field, which the day-off predicate below uses.
// The day-off predicate is registered by careers.js (m7 never imports
// careers — one-way dependency, no import cycle). It returns an error
// string when clocking in is blocked today, else null.
const EXT_ROLE_INDEX = new Map();
export function registerShiftRole(role) {
  if (role && role.id) EXT_ROLE_INDEX.set(String(role.id), role);
}
export function isExtendedRole(id) {
  return EXT_ROLE_INDEX.has(String(id));
}
let dayOffCheck = null;
export function registerDayOffCheck(fn) {
  dayOffCheck = typeof fn === 'function' ? fn : null;
}
function dayOffBlocked(role, now) {
  if (!role || !role.careerId || !dayOffCheck) return null;
  return dayOffCheck(role, now);
}
// PORT-P3: careers — end

export function findRole(id) {
  // PORT-P3: careers — begin (extended roles fall through here)
  return ROLE_INDEX.get(String(id)) || EXT_ROLE_INDEX.get(String(id)) || null;
  // PORT-P3: careers — end
}

export function trackOf(roleId) {
  const role = findRole(roleId);
  if (!role) return null;
  return CAREER_TRACKS.find((t) => t.id === role.trackId) || null;
}

export const CONFIG_DATA = { careerTracks: CAREER_TRACKS, skillLabels: SKILL_LABELS };

// ------------------------------------------------------------
// 4. Pure logic
// ------------------------------------------------------------

// Skill levels live on the character (M12 owns the storage contract:
// `character.skills` as a JSON string or plain object, e.g.
// '{"coding":3}'). Missing/invalid → level 0 (gate stays closed).
export function skillLevelOf(character, skill) {
  try {
    const s = character && character.skills;
    const obj = typeof s === 'string' ? JSON.parse(s || '{}') : (s || {});
    const v = Number(obj && obj[skill]);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  } catch {
    return 0;
  }
}

// Perk hook (M9 defines perks). A perk like
//   { effect: { type: 'work_pay', pct: 25 } }
// boosts shift pay by pct%. `character.perks` may be a JSON string or
// an array. Missing/invalid → 0 (no boost).
export function workPayPerkPct(character) {
  try {
    const p = character && character.perks;
    const arr = typeof p === 'string' ? JSON.parse(p || '[]') : p;
    if (!Array.isArray(arr)) return 0;
    for (const perk of arr) {
      const eff = perk && perk.effect;
      if (eff && eff.type === 'work_pay') {
        const pct = Number(eff.pct);
        if (Number.isFinite(pct) && pct > 0) return Math.min(100, pct);
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

// Shift payout: payPerShift × class payMult (0.9/1.1) × wageMult
// (governor policy via meta `wage_mult`, default 1) × perk boost.
export function calcShiftPay(payPerShift, { classMult = 1, wageMult = 1, perkPct = 0 } = {}) {
  const base = Math.max(0, Math.floor(Number(payPerShift) || 0));
  const cm = Number.isFinite(classMult) && classMult > 0 ? classMult : 1;
  const wm = Number.isFinite(wageMult) && wageMult > 0 && wageMult <= 10 ? wageMult : 1;
  const pp = Math.min(100, Math.max(0, Number(perkPct) || 0));
  return Math.floor(base * cm * wm * (1 + pp / 100));
}

export function classPayMult(classId) {
  return (CLASSES[classId] || CLASSES.street_smart).payMult || 1;
}

export async function readWageMult() {
  try {
    const raw = await getMeta('wage_mult'); // M11 writes this for governor wage policies
    const w = Number(raw);
    if (Number.isFinite(w) && w > 0 && w <= 10) return w;
  } catch { /* fall through to default */ }
  return 1;
}

// Active-shift view for a character row/session object.
export function activeShiftOf(c, now = Date.now()) {
  const ts = Number(now);
  if (!c || !c.shift_job) return null;
  const endsAt = Number(c.shift_ends_at);
  if (!Number.isFinite(endsAt) || endsAt <= ts) return null;
  const role = findRole(c.shift_job);
  return {
    job: c.shift_job,
    name: role ? role.name : String(c.shift_job),
    trackId: role ? role.trackId : null,
    startedAt: Number(c.shift_started_at) || null,
    endsAt,
    secondsLeft: Math.max(0, Math.ceil((endsAt - ts) / 1000)),
  };
}

// ------------------------------------------------------------
// 5. INTENTS — WS `act` handlers (server-authoritative).
//    api = { conn, send, broadcast, youSnapshot, err, commit, now, getDay }
// ------------------------------------------------------------
export const INTENTS = {
  // Clock in for a 1-hour shift. Energy is deducted NOW; pay lands on
  // completion (onTickMinute), even if the player is offline.
  shift_start: async (api, msg) => {
    const { conn, err, commit } = api;
    const c = conn.character;
    const now = Number(api.now) || Date.now();

    const role = findRole(msg && msg.job);
    if (!role) { err('Unknown job.'); return; }

    // PORT-P3: careers — begin (day-off enforcement for career roles)
    const dayOffErr = dayOffBlocked(role, now);
    if (dayOffErr) { err(dayOffErr); return; }
    // PORT-P3: careers — end

    // Already on a live shift → refuse (no double shifts).
    const active = activeShiftOf(c, now);
    if (active) {
      err(`You're already on a shift as ${active.name}. Finish it or leave it first.`);
      return;
    }

    // Validate BEFORE touching any state: a failed clock-in must leave a
    // stale (expired, unsettled) shift alone for the tick to settle —
// settling it here first could double-pay it later.
    if (c.location_id !== role.locationId) {
      err(`Go to ${locName(role.locationId)} to clock in as ${role.name}.`);
      return;
    }
    if (role.certRequired && !Number(c.cert)) {
      err('This role needs a certificate. Study at a campus first.');
      return;
    }
    if (role.skillGate) {
      const lvl = skillLevelOf(c, role.skillGate.skill);
      if (lvl < role.skillGate.level) {
        const label = SKILL_LABELS[role.skillGate.skill] || role.skillGate.skill;
        err(`You need ${label} level ${role.skillGate.level} for ${role.name} (you're level ${lvl}).`);
        return;
      }
    }
    if (Number(c.energy) < role.energyCost) { err('Too tired. Eat or sleep first.'); return; }

    // Stale shift row (expired but never settled): settle it now so the
    // player never loses earned pay, then start the new shift below.
    let stale = null;
    if (c.shift_job) {
      stale = settleStaleShift(c, now, await readWageMult());
    }

    c.energy = Math.max(0, Math.min(100, Number(c.energy) - role.energyCost));
    c.shift_job = role.id;
    c.shift_started_at = now;
    c.shift_ends_at = now + SHIFT_MS;
    const note = (stale ? `+${naira(stale.pay)} — ${stale.role.name} shift complete 💪 ` : '')
      + `⏰ Clocked in as ${role.name} — shift ends in 1 hour. Pay lands when you finish.`;
    console.log(`[m7] ${conn.user.username} clocked in: ${role.id} (ends ${new Date(c.shift_ends_at).toISOString()})`);
    // The stale settle is a money move → it gets its own ledger row via commit.
    await commit({
      kind: stale ? 'shift_pay' : null,
      amount: stale ? stale.pay : 0,
      meta: stale ? { job: stale.role.id, stale_settle: true } : null,
      note,
    });
    // Explicit persist: shift state must survive even before the
    // coordinator's saveCharacter() learns the new columns.
    await persistShiftState(conn.user.id, {
      shift_job: c.shift_job, shift_started_at: c.shift_started_at, shift_ends_at: c.shift_ends_at,
    });
  },

  // Leave a shift early.
  //
  // FORFEIT (not prorata): leaving early pays nothing. Prorata was
  // rejected because it lets players farm partial pay with zero
  // commitment — clock in, leave 5 minutes later, repeat — which
  // breaks the 1-hour-shift economy and rewards the exact behaviour
  // shifts exist to replace.
  shift_leave: async (api, msg) => {
    const { conn, err, commit } = api;
    const c = conn.character;
    const now = Number(api.now) || Date.now();
    if (!activeShiftOf(c, now)) { err("You're not on a shift right now."); return; }
    const role = findRole(c.shift_job);
    c.shift_job = null;
    c.shift_started_at = null;
    c.shift_ends_at = null;
    await commit({ note: `You left your ${role ? role.name : 'shift'} early — unfinished shifts earn nothing.` });
    await persistShiftState(conn.user.id, { shift_job: null, shift_started_at: null, shift_ends_at: null });
  },

  // Current shift (or null).
  shift_status: async (api, msg) => {
    const { conn, send } = api;
    const now = Number(api.now) || Date.now();
    send(conn, { t: 'shift_status', shift: activeShiftOf(conn.character, now) });
  },
};

// Settle an expired-but-unsettled shift on a live session character.
// Mutates c (adds pay, clears shift fields). Returns { role, pay } or null.
// The caller writes the ledger row (via commit) — every money move is logged.
function settleStaleShift(c, now, wageMult = 1) {
  if (!c || !c.shift_job) return null;
  const endsAt = Number(c.shift_ends_at);
  if (Number.isFinite(endsAt) && endsAt > now) return null; // still live
  const role = findRole(c.shift_job);
  if (!role) {
    c.shift_job = null; c.shift_started_at = null; c.shift_ends_at = null;
    return null;
  }
  const pay = calcShiftPay(role.payPerShift, {
    classMult: classPayMult(c.class),
    wageMult,
    perkPct: workPayPerkPct(c),
  });
  c.money = Math.max(0, Math.floor(Number(c.money) || 0)) + pay;
  c.shift_job = null; c.shift_started_at = null; c.shift_ends_at = null;
  return { role, pay };
}

// ------------------------------------------------------------
// 6. Tick hook — complete expired shifts (DB-driven, so shifts
//    finish even when the player is offline). The coordinator wires
//    this into a 60s interval (see report).
//
//    ctx = { broadcast, sendTo, getDay, now, refreshYou? }
//      sendTo(userId, msg) — push to that player's socket if online
//      refreshYou(userId) — re-read the character row and push a
//        fresh {t:'you'} (mandatory: we credit the DB directly, so
//        the live session's copy must be refreshed)
//    Returns the list of completed shifts (testable).
// ------------------------------------------------------------
export async function onTickMinute(ctx) {
  const ts = Number(ctx && ctx.now) || Date.now();
  const wageMult = await readWageMult();
  const chars = await listCharacters();
  const done = [];

  for (const ch of chars) {
    if (!ch.shift_job) continue;
    const endsAt = Number(ch.shift_ends_at);
    if (Number.isFinite(endsAt) && endsAt > ts) continue; // still working
    const role = findRole(ch.shift_job);
    const userId = Number(ch.user_id);
    if (!role) {
      // Unknown role id (data changed): clear without pay, never trap a player.
      console.log(`[m7] clearing unknown shift role ${ch.shift_job} for user ${userId}`);
      await persistShiftState(userId, { shift_job: null, shift_started_at: null, shift_ends_at: null });
      continue;
    }
    const pay = calcShiftPay(role.payPerShift, {
      classMult: classPayMult(ch.class),
      wageMult,
      perkPct: workPayPerkPct(ch),
    });
    const money = Math.max(0, Math.floor(Number(ch.money) || 0)) + pay;
    // Credit + clear in one UPDATE so a crash between the two can't
    // double-pay the same shift.
    await dbRun(
      'UPDATE characters SET money=?, shift_job=NULL, shift_started_at=NULL, shift_ends_at=NULL WHERE user_id=?',
      'UPDATE characters SET money=$1, shift_job=NULL, shift_started_at=NULL, shift_ends_at=NULL WHERE user_id=$2',
      [money, userId],
    );
    await addTransaction(userId, 'shift_pay', pay, money, { job: role.id, wage_mult: wageMult });
    console.log(`[m7] shift complete: user ${userId} ${role.id} → +${naira(pay)} (wageMult ${wageMult})`);
    done.push({ userId, role, pay });
  }

  // Notify. `you` is refreshed by the coordinator (it owns the session);
  // the shift_done toast carries the headline so the UI updates instantly.
  for (const d of done) {
    const note = `+${naira(d.pay)} — ${d.role.name} shift complete 💪`;
    if (ctx.refreshYou) {
      try { await ctx.refreshYou(d.userId); } catch (e) { console.error('[m7] refreshYou:', e.message); }
    }
    if (ctx.sendTo) {
      try { await ctx.sendTo(d.userId, { t: 'shift_done', job: d.role.id, pay: d.pay, note }); }
      catch (e) { console.error('[m7] sendTo:', e.message); }
    }
  }
  return done;
}

// ------------------------------------------------------------
// 7. REST_SPEC — endpoints for the coordinator to mount.
// ------------------------------------------------------------
export const REST_SPEC = [
  {
    method: 'GET',
    path: '/api/v2/m7/clock',
    auth: false,
    admin: false,
    handler: async (req, res) => { res.json(lagosNow()); },
    response: '{ ts:number, label:"Sat · 3:16 AM" }',
  },
];
