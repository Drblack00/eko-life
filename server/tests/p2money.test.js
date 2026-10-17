// PORT-P2 — money systems: savings accrual, term notes, credibility,
// Saturday rent, housing ladder. Uses the live app (in-memory DB).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-p2';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const p2 = await import('../src/game/v2/p2money.js');

let app, base;
test.before(async () => { app = await createApp(); const port = await app.start(0); base = `http://127.0.0.1:${port}`; });
test.after(async () => { await app.close(); });

let n = 0;
async function seedUser({ money = 1_000_000, savings = 0 } = {}) {
  n += 1;
  const id = await db.createUser({ username: 'p2seed' + n });
  const c = await db.ensureCharacter(id, 'P2T' + n);
  c.money = money;
  c.savings = savings;
  await db.saveCharacter(c);
  return { id, token: signToken(id) };
}
async function post(p, body, token) {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}
async function get(p, token) {
  const r = await fetch(base + p, { headers: { authorization: `Bearer ${token}` } });
  return { status: r.status, json: await r.json() };
}

/* ---------------- savings: per-minute accrual math ---------------- */

test('savingsInterestFor: 0.5% per game week, pro-rata per minute', () => {
  // 1 game week = 7 days × 5 real min = 35 min → 0.5% of ₦1M = ₦5,000
  assert.equal(p2.savingsInterestFor(1_000_000, 35), 5000);
  // 1 game day (5 min) → ₦714
  assert.equal(p2.savingsInterestFor(1_000_000, 5), 714);
  assert.equal(p2.savingsInterestFor(0, 35), 0);
  assert.equal(p2.savingsInterestFor(1_000_000, 0), 0);
  assert.equal(p2.savingsInterestFor(-500, 35), 0);
});

test('savingsInterestFor: only the first ₦1bn earns', () => {
  assert.equal(p2.savingsInterestFor(2_000_000_000, 35), 5_000_000); // 0.5% of capped 1bn
  assert.equal(p2.savingsInterestFor(1_000_000_000, 35), 5_000_000);
});

test('accrueSavings: simulates time passage, credits savings, writes ledger', async () => {
  const { id } = await seedUser({ money: 0, savings: 1_000_000 });
  const c = await db.getCharacter(id);
  // first run seeds the clock with no windfall
  const r1 = await p2.accrueSavings(id, c, Date.now());
  assert.equal(r1.interest, 0);
  // rewind the clock 35 real minutes (= 1 game week)
  const prof = await p2.getP2Profile(id);
  prof.savings_accrue_ms = Date.now() - 35 * 60000;
  await p2.saveP2Profile(prof);
  const r2 = await p2.accrueSavings(id, c, Date.now());
  assert.equal(r2.interest, 5000);
  assert.equal(c.savings, 1_005_000);
  const rows = await db.listTransactions(id, 50);
  const t = rows.find((x) => x.kind === 'savings_interest');
  assert.ok(t && t.amount === 5000);
});

/* ---------------- term notes ---------------- */

test('validateNoteBuy: ₦10k min, ₦500m max', () => {
  assert.equal(p2.validateNoteBuy({ amount: 9999 }).ok, false);
  assert.equal(p2.validateNoteBuy({ amount: 10000 }).ok, true);
  assert.equal(p2.validateNoteBuy({ amount: 500_000_000 }).ok, true);
  assert.equal(p2.validateNoteBuy({ amount: 500_000_001 }).ok, false);
});

test('notes: buy → list → early withdraw forfeits interest', async () => {
  const { id, token } = await seedUser({ money: 100_000 });
  let r = await post('/api/bank/notes', { amount: 5000 }, token);
  assert.equal(r.status, 400); // below min
  r = await post('/api/bank/notes', { amount: 50_000 }, token);
  assert.equal(r.status, 201);
  assert.equal(r.json.note.principal, 50000);
  assert.equal(r.json.note.interest, 1000); // 2%
  assert.equal(r.json.note.payout, 51000);
  let c = await db.getCharacter(id);
  assert.equal(Number(c.money), 50000);

  const g = await get('/api/bank/notes', token);
  assert.equal(g.json.notes.length, 1);

  // early withdrawal: principal back, interest forfeited
  const w = await post(`/api/bank/notes/${r.json.note.id}/withdraw-early`, {}, token);
  assert.equal(w.status, 200);
  assert.equal(w.json.principal, 50000);
  assert.equal(w.json.interestForfeited, 1000);
  c = await db.getCharacter(id);
  assert.equal(Number(c.money), 100000);
  // second early withdrawal → already closed
  const w2 = await post(`/api/bank/notes/${r.json.note.id}/withdraw-early`, {}, token);
  assert.equal(w2.status, 400);
});

test('notes: maturity pays principal + 2% exactly once (idempotent)', async () => {
  const { id, token } = await seedUser({ money: 100_000 });
  const bought = await post('/api/bank/notes', { amount: 20_000 }, token);
  const noteId = bought.json.note.id;
  const c0 = await db.getCharacter(id);
  // settle on day 1 (start) + 7 → due on day 8
  const c = await db.getCharacter(id);
  const s1 = await p2.settleNotes(id, c, 8, {});
  assert.equal(s1.payouts.length, 1);
  assert.equal(s1.payouts[0].payout, 20400);
  await db.saveCharacter(c);
  // re-run: no double pay
  const c2 = await db.getCharacter(id);
  const s2 = await p2.settleNotes(id, c2, 9, {});
  assert.equal(s2.payouts.length, 0);
  const cf = await db.getCharacter(id);
  assert.equal(Number(cf.money), Number(c0.money) + 20400);
  void noteId;
});

/* ---------------- Saturday rent + housing ladder ---------------- */

test('isRentSaturday: day 7/14/21, not other days', () => {
  assert.equal(p2.isRentSaturday(7), true);
  assert.equal(p2.isRentSaturday(14), true);
  assert.equal(p2.isRentSaturday(6), false);
  assert.equal(p2.isRentSaturday(8), false);
  assert.equal(p2.isRentSaturday(0), false);
});

test('housing: move in → Saturday rent paid when affordable', async () => {
  const { id, token } = await seedUser({ money: 100_000 });
  const m = await post('/api/bank/housing/move', { homeId: 'selfcon_yaba' }, token);
  assert.equal(m.status, 200);
  assert.equal(m.json.current, 'selfcon_yaba');
  const c = await db.getCharacter(id);
  const r = await p2.settleRent(id, c, 7, {});
  assert.equal(r.due, true);
  assert.equal(r.paid, true);
  assert.equal(r.rent, 15000);
  await db.saveCharacter(c);
  const cf = await db.getCharacter(id);
  assert.equal(Number(cf.money), 85000);
  const prof = await p2.getP2Profile(id);
  assert.equal(prof.rent_debt, 0);
});

test('housing: missed Saturday rent → debt flag, no eviction', async () => {
  const { id, token } = await seedUser({ money: 1000 });
  await post('/api/bank/housing/move', { homeId: 'duplex_lekki' }, token);
  const c = await db.getCharacter(id);
  const r = await p2.settleRent(id, c, 7, {});
  assert.equal(r.due, true);
  assert.equal(r.paid, false);
  assert.equal(r.debt, 90000);
  await db.saveCharacter(c);
  const cf = await db.getCharacter(id);
  assert.equal(Number(cf.money), 1000); // untouched — no hard lockout
  const prof = await p2.getP2Profile(id);
  assert.equal(prof.rent_debt, 90000);
  // non-Saturday: no rent due
  const r2 = await p2.settleRent(id, await db.getCharacter(id), 8, {});
  assert.equal(r2.due, false);
});

test('housing: buy stops rent; pay-debt clears the flag', async () => {
  const { id, token } = await seedUser({ money: 1_000_000 });
  const b = await post('/api/bank/housing/buy', { homeId: 'room_oshodi' }, token);
  assert.equal(b.status, 200);
  assert.ok(b.json.owned.includes('room_oshodi'));
  let c = await db.getCharacter(id);
  assert.equal(Number(c.money), 1_000_000 - 450000);
  // owned home → no rent due even on Saturday
  const r = await p2.settleRent(id, c, 7, {});
  assert.equal(r.due, false);

  // debt pay-down
  const prof = await p2.getP2Profile(id);
  prof.rent_debt = 20000;
  await p2.saveP2Profile(prof);
  const pd = await post('/api/bank/housing/pay-debt', { amount: 20000 }, token);
  assert.equal(pd.status, 200);
  assert.equal(pd.json.rentDebt, 0);
  const prof2 = await p2.getP2Profile(id);
  assert.equal(prof2.rent_debt, 0);
});

/* ---------------- credibility ---------------- */

test('scoreCredibility: pure scoring across the six parts', () => {
  const now = Date.now();
  const day = 86400000;
  const s = p2.scoreCredibility({
    accountAgeDays: 90,
    txs: [
      { kind: 'shop_sale', amount: -20000, created_at: now - 2 * day, counterparty: 'shop:9' },
      { kind: 'shop_earn', amount: 50000, created_at: now - 1 * day, counterparty: '@ada' },
      { kind: 'shop_earn', amount: 30000, created_at: now - 2 * day, counterparty: '@ada' },
      { kind: 'shop_earn', amount: 40000, created_at: now - 3 * day, counterparty: '@ada' },
      { kind: 'deposit', amount: -1000, created_at: now, counterparty: '' }, // ignored (not p2p)
    ],
    hasBiz: true,
    hasShop: true,
    workedPaid: true,
  });
  assert.equal(s.parts.find((x) => x.key === 'accountAge').score, 3);
  assert.equal(s.parts.find((x) => x.key === 'movedWithPlayers').score, 14); // 140k / 10k
  assert.equal(s.parts.find((x) => x.key === 'regularPartners').score, 3);   // @ada on 3 days
  assert.equal(s.parts.find((x) => x.key === 'collected').score, 12);        // 120k / 10k
  assert.equal(s.parts.find((x) => x.key === 'jobsBusiness').score, 20);
  const total = s.parts.reduce((a, x) => a + x.score, 0);
  assert.equal(s.total, Math.min(100, total));
});

test('scoreCredibility: empty history → 0 with full breakdown', () => {
  const s = p2.scoreCredibility({ accountAgeDays: 0, txs: [] });
  assert.equal(s.total, 0);
  assert.equal(s.parts.length, 6);
  assert.ok(s.parts.every((x) => x.score === 0));
});

/* ---------------- bank overview carries the P2 bundle ---------------- */

test('GET /api/bank: overview includes P2 sections', async () => {
  const { token } = await seedUser({ money: 50000 });
  const r = await get('/api/bank', token);
  assert.equal(r.status, 200);
  assert.ok(r.json.savingsTerms);
  assert.equal(r.json.savingsTerms.minWithdraw, 1000);
  assert.ok(r.json.termNotes);
  assert.equal(r.json.termNotes.rate, 0.02);
  assert.ok('credit' in r.json);
  assert.ok(r.json.credibility);
  assert.equal(r.json.credibility.recordOnly, true);
  assert.equal(r.json.credibility.parts.length, 6);
  assert.ok(r.json.housing);
  assert.equal(r.json.housing.homes.length, 8);
  assert.equal(r.json.tax.flatRate, 0.075);
});

/* ---------------- credit facility (LAPO repayment surface) ---------------- */

test('credit: empty state + pay-now/pay-all validation', async () => {
  const { token } = await seedUser({ money: 100_000 });
  const g = await get('/api/bank/credit', token);
  assert.equal(g.status, 200);
  assert.equal(g.json.loan, null);
  const p = await post('/api/bank/credit/pay', { amount: 1000 }, token);
  assert.equal(p.status, 400);
  const pa = await post('/api/bank/credit/pay-all', {}, token);
  assert.equal(pa.status, 400);
});
