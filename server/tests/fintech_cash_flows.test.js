// Fintech cash flows (Milestones 6b + 7): P2P transfers + bank
// withdrawals with 10% commission, over HTTP against
// createCashFlowsRouter().
//
// All amounts are integer kobo. Provider calls are MOCK-only
// (mockProvider.js) and CASH_OPS_ENABLED is on for these tests
// except the explicit 403-off test.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.EKO_DB_PATH = ':memory:';
process.env.CASH_OPS_ENABLED = 'true';

const db = await import('../src/db.js');
const ledger = await import('../src/fintech/ledger.js');
const auth = await import('../src/auth.js');
const seed = await import('../src/fintech/seed.js');
const { createCashFlowsRouter } = await import('../src/routes/cashFlows.js');

let app, server, base;
let seq = 0;

async function makeUser() {
  seq++;
  const id = await db.createUser({ username: `cf_u${seq}_${Date.now()}`, is_guest: true });
  return { id, username: `cf_u${seq}`, token: auth.signToken(id) };
}

async function usernameOf(id) {
  const u = await db.getUserById(id);
  return u.username;
}

// Credit a wallet via a deposit-style journal (Worker A's deposit path
// shape: deposit_processing -> customer_available).
let fundSeq = 0;
async function fund(userId, amountKobo) {
  fundSeq++;
  await ledger.postJournal({
    journalKey: `cf-fund-${fundSeq}`,
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

async function journalCount() {
  const r = await db.dbGet('SELECT COUNT(*) AS c FROM ledger_journals', 'SELECT COUNT(*) AS c FROM ledger_journals', []);
  return Number(r.c);
}

async function setAccountStatus(userId, status) {
  await db.dbRun(
    'UPDATE cash_wallets SET account_status = ? WHERE user_id = ?',
    'UPDATE cash_wallets SET account_status = $1 WHERE user_id = $2',
    [status, userId]);
}

async function makeBeneficiary(user, acct = '0123456789') {
  const r = await api('POST', '/beneficiaries', {
    token: user.token,
    body: { label: `Ben ${acct.slice(-4)}`, bank_code: '058', account_number: acct },
  });
  assert.equal(r.status, 201, `beneficiary create: ${r.text}`);
  return r.json;
}

async function quoteAndWithdraw(user, ben, grossKobo, idemKey) {
  const q = await api('POST', '/withdrawals/quote', {
    token: user.token, body: { beneficiary_id: ben.id, gross_kobo: grossKobo },
  });
  assert.equal(q.status, 200, `quote: ${q.text}`);
  const w = await api('POST', '/withdrawals', {
    token: user.token,
    body: {
      beneficiary_id: ben.id, gross_kobo: grossKobo,
      idempotency_key: idemKey, quote_token: q.json.quote_token,
    },
  });
  assert.equal(w.status, 201, `withdraw: ${w.text}`);
  return { quote: q.json, withdrawal: w.json };
}

test.before(async () => {
  await db.initDb();
  await seed.ensureChartOfAccounts();
  await seed.ensureFeePolicyV1();
  app = express();
  app.use(express.json());
  app.use('/api/cash-wallet', createCashFlowsRouter());
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/cash-wallet`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// ---------- P2P transfers ----------

test('transfer: valid P2P debits sender and credits recipient', async () => {
  const a = await makeUser();
  const b = await makeUser();
  await fund(a.id, 100000);
  const r = await api('POST', '/transfer', {
    token: a.token,
    body: { recipient_username: await usernameOf(b.id), amount_kobo: 25000, idempotency_key: 'cf-t-ok-1' },
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.amount_kobo, 25000);
  assert.equal(r.json.currency, 'NGN');
  assert.equal(r.json.status, 'completed');
  assert.ok(r.json.transfer_id > 0);
  assert.ok(r.json.completed_at > 0);
  assert.equal(r.json.journal_keys.transfer, 'transfer:cf-t-ok-1');
  const balA = await ledger.getCashBalance(a.id);
  const balB = await ledger.getCashBalance(b.id);
  assert.equal(balA.availableKobo, 75000, 'sender debited');
  assert.equal(balB.availableKobo, 25000, 'recipient credited');
});

test('transfer: insufficient funds rejected, nothing moved', async () => {
  const a = await makeUser();
  const b = await makeUser();
  await fund(a.id, 5000);
  const jc = await journalCount();
  const r = await api('POST', '/transfer', {
    token: a.token,
    body: { recipient_username: await usernameOf(b.id), amount_kobo: 25000, idempotency_key: 'cf-t-nofunds-1' },
  });
  assert.equal(r.status, 400, r.text);
  assert.equal(await journalCount(), jc, 'no journal posted');
  assert.equal((await ledger.getCashBalance(a.id)).availableKobo, 5000);
  assert.equal((await ledger.getCashBalance(b.id)).availableKobo, 0);
});

test('transfer: concurrent overspend — exactly one wins, balance never negative', async () => {
  const a = await makeUser();
  const b = await makeUser();
  await fund(a.id, 100000);
  const bname = await usernameOf(b.id);
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) => api('POST', '/transfer', {
      token: a.token,
      body: { recipient_username: bname, amount_kobo: 100000, idempotency_key: `cf-t-race-${i}` },
    })));
  const statuses = results.map((x) => (x.status === 'fulfilled' ? x.value.status : 'threw'));
  const ok = statuses.filter((s) => s === 200).length;
  assert.equal(ok, 1, `exactly one concurrent transfer succeeds (got ${JSON.stringify(statuses)})`);
  const balA = await ledger.getCashBalance(a.id);
  const balB = await ledger.getCashBalance(b.id);
  assert.ok(balA.availableKobo >= 0, 'balance never negative');
  assert.equal(balA.availableKobo, 0);
  assert.equal(balB.availableKobo, 100000);
});

test('transfer: duplicate idempotency_key returns original receipt, no second journal', async () => {
  const a = await makeUser();
  const b = await makeUser();
  await fund(a.id, 60000);
  const body = {
    recipient_username: await usernameOf(b.id), amount_kobo: 20000, idempotency_key: 'cf-t-idem-1',
  };
  const jc = await journalCount();
  const first = await api('POST', '/transfer', { token: a.token, body });
  assert.equal(first.status, 200, first.text);
  const second = await api('POST', '/transfer', { token: a.token, body });
  assert.equal(second.status, 200, second.text);
  assert.equal(second.json.transfer_id, first.json.transfer_id, 'same transfer id');
  assert.equal(second.json.completed_at, first.json.completed_at, 'same completed_at');
  assert.equal(await journalCount(), jc + 2, 'exactly one sender+recipient journal pair');
  assert.equal((await ledger.getCashBalance(a.id)).availableKobo, 40000, 'debited once');
});

test('transfer: suspended sender blocked (403)', async () => {
  const a = await makeUser();
  const b = await makeUser();
  await fund(a.id, 50000);
  await setAccountStatus(a.id, 'suspended');
  const r = await api('POST', '/transfer', {
    token: a.token,
    body: { recipient_username: await usernameOf(b.id), amount_kobo: 10000, idempotency_key: 'cf-t-susp-1' },
  });
  assert.equal(r.status, 403, r.text);
  assert.equal((await ledger.getCashBalance(a.id)).availableKobo, 50000, 'nothing moved');
  await setAccountStatus(a.id, 'active');
});

test('transfer: recipient not found (404) and self-transfer rejected (400)', async () => {
  const a = await makeUser();
  await fund(a.id, 50000);
  const nf = await api('POST', '/transfer', {
    token: a.token,
    body: { recipient_username: 'no_such_user_xyz', amount_kobo: 10000, idempotency_key: 'cf-t-nf-1' },
  });
  assert.equal(nf.status, 404, nf.text);
  const self = await api('POST', '/transfer', {
    token: a.token,
    body: { recipient_username: await usernameOf(a.id), amount_kobo: 10000, idempotency_key: 'cf-t-self-1' },
  });
  assert.equal(self.status, 400, self.text);
});

test('transfer: amount bounds and 24h velocity cap (429)', async () => {
  const a = await makeUser();
  const b = await makeUser();
  await fund(a.id, 60000000);
  const bname = await usernameOf(b.id);
  const small = await api('POST', '/transfer', {
    token: a.token, body: { recipient_username: bname, amount_kobo: 999, idempotency_key: 'cf-t-bnd-1' },
  });
  assert.equal(small.status, 400, small.text);
  const big = await api('POST', '/transfer', {
    token: a.token, body: { recipient_username: bname, amount_kobo: 20000001, idempotency_key: 'cf-t-bnd-2' },
  });
  assert.equal(big.status, 400, big.text);
  // Two max-size transfers = ₦400k within the ₦500k/day cap.
  for (const [i, key] of ['cf-t-vel-1', 'cf-t-vel-2'].entries()) {
    const r = await api('POST', '/transfer', {
      token: a.token, body: { recipient_username: bname, amount_kobo: 20000000, idempotency_key: key },
    });
    assert.equal(r.status, 200, `velocity transfer ${i}: ${r.text}`);
  }
  // A third would push 24h completed total to ₦600k -> 429.
  const over = await api('POST', '/transfer', {
    token: a.token, body: { recipient_username: bname, amount_kobo: 20000000, idempotency_key: 'cf-t-vel-3' },
  });
  assert.equal(over.status, 429, over.text);
});

// ---------- beneficiaries ----------

test('beneficiaries: create (mock name enquiry), masked list, no full number leaks, dup 409', async () => {
  const u = await makeUser();
  const ben = await makeBeneficiary(u, '0123456789');
  assert.ok(ben.id > 0);
  assert.equal(ben.bank_code, '058');
  assert.equal(ben.account_number_masked, '******6789');
  assert.ok(typeof ben.account_name === 'string' && ben.account_name.length > 0, 'mock name filled');
  assert.equal(ben.verified, true);

  const list = await api('GET', '/beneficiaries', { token: u.token });
  assert.equal(list.status, 200, list.text);
  assert.equal(list.json.beneficiaries.length, 1);
  assert.equal(list.json.beneficiaries[0].account_number_masked, '******6789');
  assert.ok(!list.text.includes('0123456789'), 'full account number never leaks');

  const dup = await api('POST', '/beneficiaries', {
    token: u.token, body: { label: 'Again', bank_code: '058', account_number: '0123456789' },
  });
  assert.equal(dup.status, 409, dup.text);

  const badBank = await api('POST', '/beneficiaries', {
    token: u.token, body: { label: 'x', bank_code: '05', account_number: '0123456789' },
  });
  assert.equal(badBank.status, 400, badBank.text);
  const badAcct = await api('POST', '/beneficiaries', {
    token: u.token, body: { label: 'x', bank_code: '058', account_number: '12345' },
  });
  assert.equal(badAcct.status, 400, badAcct.text);
});

// ---------- withdrawals ----------

test('withdrawal quote math incl. rounding boundaries; quote response shape', async () => {
  const u = await makeUser();
  const ben = await makeBeneficiary(u, '1111222233');
  // Rounding boundaries directly on the ledger calculator (below the ₦500 quote floor).
  const p1 = await ledger.getFeePolicy(1);
  assert.equal(ledger.commissionFor(1, p1).commissionKobo, 0);
  assert.equal(ledger.commissionFor(5, p1).commissionKobo, 1, 'half-up: 0.5 kobo rounds up');
  assert.equal(ledger.commissionFor(999, p1).commissionKobo, 100);
  assert.equal(ledger.commissionFor(100000, p1).commissionKobo, 10000);
  assert.equal(ledger.commissionFor(100000, p1).netKobo, 90000);
  // Via the HTTP quote endpoint.
  const q = await api('POST', '/withdrawals/quote', {
    token: u.token, body: { beneficiary_id: ben.id, gross_kobo: 100000 },
  });
  assert.equal(q.status, 200, q.text);
  assert.equal(q.json.gross_kobo, 100000);
  assert.equal(q.json.commission_kobo, 10000);
  assert.equal(q.json.net_kobo, 90000);
  assert.equal(q.json.rate_bps, 1000);
  assert.equal(q.json.fee_policy_version, 1);
  assert.ok(/^[0-9a-f]{32}$/.test(q.json.quote_token), '32-hex quote token');
  assert.ok(q.json.expires_at - Date.now() > 9 * 60 * 1000, '10-minute expiry');
  const tooSmall = await api('POST', '/withdrawals/quote', {
    token: u.token, body: { beneficiary_id: ben.id, gross_kobo: 49999 },
  });
  assert.equal(tooSmall.status, 400, tooSmall.text);
});

test('withdrawal happy path: quote -> execute -> advance -> completed', async () => {
  const u = await makeUser();
  await fund(u.id, 200000);
  const ben = await makeBeneficiary(u, '2222333344');
  const { withdrawal } = await quoteAndWithdraw(u, ben, 100000, 'cf-w-happy-1');
  assert.equal(withdrawal.status, 'submitted');
  assert.equal(withdrawal.breakdown.gross_kobo, 100000);
  assert.equal(withdrawal.breakdown.commission_kobo, 10000);
  assert.equal(withdrawal.breakdown.net_kobo, 90000);
  assert.ok(String(withdrawal.provider_ref).startsWith('MOCK-PAY-'));
  let bal = await ledger.getCashBalance(u.id);
  assert.equal(bal.availableKobo, 100000, 'gross reserved out of available');
  assert.equal(bal.reservedKobo, 100000);

  const adv = await api('POST', `/withdrawals/${withdrawal.withdrawal_id}/mock-advance`, { token: u.token });
  assert.equal(adv.status, 200, adv.text);
  assert.equal(adv.json.status, 'completed');
  assert.ok(adv.json.completed_at > 0);
  assert.equal(adv.json.beneficiary.account_number_masked, '******3344');
  assert.ok(!adv.text.includes('2222333344'), 'full account number never leaks');
  bal = await ledger.getCashBalance(u.id);
  assert.equal(bal.availableKobo, 100000, 'available unchanged after completion');
  assert.equal(bal.reservedKobo, 0, 'reserved cleared');

  // Commission journal exists and is balanced: commission + net == gross.
  const cj = await ledger.getJournal(`withdrawal:commission:${withdrawal.withdrawal_id}`);
  assert.ok(cj, 'commission journal posted');
  const entries = await ledger.getJournalEntries(cj.id);
  let debits = 0, credits = 0;
  for (const e of entries) {
    if (e.side === 'debit') debits += e.amountKobo; else credits += e.amountKobo;
  }
  assert.equal(debits, credits);
  assert.equal(debits, 100000, 'commission + net == gross');
  const toCommission = entries.find((e) => e.accountCode === 'platform_commission');
  assert.equal(toCommission.side, 'credit');
  assert.equal(toCommission.amountKobo, 10000);
});

test('withdrawal: double-reserve impossible — same idempotency_key twice -> one reserve journal', async () => {
  const u = await makeUser();
  await fund(u.id, 150000);
  const ben = await makeBeneficiary(u, '3333444455');
  const q = await api('POST', '/withdrawals/quote', {
    token: u.token, body: { beneficiary_id: ben.id, gross_kobo: 100000 },
  });
  const body = {
    beneficiary_id: ben.id, gross_kobo: 100000,
    idempotency_key: 'cf-w-dup-1', quote_token: q.json.quote_token,
  };
  const jc = await journalCount();
  const first = await api('POST', '/withdrawals', { token: u.token, body });
  assert.equal(first.status, 201, first.text);
  // Second call: quote token already consumed, but idempotency must still replay.
  const second = await api('POST', '/withdrawals', { token: u.token, body });
  assert.equal(second.status, 200, second.text);
  assert.equal(second.json.withdrawal_id || second.json.id, first.json.withdrawal_id,
    'replay returns the original withdrawal');
  assert.equal(await journalCount(), jc + 1, 'only the single reserve journal was posted');
  const bal = await ledger.getCashBalance(u.id);
  assert.equal(bal.reservedKobo, 100000, 'reserved exactly once');
  assert.equal(bal.availableKobo, 50000);
});

test('withdrawal: failed payout releases reserved -> available and records reason', async () => {
  const u = await makeUser();
  await fund(u.id, 120000);
  const ben = await makeBeneficiary(u, '4444555566');
  const { withdrawal } = await quoteAndWithdraw(u, ben, 80000, 'cf-w-fail-1');
  const f = await api('POST', `/withdrawals/${withdrawal.withdrawal_id}/mock-fail`, {
    token: u.token, body: { reason: 'TEST provider timeout (simulated)' },
  });
  assert.equal(f.status, 200, f.text);
  assert.equal(f.json.status, 'failed');
  assert.equal(f.json.failure_reason, 'TEST provider timeout (simulated)');
  const bal = await ledger.getCashBalance(u.id);
  assert.equal(bal.reservedKobo, 0, 'reserved released');
  assert.equal(bal.availableKobo, 120000, 'gross back in available');
  // No commission journal may exist for a failed withdrawal.
  const cj = await ledger.getJournal(`withdrawal:commission:${withdrawal.withdrawal_id}`);
  assert.equal(cj, null, 'commission recognized only on completion');
});

test('withdrawal: duplicate completion advances do not double-post', async () => {
  const u = await makeUser();
  await fund(u.id, 200000);
  const ben = await makeBeneficiary(u, '5555666677');
  const { withdrawal } = await quoteAndWithdraw(u, ben, 60000, 'cf-w-dupadv-1');
  const first = await api('POST', `/withdrawals/${withdrawal.withdrawal_id}/mock-advance`, { token: u.token });
  assert.equal(first.json.status, 'completed');
  const jc = await journalCount();
  const again = await api('POST', `/withdrawals/${withdrawal.withdrawal_id}/mock-advance`, { token: u.token });
  assert.equal(again.status, 200, again.text);
  assert.equal(again.json.status, 'completed');
  assert.equal(await journalCount(), jc, 'no new journals on duplicate advance');
  const bal = await ledger.getCashBalance(u.id);
  assert.equal(bal.availableKobo, 140000);
  assert.equal(bal.reservedKobo, 0);
});

test('withdrawal: suspended sender blocked from executing', async () => {
  const u = await makeUser();
  await fund(u.id, 200000);
  const ben = await makeBeneficiary(u, '6666777788');
  const q = await api('POST', '/withdrawals/quote', {
    token: u.token, body: { beneficiary_id: ben.id, gross_kobo: 60000 },
  });
  await setAccountStatus(u.id, 'frozen');
  const w = await api('POST', '/withdrawals', {
    token: u.token,
    body: { beneficiary_id: ben.id, gross_kobo: 60000, idempotency_key: 'cf-w-susp-1', quote_token: q.json.quote_token },
  });
  assert.equal(w.status, 403, w.text);
  await setAccountStatus(u.id, 'active');
});

test('withdrawal: bad quote token rejected', async () => {
  const u = await makeUser();
  await fund(u.id, 200000);
  const ben = await makeBeneficiary(u, '7777888899');
  const q = await api('POST', '/withdrawals/quote', {
    token: u.token, body: { beneficiary_id: ben.id, gross_kobo: 60000 },
  });
  // Tampered gross vs the bound quote.
  const tampered = await api('POST', '/withdrawals', {
    token: u.token,
    body: { beneficiary_id: ben.id, gross_kobo: 90000, idempotency_key: 'cf-w-badq-1', quote_token: q.json.quote_token },
  });
  assert.equal(tampered.status, 400, tampered.text);
  const bogus = await api('POST', '/withdrawals', {
    token: u.token,
    body: { beneficiary_id: ben.id, gross_kobo: 60000, idempotency_key: 'cf-w-badq-2', quote_token: 'deadbeef'.repeat(4) },
  });
  assert.equal(bogus.status, 400, bogus.text);
});

test('withdrawal: authz — user B cannot read/advance/fail user A withdrawal', async () => {
  const a = await makeUser();
  const b = await makeUser();
  await fund(a.id, 200000);
  const ben = await makeBeneficiary(a, '8888999900');
  const { withdrawal } = await quoteAndWithdraw(a, ben, 60000, 'cf-w-authz-1');
  const wid = withdrawal.withdrawal_id;
  for (const [method, path, body] of [
    ['GET', `/withdrawals/${wid}`, undefined],
    ['POST', `/withdrawals/${wid}/mock-advance`, undefined],
    ['POST', `/withdrawals/${wid}/mock-fail`, { reason: 'x' }],
  ]) {
    const r = await api(method, path, { token: b.token, body });
    assert.equal(r.status, 404, `${method} ${path} as user B: ${r.text}`);
  }
  // Owner can still see it.
  const own = await api('GET', `/withdrawals/${wid}`, { token: a.token });
  assert.equal(own.status, 200, own.text);
});

// ---------- feature flag off ----------

test('403 on all routes when CASH_OPS_ENABLED is unset', async () => {
  delete process.env.CASH_OPS_ENABLED;
  try {
    const u = await makeUser();
    const paths = [
      ['GET', '/beneficiaries', undefined],
      ['POST', '/beneficiaries', { label: 'x', bank_code: '058', account_number: '0123456789' }],
      ['POST', '/transfer', { recipient_username: 'nobody', amount_kobo: 1000, idempotency_key: 'k' }],
      ['POST', '/withdrawals/quote', { beneficiary_id: 1, gross_kobo: 50000 }],
      ['POST', '/withdrawals', { beneficiary_id: 1, gross_kobo: 50000, idempotency_key: 'k', quote_token: 'k' }],
      ['GET', '/withdrawals/1', undefined],
      ['POST', '/withdrawals/1/mock-advance', undefined],
      ['POST', '/withdrawals/1/mock-fail', { reason: 'x' }],
    ];
    for (const [method, path, body] of paths) {
      const r = await api(method, path, { token: u.token, body });
      assert.equal(r.status, 403, `${method} ${path} should 403 when cash ops are off (got ${r.status})`);
    }
  } finally {
    process.env.CASH_OPS_ENABLED = 'true';
  }
});
