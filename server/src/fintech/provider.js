// ============================================================
// fintech/provider.js — provider adapter interface + factory
// (Fintech Milestone 8).
//
// ONE interface every cash provider implements. Live money stays
// OFF: the only adapter that can operate without explicit operator
// configuration is the MOCK one. Real providers (Paystack,
// Flutterwave) are SKELETONS: their API-call bodies are explicit
// TODO stubs that refuse to run until credentials exist AND the
// provider has been approved AND CASH_OPS_ENABLED=true.
//
// Rules (non-negotiable):
// - NEVER make real network calls to a provider from the mock
//   adapter, and NEVER from the skeletons until they are fully
//   wired (each TODO body says so explicitly).
// - Credentials come ONLY from environment variables. Nothing is
//   hardcoded in this file. No secret value is ever logged.
// - The factory NEVER silently falls back to mock: an unknown
//   PROVIDER, a non-mock PROVIDER without credentials, or a
//   non-mock PROVIDER while CASH_OPS_ENABLED is off throws
//   ProviderNotConfiguredError (fail closed).
// - Integer kobo everywhere.
//
// Adapter interface (each adapter implements all of these):
//   adapter.name                                            // 'mock' | 'paystack' | 'flutterwave'
//   await adapter.initiateDeposit({ amountKobo, reference?, currency?, userId? })
//   await adapter.verifyDeposit(reference)
//   await adapter.initiatePayout({ beneficiary?, netKobo, reference?, userId? })
//   await adapter.getPayoutStatus(providerRef)
//   adapter.verifyWebhookSignature(rawBody, headers, secret) // -> boolean; pure crypto, no I/O
//   adapter.parseWebhookEvent(rawBody)                      // -> { providerRef, status, amountKobo, currency, raw }
// ============================================================
import crypto from 'crypto';
import { cashOpsEnabled } from './config.js';
import {
  createDepositReference,
  verifyDeposit as mockVerifyDeposit,
  submitPayout as mockSubmitPayout,
  getPayoutStatus as mockGetPayoutStatus,
} from './mockProvider.js';

// Every method name an adapter must implement (plus `name`).
// Tests use this for interface conformance checks.
export const PROVIDER_INTERFACE = [
  'initiateDeposit',
  'verifyDeposit',
  'initiatePayout',
  'getPayoutStatus',
  'verifyWebhookSignature',
  'parseWebhookEvent',
];

// Thrown whenever a provider cannot be safely used: unknown name,
// missing credentials, cash ops disabled, or an unimplemented live
// call. Fail closed — callers must NOT catch this and fall back to
// another provider.
export class ProviderNotConfiguredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProviderNotConfiguredError';
    this.code = 'PROVIDER_NOT_CONFIGURED';
  }
}

// Timing-safe string comparison. Returns false on any mismatch or
// non-string input (never throws).
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function asRawBuffer(rawBody) {
  if (Buffer.isBuffer(rawBody)) return rawBody;
  return Buffer.from(String(rawBody == null ? '' : rawBody), 'utf8');
}

// ============================================================
// MockAdapter — *** MOCK ONLY, NOT LIVE INFRASTRUCTURE ***
//
// Thin interface-conformant wrapper around the existing
// fintech/mockProvider.js functions (deterministic fake results,
// clearly labeled MOCK, no network). Existing mock behavior is
// preserved exactly; this just adapts the shapes to the interface.
// ============================================================
export class MockAdapter {
  constructor() {
    this.name = 'mock';
  }

  // Creates a deposit reference. `reference` (caller-suggested) is
  // accepted for interface symmetry but ignored: the mock generates
  // its deterministic MOCK-DEP-<HASH> reference from (userId,
  // amountKobo) exactly like the legacy createDepositReference().
  async initiateDeposit({ amountKobo, reference = null, currency = 'NGN', userId = 0 } = {}) {
    if (currency !== 'NGN') {
      throw new Error('[provider:mock] only NGN deposits are supported');
    }
    const created = await createDepositReference({ userId, amountKobo });
    return {
      mock: true,
      reference: created.reference,
      requestedReference: reference,
      userId: created.userId,
      amountKobo: created.amountKobo,
      currency,
      status: created.status,
      note: created.note,
    };
  }

  async verifyDeposit(reference) {
    const v = await mockVerifyDeposit(reference);
    return { mock: true, reference: v.reference, status: v.status, amountKobo: v.amountKobo, currency: v.currency };
  }

  // `beneficiary` is informative only in the mock ({ label } used for
  // the deterministic fake id); no real payout is submitted.
  // `reference` is mixed into the fake id as a nonce so identical
  // payouts never collide on the UNIQUE provider_ref column.
  async initiatePayout({ beneficiary = null, netKobo, reference = null, userId = 0 } = {}) {
    const submitted = await mockSubmitPayout({
      userId,
      amountKobo: netKobo,
      destinationHint: beneficiary && beneficiary.label ? beneficiary.label : 'MOCK-ACCOUNT',
      nonce: reference == null ? '' : String(reference),
    });
    return {
      mock: true,
      providerPayoutId: submitted.payoutId,
      requestedReference: reference,
      status: submitted.status,
      netKobo: submitted.amountKobo,
      currency: 'NGN',
      note: submitted.note,
    };
  }

  async getPayoutStatus(providerRef) {
    const s = await mockGetPayoutStatus(providerRef);
    return { mock: true, providerRef: s.payoutId, status: s.status, note: s.note };
  }

  // *** TEST-ONLY SCHEME *** — mirrors the legacy mock webhook:
  // the payload is JSON and carries its own `signature` field:
  //   HMAC-SHA256 hex of `${provider_ref}|${status}|${amount_kobo}|${currency}`
  // keyed by the secret passed in. Verifies the PARSED fields against
  // the raw bytes (never trusts a re-serialized object). NOT a
  // security boundary for real money.
  verifyWebhookSignature(rawBody, headers, secret) {
    if (typeof secret !== 'string' || !secret) return false;
    let parsed;
    try {
      parsed = JSON.parse(asRawBuffer(rawBody).toString('utf8'));
    } catch {
      return false;
    }
    if (!parsed || typeof parsed !== 'object') return false;
    const { provider_ref, status, amount_kobo, currency, signature } = parsed;
    if (typeof signature !== 'string' || !signature) return false;
    const expected = crypto.createHmac('sha256', secret)
      .update(`${provider_ref}|${status}|${amount_kobo}|${currency}`)
      .digest('hex');
    return safeEqual(signature, expected);
  }

  // Normalizes the mock JSON payload to the shared event shape.
  parseWebhookEvent(rawBody) {
    let parsed;
    try {
      parsed = JSON.parse(asRawBuffer(rawBody).toString('utf8'));
    } catch {
      throw new ProviderNotConfiguredError('[provider:mock] webhook payload is not valid JSON');
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new ProviderNotConfiguredError('[provider:mock] webhook payload must be a JSON object');
    }
    return {
      providerRef: typeof parsed.provider_ref === 'string' ? parsed.provider_ref : null,
      status: typeof parsed.status === 'string' ? parsed.status : null,
      amountKobo: Number.isSafeInteger(parsed.amount_kobo) ? parsed.amount_kobo : null,
      currency: typeof parsed.currency === 'string' ? parsed.currency : null,
      raw: parsed,
    };
  }
}

// ============================================================
// PaystackAdapter — SKELETON (no live wiring).
//
// Webhook verification IS implemented for real below, following
// Paystack's documented scheme (checked against current docs on
// 2026-10-10: paystack.com/docs/payments/webhooks):
//   x-paystack-signature header = HMAC-SHA512 hex of the RAW request
//   body, keyed by your secret key. Verified with a timing-safe
//   comparison BEFORE the payload is trusted.
//
// The API-call bodies (initiateDeposit/verifyDeposit/initiatePayout/
// getPayoutStatus) are explicit TODO stubs: they throw
// ProviderNotConfiguredError until credentials exist + provider
// approval is on file (docs/PROVIDER_APPROVAL_CHECKLIST.md) + a
// real implementation is written. NEVER make network calls here.
// ============================================================
export class PaystackAdapter {
  constructor() {
    this.name = 'paystack';
    // Env ONLY. Never hardcode, never log.
    this.secretKey = process.env.PAYSTACK_SECRET_KEY || null;
    this.publicKey = process.env.PAYSTACK_PUBLIC_KEY || null;
  }

  // Fail-closed gate: every live call must pass this first.
  assertConfigured() {
    if (!cashOpsEnabled()) {
      throw new ProviderNotConfiguredError(
        'paystack: not configured — CASH_OPS_ENABLED is not true; live money stays off until provider approval + explicit enablement.');
    }
    if (!this.secretKey) {
      throw new ProviderNotConfiguredError(
        'paystack: not configured — credentials required (PAYSTACK_SECRET_KEY missing) + provider approval required. Refusing to run; never silently falling back to mock.');
    }
  }

  // TODO: live implementation requires provider approval + CASH_OPS_ENABLED=true.
  async initiateDeposit() {
    this.assertConfigured();
    throw new ProviderNotConfiguredError(
      'paystack.initiateDeposit: TODO — live API call not implemented; provider approval required.');
  }

  // TODO: live implementation requires provider approval + CASH_OPS_ENABLED=true.
  async verifyDeposit() {
    this.assertConfigured();
    throw new ProviderNotConfiguredError(
      'paystack.verifyDeposit: TODO — live API call not implemented; provider approval required.');
  }

  // TODO: live implementation requires provider approval + CASH_OPS_ENABLED=true.
  async initiatePayout() {
    this.assertConfigured();
    throw new ProviderNotConfiguredError(
      'paystack.initiatePayout: TODO — live API call not implemented; provider approval required.');
  }

  // TODO: live implementation requires provider approval + CASH_OPS_ENABLED=true.
  async getPayoutStatus() {
    this.assertConfigured();
    throw new ProviderNotConfiguredError(
      'paystack.getPayoutStatus: TODO — live API call not implemented; provider approval required.');
  }

  // REAL webhook verification (pure crypto, no I/O): HMAC-SHA512 of
  // the raw request body keyed by the secret, compared timing-safely
  // against the x-paystack-signature header. `secret` is passed in
  // (usually process.env.PAYSTACK_SECRET_KEY) — not read here.
  verifyWebhookSignature(rawBody, headers, secret) {
    if (typeof secret !== 'string' || !secret) return false;
    const h = headers || {};
    const sig = h['x-paystack-signature'] || h['X-Paystack-Signature'];
    if (typeof sig !== 'string' || !sig) return false;
    const expected = crypto.createHmac('sha512', secret).update(asRawBuffer(rawBody)).digest('hex');
    return safeEqual(sig, expected);
  }

  // Maps Paystack's documented event envelope to the shared shape.
  // Known: charge.success / charge.failed. Any other event type
  // throws (callers treat it as unprocessable, never as a deposit).
  parseWebhookEvent(rawBody) {
    let parsed;
    try {
      parsed = JSON.parse(asRawBuffer(rawBody).toString('utf8'));
    } catch {
      throw new ProviderNotConfiguredError('[provider:paystack] webhook payload is not valid JSON');
    }
    const event = parsed && parsed.event;
    const data = (parsed && parsed.data) || {};
    if (event === 'charge.success' || event === 'charge.failed') {
      return {
        providerRef: typeof data.reference === 'string' ? data.reference : null,
        status: event === 'charge.success' ? 'confirmed' : 'failed',
        amountKobo: Number.isSafeInteger(data.amount) ? data.amount : null, // Paystack amounts are kobo
        currency: typeof data.currency === 'string' ? data.currency : null,
        raw: parsed,
      };
    }
    throw new ProviderNotConfiguredError(
      `[provider:paystack] unhandled event type '${String(event)}' — TODO: map more event types before live use.`);
  }
}

// ============================================================
// FlutterwaveAdapter — SKELETON (no live wiring).
//
// Webhook verification IS implemented for real below, following
// Flutterwave's documented scheme (checked against current
// Flutterwave webhook docs on 2026-10-10): each webhook carries a
// `verif-hash` header whose value is the "secret hash" you configure
// on the Flutterwave dashboard (Settings -> Webhooks). Verification
// = timing-safe comparison of the request's verif-hash value against
// the secret-hash value kept server-side (env
// FLUTTERWAVE_WEBHOOK_HASH, or FLUTTERWAVE_WEBHOOK_SECRET).
// NOTE: this is the value comparison the docs prescribe — not an
// HMAC over the body. If your integration instead HMACs the secret,
// configure the derived value here; reconcile before live use.
//
// API-call bodies are TODO stubs (same fail-closed contract as
// PaystackAdapter). NEVER make network calls here.
// ============================================================
export class FlutterwaveAdapter {
  constructor() {
    this.name = 'flutterwave';
    // Env ONLY. Never hardcode, never log.
    // FLWSECK_TEST / FLUTTERWAVE_SECRET_KEY: v3 API secret key.
    // FLUTTERWAVE_WEBHOOK_HASH (or _SECRET): dashboard secret hash.
    this.secretKey = process.env.FLUTTERWAVE_SECRET_KEY || process.env.FLWSECK_TEST || null;
    this.webhookHash = process.env.FLUTTERWAVE_WEBHOOK_HASH || process.env.FLUTTERWAVE_WEBHOOK_SECRET || null;
  }

  // Fail-closed gate: every live call must pass this first.
  assertConfigured() {
    if (!cashOpsEnabled()) {
      throw new ProviderNotConfiguredError(
        'flutterwave: not configured — CASH_OPS_ENABLED is not true; live money stays off until provider approval + explicit enablement.');
    }
    if (!this.secretKey) {
      throw new ProviderNotConfiguredError(
        'flutterwave: not configured — credentials required (FLUTTERWAVE_SECRET_KEY / FLWSECK_TEST missing) + provider approval required. Refusing to run; never silently falling back to mock.');
    }
  }

  // TODO: live implementation requires provider approval + CASH_OPS_ENABLED=true.
  async initiateDeposit() {
    this.assertConfigured();
    throw new ProviderNotConfiguredError(
      'flutterwave.initiateDeposit: TODO — live API call not implemented; provider approval required.');
  }

  // TODO: live implementation requires provider approval + CASH_OPS_ENABLED=true.
  async verifyDeposit() {
    this.assertConfigured();
    throw new ProviderNotConfiguredError(
      'flutterwave.verifyDeposit: TODO — live API call not implemented; provider approval required.');
  }

  // TODO: live implementation requires provider approval + CASH_OPS_ENABLED=true.
  async initiatePayout() {
    this.assertConfigured();
    throw new ProviderNotConfiguredError(
      'flutterwave.initiatePayout: TODO — live API call not implemented; provider approval required.');
  }

  // TODO: live implementation requires provider approval + CASH_OPS_ENABLED=true.
  async getPayoutStatus() {
    this.assertConfigured();
    throw new ProviderNotConfiguredError(
      'flutterwave.getPayoutStatus: TODO — live API call not implemented; provider approval required.');
  }

  // REAL webhook verification (pure comparison, no I/O): compare the
  // request's verif-hash header against the configured secret-hash
  // value, timing-safely. `secret` is passed in (usually the env
  // webhook hash) — not read here.
  verifyWebhookSignature(_rawBody, headers, secret) {
    if (typeof secret !== 'string' || !secret) return false;
    const h = headers || {};
    const sig = h['verif-hash'] || h['Verif-Hash'];
    if (typeof sig !== 'string' || !sig) return false;
    return safeEqual(sig, secret);
  }

  // Maps Flutterwave's documented event envelope to the shared shape.
  // Known: charge.completed (status successful -> confirmed; anything
  // else -> failed). Any other event type throws (unprocessable).
  parseWebhookEvent(rawBody) {
    let parsed;
    try {
      parsed = JSON.parse(asRawBuffer(rawBody).toString('utf8'));
    } catch {
      throw new ProviderNotConfiguredError('[provider:flutterwave] webhook payload is not valid JSON');
    }
    const event = parsed && parsed.event;
    const data = (parsed && parsed.data) || {};
    if (event === 'charge.completed') {
      const status = data.status === 'successful' ? 'confirmed' : 'failed';
      return {
        providerRef: typeof data.tx_ref === 'string' ? data.tx_ref : null,
        status,
        amountKobo: Number.isSafeInteger(data.amount) ? data.amount : null, // Flutterwave v3 amounts are kobo for NGN
        currency: typeof data.currency === 'string' ? data.currency : null,
        raw: parsed,
      };
    }
    throw new ProviderNotConfiguredError(
      `[provider:flutterwave] unhandled event type '${String(event)}' — TODO: map more event types before live use.`);
  }
}

// ---------- webhook secret lookup ----------

// Secret value each provider's verifyWebhookSignature expects.
// Env ONLY. Returns null when not set (callers must fail closed).
// The 'mock' secret falls back to the router's test-only fallback
// constant — that fallback is handled by the caller, not here.
export function webhookSecretFor(name) {
  const n = String(name || '').toLowerCase();
  if (n === 'mock') return process.env.MOCK_WEBHOOK_SECRET || null;
  if (n === 'paystack') return process.env.PAYSTACK_SECRET_KEY || null;
  if (n === 'flutterwave') {
    return process.env.FLUTTERWAVE_WEBHOOK_HASH || process.env.FLUTTERWAVE_WEBHOOK_SECRET || null;
  }
  return null;
}

// ---------- factory ----------

// Resolve an adapter BY NAME with fail-closed semantics: unknown
// names throw; non-mock names assert configuration (credentials +
// CASH_OPS_ENABLED=true) at resolution time. NEVER falls back to
// mock silently.
export function adapterForName(name) {
  const n = String(name || '').toLowerCase();
  if (n === 'mock') return new MockAdapter();
  if (n === 'paystack') {
    const a = new PaystackAdapter();
    a.assertConfigured();
    return a;
  }
  if (n === 'flutterwave') {
    const a = new FlutterwaveAdapter();
    a.assertConfigured();
    return a;
  }
  throw new ProviderNotConfiguredError(
    `unknown provider '${String(name)}' — expected 'mock' | 'paystack' | 'flutterwave'; refusing (no silent fallback to mock).`);
}

// Read the operator's PROVIDER choice ('mock' | 'paystack' |
// 'flutterwave', default 'mock') and resolve it fail-closed.
export function getProvider() {
  return adapterForName(process.env.PROVIDER || 'mock');
}
