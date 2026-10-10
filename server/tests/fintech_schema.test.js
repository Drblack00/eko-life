// Fintech foundation (Worker A) schema smoke tests.
// Boots an in-memory SQLite DB via initDb(), then verifies:
//  - every fintech table exists with the expected columns
//  - the seed module is idempotent (run twice, same rows)
//  - one clearly-fake row per table inserts cleanly (FKs/checks hold)
//  - negative amounts and non-NGN currency are rejected
//  - the partial unique index on ledger_journals.provider_ref ignores NULLs
//  - self-transfers are rejected
// All data here is clearly fake (smoke-test users created via createUser,
// 'smoke-*' keys, '0123456789' account number) — no real data.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.EKO_DB_PATH = ':memory:';

const { initDb, dbRun, dbGet, dbAll, createUser } = await import('../src/db.js');
const { ensureChartOfAccounts, ensureFeePolicyV1 } = await import('../src/fintech/seed.js');

// FKs are enforced on this backend (node:sqlite), so the test creates
// two clearly-fake users up front and points every user_id FK at them.
let FAKE_USER, FAKE_PEER;
test.before(async () => {
  await initDb();
  FAKE_USER = await createUser({ username: 'fintech_smoke_user' });
  FAKE_PEER = await createUser({ username: 'fintech_smoke_peer' });
});

const EXPECTED_COLUMNS = {
  ledger_accounts: ['id', 'code', 'name', 'kind', 'created_at'],
  ledger_journals: ['id', 'journal_key', 'type', 'status', 'user_id', 'related_journal_id',
    'provider_ref', 'currency', 'memo', 'metadata', 'created_at', 'posted_at'],
  ledger_entries: ['id', 'journal_id', 'account_id', 'side', 'amount_kobo', 'currency', 'created_at'],
  cash_wallets: ['user_id', 'available_kobo', 'reserved_kobo', 'currency', 'updated_at'],
  cash_deposits: ['id', 'user_id', 'journal_key', 'amount_kobo', 'currency', 'provider',
    'provider_ref', 'status', 'confirmed_at', 'metadata', 'created_at', 'updated_at'],
  cash_transfers: ['id', 'sender_id', 'recipient_id', 'journal_key', 'amount_kobo', 'currency',
    'status', 'idempotency_key', 'memo', 'created_at', 'completed_at'],
  cash_withdrawal_beneficiaries: ['id', 'user_id', 'label', 'bank_code', 'account_number',
    'account_name', 'verified', 'created_at'],
  cash_withdrawal_requests: ['id', 'user_id', 'beneficiary_id', 'journal_key', 'gross_kobo',
    'commission_kobo', 'net_kobo', 'fee_policy_version', 'currency', 'status', 'provider_ref',
    'failure_reason', 'created_at', 'updated_at', 'completed_at'],
  provider_events: ['id', 'provider', 'event_type', 'provider_ref', 'payload',
    'signature_valid', 'processed', 'created_at'],
  fee_policies: ['version', 'rate_bps', 'rounding', 'applies_from', 'memo', 'created_at'],
  fintech_audit_logs: ['id', 'actor', 'action', 'entity', 'entity_id', 'detail', 'created_at'],
};

test('all fintech tables exist', async () => {
  const rows = await dbAll(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
    "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'",
    []);
  const names = new Set(rows.map((r) => r.name));
  for (const t of Object.keys(EXPECTED_COLUMNS)) {
    assert.ok(names.has(t), `missing table ${t}`);
  }
});

test('every fintech table has exactly the expected columns', async () => {
  for (const [table, cols] of Object.entries(EXPECTED_COLUMNS)) {
    // table names come from the constant above — never from user input.
    const rows = await dbAll(
      `SELECT name FROM pragma_table_info('${table}')`,
      `SELECT column_name AS name FROM information_schema.columns WHERE table_name = '${table}'`,
      []);
    assert.deepEqual(new Set(rows.map((r) => r.name)), new Set(cols), table);
  }
});

test('seed is idempotent and inserts the 8 accounts + fee policy v1', async () => {
  await ensureChartOfAccounts();
  await ensureFeePolicyV1();
  await ensureChartOfAccounts(); // second run must change nothing
  await ensureFeePolicyV1();
  const accts = await dbAll(
    'SELECT code, kind FROM ledger_accounts ORDER BY code',
    'SELECT code, kind FROM ledger_accounts ORDER BY code',
    []);
  assert.equal(accts.length, 8);
  assert.deepEqual(Object.fromEntries(accts.map((a) => [a.code, a.kind])), {
    customer_available: 'liability',
    customer_reserved: 'liability',
    provider_clearing: 'clearing',
    deposit_processing: 'clearing',
    withdrawal_clearing: 'clearing',
    platform_commission: 'revenue',
    provider_fees: 'expense',
    refunds_chargebacks: 'clearing',
  });
  const pol = await dbAll(
    'SELECT version, rate_bps, rounding FROM fee_policies',
    'SELECT version, rate_bps, rounding FROM fee_policies',
    []);
  assert.equal(pol.length, 1);
  assert.equal(pol[0].version, 1);
  assert.equal(pol[0].rate_bps, 1000);
  assert.equal(pol[0].rounding, 'half_up');
});

test('one fake row per table inserts cleanly (FKs and CHECKs hold)', async () => {
  const now = Date.now();

  await ensureChartOfAccounts();
  await ensureFeePolicyV1();

  const accountId = async (code) => (await dbGet(
    'SELECT id FROM ledger_accounts WHERE code = ?',
    'SELECT id FROM ledger_accounts WHERE code = $1',
    [code])).id;

  // journal + balanced double-entry lines (Dr deposit_processing / Cr customer_available)
  await dbRun(
    `INSERT INTO ledger_journals (journal_key, type, status, user_id, currency, memo, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    `INSERT INTO ledger_journals (journal_key, type, status, user_id, currency, memo, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    ['smoke-journal-1', 'deposit', 'posted', null, 'NGN', 'smoke test journal', now]);
  const j = await dbGet(
    'SELECT id FROM ledger_journals WHERE journal_key = ?',
    'SELECT id FROM ledger_journals WHERE journal_key = $1',
    ['smoke-journal-1']);
  const depositProcessing = await accountId('deposit_processing');
  const customerAvailable = await accountId('customer_available');
  for (const [acct, side] of [[depositProcessing, 'debit'], [customerAvailable, 'credit']]) {
    await dbRun(
      `INSERT INTO ledger_entries (journal_id, account_id, side, amount_kobo, currency, created_at)
       VALUES (?,?,?,?,?,?)`,
      `INSERT INTO ledger_entries (journal_id, account_id, side, amount_kobo, currency, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [j.id, acct, side, 25000, 'NGN', now]);
  }

  // cash wallet (separate from gameplay coins)
  await dbRun(
    `INSERT INTO cash_wallets (user_id, available_kobo, reserved_kobo, currency, updated_at)
     VALUES (?,?,?,?,?)`,
    `INSERT INTO cash_wallets (user_id, available_kobo, reserved_kobo, currency, updated_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [FAKE_USER, 25000, 0, 'NGN', now]);

  // deposit
  await dbRun(
    `INSERT INTO cash_deposits (user_id, journal_key, amount_kobo, currency, provider, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    `INSERT INTO cash_deposits (user_id, journal_key, amount_kobo, currency, provider, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [FAKE_USER, 'smoke-deposit-1', 25000, 'NGN', 'mock', 'pending', now, now]);

  // P2P transfer
  await dbRun(
    `INSERT INTO cash_transfers (sender_id, recipient_id, journal_key, amount_kobo, currency, status, idempotency_key, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    `INSERT INTO cash_transfers (sender_id, recipient_id, journal_key, amount_kobo, currency, status, idempotency_key, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [FAKE_USER, FAKE_PEER, 'smoke-transfer-1', 5000, 'NGN', 'completed', 'smoke-idem-1', now]);

  // beneficiary (clearly-fake account number)
  await dbRun(
    `INSERT INTO cash_withdrawal_beneficiaries (user_id, label, bank_code, account_number, account_name, verified, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    `INSERT INTO cash_withdrawal_beneficiaries (user_id, label, bank_code, account_number, account_name, verified, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [FAKE_USER, 'Smoke Test Bank', '999', '0123456789', 'TEST ACCOUNT', 0, now]);
  const ben = await dbGet(
    'SELECT id FROM cash_withdrawal_beneficiaries WHERE user_id = ? AND bank_code = ?',
    'SELECT id FROM cash_withdrawal_beneficiaries WHERE user_id = $1 AND bank_code = $2',
    [FAKE_USER, '999']);

  // withdrawal request (gross 10000, 10% commission = 1000, net 9000)
  await dbRun(
    `INSERT INTO cash_withdrawal_requests (user_id, beneficiary_id, journal_key, gross_kobo, commission_kobo,
       net_kobo, fee_policy_version, currency, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    `INSERT INTO cash_withdrawal_requests (user_id, beneficiary_id, journal_key, gross_kobo, commission_kobo,
       net_kobo, fee_policy_version, currency, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [FAKE_USER, ben.id, 'smoke-withdrawal-1', 10000, 1000, 9000, 1, 'NGN', 'requested', now, now]);

  // provider event + audit log
  await dbRun(
    `INSERT INTO provider_events (provider, event_type, provider_ref, payload, processed, created_at)
     VALUES (?,?,?,?,?,?)`,
    `INSERT INTO provider_events (provider, event_type, provider_ref, payload, processed, created_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    ['mock', 'deposit.confirmed', 'smoke-provider-ref-1', '{"fake":true}', 0, now]);
  await dbRun(
    `INSERT INTO fintech_audit_logs (actor, action, entity, entity_id, detail, created_at)
     VALUES (?,?,?,?,?,?)`,
    `INSERT INTO fintech_audit_logs (actor, action, entity, entity_id, detail, created_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    ['system', 'smoke_test', 'ledger_journals', String(j.id), '{"fake":true}', now]);

  // spot-check reads
  const w = await dbGet(
    'SELECT available_kobo, reserved_kobo FROM cash_wallets WHERE user_id = ?',
    'SELECT available_kobo, reserved_kobo FROM cash_wallets WHERE user_id = $1',
    [FAKE_USER]);
  assert.equal(w.available_kobo, 25000);
  assert.equal(w.reserved_kobo, 0);
  const bal = await dbGet(
    `SELECT SUM(CASE WHEN side = 'debit' THEN amount_kobo ELSE -amount_kobo END) AS net
     FROM ledger_entries WHERE journal_id = ?`,
    `SELECT SUM(CASE WHEN side = 'debit' THEN amount_kobo ELSE -amount_kobo END) AS net
     FROM ledger_entries WHERE journal_id = $1`,
    [j.id]);
  assert.equal(bal.net, 0); // debits == credits
});

test('negative amounts are rejected', async () => {
  // FAKE_PEER has no wallet row yet: FK passes, so the CHECK must fire.
  await assert.rejects(() => dbRun(
    `INSERT INTO ledger_entries (journal_id, account_id, side, amount_kobo, currency, created_at)
     VALUES (1,1,'debit',-1,'NGN',1)`,
    `INSERT INTO ledger_entries (journal_id, account_id, side, amount_kobo, currency, created_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    []), /CHECK constraint failed|check constraint/i);
  await assert.rejects(() => dbRun(
    `INSERT INTO cash_wallets (user_id, available_kobo, reserved_kobo, currency, updated_at)
     VALUES (?, -5, 0, 'NGN', 1)`,
    `INSERT INTO cash_wallets (user_id, available_kobo, reserved_kobo, currency, updated_at)
     VALUES ($1, -5, 0, 'NGN', 1)`,
    [FAKE_PEER]), /CHECK constraint failed|check constraint/i);
});

test('non-NGN currency is rejected', async () => {
  await assert.rejects(() => dbRun(
    `INSERT INTO ledger_entries (journal_id, account_id, side, amount_kobo, currency, created_at)
     VALUES (1,1,'debit',100,'USD',1)`,
    `INSERT INTO ledger_entries (journal_id, account_id, side, amount_kobo, currency, created_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    []), /CHECK constraint failed|check constraint/i);
  await assert.rejects(() => dbRun(
    `INSERT INTO cash_wallets (user_id, available_kobo, reserved_kobo, currency, updated_at)
     VALUES (?, 0, 0, 'USD', 1)`,
    `INSERT INTO cash_wallets (user_id, available_kobo, reserved_kobo, currency, updated_at)
     VALUES ($1, 0, 0, 'USD', 1)`,
    [FAKE_PEER]), /CHECK constraint failed|check constraint/i);
});

test('partial unique index on provider_ref ignores NULLs but blocks duplicates', async () => {
  const now = Date.now();
  const insertJournal = (key, ref) => dbRun(
    `INSERT INTO ledger_journals (journal_key, type, created_at, provider_ref) VALUES (?,?,?,?)`,
    `INSERT INTO ledger_journals (journal_key, type, created_at, provider_ref) VALUES ($1,$2,$3,$4)`,
    [key, 'deposit', now, ref]);
  await insertJournal('smoke-nullref-1', null); // two NULLs must both succeed
  await insertJournal('smoke-nullref-2', null);
  await insertJournal('smoke-dupref-1', 'dup-provider-ref');
  await assert.rejects(() => insertJournal('smoke-dupref-2', 'dup-provider-ref'),
    /UNIQUE constraint failed|duplicate key/i);
});

test('self-transfers are rejected', async () => {
  await assert.rejects(() => dbRun(
    `INSERT INTO cash_transfers (sender_id, recipient_id, journal_key, amount_kobo, currency, status, idempotency_key, created_at)
     VALUES (777777,777777,'smoke-self-1',100,'NGN','pending','smoke-self-idem-1',1)`,
    `INSERT INTO cash_transfers (sender_id, recipient_id, journal_key, amount_kobo, currency, status, idempotency_key, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    []), /CHECK constraint failed|check constraint/i);
});
