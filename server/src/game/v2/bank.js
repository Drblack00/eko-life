// ============================================================
// game/v2/bank.js — Phase 4: Èkó Reserve bank settlement logic.
//
// GAMEPLAY COINS ONLY. The cash wallet (fintech) is untouched —
// nothing here moves real money, and this module never imports
// the cash ledger. All amounts are integer coins (Math.floor).
//
// Contents:
//   - Bond terms + purchase validation helpers
//   - Pure formulas: netWorth, calcWeeklyBill, planBillTick, bond payout
//   - Bond storage (bank_bonds table; module owns its tables per the
//     db.js "V2" contract — schema lives in db.js, accessors here)
//   - Day-rollover settlement: bond maturity (every day) + weekly
//     upkeep bills (on the week boundary), for online AND offline players
// ============================================================
import {
  dbRun, dbGet, dbAll, dbRunReturning, dbMode,
  addTransaction, getMeta, setMeta, saveCharacter, listCharacters,
} from '../../db.js';
import { PROPERTIES } from '../data.js';
import { canAfford, charge, isAdminConn } from '../money.js';
import { weekIndex } from './m10.js';

// ---------------- Terms (documented; surfaced in the Bank UI) ----------------

// Bond terms: flat interest on principal, paid once at maturity.
//   7 game days  →  5%    (e.g. ₦100,000 → ₦105,000)
//  14 game days  → 12%    (e.g. ₦100,000 → ₦112,000)
//  30 game days  → 30%    (e.g. ₦100,000 → ₦130,000)
// Principal is LOCKED until maturity — no early withdrawal.
export const BOND_TERMS = {
  7:  { rate: 0.05, label: '7-day · 5%' },
  14: { rate: 0.12, label: '14-day · 12%' },
  30: { rate: 0.30, label: '30-day · 30%' },
};
export const BOND_MIN = 5000; // minimum principal, integer coins

// Weekly upkeep bill (deducted at the week boundary in day rollover):
//   bill = ₦1,000 base + floor(0.1% × owned property price)
// No owned property (property 'none') → base only.
// Examples: selfcon_own (₦250,000) → ₦1,250/wk; duplex_own (₦3,000,000) → ₦4,000/wk.
export const WEEKLY_BILL_BASE = 1000;
export const WEEKLY_BILL_PROP_RATE = 0.001; // 0.1% of owned property price
// Unpaid bills stack into bill_arrears, capped at this many weeks of the
// current bill. NO interest on arrears, NO lockouts, NO evictions — the
// weekly tick simply pays min(balance, bill + arrears) and the rest waits.
export const ARREARS_CAP_WEEKS = 4;

const naira = (n) => '₦' + Math.floor(Number(n) || 0).toLocaleString('en-NG');

// ---------------- Pure formulas ----------------

/**
 * Net worth = wallet coins + savings + ACTIVE bond principal.
 * Matured bonds already paid out into the wallet, so they are not
 * counted twice (their payout landed in money, not in a bond row).
 * Documented here and in the Bank UI tooltip.
 */
export function netWorth({ money = 0, savings = 0, activeBondPrincipal = 0 } = {}) {
  return Math.floor(Number(money) || 0)
    + Math.floor(Number(savings) || 0)
    + Math.floor(Number(activeBondPrincipal) || 0);
}

/** Weekly upkeep bill for a character (pure). */
export function calcWeeklyBill(char) {
  const propId = String((char && char.property) || 'none');
  const prop = PROPERTIES[propId];
  const price = prop ? Math.max(0, Math.floor(Number(prop.price) || 0)) : 0;
  return WEEKLY_BILL_BASE + Math.floor(price * WEEKLY_BILL_PROP_RATE);
}

/** Cap on arrears for a given weekly bill (pure). */
export function arrearsCap(bill) {
  return Math.max(0, Math.floor(Number(bill) || 0)) * ARREARS_CAP_WEEKS;
}

/**
 * Plan one weekly bill tick (pure). Returns { bill, pay, newArrears, note }.
 * - Regular players: pay = min(balance, bill + arrears); the unpaid
 *   remainder becomes new arrears, capped at 4 weeks of bills.
 * - Admins (stealth money): the bill is always "paid" in full, the wallet
 *   is never charged, and arrears are cleared — mirrors m10's tax pattern.
 */
export function planBillTick(char, bill, isAdmin = false) {
  const b = Math.max(0, Math.floor(Number(bill) || 0));
  const arrears = Math.max(0, Math.floor(Number(char && char.bill_arrears) || 0));
  if (isAdmin) return { bill: b, pay: b, newArrears: 0, admin: true };
  const total = b + arrears;
  const money = Math.max(0, Math.floor(Number(char && char.money) || 0));
  const pay = Math.min(total, money);
  const unpaid = total - pay;
  return { bill: b, pay, newArrears: Math.min(unpaid, arrearsCap(b)), admin: false };
}

/** Bond helpers (pure). */
export function bondMaturesDay(bond) {
  return Math.floor(Number(bond.start_day) || 0) + Math.floor(Number(bond.term_days) || 0);
}
export function bondInterest(bond) {
  return Math.floor(Math.floor(Number(bond.principal) || 0) * Number(bond.rate || 0));
}
export function bondPayout(bond) {
  return Math.floor(Number(bond.principal) || 0) + bondInterest(bond);
}
export function bondDue(bond, day) {
  return Number(bond.matured) !== 1 && bondMaturesDay(bond) <= Math.floor(Number(day) || 0);
}

/** Validate a bond purchase request. Returns { ok } or { ok:false, error }. */
export function validateBondBuy({ amount, termDays }) {
  const amt = Math.floor(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, error: 'Enter a valid amount.' };
  if (amt < BOND_MIN) return { ok: false, error: `Bonds start at ${naira(BOND_MIN)}.` };
  const term = BOND_TERMS[Number(termDays)];
  if (!term) return { ok: false, error: 'Pick a bond term: 7, 14, or 30 days.' };
  return { ok: true, amount: amt, termDays: Number(termDays), rate: term.rate };
}

// ---------------- Bond storage (module-owned tables) ----------------

export async function createBond(userId, { principal, rate, termDays, startDay }) {
  if (dbMode() === 'postgres') {
    const r = await dbRunReturning(
      'INSERT INTO bank_bonds (user_id, principal, rate, start_day, term_days, matured, matured_day) VALUES (?,?,?,?,?,0,NULL)',
      'INSERT INTO bank_bonds (user_id, principal, rate, start_day, term_days, matured, matured_day) VALUES ($1,$2,$3,$4,$5,0,NULL) RETURNING id',
      [userId, principal, rate, startDay, termDays]);
    return r.rows.length ? Number(r.rows[0].id) : null;
  }
  await dbRun(
    'INSERT INTO bank_bonds (user_id, principal, rate, start_day, term_days, matured, matured_day) VALUES (?,?,?,?,?,0,NULL)',
    'INSERT INTO bank_bonds (user_id, principal, rate, start_day, term_days, matured, matured_day) VALUES ($1,$2,$3,$4,$5,0,NULL)',
    [userId, principal, rate, startDay, termDays]);
  const row = await dbGet(
    'SELECT id FROM bank_bonds WHERE user_id=? ORDER BY id DESC LIMIT 1',
    'SELECT id FROM bank_bonds WHERE user_id=$1 ORDER BY id DESC LIMIT 1',
    [userId]);
  return row ? Number(row.id) : null;
}

/** All bonds for a player, newest first (active + matured). */
export async function listBonds(userId) {
  const rows = await dbAll(
    'SELECT * FROM bank_bonds WHERE user_id=? ORDER BY id DESC',
    'SELECT * FROM bank_bonds WHERE user_id=$1 ORDER BY id DESC',
    [userId]);
  return rows.map(normalizeBond);
}

export async function getBond(id) {
  const row = await dbGet(
    'SELECT * FROM bank_bonds WHERE id=?',
    'SELECT * FROM bank_bonds WHERE id=$1',
    [id]);
  return row ? normalizeBond(row) : null;
}

/** Bonds due for payout on `day` (matured=0 AND start_day+term_days <= day). */
export async function listDueBonds(userId, day) {
  const rows = await dbAll(
    'SELECT * FROM bank_bonds WHERE user_id=? AND matured=0 AND (start_day + term_days) <= ? ORDER BY id',
    'SELECT * FROM bank_bonds WHERE user_id=$1 AND matured=0 AND (start_day + term_days) <= $2 ORDER BY id',
    [userId, Math.floor(Number(day) || 0)]);
  return rows.map(normalizeBond);
}

/**
 * Atomic maturity claim: flips matured 0→1 exactly once. Returns true when
 * THIS call won the claim — only then may the caller credit the payout.
 * Idempotent under re-runs and concurrent settles (pg RETURNING / sqlite
 * changes give the atomic compare-and-set).
 */
export async function claimBondMaturity(id, day) {
  const r = await dbRunReturning(
    'UPDATE bank_bonds SET matured=1, matured_day=? WHERE id=? AND matured=0',
    'UPDATE bank_bonds SET matured=1, matured_day=$1 WHERE id=$2 AND matured=0 RETURNING id',
    [Math.floor(Number(day) || 0), id]);
  return Number(r.changes) > 0;
}

function normalizeBond(r) {
  return {
    id: Number(r.id),
    user_id: Number(r.user_id),
    principal: Math.floor(Number(r.principal) || 0),
    rate: Number(r.rate) || 0,
    start_day: Math.floor(Number(r.start_day) || 0),
    term_days: Math.floor(Number(r.term_days) || 0),
    matured: Number(r.matured) === 1,
    matured_day: r.matured_day == null ? null : Math.floor(Number(r.matured_day)),
  };
}

// ---------------- Server-side bond purchase ----------------

/**
 * Buy a bond for `conn`'s character (REST or WS callers share this).
 * Server-validated: integer amount ≥ ₦5,000, known term, affordability.
 * Admins buy free (money.js stealth bypass) but the bond still records
 * the full face-value principal. Returns { bond } or throws { status, error }.
 */
export async function buyBondFor({ user, character, isAdmin, amount, termDays, day }) {
  const v = validateBondBuy({ amount, termDays });
  if (!v.ok) throw bankError(400, v.error);
  const c = character;
  if (!canAfford(c, v.amount, isAdmin)) throw bankError(400, "You don't have that much cash.");
  const deducted = charge(c, v.amount, isAdmin); // 0 for admins — never charged
  const bondId = await createBond(user.id, {
    principal: v.amount, rate: v.rate, termDays: v.termDays, startDay: Math.floor(Number(day) || 1),
  });
  c.money = Math.max(0, Math.floor(Number(c.money) || 0));
  await addTransaction(user.id, 'bond_buy', -deducted, c.money, {
    bond_id: bondId, principal: v.amount, rate: v.rate, term_days: v.termDays,
  });
  await saveCharacter(c);
  const bond = await getBond(bondId);
  console.log(`[bank] ${user.username} bought bond #${bondId} (${naira(v.amount)} · ${v.termDays}d @ ${Math.round(v.rate * 100)}%)`);
  return { bond };
}

function bankError(status, error) {
  const e = new Error(error);
  e.status = status;
  e.bankError = true;
  return e;
}

// ---------------- Weekly bill boundary ----------------

/**
 * Weekly upkeep-bill bookkeeping: returns the closed week's info when a
 * week boundary was crossed (same meta pattern as m10's taxWeekInfo).
 * First caller per boundary gets charge:true and advances the metas;
 * everyone else (later online players, the offline sweep) gets charge:false.
 */
export async function bankBillWeekInfo(getDay) {
  const { day } = getDay();
  const wi = weekIndex(day);
  const nowMs = Date.now();
  const stored = await getMeta('bank_bill_week');
  if (stored == null) {
    await setMeta('bank_bill_week', String(wi));
    await setMeta('bank_bill_week_start', String(nowMs));
    return { charge: false, week: wi };
  }
  if (Number(stored) === wi) return { charge: false, week: wi };
  const startMs = Number(await getMeta('bank_bill_week_start')) || 0;
  await setMeta('bank_bill_week', String(wi));
  await setMeta('bank_bill_week_start', String(nowMs));
  return { charge: true, week: Number(stored), startMs, endMs: nowMs };
}

// ---------------- Day rollover ----------------

/** Settle one player's bond maturities. Returns { payouts, notes }. */
async function settleBonds(userId, char, day, { admin }) {
  const due = await listDueBonds(userId, day);
  const payouts = [];
  const notes = [];
  for (const bond of due) {
    // Atomic claim first: only the winner credits the payout (idempotent).
    const claimed = await claimBondMaturity(bond.id, day);
    if (!claimed) continue;
    const payout = bondPayout(bond);
    char.money = Math.max(0, Math.floor(Number(char.money) || 0)) + payout;
    await addTransaction(userId, 'bond_payout', payout, char.money, {
      bond_id: bond.id, principal: bond.principal, interest: bondInterest(bond),
      term_days: bond.term_days,
    });
    payouts.push({ bond, payout });
    notes.push(`🏦 Bond #${bond.id} matured: +${naira(payout)} (${naira(bond.principal)} + ${naira(bondInterest(bond))} interest).`);
    console.log(`[bank] bond #${bond.id} matured → +${naira(payout)} (user ${userId})`);
  }
  return { payouts, notes };
}

/** Settle one player's weekly upkeep bill (only when the week boundary crossed). */
async function settleBill(userId, char, info, { admin }) {
  const bill = calcWeeklyBill(char);
  const plan = planBillTick(char, bill, admin);
  if (!admin) {
    char.money = Math.max(0, Math.floor(Number(char.money) || 0)) - plan.pay;
    char.bill_arrears = plan.newArrears;
  } else {
    char.bill_arrears = 0;
  }
  if (plan.pay > 0) {
    await addTransaction(userId, 'weekly_bill', -plan.pay, char.money, {
      week: info.week, bill: plan.bill, paid: plan.pay, arrears: plan.newArrears,
    });
  }
  let note = null;
  if (plan.newArrears > 0) {
    note = `🧾 Weekly upkeep: paid ${naira(plan.pay)} — ${naira(plan.newArrears)} in arrears (no interest, no lockout).`;
  } else if (plan.pay > 0) {
    note = `🧾 Weekly upkeep bill paid: ${naira(plan.pay)}.`;
  }
  return { plan, note };
}

/** Online player: bond maturities + weekly bill, live on the session character. */
export async function settleOnlinePlayer(ctx, conn) {
  const c = conn.character;
  const { day } = ctx.getDay();
  const rollAdmin = isAdminConn(conn);
  let dirty = false;
  const notes = [];

  try {
    const { payouts, notes: bondNotes } = await settleBonds(conn.user.id, c, day, { admin: rollAdmin });
    if (payouts.length) { dirty = true; notes.push(...bondNotes); }
  } catch (e) { console.error('[bank] online bond settle:', e.message); }

  try {
    const info = await bankBillWeekInfo(ctx.getDay);
    if (info.charge) {
      const { plan, note } = await settleBill(conn.user.id, c, info, { admin: rollAdmin });
      if (plan.pay > 0 || plan.newArrears > 0 || plan.bill > 0) dirty = true;
      if (note) notes.push(note);
    }
  } catch (e) { console.error('[bank] online bill settle:', e.message); }

  if (dirty) {
    c.money = Math.max(0, Math.floor(Number(c.money) || 0));
    c.bill_arrears = Math.max(0, Math.floor(Number(c.bill_arrears) || 0));
    await saveCharacter(c);
    ctx.send(conn, { t: 'you', you: ctx.youSnapshot(conn) });
    for (const n of notes) ctx.send(conn, { t: 'sys', text: n });
  }
  return { dirty, notes };
}

/** Offline players: same math, DB-credited. isOnline(userId) skips live sessions. */
export async function settleOfflinePlayers(ctx, isOnline) {
  const { day } = ctx.getDay();
  let chars;
  try { chars = await listCharacters(); }
  catch (e) { console.error('[bank] listCharacters:', e.message); return; }
  // Admins are never charged — one batched lookup for the sweep.
  let adminIds = new Set();
  try {
    const rows = await dbAll('SELECT id FROM users WHERE is_admin=1', 'SELECT id FROM users WHERE is_admin=1', []);
    adminIds = new Set(rows.map(r => Number(r.id)));
  } catch (e) { console.error('[bank] admin lookup:', e.message); }
  const info = await bankBillWeekInfo(ctx.getDay);
  for (const ch of chars) {
    const userId = Number(ch.user_id);
    if (isOnline && isOnline(userId)) continue;
    const offAdmin = adminIds.has(userId);
    let dirty = false;
    try {
      const { payouts } = await settleBonds(userId, ch, day, { admin: offAdmin });
      if (payouts.length) dirty = true;
      if (info.charge) {
        const { plan } = await settleBill(userId, ch, info, { admin: offAdmin });
        if (plan.pay > 0 || plan.newArrears > 0 || plan.bill > 0) dirty = true;
      }
      if (dirty) await saveCharacter(ch);
    } catch (e) { console.error('[bank] offline settle:', e.message); }
  }
}

// ---------------- Test hooks ----------------

/** Test hook: reset the weekly-bill boundary metas. */
export async function _resetBankBillWeek() {
  await dbRun('DELETE FROM meta WHERE key=?', 'DELETE FROM meta WHERE key=$1', ['bank_bill_week']);
  await dbRun('DELETE FROM meta WHERE key=?', 'DELETE FROM meta WHERE key=$1', ['bank_bill_week_start']);
}
