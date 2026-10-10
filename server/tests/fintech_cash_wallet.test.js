// Cash-wallet API tests (M5 / Milestone 6a): cash-wallet router —
// balance, history, deposit initiate, and the MOCK deposit webhook.
//
// All amounts are integer kobo. Mock provider only — no live
// credentials, no real money. In-memory SQLite via EKO_DB_PATH.
//
// The first test boots the real createApp() to prove the fintech
// seeding is wired into the server boot path (src/app.js); the REST
// tests then run against a fresh in-memory DB with the router mounted
// at /api/cash-wallet (the coordinator's mount path).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';

process.env.SESSION_SECRET = 'test-secret-only-not-production';
process.env.EKO_DB_PATH = ':memory:';
delete process.env.CASH_OPS_ENABLED;
process.env.MOCK_WEBHOOK_SECRET = 'test-webhook-secret';

const db = await import('../src/db.js');
const { createApp } = await import('../src/app.js');
const { createCashWalletRouter, signMockWebhook } = await import('../src/routes/cashWallet.js');
const { signToken } = await import('../src/auth.js');
const ledger = await import('../src/fintech/ledger.js');

const SECRET = process.env.MOCK_WEBHOOK_SECRET;

let base;
let userA, userB, tokA, tokB;
let seq = 0;
async function makeUser() {
  seq++;
  return db.createUser({ username: `cw_test_u${seq}_${Date.now()}`, is_guest: true });
}

async function post(p, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}
async function get(p, token) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(base + p, { headers });
  return { status: r.status, json: await r.json() };
}

// Build a valid mock webhook body for a deposit response.
function signedWebhook({ provider_ref, status, amount_kobo, currency }) {
  const body = { provider_ref, status, amount_kobo, currency };
  body.signature = crypto.createHmac('sha256', SECRET)
    .update(`${provider_ref}|${status}|${amount_kobo}|${currency}`).digest('hex');
  return body;
}

async function journalCount() {
  const r = await db.dbGet('SELECT COUNT(*) AS c FROM ledger_journals', 'SELECT COUNT(*) AS c FROM ledger_journals', []);
  return Number(r.c);
}
async function providerEventCount() {
  const r = await db.dbGet('SELECT COUNT(*) AS c FROM provider_events', 'SELECT COUNT(*) AS c FROM provider_events', []);
  return Number(r.c);
}

// ---------- boot wiring + REST harness ----------
// NOTE on ordering: the boot check runs FIRST inside this before-hook.
// createApp() calls initDb(), which (re)creates the in-memory DB —
// calling it again later would wipe the test users, so it happens
// exactly once here and the REST harness reuses the same DB.
let server;
test.before(async () => {
  // 1. Boot-wiring check: the real createApp() must seed the fintech
  //    foundation (chart of accounts + fee policy v1) via src/app.js.
  const bootApp = await createApp();
  try {
    const accts = await db.dbAll('SELECT code FROM ledger_accounts', 'SELECT code FROM ledger_accounts', []);
    assert.equal(accts.length, 8, 'chart of accounts seeded on boot');
    const p1 = await ledger.getFeePolicy(1);
    assert.equal(p1.rateBps, 1000, 'fee policy v1 seeded on boot');
    // Idempotent: a re-seed must not duplicate rows (seed uses
    // INSERT OR IGNORE / ON CONFLICT DO NOTHING).
    const { ensureChartOfAccounts, ensureFeePolicyV1 } = await import('../src/fintech/seed.js');
    await ensureChartOfAccounts();
    await ensureFeePolicyV1();
    const after = await db.dbAll('SELECT code FROM ledger_accounts', 'SELECT code FROM ledger_accounts', []);
    assert.equal(after.length, 8, 're-seed must not duplicate accounts');
  } finally {
    await bootApp.close();
  }

  // 2. REST harness: mount the router at /api/cash-wallet (the
  //    coordinator's mount path) on the same in-memory DB — no second
  //    initDb() here, that would wipe the users created below.
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  app.use('/api/cash-wallet', createCashWalletRouter());
  // Mirror app.js: never leak stacks to clients.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[500]', err && err.message);
    res.status(500).json({ error: 'Something went wrong.' });
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  userA = await makeUser();
  userB = await makeUser();
  tokA = signToken(userA);
  tokB = signToken(userB);
});
test.after(async () => {
  delete process.env.CASH_OPS_ENABLED;
  await new Promise((resolve) => server.close(resolve));
});

// ---------- 403 while the flag is off ----------
test('403 on every route while CASH_OPS_ENABLED is unset', async () => {
  delete process.env.CASH_OPS_ENABLED;
  for (const [method, path, body] of [
    ['GET', '/api/cash-wallet/balance', null],
    ['GET', '/api/cash-wallet/history', null],
    ['POST', '/api/cash-wallet/deposit/initiate', { amount_kobo: 50000 }],
    ['POST', '/api/cash-wallet/deposit/mock-webhook', { provider_ref: 'x', status: 'confirmed', amount_kobo: 1, currency: 'NGN', signature: 'x' }],
  ]) {
    const r = method === 'GET' ? await get(path, tokA) : await post(path, body, tokA);
    assert.equal(r.status, 403, `${method} ${path} must 403 while flag is off`);
    assert.deepEqual(r.json, { error: 'Cash operations are disabled.' });
  }
  process.env.CASH_OPS_ENABLED = 'true';
});

// ---------- auth gate ----------
test('401 without a bearer token', async () => {
  const r = await get('/api/cash-wallet/balance', null);
  assert.equal(r.status, 401);
});

// ---------- balance / history on a fresh user ----------
test('fresh user: zero balance, empty history', async () => {
  const b = await get('/api/cash-wallet/balance', tokA);
  assert.equal(b.status, 200);
  assert.deepEqual(b.json, { available_kobo: 0, reserved_kobo: 0, currency: 'NGN' });

  const h = await get('/api/cash-wallet/history', tokA);
  assert.equal(h.status, 200);
  assert.deepEqual(h.json.journals, []);
  assert.equal(h.json.limit, 50);
  assert.equal(h.json.offset, 0);
});

// ---------- deposit initiate: validation ----------
test('deposit/initiate rejects invalid amounts and wrong currency', async () => {
  for (const bad of [0, -100, 10.5, NaN, '50000', null, undefined, Infinity]) {
    const r = await post('/api/cash-wallet/deposit/initiate', { amount_kobo: bad }, tokA);
    assert.equal(r.status, 400, `amount ${String(bad)} must be rejected`);
  }
  // Under-min (₦100 = 10000 kobo) and over-max (₦1,000,000 = 100000000 kobo).
  for (const bad of [9999, 1, 100000001, 1000000000]) {
    const r = await post('/api/cash-wallet/deposit/initiate', { amount_kobo: bad }, tokA);
    assert.equal(r.status, 400, `amount ${bad} outside [10000, 100000000] must be rejected`);
  }
  // Boundary values are accepted.
  for (const good of [10000, 100000000]) {
    const r = await post('/api/cash-wallet/deposit/initiate', { amount_kobo: good }, tokA);
    assert.equal(r.status, 200, `boundary amount ${good} must be accepted`);
    assert.equal(r.json.amount_kobo, good);
  }
  // Wrong currency rejected; absent or NGN accepted.
  const wrong = await post('/api/cash-wallet/deposit/initiate', { amount_kobo: 50000, currency: 'USD' }, tokA);
  assert.equal(wrong.status, 400);
  const ngn = await post('/api/cash-wallet/deposit/initiate', { amount_kobo: 50000, currency: 'NGN' }, tokA);
  assert.equal(ngn.status, 200);
  assert.equal(ngn.json.currency, 'NGN');
});

// ---------- deposit initiate: shape + pending not spendable ----------
let depA; // shared deposit for user A
test('deposit/initiate returns a pending deposit; balance unchanged until confirmed', async () => {
  const r = await post('/api/cash-wallet/deposit/initiate', { amount_kobo: 75000 }, tokA);
  assert.equal(r.status, 200);
  depA = r.json;
  assert.ok(Number.isSafeInteger(depA.deposit_id) && depA.deposit_id > 0);
  assert.ok(typeof depA.provider_ref === 'string' && depA.provider_ref.startsWith('MOCK-DEP-'));
  assert.equal(depA.amount_kobo, 75000);
  assert.equal(depA.currency, 'NGN');
  assert.equal(depA.status, 'pending');
  assert.ok(depA.mock_checkout);
  assert.equal(depA.mock_checkout.reference, depA.provider_ref);
  assert.match(depA.mock_checkout.instructions, /MOCK/i);

  // Pending deposit is NOT spendable: the ledger balance is untouched.
  const b = await get('/api/cash-wallet/balance', tokA);
  assert.deepEqual(b.json, { available_kobo: 0, reserved_kobo: 0, currency: 'NGN' });
  const row = await db.dbGet(
    'SELECT status, journal_key FROM cash_deposits WHERE id = ?',
    'SELECT status, journal_key FROM cash_deposits WHERE id = $1', [depA.deposit_id]);
  assert.equal(row.status, 'pending');
  assert.equal(row.journal_key, `deposit:init:${depA.deposit_id}`);
  // Audit trail written.
  const audit = await db.dbGet(
    "SELECT action, entity FROM fintech_audit_logs WHERE entity = 'cash_deposits' AND entity_id = ?",
    "SELECT action, entity FROM fintech_audit_logs WHERE entity = 'cash_deposits' AND entity_id = $1",
    [String(depA.deposit_id)]);
  assert.equal(audit.action, 'deposit.initiate');
});

// ---------- webhook: bad signature / unknown ref / mismatch ----------
test('webhook: bad signature rejected and recorded (signature_valid=0)', async () => {
  const before = await providerEventCount();
  const body = signedWebhook({
    provider_ref: depA.provider_ref, status: 'confirmed',
    amount_kobo: depA.amount_kobo, currency: 'NGN',
  });
  body.signature = 'deadbeef';
  const r = await post('/api/cash-wallet/deposit/mock-webhook', body, tokA);
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'Invalid webhook signature.');
  const ev = await db.dbGet(
    'SELECT signature_valid, processed FROM provider_events ORDER BY id DESC LIMIT 1',
    'SELECT signature_valid, processed FROM provider_events ORDER BY id DESC LIMIT 1', []);
  assert.equal(Number(ev.signature_valid), 0);
  assert.equal(Number(ev.processed), 0);
  assert.equal(await providerEventCount(), before + 1);
  // Nothing credited.
  assert.equal((await ledger.getCashBalance(userA)).availableKobo, 0);
});

test('webhook: unknown provider_ref -> 404, no credit', async () => {
  const r = await post('/api/cash-wallet/deposit/mock-webhook', signedWebhook({
    provider_ref: 'MOCK-DEP-NOPE:999', status: 'confirmed', amount_kobo: 75000, currency: 'NGN',
  }), tokA);
  assert.equal(r.status, 404);
});

test('webhook: amount/currency mismatch -> 400, no credit', async () => {
  for (const tampered of [
    { amount_kobo: 75001, currency: 'NGN' },
    { amount_kobo: 75000, currency: 'USD' },
  ]) {
    const r = await post('/api/cash-wallet/deposit/mock-webhook', signedWebhook({
      provider_ref: depA.provider_ref, status: 'confirmed',
      amount_kobo: tampered.amount_kobo, currency: tampered.currency,
    }), tokA);
    assert.equal(r.status, 400);
    assert.match(r.json.error, /does not match/);
  }
  assert.equal((await ledger.getCashBalance(userA)).availableKobo, 0);
});

// ---------- webhook: confirm credits exactly once under duplicate delivery ----------
test('webhook confirm: credited exactly once under duplicate webhooks', async () => {
  const body = () => signedWebhook({
    provider_ref: depA.provider_ref, status: 'confirmed',
    amount_kobo: depA.amount_kobo, currency: 'NGN',
  });
  const jcBefore = await journalCount();

  const first = await post('/api/cash-wallet/deposit/mock-webhook', body(), tokA);
  assert.equal(first.status, 200);
  assert.equal(first.json.status, 'confirmed');
  assert.equal(first.json.amount_kobo, 75000);
  assert.equal(first.json.available_kobo, 75000);
  assert.ok(first.json.confirmed_at > 0);
  assert.equal(first.json.journal_key, `deposit:init:${depA.deposit_id}`);
  assert.equal(first.json.duplicate, undefined);

  // Duplicate delivery: same receipt, no new journal, balance unchanged.
  const second = await post('/api/cash-wallet/deposit/mock-webhook', body(), tokA);
  assert.equal(second.status, 200);
  assert.equal(second.json.status, 'confirmed');
  assert.equal(second.json.available_kobo, 75000);
  assert.equal(second.json.duplicate, true);

  const third = await post('/api/cash-wallet/deposit/mock-webhook', body(), tokA);
  assert.equal(third.status, 200);

  assert.equal(await journalCount(), jcBefore + 1, 'exactly one journal posted for three deliveries');
  assert.equal((await ledger.getCashBalance(userA)).availableKobo, 75000);

  // Confirm journal is a balanced deposit: debit deposit_processing / credit customer_available.
  const j = await ledger.getJournal(`deposit:confirm:${depA.provider_ref}`);
  assert.equal(j.type, 'deposit');
  assert.equal(j.status, 'posted');
  const entries = await ledger.getJournalEntries(j.id);
  assert.equal(entries.length, 2);
  const byCode = Object.fromEntries(entries.map((e) => [e.accountCode, e]));
  assert.equal(byCode.deposit_processing.side, 'debit');
  assert.equal(byCode.deposit_processing.amountKobo, 75000);
  assert.equal(byCode.customer_available.side, 'credit');
  assert.equal(byCode.customer_available.amountKobo, 75000);
});

// ---------- webhook: failed / expired -> no credit ----------
test('webhook failed/expired: status updated, no credit', async () => {
  const init = await post('/api/cash-wallet/deposit/initiate', { amount_kobo: 20000 }, tokA);
  const failed = await post('/api/cash-wallet/deposit/mock-webhook', signedWebhook({
    provider_ref: init.json.provider_ref, status: 'failed',
    amount_kobo: 20000, currency: 'NGN',
  }), tokA);
  assert.equal(failed.status, 200);
  assert.equal(failed.json.status, 'failed');

  const init2 = await post('/api/cash-wallet/deposit/initiate', { amount_kobo: 30000 }, tokA);
  const expired = await post('/api/cash-wallet/deposit/mock-webhook', signedWebhook({
    provider_ref: init2.json.provider_ref, status: 'expired',
    amount_kobo: 30000, currency: 'NGN',
  }), tokA);
  assert.equal(expired.status, 200);
  assert.equal(expired.json.status, 'expired');

  // A failed deposit can never be confirmed later.
  const late = await post('/api/cash-wallet/deposit/mock-webhook', signedWebhook({
    provider_ref: init.json.provider_ref, status: 'confirmed',
    amount_kobo: 20000, currency: 'NGN',
  }), tokA);
  assert.equal(late.status, 400);

  // And a confirmed deposit cannot be failed/expired — only refunded.
  const bad = await post('/api/cash-wallet/deposit/mock-webhook', signedWebhook({
    provider_ref: depA.provider_ref, status: 'failed',
    amount_kobo: depA.amount_kobo, currency: 'NGN',
  }), tokA);
  assert.equal(bad.status, 400);

  assert.equal((await ledger.getCashBalance(userA)).availableKobo, 75000, 'failed/expired never credit');
});

// ---------- webhook: refund after confirm reverses via a reversal journal ----------
test('webhook refunded: reverses the confirm journal, balance returns to zero', async () => {
  const r = await post('/api/cash-wallet/deposit/mock-webhook', signedWebhook({
    provider_ref: depA.provider_ref, status: 'refunded',
    amount_kobo: depA.amount_kobo, currency: 'NGN',
  }), tokA);
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'refunded');
  assert.equal(r.json.available_kobo, 0);

  // The original confirm journal is untouched except for its status;
  // a NEW reversal journal carries the mirrored entries.
  const orig = await ledger.getJournal(`deposit:confirm:${depA.provider_ref}`);
  assert.equal(orig.status, 'reversed');
  const revRow = await db.dbGet(
    'SELECT * FROM ledger_journals WHERE type = ? AND related_journal_id = ?',
    'SELECT * FROM ledger_journals WHERE type = $1 AND related_journal_id = $2',
    ['reversal', orig.id]);
  assert.ok(revRow, 'a reversal journal was posted');
  const revEntries = await ledger.getJournalEntries(Number(revRow.id));
  const byCode = Object.fromEntries(revEntries.map((e) => [e.accountCode, e]));
  assert.equal(byCode.customer_available.side, 'debit');
  assert.equal(byCode.customer_available.amountKobo, 75000);
  assert.equal(byCode.deposit_processing.side, 'credit');

  // Replay of the refund is a no-op (no second reversal).
  const jc = await journalCount();
  const replay = await post('/api/cash-wallet/deposit/mock-webhook', signedWebhook({
    provider_ref: depA.provider_ref, status: 'refunded',
    amount_kobo: depA.amount_kobo, currency: 'NGN',
  }), tokA);
  assert.equal(replay.status, 200);
  assert.equal(replay.json.status, 'refunded');
  assert.equal(await journalCount(), jc, 'refund replay posts nothing new');
  assert.equal((await ledger.getCashBalance(userA)).availableKobo, 0);
});

// ---------- history: entries, newest-first, pagination ----------
test('history: journals newest-first with entries; pagination works', async () => {
  // Build 3 fresh confirmed deposits for user B (user A is now refunded to 0).
  const refs = [];
  for (const amt of [11111, 22222, 33333]) {
    const init = await post('/api/cash-wallet/deposit/initiate', { amount_kobo: amt }, tokB);
    assert.equal(init.status, 200);
    const conf = await post('/api/cash-wallet/deposit/mock-webhook', signedWebhook({
      provider_ref: init.json.provider_ref, status: 'confirmed',
      amount_kobo: amt, currency: 'NGN',
    }), tokB);
    assert.equal(conf.status, 200);
    refs.push(init.json.provider_ref);
  }

  const page1 = await get('/api/cash-wallet/history?limit=2&offset=0', tokB);
  assert.equal(page1.status, 200);
  assert.equal(page1.json.journals.length, 2);
  assert.equal(page1.json.limit, 2);
  assert.equal(page1.json.offset, 0);
  // Newest first: 33333's journal before 22222's.
  assert.equal(page1.json.journals[0].provider_ref, refs[2]);
  assert.equal(page1.json.journals[1].provider_ref, refs[1]);
  for (const j of page1.json.journals) {
    assert.equal(j.type, 'deposit');
    assert.equal(j.status, 'posted');
    assert.ok(typeof j.journal_key === 'string');
    assert.ok(typeof j.memo === 'string');
    assert.ok(Number.isSafeInteger(j.created_at));
    assert.equal(j.entries.length, 2);
    for (const e of j.entries) {
      assert.ok(e.side === 'debit' || e.side === 'credit');
      assert.ok(Number.isSafeInteger(e.amount_kobo));
      assert.ok(typeof e.account_code === 'string');
    }
  }

  const page2 = await get('/api/cash-wallet/history?limit=2&offset=2', tokB);
  assert.equal(page2.json.journals.length, 1);
  assert.equal(page2.json.journals[0].provider_ref, refs[0]);
  assert.equal(page2.json.offset, 2);

  const page3 = await get('/api/cash-wallet/history?limit=2&offset=99', tokB);
  assert.deepEqual(page3.json.journals, []);

  // Bad paging values fall back to sane defaults instead of erroring.
  const def = await get('/api/cash-wallet/history?limit=abc&offset=-5', tokB);
  assert.equal(def.json.limit, 50);
  assert.equal(def.json.offset, 0);
  assert.equal(def.json.journals.length, 3);
});

// ---------- user isolation ----------
test('no cross-user reads: user_id is never honored, always req.userId', async () => {
  // User A's balance is 0 (refunded); user B holds 66666.
  const bBal = await get('/api/cash-wallet/balance', tokB);
  assert.equal(bBal.json.available_kobo, 11111 + 22222 + 33333);

  // A ?user_id=<B> query string must be ignored — A still sees only A's data.
  const spoofed = await get(`/api/cash-wallet/balance?user_id=${userB}`, tokA);
  assert.equal(spoofed.status, 200);
  assert.equal(spoofed.json.available_kobo, 0);

  const hSpoofed = await get(`/api/cash-wallet/history?user_id=${userB}`, tokA);
  assert.equal(hSpoofed.status, 200);
  const bRefs = new Set((await get('/api/cash-wallet/history', tokB)).json.journals.map((j) => j.provider_ref));
  for (const j of hSpoofed.json.journals) {
    assert.ok(!bRefs.has(j.provider_ref), "A must never see B's journals");
  }
});

// ---------- audit trail completeness ----------
test('every webhook is recorded in provider_events with signature_valid + processed flags', async () => {
  const rows = await db.dbAll(
    'SELECT signature_valid, processed FROM provider_events ORDER BY id',
    'SELECT signature_valid, processed FROM provider_events ORDER BY id', []);
  assert.ok(rows.length >= 10, `expected a trail of webhook events, got ${rows.length}`);
  for (const r of rows) {
    assert.ok(Number(r.signature_valid) === 0 || Number(r.signature_valid) === 1);
    assert.ok(Number(r.processed) === 0 || Number(r.processed) === 1);
  }
  const validCount = rows.filter((r) => Number(r.signature_valid) === 1).length;
  const invalidCount = rows.filter((r) => Number(r.signature_valid) === 0).length;
  assert.ok(validCount > 0 && invalidCount > 0, 'trail contains both valid and invalid signatures');
});

// ---------- safety: signMockWebhook matches the router's check ----------
test('exported signMockWebhook produces signatures the router accepts', async () => {
  const init = await post('/api/cash-wallet/deposit/initiate', { amount_kobo: 12345 }, tokA);
  assert.equal(init.status, 200);
  const body = {
    provider_ref: init.json.provider_ref, status: 'confirmed',
    amount_kobo: 12345, currency: 'NGN',
  };
  body.signature = signMockWebhook(body);
  const r = await post('/api/cash-wallet/deposit/mock-webhook', body, tokA);
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'confirmed');
  assert.equal(r.json.available_kobo, 12345);
});
