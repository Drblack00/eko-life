// Phase 4 — Èkó Reserve bank app.
// Bonds: buy validation (min amount, integer math, known terms,
// affordability, admin stealth free). Maturity: payout math + IDEMPOTENCY
// (re-running the settle must not double-pay). Weekly bills: deduction,
// property scaling, arrears + 4-week cap, no interest spiral.
// Net-worth formula, bill formula, tax-endpoint reuse, ?limit= param.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'eko-life-bank-test-secret';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const bank = await import('../src/game/v2/bank.js');

let app, base;
test.before(async () => { app = await createApp(); const port = await app.start(0); base = `http://127.0.0.1:${port}`; });
test.after(async () => { await app.close(); });

let n = 0;
async function seedUser({ money = 100_000, savings = 0, admin = false, property = 'none' } = {}) {
  n += 1;
  const id = await db.createUser({ username: 'bankseed' + n });
  if (admin) await db.setAdmin(id, true);
  const c = await db.ensureCharacter(id, 'BankT' + n);
  c.money = money;
  c.savings = savings;
  c.property = property;
  c.bill_arrears = 0;
  await db.saveCharacter(c);
  const token = signToken(id);
  return { id, token, user: { id, username: 'bankseed' + n } };
}
async function freshChar(id) { return db.getCharacter(id); }
async function post(p, body, token) {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}
async function get(p, token) {
  const r = await fetch(base + p, { headers: { authorization: `Bearer ${token}` } });
  return { status: r.status, json: await r.json() };
}
async function txns(userId, kind) {
  const rows = await db.listTransactions(userId, 200);
  return kind ? rows.filter((r) => r.kind === kind) : rows;
}
// Fake rollover ctx at a chosen game day (offline sweep covers everyone).
function ctxAt(day) {
  return { getDay: () => ({ day, endsIn: 0 }), send: () => {}, youSnapshot: (c) => ({ ...c.character }) };
}
async function rollOffline(day) {
  await bank._resetBankBillWeek();
  await bank.settleOfflinePlayers(ctxAt(1), () => false); // seed the week metas (no charge)
  await bank.settleOfflinePlayers(ctxAt(day), () => false);
}

/* ---------------- pure formulas ---------------- */

test('netWorth = coins + savings + active bond principal', () => {
  assert.equal(bank.netWorth({ money: 100, savings: 200, activeBondPrincipal: 300 }), 600);
  assert.equal(bank.netWorth({ money: 0, savings: 0, activeBondPrincipal: 0 }), 0);
  assert.equal(bank.netWorth({}), 0);
  // matured bonds are NOT counted (their payout already landed in money)
  assert.equal(bank.netWorth({ money: 113000, savings: 0, activeBondPrincipal: 0 }), 113000);
});

test('calcWeeklyBill: base + 0.1% of owned property price, floored', () => {
  assert.equal(bank.calcWeeklyBill({ property: 'none' }), 1000);
  assert.equal(bank.calcWeeklyBill({ property: 'bogus' }), 1000);
  assert.equal(bank.calcWeeklyBill({ property: 'selfcon_own' }), 1250); // 1000 + 250
  assert.equal(bank.calcWeeklyBill({ property: 'bungalow_own' }), 1600); // 1000 + 600
  assert.equal(bank.calcWeeklyBill({ property: 'flat_own' }), 2200); // 1000 + 1200
  assert.equal(bank.calcWeeklyBill({ property: 'duplex_own' }), 4000); // 1000 + 3000
});

test('bond math: 7d→5%, 14d→12%, 30d→30% flat on principal', () => {
  assert.equal(bank.bondPayout({ principal: 100000, rate: 0.05 }), 105000);
  assert.equal(bank.bondPayout({ principal: 100000, rate: 0.12 }), 112000);
  assert.equal(bank.bondPayout({ principal: 100000, rate: 0.30 }), 130000);
  assert.equal(bank.bondInterest({ principal: 9999, rate: 0.05 }), 499); // floored
  assert.equal(bank.bondMaturesDay({ start_day: 1, term_days: 7 }), 8);
  assert.ok(bank.bondDue({ start_day: 1, term_days: 7, matured: 0 }, 8));
  assert.ok(!bank.bondDue({ start_day: 1, term_days: 7, matured: 0 }, 7));
  assert.ok(!bank.bondDue({ start_day: 1, term_days: 7, matured: 1 }, 30));
});

test('planBillTick: partial pay → arrears; capped at 4 weeks of bills', () => {
  // full pay
  let p = bank.planBillTick({ money: 5000, bill_arrears: 0 }, 1000, false);
  assert.deepEqual([p.pay, p.newArrears], [1000, 0]);
  // partial pay, remainder to arrears
  p = bank.planBillTick({ money: 500, bill_arrears: 0 }, 1000, false);
  assert.deepEqual([p.pay, p.newArrears], [500, 500]);
  // broke: full bill to arrears
  p = bank.planBillTick({ money: 0, bill_arrears: 0 }, 1000, false);
  assert.deepEqual([p.pay, p.newArrears], [0, 1000]);
  // cap: 4 weeks of bills max, no compounding
  p = bank.planBillTick({ money: 0, bill_arrears: 3900 }, 1000, false);
  assert.equal(p.newArrears, 4000);
  p = bank.planBillTick({ money: 0, bill_arrears: 4000 }, 1000, false);
  assert.equal(p.newArrears, 4000); // stays capped, never grows past it
  // admin: always "paid", never charged, arrears cleared
  p = bank.planBillTick({ money: 0, bill_arrears: 999 }, 1000, true);
  assert.deepEqual([p.pay, p.newArrears], [1000, 0]);
});

/* ---------------- bond buy validation ---------------- */

test('bond buy: rejects below-min, zero, unknown term', async () => {
  const u = await seedUser({ money: 1_000_000 });
  for (const amount of [0, -100, 4999]) {
    const r = await post('/api/bank/bonds', { amount, termDays: 7 }, u.token);
    assert.equal(r.status, 400, `amount=${amount}`);
  }
  const r = await post('/api/bank/bonds', { amount: 10_000, termDays: 10 }, u.token);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /term/i);
});

test('bond buy: rejects unaffordable principal', async () => {
  const u = await seedUser({ money: 4_000 });
  const r = await post('/api/bank/bonds', { amount: 5_000, termDays: 7 }, u.token);
  assert.equal(r.status, 400);
});

test('bond buy: happy path — charged, row created, receipt written', async () => {
  const u = await seedUser({ money: 100_000 });
  const r = await post('/api/bank/bonds', { amount: 20_000, termDays: 14 }, u.token);
  assert.equal(r.status, 201);
  assert.equal(r.json.bond.principal, 20000);
  assert.equal(r.json.bond.term_days, 14);
  assert.equal(r.json.bond.rate, 0.12);
  assert.equal(r.json.bond.matures_day, r.json.bond.start_day + 14);
  assert.equal(r.json.bond.payout, 22400);
  const c = await freshChar(u.id);
  assert.equal(c.money, 80_000);
  const buys = await txns(u.id, 'bond_buy');
  assert.equal(buys.length, 1);
  assert.equal(buys[0].amount, -20000);
  assert.equal(JSON.parse(buys[0].meta).principal, 20000);
});

test('bond buy: fractional amounts are floored (integer coin math)', async () => {
  const u = await seedUser({ money: 100_000 });
  const r = await post('/api/bank/bonds', { amount: 5500.9, termDays: 7 }, u.token);
  assert.equal(r.status, 201);
  assert.equal(r.json.bond.principal, 5500);
});

test('bond buy: admin buys free — wallet untouched, full face value', async () => {
  const u = await seedUser({ money: 777, admin: true });
  const r = await post('/api/bank/bonds', { amount: 50_000, termDays: 30 }, u.token);
  assert.equal(r.status, 201);
  assert.equal(r.json.bond.principal, 50000);
  const c = await freshChar(u.id);
  assert.equal(c.money, 777); // stealth: never charged
  const buys = await txns(u.id, 'bond_buy');
  assert.equal(buys[0].amount, 0);
});

test('GET /api/bank/bonds lists active + matured with payout preview', async () => {
  const u = await seedUser({ money: 100_000 });
  await post('/api/bank/bonds', { amount: 10_000, termDays: 7 }, u.token);
  const r = await get('/api/bank/bonds', u.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.terms['7'].rate, 0.05);
  assert.equal(r.json.min, 5000);
  const b = r.json.bonds[0];
  assert.equal(b.principal, 10000);
  assert.equal(b.matured, false);
  assert.equal(b.payout, 10500);
});

/* ---------------- maturity + idempotency ---------------- */

// Settle bonds only: reset the weekly-bill boundary first so the bill
// tick never fires inside a bond test (bills are covered separately).
async function rollBondsOnly(day) {
  await bank._resetBankBillWeek();
  await bank.settleOfflinePlayers(ctxAt(day), () => false);
}

test('bond maturity: no payout before term, payout at term', async () => {
  const u = await seedUser({ money: 100_000 });
  await post('/api/bank/bonds', { amount: 10_000, termDays: 7 }, u.token); // start_day=1, matures day 8
  await rollBondsOnly(7);
  let c = await freshChar(u.id);
  assert.equal(c.money, 90_000); // nothing yet
  assert.equal((await txns(u.id, 'bond_payout')).length, 0);
  await rollBondsOnly(8);
  c = await freshChar(u.id);
  assert.equal(c.money, 90_000 + 10_500);
  const pays = await txns(u.id, 'bond_payout');
  assert.equal(pays.length, 1);
  assert.equal(pays[0].amount, 10500);
});

test('bond maturity: IDEMPOTENT — re-running the settle never double-pays', async () => {
  const u = await seedUser({ money: 100_000 });
  await post('/api/bank/bonds', { amount: 10_000, termDays: 7 }, u.token);
  const ctx = ctxAt(30); // well past maturity
  await bank._resetBankBillWeek();
  await bank.settleOfflinePlayers(ctx, () => false);
  await bank.settleOfflinePlayers(ctx, () => false);
  await bank.settleOfflinePlayers(ctx, () => false);
  const c = await freshChar(u.id);
  assert.equal(c.money, 90_000 + 10_500);
  assert.equal((await txns(u.id, 'bond_payout')).length, 1);
  const bonds = await bank.listBonds(u.id);
  assert.equal(bonds[0].matured, true);
  assert.equal(bonds[0].matured_day, 30);
});

test('bond maturity: atomic claim — only the first claim wins', async () => {
  const u = await seedUser({ money: 50_000 });
  const r = await post('/api/bank/bonds', { amount: 10_000, termDays: 7 }, u.token);
  const id = r.json.bond.id;
  assert.equal(await bank.claimBondMaturity(id, 8), true);
  assert.equal(await bank.claimBondMaturity(id, 8), false); // second claim loses
});

test('bond maturity: online player credited live on the session character', async () => {
  const u = await seedUser({ money: 100_000 });
  await post('/api/bank/bonds', { amount: 10_000, termDays: 7 }, u.token);
  const c = await freshChar(u.id);
  const sent = [];
  const conn = { user: u.user, character: c };
  const ctx = {
    getDay: () => ({ day: 8, endsIn: 0 }),
    send: (cc, msg) => sent.push(msg),
    youSnapshot: (cc) => ({ money: cc.character.money }),
  };
  await bank._resetBankBillWeek(); // bond-only: keep the bill tick out
  const out = await bank.settleOnlinePlayer(ctx, conn);
  assert.ok(out.dirty);
  assert.equal(c.money, 90_000 + 10_500);
  assert.ok(sent.some((m) => m.t === 'sys' && /matured/.test(m.text)));
});

/* ---------------- weekly bills ---------------- */

test('weekly bill: deducted at the week boundary with receipt', async () => {
  const u = await seedUser({ money: 10_000, property: 'none' });
  await rollOffline(8); // week 0 → week 1 boundary
  const c = await freshChar(u.id);
  assert.equal(c.money, 9_000); // ₦1,000 base bill
  assert.equal(c.bill_arrears, 0);
  const bills = await txns(u.id, 'weekly_bill');
  assert.equal(bills.length, 1);
  assert.equal(bills[0].amount, -1000);
});

test('weekly bill: property-scaled (duplex_own → ₦4,000)', async () => {
  const u = await seedUser({ money: 10_000, property: 'duplex_own' });
  await rollOffline(8);
  const c = await freshChar(u.id);
  assert.equal(c.money, 6_000);
});

test('weekly bill: no boundary, no charge (mid-week tick)', async () => {
  const u = await seedUser({ money: 10_000 });
  await bank._resetBankBillWeek();
  await bank.settleOfflinePlayers(ctxAt(1), () => false); // seeds week 0
  await bank.settleOfflinePlayers(ctxAt(3), () => false); // still week 0
  const c = await freshChar(u.id);
  assert.equal(c.money, 10_000);
  assert.equal((await txns(u.id, 'weekly_bill')).length, 0);
});

test('weekly bill: short on cash → partial pay, rest to arrears (no interest)', async () => {
  const u = await seedUser({ money: 400, property: 'none' });
  await rollOffline(8);
  const c = await freshChar(u.id);
  assert.equal(c.money, 0);
  assert.equal(c.bill_arrears, 600);
  const bills = await txns(u.id, 'weekly_bill');
  assert.equal(bills[0].amount, -400);
});

test('weekly bill: arrears capped at 4 weeks — never compounds', async () => {
  const u = await seedUser({ money: 0, property: 'none' });
  // six weekly ticks, stone broke the whole time
  await bank._resetBankBillWeek();
  await bank.settleOfflinePlayers(ctxAt(1), () => false);
  for (const day of [8, 15, 22, 29, 36, 43]) {
    await bank.settleOfflinePlayers(ctxAt(day), () => false);
  }
  const c = await freshChar(u.id);
  assert.equal(c.money, 0);
  assert.equal(c.bill_arrears, 4000); // capped: 4 × ₦1,000, not 6 × ₦1,000
});

test('weekly bill: admin never charged, arrears never accrue', async () => {
  const u = await seedUser({ money: 1234, property: 'duplex_own', admin: true });
  await rollOffline(8);
  const c = await freshChar(u.id);
  assert.equal(c.money, 1234);
  assert.equal(c.bill_arrears, 0);
});

test('weekly bill: online player settled live (bill + note)', async () => {
  const u = await seedUser({ money: 10_000, property: 'none' });
  const c = await freshChar(u.id);
  const sent = [];
  const conn = { user: u.user, character: c };
  const ctx = {
    getDay: () => ({ day: 8, endsIn: 0 }),
    send: (cc, msg) => sent.push(msg),
    youSnapshot: (cc) => ({ money: cc.character.money }),
  };
  await bank._resetBankBillWeek();
  await bank.settleOnlinePlayer({ ...ctx, getDay: () => ({ day: 1, endsIn: 0 }) }, conn); // seed
  const out = await bank.settleOnlinePlayer(ctx, conn);
  assert.ok(out.dirty);
  assert.equal(c.money, 9_000);
  assert.ok(sent.some((m) => m.t === 'sys' && /upkeep/.test(m.text)));
});

/* ---------------- overview bundle + reuse ---------------- */

test('GET /api/bank: full overview bundle', async () => {
  const u = await seedUser({ money: 60_000, savings: 20_000 });
  await post('/api/bank/bonds', { amount: 10_000, termDays: 7 }, u.token);
  const r = await get('/api/bank', u.token);
  assert.equal(r.status, 200);
  const b = r.json;
  assert.equal(b.balance, 50_000);
  assert.equal(b.savings, 20_000);
  assert.equal(b.netWorth, 50_000 + 20_000 + 10_000); // coins + savings + active bond principal
  assert.equal(b.bonds.active.length, 1);
  assert.equal(b.bonds.min, 5000);
  assert.equal(b.bills.weeklyBill, 1000);
  assert.equal(b.bills.arrears, 0);
  assert.equal(b.bills.weekEndsDay, 7);
  assert.ok(typeof b.interestWeek === 'number');
  assert.ok(b.tax && typeof b.tax.bill === 'number');
  assert.ok(b.tax.bracket && typeof b.tax.bracket.label === 'string');
});

test('tax display reuses the m10 engine (matches GET /api/v2/m10/tax)', async () => {
  const u = await seedUser({ money: 5_000 });
  // seed an earning inside the current tax week
  await db.addTransaction(u.id, 'biz_income', 2_000_000, 5_000, {});
  const t = await get('/api/v2/m10/tax', u.token);
  assert.equal(t.status, 200);
  const b = await get('/api/bank', u.token);
  assert.equal(b.json.tax.bill, t.json.bill);
  assert.equal(b.json.tax.weekEarnings, t.json.weekEarnings);
  assert.equal(b.json.tax.bracket.label, t.json.bracket.label);
});

test('GET /api/transactions honors ?limit=', async () => {
  const u = await seedUser({ money: 5_000 });
  for (let i = 0; i < 8; i++) await db.addTransaction(u.id, 'test_seed', 1, 5_000, {});
  const r = await get('/api/transactions?limit=5', u.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.transactions.length, 5);
  const r2 = await get('/api/transactions', u.token);
  assert.equal(r2.status, 200);
  assert.ok(r2.json.transactions.length >= 8); // default window still wide
});

test('unauthenticated bank requests are rejected', async () => {
  const r = await fetch(base + '/api/bank');
  assert.equal(r.status, 401);
  const r2 = await fetch(base + '/api/bank/bonds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r2.status, 401);
});
