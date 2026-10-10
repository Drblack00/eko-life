// Fintech admin (Milestone 9, Worker B): risk controls, manual
// adjustments, withdrawal review flow, reconciliation — over HTTP
// against createCashAdminRouter() (+ cashWallet/cashFlows routers).
//
// All amounts are integer kobo. CASH_OPS_ENABLED is on for these tests
// except the explicit 403-off test. Live money stays OFF (mock only).
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.EKO_DB_PATH = ':memory:';
process.env.CASH_OPS_ENABLED = 'true';

const db = await import('../src/db.js');
const ledger = await import('../src/fintech/ledger.js');
const auth = await import('../src/auth.js');
const seed = await import('../src/fintech/seed.js');
const risk = await import('../src/fintech/risk.js');
const { createCashWalletRouter, signMockWebhook } = await import('../src/routes/cashWallet.js');
const { createCashFlowsRouter } = await import('../src/routes/cashFlows.js');
const { createCashAdminRouter } = await import('../src/routes/cashAdmin.js');

let app, server, base;
let seq = 0;

async function makeUser() {
  seq++;
  const id = await db.createUser({ username: `fa_u${seq}_${Date.now()}`, is_guest: true });
  return { id, token: auth.signToken(id) };
}

async function makeAdmin() {
  const u = await makeUser();
  await db.setAdmin(u.id, true);
  return u;
}

async function usernameOf(id) {
  return (await db.getUserById(id)).username;
}

// Credit a wallet via a deposit-style journal (same shape as the
// confirmed-deposit journal; does NOT count as a "completed deposit"
// for daily aggregates, which only read cash_deposits).
let fundSeq = 0;
async function fund(userId, amountKobo) {
  fundSeq++;
  await ledger.postJournal({
    journalKey: `fa-fund-${fundSeq}`,
    type: 'deposit',
    userId,
    entries: [
      { accountCode: 'deposit_processing', side: 'debit', amountKobo },
      { accountCode: 'customer_available', side: 'credit', amountKobo },
    ],
    memo: 'TEST funding',
  });
}

async function api(method, path, { token = null, body = undefined } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const r = await fetch(base + path, { method, headers, body: payload });
  let json = null;
  try { json = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, json, text: json ? JSON.stringify(json) : '' };
}

async function makeBeneficiary(user, acct = '0123456789') {
  const r = await api('POST', '/api/cash-wallet/beneficiaries', {
    token: user.token,
    body: { label: `Ben ${acct.slice(-4)}`, bank_code: '058', account_number: acct },
  });
  assert.equal(r.status, 201, `beneficiary create: ${r.text}`);
  return r.json;
}

async function quoteAndWithdraw(user, ben, grossKobo, idemKey) {
  const q = await api('POST', '/api/cash-wallet/withdrawals/quote', {
    token: user.token, body: { beneficiary_id: ben.id, gross_kobo: grossKobo },
  });
  assert.equal(q.status, 200, `quote: ${q.text}`);
  const w = await api('POST', '/api/cash-wallet/withdrawals', {
    token: user.token,
    body: {
      beneficiary_id: ben.id, gross_kobo: grossKobo,
      idempotency_key: idemKey, quote_token: q.json.quote_token,
    },
  });
  assert.equal(w.status, 201, `withdraw: ${w.text}`);
  return w.json;
}

async function auditActions(action) {
  const rows = await db.dbAll(
    'SELECT * FROM fintech_audit_logs WHERE action = ? ORDER BY id',
    'SELECT * FROM fintech_audit_logs WHERE action = $1 ORDER BY id',
    [action]);
  return rows;
}

test.before(async () => {
  await db.initDb();
  await seed.ensureChartOfAccounts();
  await seed.ensureFeePolicyV1();
  app = express();
  app.use(express.json());
  app.use('/api/cash-wallet', createCashWalletRouter());
  app.use('/api/cash-wallet', createCashFlowsRouter());
  app.use('/api/admin/cash', createCashAdminRouter());
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// ---------- admin authz ----------

test('admin authz: non-admin 403, admin OK, cash-ops-off 403', async () => {
  const admin = await makeAdmin();
  const pleb = await makeUser();

  const denied = await api('GET', '/api/admin/cash/overview', { token: pleb.token });
  assert.equal(denied.status, 403, denied.text);

  const noToken = await api('GET', '/api/admin/cash/overview');
  assert.equal(noToken.status, 403, noToken.text);

  const ok = await api('GET', '/api/admin/cash/overview', { token: admin.token });
  assert.equal(ok.status, 200, ok.text);
  assert.ok(ok.json.customer_liabilities_kobo, 'overview shape');
  assert.ok('commission_earned_kobo' in ok.json, 'commission in overview');

  delete process.env.CASH_OPS_ENABLED;
  try {
    const off = await api('GET', '/api/admin/cash/overview', { token: admin.token });
    assert.equal(off.status, 403, 'cash ops off -> 403 even for admin');
    const offPost = await api('POST', '/api/admin/cash/adjustments', {
      token: admin.token, body: { user_id: pleb.id, debit_account: 'x', credit_account: 'y', amount_kobo: 1, reason: 'z' },
    });
    assert.equal(offPost.status, 403, offPost.text);
  } finally {
    process.env.CASH_OPS_ENABLED = 'true';
  }
});

// ---------- restrict: suspend/reactivate ----------

test('restrict: suspend blocks transfer AND withdrawal; reactivate restores', async () => {
  const admin = await makeAdmin();
  const u = await makeUser();
  const v = await makeUser();
  await fund(u.id, 500000);

  const susp = await api('POST', `/api/admin/cash/users/${u.id}/restrict`, {
    token: admin.token, body: { status: 'suspended', reason: 'TEST risk hold' },
  });
  assert.equal(susp.status, 200, susp.text);
  assert.equal(susp.json.account_status, 'suspended');

  const t = await api('POST', '/api/cash-wallet/transfer', {
    token: u.token,
    body: { recipient_username: await usernameOf(v.id), amount_kobo: 10000, idempotency_key: 'fa-r-t1' },
  });
  assert.equal(t.status, 403, `suspended transfer blocked: ${t.text}`);

  const ben = await makeBeneficiary(u, '9000111122');
  const q = await api('POST', '/api/cash-wallet/withdrawals/quote', {
    token: u.token, body: { beneficiary_id: ben.id, gross_kobo: 60000 },
  });
  assert.equal(q.status, 200, q.text);
  const w = await api('POST', '/api/cash-wallet/withdrawals', {
    token: u.token,
    body: { beneficiary_id: ben.id, gross_kobo: 60000, idempotency_key: 'fa-r-w1', quote_token: q.json.quote_token },
  });
  assert.equal(w.status, 403, `suspended withdrawal blocked: ${w.text}`);
  assert.equal((await ledger.getCashBalance(u.id)).availableKobo, 500000, 'nothing moved');

  const logs = await auditActions('cash.account.restrict');
  assert.ok(logs.length >= 1, 'restrict wrote an audit log');
  const last = logs[logs.length - 1];
  assert.ok(String(last.actor).startsWith('admin:'), 'admin id recorded');
  assert.ok(String(last.detail).includes('TEST risk hold'), 'reason recorded');

  const reac = await api('POST', `/api/admin/cash/users/${u.id}/restrict`, {
    token: admin.token, body: { status: 'active', reason: 'TEST hold lifted' },
  });
  assert.equal(reac.status, 200, reac.text);

  const t2 = await api('POST', '/api/cash-wallet/transfer', {
    token: u.token,
    body: { recipient_username: await usernameOf(v.id), amount_kobo: 10000, idempotency_key: 'fa-r-t2' },
  });
  assert.equal(t2.status, 200, `reactivated transfer works: ${t2.text}`);
});

test('restrict: validation (reason required, bad status, unknown user, non-admin 403)', async () => {
  const admin = await makeAdmin();
  const pleb = await makeUser();
  const u = await makeUser();

  const noReason = await api('POST', `/api/admin/cash/users/${u.id}/restrict`, {
    token: admin.token, body: { status: 'suspended' },
  });
  assert.equal(noReason.status, 400, noReason.text);

  const badStatus = await api('POST', `/api/admin/cash/users/${u.id}/restrict`, {
    token: admin.token, body: { status: 'frozen', reason: 'x' },
  });
  assert.equal(badStatus.status, 400, badStatus.text);

  const noUser = await api('POST', '/api/admin/cash/users/99999999/restrict', {
    token: admin.token, body: { status: 'suspended', reason: 'x' },
  });
  assert.equal(noUser.status, 404, noUser.text);

  const plebTry = await api('POST', `/api/admin/cash/users/${u.id}/restrict`, {
    token: pleb.token, body: { status: 'suspended', reason: 'x' },
  });
  assert.equal(plebTry.status, 403, plebTry.text);
});

// ---------- adjustments ----------

test('adjustments: balanced journal + audit log; reason mandatory', async () => {
  const admin = await makeAdmin();
  const u = await makeUser();
  await fund(u.id, 20000);

  const r = await api('POST', '/api/admin/cash/adjustments', {
    token: admin.token,
    body: {
      user_id: u.id,
      debit_account: 'provider_fees',
      credit_account: 'customer_available',
      amount_kobo: 5000,
      reason: 'TEST goodwill credit',
    },
  });
  assert.equal(r.status, 201, r.text);
  assert.ok(r.json.journal_id > 0);
  assert.ok(String(r.json.journal_key).startsWith('adjustment:admin:'));

  const entries = await ledger.getJournalEntries(r.json.journal_id);
  let debits = 0, credits = 0;
  for (const e of entries) {
    if (e.side === 'debit') debits += e.amountKobo; else credits += e.amountKobo;
  }
  assert.equal(debits, credits, 'adjustment journal is balanced');
  assert.equal(debits, 5000);
  const codes = new Set(entries.map((e) => e.accountCode));
  assert.ok(codes.has('provider_fees') && codes.has('customer_available'));

  const bal = await ledger.getCashBalance(u.id);
  assert.equal(bal.availableKobo, 25000, 'user credited via journal only');

  const logs = await auditActions('cash.adjustment.post');
  assert.ok(logs.length >= 1);
  const last = logs[logs.length - 1];
  assert.ok(String(last.actor).startsWith('admin:'), 'admin id recorded');
  assert.ok(String(last.detail).includes('TEST goodwill credit'), 'reason recorded');

  const noReason = await api('POST', '/api/admin/cash/adjustments', {
    token: admin.token,
    body: { user_id: u.id, debit_account: 'provider_fees', credit_account: 'customer_available', amount_kobo: 100 },
  });
  assert.equal(noReason.status, 400, noReason.text);

  const badAcct = await api('POST', '/api/admin/cash/adjustments', {
    token: admin.token,
    body: { user_id: u.id, debit_account: 'nope', credit_account: 'customer_available', amount_kobo: 100, reason: 'x' },
  });
  assert.equal(badAcct.status, 400, badAcct.text);

  const sameAcct = await api('POST', '/api/admin/cash/adjustments', {
    token: admin.token,
    body: { user_id: u.id, debit_account: 'provider_fees', credit_account: 'provider_fees', amount_kobo: 100, reason: 'x' },
  });
  assert.equal(sameAcct.status, 400, sameAcct.text);
});

test('adjustments: it is impossible to set a balance directly', async () => {
  const admin = await makeAdmin();
  const u = await makeUser();
  await fund(u.id, 10000);

  // No endpoint accepts a target balance — the only shape is
  // debit/credit accounts + amount. A balance-setting attempt 400s.
  const r = await api('POST', '/api/admin/cash/adjustments', {
    token: admin.token,
    body: { user_id: u.id, target_balance_kobo: 99999999, reason: 'TEST direct set' },
  });
  assert.equal(r.status, 400, `direct balance set rejected: ${r.text}`);
  assert.equal((await ledger.getCashBalance(u.id)).availableKobo, 10000, 'balance untouched');

  // Unknown routes that sound like balance setters do not exist.
  for (const p of ['/api/admin/cash/set-balance', '/api/admin/cash/users/1/set-balance', '/api/admin/cash/balances']) {
    const x = await api('POST', p, { token: admin.token, body: {} });
    assert.equal(x.status, 404, `${p} must not exist (got ${x.status})`);
  }
});

// ---------- risk pure functions ----------

test('risk: deposit cap, withdrawal cap calc, review policy (pure)', async () => {
  assert.deepEqual(risk.checkDepositCap({ amountKobo: 100_000_000 }), { ok: true, capKobo: 100_000_000 });
  assert.throws(() => risk.checkDepositCap({ amountKobo: 100_000_001 }),
    (e) => e.code === 'DEPOSIT_CAP_EXCEEDED' && e.statusCode === 400);

  const now = Date.now();
  // Amount rule.
  assert.deepEqual(
    risk.reviewReasons({ grossKobo: 50_000_000, beneficiaryCreatedAt: now - 48 * 3600 * 1000, now }),
    ['LARGE_WITHDRAWAL']);
  assert.deepEqual(
    risk.reviewReasons({ grossKobo: 49_999_999, beneficiaryCreatedAt: now - 48 * 3600 * 1000, now }),
    []);
  // Beneficiary-age rule.
  assert.deepEqual(
    risk.reviewReasons({ grossKobo: 60000, beneficiaryCreatedAt: now - 1000, now }),
    ['NEW_BENEFICIARY']);
  assert.deepEqual(
    risk.reviewReasons({ grossKobo: 60000, beneficiaryCreatedAt: now - 25 * 3600 * 1000, now }),
    []);
  // Diversion: amount always diverts; beneficiary-age diverts only in strict mode.
  assert.equal(risk.withdrawalRiskDecision({
    grossKobo: 60_000_000, beneficiaryCreatedAt: now - 48 * 3600 * 1000, now,
  }).divert, true);
  assert.equal(risk.withdrawalRiskDecision({
    grossKobo: 60000, beneficiaryCreatedAt: now - 1000, now,
  }).divert, false);
  assert.equal(risk.withdrawalRiskDecision({
    grossKobo: 60000, beneficiaryCreatedAt: now - 1000, now, strictNewBeneficiary: true,
  }).divert, true);

  const u = await makeUser();
  const agg = await risk.dailyAggregates(u.id);
  assert.deepEqual(
    { d: agg.depositsKobo, t: agg.transfersKobo, w: agg.withdrawalsKobo },
    { d: 0, t: 0, w: 0 });
  const cap = await risk.checkWithdrawalCap({ userId: u.id, grossKobo: 1000 });
  assert.equal(cap.ok, true);
});

// ---------- withdrawal daily cap over HTTP ----------

test('withdrawal daily cap: 429 once ₦2,000,000/day of completions is reached', async () => {
  const admin = await makeAdmin();
  const u = await makeUser();
  await fund(u.id, 300_000_000);
  // One beneficiary per withdrawal: the MOCK provider derives payout ids
  // deterministically from (user, amount, destination), and provider_ref
  // is UNIQUE — identical withdrawals would collide.
  const bens = [];
  for (let b = 0; b < 4; b++) {
    const r = await api('POST', '/api/cash-wallet/beneficiaries', {
      token: u.token,
      body: { label: `Cap ${b}`, bank_code: '058', account_number: `910011112${b}` },
    });
    assert.equal(r.status, 201, `beneficiary ${b}: ${r.text}`);
    bens.push(r.json);
  }

  // 4 x ₦500,000 withdrawals: each diverts to under_review (amount rule),
  // admin approves, payout advances to completed. 4 x 50M = ₦2M = the cap.
  for (let i = 0; i < 4; i++) {
    const w = await quoteAndWithdraw(u, bens[i], 50_000_000, `fa-cap-${i}`);
    assert.equal(w.status, 'under_review', `withdrawal ${i} held for review`);
    const ap = await api('POST', `/api/admin/cash/withdrawals/${w.withdrawal_id}/approve`, {
      token: admin.token, body: { reason: `TEST cap cycle ${i}` },
    });
    assert.equal(ap.status, 200, `approve ${i}: ${ap.text}`);
    const adv = await api('POST', `/api/cash-wallet/withdrawals/${w.withdrawal_id}/mock-advance`, { token: u.token });
    assert.equal(adv.status, 200, `advance ${i}: ${adv.text}`);
    assert.equal(adv.json.status, 'completed');
  }
  const agg = await risk.dailyAggregates(u.id);
  assert.equal(agg.withdrawalsKobo, 200_000_000, '₦2M completed today');

  // One kobo more would exceed the daily cap -> 429.
  const q = await api('POST', '/api/cash-wallet/withdrawals/quote', {
    token: u.token, body: { beneficiary_id: bens[0].id, gross_kobo: 60000 },
  });
  assert.equal(q.status, 200, q.text);
  const over = await api('POST', '/api/cash-wallet/withdrawals', {
    token: u.token,
    body: { beneficiary_id: bens[0].id, gross_kobo: 60000, idempotency_key: 'fa-cap-over', quote_token: q.json.quote_token },
  });
  assert.equal(over.status, 429, `over-cap withdrawal rejected: ${over.text}`);
  assert.equal(over.json.code, 'WITHDRAWAL_DAILY_CAP_EXCEEDED');
});

// ---------- under_review flow ----------

test('under_review: large withdrawal held -> approve resumes -> reject releases', async () => {
  const admin = await makeAdmin();
  const u = await makeUser();
  await fund(u.id, 200_000_000);
  const ben = await makeBeneficiary(u, '9200111122');

  // Large withdrawal diverts to under_review instead of payout.
  const w1 = await quoteAndWithdraw(u, ben, 60_000_000, 'fa-ur-1');
  assert.equal(w1.status, 'under_review');
  assert.equal(w1.provider_ref, null, 'no payout submitted while under review');
  assert.ok(w1.review && w1.review.reasons.includes('LARGE_WITHDRAWAL'));
  let bal = await ledger.getCashBalance(u.id);
  assert.equal(bal.availableKobo, 140_000_000);
  assert.equal(bal.reservedKobo, 60_000_000);

  // Owner can see the held state; admin queue lists it.
  const own = await api('GET', `/api/cash-wallet/withdrawals/${w1.withdrawal_id}`, { token: u.token });
  assert.equal(own.status, 200, own.text);
  assert.equal(own.json.status, 'under_review');
  const queue = await api('GET', '/api/admin/cash/withdrawals?status=under_review', { token: admin.token });
  assert.equal(queue.status, 200, queue.text);
  assert.ok(queue.json.withdrawals.some((x) => x.id === w1.withdrawal_id), 'in the review queue');

  // Approve without reason -> 400. Approve -> payout resumes.
  const noReason = await api('POST', `/api/admin/cash/withdrawals/${w1.withdrawal_id}/approve`, {
    token: admin.token, body: {},
  });
  assert.equal(noReason.status, 400, noReason.text);
  const ap = await api('POST', `/api/admin/cash/withdrawals/${w1.withdrawal_id}/approve`, {
    token: admin.token, body: { reason: 'TEST source of funds verified' },
  });
  assert.equal(ap.status, 200, `approve: ${ap.text}`);
  assert.equal(ap.json.status, 'submitted');
  assert.ok(String(ap.json.provider_ref).startsWith('MOCK-PAY-'));

  // Double-approve -> 409 (review already closed).
  const ap2 = await api('POST', `/api/admin/cash/withdrawals/${w1.withdrawal_id}/approve`, {
    token: admin.token, body: { reason: 'again' },
  });
  assert.equal(ap2.status, 409, ap2.text);

  const adv = await api('POST', `/api/cash-wallet/withdrawals/${w1.withdrawal_id}/mock-advance`, { token: u.token });
  assert.equal(adv.json.status, 'completed');
  bal = await ledger.getCashBalance(u.id);
  assert.equal(bal.availableKobo, 140_000_000);
  assert.equal(bal.reservedKobo, 0);

  // Second large withdrawal -> reject: funds released, user notified.
  const w2 = await quoteAndWithdraw(u, ben, 70_000_000, 'fa-ur-2');
  assert.equal(w2.status, 'under_review');
  const rej = await api('POST', `/api/admin/cash/withdrawals/${w2.withdrawal_id}/reject`, {
    token: admin.token, body: { reason: 'TEST sanctions-screen hit' },
  });
  assert.equal(rej.status, 200, `reject: ${rej.text}`);
  assert.equal(rej.json.status, 'rejected');
  assert.equal(rej.json.failure_reason, 'TEST sanctions-screen hit');
  bal = await ledger.getCashBalance(u.id);
  assert.equal(bal.availableKobo, 140_000_000, 'reserved released back to available');
  assert.equal(bal.reservedKobo, 0);

  const notes = await auditActions('cash.withdrawal.review.rejected');
  assert.ok(notes.some((n) => String(n.entity_id) === String(w2.withdrawal_id)
    && String(n.detail).includes('TEST sanctions-screen hit')), 'reject audited with reason');
  const userNotes = await db.dbAll(
    `SELECT * FROM fintech_audit_logs WHERE action = 'cash.withdrawal.review.rejected' AND entity_id = ?`,
    `SELECT * FROM fintech_audit_logs WHERE action = 'cash.withdrawal.review.rejected' AND entity_id = $1`,
    [String(u.id)]);
  assert.ok(userNotes.length >= 1, 'user notified of rejection');

  // Rejected withdrawal cannot be approved afterwards.
  const ap3 = await api('POST', `/api/admin/cash/withdrawals/${w2.withdrawal_id}/approve`, {
    token: admin.token, body: { reason: 'too late' },
  });
  assert.equal(ap3.status, 409, ap3.text);
});

// ---------- reconcile ----------

test('reconcile: balanced report on seeded flows with open items listed', async () => {
  const admin = await makeAdmin();
  const e = await makeUser();
  const f = await makeUser();
  const g = await makeUser();

  const r0 = await api('GET', '/api/admin/cash/reconcile', { token: admin.token });
  assert.equal(r0.status, 200, r0.text);
  const before = r0.json.totals;

  // Confirmed deposit via the real mock-webhook path (records the
  // processed provider event the reconciler expects).
  const di = await api('POST', '/api/cash-wallet/deposit/initiate', {
    token: e.token, body: { amount_kobo: 200000 },
  });
  assert.equal(di.status, 200, di.text);
  const whBody = {
    provider_ref: di.json.provider_ref, status: 'confirmed',
    amount_kobo: 200000, currency: 'NGN',
  };
  const wh = await api('POST', '/api/cash-wallet/deposit/mock-webhook', {
    token: e.token,
    body: { ...whBody, signature: signMockWebhook(whBody) },
  });
  assert.equal(wh.status, 200, `webhook confirm: ${wh.text}`);
  assert.equal(wh.json.status, 'confirmed');

  // Transfer 25k e -> f.
  const t = await api('POST', '/api/cash-wallet/transfer', {
    token: e.token,
    body: { recipient_username: await usernameOf(f.id), amount_kobo: 25000, idempotency_key: 'fa-rc-t1' },
  });
  assert.equal(t.status, 200, t.text);

  // Withdrawal 50k -> completed (commission 5k).
  const benE = await makeBeneficiary(e, '9300111122');
  const wDone = await quoteAndWithdraw(e, benE, 50000, 'fa-rc-w1');
  assert.equal(wDone.status, 'submitted');
  const adv = await api('POST', `/api/cash-wallet/withdrawals/${wDone.withdrawal_id}/mock-advance`, { token: e.token });
  assert.equal(adv.json.status, 'completed');

  // Open items: one pending deposit, one submitted payout, one under_review.
  const dp = await api('POST', '/api/cash-wallet/deposit/initiate', {
    token: e.token, body: { amount_kobo: 50000 },
  });
  assert.equal(dp.status, 200, dp.text);
  const wSub = await quoteAndWithdraw(e, benE, 60000, 'fa-rc-w2');
  assert.equal(wSub.status, 'submitted');
  await fund(g.id, 100_000_000);
  const benG = await makeBeneficiary(g, '9400111122');
  const wUr = await quoteAndWithdraw(g, benG, 60_000_000, 'fa-rc-w3');
  assert.equal(wUr.status, 'under_review');

  const r = await api('GET', '/api/admin/cash/reconcile', { token: admin.token });
  assert.equal(r.status, 200, r.text);
  const rep = r.json;
  assert.ok(rep.generated_at > 0);
  assert.deepEqual(rep.differences, [], `no differences: ${JSON.stringify(rep.differences)}`);
  assert.equal(rep.balanced, true);

  // Totals are file-global (shared in-memory DB) — assert deltas.
  // e: 200k - 25k - 50k - 60k = +65k avail, +60k reserved.
  // f: +25k avail. g: +100M fund - 60M reserve = +40M avail, +60M reserved.
  assert.equal(rep.totals.customer_available_kobo - before.customer_available_kobo, 65000 + 25000 + 40_000_000);
  assert.equal(rep.totals.customer_reserved_kobo - before.customer_reserved_kobo, 60000 + 60_000_000);
  assert.equal(rep.totals.customer_liabilities_kobo - before.customer_liabilities_kobo,
    65000 + 25000 + 40_000_000 + 60000 + 60_000_000);
  assert.equal(rep.totals.commission_earned_kobo - before.commission_earned_kobo, 5000);

  assert.equal(rep.open_items.pending_deposits.length, 1);
  assert.equal(rep.open_items.pending_deposits[0].amount_kobo, 50000);
  assert.equal(rep.open_items.submitted_payouts.length, 1);
  assert.equal(rep.open_items.submitted_payouts[0].id, wSub.withdrawal_id);
  assert.equal(rep.open_items.under_review.length, 1);
  assert.equal(rep.open_items.under_review[0].withdrawal_id, wUr.withdrawal_id);
  assert.deepEqual(rep.open_items.stuck_reserved, []);

  // Non-admin cannot pull the report.
  const denied = await api('GET', '/api/admin/cash/reconcile', { token: e.token });
  assert.equal(denied.status, 403, denied.text);
});

// ---------- read endpoints ----------

test('admin reads: journals filterable, deposits list, audit filterable', async () => {
  const admin = await makeAdmin();
  const u = await makeUser();
  await fund(u.id, 50000);

  const adj = await api('POST', '/api/admin/cash/adjustments', {
    token: admin.token,
    body: {
      user_id: u.id, debit_account: 'provider_fees', credit_account: 'customer_available',
      amount_kobo: 7000, reason: 'TEST read-path probe',
    },
  });
  assert.equal(adj.status, 201, adj.text);

  const j = await api('GET', `/api/admin/cash/journals?user_id=${u.id}&type=adjustment`, { token: admin.token });
  assert.equal(j.status, 200, j.text);
  assert.ok(j.json.journals.length >= 1);
  const found = j.json.journals.find((x) => x.journal_key === adj.json.journal_key);
  assert.ok(found, 'adjustment journal found via filters');
  assert.ok(found.entries.length === 2, 'entries embedded');

  const jBad = await api('GET', '/api/admin/cash/journals?type=bogus', { token: admin.token });
  assert.equal(jBad.status, 400, jBad.text);

  const deps = await api('GET', '/api/admin/cash/deposits?status=pending', { token: admin.token });
  assert.equal(deps.status, 200, deps.text);
  assert.ok(Array.isArray(deps.json.deposits));

  const au = await api('GET', '/api/admin/cash/audit?action=cash.adjustment.post', { token: admin.token });
  assert.equal(au.status, 200, au.text);
  assert.ok(au.json.logs.length >= 1);
  assert.ok(au.json.logs.every((l) => l.action === 'cash.adjustment.post'));

  const wq = await api('GET', '/api/admin/cash/withdrawals?status=bogus', { token: admin.token });
  assert.equal(wq.status, 400, wq.text);
  const wAll = await api('GET', '/api/admin/cash/withdrawals', { token: admin.token });
  assert.equal(wAll.status, 200, wAll.text);
  assert.ok(Array.isArray(wAll.json.withdrawals));
});
