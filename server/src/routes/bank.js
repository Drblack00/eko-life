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
  getUserById, ensureCharacter, listTransactions, dbAll, getMeta, saveCharacter,
  addTransaction,
} from '../db.js';
import { charge } from '../game/money.js';
import {
  BOND_TERMS, BOND_MIN, WEEKLY_BILL_BASE, WEEKLY_BILL_PROP_RATE, ARREARS_CAP_WEEKS,
  netWorth, calcWeeklyBill, arrearsCap, bondMaturesDay, bondPayout, bondInterest,
  listBonds, buyBondFor,
} from '../game/v2/bank.js';
import {
  calcIncomeTax, taxBracketLabel, getTaxMult, sumEarnings,
  TAX_FREE, TAX_FLAT_RATE, weekIndex,
} from '../game/v2/m10.js';
import { getLapoLoan, updateLapoLoan, deleteLapoLoan } from '../game/v2/m10.js';
// PORT-P2: money — term notes, savings accrual, credibility, rent, housing.
import {
  NOTE_MIN, NOTE_MAX, NOTE_RATE, NOTE_TERM_DAYS,
  SAVINGS_WEEKLY_RATE, SAVINGS_CAP, SAVINGS_MIN_WITHDRAW,
  HOMES, HOME_IDS, isRentSaturday,
  listNotes, buyNoteFor, withdrawNoteEarlyFor, noteInterest, notePayout, noteMaturesDay, noteActive,
  getP2Profile, moveHomeFor, buyHomeFor, payRentDebtFor, credibilityBreakdown,
} from '../game/v2/p2money.js';
import { listHoldings } from '../game/invest.js';

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
      // PORT-P2: flat 7.5% on weekly earnings above the ₦1M allowance.
      const startMs = Number(await getMeta('tax_week_start')) || Date.now();
      const mult = await getTaxMult();
      const weekEarnings = await sumEarnings(user.id, startMs, Date.now());
      const rawBill = calcIncomeTax(weekEarnings);

      // Savings interest earned since the current week started.
      const interestWeek = await sumKindSince(user.id, 'savings_interest', startMs);

      // PORT-P2: term notes (2%/7d) summary for the overview.
      const notes = await listNotes(user.id);
      const activeNotes = notes.filter(noteActive);
      const notesPrincipal = activeNotes.reduce((a, n) => a + n.principal, 0);

      // PORT-P2: invest holdings value feeds net worth.
      let investValue = 0;
      try {
        const holdings = await listHoldings(user.id);
        investValue = holdings.reduce((a, h) => a + h.principal + h.accrued, 0);
      } catch { investValue = 0; }

      // PORT-P2: credit facility = the LAPO repayment state (game coins only).
      const lapo = await getLapoLoan(user.id);

      // PORT-P2: credibility score (record only — never gates transfers).
      const credibility = await credibilityBreakdown({
        userId: user.id,
        createdAt: Number(user.created_at) || Date.now(),
        hasBiz: !!c.biz,
      });

      // PORT-P2: housing ladder state + rent debt flag.
      const profile = await getP2Profile(user.id);
      const homeDef = profile.home_id && HOMES[profile.home_id] ? HOMES[profile.home_id] : null;

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
        }) + notesPrincipal + investValue,
        lastReceipt,
        savingsTerms: {
          weeklyRate: SAVINGS_WEEKLY_RATE,
          cap: SAVINGS_CAP,
          minWithdraw: SAVINGS_MIN_WITHDRAW,
        },
        termNotes: {
          active: activeNotes.map((n) => ({
            ...n,
            matures_day: noteMaturesDay(n),
            interest: noteInterest(n),
            payout: notePayout(n),
          })),
          rate: NOTE_RATE,
          termDays: NOTE_TERM_DAYS,
          min: NOTE_MIN,
          max: NOTE_MAX,
        },
        credit: lapo ? {
          balance: Math.floor(Number(lapo.balance) || 0),
          weeklyDue: Math.floor(Number(lapo.weekly_due) || 0),
          weeksLeft: Math.floor(Number(lapo.weeks_left) || 0),
          debitsDone: Math.floor(Number(lapo.debits_done) || 0),
        } : null,
        credibility: {
          total: credibility.total,
          parts: credibility.parts,
          recordOnly: true,
        },
        housing: {
          homes: HOME_IDS.map((id) => ({ ...HOMES[id] })),
          current: profile.home_id,
          currentDef: homeDef,
          owned: profile.home_owned,
          rentDebt: profile.rent_debt,
          rentSaturday: isRentSaturday(day),
        },
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
          free: TAX_FREE, flatRate: TAX_FLAT_RATE,
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

  // ================= PORT-P2: money — begin =================
  // ---- term notes: list / buy / early withdrawal ----
  router.get('/notes', async (req, res) => {
    try {
      const notes = await listNotes(req.userId);
      res.json({
        notes: notes.map((n) => ({
          ...n,
          matures_day: noteMaturesDay(n),
          interest: noteInterest(n),
          payout: notePayout(n),
          active: noteActive(n),
        })),
        rate: NOTE_RATE, termDays: NOTE_TERM_DAYS, min: NOTE_MIN, max: NOTE_MAX,
      });
    } catch (e) { console.error('[bank] notes:', e.message); res.status(500).json({ error: 'Could not load term notes.' }); }
  });

  router.post('/notes', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      if (Number(user.banned)) return res.status(403).json({ error: 'This account is banned.' });
      const c = await ensureCharacter(user.id, user.username);
      const isAdmin = !!Number(user.is_admin);
      const day = getDay ? getDay().day : 1;
      const { note } = await buyNoteFor({
        user, character: c, isAdmin,
        amount: req.body && req.body.amount,
        day,
      });
      await saveCharacter(c);
      res.status(201).json({
        note: {
          ...note,
          matures_day: noteMaturesDay(note),
          interest: noteInterest(note),
          payout: notePayout(note),
        },
        balance: Math.floor(Number(c.money) || 0),
      });
    } catch (e) {
      if (e && e.p2Error) return res.status(e.status || 400).json({ error: e.message });
      console.error('[bank] note buy:', e.message);
      res.status(500).json({ error: 'Could not buy that term note.' });
    }
  });

  router.post('/notes/:id/withdraw-early', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      if (Number(user.banned)) return res.status(403).json({ error: 'This account is banned.' });
      const c = await ensureCharacter(user.id, user.username);
      const isAdmin = !!Number(user.is_admin);
      const day = getDay ? getDay().day : 1;
      const { principal, forfeited } = await withdrawNoteEarlyFor({
        user, character: c, isAdmin,
        noteId: req.params.id,
        day,
      });
      await saveCharacter(c);
      res.json({ principal, interestForfeited: forfeited, balance: Math.floor(Number(c.money) || 0) });
    } catch (e) {
      if (e && e.p2Error) return res.status(e.status || 400).json({ error: e.message });
      console.error('[bank] note early withdraw:', e.message);
      res.status(500).json({ error: 'Could not withdraw that note.' });
    }
  });

  // ---- credit facility: LAPO repayment state (game coins only) ----
  // Read-only view of the balance + weekly auto-debit schedule, plus
  // manual "pay now" / "pay in full". No origination here by design.
  router.get('/credit', async (req, res) => {
    try {
      const lapo = await getLapoLoan(req.userId);
      res.json({
        loan: lapo ? {
          balance: Math.floor(Number(lapo.balance) || 0),
          weeklyDue: Math.floor(Number(lapo.weekly_due) || 0),
          weeksLeft: Math.floor(Number(lapo.weeks_left) || 0),
          debitsDone: Math.floor(Number(lapo.debits_done) || 0),
          startDay: Math.floor(Number(lapo.start_day) || 0),
        } : null,
      });
    } catch (e) { console.error('[bank] credit:', e.message); res.status(500).json({ error: 'Could not load the credit facility.' }); }
  });

  async function creditPay(req, res, all) {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      if (Number(user.banned)) return res.status(403).json({ error: 'This account is banned.' });
      const c = await ensureCharacter(user.id, user.username);
      const isAdmin = !!Number(user.is_admin);
      const loan = await getLapoLoan(user.id);
      if (!loan) return res.status(400).json({ error: 'You have no credit balance.' });
      const want = all ? Math.floor(Number(loan.balance))
        : Math.floor(Number(req.body && req.body.amount));
      if (!all && (!Number.isFinite(want) || want <= 0)) {
        return res.status(400).json({ error: 'Enter a valid amount.' });
      }
      const pay = isAdmin
        ? Math.min(want, Math.floor(Number(loan.balance)))
        : Math.min(want, Math.floor(Number(loan.balance)), Math.max(0, Math.floor(Number(c.money) || 0)));
      if (pay <= 0) return res.status(400).json({ error: "You don't have the cash." });
      charge(c, pay, isAdmin);
      const balance = Math.floor(Number(loan.balance)) - pay;
      if (balance <= 0) await deleteLapoLoan(loan.id);
      else await updateLapoLoan(loan.id, { balance });
      c.money = Math.max(0, Math.floor(Number(c.money) || 0));
      await addTransaction(user.id, 'lapo_repay', -pay, c.money, {
        remaining: Math.max(0, balance), manual: true, all, via: 'bank',
      });
      await saveCharacter(c);
      res.json({
        paid: pay,
        balance: Math.max(0, balance),
        cleared: balance <= 0,
        wallet: Math.floor(Number(c.money) || 0),
      });
    } catch (e) { console.error('[bank] credit pay:', e.message); res.status(500).json({ error: 'Could not take that payment.' }); }
  }
  router.post('/credit/pay', (req, res) => creditPay(req, res, false));
  router.post('/credit/pay-all', (req, res) => creditPay(req, res, true));

  // ---- housing ladder: move / buy / pay rent debt ----
  router.post('/housing/move', async (req, res) => {
    try {
      const { profile, home } = await moveHomeFor(req.userId, req.body && req.body.homeId);
      res.json({ home, current: profile.home_id, owned: profile.home_owned, rentDebt: profile.rent_debt });
    } catch (e) {
      if (e && e.p2Error) return res.status(e.status || 400).json({ error: e.message });
      console.error('[bank] housing move:', e.message);
      res.status(500).json({ error: 'Could not move.' });
    }
  });

  router.post('/housing/buy', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      if (Number(user.banned)) return res.status(403).json({ error: 'This account is banned.' });
      const c = await ensureCharacter(user.id, user.username);
      const isAdmin = !!Number(user.is_admin);
      const { profile, home } = await buyHomeFor({
        user, character: c, isAdmin, homeId: req.body && req.body.homeId,
      });
      await saveCharacter(c);
      res.json({ home, current: profile.home_id, owned: profile.home_owned, balance: Math.floor(Number(c.money) || 0) });
    } catch (e) {
      if (e && e.p2Error) return res.status(e.status || 400).json({ error: e.message });
      console.error('[bank] housing buy:', e.message);
      res.status(500).json({ error: 'Could not buy that home.' });
    }
  });

  router.post('/housing/pay-debt', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      if (Number(user.banned)) return res.status(403).json({ error: 'This account is banned.' });
      const c = await ensureCharacter(user.id, user.username);
      const isAdmin = !!Number(user.is_admin);
      const { profile, paid } = await payRentDebtFor({
        user, character: c, isAdmin, amount: req.body && req.body.amount,
      });
      await saveCharacter(c);
      res.json({ paid, rentDebt: profile.rent_debt, balance: Math.floor(Number(c.money) || 0) });
    } catch (e) {
      if (e && e.p2Error) return res.status(e.status || 400).json({ error: e.message });
      console.error('[bank] housing pay-debt:', e.message);
      res.status(500).json({ error: 'Could not pay that debt.' });
    }
  });

  // ---- credibility breakdown (record only) ----
  router.get('/credibility', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      const c = await ensureCharacter(user.id, user.username);
      const breakdown = await credibilityBreakdown({
        userId: user.id,
        createdAt: Number(user.created_at) || Date.now(),
        hasBiz: !!c.biz,
      });
      res.json({ ...breakdown, recordOnly: true });
    } catch (e) { console.error('[bank] credibility:', e.message); res.status(500).json({ error: 'Could not load credibility.' }); }
  });
  // ================= PORT-P2: money — end =================

  return router;
}
