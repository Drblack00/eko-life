// ============================================================
// routes/bank.js — Èkó Reserve bank app REST API (Phase 4).
//
// GAMEPLAY COINS ONLY. Nothing here touches the cash wallet
// (fintech) — those routes stay inert behind CASH_OPS_ENABLED.
//
// Endpoints (all behind authMiddleware, Bearer <redacted>):
//   GET    /api/bank          overview bundle (balance, savings,
//                             net worth, last receipt, bonds,
//                             estimated tax, weekly bills, interest)
//   GET    /api/bank/bonds    all bonds (active + matured), newest first
//   POST   /api/bank/bonds    buy a bond { amount, termDays }
//
// Deposit/withdraw of the savings vault reuses the EXISTING WS
// `bank` act (actions.js) — this router does not duplicate it.
// ============================================================
import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import {
  getUserById, ensureCharacter, listTransactions, dbAll, getMeta,
} from '../db.js';
import {
  BOND_TERMS, BOND_MIN, WEEKLY_BILL_BASE, WEEKLY_BILL_PROP_RATE, ARREARS_CAP_WEEKS,
  netWorth, calcWeeklyBill, arrearsCap, bondMaturesDay, bondPayout, bondInterest,
  listBonds, buyBondFor,
} from '../game/v2/bank.js';
import {
  calcIncomeTax, taxBracketLabel, getTaxMult, sumEarnings,
  TAX_FREE, TAX_BAND2, TAX_RATE2, TAX_RATE3, weekIndex,
} from '../game/v2/m10.js';

const naira = (n) => '₦' + Math.floor(Number(n) || 0).toLocaleString('en-NG');

/** Sum of one ledger kind since `startMs` (for interest-earned-this-week). */
async function sumKindSince(userId, kind, startMs) {
  const rows = await dbAll(
    'SELECT amount FROM transactions WHERE user_id=? AND kind=? AND created_at>=?',
    'SELECT amount FROM transactions WHERE user_id=$1 AND kind=$2 AND created_at>=$3',
    [userId, kind, Math.floor(Number(startMs) || 0)]);
  return rows.reduce((a, r) => a + Math.floor(Number(r.amount) || 0), 0);
}

function cleanTx(r) {
  let meta = null;
  if (r && r.meta) {
    try { meta = JSON.parse(r.meta); } catch { meta = null; }
  }
  return r ? {
    id: r.id,
    kind: r.kind,
    amount: Number(r.amount),
    balance_after: Number(r.balance_after),
    meta,
    created_at: Number(r.created_at),
  } : null;
}

export function createBankRouter({ getDay } = {}) {
  const router = Router();
  router.use(authMiddleware);

  // ---- overview bundle ----
  router.get('/', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      const c = await ensureCharacter(user.id, user.username);
      const bonds = await listBonds(user.id);
      const active = bonds.filter((b) => !b.matured);
      const matured = bonds.filter((b) => b.matured);
      const activeBondPrincipal = active.reduce((a, b) => a + b.principal, 0);

      const recent = await listTransactions(user.id, 1);
      const lastReceipt = cleanTx(recent[0] || null);

      // Estimated income tax this week — REUSES the m10 tax engine
      // (GET /api/v2/m10/tax math); no new tax logic here.
      const startMs = Number(await getMeta('tax_week_start')) || Date.now();
      const mult = await getTaxMult();
      const weekEarnings = await sumEarnings(user.id, startMs, Date.now());
      const rawBill = calcIncomeTax(weekEarnings);

      // Savings interest earned since the current week started.
      const interestWeek = await sumKindSince(user.id, 'savings_interest', startMs);

      // Weekly upkeep bill info.
      const bill = calcWeeklyBill(c);
      const day = getDay ? getDay().day : 1;
      const wi = weekIndex(day);
      const weekEndsDay = (wi + 1) * 7; // week covers days wi*7+1 … wi*7+7

      res.json({
        balance: Math.floor(Number(c.money) || 0),
        savings: Math.floor(Number(c.savings) || 0),
        netWorth: netWorth({
          money: c.money, savings: c.savings, activeBondPrincipal,
        }),
        lastReceipt,
        bonds: {
          active: active.map((b) => ({
            ...b,
            matures_day: bondMaturesDay(b),
            interest: bondInterest(b),
            payout: bondPayout(b),
          })),
          matured: matured.slice(0, 10).map((b) => ({
            ...b,
            interest: bondInterest(b),
            payout: bondPayout(b),
          })),
          terms: Object.fromEntries(
            Object.entries(BOND_TERMS).map(([t, v]) => [t, { rate: v.rate, label: v.label }])),
          min: BOND_MIN,
        },
        tax: {
          weekEarnings,
          bill: Math.floor(rawBill * mult),
          rawBill,
          taxMult: mult,
          holiday: mult === 0,
          free: TAX_FREE, band2: TAX_BAND2, rate2: TAX_RATE2, rate3: TAX_RATE3,
          bracket: taxBracketLabel(weekEarnings),
        },
        bills: {
          weeklyBill: bill,
          weekEndsDay,
          currentWeek: wi,
          arrears: Math.max(0, Math.floor(Number(c.bill_arrears) || 0)),
          arrearsCap: arrearsCap(bill),
          base: WEEKLY_BILL_BASE,
          propRate: WEEKLY_BILL_PROP_RATE,
          capWeeks: ARREARS_CAP_WEEKS,
        },
        interestWeek,
        day,
        isAdmin: !!Number(user.is_admin),
      });
    } catch (e) { console.error('[bank] overview:', e.message); res.status(500).json({ error: 'Could not load your bank.' }); }
  });

  // ---- list bonds ----
  router.get('/bonds', async (req, res) => {
    try {
      const bonds = await listBonds(req.userId);
      res.json({
        bonds: bonds.map((b) => ({
          ...b,
          matures_day: bondMaturesDay(b),
          interest: bondInterest(b),
          payout: bondPayout(b),
        })),
        terms: Object.fromEntries(
          Object.entries(BOND_TERMS).map(([t, v]) => [t, { rate: v.rate, label: v.label }])),
        min: BOND_MIN,
      });
    } catch (e) { console.error('[bank] bonds:', e.message); res.status(500).json({ error: 'Could not load bonds.' }); }
  });

  // ---- buy a bond ----
  router.post('/bonds', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      if (Number(user.banned)) return res.status(403).json({ error: 'This account is banned.' });
      const c = await ensureCharacter(user.id, user.username);
      const isAdmin = !!Number(user.is_admin);
      const day = getDay ? getDay().day : 1;
      const { bond } = await buyBondFor({
        user, character: c, isAdmin,
        amount: req.body && req.body.amount,
        termDays: req.body && req.body.termDays,
        day,
      });
      res.status(201).json({
        bond: {
          ...bond,
          matures_day: bondMaturesDay(bond),
          interest: bondInterest(bond),
          payout: bondPayout(bond),
        },
        balance: Math.floor(Number(c.money) || 0),
      });
    } catch (e) {
      if (e && e.bankError) return res.status(e.status || 400).json({ error: e.message });
      console.error('[bank] buy:', e.message);
      res.status(500).json({ error: 'Could not buy that bond.' });
    }
  });

  return router;
}
