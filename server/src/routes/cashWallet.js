// ============================================================
// routes/cashWallet.js — cash wallet REST API (M5 / Milestone 6a).
//
// SAFETY (non-negotiable)
// - LIVE MONEY STAYS OFF: every route sits behind authMiddleware +
//   requireCashOps, so all of them 403 while CASH_OPS_ENABLED != 'true'.
// - MOCK provider only (fintech/mockProvider.js). No real HTTP calls,
//   no real credentials, no live secrets anywhere in this file.
// - Integer kobo everywhere. Balances are computed from the ledger,
//   never accepted from the client.
// - Every value movement goes through postJournal (double-entry,
//   atomic, idempotent on journal_key). Posted journals are NEVER
//   edited; corrections go through reverseJournal.
// - ADDITIVE ONLY: touches only ledger_*, cash_deposits, cash_wallets,
//   provider_events and fintech_audit_logs. Game tables (users /
//   characters / transactions / furniture) and the gameplay-coins
//   economy are never touched.
//
// Mounted by the coordinator at /api/cash-wallet.
// Factory shape mirrors createAdminRouter(): createCashWalletRouter().
// ============================================================
import crypto from 'crypto';
import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import { requireCashOps } from '../fintech/config.js';
import {
  postJournal, reverseJournal, getJournal, getCashBalance,
} from '../fintech/ledger.js';
import { getProvider, adapterForName, webhookSecretFor, ProviderNotConfiguredError } from '../fintech/provider.js';
import { dbRun, dbGet, dbAll, dbMode, dbTransaction } from '../db.js';

// ---- deposit limits (integer kobo) ----
export const DEPOSIT_MIN_KOBO = 10000;      // ₦100
export const DEPOSIT_MAX_KOBO = 100000000;  // ₦1,000,000

// ---- mock webhook signature ----
// *** TEST-ONLY SCHEME ***
// The MOCK provider signs webhook bodies with HMAC-SHA256 over
//   `${provider_ref}|${status}|${amount_kobo}|${currency}`
// keyed by process.env.MOCK_WEBHOOK_SECRET. When that env var is
// unset, we fall back to the OBVIOUS non-secret below — it exists
// only so local flow tests can run without setup. It is NOT a
// security boundary: never rely on it for anything real, never
// rotate anything into it, and never let a real provider flow use
// this path. A live provider integration must use its own signing
// key, rotated secrets, and timestamp/replay protection.
export const MOCK_WEBHOOK_SECRET_FALLBACK = 'mock-test-secret-NOT-FOR-PRODUCTION';

function mockWebhookSecret() {
  return process.env.MOCK_WEBHOOK_SECRET || MOCK_WEBHOOK_SECRET_FALLBACK;
}

// Deterministic signer — exported so tests (and the docs example) can
// build valid mock webhooks. Mirrors what a mock provider would send.
export function signMockWebhook({ provider_ref, status, amount_kobo, currency }) {
  return crypto.createHmac('sha256', mockWebhookSecret())
    .update(`${provider_ref}|${status}|${amount_kobo}|${currency}`)
    .digest('hex');
}

function validMockSignature({ provider_ref, status, amount_kobo, currency, signature }) {
  if (typeof signature !== 'string' || !signature) return false;
  const expected = signMockWebhook({ provider_ref, status, amount_kobo, currency });
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- internal helpers ----------

// INSERT returning the new row id on both backends.
async function insertReturningId(sqliteInsert, pgInsertReturning, params) {
  if (dbMode() === 'postgres') {
    const r = await dbGet(pgInsertReturning, pgInsertReturning, params);
    return Number(r.id);
  }
  await dbRun(sqliteInsert, sqliteInsert, params);
  const r = await dbGet('SELECT last_insert_rowid() AS id', 'SELECT 1', []);
  return Number(r.id);
}

async function auditLog({ actor, action, entity, entityId, detail }) {
  const now = Date.now();
  await dbRun(
    'INSERT INTO fintech_audit_logs (actor, action, entity, entity_id, detail, created_at) VALUES (?,?,?,?,?,?)',
    'INSERT INTO fintech_audit_logs (actor, action, entity, entity_id, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [actor, action, entity, entityId == null ? null : String(entityId),
     detail == null ? null : JSON.stringify(detail), now]);
}

async function recordProviderEvent({ provider = 'mock', eventType, providerRef, payload, signatureValid, processed }) {
  const now = Date.now();
  // Legacy callers pass a parsed object; the provider webhook route
  // passes the raw event bytes (stored verbatim for forensics).
  const payloadText = typeof payload === 'string' ? payload.slice(0, 8000)
    : JSON.stringify(payload == null ? {} : payload);
  await dbRun(
    `INSERT INTO provider_events (provider, event_type, provider_ref, payload,
        signature_valid, processed, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    `INSERT INTO provider_events (provider, event_type, provider_ref, payload,
        signature_valid, processed, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [provider, eventType, providerRef || null, payloadText,
     signatureValid ? 1 : 0, processed ? 1 : 0, now]);
}

function normDeposit(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    userId: Number(r.user_id),
    journalKey: r.journal_key,
    amountKobo: Number(r.amount_kobo),
    currency: r.currency || 'NGN',
    provider: r.provider,
    providerRef: r.provider_ref || null,
    status: r.status,
    confirmedAt: r.confirmed_at == null ? null : Number(r.confirmed_at),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

async function getDepositById(id) {
  return normDeposit(await dbGet(
    'SELECT * FROM cash_deposits WHERE id = ?',
    'SELECT * FROM cash_deposits WHERE id = $1',
    [id]));
}

async function getDepositByProviderRef(providerRef) {
  return normDeposit(await dbGet(
    'SELECT * FROM cash_deposits WHERE provider_ref = ?',
    'SELECT * FROM cash_deposits WHERE provider_ref = $1',
    [providerRef]));
}

async function setDepositStatus(id, status, { confirmedAt = undefined } = {}) {
  const now = Date.now();
  if (confirmedAt !== undefined) {
    await dbRun(
      'UPDATE cash_deposits SET status = ?, confirmed_at = ?, updated_at = ? WHERE id = ?',
      'UPDATE cash_deposits SET status = $1, confirmed_at = $2, updated_at = $3 WHERE id = $4',
      [status, confirmedAt, now, id]);
  } else {
    await dbRun(
      'UPDATE cash_deposits SET status = ?, updated_at = ? WHERE id = ?',
      'UPDATE cash_deposits SET status = $1, updated_at = $2 WHERE id = $3',
      [status, now, id]);
  }
}

// Public deposit receipt: the state of one deposit plus the user's
// current cash balance (always server-computed, never client-supplied).
async function depositReceipt(deposit) {
  const bal = await getCashBalance(deposit.userId);
  return {
    deposit_id: deposit.id,
    provider_ref: deposit.providerRef,
    amount_kobo: deposit.amountKobo,
    currency: deposit.currency,
    status: deposit.status,
    confirmed_at: deposit.confirmedAt,
    journal_key: deposit.journalKey,
    available_kobo: bal.availableKobo,
    reserved_kobo: bal.reservedKobo,
  };
}

function confirmJournalKey(providerRef) {
  return `deposit:confirm:${providerRef}`;
}

// ---------- shared verified-webhook processing ----------

// Drives the SAME exact-once deposit crediting path for every deposit
// webhook, legacy (/deposit/mock-webhook) and provider
// (/deposit/webhook/:provider) alike. The caller MUST have verified
// the provider signature first; the payload here is still re-checked
// against the initiated deposit (amount/currency must match exactly).
// Returns { status, body } — the route handler sends it.
// `actor` is the audit identity ('user:<id>' for the legacy test
// endpoint, 'provider:<name>' for provider webhooks).
async function processDepositWebhookEvent({ provider, providerRef, status, amountKobo, currency, rawPayload, actor }) {
  const fieldsOk =
    typeof providerRef === 'string' && providerRef.length > 0 &&
    typeof status === 'string' && status.length > 0 &&
    Number.isSafeInteger(amountKobo) &&
    typeof currency === 'string' && currency.length > 0;
  if (!fieldsOk) {
    await recordProviderEvent({
      provider, eventType: 'deposit.webhook', providerRef: null,
      payload: rawPayload, signatureValid: true, processed: false,
    });
    return { status: 400, body: { error: 'Invalid or incomplete webhook payload.' } };
  }

  const deposit = await getDepositByProviderRef(providerRef);
  if (!deposit) {
    await recordProviderEvent({
      provider, eventType: 'deposit.webhook', providerRef,
      payload: rawPayload, signatureValid: true, processed: false,
    });
    return { status: 404, body: { error: 'Deposit not found for provider_ref.' } };
  }

  // The webhook must describe the deposit that was actually
  // initiated: amount and currency must match exactly, otherwise
  // nothing is credited.
  if (amountKobo !== deposit.amountKobo || currency !== deposit.currency) {
    await recordProviderEvent({
      provider, eventType: 'deposit.webhook', providerRef,
      payload: rawPayload, signatureValid: true, processed: false,
    });
    await auditLog({
      actor, action: 'deposit.webhook.rejected', entity: 'cash_deposits',
      entityId: deposit.id,
      detail: { reason: 'amount_or_currency_mismatch',
                expected: { amount_kobo: deposit.amountKobo, currency: deposit.currency },
                received: { amount_kobo: amountKobo, currency } },
    });
    return { status: 400, body: { error: 'Webhook amount_kobo/currency does not match the initiated deposit.' } };
  }

  // ---- duplicate-delivery safe: already confirmed -> same receipt, no repost ----
  if (deposit.status === 'confirmed' && status === 'confirmed') {
    await recordProviderEvent({
      provider, eventType: 'deposit.webhook', providerRef,
      payload: rawPayload, signatureValid: true, processed: true,
    });
    const fresh = await getDepositById(deposit.id);
    return { status: 200, body: { ...(await depositReceipt(fresh)), duplicate: true } };
  }

  if (status === 'confirmed') {
    if (deposit.status !== 'pending') {
      await recordProviderEvent({
        provider, eventType: 'deposit.webhook', providerRef,
        payload: rawPayload, signatureValid: true, processed: false,
      });
      return { status: 400, body: { error: `Cannot confirm a deposit in '${deposit.status}' state.` } };
    }
    const now = Date.now();
    // Journal key idempotency makes even a racing replay safe:
    // the same key can only ever post once.
    await dbTransaction(async () => {
      await postJournal({
        journalKey: confirmJournalKey(providerRef),
        type: 'deposit',
        userId: deposit.userId,
        entries: [
          { accountCode: 'deposit_processing', side: 'debit', amountKobo: deposit.amountKobo },
          { accountCode: 'customer_available', side: 'credit', amountKobo: deposit.amountKobo },
        ],
        memo: `${provider.toUpperCase()} deposit confirmed: ${providerRef}`,
        providerRef,
      });
      await setDepositStatus(deposit.id, 'confirmed', { confirmedAt: now });
    });
    await recordProviderEvent({
      provider, eventType: 'deposit.webhook', providerRef,
      payload: rawPayload, signatureValid: true, processed: true,
    });
    await auditLog({
      actor, action: 'deposit.webhook.confirmed', entity: 'cash_deposits',
      entityId: deposit.id, detail: { provider_ref: providerRef, amount_kobo: deposit.amountKobo },
    });
    const fresh = await getDepositById(deposit.id);
    return { status: 200, body: await depositReceipt(fresh) };
  }

  if (status === 'failed' || status === 'expired') {
    if (deposit.status === 'confirmed') {
      await recordProviderEvent({
        provider, eventType: 'deposit.webhook', providerRef,
        payload: rawPayload, signatureValid: true, processed: false,
      });
      return { status: 400, body: { error: `Cannot mark a confirmed deposit as '${status}'. A refund must be issued instead.` } };
    }
    await setDepositStatus(deposit.id, status);
    await recordProviderEvent({
      provider, eventType: 'deposit.webhook', providerRef,
      payload: rawPayload, signatureValid: true, processed: true,
    });
    await auditLog({
      actor, action: `deposit.webhook.${status}`, entity: 'cash_deposits',
      entityId: deposit.id, detail: { provider_ref: providerRef },
    });
    const fresh = await getDepositById(deposit.id);
    return { status: 200, body: await depositReceipt(fresh) };
  }

  if (status === 'refunded') {
    if (deposit.status === 'confirmed') {
      // Undo the confirmation journal via a NEW reversal journal —
      // the original posted rows are never edited or deleted.
      await dbTransaction(async () => {
        const confirmJournal = await getJournal(confirmJournalKey(providerRef));
        if (confirmJournal && confirmJournal.status === 'posted') {
          await reverseJournal(confirmJournal.id, { reason: 'provider refund', actor: `${provider}-webhook` });
        }
        await setDepositStatus(deposit.id, 'refunded');
      });
    } else if (deposit.status === 'pending') {
      await setDepositStatus(deposit.id, 'refunded');
    }
    // Already 'refunded' -> no-op replay, still acknowledged.
    await recordProviderEvent({
      provider, eventType: 'deposit.webhook', providerRef,
      payload: rawPayload, signatureValid: true, processed: true,
    });
    await auditLog({
      actor, action: 'deposit.webhook.refunded', entity: 'cash_deposits',
      entityId: deposit.id, detail: { provider_ref: providerRef, was_confirmed: deposit.status === 'confirmed' },
    });
    const fresh = await getDepositById(deposit.id);
    return { status: 200, body: await depositReceipt(fresh) };
  }

  if (status === 'pending') {
    // Provider status ping: nothing to do, acknowledge.
    await recordProviderEvent({
      provider, eventType: 'deposit.webhook', providerRef,
      payload: rawPayload, signatureValid: true, processed: true,
    });
    const fresh = await getDepositById(deposit.id);
    return { status: 200, body: await depositReceipt(fresh) };
  }

  await recordProviderEvent({
    provider, eventType: 'deposit.webhook', providerRef,
    payload: rawPayload, signatureValid: true, processed: false,
  });
  return { status: 400, body: { error: `Unknown webhook status '${status}'.` } };
}

// ---------- router ----------

export function createCashWalletRouter() {
  const router = Router();

  // ---- GET /balance ----
  router.get('/balance', authMiddleware, requireCashOps, async (req, res, next) => {
    try {
      const bal = await getCashBalance(req.userId);
      res.json({
        available_kobo: bal.availableKobo,
        reserved_kobo: bal.reservedKobo,
        currency: 'NGN',
      });
    } catch (e) { next(e); }
  });

  // ---- GET /history?limit=&offset= ----
  // The caller's own ledger journals, newest-first, each with its
  // entries (account codes resolved). req.userId only — there is no
  // user_id parameter; one user can never read another's history.
  router.get('/history', authMiddleware, requireCashOps, async (req, res, next) => {
    try {
      let limit = Number.parseInt(req.query.limit, 10);
      if (!Number.isSafeInteger(limit) || limit <= 0) limit = 50;
      limit = Math.min(limit, 200);
      let offset = Number.parseInt(req.query.offset, 10);
      if (!Number.isSafeInteger(offset) || offset < 0) offset = 0;

      const journals = await dbAll(
        `SELECT id, journal_key, type, status, provider_ref, memo, created_at
         FROM ledger_journals
         WHERE user_id = ?
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
        `SELECT id, journal_key, type, status, provider_ref, memo, created_at
         FROM ledger_journals
         WHERE user_id = $1
         ORDER BY id DESC
         LIMIT $2 OFFSET $3`,
        [req.userId, limit, offset]);

      // Entries for exactly this page's journals (paginating the JOIN
      // would count entry rows, not journals).
      let entryRows = [];
      if (journals.length > 0) {
        const ids = journals.map((j) => Number(j.id));
        const ph = ids.map((_, i) => (dbMode() === 'postgres' ? `$${i + 1}` : '?')).join(',');
        const entrySql =
          `SELECT e.journal_id, e.side, e.amount_kobo, a.code AS account_code
           FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
           WHERE e.journal_id IN (${ph})
           ORDER BY e.journal_id, e.id`;
        entryRows = await dbAll(entrySql, entrySql, ids);
      }

      const byJournal = new Map();
      for (const j of journals) {
        byJournal.set(Number(j.id), {
          id: Number(j.id),
          journal_key: j.journal_key,
          type: j.type,
          status: j.status,
          provider_ref: j.provider_ref || null,
          memo: j.memo || null,
          created_at: Number(j.created_at),
          entries: [],
        });
      }
      for (const r of entryRows) {
        const j = byJournal.get(Number(r.journal_id));
        if (j) {
          j.entries.push({
            side: r.side,
            amount_kobo: Number(r.amount_kobo),
            account_code: r.account_code,
          });
        }
      }
      res.json({ journals: journals.map((j) => byJournal.get(Number(j.id))), limit, offset });
    } catch (e) { next(e); }
  });

  // ---- POST /deposit/initiate ----
  // Creates a pending deposit row and a MOCK provider reference. No
  // money moves here: the wallet is credited only when a signed
  // mock webhook confirms the deposit.
  router.post('/deposit/initiate', authMiddleware, requireCashOps, async (req, res, next) => {
    try {
      const body = req.body || {};
      const amountKobo = body.amount_kobo;
      if (typeof amountKobo !== 'number' || !Number.isSafeInteger(amountKobo)) {
        return res.status(400).json({ error: 'amount_kobo must be an integer number of kobo.' });
      }
      if (amountKobo < DEPOSIT_MIN_KOBO || amountKobo > DEPOSIT_MAX_KOBO) {
        return res.status(400).json({
          error: `amount_kobo must be between ${DEPOSIT_MIN_KOBO} and ${DEPOSIT_MAX_KOBO} kobo.`,
        });
      }
      if (body.currency !== undefined && body.currency !== 'NGN') {
        return res.status(400).json({ error: "Only 'NGN' deposits are supported." });
      }

      // Resolve the adapter BEFORE any DB write: a non-mock provider
      // without credentials / cash ops enabled fails closed here, so
      // no pending deposit row is ever created for it.
      const adapter = getProvider();
      const providerName = adapter.name;

      // Insert first so the id exists, then key the journal_key off it.
      // A unique throwaway key satisfies the NOT NULL/UNIQUE constraint
      // until the id-keyed update lands in the same transaction.
      const userId = req.userId;
      const depositId = await dbTransaction(async () => {
        const now = Date.now();
        const tmpKey = `deposit:init:tmp:${now}:${crypto.randomBytes(4).toString('hex')}`;
        const id = await insertReturningId(
          `INSERT INTO cash_deposits
             (user_id, journal_key, amount_kobo, currency, provider, provider_ref,
              status, confirmed_at, metadata, created_at, updated_at)
           VALUES (?, ?, ?, 'NGN', ?, NULL, 'pending', NULL, NULL, ?, ?)`,
          `INSERT INTO cash_deposits
             (user_id, journal_key, amount_kobo, currency, provider, provider_ref,
              status, confirmed_at, metadata, created_at, updated_at)
           VALUES ($1, $2, $3, 'NGN', $4, NULL, 'pending', NULL, NULL, $5, $6) RETURNING id`,
          [userId, tmpKey, amountKobo, providerName, now, now]);
        await dbRun(
          'UPDATE cash_deposits SET journal_key = ?, updated_at = ? WHERE id = ?',
          'UPDATE cash_deposits SET journal_key = $1, updated_at = $2 WHERE id = $3',
          [`deposit:init:${id}`, Date.now(), id]);
        return id;
      });

      // Provider reference via the configured adapter. The mock adapter
      // is deterministic on (userId, amountKobo), so suffix the deposit
      // id to keep provider_ref unique per deposit row.
      const ref = await adapter.initiateDeposit({ userId, amountKobo, currency: 'NGN' });
      const providerRef = `${ref.reference}:${depositId}`;
      await dbRun(
        'UPDATE cash_deposits SET provider_ref = ?, updated_at = ? WHERE id = ?',
        'UPDATE cash_deposits SET provider_ref = $1, updated_at = $2 WHERE id = $3',
        [providerRef, Date.now(), depositId]);

      await auditLog({
        actor: `user:${userId}`, action: 'deposit.initiate', entity: 'cash_deposits',
        entityId: depositId, detail: { amount_kobo: amountKobo, currency: 'NGN', provider_ref: providerRef },
      });

      res.json({
        deposit_id: depositId,
        provider_ref: providerRef,
        amount_kobo: amountKobo,
        currency: 'NGN',
        status: 'pending',
        mock_checkout: {
          reference: providerRef,
          instructions: 'MOCK — no real money moves. To simulate provider confirmation in tests, POST a signed mock webhook to /api/cash-wallet/deposit/mock-webhook with this provider_ref (see docs/CASH_API.md for the signature scheme).',
        },
      });
    } catch (e) { next(e); }
  });

  // ---- POST /deposit/mock-webhook ----
  // *** TEST-ONLY endpoint. *** Simulates the payment provider calling
  // back after a deposit settles. Protected by the test-only HMAC
  // scheme documented above (and in docs/CASH_API.md); it is NOT a
  // security boundary for real money. Still gated by authMiddleware +
  // requireCashOps like every other route.
  router.post('/deposit/mock-webhook', authMiddleware, requireCashOps, async (req, res, next) => {
    try {
      const body = req.body || {};
      const { provider_ref, status, amount_kobo, currency } = body;

      const fieldsOk =
        typeof provider_ref === 'string' && provider_ref.length > 0 &&
        typeof status === 'string' && status.length > 0 &&
        typeof amount_kobo === 'number' && Number.isSafeInteger(amount_kobo) &&
        typeof currency === 'string' && currency.length > 0;
      const sigOk = fieldsOk && validMockSignature(body);
      if (!sigOk) {
        await recordProviderEvent({
          provider: 'mock', eventType: 'deposit.webhook', providerRef: typeof provider_ref === 'string' ? provider_ref : null,
          payload: body, signatureValid: false, processed: false,
        });
        await auditLog({
          actor: `user:${req.userId}`, action: 'deposit.webhook.rejected', entity: 'provider_events',
          entityId: null, detail: { reason: 'invalid_signature', provider_ref: provider_ref || null },
        });
        return res.status(400).json({ error: 'Invalid webhook signature.' });
      }

      const r = await processDepositWebhookEvent({
        provider: 'mock',
        providerRef: provider_ref,
        status,
        amountKobo: amount_kobo,
        currency,
        rawPayload: body,
        actor: `user:${req.userId}`,
      });
      return res.status(r.status).json(r.body);
    } catch (e) { next(e); }
  });

  // ---- POST /deposit/webhook/:provider ----
  // Provider webhook endpoint (Milestone 8). NO user auth: provider
  // webhooks are signature-authenticated, not user-authenticated.
  // requireCashOps still gates it (403 while cash ops are off).
  //
  // RAW BODY: app.js configures express.json() with a verify() callback
  // that captures the raw request bytes on req.rawBody. Signature
  // verification MUST run on those exact bytes — never on a
  // re-serialized req.body. The payload is treated as UNTRUSTED until
  // the adapter's verifyWebhookSignature() accepts it.
  router.post('/deposit/webhook/:provider', requireCashOps, async (req, res, next) => {
    try {
      const name = String(req.params.provider || '').toLowerCase();
      let adapter;
      try {
        // Fail-closed: unknown provider names and non-mock providers
        // without credentials / cash ops enabled throw here — the
        // route never processes a webhook it cannot verify.
        adapter = adapterForName(name);
      } catch (e) {
        if (e instanceof ProviderNotConfiguredError) {
          return res.status(404).json({ error: `Unknown or unconfigured provider '${req.params.provider}'.` });
        }
        throw e;
      }

      const rawBody = Buffer.isBuffer(req.rawBody)
        ? req.rawBody
        : Buffer.from(JSON.stringify(req.body == null ? {} : req.body), 'utf8');
      const actor = `provider:${name}`;
      let secret = webhookSecretFor(name);
      if (name === 'mock' && !secret) secret = MOCK_WEBHOOK_SECRET_FALLBACK;

      let verified = false;
      try {
        verified = adapter.verifyWebhookSignature(rawBody, req.headers || {}, secret);
      } catch {
        verified = false;
      }
      if (!verified) {
        await recordProviderEvent({
          provider: name, eventType: 'deposit.webhook', providerRef: null,
          payload: rawBody.toString('utf8'), signatureValid: false, processed: false,
        });
        await auditLog({
          actor, action: 'deposit.webhook.rejected', entity: 'provider_events',
          entityId: null, detail: { reason: 'invalid_signature' },
        });
        return res.status(400).json({ error: 'Invalid webhook signature.' });
      }

      let event;
      try {
        event = adapter.parseWebhookEvent(rawBody);
      } catch {
        await recordProviderEvent({
          provider: name, eventType: 'deposit.webhook', providerRef: null,
          payload: rawBody.toString('utf8'), signatureValid: true, processed: false,
        });
        return res.status(400).json({ error: 'Unrecognized webhook event payload.' });
      }

      const r = await processDepositWebhookEvent({
        provider: name,
        providerRef: event.providerRef,
        status: event.status,
        amountKobo: event.amountKobo,
        currency: event.currency,
        rawPayload: rawBody.toString('utf8'),
        actor,
      });
      return res.status(r.status).json(r.body);
    } catch (e) { next(e); }
  });

  return router;
}
