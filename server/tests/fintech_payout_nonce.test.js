
// Regression test: mock payout IDs must be unique per withdrawal.
// provider_ref is UNIQUE in the DB, so two identical withdrawals by one
// user to one beneficiary previously collided (MOCK-PAY-<hash(user,amount,
// hint)>). The withdrawal id is now mixed in as a nonce.
import test from 'node:test';
import assert from 'node:assert/strict';
import { submitPayout } from '../src/fintech/mockProvider.js';

test('mock payout ids: identical params with different nonces do not collide', async () => {
  const a = await submitPayout({ userId: 7, amountKobo: 9000, destinationHint: 'MOCK-ACCT-1234', nonce: 101 });
  const b = await submitPayout({ userId: 7, amountKobo: 9000, destinationHint: 'MOCK-ACCT-1234', nonce: 102 });
  assert.ok(a.payoutId.startsWith('MOCK-PAY-'));
  assert.notEqual(a.payoutId, b.payoutId);
});

test('mock payout ids: same nonce stays deterministic', async () => {
  const a = await submitPayout({ userId: 7, amountKobo: 9000, destinationHint: 'MOCK-ACCT-1234', nonce: 101 });
  const b = await submitPayout({ userId: 7, amountKobo: 9000, destinationHint: 'MOCK-ACCT-1234', nonce: 101 });
  assert.equal(a.payoutId, b.payoutId);
});
