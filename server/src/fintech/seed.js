// server/src/fintech/seed.js — Fintech foundation seed data (Worker A).
//
// *** TEST-DATA SEEDING ONLY ***
// Everything in this module is clearly-fake seed data, safe to run
// repeatedly. Call after initDb(). Uses INSERT ... ON CONFLICT DO
// NOTHING / INSERT OR IGNORE, so a second run never duplicates rows.
//
// Chart of accounts — the double-entry backbone of the cash ledger:
//   customer_available  (liability) — real NGN kobo customers can spend
//   customer_reserved   (liability) — kobo locked in pending withdrawals
//   provider_clearing   (clearing)  — in-flight provider settlement
//   deposit_processing  (clearing)  — deposits awaiting confirmation
//   withdrawal_clearing (clearing)  — withdrawals awaiting payout
//   platform_commission (revenue)   — commission earned by the platform
//   provider_fees       (expense)   — provider charges paid out
//   refunds_chargebacks (clearing)  — refunds / chargeback holding
//
// Fee policy v1 — 10% commission (rate_bps 1000), rounded HALF UP to the
// nearest kobo:
//   commission_kobo = floor((gross_kobo * rate_bps + 5000) / 10000)
// (general form: add half the divisor before integer-dividing).
import { dbRun } from '../db.js';

export const CHART_OF_ACCOUNTS = [
  ['customer_available', 'Customer Available Balance', 'liability'],
  ['customer_reserved', 'Customer Reserved Balance', 'liability'],
  ['provider_clearing', 'Provider Clearing', 'clearing'],
  ['deposit_processing', 'Deposit Processing', 'clearing'],
  ['withdrawal_clearing', 'Withdrawal Clearing', 'clearing'],
  ['platform_commission', 'Platform Commission', 'revenue'],
  ['provider_fees', 'Provider Fees', 'expense'],
  ['refunds_chargebacks', 'Refunds & Chargebacks', 'clearing'],
];

export const FEE_POLICY_V1 = {
  version: 1,
  rate_bps: 1000, // 1000 bps = 10%
  rounding: 'half_up',
  memo: 'Initial TEST policy: 10% commission, round half up to nearest kobo. TEST DATA ONLY.',
};

// Inserts the 8 chart-of-accounts rows. Idempotent: safe to call on every boot.
export async function ensureChartOfAccounts() {
  const now = Date.now();
  for (const [code, name, kind] of CHART_OF_ACCOUNTS) {
    await dbRun(
      'INSERT OR IGNORE INTO ledger_accounts (code, name, kind, created_at) VALUES (?,?,?,?)',
      'INSERT INTO ledger_accounts (code, name, kind, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING',
      [code, name, kind, now]);
  }
}

// Inserts fee policy version 1. Idempotent: safe to call on every boot.
export async function ensureFeePolicyV1() {
  const now = Date.now();
  await dbRun(
    `INSERT OR IGNORE INTO fee_policies (version, rate_bps, rounding, applies_from, memo, created_at)
     VALUES (?,?,?,?,?,?)`,
    `INSERT INTO fee_policies (version, rate_bps, rounding, applies_from, memo, created_at)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (version) DO NOTHING`,
    [FEE_POLICY_V1.version, FEE_POLICY_V1.rate_bps, FEE_POLICY_V1.rounding, now, FEE_POLICY_V1.memo, now]);
}
