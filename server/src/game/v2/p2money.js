// ============================================================
// game/v2/p2money.js — PORT-P2: money systems (savings, term notes,
// credibility score, Saturday rent, housing ladder).
//
// GAMEPLAY COINS ONLY. Nothing here touches fintech / the cash wallet.
// All amounts are integer coins (Math.floor).
//
// Contents:
//   - Savings: 0.5% per game week, interest accrues per real minute and
//     is credited to savings on the day tick; only the first ₦1bn earns;
//     minimum withdrawal ₦1,000.
//   - Term notes: 2% per 7 game days, ₦10,000 min / ₦500m max per note.
//     Early withdrawal returns the principal and FORFEITS the interest.
//   - Credibility score 0–100 with a 6-part breakdown. RECORD ONLY — it
//     never gates or limits transfers (said in the UI copy too).
//   - Housing ladder: 8 homes with weekly rent + buy price. Rent is due
//     every Saturday (day 7 of each game week) on the day tick; unpaid
//     rent becomes a debt flag — no eviction, no lockout, ever.
//   - Module-owned tables (p2_notes, p2_profile) per the v2 contract.
// ============================================================
import {
  dbRun, dbGet, dbAll, dbRunReturning, dbMode,
  addTransaction, getMeta, setMeta, listCharacters,
} from '../../db.js';
import { DAY_MS } from '../data.js';
import { canAfford, charge } from '../money.js';
import { weekIndex } from './m10.js';

// ---------------- Savings ----------------
// 0.5% per game week (7 game days). Interest accrues per real minute and
// is credited to the savings balance on the day tick.
export const SAVINGS_WEEKLY_RATE = 0.005;
export const SAVINGS_CAP = 1_000_000_000; // only the first ₦1bn earns
export const SAVINGS_MIN_WITHDRAW = 1000;
export const GAME_WEEK_MINUTES = (7 * DAY_MS) / 60000; // 35 real minutes

const naira = (n) => '₦' + Math.floor(Number(n) || 0).toLocaleString('en-NG');

/**
 * Interest owed on `savings` for `elapsedMin` real minutes (pure).
 * Pro-rata: 0.5% spread evenly across the 35 real minutes of a game week.
 */
export function savingsInterestFor(savings, elapsedMin) {
  const base = Math.min(Math.max(0, Math.floor(Number(savings) || 0)), SAVINGS_CAP);
  const mins = Math.max(0, Number(elapsedMin) || 0);
  if (base <= 0 || mins <= 0) return 0;
  return Math.floor((base * SAVINGS_WEEKLY_RATE * mins) / GAME_WEEK_MINUTES);
}

// ---------------- Term notes (2% / 7 days) ----------------
// A separate product from the Phase-4 bonds: single 7-day term, capped
// size, and early withdrawal that forfeits the interest.
export const NOTE_RATE = 0.02;
export const NOTE_TERM_DAYS = 7;
export const NOTE_MIN = 10_000;
export const NOTE_MAX = 500_000_000;

export function validateNoteBuy({ amount }) {
  const amt = Math.floor(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, error: 'Enter a valid amount.' };
  if (amt < NOTE_MIN) return { ok: false, error: `Term notes start at ${naira(NOTE_MIN)}.` };
  if (amt > NOTE_MAX) return { ok: false, error: `One note caps at ${naira(NOTE_MAX)} — buy several.` };
  return { ok: true, amount: amt };
}

export function noteInterest(note) {
  return Math.floor(Math.floor(Number(note.principal) || 0) * NOTE_RATE);
}
export function notePayout(note) {
  return Math.floor(Number(note.principal) || 0) + noteInterest(note);
}
export function noteMaturesDay(note) {
  return Math.floor(Number(note.start_day) || 0) + NOTE_TERM_DAYS;
}
export function noteDue(note, day) {
  return Number(note.matured) !== 1 && Number(note.withdrawn) !== 1
    && noteMaturesDay(note) <= Math.floor(Number(day) || 0);
}
export function noteActive(note) {
  return Number(note.matured) !== 1 && Number(note.withdrawn) !== 1;
}

// ---------------- Housing ladder ----------------
// 8 homes: weekly rent + outright buy price. Renting is by "move in";
// buying the home you live in (or any home) stops its rent.
export const HOMES = {
  room_oshodi:   { id: 'room_oshodi',   name: 'Single Room · Oshodi',        icon: '🏠', weeklyRent: 8000,   buyPrice: 450000 },
  selfcon_yaba:  { id: 'selfcon_yaba',  name: 'Self-Contain · Yaba',         icon: '🏡', weeklyRent: 15000,  buyPrice: 900000 },
  flat_surulere: { id: 'flat_surulere', name: '2-Bedroom Flat · Surulere',   icon: '🏘️', weeklyRent: 35000,  buyPrice: 2800000 },
  bungalow_ikeja:{ id: 'bungalow_ikeja',name: 'Bungalow · Ikeja GRA',        icon: '🏚️', weeklyRent: 60000,  buyPrice: 6000000 },
  duplex_lekki:  { id: 'duplex_lekki',  name: 'Duplex · Lekki Phase 1',      icon: '🏰', weeklyRent: 90000,  buyPrice: 9500000 },
  estate_ajah:   { id: 'estate_ajah',   name: 'Detached Duplex · Ajah',      icon: '🏞️', weeklyRent: 150000, buyPrice: 18000000 },
  penthouse_vi:  { id: 'penthouse_vi',  name: 'Penthouse · Victoria Island', icon: '🌆', weeklyRent: 220000, buyPrice: 28000000 },
  mansion_ikoyi: { id: 'mansion_ikoyi', name: 'Mansion · Ikoyi',             icon: '🏛️', weeklyRent: 450000, buyPrice: 75000000 },
};
export const HOME_IDS = Object.keys(HOMES);

/** Rent is due every Saturday: day 7 of each 7-day game week, on the day tick. */
export function isRentSaturday(day) {
  const d = Math.floor(Number(day) || 0);
  return d > 0 && d % 7 === 0;
}

// ---------------- Credibility score ----------------
// 0–100, six parts. RECORD ONLY — never gates or limits transfers.
export const CRED_WEIGHTS = {
  accountAge: 10,      // 1 pt per 30 days of account age
  movedWithPlayers: 25,// 1 pt per ₦10k of player-to-player volume
  regularPartners: 15, // 3 pts per counterparty traded on 3+ distinct days
  streaks: 15,         // 1 pt per consecutive day with player-money activity
  collected: 15,       // 1 pt per ₦10k received from players
  jobsBusiness: 20,    // business +8, shop +7, paid work +5
};
/** Transaction kinds that count as money moved with other players. */
export const P2P_KINDS = new Set(['shop_sale', 'shop_earn']);

function dayKey(ms) {
  const d = new Date(Number(ms) || 0);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

/**
 * Pure credibility scoring from assembled inputs.
 * `txs`: [{ kind, amount, created_at, counterparty }] (counterparty = a
 * stable string per other party, e.g. username or 'shop:<id>').
 */
export function scoreCredibility({ accountAgeDays = 0, txs = [], hasBiz = false, hasShop = false, workedPaid = false } = {}) {
  const p2p = (txs || []).filter((t) => P2P_KINDS.has(String(t.kind)));
  const accountAge = Math.min(CRED_WEIGHTS.accountAge, Math.floor(Math.max(0, Number(accountAgeDays) || 0) / 30));

  const volume = p2p.reduce((a, t) => a + Math.abs(Math.floor(Number(t.amount) || 0)), 0);
  const movedWithPlayers = Math.min(CRED_WEIGHTS.movedWithPlayers, Math.floor(volume / 10000));

  // Regular partners: distinct counterparties seen on 3+ distinct days.
  const byParty = new Map();
  for (const t of p2p) {
    const cp = String(t.counterparty || '').trim();
    if (!cp) continue;
    if (!byParty.has(cp)) byParty.set(cp, new Set());
    byParty.get(cp).add(dayKey(t.created_at));
  }
  let qualifying = 0;
  for (const days of byParty.values()) if (days.size >= 3) qualifying += 1;
  const regularPartners = Math.min(CRED_WEIGHTS.regularPartners, qualifying * 3);

  // Streaks: consecutive UTC days (ending today or yesterday) with p2p activity.
  const days = new Set(p2p.map((t) => dayKey(t.created_at)));
  const now = new Date();
  const keyOf = (d) => `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
  let streak = 0;
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (!days.has(keyOf(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1); // allow "yesterday" as streak end
  while (days.has(keyOf(cursor))) { streak += 1; cursor.setUTCDate(cursor.getUTCDate() - 1); }
  const streaks = Math.min(CRED_WEIGHTS.streaks, streak);

  const collected = p2p.reduce((a, t) => a + Math.max(0, Math.floor(Number(t.amount) || 0)), 0);
  const collectedPts = Math.min(CRED_WEIGHTS.collected, Math.floor(collected / 10000));

  const jobsBusiness = Math.min(CRED_WEIGHTS.jobsBusiness,
    (hasBiz ? 8 : 0) + (hasShop ? 7 : 0) + (workedPaid ? 5 : 0));

  const parts = [
    { key: 'accountAge', label: 'Account age', score: accountAge, max: CRED_WEIGHTS.accountAge, detail: `${Math.floor(Math.max(0, Number(accountAgeDays) || 0))} days with Èkó Life` },
    { key: 'movedWithPlayers', label: 'Money moved with players', score: movedWithPlayers, max: CRED_WEIGHTS.movedWithPlayers, detail: `${naira(volume)} moved` },
    { key: 'regularPartners', label: 'Regular partners', score: regularPartners, max: CRED_WEIGHTS.regularPartners, detail: `${qualifying} partner${qualifying === 1 ? '' : 's'} traded on 3+ days` },
    { key: 'streaks', label: 'Money streaks', score: streaks, max: CRED_WEIGHTS.streaks, detail: `${streak}-day active streak` },
    { key: 'collected', label: 'Money collected', score: collectedPts, max: CRED_WEIGHTS.collected, detail: `${naira(collected)} received` },
    { key: 'jobsBusiness', label: 'Jobs and business', score: jobsBusiness, max: CRED_WEIGHTS.jobsBusiness, detail: [hasBiz && 'runs a business', hasShop && 'runs a shop', workedPaid && 'does paid work'].filter(Boolean).join(' · ') || 'no jobs or business yet' },
  ];
  const total = parts.reduce((a, p) => a + p.score, 0);
  return { total: Math.min(100, total), parts };
}

// ---------------- Module-owned tables ----------------

const SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS p2_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  principal INTEGER NOT NULL,
  rate REAL NOT NULL,
  start_day INTEGER NOT NULL,
  term_days INTEGER NOT NULL,
  matured INTEGER NOT NULL DEFAULT 0,
  matured_day INTEGER,
  withdrawn INTEGER NOT NULL DEFAULT 0,
  withdrawn_day INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_p2_notes_user ON p2_notes(user_id);
CREATE TABLE IF NOT EXISTS p2_profile (
  user_id INTEGER PRIMARY KEY,
  savings_accrue_ms INTEGER NOT NULL DEFAULT 0,
  rent_debt INTEGER NOT NULL DEFAULT 0,
  home_id TEXT,
  home_owned TEXT NOT NULL DEFAULT '[]'
);`;

const SCHEMA_PG = `
CREATE TABLE IF NOT EXISTS p2_notes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  principal BIGINT NOT NULL,
  rate DOUBLE PRECISION NOT NULL,
  start_day INTEGER NOT NULL,
  term_days INTEGER NOT NULL,
  matured INTEGER NOT NULL DEFAULT 0,
  matured_day INTEGER,
  withdrawn INTEGER NOT NULL DEFAULT 0,
  withdrawn_day INTEGER,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_p2_notes_user ON p2_notes(user_id);
CREATE TABLE IF NOT EXISTS p2_profile (
  user_id INTEGER PRIMARY KEY,
  savings_accrue_ms BIGINT NOT NULL DEFAULT 0,
  rent_debt BIGINT NOT NULL DEFAULT 0,
  home_id TEXT,
  home_owned TEXT NOT NULL DEFAULT '[]'
);`;

let schemaReady = false;
export async function ensureP2Schema() {
  if (schemaReady) return;
  const split = (sql) => sql.split(';').map((s) => s.trim()).filter(Boolean);
  const lite = split(SCHEMA_SQLITE);
  const pg = split(SCHEMA_PG);
  for (let i = 0; i < lite.length; i++) await dbRun(lite[i], pg[i] || lite[i]);
  schemaReady = true;
}

/** Test hook: drop P2 tables so tests start clean. */
export async function _resetP2Schema() {
  schemaReady = false;
  await dbRun('DROP TABLE IF EXISTS p2_notes', 'DROP TABLE IF EXISTS p2_notes', []);
  await dbRun('DROP TABLE IF EXISTS p2_profile', 'DROP TABLE IF EXISTS p2_profile', []);
  await ensureP2Schema();
}

function normalizeNote(r) {
  return {
    id: Number(r.id),
    user_id: Number(r.user_id),
    principal: Math.floor(Number(r.principal) || 0),
    rate: Number(r.rate) || 0,
    start_day: Math.floor(Number(r.start_day) || 0),
    term_days: Math.floor(Number(r.term_days) || 0),
    matured: Number(r.matured) === 1,
    matured_day: r.matured_day == null ? null : Math.floor(Number(r.matured_day)),
    withdrawn: Number(r.withdrawn) === 1,
    withdrawn_day: r.withdrawn_day == null ? null : Math.floor(Number(r.withdrawn_day)),
  };
}

export async function listNotes(userId) {
  await ensureP2Schema();
  const rows = await dbAll(
    'SELECT * FROM p2_notes WHERE user_id=? ORDER BY id DESC',
    'SELECT * FROM p2_notes WHERE user_id=$1 ORDER BY id DESC',
    [userId]);
  return rows.map(normalizeNote);
}

export async function getNote(id) {
  await ensureP2Schema();
  const row = await dbGet('SELECT * FROM p2_notes WHERE id=?', 'SELECT * FROM p2_notes WHERE id=$1', [id]);
  return row ? normalizeNote(row) : null;
}

async function createNote(userId, { principal, startDay }) {
  await ensureP2Schema();
  const now = Date.now();
  if (dbMode() === 'postgres') {
    const r = await dbRunReturning(
      'INSERT INTO p2_notes (user_id, principal, rate, start_day, term_days, matured, withdrawn, created_at) VALUES (?,?,?,?,?,0,0,?)',
      'INSERT INTO p2_notes (user_id, principal, rate, start_day, term_days, matured, withdrawn, created_at) VALUES ($1,$2,$3,$4,$5,0,0,$6) RETURNING id',
      [userId, principal, NOTE_RATE, startDay, NOTE_TERM_DAYS, now]);
    return r.rows.length ? Number(r.rows[0].id) : null;
  }
  await dbRun(
    'INSERT INTO p2_notes (user_id, principal, rate, start_day, term_days, matured, withdrawn, created_at) VALUES (?,?,?,?,?,0,0,?)',
    'INSERT INTO p2_notes (user_id, principal, rate, start_day, term_days, matured, withdrawn, created_at) VALUES ($1,$2,$3,$4,$5,0,0,$6)',
    [userId, principal, NOTE_RATE, startDay, NOTE_TERM_DAYS, now]);
  const row = await dbGet(
    'SELECT id FROM p2_notes WHERE user_id=? ORDER BY id DESC LIMIT 1',
    'SELECT id FROM p2_notes WHERE user_id=$1 ORDER BY id DESC LIMIT 1',
    [userId]);
  return row ? Number(row.id) : null;
}

/** Atomic maturity claim (0→1); only the winner credits the payout. */
async function claimNoteMaturity(id, day) {
  const r = await dbRunReturning(
    'UPDATE p2_notes SET matured=1, matured_day=? WHERE id=? AND matured=0 AND withdrawn=0',
    'UPDATE p2_notes SET matured=1, matured_day=$1 WHERE id=$2 AND matured=0 AND withdrawn=0 RETURNING id',
    [Math.floor(Number(day) || 0), id]);
  return Number(r.changes) > 0;
}

/** Atomic early-withdrawal claim (0→1); only the winner credits principal. */
async function claimNoteWithdrawal(id, day) {
  const r = await dbRunReturning(
    'UPDATE p2_notes SET withdrawn=1, withdrawn_day=? WHERE id=? AND withdrawn=0 AND matured=0',
    'UPDATE p2_notes SET withdrawn=1, withdrawn_day=$1 WHERE id=$2 AND withdrawn=0 AND matured=0 RETURNING id',
    [Math.floor(Number(day) || 0), id]);
  return Number(r.changes) > 0;
}

function p2Error(status, error) {
  const e = new Error(error);
  e.status = status;
  e.p2Error = true;
  return e;
}

/** Buy a 7-day term note. Server-validated amount + affordability. */
export async function buyNoteFor({ user, character, isAdmin, amount, day }) {
  const v = validateNoteBuy({ amount });
  if (!v.ok) throw p2Error(400, v.error);
  const c = character;
  if (!canAfford(c, v.amount, isAdmin)) throw p2Error(400, "You don't have that much cash.");
  const deducted = charge(c, v.amount, isAdmin);
  const noteId = await createNote(user.id, { principal: v.amount, startDay: Math.floor(Number(day) || 1) });
  c.money = Math.max(0, Math.floor(Number(c.money) || 0));
  await addTransaction(user.id, 'note_buy', -deducted, c.money, {
    note_id: noteId, principal: v.amount, rate: NOTE_RATE, term_days: NOTE_TERM_DAYS,
  });
  const note = await getNote(noteId);
  console.log(`[p2] ${user.username} bought term note #${noteId} (${naira(v.amount)} · 7d @ 2%)`);
  return { note };
}

/**
 * Early withdrawal: principal comes back, the 2% interest is FORFEITED.
 * Only on active, un-matured notes.
 */
export async function withdrawNoteEarlyFor({ user, character, isAdmin, noteId, day }) {
  const note = await getNote(noteId);
  if (!note || Number(note.user_id) !== Number(user.id)) throw p2Error(404, 'Note not found.');
  if (!noteActive(note)) throw p2Error(400, 'That note is already closed.');
  if (noteDue(note, day)) throw p2Error(400, 'That note already matured — the payout lands on the next day tick.');
  const claimed = await claimNoteWithdrawal(note.id, day);
  if (!claimed) throw p2Error(409, 'That note was just closed — refresh and try again.');
  const c = character;
  c.money = Math.max(0, Math.floor(Number(c.money) || 0)) + note.principal;
  await addTransaction(user.id, 'note_early_withdraw', note.principal, c.money, {
    note_id: note.id, principal: note.principal, interest_forfeited: noteInterest(note),
  });
  console.log(`[p2] ${user.username} withdrew note #${note.id} early (+${naira(note.principal)}, interest forfeited)`);
  return { note: await getNote(note.id), principal: note.principal, forfeited: noteInterest(note) };
}

/** Settle matured notes for one player. Returns { payouts, notes }. */
export async function settleNotes(userId, char, day, { admin } = {}) {
  await ensureP2Schema();
  const notes = await listNotes(userId);
  const payouts = [];
  const out = [];
  for (const note of notes) {
    if (!noteDue(note, day)) continue;
    const claimed = await claimNoteMaturity(note.id, day);
    if (!claimed) continue;
    const payout = notePayout(note);
    char.money = Math.max(0, Math.floor(Number(char.money) || 0)) + payout;
    await addTransaction(userId, 'note_payout', payout, char.money, {
      note_id: note.id, principal: note.principal, interest: noteInterest(note),
    });
    payouts.push({ note, payout });
    out.push(`📜 Term note #${note.id} matured: +${naira(payout)} (${naira(note.principal)} + ${naira(noteInterest(note))} interest).`);
  }
  return { payouts, notes: out };
}

// ---------------- P2 profile (savings clock, rent debt, housing) ----------------

function normalizeProfile(userId, r) {
  let owned = [];
  try { owned = JSON.parse((r && r.home_owned) || '[]'); } catch { owned = []; }
  return {
    user_id: Number(userId),
    savings_accrue_ms: Math.floor(Number((r && r.savings_accrue_ms) || 0)),
    rent_debt: Math.max(0, Math.floor(Number((r && r.rent_debt) || 0))),
    home_id: (r && r.home_id) || null,
    home_owned: Array.isArray(owned) ? owned.filter((id) => HOMES[id]) : [],
  };
}

export async function getP2Profile(userId) {
  await ensureP2Schema();
  let row = await dbGet(
    'SELECT * FROM p2_profile WHERE user_id=?',
    'SELECT * FROM p2_profile WHERE user_id=$1',
    [userId]);
  if (!row) {
    // Idempotent insert: concurrent callers may race the lazy create.
    await dbRun(
      'INSERT OR IGNORE INTO p2_profile (user_id, savings_accrue_ms, rent_debt, home_id, home_owned) VALUES (?,?,?,?,?)',
      'INSERT INTO p2_profile (user_id, savings_accrue_ms, rent_debt, home_id, home_owned) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id) DO NOTHING',
      [userId, Date.now(), 0, null, '[]']);
    row = await dbGet(
      'SELECT * FROM p2_profile WHERE user_id=?',
      'SELECT * FROM p2_profile WHERE user_id=$1',
      [userId]);
  }
  return normalizeProfile(userId, row);
}

export async function saveP2Profile(p) {
  await ensureP2Schema();
  await dbRun(
    'UPDATE p2_profile SET savings_accrue_ms=?, rent_debt=?, home_id=?, home_owned=? WHERE user_id=?',
    'UPDATE p2_profile SET savings_accrue_ms=$1, rent_debt=$2, home_id=$3, home_owned=$4 WHERE user_id=$5',
    [Math.floor(Number(p.savings_accrue_ms) || 0), Math.max(0, Math.floor(Number(p.rent_debt) || 0)),
     p.home_id || null, JSON.stringify(p.home_owned || []), Number(p.user_id)]);
}

// ---------------- Savings accrual ----------------

/**
 * Accrue per-minute savings interest since the last accrual and credit it
 * to char.savings (the day tick is the credit point). Returns { interest,
 * elapsedMin }. First run seeds the clock with no retroactive windfall.
 */
export async function accrueSavings(userId, char, nowMs = Date.now()) {
  const profile = await getP2Profile(userId);
  const now = Math.floor(Number(nowMs) || Date.now());
  if (!profile.savings_accrue_ms) {
    profile.savings_accrue_ms = now;
    await saveP2Profile(profile);
    return { interest: 0, elapsedMin: 0 };
  }
  const elapsedMin = Math.max(0, (now - profile.savings_accrue_ms) / 60000);
  const interest = savingsInterestFor(char.savings, elapsedMin);
  profile.savings_accrue_ms = now;
  if (interest > 0) {
    char.savings = Math.max(0, Math.floor(Number(char.savings) || 0)) + interest;
    await addTransaction(userId, 'savings_interest', interest, char.savings, {
      balance: 'savings', rate_week: SAVINGS_WEEKLY_RATE, cap: SAVINGS_CAP,
    });
  }
  await saveP2Profile(profile);
  return { interest, elapsedMin };
}

// ---------------- Saturday rent ----------------

/**
 * Weekly rent settlement — runs on the Saturday day tick. Deducts the
 * week's rent when affordable; otherwise the rent becomes rent_debt
 * (a flag, never an eviction, never a lockout).
 */
export async function settleRent(userId, char, day, { admin = false } = {}) {
  if (!isRentSaturday(day)) return { due: false, profile: null };
  const profile = await getP2Profile(userId);
  const home = profile.home_id && HOMES[profile.home_id] ? HOMES[profile.home_id] : null;
  if (!home) return { due: false, profile };
  if (profile.home_owned.includes(home.id)) return { due: false, profile, owned: true };
  const rent = home.weeklyRent;
  char.money = Math.max(0, Math.floor(Number(char.money) || 0));
  if (admin || char.money >= rent) {
    if (!admin) char.money -= rent;
    await addTransaction(userId, 'rent_paid', admin ? 0 : -rent, char.money, {
      home: home.id, week_rent: rent,
    });
    return { due: true, paid: true, rent, profile };
  }
  profile.rent_debt = Math.max(0, profile.rent_debt) + rent;
  await saveP2Profile(profile);
  await addTransaction(userId, 'rent_debt', 0, char.money, {
    home: home.id, week_rent: rent, debt: profile.rent_debt,
  });
  return { due: true, paid: false, rent, debt: profile.rent_debt, profile };
}

/** Move into a rented home (rent starts accruing on the next Saturday). */
export async function moveHomeFor(userId, homeId) {
  const home = HOMES[String(homeId)];
  if (!home) throw p2Error(400, 'Unknown home.');
  const profile = await getP2Profile(userId);
  profile.home_id = home.id;
  await saveP2Profile(profile);
  return { profile, home };
}

/** Buy a home outright — no more rent on it, ever. */
export async function buyHomeFor({ user, character, isAdmin, homeId }) {
  const home = HOMES[String(homeId)];
  if (!home) throw p2Error(400, 'Unknown home.');
  const c = character;
  const profile = await getP2Profile(Number(user.id));
  if (profile.home_owned.includes(home.id)) throw p2Error(400, 'You already own that home.');
  if (!canAfford(c, home.buyPrice, isAdmin)) throw p2Error(400, "You don't have that much cash.");
  const deducted = charge(c, home.buyPrice, isAdmin);
  profile.home_owned = [...profile.home_owned, home.id];
  if (!profile.home_id) profile.home_id = home.id;
  await saveP2Profile(profile);
  c.money = Math.max(0, Math.floor(Number(c.money) || 0));
  await addTransaction(Number(user.id), 'home_buy', -deducted, c.money, {
    home: home.id, price: home.buyPrice,
  });
  console.log(`[p2] ${user.username} bought ${home.name} (${naira(home.buyPrice)})`);
  return { profile, home };
}

/** Pay down the rent debt from the wallet. */
export async function payRentDebtFor({ user, character, isAdmin, amount }) {
  const want = Math.floor(Number(amount));
  if (!Number.isFinite(want) || want <= 0) throw p2Error(400, 'Enter a valid amount.');
  const c = character;
  const profile = await getP2Profile(Number(user.id));
  if (profile.rent_debt <= 0) throw p2Error(400, 'You have no rent debt.');
  const pay = isAdmin
    ? Math.min(want, profile.rent_debt)
    : Math.min(want, profile.rent_debt, Math.max(0, Math.floor(Number(c.money) || 0)));
  if (pay <= 0) throw p2Error(400, "You don't have the cash.");
  charge(c, pay, isAdmin);
  profile.rent_debt = Math.max(0, profile.rent_debt - pay);
  await saveP2Profile(profile);
  c.money = Math.max(0, Math.floor(Number(c.money) || 0));
  await addTransaction(Number(user.id), 'rent_debt_pay', -pay, c.money, { debt: profile.rent_debt });
  return { profile, paid: pay };
}

// ---------------- Credibility (async assembly) ----------------

/**
 * Build the credibility breakdown for a player. Needs the user's
 * created_at, their transactions, and a shop-ownership check.
 */
export async function credibilityBreakdown({ userId, createdAt, hasBiz = false, nowMs = Date.now() }) {
  await ensureP2Schema();
  const txRows = await dbAll(
    'SELECT kind, amount, created_at, meta FROM transactions WHERE user_id=?',
    'SELECT kind, amount, created_at, meta FROM transactions WHERE user_id=$1',
    [userId]);
  const txs = txRows
    .filter((r) => P2P_KINDS.has(String(r.kind)))
    .map((r) => {
      let meta = null;
      try { meta = r.meta ? JSON.parse(r.meta) : null; } catch { meta = null; }
      const counterparty = String(r.kind) === 'shop_earn'
        ? String((meta && meta.buyer) || '')
        : 'shop:' + String((meta && meta.shop) || '');
      return { kind: r.kind, amount: Number(r.amount), created_at: Number(r.created_at), counterparty };
    });
  let hasShop = false;
  try {
    const row = await dbGet(
      'SELECT id FROM shops WHERE owner_id=? LIMIT 1',
      'SELECT id FROM shops WHERE owner_id=$1 LIMIT 1',
      [userId]);
    hasShop = !!row;
  } catch { hasShop = false; } // shops table may not exist in minimal installs
  const earnRows = await dbAll(
    "SELECT id FROM transactions WHERE user_id=? AND kind IN ('work_pay','shift_pay','job_pay') LIMIT 1",
    "SELECT id FROM transactions WHERE user_id=$1 AND kind IN ('work_pay','shift_pay','job_pay') LIMIT 1",
    [userId]);
  const workedPaid = earnRows.length > 0;
  const accountAgeDays = Math.max(0, (Math.floor(Number(nowMs) || Date.now()) - Math.floor(Number(createdAt) || 0)) / 86400000);
  return { ...scoreCredibility({ accountAgeDays, txs, hasBiz, hasShop, workedPaid }), hasShop };
}

// ---------------- Day-rollover settlement ----------------

/**
 * Settle one player's P2 money systems: savings accrual, term-note
 * maturities, Saturday rent. Mutates char; caller saves it.
 * Returns { dirty, notes }.
 */
export async function settleP2ForUser(userId, char, day, nowMs, { admin = false } = {}) {
  let dirty = false;
  const notes = [];
  try {
    const { interest } = await accrueSavings(userId, char, nowMs);
    if (interest > 0) {
      dirty = true;
      notes.push(`🔐 Savings interest: +${naira(interest)} (0.5%/week on the first ${naira(SAVINGS_CAP)}).`);
    }
  } catch (e) { console.error('[p2] savings accrue:', e.message); }
  try {
    const { payouts, notes: noteNotes } = await settleNotes(userId, char, day, { admin });
    if (payouts.length) { dirty = true; notes.push(...noteNotes); }
  } catch (e) { console.error('[p2] note settle:', e.message); }
  try {
    const rent = await settleRent(userId, char, day, { admin });
    if (rent.due) {
      dirty = true;
      if (rent.paid) notes.push(`🏠 Saturday rent paid: ${naira(rent.rent)}.`);
      else if (!rent.owned) notes.push(`🏠 Saturday rent missed — ${naira(rent.rent)} added to your rent debt (${naira(rent.debt)}). No eviction, no lockout — clear it when you can.`);
    }
  } catch (e) { console.error('[p2] rent settle:', e.message); }
  return { dirty, notes };
}

/** Online player wrapper (live character + sys notes). */
export async function settleP2Online(ctx, conn) {
  const c = conn.character;
  const { day } = ctx.getDay();
  const nowMs = Date.now();
  const { dirty, notes } = await settleP2ForUser(conn.user.id, c, day, nowMs, { admin: !!Number(conn.user && conn.user.is_admin) });
  return { dirty, notes };
}

/** Offline sweep (DB-credited). isOnline(userId) skips live sessions. */
export async function settleP2Offline(ctx, isOnline, saveCharacter) {
  const { day } = ctx.getDay();
  const nowMs = Date.now();
  let chars;
  try { chars = await listCharacters(); }
  catch (e) { console.error('[p2] listCharacters:', e.message); return; }
  let adminIds = new Set();
  try {
    const rows = await dbAll('SELECT id FROM users WHERE is_admin=1', 'SELECT id FROM users WHERE is_admin=1', []);
    adminIds = new Set(rows.map((r) => Number(r.id)));
  } catch (e) { console.error('[p2] admin lookup:', e.message); }
  for (const ch of chars) {
    const userId = Number(ch.user_id);
    if (isOnline && isOnline(userId)) continue;
    try {
      const { dirty } = await settleP2ForUser(userId, ch, day, nowMs, { admin: adminIds.has(userId) });
      if (dirty && saveCharacter) await saveCharacter(ch);
    } catch (e) { console.error('[p2] offline settle:', e.message); }
  }
}
