// ============================================================
// fintech/mockProvider.js — MOCK payment-provider adapter.
//
// *** MOCK ONLY — NOT LIVE INFRASTRUCTURE ***
//
// This module is a stub interface shaped like a real cash-in/cash-out
// provider adapter (deposit references, payout submission/status), but
// every function returns fake, deterministic, clearly-labeled results
// and touches nothing outside this process.
//
// Rules:
// - NEVER treat these functions as a live integration.
// - NEVER put real provider credentials, API keys, webhook secrets,
//   or account numbers in this file (or anywhere in the repo).
// - Wiring a real provider requires explicit provider approval AND
//   CASH_OPS_ENABLED=true (see config.js). Until then, cash stays off
//   and these mocks are only useful for local flow testing.
//
// All money values are integer kobo. Identifiers are obviously fake
// ('MOCK-...') so they can never be mistaken for real references.
// ============================================================

// Tiny deterministic string hash -> 8 uppercase hex chars. Same input
// always yields the same fake reference (no randomness, no Date.now
// in the identifier itself).
function fakeHash(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0').toUpperCase();
}

function assertKobo(amountKobo, label) {
  if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0) {
    throw new Error(`[mockProvider] ${label} must be a positive integer kobo amount`);
  }
}

// MOCK: pretend to create a deposit reference for a user.
// Returns a deterministic fake reference; no network call happens.
export async function createDepositReference({ userId, amountKobo }) {
  assertKobo(amountKobo, 'amountKobo');
  const reference = `MOCK-DEP-${fakeHash(`${userId}:${amountKobo}`)}`;
  return {
    mock: true,
    reference,
    userId: Number(userId),
    amountKobo,
    currency: 'NGN',
    status: 'pending',
    createdAt: Date.now(),
    note: 'MOCK — no real deposit was created. Live wiring requires provider approval + CASH_OPS_ENABLED=true.',
  };
}

// MOCK: pretend to verify a deposit reference.
// Deterministic: always reports 'confirmed' for any MOCK- reference.
export async function verifyDeposit(reference, expectedAmountKobo = null) {
  if (typeof reference !== 'string' || !reference.startsWith('MOCK-')) {
    throw new Error('[mockProvider] verifyDeposit only accepts MOCK- references');
  }
  if (expectedAmountKobo !== null) assertKobo(expectedAmountKobo, 'expectedAmountKobo');
  return {
    mock: true,
    reference,
    status: 'confirmed',
    amountKobo: expectedAmountKobo,
    currency: 'NGN',
    confirmedAt: Date.now(),
    note: 'MOCK — no real money moved. Live wiring requires provider approval + CASH_OPS_ENABLED=true.',
  };
}

// MOCK: pretend to submit a payout to a destination account.
// Returns a deterministic fake payout id in 'queued' status.
// `nonce` (e.g. the withdrawal request id) is mixed into the hash so two
// otherwise-identical payouts never share a provider_ref — provider_ref
// is UNIQUE in the database, and a collision would fail the withdrawal.
export async function submitPayout({ userId, amountKobo, destinationHint = 'MOCK-ACCOUNT', nonce = '' }) {
  assertKobo(amountKobo, 'amountKobo');
  const payoutId = `MOCK-PAY-${fakeHash(`${userId}:${amountKobo}:${destinationHint}:${nonce}`)}`;
  return {
    mock: true,
    payoutId,
    userId: Number(userId),
    amountKobo,
    currency: 'NGN',
    destinationHint,
    status: 'queued',
    submittedAt: Date.now(),
    note: 'MOCK — no real payout was submitted. Live wiring requires provider approval + CASH_OPS_ENABLED=true.',
  };
}

// MOCK: pretend to resolve a bank account number to its account name
// (what a real provider calls a "name enquiry" / account lookup).
// Deterministic: the same (bankCode, accountNumber) always yields the
// same fake name. Returns a MASKED account number — never the full one.
// The names below are invented placeholder names, clearly labeled MOCK.
const MOCK_ACCOUNT_NAMES = [
  'Adaeze Okafor', 'Tunde Bakare', 'Chiamaka Eze', 'Olumide Adeyemi',
  'Ngozi Nwachukwu', 'Emeka Obi', 'Funke Alabi', 'Ibrahim Musa',
  'Yetunde Sule', 'Chinedu Nwosu', 'Aisha Bello', 'Segun Ogunleye',
  'Halima Yusuf', 'Damilola Ajayi', 'Obinna Eke', 'Mariam Lawal',
];

export async function nameEnquiry({ bankCode, accountNumber }) {
  if (!/^\d{3,6}$/.test(String(bankCode || ''))) {
    throw new Error('[mockProvider] nameEnquiry: bankCode must be 3-6 digits');
  }
  if (!/^\d{10}$/.test(String(accountNumber || ''))) {
    throw new Error('[mockProvider] nameEnquiry: accountNumber must be exactly 10 digits (NUBAN)');
  }
  const pick = parseInt(fakeHash(`${bankCode}:${accountNumber}`).slice(0, 4), 16)
    % MOCK_ACCOUNT_NAMES.length;
  return {
    mock: true,
    bankCode: String(bankCode),
    accountName: MOCK_ACCOUNT_NAMES[pick],
    accountNumberMasked: `******${String(accountNumber).slice(-4)}`,
    verified: true,
    checkedAt: Date.now(),
    note: 'MOCK — no real bank lookup was performed. The name is invented and deterministic for this input only. Live wiring requires provider approval + CASH_OPS_ENABLED=true.',
  };
}

// MOCK: pretend to check a payout's status.
// Deterministic: always reports 'settled' for any MOCK- payout id.
export async function getPayoutStatus(payoutId) {
  if (typeof payoutId !== 'string' || !payoutId.startsWith('MOCK-')) {
    throw new Error('[mockProvider] getPayoutStatus only accepts MOCK- payout ids');
  }
  return {
    mock: true,
    payoutId,
    status: 'settled',
    settledAt: Date.now(),
    note: 'MOCK — no real settlement happened. Live wiring requires provider approval + CASH_OPS_ENABLED=true.',
  };
}
