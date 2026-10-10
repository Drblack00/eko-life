// ============================================================
// fintech/ledger.js — double-entry ledger engine for Èkó Life cash.
//
// SAFETY CONTRACT
// - ADDITIVE ONLY: never touches game tables or the gameplay-coins
//   economy. All state lives in the ledger_* / cash_wallets /
//   fee_policies tables (created by the fintech schema migration).
// - Integer kobo everywhere. No floats. Amounts must be positive
//   safe integers; commission math uses BigInt internally.
// - Every journal post (postJournal / reverseJournal) runs inside ONE
//   dbTransaction: journal row + entry rows + wallet updates commit or
//   roll back together. Transactions are serialized by db.js so
//   concurrent posts can never interleave on one backend connection.
// - Posted rows are NEVER edited or deleted. Corrections go through
//   reverseJournal, which posts a NEW mirrored journal and only flips
//   the original's status to 'reversed'.
// - Live money stays OFF: this engine records obligations/balances;
//   actual cash movement is gated by config.requireCashOps and only
//   ever touches mockProvider.js (MOCK) until a real provider is
//   approved and CASH_OPS_ENABLED=true.
//
// Schema contract (Worker A migration):
//   ledger_accounts(id, code UNIQUE, name, kind)
//   ledger_journals(id, journal_key UNIQUE, type, status, user_id,
//                   related_journal_id, provider_ref UNIQUE-ignoring-null,
//                   currency='NGN', memo, metadata JSON-text,
//                   created_at, posted_at)
//   ledger_entries(id, journal_id FK, account_id FK,
//                  side IN ('debit','credit'), amount_kobo >= 0,
//                  currency='NGN', created_at)
//   cash_wallets(user_id PK FK users, available_kobo >= 0,
//                reserved_kobo >= 0, currency='NGN', updated_at)
//   fee_policies(version PK, rate_bps, rounding, applies_from,
//                memo, created_at)
// ============================================================
import { dbRun, dbGet, dbAll, dbMode, dbTransaction } from '../db.js';

// Customer-balance accounts and the wallet column each one moves.
// credit to the account increases the column; debit decreases it.
const CUSTOMER_ACCOUNTS = {
  customer_available: 'available_kobo',
  customer_reserved: 'reserved_kobo',
};

// ---------- error taxonomy ----------
export class LedgerError extends Error {}
export class LedgerValidationError extends LedgerError {
  constructor(message) {
    super(message);
    this.name = 'LedgerValidationError';
  }
}
export class UnbalancedJournalError extends LedgerError {
  constructor(debits, credits) {
    super(`Unbalanced journal: debits ${debits} kobo != credits ${credits} kobo`);
    this.name = 'UnbalancedJournalError';
    this.debits = debits;
    this.credits = credits;
  }
}
export class InsufficientFundsError extends LedgerError {
  constructor(column, haveKobo, needKobo) {
    super(`Insufficient ${column} funds: have ${haveKobo} kobo, need ${needKobo} kobo`);
    this.name = 'InsufficientFundsError';
    this.column = column;
    this.haveKobo = haveKobo;
    this.needKobo = needKobo;
  }
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

// code -> { id, code } for every ledger account.
async function loadAccountMap() {
  const all = await dbAll(
    'SELECT id, code FROM ledger_accounts',
    'SELECT id, code FROM ledger_accounts',
    []);
  const map = new Map();
  for (const r of all) map.set(r.code, { id: Number(r.id), code: r.code });
  return map;
}

function assertValidEntries(entries) {
  if (!Array.isArray(entries) || entries.length < 2) {
    throw new LedgerValidationError('a journal requires at least 2 entries');
  }
  for (const e of entries) {
    if (!e || typeof e.accountCode !== 'string' || !e.accountCode) {
      throw new LedgerValidationError('every entry needs an accountCode');
    }
    if (e.side !== 'debit' && e.side !== 'credit') {
      throw new LedgerValidationError(`entry side must be 'debit' or 'credit' (got ${String(e.side)})`);
    }
    if (!Number.isSafeInteger(e.amountKobo) || e.amountKobo <= 0) {
      throw new LedgerValidationError(
        `amountKobo must be a positive safe integer (got ${String(e.amountKobo)})`);
    }
  }
}

function journalNeedsWallet(entries) {
  return entries.some(e =>
    e.accountCode === 'customer_available' || e.accountCode === 'customer_reserved');
}

// Load the user's wallet row, auto-creating it at zero balances.
async function ensureWallet(userId, now) {
  let w = await dbGet(
    'SELECT * FROM cash_wallets WHERE user_id = ?',
    'SELECT * FROM cash_wallets WHERE user_id = $1',
    [userId]);
  if (!w) {
    await dbRun(
      `INSERT INTO cash_wallets (user_id, available_kobo, reserved_kobo, currency, updated_at)
       VALUES (?, 0, 0, 'NGN', ?) ON CONFLICT(user_id) DO NOTHING`,
      `INSERT INTO cash_wallets (user_id, available_kobo, reserved_kobo, currency, updated_at)
       VALUES ($1, 0, 0, 'NGN', $2) ON CONFLICT(user_id) DO NOTHING`,
      [userId, now]);
    w = await dbGet(
      'SELECT * FROM cash_wallets WHERE user_id = ?',
      'SELECT * FROM cash_wallets WHERE user_id = $1',
      [userId]);
  }
  return w;
}

function normJournal(r) {
  if (!r) return null;
  let metadata = null;
  if (r.metadata != null && r.metadata !== '') {
    try { metadata = JSON.parse(r.metadata); } catch { metadata = null; }
  }
  return {
    id: Number(r.id),
    journalKey: r.journal_key,
    type: r.type,
    status: r.status,
    userId: r.user_id == null ? null : Number(r.user_id),
    relatedJournalId: r.related_journal_id == null ? null : Number(r.related_journal_id),
    providerRef: r.provider_ref || null,
    currency: r.currency || 'NGN',
    memo: r.memo || null,
    metadata,
    createdAt: Number(r.created_at),
    postedAt: r.posted_at == null ? null : Number(r.posted_at),
  };
}

// Core posting logic. MUST be called inside dbTransaction().
async function postJournalTx({ journalKey, type, userId, entries, memo, metadata, providerRef, relatedJournalId = null, accountMap }) {
  // Idempotent replay: the key already exists -> return it, post nothing.
  const existing = await getJournal(journalKey);
  if (existing) return { journal: existing, entries: await getJournalEntries(existing.id) };

  const now = Date.now();
  let wallet = null;
  let dAvail = 0;
  let dRes = 0;
  if (journalNeedsWallet(entries)) {
    wallet = await ensureWallet(userId, now);
    for (const e of entries) {
      const delta = e.side === 'credit' ? e.amountKobo : -e.amountKobo;
      if (e.accountCode === 'customer_available') dAvail += delta;
      else if (e.accountCode === 'customer_reserved') dRes += delta;
    }
    const newAvail = Number(wallet.available_kobo) + dAvail;
    const newRes = Number(wallet.reserved_kobo) + dRes;
    if (newAvail < 0) {
      throw new InsufficientFundsError('available', Number(wallet.available_kobo), -dAvail);
    }
    if (newRes < 0) {
      throw new InsufficientFundsError('reserved', Number(wallet.reserved_kobo), -dRes);
    }
  }

  const journalId = await insertReturningId(
    `INSERT INTO ledger_journals
       (journal_key, type, status, user_id, related_journal_id, provider_ref,
        currency, memo, metadata, created_at, posted_at)
     VALUES (?, ?, 'posted', ?, ?, ?, 'NGN', ?, ?, ?, ?)`,
    `INSERT INTO ledger_journals
       (journal_key, type, status, user_id, related_journal_id, provider_ref,
        currency, memo, metadata, created_at, posted_at)
     VALUES ($1, $2, 'posted', $3, $4, $5, 'NGN', $6, $7, $8, $9) RETURNING id`,
    [journalKey, type, userId, relatedJournalId, providerRef,
     memo, metadata == null ? null : JSON.stringify(metadata), now, now]);

  for (const e of entries) {
    const accountId = accountMap.get(e.accountCode).id;
    await insertReturningId(
      `INSERT INTO ledger_entries
         (journal_id, account_id, side, amount_kobo, currency, created_at)
       VALUES (?, ?, ?, ?, 'NGN', ?)`,
      `INSERT INTO ledger_entries
         (journal_id, account_id, side, amount_kobo, currency, created_at)
       VALUES ($1, $2, $3, $4, 'NGN', $5) RETURNING id`,
      [journalId, accountId, e.side, e.amountKobo, now]);
  }

  if (wallet) {
    const newAvail = Number(wallet.available_kobo) + dAvail;
    const newRes = Number(wallet.reserved_kobo) + dRes;
    await dbRun(
      'UPDATE cash_wallets SET available_kobo = ?, reserved_kobo = ?, updated_at = ? WHERE user_id = ?',
      'UPDATE cash_wallets SET available_kobo = $1, reserved_kobo = $2, updated_at = $3 WHERE user_id = $4',
      [newAvail, newRes, now, userId]);
  }

  return { journal: await getJournal(journalKey), entries: await getJournalEntries(journalId) };
}

// ---------- public API ----------

// Post a balanced double-entry journal atomically.
// entries: [{ accountCode, side: 'debit'|'credit', amountKobo }]
// Idempotent on journalKey: replaying the same key returns the already-
// posted journal (with its entries) and posts nothing new.
// Throws: LedgerValidationError, UnbalancedJournalError,
//         InsufficientFundsError. Throws post NOTHING (tx rolls back).
export async function postJournal({ journalKey, type, userId = null, entries, memo = null, metadata = null, providerRef = null }) {
  if (typeof journalKey !== 'string' || !journalKey) {
    throw new LedgerValidationError('journalKey is required');
  }
  if (typeof type !== 'string' || !type) {
    throw new LedgerValidationError('journal type is required');
  }
  assertValidEntries(entries);
  const accountMap = await loadAccountMap();
  for (const e of entries) {
    if (!accountMap.has(e.accountCode)) {
      throw new LedgerValidationError(`unknown ledger account code: ${e.accountCode}`);
    }
  }
  if (journalNeedsWallet(entries) && (userId === null || userId === undefined)) {
    throw new LedgerValidationError('userId is required when a journal touches customer accounts');
  }
  let debits = 0n;
  let credits = 0n;
  for (const e of entries) {
    if (e.side === 'debit') debits += BigInt(e.amountKobo);
    else credits += BigInt(e.amountKobo);
  }
  if (debits !== credits) throw new UnbalancedJournalError(debits.toString(), credits.toString());

  return dbTransaction(() => postJournalTx({
    journalKey, type, userId, entries, memo, metadata, providerRef, accountMap,
  }));
}

// Reverse a posted journal. NEVER edits/deletes posted rows: posts a NEW
// 'reversal' journal with mirrored entries (debit<->credit) and flips only
// the original's status to 'reversed'. Throws if the original is missing,
// not 'posted', or already reversed. The reversal restores wallet balances
// through the same atomic wallet logic as postJournal (a reversal that
// would drive a wallet negative throws InsufficientFundsError).
export async function reverseJournal(journalId, { reason, actor = 'system' } = {}) {
  if (!reason || typeof reason !== 'string') {
    throw new LedgerValidationError('a reversal reason is required');
  }
  const id = Number(journalId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new LedgerValidationError('journalId must be a positive integer');
  }
  return dbTransaction(async () => {
    const orig = await dbGet(
      'SELECT * FROM ledger_journals WHERE id = ?',
      'SELECT * FROM ledger_journals WHERE id = $1',
      [id]);
    if (!orig) throw new LedgerValidationError(`journal ${id} not found`);
    if (orig.status !== 'posted') {
      throw new LedgerValidationError(
        `journal ${id} cannot be reversed (status is '${orig.status}', must be 'posted')`);
    }
    const origEntries = await getJournalEntries(id);
    const mirrored = origEntries.map(e => ({
      accountCode: e.accountCode,
      side: e.side === 'debit' ? 'credit' : 'debit',
      amountKobo: e.amountKobo,
    }));
    const accountMap = await loadAccountMap();
    const revKey = `reversal:${orig.journal_key}:${Date.now()}`;
    const rev = await postJournalTx({
      journalKey: revKey,
      type: 'reversal',
      userId: orig.user_id == null ? null : Number(orig.user_id),
      entries: mirrored,
      memo: `Reversal of journal ${orig.id} (${orig.journal_key}): ${reason}`,
      metadata: {
        reason,
        actor,
        reverses_journal_id: Number(orig.id),
        reverses_journal_key: orig.journal_key,
      },
      providerRef: null,
      relatedJournalId: Number(orig.id),
      accountMap,
    });
    await dbRun(
      "UPDATE ledger_journals SET status = 'reversed' WHERE id = ?",
      "UPDATE ledger_journals SET status = 'reversed' WHERE id = $1",
      [id]);
    return rev;
  });
}

// Read helpers.
export async function getJournal(journalKey) {
  const r = await dbGet(
    'SELECT * FROM ledger_journals WHERE journal_key = ?',
    'SELECT * FROM ledger_journals WHERE journal_key = $1',
    [journalKey]);
  return normJournal(r);
}

export async function getJournalEntries(journalId) {
  const rows = await dbAll(
    `SELECT e.id, e.journal_id, e.account_id, a.code AS account_code,
            e.side, e.amount_kobo, e.currency, e.created_at
     FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
     WHERE e.journal_id = ? ORDER BY e.id`,
    `SELECT e.id, e.journal_id, e.account_id, a.code AS account_code,
            e.side, e.amount_kobo, e.currency, e.created_at
     FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
     WHERE e.journal_id = $1 ORDER BY e.id`,
    [journalId]);
  return rows.map(r => ({
    id: Number(r.id),
    journalId: Number(r.journal_id),
    accountId: Number(r.account_id),
    accountCode: r.account_code,
    side: r.side,
    amountKobo: Number(r.amount_kobo),
    currency: r.currency || 'NGN',
    createdAt: Number(r.created_at),
  }));
}

// ---------- commissions ----------

// Pure commission calculator.
//
// Rounding policy (documented): ROUND HALF UP to the nearest kobo.
//   commission = floor((grossKobo * rate_bps + 5000) / 10000)
// The +5000/10000 term pushes an exact .5 kobo remainder up to the next
// kobo (inputs are non-negative, so truncation == floor). All math runs
// on BigInt; results are returned as plain integer Numbers (never floats).
//
// policy: { rate_bps (or rateBps), rounding, version? }. Only 'half_up'
// rounding is supported — any other policy.rounding value throws.
export function commissionFor(grossKobo, policy) {
  if (!Number.isSafeInteger(grossKobo) || grossKobo < 0) {
    throw new LedgerValidationError(`grossKobo must be a non-negative safe integer (got ${String(grossKobo)})`);
  }
  if (!policy || typeof policy !== 'object') {
    throw new LedgerValidationError('a fee policy object is required');
  }
  const rateBps = policy.rate_bps !== undefined ? policy.rate_bps : policy.rateBps;
  if (!Number.isSafeInteger(rateBps) || rateBps < 0) {
    throw new LedgerValidationError(`policy rate_bps must be a non-negative safe integer (got ${String(rateBps)})`);
  }
  const rounding = policy.rounding || 'half_up';
  if (rounding !== 'half_up') {
    throw new LedgerValidationError(`unsupported rounding policy: ${rounding} (only 'half_up' is supported)`);
  }
  const commissionKobo = Number((BigInt(grossKobo) * BigInt(rateBps) + 5000n) / 10000n);
  return {
    grossKobo,
    commissionKobo,
    netKobo: grossKobo - commissionKobo,
    rateBps,
    policyVersion: policy.version !== undefined && policy.version !== null ? Number(policy.version) : null,
  };
}

// Load a fee policy by version. Throws LedgerValidationError if missing.
export async function getFeePolicy(version) {
  const v = Number(version);
  if (!Number.isSafeInteger(v) || v <= 0) {
    throw new LedgerValidationError(`fee policy version must be a positive integer (got ${String(version)})`);
  }
  const r = await dbGet(
    'SELECT * FROM fee_policies WHERE version = ?',
    'SELECT * FROM fee_policies WHERE version = $1',
    [v]);
  if (!r) throw new LedgerValidationError(`fee policy version ${v} not found`);
  return {
    version: Number(r.version),
    rateBps: Number(r.rate_bps),
    rate_bps: Number(r.rate_bps),
    rounding: r.rounding,
    appliesFrom: r.applies_from == null ? null : Number(r.applies_from),
    memo: r.memo || null,
    createdAt: Number(r.created_at),
  };
}

// Customer cash balance. Zeros when the user has no wallet row yet.
export async function getCashBalance(userId) {
  const w = await dbGet(
    'SELECT available_kobo, reserved_kobo, currency FROM cash_wallets WHERE user_id = ?',
    'SELECT available_kobo, reserved_kobo, currency FROM cash_wallets WHERE user_id = $1',
    [userId]);
  if (!w) return { availableKobo: 0, reservedKobo: 0, currency: 'NGN' };
  return {
    availableKobo: Number(w.available_kobo),
    reservedKobo: Number(w.reserved_kobo),
    currency: w.currency || 'NGN',
  };
}

export { CUSTOMER_ACCOUNTS };
