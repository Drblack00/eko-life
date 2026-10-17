// M3 world & progression tests: properties, business, bank/loan, furniture,
// travel fares, study, spawns/collect, day economy (online + offline),
// /api/transactions, /api/stats homes, money-safety fuzz.
//
// NOTE: auth endpoints are rate-limited (10/min/IP), so users are seeded
// directly via db.createUser + signToken (same convention as act.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

process.env.SESSION_SECRET = 'm3-test-secret-do-not-use-in-prod';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const data = await import('../src/game/data.js');

let base, wsBase, app;

test.before(async () => {
  app = await createApp();
  const port = await app.start(0);
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
});

const sockets = new Set();
test.after(async () => {
  for (const ws of sockets) { try { ws.close(); } catch { /* ignore */ } }
  await new Promise(r => setTimeout(r, 300));
  await app.close();
});

async function get(p, token) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(base + p, { headers });
  return { status: r.status, json: await r.json() };
}

async function post(p, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}

function collect(ws) {
  const msgs = [];
  ws.on('message', (raw) => {
    try { msgs.push(JSON.parse(raw.toString())); } catch { /* ignore */ }
  });
  return msgs;
}

function waitFor(msgs, pred, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      const hit = msgs.find(pred);
      if (hit) { clearInterval(iv); resolve(hit); }
      else if (Date.now() - start > timeout) { clearInterval(iv); reject(new Error('timed out waiting for message')); }
    }, 25);
  });
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/ws?token=${encodeURIComponent(token)}`);
    sockets.add(ws);
    ws.on('close', () => sockets.delete(ws));
    const msgs = collect(ws);
    ws.once('open', () => resolve({ ws, msgs }));
    ws.once('error', reject);
  });
}

let guestN = 0;
async function seedGuest(classId = 'street_smart') {
  guestN += 1;
  const username = 'm3seed' + guestN;
  const userId = await db.createUser({ username, is_guest: 1 });
  const token = signToken(userId);
  const name = 'M3T' + guestN + 'x' + Math.floor(Math.random() * 1e4);
  const cc = await post('/api/characters', { name, class: classId, avatar: '🧑', color: '#22d3ee' }, token);
  assert.equal(cc.status, 200, `character creation failed: ${JSON.stringify(cc.json)}`);
  return { token, userId };
}

async function connectAs(user) {
  const { ws, msgs } = await connect(user.token);
  const init = await waitFor(msgs, m => m.t === 'init');
  return { ws, msgs, init };
}

async function setChar(userId, patch) {
  const c = await db.getCharacter(userId);
  Object.assign(c, patch);
  await db.saveCharacter(c);
}

function act(ws, payload) {
  ws.send(JSON.stringify({ t: 'act', ...payload }));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------- world data ----------------
test('M3 data: 60+ tagged locations, 10 jobs, 4+ career paths', () => {
  assert.ok(data.LOCATIONS.length >= 60, `locations=${data.LOCATIONS.length}`);
  const ids = new Set(data.LOCATIONS.map(l => l.id));
  assert.equal(ids.size, data.LOCATIONS.length, 'duplicate location ids');
  for (const t of ['market', 'bank', 'housing_office', 'campus', 'beach', 'club']) {
    assert.ok(data.LOCATIONS.some(l => (l.tags || []).includes(t)), `no location tagged ${t}`);
  }
  assert.equal(data.JOBS.length, 10);
  const paths = new Set(data.JOBS.map(j => j.path));
  assert.ok(paths.size >= 4, `paths=${[...paths]}`);
  assert.ok(data.JOBS.filter(j => j.certRequired).length >= 2, 'cert-gated jobs missing');
  assert.ok(Object.keys(data.PROPERTIES).length >= 3);
  assert.ok(Object.keys(data.BIZ).length >= 3);
  assert.ok(Object.keys(data.VEHICLES).length >= 3);
  assert.equal(Object.keys(data.FURN).length, 22); // M14: 6 original + 10 buy-mode items + 6 later additions
  assert.equal(data.HOME_SLOTS, 6);
});

// ---------------- buy_property ----------------
test('buy_property: affordability enforced, then purchase + ledger', async () => {
  const A = await seedGuest('street_smart'); // ₦5,000
  await setChar(A.userId, { money: 300000 }); // applied before connect → in-session state
  const { ws, msgs } = await connectAs(A);
  act(ws, { a: 'buy_property', property: 'duplex_own' }); // ₦3,000,000 — can't afford
  const err = await waitFor(msgs, m => m.t === 'err' && /need/i.test(m.text));
  assert.ok(err);

  act(ws, { a: 'buy_property', property: 'selfcon_own' }); // ₦250,000
  const bought = await waitFor(msgs, m => m.t === 'you' && m.you.property === 'selfcon_own');
  assert.equal(bought.you.money, 50000);
  assert.match(bought.note, /own/i);

  const tx = await db.listTransactions(A.userId);
  const row = tx.find(t => t.kind === 'buy_property');
  assert.ok(row);
  assert.equal(row.amount, -250000);
  assert.equal(row.balance_after, 50000);
  ws.close();
});

// ---------------- buy_biz: one business per player ----------------
test('buy_biz: one business per player', async () => {
  const A = await seedGuest('silver_spoon'); // ₦50,000
  const { ws, msgs } = await connectAs(A);
  act(ws, { a: 'buy_biz', biz: 'mamaput' }); // ₦50,000
  const got = await waitFor(msgs, m => m.t === 'you' && m.you.biz === 'mamaput');
  assert.equal(got.you.money, 2000); // 52000 (silver_spoon + Lagos cash) - 50000

  act(ws, { a: 'buy_biz', biz: 'carwash' });
  const err = await waitFor(msgs, m => m.t === 'err' && /already own/i.test(m.text));
  assert.ok(err);
  const c = await db.getCharacter(A.userId);
  assert.equal(c.biz, 'mamaput');
  ws.close();
});

// ---------------- bank + loan + repay ----------------
test('bank/loan/repay: math holds, validations reject junk', async () => {
  const A = await seedGuest('silver_spoon'); // ₦50,000
  const { ws, msgs } = await connectAs(A);

  act(ws, { a: 'bank', op: 'deposit', amount: 20000 });
  let you = await waitFor(msgs, m => m.t === 'you' && m.you.savings === 20000);
  assert.equal(you.you.money, 32000); // 52000 - 20000

  act(ws, { a: 'bank', op: 'withdraw', amount: 5000 });
  you = await waitFor(msgs, m => m.t === 'you' && m.you.savings === 15000);
  assert.equal(you.you.money, 37000); // 32000 + 5000

  act(ws, { a: 'bank', op: 'deposit', amount: -100 });
  await waitFor(msgs, m => m.t === 'err' && /valid amount/i.test(m.text));

  act(ws, { a: 'loan', amount: 50000 });
  you = await waitFor(msgs, m => m.t === 'you' && m.you.loan === 50000);
  assert.equal(you.you.money, 87000); // 37000 + 50000 loan

  act(ws, { a: 'loan', amount: 1000 }); // none while outstanding
  await waitFor(msgs, m => m.t === 'err' && /repay your current loan/i.test(m.text));

  act(ws, { a: 'loan', amount: 200000 }); // over the ₦100k cap
  await waitFor(msgs, m => m.t === 'err' && /₦1|1 –/i.test(m.text));

  act(ws, { a: 'repay', amount: 10000 });
  you = await waitFor(msgs, m => m.t === 'you' && m.you.loan === 40000);
  assert.equal(you.you.money, 77000); // 87000 - 10000 repay

  act(ws, { a: 'repay', amount: 999999 }); // clamps to outstanding loan
  you = await waitFor(msgs, m => m.t === 'you' && m.note && /fully repaid/i.test(m.note));
  assert.equal(you.you.loan, 0);
  assert.equal(you.you.money, 37000); // 77000 - 40000 repay

  const tx = await db.listTransactions(A.userId);
  const kinds = tx.map(t => t.kind);
  for (const k of ['deposit', 'withdraw', 'loan', 'repay']) assert.ok(kinds.includes(k), `missing ${k}`);
  ws.close();
});

// ---------------- day economy: interest + biz income (pure sim) ----------------
// PORT-P2: savings interest left applyDayEconomy — it accrues per minute in
// v2/p2money.js (0.5%/game-week on the first ₦1bn), credited on the day tick.
test('day economy: interest tick math (10% loan; savings untouched)', async () => {
  const { applyDayEconomy } = await import('../src/game/sim.js');
  const c = { money: 9000, savings: 10000, loan: 10000, happiness: 50, energy: 100, health: 100, hunger: 100 };
  const res = applyDayEconomy(c, { bizDef: { income: 4000 } });
  assert.equal(res.income, 4000);
  assert.equal(c.money, 13000);
  assert.equal(res.savingsInterest, undefined);
  assert.equal(c.savings, 10000);
  assert.equal(res.loanInterest, 1000);
  assert.equal(c.loan, 11000);
});

// ---------------- furniture: buy, place limit, effect hooks ----------------
test('furniture: buy → place, 6-slot limit, fridge+bed hooks fire', async () => {
  const A = await seedGuest('silver_spoon'); // ₦50,000
  // NOTE: setChar must run before connect — the live session holds its own
  // character copy and never re-reads the row mid-session.
  await setChar(A.userId, { money: 200000, hunger: 40, health: 60 });
  const { ws, msgs } = await connectAs(A);

  act(ws, { a: 'buy_furniture', item: 'fridge' }); // ₦20,000
  let you = await waitFor(msgs, m => m.t === 'you' && m.you.furniture.length === 1);
  const fridgeId = you.you.furniture[0].id;
  assert.equal(you.you.furniture[0].placed, false);

  act(ws, { a: 'place_furniture', id: fridgeId, placed: true });
  you = await waitFor(msgs, m => m.t === 'you' && m.you.furniture.some(f => f.id === fridgeId && f.placed));
  assert.ok(you.you.furniture.find(f => f.id === fridgeId).placed);

  // eat with fridge placed: hunger +35 (food) +15 (fridge) = 40 → 90
  act(ws, { a: 'eat', item: 'mama_put' });
  you = await waitFor(msgs, m => m.t === 'you' && m.you.hunger === 90);
  assert.equal(you.you.hunger, 90);

  // bed hook: buy + place, then sleep → health +10 (base) +20 (bed) = 60 → 90
  act(ws, { a: 'buy_furniture', item: 'bed' });
  let bedMsg = await waitFor(msgs, m => m.t === 'you' && m.you.furniture.some(f => f.item === 'bed'));
  const bedId = bedMsg.you.furniture.find(f => f.item === 'bed').id;
  act(ws, { a: 'place_furniture', id: bedId, placed: true });
  await waitFor(msgs, m => m.t === 'you' && m.you.furniture.some(f => f.id === bedId && f.placed));
  act(ws, { a: 'sleep' });
  you = await waitFor(msgs, m => m.t === 'you' && m.you.health === 90);
  assert.equal(you.you.health, 90);

  // fill all 6 slots (fridge + bed + 4 more), then placing a 7th must fail
  for (const item of ['tv', 'sofa', 'gen', 'ac']) {
    act(ws, { a: 'buy_furniture', item });
    const bought = await waitFor(msgs, m => m.t === 'you' && m.you.furniture.some(f => f.item === item && !f.placed));
    const fid = bought.you.furniture.find(f => f.item === item && !f.placed).id;
    act(ws, { a: 'place_furniture', id: fid, placed: true });
    await waitFor(msgs, m => m.t === 'you' && m.you.furniture.some(f => f.id === fid && f.placed));
  }
  act(ws, { a: 'buy_furniture', item: 'bed' }); // 7th item, stays unplaced
  const seven = await waitFor(msgs, m => m.t === 'you' && m.you.furniture.length === 7);
  const extraId = Math.max(...seven.you.furniture.map(f => f.id)); // newest row
  assert.ok(!seven.you.furniture.find(f => f.id === extraId).placed);
  act(ws, { a: 'place_furniture', id: extraId, placed: true });
  const err = await waitFor(msgs, m => m.t === 'err' && /6 slots/i.test(m.text));
  assert.ok(err);
  ws.close();
});

// ---------------- travel fares ----------------
test('travel: fares deducted — ₦0 same region, ₦200 cross-region, ₦500 boat', async () => {
  const A = await seedGuest('street_smart');
  await setChar(A.userId, { money: 10000, energy: 100, location_id: 'tejuosho' }); // mainland
  const { ws, msgs } = await connectAs(A);

  act(ws, { a: 'travel', locationId: 'mushin' }); // mainland→mainland: free
  let you = await waitFor(msgs, m => m.t === 'you' && m.you.locationId === 'mushin');
  assert.equal(you.you.money, 10000);

  act(ws, { a: 'travel', locationId: 'lekki_beach' }); // mainland→island: ₦200
  you = await waitFor(msgs, m => m.t === 'you' && m.you.locationId === 'lekki_beach');
  assert.equal(you.you.money, 9800);

  act(ws, { a: 'travel', locationId: 'ebute_metta' }); // island→lagoon: ₦500 boat
  you = await waitFor(msgs, m => m.t === 'you' && m.you.locationId === 'ebute_metta');
  assert.equal(you.you.money, 9300);

  // broke traveler: island→lagoon boat needs ₦500, only ₦100 held
  await setChar(A.userId, { money: 100, location_id: 'tarkwa_bay' });
  const { ws: ws2, msgs: msgs2 } = await connect(A.token); // re-sync session with DB
  await waitFor(msgs2, m => m.t === 'init');
  act(ws2, { a: 'travel', locationId: 'third_mainland' });
  const err = await waitFor(msgs2, m => m.t === 'err' && /need/i.test(m.text));
  assert.ok(err);
  const c = await db.getCharacter(A.userId);
  assert.equal(c.location_id, 'tarkwa_bay'); // didn't move
  ws.close(); ws2.close();
});

// ---------------- study ----------------
test('study: campus-only, costs ₦5,000, grants cert', async () => {
  const A = await seedGuest('street_smart');
  await setChar(A.userId, { money: 10000, location_id: 'tejuosho' });
  const { ws, msgs } = await connectAs(A);

  act(ws, { a: 'study' });
  await waitFor(msgs, m => m.t === 'err' && /campus/i.test(m.text));

  await setChar(A.userId, { location_id: 'unilag' });
  const { ws: ws2, msgs: msgs2 } = await connect(A.token); // re-sync session with DB
  await waitFor(msgs2, m => m.t === 'init');
  act(ws2, { a: 'study' });
  const you = await waitFor(msgs2, m => m.t === 'you' && m.you.cert === 1);
  assert.equal(you.you.money, 5000);

  // cert unlocks cert-gated jobs (M7: clock in for a shift instead of instant work)
  act(ws2, { a: 'shift_start', job: 'campus_tutor' });
  const clocked = await waitFor(msgs2, m => m.t === 'you' && /Clocked in as Campus Tutor/.test(m.note || ''));
  assert.ok(clocked);
  ws.close(); ws2.close();
});

// ---------------- rent at housing office ----------------
test('rent: housing-office-only, sets rental and resets misses', async () => {
  const A = await seedGuest('street_smart');
  const { ws, msgs } = await connectAs(A);

  act(ws, { a: 'rent', housing: 'selfcon' }); // tejuosho → not a housing office
  await waitFor(msgs, m => m.t === 'err' && /housing office/i.test(m.text));

  await setChar(A.userId, { location_id: 'housing_office_m', rent_misses: 2 });
  const { ws: ws2, msgs: msgs2 } = await connect(A.token);
  await waitFor(msgs2, m => m.t === 'init');
  act(ws2, { a: 'rent', housing: 'selfcon' });
  const you = await waitFor(msgs2, m => m.t === 'you' && m.you.housing === 'selfcon');
  assert.equal(you.you.housing, 'selfcon');
  const c = await db.getCharacter(A.userId);
  assert.equal(c.rent_misses, 0);
  ws.close(); ws2.close();
});

// ---------------- buy_vehicle ----------------
test('buy_vehicle: affordability + speed mult in snapshot', async () => {
  const A = await seedGuest('silver_spoon'); // ₦50,000 — can't afford the ₦300k car
  const { ws, msgs } = await connectAs(A);
  act(ws, { a: 'buy_vehicle', v: 'car' });
  await waitFor(msgs, m => m.t === 'err' && /need/i.test(m.text));
  ws.close();

  await setChar(A.userId, { money: 100000 });
  const { ws: ws2, msgs: msgs2 } = await connect(A.token); // re-sync session with DB
  await waitFor(msgs2, m => m.t === 'init');
  act(ws2, { a: 'buy_vehicle', v: 'keke' }); // ₦80,000
  const you = await waitFor(msgs2, m => m.t === 'you' && m.you.vehicle === 'keke');
  assert.equal(you.you.money, 20000);
  assert.equal(you.you.speedMult, 1.6);
  ws2.close();
});

// ---------------- spawns / collect ----------------
test('collect: within proximity works, far away is rejected', async () => {
  const A = await seedGuest('street_smart');
  const B = await seedGuest('street_smart');
  const { ws: wsA, msgs: msgsA } = await connectAs(A);
  const { ws: wsB, msgs: msgsB } = await connectAs(B);

  app.hub.spawnTick();
  const spawnMsg = await waitFor(msgsA, m => m.t === 'spawn');
  const sid = spawnMsg.s.id;
  assert.ok(Number.isFinite(sid));

  // B travels far away first (teleport is legit via travel)
  wsB.send(JSON.stringify({ t: 'act', a: 'travel', locationId: 'agege' }));
  await waitFor(msgsB, m => m.t === 'you' && m.you.locationId === 'agege');

  // B tries to grab A's nearby spawn from ~40 units away → rejected, spawn survives
  wsB.send(JSON.stringify({ t: 'collect', id: sid }));
  const err = await waitFor(msgsB, m => m.t === 'err' && /too far/i.test(m.text));
  assert.ok(err);

  // A collects their own nearby spawn
  const before = await db.getCharacter(A.userId);
  wsA.send(JSON.stringify({ t: 'collect', id: sid }));
  const you = await waitFor(msgsA, m => m.t === 'you' && m.note && /Street find|Found/i.test(m.note));
  assert.ok(you);
  if (spawnMsg.s.kind === 'cash') {
    const after = await db.getCharacter(A.userId);
    assert.equal(after.money, Number(before.money) + spawnMsg.s.amount);
    const tx = await db.listTransactions(A.userId);
    assert.ok(tx.find(t => t.kind === 'spawn_cash'));
  }

  // despawn broadcast went out
  const despawn = msgsA.find(m => m.t === 'despawn' && m.id === sid);
  assert.ok(despawn);
  wsA.close(); wsB.close();
});

// ---------------- /api/transactions ----------------
test('GET /api/transactions: newest-first ledger rows', async () => {
  const A = await seedGuest('street_smart');
  await setChar(A.userId, { money: 60000, location_id: 'tejuosho', energy: 100 });
  const { ws, msgs } = await connectAs(A);
  act(ws, { a: 'shift_start', job: 'market_porter' });
  await waitFor(msgs, m => m.t === 'you' && m.note && /Clocked in as Market Porter/.test(m.note));
  act(ws, { a: 'buy_biz', biz: 'mamaput' });
  await waitFor(msgs, m => m.t === 'you' && m.you.biz === 'mamaput');

  const r = await get('/api/transactions', A.token);
  assert.equal(r.status, 200);
  const list = r.json.transactions;
  assert.ok(Array.isArray(list) && list.length >= 2);
  assert.equal(list[0].kind, 'buy_biz'); // newest first
  assert.equal(list[0].amount, -50000);
  assert.ok(list[0].created_at > 0);
  assert.deepEqual(Object.keys(list[0]).sort(), ['amount', 'balance_after', 'created_at', 'id', 'kind', 'meta']);
  // ids strictly descending (newest first)
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].id > list[i].id);
  ws.close();
});

// ---------------- full earn→spend→rent→income loop over simulated days ----------------
test('full loop: work → buy biz → day tick charges rent + pays income + interest', async () => {
  const A = await seedGuest('street_smart'); // ₦5,000, face-me (₦5,000/day)
  await setChar(A.userId, { money: 60000, savings: 10000, location_id: 'tejuosho', energy: 100 });
  const { ws, msgs } = await connectAs(A);

  // spend: business + deposit
  act(ws, { a: 'buy_biz', biz: 'mamaput' }); // −₦50,000 → ₦10,000
  await waitFor(msgs, m => m.t === 'you' && m.you.biz === 'mamaput');
  act(ws, { a: 'bank', op: 'deposit', amount: 5000 }); // savings → ₦15,000, money → ₦5,000
  await waitFor(msgs, m => m.t === 'you' && m.you.savings === 15000);

  // day 1 rollover: rent ₦5,000 paid (money 5000→0), biz +₦4,000.
  // PORT-P2: savings accrue per minute (0.5%/game-week) — a same-tick
  // rollover accrues ~₦0, so savings stay flat here.
  await app.hub.dayRollover();
  const d1 = await waitFor(msgs, m => m.t === 'day');
  assert.ok(d1);
  let c = await db.getCharacter(A.userId);
  assert.equal(c.money, 4000, `money=${c.money}`);       // 5000 − 5000 rent + 4000 biz
  assert.equal(c.savings, 15000);
  assert.equal(c.rent_misses, 0);

  // day 2: broke — rent missed (money 4000 < 5000), biz income still lands
  await app.hub.dayRollover();
  c = await db.getCharacter(A.userId);
  assert.equal(c.rent_misses, 1);
  assert.equal(c.money, 8000); // 4000 + 4000 biz, rent unpaid

  // ledger tells the whole story
  const tx = await db.listTransactions(A.userId);
  const kinds = tx.map(t => t.kind);
  for (const k of ['buy_biz', 'deposit', 'rent', 'biz_income']) {
    assert.ok(kinds.includes(k), `ledger missing ${k}`);
  }
  ws.close();
});

// ---------------- offline players get day economy too ----------------
test('offline day economy: biz income credited in DB (savings accrue per minute)', async () => {
  const A = await seedGuest('street_smart');
  await setChar(A.userId, { money: 1000, savings: 50000, biz: 'carwash', loan: 0, happiness: 50 });
  await app.hub.dayRollover(); // A is offline
  const c = await db.getCharacter(A.userId);
  assert.equal(c.money, 1000 + 6000);   // carwash income
  // PORT-P2: per-minute accrual seeds the clock on first run — no windfall.
  assert.equal(c.savings, 50000);
  const tx = await db.listTransactions(A.userId);
  assert.ok(tx.find(t => t.kind === 'biz_income'));
});

// ---------------- /api/stats homes ----------------
test('GET /api/stats: homes counts owned properties, homesOnline tracks presence', async () => {
  const A = await seedGuest('street_smart');
  // NOTE: the DB is shared with earlier tests in this file (buy_property etc.),
  // so assert deltas against the current baseline, not absolute zeros.
  let s = await get('/api/stats');
  const baseHomes = s.json.homes;
  const baseOnline = s.json.homesOnline;

  await setChar(A.userId, { money: 300000, property: 'selfcon_own' });
  s = await get('/api/stats');
  assert.equal(s.json.homes, baseHomes + 1);
  assert.equal(s.json.homesOnline, baseOnline); // offline

  const { ws } = await connectAs(A);
  s = await get('/api/stats');
  assert.equal(s.json.homes, baseHomes + 1);
  assert.equal(s.json.homesOnline, baseOnline + 1);
  ws.close();
  await sleep(400);
  s = await get('/api/stats');
  assert.equal(s.json.homesOnline, baseOnline);
});

// ---------------- money-safety fuzz ----------------
test('money never negative under action fuzz', async () => {
  const A = await seedGuest('street_smart');
  const { ws, msgs } = await connectAs(A);
  const locIds = data.LOCATIONS.map(l => l.id);
  const amounts = [-5000, -1, 0, 1, 50, 999, 100000, 99999999, NaN];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const acts = [
    () => ({ a: 'bank', op: pick(['deposit', 'withdraw', 'hack']), amount: pick(amounts) }),
    () => ({ a: 'loan', amount: pick(amounts) }),
    () => ({ a: 'repay', amount: pick(amounts) }),
    () => ({ a: 'eat', item: pick(['mama_put', 'suya', 'nope']) }),
    () => ({ a: 'travel', locationId: pick(locIds) }),
    () => ({ a: 'buy_property', property: pick(['selfcon_own', 'duplex_own', 'nope']) }),
    () => ({ a: 'buy_vehicle', v: pick(['keke', 'car', 'none', 'nope']) }),
    () => ({ a: 'buy_biz', biz: pick(['mamaput', 'lounge', 'nope']) }),
    () => ({ a: 'buy_furniture', item: pick(['bed', 'gen', 'nope']) }),
    () => ({ a: 'rent', housing: pick(['selfcon', 'bridge', 'nope']) }),
    () => ({ a: 'study' }),
    () => ({ a: 'rest' }),
    () => ({ a: 'sleep' }),
  ];
  for (let i = 0; i < 120; i++) {
    act(ws, acts[Math.floor(Math.random() * acts.length)]());
    if (i % 10 === 0) {
      await sleep(60);
      const c = await db.getCharacter(A.userId);
      assert.ok(Number(c.money) >= 0, `money negative after ${i} acts: ${c.money}`);
      assert.ok(Number(c.savings) >= 0, `savings negative: ${c.savings}`);
      assert.ok(Number(c.loan) >= 0, `loan negative: ${c.loan}`);
      assert.ok(Number.isFinite(Number(c.money)));
    }
  }
  const c = await db.getCharacter(A.userId);
  assert.ok(Number(c.money) >= 0 && Number(c.savings) >= 0 && Number(c.loan) >= 0);
  ws.close();
});
