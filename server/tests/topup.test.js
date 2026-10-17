// PORT-P2 — top-up packs: STRUCTURE ONLY, purchase stubbed.
// No payment code paths may be active while REAL_MONEY_ENABLED=false.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-topup';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const { REAL_MONEY_ENABLED, TOPUP_PACKS } = await import('../src/routes/topup.js');

let app, base;
test.before(async () => { app = await createApp(); const port = await app.start(0); base = `http://127.0.0.1:${port}`; });
test.after(async () => { await app.close(); });

test('REAL_MONEY_ENABLED is false — real money stays off', () => {
  assert.equal(REAL_MONEY_ENABLED, false);
});

test('pack definitions: 4 packs, best value flagged, ₦/$ figures', () => {
  assert.equal(TOPUP_PACKS.length, 4);
  const byId = Object.fromEntries(TOPUP_PACKS.map((p) => [p.id, p]));
  assert.deepEqual(
    TOPUP_PACKS.map((p) => [p.ngn, p.coins]),
    [[1000, 50000], [5000, 300000], [10000, 700000], [20000, 1600000]]);
  assert.deepEqual(TOPUP_PACKS.map((p) => p.usd), [1, 4, 7, 14]);
  assert.equal(byId.big_moves.bestValue, true);
  assert.ok(TOPUP_PACKS.every((p) => p.name && p.tagline && p.icon));
});

test('GET /api/topup/packs: public, carries the disabled state', async () => {
  const r = await fetch(base + '/api/topup/packs');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.realMoneyEnabled, false);
  assert.equal(j.packs.length, 4);
  assert.ok(typeof j.notice === 'string' && /compliance/i.test(j.notice));
});

test('POST /api/topup/purchase: always refused while disabled', async () => {
  const r = await fetch(base + '/api/topup/purchase', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ packId: 'big_moves' }),
  });
  assert.equal(r.status, 403);
  const j = await r.json();
  assert.equal(j.realMoneyEnabled, false);
  assert.ok(/not available/i.test(j.error));
});

test('no payment code paths are active in the topup router', () => {
  // A stubbed router must make zero network calls and import no SDKs.
  // (Comments may name the compliance chain; code may not act on it.)
  const src = readFileSync(new URL('../src/routes/topup.js', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/fetch\s*\(/.test(code), 'topup.js must not call fetch');
  assert.ok(!/https?:\/\//.test(code), 'topup.js must not contain URLs');
  assert.ok(!/\bimport\b[^;]*(flutterwave|paystack|stripe|axios)/i.test(code), 'topup.js must not import payment SDKs');
});
