// Provider adapter architecture tests (Fintech Milestone 8).
//
// - Adapter interface conformance: the mock adapter implements every
//   interface method with deterministic MOCK behavior; the Paystack /
//   Flutterwave skeletons throw ProviderNotConfiguredError without
//   credentials (fail closed).
// - Webhook signature verification: real schemes exercised with FAKE
//   secrets (pure crypto, zero network): valid -> accepted, tampered
//   body -> rejected, wrong secret -> rejected.
// - Factory fail-closed: PROVIDER=paystack/flutterwave without creds
//   or without CASH_OPS_ENABLED refuses; unknown names refuse; the
//   default is the mock adapter.
// - POST /api/cash-wallet/deposit/webhook/:provider end-to-end with
//   the mock provider over RAW request bytes (express verify-callback
//   captures req.rawBody, exactly like src/app.js): a verified event
//   credits exactly once, a duplicate delivery does not double-credit,
//   a bad signature is rejected and stored as rejected with no credit.
//
// In-memory SQLite via EKO_DB_PATH. No live credentials, no real
// money, no network calls to providers anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';

process.env.SESSION_SECRET = 'test-secret-fintech-provider-tests-only-3952c7aa51a4f05';
process.env.EKO_DB_PATH = ':memory:';
delete process.env.CASH_OPS_ENABLED;
delete process.env.PROVIDER;
delete process.env.PAYSTACK_SECRET_KEY;
delete process.env.PAYSTACK_PUBLIC_KEY;
delete process.env.FLUTTERWAVE_SECRET_KEY;
delete process.env.FLUTTERWAVE_WEBHOOK_SECRET;
delete process.env.FLUTTERWAVE_WEBHOOK_HASH;
process.env.MOCK_WEBHOOK_SECRET = 'test-mock-webhook-secret-fintech-provider';

const db = await import('../src/db.js');
const { ensureChartOfAccounts, ensureFeePolicyV1 } = await import('../src/fintech/seed.js');
const { createCashWalletRouter, signMockWebhook } = await import('../src/routes/cashWallet.js');
const {
  PROVIDER_INTERFACE,
  ProviderNotConfiguredError,
  MockAdapter,
  PaystackAdapter,
  FlutterwaveAdapter,
  adapterForName,
  getProvider,
  webhookSecretFor,
} = await import('../src/fintech/provider.js');
const { signToken } = await import('../src/auth.js');
const ledger = await import('../src/fintech/ledger.js');

const MOCK_SECRET = process.env.MOCK_WEBHOOK_SECRET;

let base, user, tok, server;
let seq = 0;

async function postRaw(path, rawBody, extraHeaders = {}) {
  const headers = { 'content-type': 'application/json', ...extraHeaders };
  const r = await fetch(base + path, { method: 'POST', headers, body: rawBody });
  return { status: r.status, json: await r.json() };
}
async function postJSON(path, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}
async function journalCount() {
  const r = await db.dbGet('SELECT COUNT(*) AS c FROM ledger_journals', 'SELECT COUNT(*) AS c FROM ledger_journals', []);
  return Number(r.c);
}
async function lastProviderEvent() {
  return db.dbGet(
    'SELECT provider, event_type, provider_ref, signature_valid, processed FROM provider_events ORDER BY id DESC LIMIT 1',
    'SELECT provider, event_type, provider_ref, signature_valid, processed FROM provider_events ORDER BY id DESC LIMIT 1',
    []);
}

// Build the exact raw bytes a mock provider would POST: JSON body with
// the test-only signature field, signed over the fields.
function mockWebhookRaw({ provider_ref, status, amount_kobo, currency }, secret = MOCK_SECRET) {
  const signature = crypto.createHmac('sha256', secret)
    .update(`${provider_ref}|${status}|${amount_kobo}|${currency}`).digest('hex');
  return JSON.stringify({ provider_ref, status, amount_kobo, currency, signature });
}

test.before(async () => {
  await db.initDb();
  await ensureChartOfAccounts();
  await ensureFeePolicyV1();

  // Mirror src/app.js: global express.json() with a verify() callback
  // capturing the raw request bytes on req.rawBody — this is what the
  // provider webhook route verifies signatures over.
  const app = express();
  app.use(express.json({
    limit: '32kb',
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));
  app.use('/api/cash-wallet', createCashWalletRouter());
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[500]', err && err.message);
    res.status(500).json({ error: 'Something went wrong.' });
  });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;

  user = await db.createUser({ username: `prov_test_${Date.now()}`, is_guest: true });
  tok = signToken(user);
  process.env.CASH_OPS_ENABLED = 'true';
});

test.after(async () => {
  delete process.env.CASH_OPS_ENABLED;
  delete process.env.PROVIDER;
  await new Promise((resolve) => server.close(resolve));
});

// ---------- adapter interface conformance ----------
test('every adapter class implements the full interface', () => {
  for (const Cls of [MockAdapter, PaystackAdapter, FlutterwaveAdapter]) {
    const a = new Cls();
    assert.ok(typeof a.name === 'string' && a.name.length > 0, `${Cls.name} must have a name`);
    for (const m of PROVIDER_INTERFACE) {
      assert.equal(typeof a[m], 'function', `${Cls.name} must implement ${m}()`);
    }
  }
  assert.deepEqual(new MockAdapter().name, 'mock');
  assert.deepEqual(new PaystackAdapter().name, 'paystack');
  assert.deepEqual(new FlutterwaveAdapter().name, 'flutterwave');
});

test('mock adapter: deterministic MOCK deposit/payout flows', async () => {
  const a = new MockAdapter();
  const d1 = await a.initiateDeposit({ userId: 7, amountKobo: 50000, currency: 'NGN' });
  assert.ok(d1.reference.startsWith('MOCK-DEP-'), 'mock deposit reference is clearly labeled');
  assert.equal(d1.status, 'pending');
  const d2 = await a.initiateDeposit({ userId: 7, amountKobo: 50000, currency: 'NGN' });
  assert.equal(d2.reference, d1.reference, 'mock deposit reference is deterministic');

  const v = await a.verifyDeposit(d1.reference);
  assert.equal(v.status, 'confirmed');

  const p = await a.initiatePayout({ userId: 7, netKobo: 9000, beneficiary: { label: 'GTB' } });
  assert.ok(p.providerPayoutId.startsWith('MOCK-PAY-'), 'mock payout id is clearly labeled');
  assert.equal(p.status, 'queued');

  const s = await a.getPayoutStatus(p.providerPayoutId);
  assert.equal(s.status, 'settled');
});

test('mock adapter: webhook signature verification (valid / tampered / wrong secret)', () => {
  const a = new MockAdapter();
  const fields = { provider_ref: 'MOCK-DEP-AAAA:1', status: 'confirmed', amount_kobo: 50000, currency: 'NGN' };
  const raw = mockWebhookRaw(fields, 'secret-A');

  assert.equal(a.verifyWebhookSignature(Buffer.from(raw, 'utf8'), {}, 'secret-A'), true, 'valid signature accepted');

  // Tampered body, original signature -> rejected.
  const tampered = raw.replace('50000', '99999');
  assert.equal(a.verifyWebhookSignature(Buffer.from(tampered, 'utf8'), {}, 'secret-A'), false, 'tampered body rejected');

  // Wrong secret -> rejected.
  assert.equal(a.verifyWebhookSignature(Buffer.from(raw, 'utf8'), {}, 'secret-B'), false, 'wrong secret rejected');

  // Garbage body -> rejected, never throws.
  assert.equal(a.verifyWebhookSignature(Buffer.from('not-json', 'utf8'), {}, 'secret-A'), false);
});

test('mock adapter: parseWebhookEvent normalizes the payload', () => {
  const a = new MockAdapter();
  const raw = mockWebhookRaw({ provider_ref: 'MOCK-DEP-AAAA:1', status: 'confirmed', amount_kobo: 50000, currency: 'NGN' });
  const ev = a.parseWebhookEvent(Buffer.from(raw, 'utf8'));
  assert.equal(ev.providerRef, 'MOCK-DEP-AAAA:1');
  assert.equal(ev.status, 'confirmed');
  assert.equal(ev.amountKobo, 50000);
  assert.equal(ev.currency, 'NGN');
  assert.throws(() => a.parseWebhookEvent(Buffer.from('nope', 'utf8')), ProviderNotConfiguredError);
});

// ---------- skeletons: fail closed without credentials ----------
test('paystack + flutterwave skeletons throw cleanly without credentials', async () => {
  delete process.env.PAYSTACK_SECRET_KEY;
  delete process.env.FLUTTERWAVE_SECRET_KEY;
  delete process.env.FLWSECK_TEST;
  for (const a of [new PaystackAdapter(), new FlutterwaveAdapter()]) {
    for (const m of ['initiateDeposit', 'verifyDeposit', 'initiatePayout', 'getPayoutStatus']) {
      await assert.rejects(
        () => a[m]({}),
        (e) => e instanceof ProviderNotConfiguredError && /approval required/i.test(e.message),
        `${a.name}.${m} must throw ProviderNotConfiguredError without creds`,
      );
    }
  }
});

test('paystack skeleton: TODO stubs still throw with fake creds (no network)', async () => {
  process.env.CASH_OPS_ENABLED = 'true';
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_fake';
  try {
    const a = new PaystackAdapter();
    await assert.rejects(() => a.initiateDeposit({}), ProviderNotConfiguredError);
  } finally {
    delete process.env.PAYSTACK_SECRET_KEY;
  }
});

test('paystack webhook verification: real HMAC-SHA512 scheme, fake secret', () => {
  const a = new PaystackAdapter();
  const raw = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'PSK-1', amount: 50000, currency: 'NGN' } }), 'utf8');
  const good = crypto.createHmac('sha512', 'fake-secret').update(raw).digest('hex');

  assert.equal(a.verifyWebhookSignature(raw, { 'x-paystack-signature': good }, 'fake-secret'), true, 'valid paystack signature accepted');
  // Tampered bytes -> rejected.
  const tampered = Buffer.from(raw.toString('utf8').replace('50000', '99999'), 'utf8');
  assert.equal(a.verifyWebhookSignature(tampered, { 'x-paystack-signature': good }, 'fake-secret'), false, 'tampered body rejected');
  // Wrong secret -> rejected.
  assert.equal(a.verifyWebhookSignature(raw, { 'x-paystack-signature': good }, 'other-secret'), false, 'wrong secret rejected');
  // Missing header -> rejected.
  assert.equal(a.verifyWebhookSignature(raw, {}, 'fake-secret'), false, 'missing header rejected');
});

test('paystack parseWebhookEvent maps charge.success/charge.failed', () => {
  const a = new PaystackAdapter();
  const ok = a.parseWebhookEvent(JSON.stringify({ event: 'charge.success', data: { reference: 'PSK-1', amount: 50000, currency: 'NGN' } }));
  assert.deepEqual({ providerRef: ok.providerRef, status: ok.status, amountKobo: ok.amountKobo, currency: ok.currency },
    { providerRef: 'PSK-1', status: 'confirmed', amountKobo: 50000, currency: 'NGN' });
  const failed = a.parseWebhookEvent(JSON.stringify({ event: 'charge.failed', data: { reference: 'PSK-2', amount: 1000, currency: 'NGN' } }));
  assert.equal(failed.status, 'failed');
  assert.throws(() => a.parseWebhookEvent(JSON.stringify({ event: 'transfer.success', data: {} })), ProviderNotConfiguredError);
});

test('flutterwave webhook verification: verif-hash comparison, fake hash', () => {
  const a = new FlutterwaveAdapter();
  const raw = Buffer.from(JSON.stringify({ event: 'charge.completed', data: { tx_ref: 'FLW-1', amount: 50000, currency: 'NGN', status: 'successful' } }), 'utf8');
  assert.equal(a.verifyWebhookSignature(raw, { 'verif-hash': 'configured-hash' }, 'configured-hash'), true, 'matching verif-hash accepted');
  assert.equal(a.verifyWebhookSignature(raw, { 'verif-hash': 'attacker' }, 'configured-hash'), false, 'wrong verif-hash rejected');
  assert.equal(a.verifyWebhookSignature(raw, {}, 'configured-hash'), false, 'missing verif-hash rejected');
});

test('flutterwave parseWebhookEvent maps charge.completed', () => {
  const a = new FlutterwaveAdapter();
  const ok = a.parseWebhookEvent(JSON.stringify({ event: 'charge.completed', data: { tx_ref: 'FLW-1', amount: 50000, currency: 'NGN', status: 'successful' } }));
  assert.deepEqual({ providerRef: ok.providerRef, status: ok.status, amountKobo: ok.amountKobo, currency: ok.currency },
    { providerRef: 'FLW-1', status: 'confirmed', amountKobo: 50000, currency: 'NGN' });
  const failed = a.parseWebhookEvent(JSON.stringify({ event: 'charge.completed', data: { tx_ref: 'FLW-2', amount: 1000, currency: 'NGN', status: 'failed' } }));
  assert.equal(failed.status, 'failed');
  assert.throws(() => a.parseWebhookEvent(JSON.stringify({ event: 'transfer.completed', data: {} })), ProviderNotConfiguredError);
});

// ---------- factory fail-closed ----------
test('factory: non-mock PROVIDER without creds or cash ops refuses (never falls back to mock)', () => {
  const saved = { ...process.env };
  try {
    // paystack without creds
    process.env.PROVIDER = 'paystack';
    process.env.CASH_OPS_ENABLED = 'true';
    delete process.env.PAYSTACK_SECRET_KEY;
    assert.throws(() => getProvider(), ProviderNotConfiguredError);

    // flutterwave without creds
    process.env.PROVIDER = 'flutterwave';
    delete process.env.FLUTTERWAVE_SECRET_KEY;
    delete process.env.FLWSECK_TEST;
    assert.throws(() => getProvider(), ProviderNotConfiguredError);

    // paystack with (fake) creds but cash ops OFF
    process.env.PROVIDER = 'paystack';
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_fake';
    delete process.env.CASH_OPS_ENABLED;
    assert.throws(() => getProvider(), ProviderNotConfiguredError);

    // unknown provider name
    process.env.PROVIDER = 'stripe';
    process.env.CASH_OPS_ENABLED = 'true';
    assert.throws(() => getProvider(), ProviderNotConfiguredError);
    assert.throws(() => adapterForName('stripe'), ProviderNotConfiguredError);

    // default + explicit mock resolve to the mock adapter
    delete process.env.PROVIDER;
    process.env.CASH_OPS_ENABLED = 'true';
    assert.equal(getProvider().name, 'mock');
    assert.equal(adapterForName('mock').name, 'mock');
  } finally {
    for (const k of Object.keys(process.env)) delete process.env[k];
    for (const [k, v] of Object.entries(saved)) process.env[k] = v;
  }
});

test('webhookSecretFor reads env only, never hardcodes', () => {
  assert.equal(webhookSecretFor('mock'), MOCK_SECRET);
  assert.equal(webhookSecretFor('paystack'), null, 'no paystack secret in env');
  assert.equal(webhookSecretFor('nope'), null);
});

// ---------- webhook route end-to-end (mock provider, raw body) ----------
let dep;
test('webhook route: verified event credits exactly once (no user auth needed)', async () => {
  const init = await postJSON('/api/cash-wallet/deposit/initiate', { amount_kobo: 60000 }, tok);
  assert.equal(init.status, 200);
  assert.ok(init.json.provider_ref.startsWith('MOCK-DEP-'));
  dep = init.json;

  const j0 = await journalCount();
  // NOTE: no Authorization header — provider webhooks are
  // signature-authenticated, not user-authenticated.
  const raw = mockWebhookRaw({
    provider_ref: dep.provider_ref, status: 'confirmed',
    amount_kobo: dep.amount_kobo, currency: 'NGN',
  });
  const r = await postRaw('/api/cash-wallet/deposit/webhook/mock', raw);
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'confirmed');
  assert.equal(r.json.available_kobo, 60000, 'wallet credited exactly once');

  assert.equal(await journalCount(), j0 + 1, 'exactly one confirm journal posted');
  const bal = await ledger.getCashBalance(user);
  assert.equal(bal.availableKobo, 60000);

  const ev = await lastProviderEvent();
  assert.equal(ev.provider, 'mock');
  assert.equal(Number(ev.signature_valid), 1);
  assert.equal(Number(ev.processed), 1);
});

test('webhook route: duplicate delivery does not double-credit', async () => {
  const j0 = await journalCount();
  const raw = mockWebhookRaw({
    provider_ref: dep.provider_ref, status: 'confirmed',
    amount_kobo: dep.amount_kobo, currency: 'NGN',
  });
  const r = await postRaw('/api/cash-wallet/deposit/webhook/mock', raw);
  assert.equal(r.status, 200);
  assert.equal(r.json.duplicate, true);
  assert.equal(await journalCount(), j0, 'no second journal on duplicate delivery');
  const bal = await ledger.getCashBalance(user);
  assert.equal(bal.availableKobo, 60000, 'balance unchanged on duplicate');
});

test('webhook route: bad signature rejected, stored as rejected, no credit', async () => {
  const init = await postJSON('/api/cash-wallet/deposit/initiate', { amount_kobo: 25000 }, tok);
  assert.equal(init.status, 200);
  const j0 = await journalCount();
  const bal0 = (await ledger.getCashBalance(user)).availableKobo;

  // Sign with the wrong secret.
  const raw = mockWebhookRaw({
    provider_ref: init.json.provider_ref, status: 'confirmed',
    amount_kobo: 25000, currency: 'NGN',
  }, 'wrong-secret');
  const r = await postRaw('/api/cash-wallet/deposit/webhook/mock', raw);
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'Invalid webhook signature.');

  const ev = await lastProviderEvent();
  assert.equal(ev.provider, 'mock');
  assert.equal(Number(ev.signature_valid), 0, 'stored as rejected');
  assert.equal(Number(ev.processed), 0);

  assert.equal(await journalCount(), j0, 'no journal posted for rejected webhook');
  assert.equal((await ledger.getCashBalance(user)).availableKobo, bal0, 'no credit on rejected webhook');

  // Deposit row untouched.
  const row = await db.dbGet(
    'SELECT status FROM cash_deposits WHERE id = ?',
    'SELECT status FROM cash_deposits WHERE id = $1', [init.json.deposit_id]);
  assert.equal(row.status, 'pending');
});

test('webhook route: unknown provider name -> 404', async () => {
  const raw = mockWebhookRaw({ provider_ref: 'x', status: 'confirmed', amount_kobo: 1, currency: 'NGN' });
  const r = await postRaw('/api/cash-wallet/deposit/webhook/bogus', raw);
  assert.equal(r.status, 404);
});

test('webhook route: non-mock provider without creds refuses at route level', async () => {
  delete process.env.PAYSTACK_SECRET_KEY;
  const raw = JSON.stringify({ event: 'charge.success', data: { reference: 'PSK-X', amount: 1, currency: 'NGN' } });
  const r = await postRaw('/api/cash-wallet/deposit/webhook/paystack', raw, { 'x-paystack-signature': 'x' });
  // adapterForName throws ProviderNotConfiguredError -> route answers 404 "unconfigured"
  assert.equal(r.status, 404);
  assert.match(r.json.error, /unconfigured/i);
});

// ---------- legacy deposit/initiate still goes through the mock adapter ----------
test('deposit/initiate unchanged under PROVIDER=mock', async () => {
  delete process.env.PROVIDER;
  const r = await postJSON('/api/cash-wallet/deposit/initiate', { amount_kobo: 15000 }, tok);
  assert.equal(r.status, 200);
  assert.ok(r.json.provider_ref.startsWith('MOCK-DEP-'));
  assert.ok(r.json.mock_checkout);
  assert.match(r.json.mock_checkout.instructions, /MOCK/i);
  const row = await db.dbGet(
    'SELECT provider, status FROM cash_deposits WHERE id = ?',
    'SELECT provider, status FROM cash_deposits WHERE id = $1', [r.json.deposit_id]);
  assert.equal(row.provider, 'mock');
  assert.equal(row.status, 'pending');
});
