// PORT-P2 — invest: land, businesses, haulage (gameplay coins only).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-invest';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const invest = await import('../src/game/invest.js');

let app, base;
test.before(async () => { app = await createApp(); const port = await app.start(0); base = `http://127.0.0.1:${port}`; });
test.after(async () => { await app.close(); });

let n = 0;
async function seedUser({ money = 10_000_000 } = {}) {
  n += 1;
  const id = await db.createUser({ username: 'invseed' + n });
  const c = await db.ensureCharacter(id, 'InvT' + n);
  c.money = money;
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

test('defs: land ₦250k–₦150m at 1.9–5%/week; businesses tiered daily; haulage truck', () => {
  const lands = Object.values(invest.LAND_PARCELS);
  assert.equal(lands.length, 6);
  const prices = lands.map((l) => l.price);
  assert.equal(Math.min(...prices), 250000);
  assert.equal(Math.max(...prices), 150000000);
  const yields = lands.map((l) => l.weeklyYield);
  assert.ok(Math.min(...yields) >= 0.019 && Math.max(...yields) <= 0.05);
  const biz = Object.values(invest.BUSINESSES);
  assert.ok(biz.length >= 3);
  assert.ok(biz.every((b) => b.dailyYield > 0));
  assert.equal(invest.HAULAGE.truck.price, 18000000);
  assert.ok(invest.HAULAGE.truck.weeklyIncome > 0);
});

test('buy: validates kind/def, charges wallet, writes ledger', async () => {
  const { id, token } = await seedUser({ money: 1_000_000 });
  let r = await post('/api/invest/buy', { kind: 'land', defId: 'nope' }, token);
  assert.equal(r.status, 400);
  r = await post('/api/invest/buy', { kind: 'land', defId: 'plot_ikorodu' }, token);
  assert.equal(r.status, 201);
  assert.equal(r.json.holding.def_id, 'plot_ikorodu');
  assert.equal(r.json.holding.principal, 250000);
  const c = await db.getCharacter(id);
  assert.equal(Number(c.money), 750000);
  const rows = await db.listTransactions(id, 50);
  assert.ok(rows.find((x) => x.kind === 'invest_buy'));
  // broke player rejected
  const r2 = await post('/api/invest/buy', { kind: 'land', defId: 'estate_eko' }, token);
  assert.equal(r2.status, 400);
});

test('yields: business accrues daily, land+haulage weekly', async () => {
  const { id, token } = await seedUser({ money: 5_000_000 });
  await post('/api/invest/buy', { kind: 'business', defId: 'kiosk' }, token); // 150k @ 1.2%/day = 1800/day
  await post('/api/invest/buy', { kind: 'land', defId: 'plot_ikorodu' }, token); // 250k @ 1.9%/wk = 4750/wk
  // day 1 → day 3: 2 business days accrue; land waits for the week boundary
  await invest.settleInvestForUser(id, 3, { rng: () => 0.99 });
  let holdings = await invest.listHoldings(id);
  const biz = holdings.find((h) => h.kind === 'business');
  const land = holdings.find((h) => h.kind === 'land');
  assert.equal(biz.accrued, 3600);
  assert.equal(land.accrued, 0);
  // day 8 (week 1): land accrues its weekly yield too
  await invest.settleInvestForUser(id, 8, { rng: () => 0.99 });
  holdings = await invest.listHoldings(id);
  const land2 = holdings.find((h) => h.kind === 'land');
  assert.equal(land2.accrued, 4750);
});

test('land risk: forced dispute dents principal with flavor', async () => {
  const { id, token } = await seedUser({ money: 5_000_000 });
  await post('/api/invest/buy', { kind: 'land', defId: 'acre_mowe' }, token); // ₦2.5m
  // rng: first call < 0.08 (risk hits), dent + flavor picks
  const seq = [0.01, 0.5, 0.1];
  let i = 0;
  const { notes } = await invest.settleInvestForUser(id, 8, { rng: () => seq[i++ % seq.length] });
  const holdings = await invest.listHoldings(id);
  const land = holdings.find((h) => h.kind === 'land');
  assert.ok(land.principal < 2500000, 'principal dented');
  assert.ok(land.principal >= 2500000 * 0.75, 'dent within 10–25%');
  assert.ok(notes.some((x) => /⚠️/.test(x)));
});

test('collect: accrued yield moves to the wallet', async () => {
  const { id, token } = await seedUser({ money: 5_000_000 });
  const b = await post('/api/invest/buy', { kind: 'business', defId: 'kiosk' }, token);
  await invest.settleInvestForUser(id, 3, { rng: () => 0.99 });
  const before = Number((await db.getCharacter(id)).money);
  const r = await post('/api/invest/collect', { holdingId: b.json.holding.id }, token);
  assert.equal(r.status, 200);
  assert.equal(r.json.collected, 3600);
  const after = Number((await db.getCharacter(id)).money);
  assert.equal(after, before + 3600);
  const r2 = await post('/api/invest/collect', { holdingId: b.json.holding.id }, token);
  assert.equal(r2.status, 400); // nothing left to collect
});

test('sell: pays value + accrued, closes the holding', async () => {
  const { id, token } = await seedUser({ money: 5_000_000 });
  const b = await post('/api/invest/buy', { kind: 'business', defId: 'kiosk' }, token);
  await invest.settleInvestForUser(id, 3, { rng: () => 0.99 });
  const before = Number((await db.getCharacter(id)).money);
  const r = await post('/api/invest/sell', { holdingId: b.json.holding.id }, token);
  assert.equal(r.status, 200);
  assert.equal(r.json.payout, 150000 + 3600);
  const after = Number((await db.getCharacter(id)).money);
  assert.equal(after, before + 153600);
  const holdings = await invest.listHoldings(id);
  assert.equal(holdings.length, 0);
});

test('GET /api/invest: defs + holdings + totals', async () => {
  const { token } = await seedUser({ money: 25_000_000 });
  const bought = await post('/api/invest/buy', { kind: 'haulage', defId: 'truck' }, token);
  assert.equal(bought.status, 201);
  const r = await get('/api/invest', token);
  assert.equal(r.status, 200);
  assert.equal(r.json.holdings.length, 1);
  assert.equal(r.json.defs.haulage[0].id, 'truck');
  assert.ok(r.json.defs.land.length === 6);
  assert.ok(r.json.totalValue > 0);
});
