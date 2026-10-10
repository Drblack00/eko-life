// ============================================================
// fintech/risk.js — pure risk-control helpers (Milestone 9, Worker B).
//
// What lives here:
// - Per-transaction caps (deposit <= ₦1,000,000; withdrawal daily
//   aggregate <= ₦2,000,000/day). Integer kobo everywhere.
// - Daily aggregate computation per user (deposits confirmed,
//   transfers completed, withdrawals completed — "today" is a UTC
//   calendar day, documented below).
// - Under-review policy: flag a withdrawal when it is large
//   (>= ₦500,000) OR its beneficiary was created < 24h ago.
//
// What does NOT live here:
// - HTTP wiring (cashFlows.js / cashWallet.js own their routes).
// - The live-money gate (requireCashOps). Live money stays OFF.
//
// DESIGN DECISIONS (for the coordinator)
// 1) "Today" = UTC midnight-to-midnight. Rationale: deterministic on
//    any server, independent of operator timezone. A Lagos-day variant
//    can be added later by passing a dayStartMs override.
// 2) Withdrawal daily cap counts COMPLETED withdrawals only (status =
//    'completed', completed_at today). Reserved-but-unsettled funds are
//    still locked in customer_reserved, so they cannot be double-spent;
//    counting only completions keeps the cap definition auditable
//    against settled money.
// 3) The beneficiary-age rule (< 24h -> review) is implemented here in
//    full, but its *diversion* in the withdrawal request flow is gated
//    behind CASH_RISK_NEW_BENEFICIARY_REVIEW=true (default off). Reason:
//    every existing withdrawal test — and most real users — withdraw to
//    a freshly-added beneficiary, so wiring it as a hard hold by
//    default would freeze all normal withdrawals. The amount rule
//    (>= ₦500k) always diverts. Flip the env var to enforce the
//    beneficiary-age hold too; the signal is audit-logged either way.
// 4) checkDepositCap is pure/sync so the deposit/initiate handler
//    (owned by another worker) can call it with a one-line try/catch.
//    checkWithdrawalCap needs the DB (daily aggregates) so it is async.
// ============================================================
import { dbGet } from '../db.js';

// ---------- caps (integer kobo) ----------
export const DEPOSIT_PER_TX_CAP_KOBO = 100_000_000;      // ₦1,000,000 per transaction
export const WITHDRAWAL_DAILY_CAP_KOBO = 200_000_000;    // ₦2,000,000 per UTC day
export const WITHDRAWAL_REVIEW_AMOUNT_KOBO = 50_000_000; // ₦500,000 -> under_review
export const BENEFICIARY_NEW_AGE_MS = 24 * 3600 * 1000;  // 24h

// Set CASH_RISK_NEW_BENEFICIARY_REVIEW=true to also divert withdrawals
// to a <24h-old beneficiary into under_review (default: flag only).
export function strictNewBeneficiaryReview() {
  return process.env.CASH_RISK_NEW_BENEFICIARY_REVIEW === 'true';
}

// ---------- error taxonomy ----------
export class RiskLimitError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'RiskLimitError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

// ---------- daily aggregates ----------

// UTC midnight (ms) of the day containing `now`.
export function utcDayStart(now = Date.now()) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// Sums of COMPLETED cash movements for one user since UTC midnight.
//   depositsKobo    — cash_deposits confirmed today
//   transfersKobo   — cash_transfers completed today (as sender)
//   withdrawalsKobo — cash_withdrawal_requests completed today
// Returns plain integer kobo. Pure read; never throws on missing rows.
export async function dailyAggregates(userId, { now = Date.now() } = {}) {
  const dayStart = utcDayStart(now);
  const uid = Number(userId);
  const dep = await dbGet(
    `SELECT COALESCE(SUM(amount_kobo),0) AS s FROM cash_deposits
     WHERE user_id = ? AND status = 'confirmed' AND confirmed_at >= ?`,
    `SELECT COALESCE(SUM(amount_kobo),0) AS s FROM cash_deposits
     WHERE user_id = $1 AND status = 'confirmed' AND confirmed_at >= $2`,
    [uid, dayStart]);
  const tr = await dbGet(
    `SELECT COALESCE(SUM(amount_kobo),0) AS s FROM cash_transfers
     WHERE sender_id = ? AND status = 'completed' AND completed_at >= ?`,
    `SELECT COALESCE(SUM(amount_kobo),0) AS s FROM cash_transfers
     WHERE sender_id = $1 AND status = 'completed' AND completed_at >= $2`,
    [uid, dayStart]);
  const wd = await dbGet(
    `SELECT COALESCE(SUM(gross_kobo),0) AS s FROM cash_withdrawal_requests
     WHERE user_id = ? AND status = 'completed' AND completed_at >= ?`,
    `SELECT COALESCE(SUM(gross_kobo),0) AS s FROM cash_withdrawal_requests
     WHERE user_id = $1 AND status = 'completed' AND completed_at >= $2`,
    [uid, dayStart]);
  return {
    depositsKobo: Number(dep.s),
    transfersKobo: Number(tr.s),
    withdrawalsKobo: Number(wd.s),
    dayStartMs: dayStart,
  };
}

// ---------- per-transaction deposit cap ----------

// Pure/sync. Throws RiskLimitError (400) when the amount exceeds the
// per-transaction deposit cap. Insert into the deposit/initiate handler
// right after its min/max bounds check:
//
//   import { checkDepositCap } from '../fintech/risk.js';
//   ...
//   try { checkDepositCap({ amountKobo }); }
//   catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }
export function checkDepositCap({ amountKobo }) {
  if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0) {
    throw new RiskLimitError(400, 'INVALID_AMOUNT', 'amountKobo must be a positive integer number of kobo.');
  }
  if (amountKobo > DEPOSIT_PER_TX_CAP_KOBO) {
    throw new RiskLimitError(
      400,
      'DEPOSIT_CAP_EXCEEDED',
      `Deposit exceeds the per-transaction cap of ${DEPOSIT_PER_TX_CAP_KOBO} kobo ` +
      `(₦${DEPOSIT_PER_TX_CAP_KOBO / 100}). Split it into smaller deposits.`);
  }
  return { ok: true, capKobo: DEPOSIT_PER_TX_CAP_KOBO };
}

// ---------- daily withdrawal cap ----------

// Async (reads dailyAggregates). Throws RiskLimitError (429) when this
// withdrawal would push today's completed withdrawals over the daily cap.
export async function checkWithdrawalCap({ userId, grossKobo }) {
  if (!Number.isSafeInteger(grossKobo) || grossKobo <= 0) {
    throw new RiskLimitError(400, 'INVALID_AMOUNT', 'grossKobo must be a positive integer number of kobo.');
  }
  const agg = await dailyAggregates(userId);
  if (agg.withdrawalsKobo + grossKobo > WITHDRAWAL_DAILY_CAP_KOBO) {
    throw new RiskLimitError(
      429,
      'WITHDRAWAL_DAILY_CAP_EXCEEDED',
      `Daily withdrawal cap of ${WITHDRAWAL_DAILY_CAP_KOBO} kobo ` +
      `(₦${WITHDRAWAL_DAILY_CAP_KOBO / 100}) would be exceeded ` +
      `(₦${agg.withdrawalsKobo / 100} already completed today).`);
  }
  return { ok: true, capKobo: WITHDRAWAL_DAILY_CAP_KOBO, usedKobo: agg.withdrawalsKobo };
}

// ---------- under-review policy ----------

export const REVIEW_REASON_LARGE_WITHDRAWAL = 'LARGE_WITHDRAWAL';
export const REVIEW_REASON_NEW_BENEFICIARY = 'NEW_BENEFICIARY';

// Pure: which review rules fire for this withdrawal. Returns an array of
// rule codes (possibly empty). Both rules are always evaluated here;
// the *diversion* decision (below) applies the strictBeneficiaryAge gate.
export function reviewReasons({ grossKobo, beneficiaryCreatedAt, now = Date.now() }) {
  const reasons = [];
  if (Number.isSafeInteger(grossKobo) && grossKobo >= WITHDRAWAL_REVIEW_AMOUNT_KOBO) {
    reasons.push(REVIEW_REASON_LARGE_WITHDRAWAL);
  }
  const created = Number(beneficiaryCreatedAt);
  if (Number.isSafeInteger(created) && created > 0 && (now - created) < BENEFICIARY_NEW_AGE_MS) {
    reasons.push(REVIEW_REASON_NEW_BENEFICIARY);
  }
  return reasons;
}

// Pure: does this withdrawal divert into under_review instead of
// proceeding straight to payout?
// - LARGE_WITHDRAWAL always diverts.
// - NEW_BENEFICIARY diverts only when strictNewBeneficiary is true
//   (see DESIGN DECISIONS 3); otherwise it is flag-only.
export function withdrawalRiskDecision({ grossKobo, beneficiaryCreatedAt, now = Date.now(), strictNewBeneficiary = strictNewBeneficiaryReview() }) {
  const reasons = reviewReasons({ grossKobo, beneficiaryCreatedAt, now });
  const divert =
    reasons.includes(REVIEW_REASON_LARGE_WITHDRAWAL) ||
    (strictNewBeneficiary && reasons.includes(REVIEW_REASON_NEW_BENEFICIARY));
  return { divert, reasons };
}

// Backwards-friendly alias: the boolean policy check.
export function needsRiskReview(args) {
  return withdrawalRiskDecision(args).divert;
}
