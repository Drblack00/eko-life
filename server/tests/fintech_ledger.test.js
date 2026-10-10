// Fintech foundation tests: double-entry ledger engine, commission
// calculator, feature-flag config, mock provider.
//
// Fintech foundation tests: double-entry ledger engine, commission
// calculator, feature-flag config, mock provider.
//
// Schema + chart-of-accounts/fee-policy seeds come from Worker A:
// tables live in db.js (initDb), seeds in src/fintech/seed.js.
// This file only adds a TEST v2 fee policy (750 bps) to prove
// policy versioning.
//
// All amounts are integer kobo. No live credentials anywhere; mock
// provider identifiers are obviously fake ('MOCK-...', 'TEST-...').
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.EKO_DB_PATH = ':memory:';
delete process.env.CASH_OPS_ENABLED;

const db = await import('../src/db.js');
const ledger = await import('../src/fintech/ledger.js');
const config = await import('../src/fintech/config.js');
const mockProvider = await import('../src/fintech/mockProvider.js');
const seed = await import('../src/fintech/seed.js');

let uidSeq = 0;
async function makeUser() {
  uidSeq++;
  return db.createUser({ username: `fintech_test_u${uidSeq}_${Date.now()}`, is_guest: true });
}

async function journalCount() {
  const r = await db.dbGet('SELECT COUNT(*) AS c FROM ledger_journals', 'SELECT COUNT(*) AS c FROM ledger_journals', []);
  return Number(r.c);
}

async function entryCount(journalId) {
  const r = await db.dbGet(
    'SELECT COUNT(*) AS c FROM ledger_entries WHERE journal_id = ?',
    'SELECT COUNT(*) AS c FROM ledger_entries WHERE journal_id = $1', [journalId]);
  return Number(r.c);
}

// Deposit-style journal: debit deposit_processing / credit customer_available.
function depositEntries(amountKobo) {
  return [
    { accountCode: 'deposit_processing', side: 'debit', amountKobo },
    { accountCode: 'customer_available', side: 'credit', amountKobo },
  ];
}

test.before(async () => {
  await db.initDb();
  // Worker A seeds: 8 chart-of-accounts rows + fee policy v1 (10%).
  await seed.ensureChartOfAccounts();
  await seed.ensureFeePolicyV1();
  // TEST-only v2 policy (7.5%) to prove policy versioning works.
  const now = Date.now();
  await db.dbRun(
    `INSERT INTO fee_policies (version, rate_bps, rounding, applies_from, memo, created_at)
     VALUES (?,?,?,?,?,?) ON CONFLICT(version) DO NOTHING`,
    `INSERT INTO fee_policies (version, rate_bps, rounding, applies_from, memo, created_at)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(version) DO NOTHING`,
    [2, 750, 'half_up', now, 'TEST seed policy v2 (7.5%)', now]);
});

// ---------- schema sanity ----------
test('fintech schema seeded: 8 accounts, 2 fee policies', async () => {
  const accts = await db.dbAll('SELECT code, kind FROM ledger_accounts ORDER BY code', 'SELECT code, kind FROM ledger_accounts ORDER BY code', []);
  assert.equal(accts.length, 8);
  const codes = accts.map(a => a.code);
  for (const c of ['customer_available', 'customer_reserved', 'provider_clearing',
    'deposit_processing', 'withdrawal_clearing', 'platform_commission',
    'provider_fees', 'refunds_chargebacks']) {
    assert.ok(codes.includes(c), `missing account ${c}`);
  }
  const p1 = await ledger.getFeePolicy(1);
  assert.equal(p1.rateBps, 1000);
  assert.equal(p1.rounding, 'half_up');
});

// ---------- balanced posting ----------
test('balanced deposit journal posts; wallet credited; debits == credits in DB', async () => {
  const userId = await makeUser();
  const { journal, entries } = await ledger.postJournal({
    journalKey: 't-deposit-1', type: 'deposit', userId,
    entries: depositEntries(50000), memo: 'TEST deposit',
    metadata: { test: true },
  });
  assert.equal(journal.status, 'posted');
  assert.equal(journal.journalKey, 't-deposit-1');
  assert.equal(entries.length, 2);
  assert.deepEqual(journal.metadata, { test: true });

  const bal = await ledger.getCashBalance(userId);
  assert.equal(bal.availableKobo, 50000);
  assert.equal(bal.reservedKobo, 0);
  assert.equal(bal.currency, 'NGN');

  // Read back from the DB: sums must balance.
  const dbEntries = await ledger.getJournalEntries(journal.id);
  let d = 0, c = 0;
  for (const e of dbEntries) {
    assert.ok(Number.isInteger(e.amountKobo), 'amount must be integer');
    if (e.side === 'debit') d += e.amountKobo; else c += e.amountKobo;
  }
  assert.equal(d, 50000);
  assert.equal(c, 50000);
  assert.equal(d, c);
});

// ---------- unbalanced journal ----------
test('unbalanced journal throws UnbalancedJournalError and posts NOTHING', async () => {
  const userId = await makeUser();
  const before = await journalCount();
  const balBefore = await ledger.getCashBalance(userId);
  await assert.rejects(
    ledger.postJournal({
      journalKey: 't-unbalanced-1', type: 'deposit', userId,
      entries: [
        { accountCode: 'deposit_processing', side: 'debit', amountKobo: 100 },
        { accountCode: 'customer_available', side: 'credit', amountKobo: 99 },
      ],
    }),
    (err) => err.name === 'UnbalancedJournalError');
  assert.equal(await journalCount(), before, 'no journal row may be written');
  assert.deepEqual(await ledger.getCashBalance(userId), balBefore, 'wallet untouched');
  assert.equal(await ledger.getJournal('t-unbalanced-1'), null);
});

// ---------- idempotency ----------
test('idempotent replay: same journalKey posts once, wallet credited once', async () => {
  const userId = await makeUser();
  const before = await journalCount();
  const first = await ledger.postJournal({
    journalKey: 't-idem-1', type: 'deposit', userId, entries: depositEntries(25000),
  });
  const second = await ledger.postJournal({
    journalKey: 't-idem-1', type: 'deposit', userId, entries: depositEntries(25000),
  });
  assert.equal(first.journal.id, second.journal.id, 'replay returns the same journal');
  assert.equal(second.entries.length, 2, 'replay returns existing entries');
  assert.equal(await journalCount(), before + 1, 'exactly one journal row');
  assert.equal(await entryCount(first.journal.id), 2, 'entries not duplicated');
  const bal = await ledger.getCashBalance(userId);
  assert.equal(bal.availableKobo, 25000, 'wallet credited exactly once');
});

// ---------- insufficient funds ----------
test('debit beyond balance throws InsufficientFundsError; nothing posted', async () => {
  const userId = await makeUser();
  await ledger.postJournal({
    journalKey: 't-funds-fund', type: 'deposit', userId, entries: depositEntries(10000),
  });
  const before = await journalCount();
  await assert.rejects(
    ledger.postJournal({
      journalKey: 't-funds-overspend', type: 'withdrawal', userId,
      entries: [
        { accountCode: 'customer_available', side: 'debit', amountKobo: 10001 },
        { accountCode: 'withdrawal_clearing', side: 'credit', amountKobo: 10001 },
      ],
    }),
    (err) => err.name === 'InsufficientFundsError');
  assert.equal(await journalCount(), before);
  assert.equal((await ledger.getCashBalance(userId)).availableKobo, 10000);
});

// ---------- invalid amounts ----------
test('negative / zero / non-integer amounts and bad entries are rejected', async () => {
  const userId = await makeUser();
  const badAmounts = [-5, 0, 10.5, NaN, '100', Infinity, 2 ** 60 * 16];
  for (const amountKobo of badAmounts) {
    await assert.rejects(
      ledger.postJournal({
        journalKey: `t-bad-amt-${String(amountKobo)}`, type: 'deposit', userId,
        entries: [
          { accountCode: 'deposit_processing', side: 'debit', amountKobo },
          { accountCode: 'customer_available', side: 'credit', amountKobo: 100 },
        ],
      }),
      (err) => err.name === 'LedgerValidationError',
      `amount ${String(amountKobo)} should be rejected`);
  }
  // Fewer than 2 entries.
  await assert.rejects(
    ledger.postJournal({
      journalKey: 't-bad-single', type: 'deposit', userId,
      entries: [{ accountCode: 'customer_available', side: 'credit', amountKobo: 100 }],
    }),
    (err) => err.name === 'LedgerValidationError');
  // Unknown account code.
  await assert.rejects(
    ledger.postJournal({
      journalKey: 't-bad-acct', type: 'deposit', userId,
      entries: [
        { accountCode: 'nope_not_real', side: 'debit', amountKobo: 100 },
        { accountCode: 'customer_available', side: 'credit', amountKobo: 100 },
      ],
    }),
    (err) => err.name === 'LedgerValidationError');
  // Invalid side.
  await assert.rejects(
    ledger.postJournal({
      journalKey: 't-bad-side', type: 'deposit', userId,
      entries: [
        { accountCode: 'deposit_processing', side: 'left', amountKobo: 100 },
        { accountCode: 'customer_available', side: 'credit', amountKobo: 100 },
      ],
    }),
    (err) => err.name === 'LedgerValidationError');
  // Customer accounts without a user.
  await assert.rejects(
    ledger.postJournal({
      journalKey: 't-bad-nouser', type: 'deposit',
      entries: depositEntries(100),
    }),
    (err) => err.name === 'LedgerValidationError');
});

// ---------- commission math ----------
test('commissionFor: 10% of ₦10,000 and half-up rounding boundaries', async () => {
  const p1 = await ledger.getFeePolicy(1);
  let r = ledger.commissionFor(1_000_000, p1); // ₦10,000 in kobo
  assert.equal(r.commissionKobo, 100_000);
  assert.equal(r.netKobo, 900_000);
  assert.equal(r.grossKobo, 1_000_000);
  assert.equal(r.rateBps, 1000);
  assert.equal(r.policyVersion, 1);
  for (const k of ['grossKobo', 'commissionKobo', 'netKobo', 'rateBps']) {
    assert.ok(Number.isInteger(r[k]), `${k} must be an integer`);
  }
  // Half-up boundaries at 1000 bps (10%): 105 -> 10.5 -> 11; 104 -> 10.4 -> 10.
  assert.equal(ledger.commissionFor(105, p1).commissionKobo, 11);
  assert.equal(ledger.commissionFor(104, p1).commissionKobo, 10);
  assert.equal(ledger.commissionFor(1, p1).commissionKobo, 0);
  assert.equal(ledger.commissionFor(0, p1).commissionKobo, 0);
  assert.equal(ledger.commissionFor(0, p1).netKobo, 0);
  // Versioning: v2 = 750 bps -> ₦10,000 gives 75,000 commission.
  const p2 = await ledger.getFeePolicy(2);
  assert.equal(p2.rateBps, 750);
  const r2 = ledger.commissionFor(1_000_000, p2);
  assert.equal(r2.commissionKobo, 75_000);
  assert.equal(r2.netKobo, 925_000);
  assert.equal(r2.policyVersion, 2);
  // Bad inputs throw.
  assert.throws(() => ledger.commissionFor(-1, p1), (e) => e.name === 'LedgerValidationError');
  assert.throws(() => ledger.commissionFor(10.5, p1), (e) => e.name === 'LedgerValidationError');
  assert.throws(() => ledger.commissionFor(100, { rate_bps: -5, rounding: 'half_up' }), (e) => e.name === 'LedgerValidationError');
  assert.throws(() => ledger.commissionFor(100, { rate_bps: 1000, rounding: 'bankers' }), (e) => e.name === 'LedgerValidationError');
  await assert.rejects(ledger.getFeePolicy(999), (e) => e.name === 'LedgerValidationError');
});

// ---------- reversal ----------
test('reverseJournal: mirrored reversal, original untouched, double-reverse throws', async () => {
  const userId = await makeUser();
  const { journal } = await ledger.postJournal({
    journalKey: 't-rev-dep', type: 'deposit', userId, entries: depositEntries(20000),
  });
  const entriesBefore = await ledger.getJournalEntries(journal.id);
  const snapshot = JSON.parse(JSON.stringify(entriesBefore));
  assert.equal((await ledger.getCashBalance(userId)).availableKobo, 20000);

  const rev = await ledger.reverseJournal(journal.id, { reason: 'TEST reversal', actor: 'test' });
  assert.equal(rev.journal.type, 'reversal');
  assert.equal(rev.journal.relatedJournalId, journal.id);
  assert.ok(rev.journal.journalKey.startsWith(`reversal:${journal.journalKey}:`));
  assert.equal(rev.journal.metadata.reason, 'TEST reversal');
  assert.equal(rev.journal.metadata.actor, 'test');

  // Mirrored sides, same amounts/accounts.
  assert.equal(rev.entries.length, entriesBefore.length);
  for (let i = 0; i < entriesBefore.length; i++) {
    const o = entriesBefore[i], m = rev.entries[i];
    assert.equal(m.accountCode, o.accountCode);
    assert.equal(m.amountKobo, o.amountKobo);
    assert.equal(m.side, o.side === 'debit' ? 'credit' : 'debit');
  }

  // Wallet restored, original status flipped, original entries byte-identical.
  assert.equal((await ledger.getCashBalance(userId)).availableKobo, 0);
  const origAfter = await ledger.getJournal('t-rev-dep');
  assert.equal(origAfter.status, 'reversed');
  assert.deepEqual(await ledger.getJournalEntries(journal.id), snapshot);

  // Double reversal of the original throws; missing journal / missing reason throw.
  await assert.rejects(
    ledger.reverseJournal(journal.id, { reason: 'TEST again' }),
    (err) => err.name === 'LedgerValidationError');
  await assert.rejects(ledger.reverseJournal(987654321, { reason: 'x' }), (e) => e.name === 'LedgerValidationError');
  await assert.rejects(ledger.reverseJournal(rev.journal.id), (e) => e.name === 'LedgerValidationError');
});

// ---------- reserve / release ----------
test('reserve/release flow tracks available and reserved correctly', async () => {
  const userId = await makeUser();
  await ledger.postJournal({
    journalKey: 't-rsv-fund', type: 'deposit', userId, entries: depositEntries(100000),
  });
  // Reserve 40,000: available -> reserved.
  await ledger.postJournal({
    journalKey: 't-rsv-lock', type: 'transfer', userId,
    entries: [
      { accountCode: 'customer_available', side: 'debit', amountKobo: 40000 },
      { accountCode: 'customer_reserved', side: 'credit', amountKobo: 40000 },
    ],
  });
  let bal = await ledger.getCashBalance(userId);
  assert.equal(bal.availableKobo, 60000);
  assert.equal(bal.reservedKobo, 40000);
  // Over-reserve must fail.
  await assert.rejects(
    ledger.postJournal({
      journalKey: 't-rsv-over', type: 'transfer', userId,
      entries: [
        { accountCode: 'customer_available', side: 'debit', amountKobo: 70000 },
        { accountCode: 'customer_reserved', side: 'credit', amountKobo: 70000 },
      ],
    }),
    (err) => err.name === 'InsufficientFundsError');
  // Release 40,000 back to available.
  await ledger.postJournal({
    journalKey: 't-rsv-release', type: 'transfer', userId,
    entries: [
      { accountCode: 'customer_reserved', side: 'debit', amountKobo: 40000 },
      { accountCode: 'customer_available', side: 'credit', amountKobo: 40000 },
    ],
  });
  bal = await ledger.getCashBalance(userId);
  assert.equal(bal.availableKobo, 100000);
  assert.equal(bal.reservedKobo, 0);
});

// ---------- concurrency / overspend ----------
test('overspend: sequential and concurrent posts — exactly one succeeds, balance never negative', async () => {
  const spendEntries = (amt) => ([
    { accountCode: 'customer_available', side: 'debit', amountKobo: amt },
    { accountCode: 'provider_clearing', side: 'credit', amountKobo: amt },
  ]);

  // Sequential.
  const u1 = await makeUser();
  await ledger.postJournal({ journalKey: 't-conc-seq-fund', type: 'deposit', userId: u1, entries: depositEntries(50000) });
  await ledger.postJournal({ journalKey: 't-conc-seq-a', type: 'withdrawal', userId: u1, entries: spendEntries(40000) });
  await assert.rejects(
    ledger.postJournal({ journalKey: 't-conc-seq-b', type: 'withdrawal', userId: u1, entries: spendEntries(40000) }),
    (err) => err.name === 'InsufficientFundsError');
  assert.equal((await ledger.getCashBalance(u1)).availableKobo, 10000);

  // Concurrent via Promise.all: both race, the ledger serializes them,
  // exactly one wins.
  const u2 = await makeUser();
  await ledger.postJournal({ journalKey: 't-conc-par-fund', type: 'deposit', userId: u2, entries: depositEntries(50000) });
  const results = await Promise.allSettled([
    ledger.postJournal({ journalKey: 't-conc-par-a', type: 'withdrawal', userId: u2, entries: spendEntries(40000) }),
    ledger.postJournal({ journalKey: 't-conc-par-b', type: 'withdrawal', userId: u2, entries: spendEntries(40000) }),
  ]);
  const ok = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected' && r.reason && r.reason.name === 'InsufficientFundsError').length;
  assert.equal(ok, 1, 'exactly one concurrent post succeeds');
  assert.equal(failed, 1, 'the other fails with InsufficientFundsError');
  const bal = await ledger.getCashBalance(u2);
  assert.equal(bal.availableKobo, 10000);
  assert.ok(bal.availableKobo >= 0, 'balance never negative');
  const posted = [await ledger.getJournal('t-conc-par-a'), await ledger.getJournal('t-conc-par-b')]
    .filter(Boolean).length;
  assert.equal(posted, 1, 'exactly one of the two racing journals exists');
});

// ---------- read helpers ----------
test('getJournal / getJournalEntries / getCashBalance read helpers', async () => {
  assert.equal(await ledger.getJournal('t-no-such-key'), null);
  const userId = await makeUser();
  const { journal } = await ledger.postJournal({
    journalKey: 't-read-1', type: 'deposit', userId, entries: depositEntries(777),
  });
  const j = await ledger.getJournal('t-read-1');
  assert.equal(j.id, journal.id);
  assert.equal(j.type, 'deposit');
  assert.equal(j.userId, userId);
  const es = await ledger.getJournalEntries(journal.id);
  assert.equal(es.length, 2);
  assert.ok(es.every(e => e.accountCode && (e.side === 'debit' || e.side === 'credit')));
  // Unknown user -> zero balances, not an error.
  assert.deepEqual(await ledger.getCashBalance(42424242), { availableKobo: 0, reservedKobo: 0, currency: 'NGN' });
});

// ---------- config ----------
test('cashOpsEnabled() defaults off; requireCashOps 403s when off', async () => {
  delete process.env.CASH_OPS_ENABLED;
  assert.equal(config.cashOpsEnabled(), false);

  const res = {
    statusCode: 0, body: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
  };
  let nextCalled = false;
  config.requireCashOps({}, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Cash operations are disabled.' });
  assert.equal(nextCalled, false);

  process.env.CASH_OPS_ENABLED = 'true';
  try {
    assert.equal(config.cashOpsEnabled(), true);
    const res2 = {
      statusCode: 0, body: null,
      status(c) { this.statusCode = c; return this; },
      json(o) { this.body = o; return this; },
    };
    let next2 = false;
    config.requireCashOps({}, res2, () => { next2 = true; });
    assert.equal(next2, true, 'middleware passes through when enabled');
    assert.equal(res2.statusCode, 0, 'no 403 written when enabled');
  } finally {
    delete process.env.CASH_OPS_ENABLED;
  }
  assert.equal(config.cashOpsEnabled(), false);
});

// ---------- mock provider ----------
test('mockProvider: deterministic fake results, clearly labeled MOCK', async () => {
  const a = await mockProvider.createDepositReference({ userId: 7, amountKobo: 50000 });
  const b = await mockProvider.createDepositReference({ userId: 7, amountKobo: 50000 });
  assert.equal(a.reference, b.reference, 'deterministic for same input');
  assert.ok(a.reference.startsWith('MOCK-DEP-'));
  assert.equal(a.mock, true);
  assert.equal(a.currency, 'NGN');

  const v = await mockProvider.verifyDeposit(a.reference, 50000);
  assert.equal(v.status, 'confirmed');
  assert.equal(v.mock, true);

  const p = await mockProvider.submitPayout({ userId: 7, amountKobo: 20000, destinationHint: 'TEST-ACCOUNT' });
  assert.ok(p.payoutId.startsWith('MOCK-PAY-'));
  assert.equal(p.status, 'queued');
  const s = await mockProvider.getPayoutStatus(p.payoutId);
  assert.equal(s.status, 'settled');
  assert.equal(s.mock, true);
});
