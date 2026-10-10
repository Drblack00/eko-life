// ============================================================
// routes/cashFlows.js — Èkó Life cash-wallet flows (Milestones 6b + 7):
// P2P cash transfers + bank withdrawals with 10% commission.
//
// SAFETY CONTRACT
// - LIVE MONEY STAYS OFF: every route runs behind requireCashOps
//   (403 while CASH_OPS_ENABLED != 'true').
// - Mock provider only (mockProvider.js, MOCK-labeled). No real HTTP,
//   no real credentials, no account numbers in logs.
// - Integer kobo everywhere. Never touches game tables.
// - Every value movement goes through ledger.postJournal
//   (double-entry); posted journals are never edited or deleted.
// - NEVER store banking passwords / PINs / OTPs (schema rule).
// - No commission on P2P transfers.
//
// DESIGN DECISIONS (documented for the coordinator)
// 1) Two-step withdrawals (quote → execute). Rationale: the user sees
//    the exact commission breakdown BEFORE committing funds, the
//    server binds the fee-policy version at quote time (so a policy
//    change mid-flow can't silently alter the math), and the
//    quote_token pins {userId, beneficiary_id, gross_kobo} so the
//    client cannot tamper with the quoted amounts. The server
//    re-derives commission/net from the BOUND quote at execution —
//    client-supplied breakdown fields are never trusted.
// 2) Commission is recognized ONLY on completion. The reserve journal
//    moves only customer_available -> customer_reserved (gross). The
//    commission journal (withdrawal_clearing -> platform_commission +
//    withdrawal_clearing -> provider_clearing) posts only when the
//    provider settles (mock-advance). Consequence: the failure path
//    releases reserved -> available and needs NO commission reversal,
//    because no commission journal was ever posted.
// 3) Quote tokens live in an in-memory Map with 10-minute expiry.
//    SINGLE-PROCESS LIMITATION: a second Node process / a restart
//    loses the tokens. Acceptable for this milestone; a durable
//    provider integration should move quotes to a DB table.
// 4) P2P transfers post TWO balanced journals through the
//    provider_clearing account (sender leg, recipient leg) so each
//    user's ledger footprint is independently auditable, and the
//    pair commits atomically inside one outer dbTransaction
//    (dbTransaction is re-entrant, so postJournal inside it joins
//    the same transaction).
// ============================================================
import { Router } from 'express';
import crypto from 'node:crypto';
import { authMiddleware } from '../auth.js';
import {
  dbRun, dbGet, dbAll, dbMode, dbTransaction, ensureColumn,
  getUserByName, getUserById,
} from '../db.js';
import { requireCashOps } from '../fintech/config.js';
import {
  postJournal, getFeePolicy, commissionFor, getCashBalance,
} from '../fintech/ledger.js';
import * as mockProvider from '../fintech/mockProvider.js';
import { checkWithdrawalCap, withdrawalRiskDecision } from '../fintech/risk.js';

// ---------- limits (integer kobo) ----------
const TRANSFER_MIN_KOBO = 1000;            // ₦10
const TRANSFER_MAX_KOBO = 20000000;        // ₦200,000
const TRANSFER_VELOCITY_24H_KOBO = 50000000; // ₦500,000 per rolling 24h
const WITHDRAW_MIN_KOBO = 50000;           // ₦500
const QUOTE_TTL_MS = 10 * 60 * 1000;       // 10 minutes

const TERMINAL_WITHDRAWAL_STATUSES = new Set(['completed', 'failed', 'rejected', 'reversed']);
const PRE_COMPLETION_STATUSES = new Set(['requested', 'reserved', 'submitted', 'processing']);

// ---------- helpers ----------

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function httpError(statusCode, message, code = null) {
  const e = new Error(message);
  e.statusCode = statusCode;
  if (code) e.code = code;
  return e;
}

// INSERT returning the new row id on both backends.
async function insertReturnId(sqliteInsert, pgInsertReturning, params) {
  if (dbMode() === 'postgres') {
    const r = await dbGet(pgInsertReturning, pgInsertReturning, params);
    return Number(r.id);
  }
  await dbRun(sqliteInsert, sqliteInsert, params);
  const r = await dbGet('SELECT last_insert_rowid() AS id', 'SELECT 1', []);
  return Number(r.id);
}

const maskAccount = (n) => `******${String(n).slice(-4)}`;

// 'active' for new wallets (column default); rows created before the
// column existed get NULL -> treat as active.
async function getAccountStatus(userId) {
  const w = await dbGet(
    'SELECT account_status FROM cash_wallets WHERE user_id = ?',
    'SELECT account_status FROM cash_wallets WHERE user_id = $1',
    [userId]);
  return (w && w.account_status) || 'active';
}

// ---------- Milestone 9: risk reviews ----------
// A withdrawal diverted by the risk policy keeps its DB status
// ('reserved') while an 'open' risk_reviews row exists; the API reports
// the effective status 'under_review'. The
// cash_withdrawal_requests.status CHECK constraint is intentionally
// left untouched (db.js is additive-only), so 'under_review' is
// derived, never stored.
async function getOpenReview(withdrawalId) {
  return dbGet(
    `SELECT * FROM risk_reviews WHERE withdrawal_id = ? AND status = 'open' ORDER BY id DESC`,
    `SELECT * FROM risk_reviews WHERE withdrawal_id = $1 AND status = 'open' ORDER BY id DESC`,
    [Number(withdrawalId)]);
}

export async function withdrawalEffectiveStatus(row) {
  if (row && row.status === 'reserved' && (await getOpenReview(Number(row.id)))) {
    return 'under_review';
  }
  return row ? row.status : null;
}

function parseReviewReasons(reviewRow) {
  if (!reviewRow || !reviewRow.reasons) return [];
  try {
    const a = JSON.parse(reviewRow.reasons);
    return Array.isArray(a) ? a.map(String) : [];
  } catch { return []; }
}

// Resume the payout flow for a 'reserved' withdrawal that just cleared
// risk review. Called by the admin approve endpoint AFTER it closes the
// review row. Requires status 'reserved'; anything else throws 409.
// Exported for routes/cashAdmin.js (Milestone 9).
export async function submitReservedWithdrawalPayout(withdrawalId, { actor = 'system' } = {}) {
  const wid = Number(withdrawalId);
  if (!Number.isSafeInteger(wid) || wid <= 0) {
    throw httpError(400, 'Invalid withdrawal id.', 'VALIDATION');
  }
  return dbTransaction(async () => {
    const row = await dbGet(
      'SELECT * FROM cash_withdrawal_requests WHERE id = ?',
      'SELECT * FROM cash_withdrawal_requests WHERE id = $1',
      [wid]);
    if (!row) throw httpError(404, 'Withdrawal not found.', 'NOT_FOUND');
    if (row.status !== 'reserved') {
      throw httpError(409,
        `Withdrawal is in '${row.status}' state and cannot be submitted.`, 'BAD_STATE');
    }
    const ben = await dbGet(
      'SELECT * FROM cash_withdrawal_beneficiaries WHERE id = ?',
      'SELECT * FROM cash_withdrawal_beneficiaries WHERE id = $1',
      [row.beneficiary_id]);
    const now = Date.now();
    const payout = await mockProvider.submitPayout({
      userId: Number(row.user_id),
      amountKobo: Number(row.net_kobo),
      destinationHint: ben ? `MOCK-ACCT-${maskAccount(ben.account_number)}` : 'MOCK-ACCOUNT',
      nonce: wid,
    });
    await dbRun(
      'UPDATE cash_withdrawal_requests SET provider_ref = ?, status = ?, updated_at = ? WHERE id = ?',
      'UPDATE cash_withdrawal_requests SET provider_ref = $1, status = $2, updated_at = $3 WHERE id = $4',
      [payout.payoutId, 'submitted', now, wid]);
    await notifyCashEvent(Number(row.user_id), 'cash.withdrawal.submitted', {
      withdrawal_id: wid,
      gross_kobo: Number(row.gross_kobo),
      commission_kobo: Number(row.commission_kobo),
      net_kobo: Number(row.net_kobo),
      provider_ref: payout.payoutId,
      approved_by: actor,
    });
    return dbGet(
      'SELECT * FROM cash_withdrawal_requests WHERE id = ?',
      'SELECT * FROM cash_withdrawal_requests WHERE id = $1',
      [wid]);
  });
}

// Notification stub: persists an audit row for now; the real
// push/WS fan-out plugs into this single function later.
export async function notifyCashEvent(userId, event, payload = {}) {
  await dbRun(
    `INSERT INTO fintech_audit_logs (actor, action, entity, entity_id, detail, created_at)
     VALUES (?,?,?,?,?,?)`,
    `INSERT INTO fintech_audit_logs (actor, action, entity, entity_id, detail, created_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    ['system', event, 'cash_flow', String(userId), JSON.stringify(payload), Date.now()]);
}

function beneficiaryView(row) {
  return {
    id: Number(row.id),
    label: row.label,
    bank_code: row.bank_code,
    account_number_masked: maskAccount(row.account_number),
    account_name: row.account_name || null,
    verified: !!Number(row.verified),
  };
}

async function getBeneficiaryForUser(beneficiaryId, userId) {
  const row = await dbGet(
    'SELECT * FROM cash_withdrawal_beneficiaries WHERE id = ?',
    'SELECT * FROM cash_withdrawal_beneficiaries WHERE id = $1',
    [beneficiaryId]);
  if (!row || Number(row.user_id) !== Number(userId)) return null;
  return row;
}

// Quote tokens: single-process in-memory store (see DESIGN DECISIONS 3).
const quoteStore = new Map();
function sweepQuotes() {
  const now = Date.now();
  for (const [tok, q] of quoteStore) {
    if (q.expiresAt <= now) quoteStore.delete(tok);
  }
}

async function withdrawalBreakdown(row) {
  const policy = await getFeePolicy(Number(row.fee_policy_version));
  return {
    gross_kobo: Number(row.gross_kobo),
    commission_kobo: Number(row.commission_kobo),
    net_kobo: Number(row.net_kobo),
    rate_bps: policy.rateBps,
    fee_policy_version: Number(row.fee_policy_version),
  };
}

async function withdrawalFull(row) {
  const ben = await dbGet(
    'SELECT * FROM cash_withdrawal_beneficiaries WHERE id = ?',
    'SELECT * FROM cash_withdrawal_beneficiaries WHERE id = $1',
    [row.beneficiary_id]);
  // Milestone 9: surface the derived under_review status + review detail.
  const review = row.status === 'reserved' ? await getOpenReview(Number(row.id)) : null;
  return {
    id: Number(row.id),
    status: review ? 'under_review' : row.status,
    review: review ? {
      id: Number(review.id),
      status: review.status,
      reasons: parseReviewReasons(review),
      note: review.note || null,
      created_at: Number(review.created_at),
    } : null,
    breakdown: await withdrawalBreakdown(row),
    beneficiary: ben ? beneficiaryView(ben) : null,
    provider_ref: row.provider_ref || null,
    failure_reason: row.failure_reason || null,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    completed_at: row.completed_at == null ? null : Number(row.completed_at),
  };
}

async function transferReceipt(row, senderUsername, recipientUsername) {
  return {
    transfer_id: Number(row.id),
    amount_kobo: Number(row.amount_kobo),
    currency: row.currency || 'NGN',
    sender: senderUsername,
    recipient: recipientUsername,
    status: row.status,
    completed_at: row.completed_at == null ? null : Number(row.completed_at),
    journal_keys: {
      transfer: row.journal_key,
      sender: `${row.journal_key}:sender`,
      recipient: `${row.journal_key}:recipient`,
    },
  };
}

// ---------- router ----------

export function createCashFlowsRouter() {
  const router = Router();

  // Account-status column (Worker B addition). Readiness middleware so
  // requests never race the ALTER TABLE.
  const ready = ensureColumn(
    'cash_wallets', 'account_status',
    "TEXT NOT NULL DEFAULT 'active'",
    "TEXT NOT NULL DEFAULT 'active'");
  router.use(async (_req, _res, next) => {
    try { await ready; next(); } catch (e) { next(e); }
  });

  router.use(authMiddleware, requireCashOps);

  // ----- P2P transfer -----
  router.post('/transfer', ah(async (req, res) => {
    const body = req.body || {};
    const recipientUsername = String(body.recipient_username || '').trim();
    const amountKobo = body.amount_kobo;
    const idempotencyKey = String(body.idempotency_key || '').trim();

    if (!recipientUsername) {
      throw httpError(400, 'recipient_username is required.', 'VALIDATION');
    }
    if (!idempotencyKey || idempotencyKey.length > 128) {
      throw httpError(400, 'idempotency_key is required (max 128 chars).', 'VALIDATION');
    }
    if (!Number.isSafeInteger(amountKobo) || amountKobo < TRANSFER_MIN_KOBO || amountKobo > TRANSFER_MAX_KOBO) {
      throw httpError(400,
        `amount_kobo must be an integer between ${TRANSFER_MIN_KOBO} and ${TRANSFER_MAX_KOBO} kobo.`,
        'VALIDATION');
    }

    const recipient = await getUserByName(recipientUsername);
    if (!recipient) throw httpError(404, 'Recipient not found.', 'RECIPIENT_NOT_FOUND');
    const senderId = Number(req.userId);
    const recipientId = Number(recipient.id);
    if (recipientId === senderId) {
      throw httpError(400, 'You cannot transfer to yourself.', 'SELF_TRANSFER');
    }

    const outcome = await dbTransaction(async () => {
      // Idempotent replay: same key -> original receipt, post nothing.
      const existing = await dbGet(
        'SELECT * FROM cash_transfers WHERE idempotency_key = ?',
        'SELECT * FROM cash_transfers WHERE idempotency_key = $1',
        [idempotencyKey]);
      if (existing) return { row: existing };

      // Sending gate (inside the tx so it cannot race a status flip).
      if ((await getAccountStatus(senderId)) !== 'active') {
        throw httpError(403, 'Your cash account is not active; sending is blocked.', 'ACCOUNT_NOT_ACTIVE');
      }
      if ((await getAccountStatus(recipientId)) !== 'active') {
        throw httpError(403, 'The recipient cash account is not active.', 'RECIPIENT_NOT_ACTIVE');
      }

      // Rolling-24h velocity on completed transfers.
      const since = Date.now() - 24 * 3600 * 1000;
      const v = await dbGet(
        `SELECT COALESCE(SUM(amount_kobo),0) AS s FROM cash_transfers
         WHERE sender_id = ? AND status = 'completed' AND created_at >= ?`,
        `SELECT COALESCE(SUM(amount_kobo),0) AS s FROM cash_transfers
         WHERE sender_id = $1 AND status = 'completed' AND created_at >= $2`,
        [senderId, since]);
      if (Number(v.s) + amountKobo > TRANSFER_VELOCITY_24H_KOBO) {
        throw httpError(429,
          `Daily P2P limit of ${TRANSFER_VELOCITY_24H_KOBO} kobo (₦${TRANSFER_VELOCITY_24H_KOBO / 100}) would be exceeded.`,
          'VELOCITY_EXCEEDED');
      }

      const now = Date.now();
      const journalKey = `transfer:${idempotencyKey}`;
      const transferId = await insertReturnId(
        `INSERT INTO cash_transfers
           (sender_id, recipient_id, journal_key, amount_kobo, currency, status, idempotency_key, memo, created_at, completed_at)
         VALUES (?,?,?,?,?,'pending',?,?,?,NULL)`,
        `INSERT INTO cash_transfers
           (sender_id, recipient_id, journal_key, amount_kobo, currency, status, idempotency_key, memo, created_at, completed_at)
         VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8,NULL) RETURNING id`,
        [senderId, recipientId, journalKey, amountKobo, 'NGN', idempotencyKey, null, now]);

      // Sender leg: customer_available -> provider_clearing.
      await postJournal({
        journalKey: `${journalKey}:sender`,
        type: 'transfer',
        userId: senderId,
        entries: [
          { accountCode: 'customer_available', side: 'debit', amountKobo },
          { accountCode: 'provider_clearing', side: 'credit', amountKobo },
        ],
        memo: `P2P transfer #${transferId} to ${recipientUsername}`,
        metadata: { transfer_id: transferId, idempotency_key: idempotencyKey },
      });
      // Recipient leg: provider_clearing -> customer_available. No commission on P2P.
      await postJournal({
        journalKey: `${journalKey}:recipient`,
        type: 'transfer',
        userId: recipientId,
        entries: [
          { accountCode: 'provider_clearing', side: 'debit', amountKobo },
          { accountCode: 'customer_available', side: 'credit', amountKobo },
        ],
        memo: `P2P transfer #${transferId} from user ${senderId}`,
        metadata: { transfer_id: transferId, idempotency_key: idempotencyKey },
      });

      await dbRun(
        'UPDATE cash_transfers SET status = ?, completed_at = ? WHERE id = ?',
        'UPDATE cash_transfers SET status = $1, completed_at = $2 WHERE id = $3',
        ['completed', now, transferId]);
      await notifyCashEvent(senderId, 'cash.transfer.completed', {
        transfer_id: transferId,
        amount_kobo: amountKobo,
        recipient_id: recipientId,
        recipient_username: recipientUsername,
      });

      const row = await dbGet(
        'SELECT * FROM cash_transfers WHERE id = ?',
        'SELECT * FROM cash_transfers WHERE id = $1',
        [transferId]);
      return { row };
    });

    const sender = await getUserById(senderId);
    res.json(await transferReceipt(
      outcome.row,
      sender ? sender.username : String(senderId),
      recipientUsername));
  }));

  // ----- beneficiaries -----
  router.post('/beneficiaries', ah(async (req, res) => {
    const body = req.body || {};
    const label = String(body.label || '').trim().slice(0, 64);
    const bankCode = String(body.bank_code || '').trim();
    const accountNumber = String(body.account_number || '').trim();
    let accountName = String(body.account_name || '').trim();

    if (!label) throw httpError(400, 'label is required.', 'VALIDATION');
    if (!/^\d{3,6}$/.test(bankCode)) {
      throw httpError(400, 'bank_code must be 3-6 digits.', 'VALIDATION');
    }
    if (!/^\d{10}$/.test(accountNumber)) {
      throw httpError(400, 'account_number must be exactly 10 digits (NUBAN).', 'VALIDATION');
    }
    if (accountName && accountName.length > 120) {
      throw httpError(400, 'account_name is too long (max 120 chars).', 'VALIDATION');
    }
    if (!accountName) {
      // MOCK name enquiry — deterministic fake name, never a real lookup.
      const q = await mockProvider.nameEnquiry({ bankCode, accountNumber });
      accountName = q.accountName;
    }

    try {
      const now = Date.now();
      const id = await insertReturnId(
        `INSERT INTO cash_withdrawal_beneficiaries
           (user_id, label, bank_code, account_number, account_name, verified, created_at)
         VALUES (?,?,?,?,?,1,?)`,
        `INSERT INTO cash_withdrawal_beneficiaries
           (user_id, label, bank_code, account_number, account_name, verified, created_at)
         VALUES ($1,$2,$3,$4,$5,true,$6) RETURNING id`,
        [Number(req.userId), label, bankCode, accountNumber, accountName, now]);
      await notifyCashEvent(Number(req.userId), 'cash.beneficiary.added', {
        beneficiary_id: id,
        bank_code: bankCode,
        account_number_masked: maskAccount(accountNumber),
      });
      const row = await dbGet(
        'SELECT * FROM cash_withdrawal_beneficiaries WHERE id = ?',
        'SELECT * FROM cash_withdrawal_beneficiaries WHERE id = $1',
        [id]);
      res.status(201).json(beneficiaryView(row));
    } catch (e) {
      if (/unique|23505/i.test(String(e && e.message))) {
        throw httpError(409, 'This bank account is already saved as a beneficiary.', 'DUPLICATE_BENEFICIARY');
      }
      throw e;
    }
  }));

  router.get('/beneficiaries', ah(async (req, res) => {
    const rows = await dbAll(
      'SELECT * FROM cash_withdrawal_beneficiaries WHERE user_id = ? ORDER BY id',
      'SELECT * FROM cash_withdrawal_beneficiaries WHERE user_id = $1 ORDER BY id',
      [Number(req.userId)]);
    res.json({ beneficiaries: rows.map(beneficiaryView) });
  }));

  // ----- withdrawal quote (step 1) -----
  router.post('/withdrawals/quote', ah(async (req, res) => {
    const body = req.body || {};
    const beneficiaryId = Number(body.beneficiary_id);
    const grossKobo = body.gross_kobo;

    if (!Number.isSafeInteger(beneficiaryId) || beneficiaryId <= 0) {
      throw httpError(400, 'beneficiary_id must be a positive integer.', 'VALIDATION');
    }
    if (!Number.isSafeInteger(grossKobo) || grossKobo < WITHDRAW_MIN_KOBO) {
      throw httpError(400,
        `gross_kobo must be an integer of at least ${WITHDRAW_MIN_KOBO} kobo (₦${WITHDRAW_MIN_KOBO / 100}).`,
        'VALIDATION');
    }
    const ben = await getBeneficiaryForUser(beneficiaryId, Number(req.userId));
    if (!ben) throw httpError(404, 'Beneficiary not found.', 'BENEFICIARY_NOT_FOUND');
    if (!Number(ben.verified)) throw httpError(400, 'Beneficiary is not verified.', 'BENEFICIARY_UNVERIFIED');

    const policy = await getFeePolicy(1);
    const c = commissionFor(grossKobo, policy);
    const quoteToken = crypto.randomBytes(16).toString('hex'); // 32 hex chars
    const expiresAt = Date.now() + QUOTE_TTL_MS;
    sweepQuotes();
    quoteStore.set(quoteToken, {
      userId: Number(req.userId),
      beneficiaryId,
      grossKobo,
      commissionKobo: c.commissionKobo,
      netKobo: c.netKobo,
      rateBps: c.rateBps,
      feePolicyVersion: c.policyVersion,
      expiresAt,
    });
    res.json({
      gross_kobo: grossKobo,
      commission_kobo: c.commissionKobo,
      net_kobo: c.netKobo,
      rate_bps: c.rateBps,
      fee_policy_version: c.policyVersion,
      quote_token: quoteToken,
      expires_at: expiresAt,
    });
  }));

  // ----- withdrawal execute (step 2) -----
  router.post('/withdrawals', ah(async (req, res) => {
    const body = req.body || {};
    const beneficiaryId = Number(body.beneficiary_id);
    const grossKobo = body.gross_kobo;
    const idempotencyKey = String(body.idempotency_key || '').trim();
    const quoteToken = String(body.quote_token || '').trim();

    if (!Number.isSafeInteger(beneficiaryId) || beneficiaryId <= 0) {
      throw httpError(400, 'beneficiary_id must be a positive integer.', 'VALIDATION');
    }
    if (!Number.isSafeInteger(grossKobo) || grossKobo < WITHDRAW_MIN_KOBO) {
      throw httpError(400, `gross_kobo must be an integer of at least ${WITHDRAW_MIN_KOBO} kobo.`, 'VALIDATION');
    }
    if (!idempotencyKey || idempotencyKey.length > 128) {
      throw httpError(400, 'idempotency_key is required (max 128 chars).', 'VALIDATION');
    }
    if (!quoteToken) throw httpError(400, 'quote_token is required.', 'VALIDATION');

    const userId = Number(req.userId);
    const journalKey = `withdrawal:${idempotencyKey}`;

    // Idempotent replay first — works even after the quote token was consumed.
    const replay = await dbGet(
      'SELECT * FROM cash_withdrawal_requests WHERE journal_key = ?',
      'SELECT * FROM cash_withdrawal_requests WHERE journal_key = $1',
      [journalKey]);
    if (replay) return res.json(await withdrawalFull(replay));

    // Quote must exist, be fresh, and bind this exact user/beneficiary/gross.
    const q = quoteStore.get(quoteToken);
    const quoteOk = q && q.userId === userId && q.beneficiaryId === beneficiaryId
      && q.grossKobo === grossKobo && q.expiresAt > Date.now();
    if (!quoteOk) {
      if (q && q.expiresAt <= Date.now()) quoteStore.delete(quoteToken);
      throw httpError(400, 'Invalid or expired quote_token. Request a fresh quote.', 'BAD_QUOTE');
    }

    const ben = await getBeneficiaryForUser(beneficiaryId, userId);
    if (!ben) throw httpError(404, 'Beneficiary not found.', 'BENEFICIARY_NOT_FOUND');
    if (!Number(ben.verified)) throw httpError(400, 'Beneficiary is not verified.', 'BENEFICIARY_UNVERIFIED');

    if ((await getAccountStatus(userId)) !== 'active') {
      throw httpError(403, 'Your cash account is not active; sending is blocked.', 'ACCOUNT_NOT_ACTIVE');
    }
    const bal = await getCashBalance(userId);
    if (bal.availableKobo < grossKobo) {
      throw httpError(400, 'Insufficient available balance for this withdrawal.', 'INSUFFICIENT_FUNDS');
    }
    // Milestone 9: daily withdrawal cap (throws RiskLimitError -> 429).
    await checkWithdrawalCap({ userId, grossKobo });

    // Milestone 9: risk decision is pure (no DB writes) — computed before
    // the tx so both branches below stay atomic.
    const riskDecision = withdrawalRiskDecision({
      grossKobo,
      beneficiaryCreatedAt: Number(ben.created_at),
      now: Date.now(),
    });

    let request;
    try {
      request = await dbTransaction(async () => {
        const now = Date.now();
        const wid = await insertReturnId(
          `INSERT INTO cash_withdrawal_requests
             (user_id, beneficiary_id, journal_key, gross_kobo, commission_kobo, net_kobo,
              fee_policy_version, currency, status, provider_ref, failure_reason,
              created_at, updated_at, completed_at)
           VALUES (?,?,?,?,?,?,?,'NGN','requested',NULL,NULL,?,?,NULL)`,
          `INSERT INTO cash_withdrawal_requests
             (user_id, beneficiary_id, journal_key, gross_kobo, commission_kobo, net_kobo,
              fee_policy_version, currency, status, provider_ref, failure_reason,
              created_at, updated_at, completed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'NGN','requested',NULL,NULL,$8,$9,NULL) RETURNING id`,
          [userId, beneficiaryId, journalKey, grossKobo, q.commissionKobo, q.netKobo,
           q.feePolicyVersion, now, now]);

        // Reserve: customer_available -> customer_reserved (gross).
        // Commission is NOT moved here — it is recognized on completion only.
        await postJournal({
          journalKey: `${journalKey}:reserve`,
          type: 'withdrawal',
          userId,
          entries: [
            { accountCode: 'customer_available', side: 'debit', amountKobo: grossKobo },
            { accountCode: 'customer_reserved', side: 'credit', amountKobo: grossKobo },
          ],
          memo: `Withdrawal #${wid} reserve`,
          metadata: { withdrawal_id: wid, idempotency_key: idempotencyKey },
        });
        await dbRun(
          'UPDATE cash_withdrawal_requests SET status = ?, updated_at = ? WHERE id = ?',
          'UPDATE cash_withdrawal_requests SET status = $1, updated_at = $2 WHERE id = $3',
          ['reserved', now, wid]);

        if (riskDecision.divert) {
          // Under review: funds stay reserved; the payout is NOT submitted.
          // An admin approves (resumes payout) or rejects (releases funds).
          // The row keeps DB status 'reserved'; the API surface reports the
          // effective status 'under_review' while this review is open.
          await dbRun(
            `INSERT INTO risk_reviews
               (withdrawal_id, user_id, status, reasons, gross_kobo, note, created_at, reviewed_at)
             VALUES (?,?,'open',?,?,?,?,NULL)`,
            `INSERT INTO risk_reviews
               (withdrawal_id, user_id, status, reasons, gross_kobo, note, created_at, reviewed_at)
             VALUES ($1,$2,'open',$3,$4,$5,$6,NULL)`,
            [wid, userId, JSON.stringify(riskDecision.reasons), grossKobo,
             `Risk hold: ${riskDecision.reasons.join(', ')}`, now]);
          await notifyCashEvent(userId, 'cash.withdrawal.under_review', {
            withdrawal_id: wid,
            gross_kobo: grossKobo,
            reasons: riskDecision.reasons,
          });
        } else {
          // MOCK payout submission (deterministic fake reference, no network).
          // wid is mixed in as a nonce: identical withdrawals must not
          // collide on the UNIQUE provider_ref column.
          const payout = await mockProvider.submitPayout({
            userId,
            amountKobo: q.netKobo,
            destinationHint: `MOCK-ACCT-${maskAccount(ben.account_number)}`,
            nonce: wid,
          });
          await dbRun(
            'UPDATE cash_withdrawal_requests SET provider_ref = ?, status = ?, updated_at = ? WHERE id = ?',
            'UPDATE cash_withdrawal_requests SET provider_ref = $1, status = $2, updated_at = $3 WHERE id = $4',
            [payout.payoutId, 'submitted', now, wid]);

          await notifyCashEvent(userId, 'cash.withdrawal.submitted', {
            withdrawal_id: wid,
            gross_kobo: grossKobo,
            commission_kobo: q.commissionKobo,
            net_kobo: q.netKobo,
            provider_ref: payout.payoutId,
          });
        }

        return dbGet(
          'SELECT * FROM cash_withdrawal_requests WHERE id = ?',
          'SELECT * FROM cash_withdrawal_requests WHERE id = $1',
          [wid]);
      });
      quoteStore.delete(quoteToken); // single-use
    } catch (e) {
      // Lost a race with an identical idempotency_key: treat as replay.
      if (/unique|23505/i.test(String(e && e.message))) {
        const row = await dbGet(
          'SELECT * FROM cash_withdrawal_requests WHERE journal_key = ?',
          'SELECT * FROM cash_withdrawal_requests WHERE journal_key = $1',
          [journalKey]);
        if (row) return res.json(await withdrawalFull(row));
      }
      throw e;
    }

    const full = await withdrawalFull(request);
    res.status(201).json({
      withdrawal_id: full.id,
      status: full.status,
      review: full.review,
      breakdown: full.breakdown,
      provider_ref: full.provider_ref,
    });
  }));

  // ----- withdrawal status (owner only) -----
  router.get('/withdrawals/:id', ah(async (req, res) => {
    const wid = Number(req.params.id);
    if (!Number.isSafeInteger(wid) || wid <= 0) {
      throw httpError(400, 'Invalid withdrawal id.', 'VALIDATION');
    }
    const row = await dbGet(
      'SELECT * FROM cash_withdrawal_requests WHERE id = ?',
      'SELECT * FROM cash_withdrawal_requests WHERE id = $1',
      [wid]);
    if (!row || Number(row.user_id) !== Number(req.userId)) {
      throw httpError(404, 'Withdrawal not found.', 'NOT_FOUND');
    }
    res.json(await withdrawalFull(row));
  }));

  // ----- mock provider poll: advance submitted/processing -> completed -----
  router.post('/withdrawals/:id/mock-advance', ah(async (req, res) => {
    const wid = Number(req.params.id);
    if (!Number.isSafeInteger(wid) || wid <= 0) {
      throw httpError(400, 'Invalid withdrawal id.', 'VALIDATION');
    }
    const row = await dbGet(
      'SELECT * FROM cash_withdrawal_requests WHERE id = ?',
      'SELECT * FROM cash_withdrawal_requests WHERE id = $1',
      [wid]);
    if (!row || Number(row.user_id) !== Number(req.userId)) {
      throw httpError(404, 'Withdrawal not found.', 'NOT_FOUND');
    }
    // Terminal states (and anything already past advance): no-op, post nothing.
    if (TERMINAL_WITHDRAWAL_STATUSES.has(row.status)) {
      return res.json(await withdrawalFull(row));
    }
    if (!['submitted', 'processing'].includes(row.status)) {
      throw httpError(409,
        `Withdrawal is in '${row.status}' state and cannot be advanced.`, 'BAD_STATE');
    }

    // Consult the provider FIRST; never advance on a blind retry.
    const ps = await mockProvider.getPayoutStatus(row.provider_ref);
    if (ps.status !== 'settled') {
      return res.json({ ...(await withdrawalFull(row)), provider_status: ps.status });
    }

    const gross = Number(row.gross_kobo);
    const commission = Number(row.commission_kobo);
    const net = Number(row.net_kobo);

    const completed = await dbTransaction(async () => {
      const now = Date.now();
      // Move reserved -> withdrawal_clearing.
      await postJournal({
        journalKey: `withdrawal:complete:${wid}`,
        type: 'withdrawal',
        userId: Number(row.user_id),
        entries: [
          { accountCode: 'customer_reserved', side: 'debit', amountKobo: gross },
          { accountCode: 'withdrawal_clearing', side: 'credit', amountKobo: gross },
        ],
        memo: `Withdrawal #${wid} settled by provider`,
        metadata: { withdrawal_id: wid, provider_ref: row.provider_ref },
      });
      // Commission recognized ONLY on completion: split the clearing pot
      // into platform revenue and provider-bound funds. Every journal stays
      // balanced (debits == credits == gross).
      const commEntries = [];
      if (commission > 0) {
        commEntries.push(
          { accountCode: 'withdrawal_clearing', side: 'debit', amountKobo: commission },
          { accountCode: 'platform_commission', side: 'credit', amountKobo: commission });
      }
      if (net > 0) {
        commEntries.push(
          { accountCode: 'withdrawal_clearing', side: 'debit', amountKobo: net },
          { accountCode: 'provider_clearing', side: 'credit', amountKobo: net });
      }
      if (commEntries.length > 0) {
        await postJournal({
          journalKey: `withdrawal:commission:${wid}`,
          type: 'commission',
          userId: Number(row.user_id),
          entries: commEntries,
          memo: `Withdrawal #${wid} commission recognized`,
          metadata: {
            withdrawal_id: wid,
            commission_kobo: commission,
            net_kobo: net,
            fee_policy_version: Number(row.fee_policy_version),
          },
        });
      }
      await dbRun(
        'UPDATE cash_withdrawal_requests SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?',
        'UPDATE cash_withdrawal_requests SET status = $1, completed_at = $2, updated_at = $3 WHERE id = $4',
        ['completed', now, now, wid]);
      await notifyCashEvent(Number(row.user_id), 'cash.withdrawal.completed', {
        withdrawal_id: wid,
        gross_kobo: gross,
        commission_kobo: commission,
        net_kobo: net,
        provider_ref: row.provider_ref,
      });
      return dbGet(
        'SELECT * FROM cash_withdrawal_requests WHERE id = ?',
        'SELECT * FROM cash_withdrawal_requests WHERE id = $1',
        [wid]);
    });

    res.json(await withdrawalFull(completed));
  }));

  // ----- mock failure simulation -----
  router.post('/withdrawals/:id/mock-fail', ah(async (req, res) => {
    const wid = Number(req.params.id);
    const reason = String((req.body || {}).reason || '').trim().slice(0, 280);
    if (!Number.isSafeInteger(wid) || wid <= 0) {
      throw httpError(400, 'Invalid withdrawal id.', 'VALIDATION');
    }
    if (!reason) throw httpError(400, 'reason is required.', 'VALIDATION');
    const row = await dbGet(
      'SELECT * FROM cash_withdrawal_requests WHERE id = ?',
      'SELECT * FROM cash_withdrawal_requests WHERE id = $1',
      [wid]);
    if (!row || Number(row.user_id) !== Number(req.userId)) {
      throw httpError(404, 'Withdrawal not found.', 'NOT_FOUND');
    }
    if (!PRE_COMPLETION_STATUSES.has(row.status)) {
      throw httpError(409,
        `Withdrawal in '${row.status}' state cannot be failed.`, 'BAD_STATE');
    }

    const failed = await dbTransaction(async () => {
      const now = Date.now();
      if (row.status !== 'requested') {
        // Release the reserved gross back to available. No commission
        // reversal is needed: commission is only recognized on
        // completion, and nothing completed here.
        await postJournal({
          journalKey: `withdrawal:release:${wid}`,
          type: 'withdrawal',
          userId: Number(row.user_id),
          entries: [
            { accountCode: 'customer_reserved', side: 'debit', amountKobo: Number(row.gross_kobo) },
            { accountCode: 'customer_available', side: 'credit', amountKobo: Number(row.gross_kobo) },
          ],
          memo: `Withdrawal #${wid} released (provider failure)`,
          metadata: { withdrawal_id: wid, reason },
        });
      }
      await dbRun(
        'UPDATE cash_withdrawal_requests SET status = ?, failure_reason = ?, updated_at = ? WHERE id = ?',
        'UPDATE cash_withdrawal_requests SET status = $1, failure_reason = $2, updated_at = $3 WHERE id = $4',
        ['failed', reason, now, wid]);
      // Milestone 9: a user-cancelled withdrawal closes any open risk review.
      await dbRun(
        `UPDATE risk_reviews SET status = 'closed', reviewed_at = ?,
           note = COALESCE(note,'') || ' | closed: withdrawal failed/cancelled by user'
         WHERE withdrawal_id = ? AND status = 'open'`,
        `UPDATE risk_reviews SET status = 'closed', reviewed_at = $1,
           note = COALESCE(note,'') || ' | closed: withdrawal failed/cancelled by user'
         WHERE withdrawal_id = $2 AND status = 'open'`,
        [now, wid]);
      await notifyCashEvent(Number(row.user_id), 'cash.withdrawal.failed', {
        withdrawal_id: wid,
        gross_kobo: Number(row.gross_kobo),
        reason,
      });
      return dbGet(
        'SELECT * FROM cash_withdrawal_requests WHERE id = ?',
        'SELECT * FROM cash_withdrawal_requests WHERE id = $1',
        [wid]);
    });

    res.json(await withdrawalFull(failed));
  }));

  // ----- error mapping -----
  // eslint-disable-next-line no-unused-vars
  router.use((err, _req, res, _next) => {
    if (err && err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
      });
    }
    if (err && err.name === 'InsufficientFundsError') {
      return res.status(400).json({ error: 'Insufficient available balance.', code: 'INSUFFICIENT_FUNDS' });
    }
    if (err && (err.name === 'LedgerValidationError' || err.name === 'UnbalancedJournalError')) {
      return res.status(400).json({ error: err.message, code: err.name.toUpperCase() });
    }
    console.error('[cashFlows] unexpected error:', err);
    return res.status(500).json({ error: 'Internal error.' });
  });

  return router;
}
