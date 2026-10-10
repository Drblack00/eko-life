// ============================================================
// routes/cashAdmin.js — Èkó Life cash admin API (Milestone 9, Worker B):
// risk controls, manual adjustments, withdrawal review, reconciliation.
//
// SAFETY CONTRACT
// - LIVE MONEY STAYS OFF: every route sits behind requireCashOps
//   (403 while CASH_OPS_ENABLED != 'true').
// - Admin-only (see requireAdmin below).
// - Integer kobo everywhere. Adjustments can ONLY post balanced
//   double-entry journals through the ledger engine — there is no
//   endpoint that sets a balance directly, by design.
// - ADDITIVE ONLY: touches ledger_*, cash_*, risk_reviews,
//   fintech_audit_logs. Never touches game tables or the
//   gameplay-coins economy.
//
// WITHDRAWAL STATE MACHINE (valid transitions)
//   requested -> reserved        (reserve journal posted)
//   reserved  -> under_review    (risk policy diverted; review opened.
//                                 DB status stays 'reserved'; the API
//                                 reports the EFFECTIVE status
//                                 'under_review' while the review is open)
//   under_review -> submitted    (admin APPROVE: payout submitted)
//   under_review -> rejected      (admin REJECT: reserved funds released
//                                 via compensating journal; terminal)
//   under_review -> failed        (user cancels via mock-fail; funds
//                                 released; terminal)
//   submitted -> processing -> completed
//                                 (provider settles; commission
//                                 recognized ONLY here)
//   submitted|processing -> failed
//                                 (provider failure; funds released)
//   completed|failed|rejected: terminal — no further transitions.
//
// Mounted by the coordinator at /api/admin/cash.
// Factory shape mirrors createAdminRouter(): createCashAdminRouter().
// ============================================================
import { Router } from 'express';
import crypto from 'node:crypto';
import { verifyToken } from '../auth.js';
import {
  dbRun, dbGet, dbAll, dbMode, dbTransaction, ensureColumn, getUserById,
} from '../db.js';
import { requireCashOps } from '../fintech/config.js';
import { postJournal } from '../fintech/ledger.js';
import { notifyCashEvent, submitReservedWithdrawalPayout } from './cashFlows.js';

// ---------- admin auth ----------
// requireAdmin is NOT exported from routes/admin.js, so this replicates
// its exact logic (source: src/routes/admin.js ~lines 20-35):
// Bearer token -> users row -> is_admin=1 AND NOT banned.
async function requireAdmin(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer (.+)$/);
  const id = m ? verifyToken(m[1]) : null;
  const user = id ? await getUserById(id) : null;
  // Banned accounts lose admin access even if the flag is somehow still set.
  if (!user || !Number(user.is_admin) || Number(user.banned)) {
    return res.status(403).json({ error: 'Admin only.' });
  }
  req.admin = user;
  next();
}

// ---------- helpers ----------

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function httpError(statusCode, message, code = null) {
  const e = new Error(message);
  e.statusCode = statusCode;
  if (code) e.code = code;
  return e;
}

const maskAccount = (n) => `******${String(n).slice(-4)}`;

async function auditLog({ actor, action, entity, entityId, detail }) {
  await dbRun(
    'INSERT INTO fintech_audit_logs (actor, action, entity, entity_id, detail, created_at) VALUES (?,?,?,?,?,?)',
    'INSERT INTO fintech_audit_logs (actor, action, entity, entity_id, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [actor, action, entity, entityId == null ? null : String(entityId),
     detail == null ? null : JSON.stringify(detail), Date.now()]);
}

function parseJsonText(t, fallback = null) {
  if (t == null || t === '') return fallback;
  try { return JSON.parse(t); } catch { return fallback; }
}

// Net CREDIT balance of a ledger account in kobo (credits - debits)
// over posted+reversed journals. (A reversal posts a new mirrored
// journal and flips the original to 'reversed'; counting both keeps the
// pair netted correctly.)
async function accountNetCredit(code) {
  const r = await dbGet(
    `SELECT COALESCE(SUM(CASE WHEN e.side = 'credit' THEN e.amount_kobo ELSE -e.amount_kobo END),0) AS n
     FROM ledger_entries e
     JOIN ledger_accounts a ON a.id = e.account_id
     JOIN ledger_journals j ON j.id = e.journal_id
     WHERE a.code = ? AND j.status IN ('posted','reversed')`,
    `SELECT COALESCE(SUM(CASE WHEN e.side = 'credit' THEN e.amount_kobo ELSE -e.amount_kobo END),0) AS n
     FROM ledger_entries e
     JOIN ledger_accounts a ON a.id = e.account_id
     JOIN ledger_journals j ON j.id = e.journal_id
     WHERE a.code = $1 AND j.status IN ('posted','reversed')`,
    [code]);
  return Number(r.n);
}

// Per-user net credit balance of a customer account (same netting rule).
async function userAccountNetCredit(userId, code) {
  const r = await dbGet(
    `SELECT COALESCE(SUM(CASE WHEN e.side = 'credit' THEN e.amount_kobo ELSE -e.amount_kobo END),0) AS n
     FROM ledger_entries e
     JOIN ledger_accounts a ON a.id = e.account_id
     JOIN ledger_journals j ON j.id = e.journal_id
     WHERE a.code = ? AND j.user_id = ? AND j.status IN ('posted','reversed')`,
    `SELECT COALESCE(SUM(CASE WHEN e.side = 'credit' THEN e.amount_kobo ELSE -e.amount_kobo END),0) AS n
     FROM ledger_entries e
     JOIN ledger_accounts a ON a.id = e.account_id
     JOIN ledger_journals j ON j.id = e.journal_id
     WHERE a.code = $1 AND j.user_id = $2 AND j.status IN ('posted','reversed')`,
    [code, Number(userId)]);
  return Number(r.n);
}

async function accountExists(code) {
  const r = await dbGet(
    'SELECT id FROM ledger_accounts WHERE code = ?',
    'SELECT id FROM ledger_accounts WHERE code = $1',
    [code]);
  return !!r;
}

function clampLimit(v, def = 50, max = 200) {
  let n = Number.parseInt(v, 10);
  if (!Number.isSafeInteger(n) || n <= 0) n = def;
  return Math.min(n, max);
}

async function openReviewFor(withdrawalId) {
  return dbGet(
    `SELECT * FROM risk_reviews WHERE withdrawal_id = ? AND status = 'open' ORDER BY id DESC`,
    `SELECT * FROM risk_reviews WHERE withdrawal_id = $1 AND status = 'open' ORDER BY id DESC`,
    [Number(withdrawalId)]);
}

function reviewView(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    withdrawal_id: Number(r.withdrawal_id),
    user_id: Number(r.user_id),
    status: r.status,
    reasons: parseJsonText(r.reasons, []),
    gross_kobo: Number(r.gross_kobo),
    note: r.note || null,
    reviewed_by: r.reviewed_by == null ? null : Number(r.reviewed_by),
    review_reason: r.review_reason || null,
    created_at: Number(r.created_at),
    reviewed_at: r.reviewed_at == null ? null : Number(r.reviewed_at),
  };
}

async function withdrawalAdminView(row) {
  const ben = await dbGet(
    'SELECT * FROM cash_withdrawal_beneficiaries WHERE id = ?',
    'SELECT * FROM cash_withdrawal_beneficiaries WHERE id = $1',
    [row.beneficiary_id]);
  const review = row.status === 'reserved' ? await openReviewFor(Number(row.id)) : null;
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    status: review ? 'under_review' : row.status,
    review: reviewView(review),
    gross_kobo: Number(row.gross_kobo),
    commission_kobo: Number(row.commission_kobo),
    net_kobo: Number(row.net_kobo),
    fee_policy_version: Number(row.fee_policy_version),
    beneficiary: ben ? {
      id: Number(ben.id),
      label: ben.label,
      bank_code: ben.bank_code,
      account_number_masked: maskAccount(ben.account_number),
      account_name: ben.account_name || null,
    } : null,
    provider_ref: row.provider_ref || null,
    failure_reason: row.failure_reason || null,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    completed_at: row.completed_at == null ? null : Number(row.completed_at),
  };
}

// ---------- router ----------

export function createCashAdminRouter() {
  const router = Router();

  // account_status column readiness (same pattern as cashFlows.js — the
  // column is added via ensureColumn, so requests must not race it).
  const ready = ensureColumn(
    'cash_wallets', 'account_status',
    "TEXT NOT NULL DEFAULT 'active'",
    "TEXT NOT NULL DEFAULT 'active'");
  router.use(async (_req, _res, next) => {
    try { await ready; next(); } catch (e) { next(e); }
  });

  router.use(requireCashOps, requireAdmin);

  // ----- GET /overview -----
  router.get('/overview', ah(async (req, res) => {
    const liab = await dbGet(
      `SELECT COALESCE(SUM(available_kobo),0) AS avail,
              COALESCE(SUM(reserved_kobo),0) AS res,
              COUNT(*) AS wallets
       FROM cash_wallets`,
      `SELECT COALESCE(SUM(available_kobo),0) AS avail,
              COALESCE(SUM(reserved_kobo),0) AS res,
              COUNT(*) AS wallets
       FROM cash_wallets`,
      []);
    const commission = await accountNetCredit('platform_commission');
    const pd = await dbGet(
      `SELECT COUNT(*) AS c FROM cash_deposits WHERE status = 'pending'`,
      `SELECT COUNT(*) AS c FROM cash_deposits WHERE status = 'pending'`,
      []);
    const pw = await dbGet(
      `SELECT COUNT(*) AS c FROM cash_withdrawal_requests
       WHERE status IN ('requested','reserved','submitted','processing')`,
      `SELECT COUNT(*) AS c FROM cash_withdrawal_requests
       WHERE status IN ('requested','reserved','submitted','processing')`,
      []);
    const ur = await dbGet(
      `SELECT COUNT(*) AS c FROM risk_reviews WHERE status = 'open'`,
      `SELECT COUNT(*) AS c FROM risk_reviews WHERE status = 'open'`,
      []);
    res.json({
      generated_at: Date.now(),
      customer_liabilities_kobo: {
        total: Number(liab.avail) + Number(liab.res),
        available: Number(liab.avail),
        reserved: Number(liab.res),
      },
      commission_earned_kobo: commission,
      counts: {
        wallets: Number(liab.wallets),
        pending_deposits: Number(pd.c),
        pending_withdrawals: Number(pw.c),
        under_review_withdrawals: Number(ur.c),
      },
    });
  }));

  // ----- GET /journals?user_id=&type=&from=&to=&limit= -----
  const JOURNAL_TYPES = new Set(['deposit', 'transfer', 'withdrawal', 'commission', 'reversal', 'adjustment']);
  router.get('/journals', ah(async (req, res) => {
    const clauses = [];
    const params = [];
    const push = (clause, v) => {
      params.push(v);
      clauses.push(dbMode() === 'postgres'
        ? clause.replace('?', `$${params.length}`)
        : clause);
    };
    if (req.query.user_id !== undefined) {
      const uid = Number(req.query.user_id);
      if (!Number.isSafeInteger(uid) || uid <= 0) throw httpError(400, 'user_id must be a positive integer.', 'VALIDATION');
      push('j.user_id = ?', uid);
    }
    if (req.query.type !== undefined) {
      const t = String(req.query.type);
      if (!JOURNAL_TYPES.has(t)) throw httpError(400, `type must be one of: ${[...JOURNAL_TYPES].join(', ')}.`, 'VALIDATION');
      push('j.type = ?', t);
    }
    if (req.query.from !== undefined) {
      const f = Number(req.query.from);
      if (!Number.isSafeInteger(f) || f < 0) throw httpError(400, 'from must be a ms epoch integer.', 'VALIDATION');
      push('j.created_at >= ?', f);
    }
    if (req.query.to !== undefined) {
      const t = Number(req.query.to);
      if (!Number.isSafeInteger(t) || t < 0) throw httpError(400, 'to must be a ms epoch integer.', 'VALIDATION');
      push('j.created_at <= ?', t);
    }
    const limit = clampLimit(req.query.limit);
    params.push(limit);
    const limitPh = dbMode() === 'postgres' ? `$${params.length}` : '?';
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const journals = await dbAll(
      `SELECT j.id, j.journal_key, j.type, j.status, j.user_id, j.related_journal_id,
              j.provider_ref, j.currency, j.memo, j.metadata, j.created_at, j.posted_at
       FROM ledger_journals j ${where} ORDER BY j.id DESC LIMIT ${limitPh}`,
      `SELECT j.id, j.journal_key, j.type, j.status, j.user_id, j.related_journal_id,
              j.provider_ref, j.currency, j.memo, j.metadata, j.created_at, j.posted_at
       FROM ledger_journals j ${where} ORDER BY j.id DESC LIMIT ${limitPh}`,
      params);
    let entryRows = [];
    if (journals.length > 0) {
      const ids = journals.map((j) => Number(j.id));
      const ph = ids.map((_, i) => (dbMode() === 'postgres' ? `$${i + 1}` : '?')).join(',');
      const esql =
        `SELECT e.journal_id, e.side, e.amount_kobo, a.code AS account_code
         FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
         WHERE e.journal_id IN (${ph}) ORDER BY e.journal_id, e.id`;
      entryRows = await dbAll(esql, esql, ids);
    }
    const byId = new Map();
    for (const j of journals) {
      byId.set(Number(j.id), {
        id: Number(j.id),
        journal_key: j.journal_key,
        type: j.type,
        status: j.status,
        user_id: j.user_id == null ? null : Number(j.user_id),
        related_journal_id: j.related_journal_id == null ? null : Number(j.related_journal_id),
        provider_ref: j.provider_ref || null,
        currency: j.currency || 'NGN',
        memo: j.memo || null,
        metadata: parseJsonText(j.metadata),
        created_at: Number(j.created_at),
        posted_at: j.posted_at == null ? null : Number(j.posted_at),
        entries: [],
      });
    }
    for (const r of entryRows) {
      const j = byId.get(Number(r.journal_id));
      if (j) j.entries.push({ side: r.side, amount_kobo: Number(r.amount_kobo), account_code: r.account_code });
    }
    res.json({ journals: journals.map((j) => byId.get(Number(j.id))), limit });
  }));

  // ----- GET /withdrawals?status= -----
  // status: open (default — every non-terminal withdrawal),
  //         pending (non-terminal WITHOUT an open review),
  //         under_review, submitted, failed, rejected, completed, all.
  router.get('/withdrawals', ah(async (req, res) => {
    const status = String(req.query.status || 'open');
    const allowed = new Set(['open', 'pending', 'under_review', 'submitted', 'failed', 'rejected', 'completed', 'all']);
    if (!allowed.has(status)) {
      throw httpError(400, `status must be one of: ${[...allowed].join(', ')}.`, 'VALIDATION');
    }
    const limit = clampLimit(req.query.limit);
    const pg = dbMode() === 'postgres';
    let where = '';
    let params;
    if (status === 'open') {
      where = `WHERE w.status IN ('requested','reserved','submitted','processing')`;
      params = [limit];
    } else if (status === 'pending') {
      where = `WHERE w.status IN ('requested','reserved','submitted','processing')
               AND NOT EXISTS (SELECT 1 FROM risk_reviews r
                               WHERE r.withdrawal_id = w.id AND r.status = 'open')`;
      params = [limit];
    } else if (status === 'under_review') {
      where = `WHERE EXISTS (SELECT 1 FROM risk_reviews r
                             WHERE r.withdrawal_id = w.id AND r.status = 'open')`;
      params = [limit];
    } else if (status === 'all') {
      where = '';
      params = [limit];
    } else {
      where = pg ? 'WHERE w.status = $1' : 'WHERE w.status = ?';
      params = [status, limit];
    }
    const limitPh = pg ? `$${params.length}` : '?';
    const sql = `SELECT w.* FROM cash_withdrawal_requests w ${where} ORDER BY w.id DESC LIMIT ${limitPh}`;
    const rows = await dbAll(sql, sql, params);
    const out = [];
    for (const r of rows) out.push(await withdrawalAdminView(r));
    res.json({ withdrawals: out, limit, status });
  }));

  // ----- GET /deposits?status=&limit= -----
  router.get('/deposits', ah(async (req, res) => {
    const allowed = new Set(['pending', 'confirmed', 'failed', 'refunded', 'expired', 'all']);
    const status = String(req.query.status || 'all');
    if (!allowed.has(status)) {
      throw httpError(400, `status must be one of: ${[...allowed].join(', ')}.`, 'VALIDATION');
    }
    const limit = clampLimit(req.query.limit);
    const where = status === 'all'
      ? ''
      : (dbMode() === 'postgres' ? 'WHERE d.status = $1' : 'WHERE d.status = ?');
    const limitPh = dbMode() === 'postgres' ? (status === 'all' ? '$1' : '$2') : '?';
    const params = status === 'all' ? [limit] : [status, limit];
    const rows = await dbAll(
      `SELECT d.* FROM cash_deposits d ${where} ORDER BY d.id DESC LIMIT ${limitPh}`,
      `SELECT d.* FROM cash_deposits d ${where} ORDER BY d.id DESC LIMIT ${limitPh}`,
      params);
    res.json({
      deposits: rows.map((r) => ({
        id: Number(r.id),
        user_id: Number(r.user_id),
        journal_key: r.journal_key,
        amount_kobo: Number(r.amount_kobo),
        currency: r.currency || 'NGN',
        provider: r.provider,
        provider_ref: r.provider_ref || null,
        status: r.status,
        metadata: parseJsonText(r.metadata),
        confirmed_at: r.confirmed_at == null ? null : Number(r.confirmed_at),
        created_at: Number(r.created_at),
        updated_at: Number(r.updated_at),
      })),
      limit,
      status,
    });
  }));

  // ----- GET /audit?action=&actor=&entity=&limit= -----
  router.get('/audit', ah(async (req, res) => {
    const clauses = [];
    const params = [];
    const push = (col, v) => {
      params.push(v);
      clauses.push(dbMode() === 'postgres' ? `${col} = $${params.length}` : `${col} = ?`);
    };
    for (const key of ['action', 'actor', 'entity']) {
      if (req.query[key] !== undefined) push(key, String(req.query[key]));
    }
    const limit = clampLimit(req.query.limit);
    params.push(limit);
    const limitPh = dbMode() === 'postgres' ? `$${params.length}` : '?';
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await dbAll(
      `SELECT * FROM fintech_audit_logs ${where} ORDER BY id DESC LIMIT ${limitPh}`,
      `SELECT * FROM fintech_audit_logs ${where} ORDER BY id DESC LIMIT ${limitPh}`,
      params);
    res.json({
      logs: rows.map((r) => ({
        id: Number(r.id),
        actor: r.actor,
        action: r.action,
        entity: r.entity,
        entity_id: r.entity_id || null,
        detail: parseJsonText(r.detail),
        created_at: Number(r.created_at),
      })),
      limit,
    });
  }));

  // ----- POST /users/:id/restrict -----
  router.post('/users/:id/restrict', ah(async (req, res) => {
    const targetId = Number(req.params.id);
    const status = String((req.body && req.body.status) || '').trim();
    const reason = String((req.body && req.body.reason) || '').trim();
    if (!Number.isSafeInteger(targetId) || targetId <= 0) {
      throw httpError(400, 'Invalid user id.', 'VALIDATION');
    }
    if (status !== 'suspended' && status !== 'active') {
      throw httpError(400, "status must be 'suspended' or 'active'.", 'VALIDATION');
    }
    if (!reason) throw httpError(400, 'reason is required.', 'VALIDATION');
    const target = await getUserById(targetId);
    if (!target) throw httpError(404, 'User not found.', 'NOT_FOUND');

    const now = Date.now();
    const prev = await dbGet(
      'SELECT account_status FROM cash_wallets WHERE user_id = ?',
      'SELECT account_status FROM cash_wallets WHERE user_id = $1',
      [targetId]);
    const previousStatus = (prev && prev.account_status) || 'active';
    // The wallet row may not exist yet — create it at zero balances so the
    // status has somewhere to live. Balances are never set here.
    await dbRun(
      `INSERT INTO cash_wallets (user_id, available_kobo, reserved_kobo, currency, updated_at)
       VALUES (?, 0, 0, 'NGN', ?) ON CONFLICT(user_id) DO NOTHING`,
      `INSERT INTO cash_wallets (user_id, available_kobo, reserved_kobo, currency, updated_at)
       VALUES ($1, 0, 0, 'NGN', $2) ON CONFLICT(user_id) DO NOTHING`,
      [targetId, now]);
    await dbRun(
      'UPDATE cash_wallets SET account_status = ?, updated_at = ? WHERE user_id = ?',
      'UPDATE cash_wallets SET account_status = $1, updated_at = $2 WHERE user_id = $3',
      [status, now, targetId]);

    await auditLog({
      actor: `admin:${req.admin.id}`,
      action: 'cash.account.restrict',
      entity: 'cash_wallets',
      entityId: targetId,
      detail: { status, previous_status: previousStatus, reason, admin_username: req.admin.username },
    });
    await notifyCashEvent(targetId, 'cash.account.restricted', {
      status, reason, by_admin: Number(req.admin.id),
    });
    res.json({ ok: true, user_id: targetId, account_status: status, previous_status: previousStatus });
  }));

  // ----- POST /adjustments -----
  // Manual correction as a BALANCED double-entry journal through the
  // ledger engine. There is deliberately no way to set a balance
  // directly: every adjustment moves value between two named accounts
  // and the engine rejects unbalanced journals.
  router.post('/adjustments', ah(async (req, res) => {
    const body = req.body || {};
    const userId = body.user_id == null ? null : Number(body.user_id);
    const debitAccount = String(body.debit_account || '').trim();
    const creditAccount = String(body.credit_account || '').trim();
    const amountKobo = body.amount_kobo;
    const reason = String(body.reason || '').trim();

    if (userId !== null && (!Number.isSafeInteger(userId) || userId <= 0)) {
      throw httpError(400, 'user_id must be a positive integer.', 'VALIDATION');
    }
    if (!debitAccount || !creditAccount) {
      throw httpError(400, 'debit_account and credit_account are required.', 'VALIDATION');
    }
    if (debitAccount === creditAccount) {
      throw httpError(400, 'debit_account and credit_account must differ.', 'VALIDATION');
    }
    if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0) {
      throw httpError(400, 'amount_kobo must be a positive integer number of kobo.', 'VALIDATION');
    }
    if (!reason) throw httpError(400, 'reason is required.', 'VALIDATION');
    if (!(await accountExists(debitAccount))) {
      throw httpError(400, `Unknown ledger account: ${debitAccount}.`, 'VALIDATION');
    }
    if (!(await accountExists(creditAccount))) {
      throw httpError(400, `Unknown ledger account: ${creditAccount}.`, 'VALIDATION');
    }
    if (userId !== null && !(await getUserById(userId))) {
      throw httpError(404, 'User not found.', 'NOT_FOUND');
    }

    const journalKey = `adjustment:admin:${req.admin.id}:${Date.now()}:${crypto.randomBytes(4).toString('hex')}`;
    const { journal, entries } = await postJournal({
      journalKey,
      type: 'adjustment',
      userId,
      entries: [
        { accountCode: debitAccount, side: 'debit', amountKobo },
        { accountCode: creditAccount, side: 'credit', amountKobo },
      ],
      memo: `Admin adjustment by ${req.admin.username}: ${reason}`.slice(0, 280),
      metadata: { reason, admin_id: Number(req.admin.id), admin_username: req.admin.username },
    });
    await auditLog({
      actor: `admin:${req.admin.id}`,
      action: 'cash.adjustment.post',
      entity: 'ledger_journals',
      entityId: journal.id,
      detail: {
        journal_key: journalKey, user_id: userId,
        debit_account: debitAccount, credit_account: creditAccount,
        amount_kobo: amountKobo, reason,
      },
    });
    res.status(201).json({
      ok: true,
      journal_id: journal.id,
      journal_key: journalKey,
      entries: entries.map((e) => ({
        side: e.side, amount_kobo: e.amountKobo, account_code: e.accountCode,
      })),
    });
  }));

  // ----- POST /withdrawals/:id/approve -----
  router.post('/withdrawals/:id/approve', ah(async (req, res) => {
    const wid = Number(req.params.id);
    const reason = String((req.body && req.body.reason) || '').trim();
    if (!Number.isSafeInteger(wid) || wid <= 0) {
      throw httpError(400, 'Invalid withdrawal id.', 'VALIDATION');
    }
    if (!reason) throw httpError(400, 'reason is required.', 'VALIDATION');

    const adminId = Number(req.admin.id);
    const now = Date.now();
    // One atomic transaction: close the review AND resume the payout.
    // dbTransaction is re-entrant and serialized, so a concurrent
    // approve sees the closed review and 409s on NO_OPEN_REVIEW.
    const { submitted } = await dbTransaction(async () => {
      const r = await openReviewFor(wid);
      if (!r) throw httpError(409, 'No open risk review for this withdrawal.', 'NO_OPEN_REVIEW');
      const w = await dbGet(
        'SELECT * FROM cash_withdrawal_requests WHERE id = ?',
        'SELECT * FROM cash_withdrawal_requests WHERE id = $1',
        [wid]);
      if (!w) throw httpError(404, 'Withdrawal not found.', 'NOT_FOUND');
      if (w.status !== 'reserved') {
        throw httpError(409, `Withdrawal is in '${w.status}' state and cannot be approved.`, 'BAD_STATE');
      }
      await dbRun(
        `UPDATE risk_reviews SET status = 'approved', reviewed_by = ?, review_reason = ?, reviewed_at = ?
         WHERE id = ? AND status = 'open'`,
        `UPDATE risk_reviews SET status = 'approved', reviewed_by = $1, review_reason = $2, reviewed_at = $3
         WHERE id = $4 AND status = 'open'`,
        [adminId, reason, now, r.id]);
      await auditLog({
        actor: `admin:${adminId}`,
        action: 'cash.withdrawal.review.approved',
        entity: 'risk_reviews',
        entityId: r.id,
        detail: { withdrawal_id: wid, reason, admin_username: req.admin.username },
      });
      // Resume the payout flow (joins this transaction — re-entrant).
      const done = await submitReservedWithdrawalPayout(wid, { actor: `admin:${adminId}` });
      await notifyCashEvent(Number(done.user_id), 'cash.withdrawal.review.approved', {
        withdrawal_id: wid,
        review_id: Number(r.id),
        reason,
        by_admin: adminId,
      });
      return { submitted: done };
    });

    res.json(await withdrawalAdminView(submitted));
  }));

  // ----- POST /withdrawals/:id/reject -----
  router.post('/withdrawals/:id/reject', ah(async (req, res) => {
    const wid = Number(req.params.id);
    const reason = String((req.body && req.body.reason) || '').trim();
    if (!Number.isSafeInteger(wid) || wid <= 0) {
      throw httpError(400, 'Invalid withdrawal id.', 'VALIDATION');
    }
    if (!reason) throw httpError(400, 'reason is required.', 'VALIDATION');

    const adminId = Number(req.admin.id);
    const rejected = await dbTransaction(async () => {
      const r = await openReviewFor(wid);
      if (!r) throw httpError(409, 'No open risk review for this withdrawal.', 'NO_OPEN_REVIEW');
      const w = await dbGet(
        'SELECT * FROM cash_withdrawal_requests WHERE id = ?',
        'SELECT * FROM cash_withdrawal_requests WHERE id = $1',
        [wid]);
      if (!w) throw httpError(404, 'Withdrawal not found.', 'NOT_FOUND');
      if (w.status !== 'reserved') {
        throw httpError(409, `Withdrawal is in '${w.status}' state and cannot be rejected.`, 'BAD_STATE');
      }
      const now = Date.now();
      const gross = Number(w.gross_kobo);
      // Release the reserved gross back to available via a compensating
      // journal — the reserve journal is never edited. No commission
      // reversal is needed: commission is only recognized on completion.
      await postJournal({
        journalKey: `withdrawal:release:admin:${wid}`,
        type: 'withdrawal',
        userId: Number(w.user_id),
        entries: [
          { accountCode: 'customer_reserved', side: 'debit', amountKobo: gross },
          { accountCode: 'customer_available', side: 'credit', amountKobo: gross },
        ],
        memo: `Withdrawal #${wid} rejected by admin ${req.admin.username}: ${reason}`.slice(0, 280),
        metadata: { withdrawal_id: wid, reason, admin_id: adminId, review_id: Number(r.id) },
      });
      await dbRun(
        'UPDATE cash_withdrawal_requests SET status = ?, failure_reason = ?, updated_at = ? WHERE id = ?',
        'UPDATE cash_withdrawal_requests SET status = $1, failure_reason = $2, updated_at = $3 WHERE id = $4',
        ['rejected', reason, now, wid]);
      await dbRun(
        `UPDATE risk_reviews SET status = 'rejected', reviewed_by = ?, review_reason = ?, reviewed_at = ?
         WHERE id = ? AND status = 'open'`,
        `UPDATE risk_reviews SET status = 'rejected', reviewed_by = $1, review_reason = $2, reviewed_at = $3
         WHERE id = $4 AND status = 'open'`,
        [adminId, reason, now, r.id]);
      await auditLog({
        actor: `admin:${adminId}`,
        action: 'cash.withdrawal.review.rejected',
        entity: 'risk_reviews',
        entityId: r.id,
        detail: { withdrawal_id: wid, reason, admin_username: req.admin.username },
      });
      await notifyCashEvent(Number(w.user_id), 'cash.withdrawal.review.rejected', {
        withdrawal_id: wid,
        review_id: Number(r.id),
        gross_kobo: gross,
        reason,
        by_admin: adminId,
      });
      return dbGet(
        'SELECT * FROM cash_withdrawal_requests WHERE id = ?',
        'SELECT * FROM cash_withdrawal_requests WHERE id = $1',
        [wid]);
    });
    res.json(await withdrawalAdminView(rejected));
  }));

  // ----- GET /reconcile -----
  router.get('/reconcile', ah(async (req, res) => {
    res.json(await buildReconciliationReport());
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
    if (err && (err.name === 'LedgerValidationError' || err.name === 'UnbalancedJournalError')) {
      return res.status(400).json({ error: err.message, code: err.name.toUpperCase() });
    }
    if (err && err.name === 'InsufficientFundsError') {
      return res.status(400).json({ error: 'Insufficient available balance.', code: 'INSUFFICIENT_FUNDS' });
    }
    console.error('[cashAdmin] unexpected error:', err);
    return res.status(500).json({ error: 'Internal error.' });
  });

  return router;
}

// ---------- reconciliation ----------

// Compares the wallet cache (cash_wallets) against the ledger (source of
// truth), checks every journal balances, and lists open items. See
// docs/RECONCILIATION.md for the operational procedure.
export async function buildReconciliationReport() {
  const generatedAt = Date.now();
  const differences = [];
  const diff = (severity, code, message, extra = {}) => {
    differences.push({ severity, code, message, ...extra });
  };

  // 1) Journal integrity: every posted/reversed journal must balance.
  const unbalanced = await dbAll(
    `SELECT j.id, j.journal_key,
            SUM(CASE WHEN e.side = 'debit' THEN e.amount_kobo ELSE 0 END) AS debits,
            SUM(CASE WHEN e.side = 'credit' THEN e.amount_kobo ELSE 0 END) AS credits
     FROM ledger_journals j JOIN ledger_entries e ON e.journal_id = j.id
     WHERE j.status IN ('posted','reversed')
     GROUP BY j.id, j.journal_key
     HAVING SUM(CASE WHEN e.side = 'debit' THEN e.amount_kobo ELSE 0 END)
          != SUM(CASE WHEN e.side = 'credit' THEN e.amount_kobo ELSE 0 END)`,
    `SELECT j.id, j.journal_key,
            SUM(CASE WHEN e.side = 'debit' THEN e.amount_kobo ELSE 0 END) AS debits,
            SUM(CASE WHEN e.side = 'credit' THEN e.amount_kobo ELSE 0 END) AS credits
     FROM ledger_journals j JOIN ledger_entries e ON e.journal_id = j.id
     WHERE j.status IN ('posted','reversed')
     GROUP BY j.id, j.journal_key
     HAVING SUM(CASE WHEN e.side = 'debit' THEN e.amount_kobo ELSE 0 END)
          != SUM(CASE WHEN e.side = 'credit' THEN e.amount_kobo ELSE 0 END)`,
    []);
  for (const u of unbalanced) {
    diff('error', 'UNBALANCED_JOURNAL',
      `Journal ${u.journal_key} (id ${u.id}) does not balance: debits ${u.debits} != credits ${u.credits}.`,
      { journal_id: Number(u.id), journal_key: u.journal_key });
  }

  // 2) Wallet cache vs ledger, per user.
  const wallets = await dbAll(
    'SELECT user_id, available_kobo, reserved_kobo FROM cash_wallets',
    'SELECT user_id, available_kobo, reserved_kobo FROM cash_wallets',
    []);
  let customerAvailable = 0;
  let customerReserved = 0;
  for (const w of wallets) {
    const uid = Number(w.user_id);
    customerAvailable += Number(w.available_kobo);
    customerReserved += Number(w.reserved_kobo);
    const ledgerAvail = await userAccountNetCredit(uid, 'customer_available');
    const ledgerRes = await userAccountNetCredit(uid, 'customer_reserved');
    if (ledgerAvail !== Number(w.available_kobo) || ledgerRes !== Number(w.reserved_kobo)) {
      diff('error', 'WALLET_MISMATCH',
        `User ${uid}: wallet cache (avail ${w.available_kobo}, reserved ${w.reserved_kobo}) ` +
        `!= ledger (avail ${ledgerAvail}, reserved ${ledgerRes}).`,
        {
          user_id: uid,
          wallet: { available_kobo: Number(w.available_kobo), reserved_kobo: Number(w.reserved_kobo) },
          ledger: { available_kobo: ledgerAvail, reserved_kobo: ledgerRes },
        });
    }
  }

  // 3) Liability identity: customer liabilities (credit balances) must
  //    equal the net debit position of every other account. (Tautological
  //    when check 1 passes — a second, independent computation path.)
  const otherCodes = ['deposit_processing', 'provider_clearing', 'withdrawal_clearing',
    'platform_commission', 'provider_fees', 'refunds_chargebacks'];
  const clearing = {};
  let otherNetDebit = 0;
  for (const code of otherCodes) {
    const netCredit = await accountNetCredit(code);
    clearing[code] = { net_credit_kobo: netCredit };
    otherNetDebit += -netCredit;
  }
  const customerTotal = customerAvailable + customerReserved;
  if (customerTotal !== otherNetDebit) {
    diff('error', 'LIABILITY_MISMATCH',
      `Customer liabilities ${customerTotal} kobo != net debit position of other accounts ${otherNetDebit} kobo.`,
      { customer_liabilities_kobo: customerTotal, other_accounts_net_debit_kobo: otherNetDebit });
  }

  // 4) Missing provider events: every confirmed deposit must have a
  //    processed provider event for its provider_ref.
  const confirmedDeposits = await dbAll(
    `SELECT id, user_id, provider_ref, amount_kobo FROM cash_deposits WHERE status = 'confirmed'`,
    `SELECT id, user_id, provider_ref, amount_kobo FROM cash_deposits WHERE status = 'confirmed'`,
    []);
  for (const d of confirmedDeposits) {
    const ev = await dbGet(
      `SELECT id FROM provider_events
       WHERE provider_ref = ? AND processed = 1 AND signature_valid = 1 LIMIT 1`,
      `SELECT id FROM provider_events
       WHERE provider_ref = $1 AND processed = true AND signature_valid = true LIMIT 1`,
      [d.provider_ref]);
    if (!ev) {
      diff('error', 'MISSING_PROVIDER_EVENT',
        `Confirmed deposit ${d.id} (provider_ref ${d.provider_ref}) has no processed provider event.`,
        { deposit_id: Number(d.id), user_id: Number(d.user_id), provider_ref: d.provider_ref });
    }
  }

  // 5) Open items.
  const pendingDeposits = await dbAll(
    `SELECT id, user_id, amount_kobo, provider_ref, created_at FROM cash_deposits
     WHERE status = 'pending' ORDER BY id`,
    `SELECT id, user_id, amount_kobo, provider_ref, created_at FROM cash_deposits
     WHERE status = 'pending' ORDER BY id`,
    []);
  const submittedPayouts = await dbAll(
    `SELECT id, user_id, gross_kobo, provider_ref, created_at FROM cash_withdrawal_requests
     WHERE status IN ('submitted','processing') ORDER BY id`,
    `SELECT id, user_id, gross_kobo, provider_ref, created_at FROM cash_withdrawal_requests
     WHERE status IN ('submitted','processing') ORDER BY id`,
    []);
  const underReview = await dbAll(
    `SELECT r.id AS review_id, r.withdrawal_id, r.user_id, r.gross_kobo, r.reasons, r.created_at
     FROM risk_reviews r WHERE r.status = 'open' ORDER BY r.id`,
    `SELECT r.id AS review_id, r.withdrawal_id, r.user_id, r.gross_kobo, r.reasons, r.created_at
     FROM risk_reviews r WHERE r.status = 'open' ORDER BY r.id`,
    []);
  // Stuck reservations: 'reserved' with no open review for > 30 minutes —
  // the payout submission after reserve should be near-instant.
  const stuckCutoff = generatedAt - 30 * 60 * 1000;
  const stuckReserved = await dbAll(
    `SELECT w.id, w.user_id, w.gross_kobo, w.updated_at FROM cash_withdrawal_requests w
     WHERE w.status = 'reserved' AND w.updated_at < ?
       AND NOT EXISTS (SELECT 1 FROM risk_reviews r
                       WHERE r.withdrawal_id = w.id AND r.status = 'open')
     ORDER BY w.id`,
    `SELECT w.id, w.user_id, w.gross_kobo, w.updated_at FROM cash_withdrawal_requests w
     WHERE w.status = 'reserved' AND w.updated_at < $1
       AND NOT EXISTS (SELECT 1 FROM risk_reviews r
                       WHERE r.withdrawal_id = w.id AND r.status = 'open')
     ORDER BY w.id`,
    [stuckCutoff]);
  for (const s of stuckReserved) {
    diff('warning', 'STUCK_RESERVATION',
      `Withdrawal ${s.id} has been 'reserved' with no open review since ${new Date(Number(s.updated_at)).toISOString()}.`,
      { withdrawal_id: Number(s.id), user_id: Number(s.user_id), gross_kobo: Number(s.gross_kobo) });
  }

  const commissionEarned = await accountNetCredit('platform_commission');

  return {
    generated_at: generatedAt,
    totals: {
      customer_available_kobo: customerAvailable,
      customer_reserved_kobo: customerReserved,
      customer_liabilities_kobo: customerTotal,
      commission_earned_kobo: commissionEarned,
      clearing_accounts: clearing,
    },
    balanced: differences.length === 0,
    open_items: {
      pending_deposits: pendingDeposits.map((d) => ({
        id: Number(d.id), user_id: Number(d.user_id),
        amount_kobo: Number(d.amount_kobo), provider_ref: d.provider_ref || null,
        created_at: Number(d.created_at),
      })),
      submitted_payouts: submittedPayouts.map((w) => ({
        id: Number(w.id), user_id: Number(w.user_id),
        gross_kobo: Number(w.gross_kobo), provider_ref: w.provider_ref || null,
        created_at: Number(w.created_at),
      })),
      under_review: underReview.map((r) => ({
        review_id: Number(r.review_id), withdrawal_id: Number(r.withdrawal_id),
        user_id: Number(r.user_id), gross_kobo: Number(r.gross_kobo),
        reasons: parseJsonText(r.reasons, []), created_at: Number(r.created_at),
      })),
      stuck_reserved: stuckReserved.map((s) => ({
        id: Number(s.id), user_id: Number(s.user_id),
        gross_kobo: Number(s.gross_kobo), updated_at: Number(s.updated_at),
      })),
    },
    differences,
  };
}
