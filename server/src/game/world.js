// ============================================================
// game/world.js — P5 "World Systems" mechanics core.
//
// Ride, Health, Police, Court, Assurance, Bus Co., In-game Ads,
// Charity, IPO-style promos, Event tickets. 100% original code and
// copy — mechanics inspired by a competitor audit, reimplemented
// from scratch for Èkó Life. Gameplay coins only; no real money.
//
// The module owns:
//   - pure constants + pure helpers (fare math, rush hours, go-slow
//     flavor, illness/treatment math, risk rolls, claim math,
//     payback math, fee math, hearing outcomes) — all testable,
//   - its own tables via ensureWorldSchema() (idempotent,
//     self-sufficient like elections.js),
//   - worldDayTick({ day, hub }) for daily/weekly settlement, called
//     from the hub day-rollover (see the PORT-P5 block in ws/hub.js).
//
// HOOKS (for other phases — flagged in the P5 report):
//   - playerIllnessDecayMult(userId): needs-decay multiplier while
//     ill. M8 (needs decay) should multiply its decay by this.
//   - isJailed(userId) / applyJailSentence(): the jail-time system.
//     Phase 1's "Good Lawyer" perk (25% shorter sentences) should
//     wrap applyJailSentence via opts.lawyerPerk.
//   - ROBBERY_CAP / capRobbery(amount): the robbery system (owner TBD)
//     must cap any single theft at ₦50,000.
//   - listCertificates(userId): Phase 1 exposes a certificates
//     surface — courses.js implements the award side; this is the
//     read side to join.
// ============================================================
import {
  dbRun, dbGet, dbAll, ensureColumn,
  getCharacter, saveCharacter, addTransaction,
} from '../db.js';

const DAY_MS = 24 * 3600 * 1000;

// ============================================================
// RIDE
// ============================================================

export const RIDE_MODES = {
  trek:  { id: 'trek',  name: 'Trek',  icon: '🚶', baseFare: 0,   minSec: 5, maxSec: 8,  blurb: 'Legs are free. Dust is free too.' },
  keke:  { id: 'keke',  name: 'Keke',  icon: '🛺', baseFare: 150, minSec: 6, maxSec: 10, blurb: 'Three wheels, zero fear.' },
  danfo: { id: 'danfo', name: 'Danfo', icon: '🚐', baseFare: 150, minSec: 6, maxSec: 10, blurb: 'Yellow buses, loud conductors.' },
  okada: { id: 'okada', name: 'Okada', icon: '🏍️', baseFare: 250, minSec: 5, maxSec: 9,  blurb: 'Weaves through go-slow like water.' },
  cab:   { id: 'cab',   name: 'Cab',   icon: '🚕', baseFare: 700, minSec: 5, maxSec: 10, blurb: 'AC, privacy, and small talk.' },
};

export const RUSH_MULT = 1.5;
// Rush = 7–9am and 5–8pm Lagos time (WAT).
export function isRushHour(date = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-NG', {
    timeZone: 'Africa/Lagos', hour: 'numeric', hour12: false,
  }).format(date));
  return (h >= 7 && h < 9) || (h >= 17 && h < 20);
}

/** Cab fare floats ₦700–₦900 by destination; other modes are flat. */
export function rideBaseFare(mode, destId = '') {
  const m = RIDE_MODES[mode];
  if (!m) throw new Error('unknown ride mode: ' + mode);
  if (mode !== 'cab') return m.baseFare;
  let hash = 0;
  for (const ch of String(destId)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return 700 + (hash % 5) * 50; // 700, 750, 800, 850, 900
}

/** Rush multiplier, rounded to the nearest ₦50 (fares stay tidy). */
export function rideFare(mode, destId = '', date = new Date()) {
  const base = rideBaseFare(mode, destId);
  if (!isRushHour(date)) return base;
  return Math.round((base * RUSH_MULT) / 50) * 50;
}

export function rideTravelSecs(mode, rand = Math.random) {
  const m = RIDE_MODES[mode];
  if (!m) throw new Error('unknown ride mode: ' + mode);
  return m.minSec + Math.floor(rand() * (m.maxSec - m.minSec + 1));
}

// Original go-slow flavor (not copied from any source).
const GO_SLOW_EVENTS = [
  { text: 'A tanker broke down at Costain — the whole road is one lane now.', extraSec: 7 },
  { text: 'LASTMA is doing stop-and-search ahead. Everybody wait.', extraSec: 5 },
  { text: 'Rain just started. Lagos drivers are suddenly driving like it is ice.', extraSec: 6 },
  { text: 'A danfo conductor is arguing about change with a passenger. Nobody is moving.', extraSec: 4 },
  { text: 'Owambe convoy blocking the junction — aso-ebi everywhere.', extraSec: 8 },
  { text: 'Pothole the size of a swimming pool near the roundabout.', extraSec: 5 },
];

/** ~30% of motorized trips hit a go-slow event with a time penalty. */
export function rollGoSlow(mode, rand = Math.random) {
  if (mode === 'trek' || rand() > 0.3) return null;
  const e = GO_SLOW_EVENTS[Math.floor(rand() * GO_SLOW_EVENTS.length)];
  return { text: e.text, extraSec: e.extraSec };
}

// ============================================================
// HEALTH
// ============================================================

export const CHEMIST_FEE = 1500;
export const HOSPITAL_FEE = 8000;

// Original illness names. needsMult multiplies needs decay while ill.
export const ILLNESSES = {
  eko_fever: {
    id: 'eko_fever', name: 'Eko Fever', icon: '🤒',
    desc: 'Shivers, headache, and a body that refuses to cooperate. Classic.',
    needsMult: 1.6, hours: 24,
  },
  danfo_cough: {
    id: 'danfo_cough', name: 'Danfo Cough', icon: '😮‍💨',
    desc: 'Dust, fumes, and one very loud horn. Your chest is complaining.',
    needsMult: 1.3, hours: 18,
  },
  owambe_tummy: {
    id: 'owambe_tummy', name: 'Owambe Tummy', icon: '🤢',
    desc: 'That third plate at the party was a mistake. Your stomach agrees.',
    needsMult: 1.4, hours: 12,
  },
};

/** Chemist cures mild cases; hospital cures everything. */
export function treatIllness(illnessId, provider, rand = Math.random) {
  const ill = ILLNESSES[illnessId];
  if (!ill) throw new Error('unknown illness: ' + illnessId);
  if (provider === 'hospital') return { cured: true, cost: HOSPITAL_FEE };
  if (provider === 'chemist') {
    const cured = illnessId !== 'eko_fever' || rand() < 0.75;
    return { cured, cost: CHEMIST_FEE };
  }
  throw new Error('unknown provider: ' + provider);
}

/** Small chance of catching something on a crowded ride. */
export function rollRideIllness(mode, rand = Math.random) {
  if ((mode === 'keke' || mode === 'danfo') && rand() < 0.04) {
    const ids = Object.keys(ILLNESSES);
    return ids[Math.floor(rand() * ids.length)];
  }
  return null;
}

// ============================================================
// POLICE
// ============================================================

export const ROBBERY_CAP = 50000;

/** Any single robbery/theft must be capped at ₦50,000 (game-recorded). */
export function capRobbery(amount) {
  const n = Math.floor(Number(amount) || 0);
  return Math.max(0, Math.min(ROBBERY_CAP, n));
}

export const OFFENCE_TYPES = [
  { id: 'theft', name: 'Petty theft', icon: '👜', severity: 1 },
  { id: 'robbery', name: 'Robbery', icon: '🔫', severity: 3 },
  { id: 'assault', name: 'Assault', icon: '👊', severity: 2 },
  { id: 'fraud', name: '419 / fraud', icon: '🎣', severity: 2 },
  { id: 'vandalism', name: 'Vandalism', icon: '🧱', severity: 1 },
  { id: 'disturbance', name: 'Public disturbance', icon: '📢', severity: 1 },
];

// ============================================================
// COURT — hears ONLY game-recorded events (world_offences rows)
// ============================================================

export const COURT_HEARING_DELAY_DAYS = 2;

/**
 * Pure hearing outcome. rand injectable for tests.
 * Returns { verdict: 'dismissed'|'fined'|'jailed', fine, jailHours, note }.
 */
export function hearCase(offence, rand = Math.random) {
  const sev = Number(offence && offence.severity) || 1;
  const roll = rand();
  if (roll < 0.35) {
    return { verdict: 'dismissed', fine: 0, jailHours: 0, note: 'The judge threw the case out — not enough evidence.' };
  }
  if (roll < 0.35 + 0.25 * sev / 3 + 0.2) {
    // fine: scales with severity
    const fine = Math.min(40000, 5000 * sev + Math.floor(rand() * 5000));
    return { verdict: 'fined', fine, jailHours: 0, note: `Guilty. The court fined you ${naira(fine)}.` };
  }
  const jailHours = 6 + Math.floor(rand() * (sev >= 3 ? 42 : 18)); // 6–48h
  return { verdict: 'jailed', fine: 0, jailHours, note: `Guilty. ${jailHours} hours in the cell.` };
}

export function naira(n) {
  return '₦' + Math.floor(Number(n) || 0).toLocaleString('en-NG');
}

// ============================================================
// ASSURANCE
// ============================================================

export const ASSURANCE_PREMIUM = 150;      // per week
export const ASSURANCE_DEDUCTIBLE = 2000;
export const ASSURANCE_MAX_PAYOUT = 50000;
export const ASSURANCE_FIX_COST = 500;    // house-condition top-up

// Weekly risk probabilities (per policy).
export const ASSURANCE_RISKS = {
  fire:    { name: 'Fire',    icon: '🔥', prob: 0.036, lossMin: 20000, lossMax: 60000 },
  flood:   { name: 'Flood',   icon: '🌊', prob: 0.078, lossMin: 15000, lossMax: 50000 },
  phone:   { name: 'Phone snatch', icon: '📱', prob: 0.033, lossMin: 10000, lossMax: 30000 },
  medical: { name: 'Medical bill', icon: '🩺', prob: 0.021, lossMin: 8000,  lossMax: 25000 },
};

export function rollAssuranceRisk(rand = Math.random) {
  const hits = [];
  for (const [id, r] of Object.entries(ASSURANCE_RISKS)) {
    if (rand() < r.prob) {
      hits.push({
        risk: id,
        loss: r.lossMin + Math.floor(rand() * (r.lossMax - r.lossMin + 1)),
      });
    }
  }
  return hits;
}

/** Payout = min(max, loss) − deductible, floored at 0. */
export function assurancePayout(loss) {
  return Math.max(0, Math.min(ASSURANCE_MAX_PAYOUT, Math.floor(Number(loss) || 0)) - ASSURANCE_DEDUCTIBLE);
}

// ============================================================
// BUS COMPANY
// ============================================================

export const BUSCO_START_COST = 2000000;
export const BUSCO_WEEKLY_YIELD = 765000;

export function buscoPaybackWeeks() {
  return Math.ceil(BUSCO_START_COST / BUSCO_WEEKLY_YIELD);
}

// ============================================================
// IN-GAME ADS
// ============================================================

export const AD_BILLBOARD_COST = 250000;
export const AD_MAP_PLOT_COST = 500;
export const AD_DURATION_DAYS = 7;
export const AD_TITLE_MAX = 40;
export const AD_BLURB_MAX = 90;

// ============================================================
// CHARITY
// ============================================================

export const CHARITY_SEED = 2500000;
export const CHARITY_MAX_SINGLE_DONATION = 5000000;

export const CHARITY_PROJECTS = [
  { id: 'roof', name: 'Roof Over Èkó Housing Trust', icon: '🏠', tag: 'Housing', goal: 10000000,
    desc: 'Roof repairs for low-income families before the rains.' },
  { id: 'books', name: 'Books for Bariga', icon: '📚', tag: 'Education', goal: 5000000,
    desc: 'Textbooks and desks for public-school classrooms.' },
  { id: 'meals', name: 'Sunday Rice Outreach', icon: '🍛', tag: 'Food', goal: 3000000,
    desc: 'Hot meals for street kids every Sunday.' },
  { id: 'clinic', name: 'Mushin Free Clinic Fund', icon: '🏥', tag: 'Health', goal: 8000000,
    desc: 'Free malaria tests and drugs at the community clinic.' },
];

// ============================================================
// IPO-STYLE PROMOS (game money only — fixed payout at close)
// ============================================================

export const PROMO_PAYOUT_DEFAULT = 1.35;

// ============================================================
// EVENT TICKETS
// ============================================================

export const TICKET_FEE_RATE = 0.05;
export const TICKET_FEE_FLAT = 100;

/** Organizer keeps price − (5% + ₦100). Free tickets have no fee. */
export function ticketOrganizerNet(price) {
  const p = Math.floor(Number(price) || 0);
  if (p <= 0) return 0;
  return Math.max(0, p - Math.floor(p * TICKET_FEE_RATE) - TICKET_FEE_FLAT);
}

// ============================================================
// SCHEMA
// ============================================================

const WORLD_SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS world_illness (
  user_id INTEGER PRIMARY KEY,
  illness TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  until INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS world_offences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  offence TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  recorded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_world_offences_user ON world_offences(user_id);
CREATE TABLE IF NOT EXISTS world_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  offence TEXT NOT NULL,
  severity INTEGER NOT NULL DEFAULT 1,
  source_offence_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  hearing_day INTEGER NOT NULL,
  outcome TEXT NOT NULL DEFAULT '',
  decided_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_world_cases_user ON world_cases(user_id);
CREATE TABLE IF NOT EXISTS world_jail (
  user_id INTEGER PRIMARY KEY,
  until INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS world_assurance (
  user_id INTEGER PRIMARY KEY,
  active INTEGER NOT NULL DEFAULT 0,
  paid_until_week INTEGER NOT NULL DEFAULT 0,
  condition INTEGER NOT NULL DEFAULT 100,
  last_roll_week INTEGER NOT NULL DEFAULT -1,
  started_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS world_losses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  risk TEXT NOT NULL,
  loss_amount INTEGER NOT NULL,
  claimed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_world_losses_user ON world_losses(user_id);
CREATE TABLE IF NOT EXISTS world_busco (
  user_id INTEGER PRIMARY KEY,
  buses INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  last_payout_week INTEGER NOT NULL DEFAULT -1
);
CREATE TABLE IF NOT EXISTS world_ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  blurb TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_world_ads_active ON world_ads(expires_at);
CREATE TABLE IF NOT EXISTS world_charity_donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  project TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS world_promos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  blurb TEXT NOT NULL DEFAULT '',
  closes_at INTEGER NOT NULL,
  min_invest INTEGER NOT NULL DEFAULT 1000,
  max_invest INTEGER NOT NULL DEFAULT 500000,
  payout_mult REAL NOT NULL DEFAULT 1.35,
  status TEXT NOT NULL DEFAULT 'open'
);
CREATE TABLE IF NOT EXISTS world_promo_invest (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  promo_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  claimed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_world_promo_invest_user ON world_promo_invest(user_id);
CREATE TABLE IF NOT EXISTS world_ticket_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  venue TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,
  organizer_id INTEGER NOT NULL DEFAULT 0,
  capacity INTEGER NOT NULL DEFAULT 200,
  starts_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS world_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  price_paid INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(event_id, user_id)
);
CREATE TABLE IF NOT EXISTS world_rides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  dest TEXT NOT NULL DEFAULT '',
  fare INTEGER NOT NULL DEFAULT 0,
  go_slow INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);`;

const WORLD_SCHEMA_PG = `
CREATE TABLE IF NOT EXISTS world_illness (
  user_id BIGINT PRIMARY KEY,
  illness TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  "until" BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS world_offences (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  offence TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  recorded_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_world_offences_user ON world_offences(user_id);
CREATE TABLE IF NOT EXISTS world_cases (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  offence TEXT NOT NULL,
  severity INTEGER NOT NULL DEFAULT 1,
  source_offence_id BIGINT,
  status TEXT NOT NULL DEFAULT 'pending',
  hearing_day INTEGER NOT NULL,
  outcome TEXT NOT NULL DEFAULT '',
  decided_at BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_world_cases_user ON world_cases(user_id);
CREATE TABLE IF NOT EXISTS world_jail (
  user_id BIGINT PRIMARY KEY,
  "until" BIGINT NOT NULL,
  reason TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS world_assurance (
  user_id BIGINT PRIMARY KEY,
  active INTEGER NOT NULL DEFAULT 0,
  paid_until_week INTEGER NOT NULL DEFAULT 0,
  condition INTEGER NOT NULL DEFAULT 100,
  last_roll_week INTEGER NOT NULL DEFAULT -1,
  started_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS world_losses (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  risk TEXT NOT NULL,
  loss_amount BIGINT NOT NULL,
  claimed INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_world_losses_user ON world_losses(user_id);
CREATE TABLE IF NOT EXISTS world_busco (
  user_id BIGINT PRIMARY KEY,
  buses BIGINT NOT NULL DEFAULT 0,
  started_at BIGINT NOT NULL,
  last_payout_week INTEGER NOT NULL DEFAULT -1
);
CREATE TABLE IF NOT EXISTS world_ads (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  blurb TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_world_ads_active ON world_ads(expires_at);
CREATE TABLE IF NOT EXISTS world_charity_donations (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  amount BIGINT NOT NULL,
  project TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS world_promos (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  blurb TEXT NOT NULL DEFAULT '',
  closes_at BIGINT NOT NULL,
  min_invest BIGINT NOT NULL DEFAULT 1000,
  max_invest BIGINT NOT NULL DEFAULT 500000,
  payout_mult DOUBLE PRECISION NOT NULL DEFAULT 1.35,
  status TEXT NOT NULL DEFAULT 'open'
);
CREATE TABLE IF NOT EXISTS world_promo_invest (
  id SERIAL PRIMARY KEY,
  promo_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  amount BIGINT NOT NULL,
  claimed INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_world_promo_invest_user ON world_promo_invest(user_id);
CREATE TABLE IF NOT EXISTS world_ticket_events (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  venue TEXT NOT NULL DEFAULT '',
  price BIGINT NOT NULL DEFAULT 0,
  organizer_id BIGINT NOT NULL DEFAULT 0,
  capacity BIGINT NOT NULL DEFAULT 200,
  starts_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS world_tickets (
  id SERIAL PRIMARY KEY,
  event_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  price_paid BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  UNIQUE(event_id, user_id)
);
CREATE TABLE IF NOT EXISTS world_rides (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  mode TEXT NOT NULL,
  dest TEXT NOT NULL DEFAULT '',
  fare BIGINT NOT NULL DEFAULT 0,
  go_slow INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);`;

// Seeded ticketed events (original names/copy). Organizer 0 = the city.
function seedTicketEvents() {
  const now = Date.now();
  return [
    { title: 'Blockfest Èkó 2026', venue: 'Tafawa Balewa Square', price: 7500, starts_at: now + 9 * DAY_MS, capacity: 5000 },
    { title: 'ALX Demo Day: Build in Public', venue: 'Yaba Tech Hub', price: 0, starts_at: now + 3 * DAY_MS, capacity: 400 },
    { title: 'Owambe Nights: Live Highlife', venue: 'New Afrika Shrine', price: 2500, starts_at: now + 5 * DAY_MS, capacity: 1200 },
    { title: 'Street Food Festival', venue: 'Muri Okunola Park', price: 1000, starts_at: now + 7 * DAY_MS, capacity: 2000 },
  ];
}

function seedPromos() {
  const now = Date.now();
  return [
    {
      name: 'Èkó Rail & Steel IPO',
      blurb: 'The city is laying new rail. Back the build, share the upside when the round closes.',
      closes_at: now + 10 * DAY_MS,
      min_invest: 5000, max_invest: 500000, payout_mult: 1.35,
    },
  ];
}

/** Split a multi-statement schema into single statements (dbRun's
 *  SQLite path uses prepare(), which accepts exactly one). */
function splitStatements(sql) {
  return sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
}

let _schemaReady = false;
export async function ensureWorldSchema() {
  if (_schemaReady) return;
  // SQLite: one statement per dbRun. Postgres: run the whole batch.
  if (process.env.DATABASE_URL) {
    await dbRun(WORLD_SCHEMA_SQLITE, WORLD_SCHEMA_PG);
  } else {
    for (const stmt of splitStatements(WORLD_SCHEMA_SQLITE)) {
      await dbRun(stmt, stmt);
    }
  }
  // Seed ticketed events + promos once (idempotent: only when empty).
  const ev = await dbGet('SELECT COUNT(*) AS n FROM world_ticket_events', 'SELECT COUNT(*) AS n FROM world_ticket_events', []);
  if (!ev || Number(ev.n) === 0) {
    const now = Date.now();
    for (const e of seedTicketEvents()) {
      await dbRun(
        'INSERT INTO world_ticket_events (title, venue, price, organizer_id, capacity, starts_at, created_at) VALUES (?,?,?,?,?,?,?)',
        'INSERT INTO world_ticket_events (title, venue, price, organizer_id, capacity, starts_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [e.title, e.venue, e.price, 0, e.capacity, e.starts_at, now]);
    }
  }
  const pr = await dbGet('SELECT COUNT(*) AS n FROM world_promos', 'SELECT COUNT(*) AS n FROM world_promos', []);
  if (!pr || Number(pr.n) === 0) {
    for (const p of seedPromos()) {
      await dbRun(
        'INSERT INTO world_promos (name, blurb, closes_at, min_invest, max_invest, payout_mult, status) VALUES (?,?,?,?,?,?,\'open\')',
        'INSERT INTO world_promos (name, blurb, closes_at, min_invest, max_invest, payout_mult, status) VALUES ($1,$2,$3,$4,$5,$6,\'open\')',
        [p.name, p.blurb, p.closes_at, p.min_invest, p.max_invest, p.payout_mult]);
    }
  }
  _schemaReady = true;
}

// ============================================================
// PLAYER-STATE READ HELPERS
// ============================================================

export async function getIllness(userId) {
  await ensureWorldSchema();
  const r = await dbGet(
    'SELECT illness, started_at, "until" AS until_ts FROM world_illness WHERE user_id = ?',
    'SELECT illness, started_at, "until" AS until_ts FROM world_illness WHERE user_id = $1',
    [Number(userId)]);
  if (!r) return null;
  if (Number(r.until_ts) <= Date.now()) {
    await dbRun('DELETE FROM world_illness WHERE user_id = ?', 'DELETE FROM world_illness WHERE user_id = $1', [Number(userId)]);
    return null;
  }
  return { illness: r.illness, startedAt: Number(r.started_at), until: Number(r.until_ts) };
}

export async function setIllness(userId, illnessId, hours) {
  await ensureWorldSchema();
  const now = Date.now();
  await dbRun(
    `INSERT INTO world_illness (user_id, illness, started_at, "until") VALUES (?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET illness=excluded.illness, started_at=excluded.started_at, "until"=excluded."until"`,
    `INSERT INTO world_illness (user_id, illness, started_at, "until") VALUES ($1,$2,$3,$4)
     ON CONFLICT(user_id) DO UPDATE SET illness=excluded.illness, started_at=excluded.started_at, "until"=excluded."until"`,
    [Number(userId), illnessId, now, now + hours * 3600 * 1000]);
}

export async function clearIllness(userId) {
  await ensureWorldSchema();
  await dbRun('DELETE FROM world_illness WHERE user_id = ?', 'DELETE FROM world_illness WHERE user_id = $1', [Number(userId)]);
}

/**
 * HOOK for M8 (needs decay): multiply needs decay by this while ill.
 * Returns 1 when healthy.
 */
export async function playerIllnessDecayMult(userId) {
  const ill = await getIllness(userId);
  if (!ill) return 1;
  const def = ILLNESSES[ill.illness];
  return def ? def.needsMult : 1;
}

// ---- jail ----

export async function isJailed(userId) {
  await ensureWorldSchema();
  const r = await dbGet(
    'SELECT "until" AS until_ts FROM world_jail WHERE user_id = ?',
    'SELECT "until" AS until_ts FROM world_jail WHERE user_id = $1',
    [Number(userId)]);
  if (!r) return null;
  if (Number(r.until_ts) <= Date.now()) {
    await dbRun('DELETE FROM world_jail WHERE user_id = ?', 'DELETE FROM world_jail WHERE user_id = $1', [Number(userId)]);
    return null;
  }
  return { until: Number(r.until_ts) };
}

/**
 * HOOK: jail sentences. Phase 1's "Good Lawyer" perk (25% shorter
 * sentences) should call this with opts.lawyerPerk = true.
 */
export async function applyJailSentence(userId, hours, { reason = '', lawyerPerk = false } = {}) {
  await ensureWorldSchema();
  const h = lawyerPerk ? Math.ceil(hours * 0.75) : Math.ceil(hours);
  const until = Date.now() + h * 3600 * 1000;
  await dbRun(
    `INSERT INTO world_jail (user_id, "until", reason) VALUES (?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET "until"=excluded."until", reason=excluded.reason`,
    `INSERT INTO world_jail (user_id, "until", reason) VALUES ($1,$2,$3)
     ON CONFLICT(user_id) DO UPDATE SET "until"=excluded."until", reason=excluded.reason`,
    [Number(userId), until, reason]);
  return { hours: h, until };
}

// ---- police record ----

export async function listOffences(userId) {
  await ensureWorldSchema();
  const rows = await dbAll(
    'SELECT id, offence, detail, recorded_at FROM world_offences WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 50',
    'SELECT id, offence, detail, recorded_at FROM world_offences WHERE user_id = $1 ORDER BY recorded_at DESC LIMIT 50',
    [Number(userId)]);
  return (rows || []).map(r => {
    const t = OFFENCE_TYPES.find(x => x.id === r.offence);
    return {
      id: Number(r.id), offence: r.offence,
      name: t ? t.name : r.offence, icon: t ? t.icon : '⚠️',
      severity: t ? t.severity : 1,
      detail: r.detail || '', recordedAt: Number(r.recorded_at),
    };
  });
}

export async function recordOffence(userId, offenceId, detail = '') {
  await ensureWorldSchema();
  const t = OFFENCE_TYPES.find(x => x.id === offenceId);
  if (!t) throw new Error('unknown offence: ' + offenceId);
  const row = await dbRun(
    'INSERT INTO world_offences (user_id, offence, detail, recorded_at) VALUES (?,?,?,?)',
    'INSERT INTO world_offences (user_id, offence, detail, recorded_at) VALUES ($1,$2,$3,$4)',
    [Number(userId), offenceId, String(detail).slice(0, 280), Date.now()]);
  // dbRun doesn't return the id portably — re-read the latest.
  const latest = await dbGet(
    'SELECT id FROM world_offences WHERE user_id = ? ORDER BY id DESC LIMIT 1',
    'SELECT id FROM world_offences WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
    [Number(userId)]);
  return { id: latest ? Number(latest.id) : 0, offence: offenceId, severity: t.severity };
}

// ---- court ----

export async function openCase(userId, offenceId, sourceOffenceId, day) {
  await ensureWorldSchema();
  const t = OFFENCE_TYPES.find(x => x.id === offenceId);
  const now = Date.now();
  await dbRun(
    'INSERT INTO world_cases (user_id, offence, severity, source_offence_id, status, hearing_day, outcome, created_at) VALUES (?,?,?,?,?,?,?,?)',
    'INSERT INTO world_cases (user_id, offence, severity, source_offence_id, status, hearing_day, outcome, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [Number(userId), offenceId, t ? t.severity : 1, sourceOffenceId || null, 'pending',
     day + COURT_HEARING_DELAY_DAYS, '', now]);
}

export async function listCases(userId) {
  await ensureWorldSchema();
  const rows = await dbAll(
    'SELECT id, offence, severity, status, hearing_day, outcome, decided_at, created_at FROM world_cases WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    'SELECT id, offence, severity, status, hearing_day, outcome, decided_at, created_at FROM world_cases WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
    [Number(userId)]);
  return (rows || []).map(r => {
    const t = OFFENCE_TYPES.find(x => x.id === r.offence);
    let outcome = null;
    try { outcome = r.outcome ? JSON.parse(r.outcome) : null; } catch { outcome = null; }
    return {
      id: Number(r.id), offence: r.offence, name: t ? t.name : r.offence,
      icon: t ? t.icon : '⚖️', severity: Number(r.severity) || 1,
      status: r.status, hearingDay: Number(r.hearing_day),
      outcome, decidedAt: r.decided_at ? Number(r.decided_at) : null,
      createdAt: Number(r.created_at),
    };
  });
}

/** Resolve a due case and persist the outcome. Returns the outcome. */
export async function resolveCase(caseRow, rand = Math.random) {
  const t = OFFENCE_TYPES.find(x => x.id === caseRow.offence);
  const outcome = hearCase({ severity: caseRow.severity || (t ? t.severity : 1) }, rand);
  await dbRun(
    'UPDATE world_cases SET status=?, outcome=?, decided_at=? WHERE id=?',
    'UPDATE world_cases SET status=$1, outcome=$2, decided_at=$3 WHERE id=$4',
    ['heard', JSON.stringify(outcome), Date.now(), caseRow.id]);
  return outcome;
}

/**
 * Settle one heard case's side effects (fine debit, jail). The fine is
 * capped at what the player can actually pay (never negative balance).
 * Returns the applied outcome.
 */
export async function applyCaseOutcome(userId, outcome) {
  const uid = Number(userId);
  const applied = { ...outcome };
  if (outcome.verdict === 'fined' && outcome.fine > 0) {
    const c = await getCharacter(uid);
    const fine = Math.min(Math.floor(Number(outcome.fine)), Math.max(0, Math.floor(Number(c.money))));
    c.money = Math.max(0, Math.floor(Number(c.money))) - fine;
    await saveCharacter(c);
    await addTransaction(uid, 'court_fine', -fine, Math.floor(Number(c.money)), { fine: outcome.fine });
    applied.finePaid = fine;
  }
  if (outcome.verdict === 'jailed' && outcome.jailHours > 0) {
    const j = await applyJailSentence(uid, outcome.jailHours, { reason: 'court sentence' });
    applied.jailHoursApplied = j.hours;
    applied.jailUntil = j.until;
  }
  return applied;
}

// ---- assurance ----

export async function getAssurance(userId) {
  await ensureWorldSchema();
  const r = await dbGet(
    'SELECT active, paid_until_week, condition, last_roll_week, started_at FROM world_assurance WHERE user_id = ?',
    'SELECT active, paid_until_week, condition, last_roll_week, started_at FROM world_assurance WHERE user_id = $1',
    [Number(userId)]);
  return r ? {
    active: !!Number(r.active), paidUntilWeek: Number(r.paid_until_week),
    condition: Number(r.condition), lastRollWeek: Number(r.last_roll_week),
    startedAt: Number(r.started_at),
  } : null;
}

export async function buyAssurance(userId, week) {
  await ensureWorldSchema();
  const now = Date.now();
  await dbRun(
    `INSERT INTO world_assurance (user_id, active, paid_until_week, condition, last_roll_week, started_at)
     VALUES (?,?,?,100,? ,?)
     ON CONFLICT(user_id) DO UPDATE SET active=1, paid_until_week=excluded.paid_until_week, last_roll_week=excluded.last_roll_week`,
    `INSERT INTO world_assurance (user_id, active, paid_until_week, condition, last_roll_week, started_at)
     VALUES ($1,$2,$3,100,$4,$5)
     ON CONFLICT(user_id) DO UPDATE SET active=1, paid_until_week=excluded.paid_until_week, last_roll_week=excluded.last_roll_week`,
    [Number(userId), 1, week + 1, week, now]);
}

export async function fixCondition(userId) {
  await ensureWorldSchema();
  await dbRun(
    `INSERT INTO world_assurance (user_id, active, paid_until_week, condition, last_roll_week, started_at)
     VALUES (?,?,?,100,?,?)
     ON CONFLICT(user_id) DO UPDATE SET condition=100`,
    `INSERT INTO world_assurance (user_id, active, paid_until_week, condition, last_roll_week, started_at)
     VALUES ($1,$2,$3,100,$4,$5)
     ON CONFLICT(user_id) DO UPDATE SET condition=100`,
    [Number(userId), 0, 0, -1, Date.now()]);
}

export async function listLosses(userId) {
  await ensureWorldSchema();
  const now = Date.now();
  const rows = await dbAll(
    'SELECT id, risk, loss_amount, claimed, created_at, expires_at FROM world_losses WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 20',
    'SELECT id, risk, loss_amount, claimed, created_at, expires_at FROM world_losses WHERE user_id = $1 AND expires_at > $2 ORDER BY created_at DESC LIMIT 20',
    [Number(userId), now]);
  return (rows || []).map(r => {
    const def = ASSURANCE_RISKS[r.risk] || {};
    return {
      id: Number(r.id), risk: r.risk, name: def.name || r.risk, icon: def.icon || '⚠️',
      loss: Number(r.loss_amount), claimed: !!Number(r.claimed),
      payout: assurancePayout(Number(r.loss_amount)),
      createdAt: Number(r.created_at), expiresAt: Number(r.expires_at),
    };
  });
}

// ---- bus co ----

export async function getBusco(userId) {
  await ensureWorldSchema();
  const r = await dbGet(
    'SELECT buses, started_at, last_payout_week FROM world_busco WHERE user_id = ?',
    'SELECT buses, started_at, last_payout_week FROM world_busco WHERE user_id = $1',
    [Number(userId)]);
  return r ? {
    buses: Number(r.buses), startedAt: Number(r.started_at),
    lastPayoutWeek: Number(r.last_payout_week),
    paybackWeeks: buscoPaybackWeeks(),
  } : null;
}

export async function startBusco(userId, week) {
  await ensureWorldSchema();
  await dbRun(
    `INSERT INTO world_busco (user_id, buses, started_at, last_payout_week) VALUES (?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET buses=world_busco.buses+1`,
    `INSERT INTO world_busco (user_id, buses, started_at, last_payout_week) VALUES ($1,$2,$3,$4)
     ON CONFLICT(user_id) DO UPDATE SET buses=world_busco.buses+1`,
    [Number(userId), 1, Date.now(), week]);
}

// ---- ads ----

export async function listMyAds(userId) {
  await ensureWorldSchema();
  const now = Date.now();
  const rows = await dbAll(
    'SELECT id, kind, title, blurb, created_at, expires_at FROM world_ads WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC',
    'SELECT id, kind, title, blurb, created_at, expires_at FROM world_ads WHERE user_id = $1 AND expires_at > $2 ORDER BY created_at DESC',
    [Number(userId), now]);
  return (rows || []).map(r => ({ ...mapAdRow(r), mine: true }));
}

export function mapAdRow(r) {
  return {
    id: Number(r.id), userId: Number(r.user_id ?? r.userId ?? 0),
    kind: r.kind, title: r.title, blurb: r.blurb || '',
    createdAt: Number(r.created_at), expiresAt: Number(r.expires_at),
  };
}

/** Live ads for the map feed (billboards + map plots). */
export async function listActiveAds(limit = 50) {
  await ensureWorldSchema();
  const now = Date.now();
  const rows = await dbAll(
    'SELECT id, user_id, kind, title, blurb, created_at, expires_at FROM world_ads WHERE expires_at > ? ORDER BY created_at DESC LIMIT ?',
    'SELECT id, user_id, kind, title, blurb, created_at, expires_at FROM world_ads WHERE expires_at > $1 ORDER BY created_at DESC LIMIT $2',
    [now, Math.max(1, Math.min(200, Number(limit) || 50))]);
  return (rows || []).map(mapAdRow);
}

export async function buyAd(userId, kind, title, blurb) {
  await ensureWorldSchema();
  const now = Date.now();
  await dbRun(
    'INSERT INTO world_ads (user_id, kind, title, blurb, created_at, expires_at) VALUES (?,?,?,?,?,?)',
    'INSERT INTO world_ads (user_id, kind, title, blurb, created_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [Number(userId), kind, String(title).slice(0, AD_TITLE_MAX), String(blurb).slice(0, AD_BLURB_MAX),
     now, now + AD_DURATION_DAYS * DAY_MS]);
}

// ---- charity ----

export async function charityStats() {
  await ensureWorldSchema();
  const sum = await dbGet(
    'SELECT COALESCE(SUM(amount),0) AS total, COUNT(DISTINCT user_id) AS donors FROM world_charity_donations',
    'SELECT COALESCE(SUM(amount),0) AS total, COUNT(DISTINCT user_id) AS donors FROM world_charity_donations',
    []);
  const fund = CHARITY_SEED + (Number(sum && sum.total) || 0);
  return { fund, donors: Number(sum && sum.donors) || 0, seed: CHARITY_SEED };
}

export async function giveToCharity(userId, amount, project = '') {
  await ensureWorldSchema();
  await dbRun(
    'INSERT INTO world_charity_donations (user_id, amount, project, created_at) VALUES (?,?,?,?)',
    'INSERT INTO world_charity_donations (user_id, amount, project, created_at) VALUES ($1,$2,$3,$4)',
    [Number(userId), Math.floor(Number(amount)), String(project).slice(0, 40), Date.now()]);
}

// ---- promos ----

export async function listPromos(userId) {
  await ensureWorldSchema();
  const now = Date.now();
  const rows = await dbAll(
    'SELECT id, name, blurb, closes_at, min_invest, max_invest, payout_mult, status FROM world_promos ORDER BY closes_at ASC',
    'SELECT id, name, blurb, closes_at, min_invest, max_invest, payout_mult, status FROM world_promos ORDER BY closes_at ASC',
    []);
  const mine = userId ? await dbAll(
    'SELECT promo_id, COALESCE(SUM(amount),0) AS invested, MAX(claimed) AS claimed FROM world_promo_invest WHERE user_id = ? GROUP BY promo_id',
    'SELECT promo_id, COALESCE(SUM(amount),0) AS invested, MAX(claimed) AS claimed FROM world_promo_invest WHERE user_id = $1 GROUP BY promo_id',
    [Number(userId)]) : [];
  const mineMap = {};
  for (const m of mine || []) mineMap[String(m.promo_id)] = { invested: Number(m.invested) || 0, claimed: !!Number(m.claimed) };
  return (rows || []).map(r => ({
    id: Number(r.id), name: r.name, blurb: r.blurb,
    closesAt: Number(r.closes_at), msLeft: Math.max(0, Number(r.closes_at) - now),
    minInvest: Number(r.min_invest), maxInvest: Number(r.max_invest),
    payoutMult: Number(r.payout_mult),
    status: now >= Number(r.closes_at) ? 'closed' : r.status,
    mine: mineMap[String(r.id)] || { invested: 0, claimed: false },
  }));
}

export async function investPromo(userId, promoId, amount) {
  await ensureWorldSchema();
  await dbRun(
    'INSERT INTO world_promo_invest (promo_id, user_id, amount, claimed, created_at) VALUES (?,?,?,0,?)',
    'INSERT INTO world_promo_invest (promo_id, user_id, amount, claimed, created_at) VALUES ($1,$2,$3,0,$4)',
    [Number(promoId), Number(userId), Math.floor(Number(amount)), Date.now()]);
}

export async function getPromo(promoId) {
  await ensureWorldSchema();
  return dbGet(
    'SELECT id, name, closes_at, min_invest, max_invest, payout_mult, status FROM world_promos WHERE id = ?',
    'SELECT id, name, closes_at, min_invest, max_invest, payout_mult, status FROM world_promos WHERE id = $1',
    [Number(promoId)]);
}

export async function claimPromo(userId, promoId) {
  await ensureWorldSchema();
  const rows = await dbAll(
    'SELECT id, amount FROM world_promo_invest WHERE promo_id = ? AND user_id = ? AND claimed = 0',
    'SELECT id, amount FROM world_promo_invest WHERE promo_id = $1 AND user_id = $2 AND claimed = 0',
    [Number(promoId), Number(userId)]);
  if (!rows || !rows.length) return { claimed: 0, payout: 0 };
  const p = await getPromo(promoId);
  const mult = p ? Number(p.payout_mult) : PROMO_PAYOUT_DEFAULT;
  let invested = 0;
  for (const r of rows) invested += Number(r.amount) || 0;
  const payout = Math.floor(invested * mult);
  await dbRun(
    'UPDATE world_promo_invest SET claimed = 1 WHERE promo_id = ? AND user_id = ? AND claimed = 0',
    'UPDATE world_promo_invest SET claimed = 1 WHERE promo_id = $1 AND user_id = $2 AND claimed = 0',
    [Number(promoId), Number(userId)]);
  return { claimed: invested, payout };
}

// ---- event tickets ----

export async function listTicketEvents(userId) {
  await ensureWorldSchema();
  const now = Date.now();
  const rows = await dbAll(
    'SELECT id, title, venue, price, organizer_id, capacity, starts_at, created_at FROM world_ticket_events WHERE starts_at > ? ORDER BY starts_at ASC LIMIT 30',
    'SELECT id, title, venue, price, organizer_id, capacity, starts_at, created_at FROM world_ticket_events WHERE starts_at > $1 ORDER BY starts_at ASC LIMIT 30',
    [now]);
  const out = [];
  for (const r of rows || []) {
    const sold = await dbGet(
      'SELECT COUNT(*) AS n FROM world_tickets WHERE event_id = ?',
      'SELECT COUNT(*) AS n FROM world_tickets WHERE event_id = $1',
      [Number(r.id)]);
    let mine = null;
    if (userId) {
      mine = await dbGet(
        'SELECT id FROM world_tickets WHERE event_id = ? AND user_id = ?',
        'SELECT id FROM world_tickets WHERE event_id = $1 AND user_id = $2',
        [Number(r.id), Number(userId)]);
    }
    out.push({
      id: Number(r.id), title: r.title, venue: r.venue, price: Number(r.price),
      organizerId: Number(r.organizer_id), capacity: Number(r.capacity),
      sold: Number(sold && sold.n) || 0, startsAt: Number(r.starts_at),
      hasTicket: !!mine, organizerFee: ticketOrganizerNet(Number(r.price)),
    });
  }
  return out;
}

export async function getTicketEvent(eventId) {
  await ensureWorldSchema();
  return dbGet(
    'SELECT id, title, venue, price, organizer_id, capacity, starts_at FROM world_ticket_events WHERE id = ?',
    'SELECT id, title, venue, price, organizer_id, capacity, starts_at FROM world_ticket_events WHERE id = $1',
    [Number(eventId)]);
}

export async function buyTicket(userId, eventId, pricePaid) {
  await ensureWorldSchema();
  await dbRun(
    'INSERT INTO world_tickets (event_id, user_id, price_paid, created_at) VALUES (?,?,?,?)',
    'INSERT INTO world_tickets (event_id, user_id, price_paid, created_at) VALUES ($1,$2,$3,$4)',
    [Number(eventId), Number(userId), Math.floor(Number(pricePaid)), Date.now()]);
}

export async function createTicketEvent(organizerId, { title, venue, price, capacity, startsAt }) {
  await ensureWorldSchema();
  const now = Date.now();
  await dbRun(
    'INSERT INTO world_ticket_events (title, venue, price, organizer_id, capacity, starts_at, created_at) VALUES (?,?,?,?,?,?,?)',
    'INSERT INTO world_ticket_events (title, venue, price, organizer_id, capacity, starts_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [String(title).slice(0, 60), String(venue || '').slice(0, 60), Math.floor(Number(price) || 0),
     Number(organizerId), Math.max(1, Math.min(50000, Math.floor(Number(capacity) || 200))),
     Number(startsAt), now]);
  const latest = await dbGet(
    'SELECT id FROM world_ticket_events WHERE organizer_id = ? ORDER BY id DESC LIMIT 1',
    'SELECT id FROM world_ticket_events WHERE organizer_id = $1 ORDER BY id DESC LIMIT 1',
    [Number(organizerId)]);
  return latest ? Number(latest.id) : 0;
}

export async function listMyTickets(userId) {
  await ensureWorldSchema();
  const rows = await dbAll(
    `SELECT t.id, t.event_id, t.price_paid, e.title, e.venue, e.starts_at
     FROM world_tickets t JOIN world_ticket_events e ON e.id = t.event_id
     WHERE t.user_id = ? ORDER BY e.starts_at ASC`,
    `SELECT t.id, t.event_id, t.price_paid, e.title, e.venue, e.starts_at
     FROM world_tickets t JOIN world_ticket_events e ON e.id = t.event_id
     WHERE t.user_id = $1 ORDER BY e.starts_at ASC`,
    [Number(userId)]);
  return (rows || []).map(r => ({
    id: Number(r.id), eventId: Number(r.event_id), pricePaid: Number(r.price_paid),
    title: r.title, venue: r.venue, startsAt: Number(r.starts_at),
  }));
}

// ============================================================
// DAY TICK — daily/weekly settlement for world systems.
// hub: { pushYou(userId)?, sendTo(userId, msg)? }
// ============================================================

async function creditCoins(userId, amount, kind, meta, hub) {
  const uid = Number(userId);
  const amt = Math.floor(Number(amount));
  const c = await getCharacter(uid);
  if (!c) return null;
  c.money = Math.max(0, Math.floor(Number(c.money)) + amt);
  await saveCharacter(c);
  await addTransaction(uid, kind, amt, Math.floor(Number(c.money)), meta || {});
  if (hub && typeof hub.pushYou === 'function') {
    try { await hub.pushYou(uid); } catch { /* best effort */ }
  }
  return Math.floor(Number(c.money));
}

function weekOf(day) { return Math.floor(Number(day) / 7); }

export async function worldDayTick({ day, hub = {}, rand = Math.random } = {}) {
  await ensureWorldSchema();
  const now = Date.now();
  const week = weekOf(day);

  // 1) Court: hear cases whose hearing day arrived.
  const due = await dbAll(
    'SELECT id, user_id, offence, severity FROM world_cases WHERE status = ? AND hearing_day <= ?',
    'SELECT id, user_id, offence, severity FROM world_cases WHERE status = $1 AND hearing_day <= $2',
    ['pending', day]);
  for (const c of due || []) {
    const outcome = await resolveCase({ id: Number(c.id), offence: c.offence, severity: Number(c.severity) }, rand);
    const applied = await applyCaseOutcome(Number(c.user_id), outcome);
    if (hub.sendTo) {
      const msg = applied.verdict === 'dismissed'
        ? `⚖️ Court dismissed your case (${c.offence}). You walk free!`
        : applied.verdict === 'fined'
          ? `⚖️ Court verdict: fined ${naira(applied.finePaid)}. ${outcome.note}`
          : `⚖️ Court verdict: ${applied.jailHoursApplied}h in the cell. ${outcome.note}`;
      try { hub.sendTo(Number(c.user_id), { t: 'sys', text: msg }); } catch { /* best effort */ }
    }
  }

  // 2) Illness: rows self-expire on read; sweep here too.
  await dbRun('DELETE FROM world_illness WHERE "until" <= ?', 'DELETE FROM world_illness WHERE "until" <= $1', [now]);

  // 3) Assurance: weekly premium + risk rolls.
  const policies = await dbAll(
    'SELECT user_id, active, paid_until_week, last_roll_week, condition FROM world_assurance',
    'SELECT user_id, active, paid_until_week, condition, last_roll_week FROM world_assurance',
    []);
  for (const p of policies || []) {
    const uid = Number(p.user_id);
    if (!Number(p.active)) continue;
    if (Number(p.last_roll_week) >= week) continue;
    // Premium due?
    if (Number(p.paid_until_week) <= week) {
      const c = await getCharacter(uid);
      if (c && Math.floor(Number(c.money)) >= ASSURANCE_PREMIUM) {
        c.money = Math.floor(Number(c.money)) - ASSURANCE_PREMIUM;
        await saveCharacter(c);
        await addTransaction(uid, 'assurance_premium', -ASSURANCE_PREMIUM, Math.floor(Number(c.money)), { week });
        await dbRun(
          'UPDATE world_assurance SET paid_until_week = ?, last_roll_week = ? WHERE user_id = ?',
          'UPDATE world_assurance SET paid_until_week = $1, last_roll_week = $2 WHERE user_id = $3',
          [week + 1, week, uid]);
      } else {
        // Lapsed: no cover this week, policy goes dormant.
        await dbRun(
          'UPDATE world_assurance SET active = 0, last_roll_week = ? WHERE user_id = ?',
          'UPDATE world_assurance SET active = 0, last_roll_week = $1 WHERE user_id = $2',
          [week, uid]);
        continue;
      }
    } else {
      await dbRun(
        'UPDATE world_assurance SET last_roll_week = ? WHERE user_id = ?',
        'UPDATE world_assurance SET last_roll_week = $1 WHERE user_id = $2',
        [week, uid]);
    }
    const hits = rollAssuranceRisk(rand);
    for (const h of hits) {
      await dbRun(
        'INSERT INTO world_losses (user_id, risk, loss_amount, claimed, created_at, expires_at) VALUES (?,?,?,0,?,?)',
        'INSERT INTO world_losses (user_id, risk, loss_amount, claimed, created_at, expires_at) VALUES ($1,$2,$3,0,$4,$5)',
        [uid, h.risk, h.loss, now, now + 7 * DAY_MS]);
      if (h.risk === 'fire' || h.risk === 'flood') {
        const cond = Math.max(20, Number(p.condition) - (h.risk === 'fire' ? 18 : 12));
        await dbRun(
          'UPDATE world_assurance SET condition = ? WHERE user_id = ?',
          'UPDATE world_assurance SET condition = $1 WHERE user_id = $2',
          [cond, uid]);
      }
      if (hub.sendTo) {
        const def = ASSURANCE_RISKS[h.risk];
        try {
          hub.sendTo(uid, { t: 'sys', text: `${def.icon} ${def.name} hit! You lost ${naira(h.loss)}. File a claim in the Assurance app within 7 days.` });
        } catch { /* best effort */ }
      }
    }
  }

  // 4) Bus Co: weekly yield per company.
  const fleets = await dbAll(
    'SELECT user_id, buses, last_payout_week FROM world_busco WHERE buses > 0',
    'SELECT user_id, buses, last_payout_week FROM world_busco WHERE buses > 0',
    []);
  for (const f of fleets || []) {
    if (Number(f.last_payout_week) >= week) continue;
    const uid = Number(f.user_id);
    const payout = BUSCO_WEEKLY_YIELD * Number(f.buses);
    await creditCoins(uid, payout, 'busco_yield', { buses: Number(f.buses), week }, hub);
    await dbRun(
      'UPDATE world_busco SET last_payout_week = ? WHERE user_id = ?',
      'UPDATE world_busco SET last_payout_week = $1 WHERE user_id = $2',
      [week, uid]);
  }

  // 5) Promos: close expired rounds (investments become claimable).
  await dbRun(
    'UPDATE world_promos SET status = ? WHERE status = ? AND closes_at <= ?',
    'UPDATE world_promos SET status = $1 WHERE status = $2 AND closes_at <= $3',
    ['closed', 'open', now]);

  // 6) Sweep expired loss claims + ads.
  await dbRun('DELETE FROM world_losses WHERE expires_at <= ?', 'DELETE FROM world_losses WHERE expires_at <= $1', [now]);
  await dbRun('DELETE FROM world_ads WHERE expires_at <= ?', 'DELETE FROM world_ads WHERE expires_at <= $1', [now]);
}
