// M14 Home Room (Buy mode) tests:
// - catalogue shape: 16 items, original 6 byte-exact, every item has
//   category + grid size, 10 new items present, effects table complete
// - placement validation: out-of-bounds rejected, overlap rejected,
//   slot cap enforced, valid placement persists x/z/rot, unplace clears
// - sell_furniture: refund = floor(price/2), placed item rejected,
//   other owner's item rejected, ledger row written
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

process.env.SESSION_SECRET = 'm14-test-secret';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const data = await import('../src/game/data.js');
const { applyDayEconomy, furnitureEffects } = await import('../src/game/sim.js');

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

// Only matches messages appended after the given index (avoids stale hits).
function waitForNew(msgs, from, pred, timeout = 8000) {
  return waitFor(msgs, (m, i) => i >= from && pred(m), timeout);
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
  const username = 'm14seed' + guestN;
  const userId = await db.createUser({ username, is_guest: 1 });
  const token = signToken(userId);
  const name = 'M14T' + guestN + 'x' + Math.floor(Math.random() * 1e4);
  const cc = await post('/api/characters', { name, class: classId, avatar: '🧑', color: '#22d3ee' }, token);
  assert.equal(cc.status, 200, `character creation failed: ${JSON.stringify(cc.json)}`);
  return { token, userId };
}

async function connectAs(user) {
  const { ws, msgs } = await connect(user.token);
  await waitFor(msgs, m => m.t === 'init');
  return { ws, msgs };
}

async function setChar(userId, patch) {
  const c = await db.getCharacter(userId);
  Object.assign(c, patch);
  await db.saveCharacter(c);
}

function act(ws, payload) {
  ws.send(JSON.stringify({ t: 'act', ...payload }));
}

// ---------------- catalogue shape ----------------
test('M14 catalogue: 16 items, original 6 exact, category+size on all', () => {
  const F = data.FURN;
  assert.equal(Object.keys(F).length, 16);
  // original 6: ids/prices/effects/names/icons/descs unchanged
  assert.deepEqual([F.bed.id, F.bed.name, F.bed.price, F.bed.icon, F.bed.effect, F.bed.desc],
    ['bed', 'Comfy Bed', 15000, '🛏️', 'sleep_health', 'Sleep restores +20 extra health']);
  assert.deepEqual([F.fridge.id, F.fridge.name, F.fridge.price, F.fridge.icon, F.fridge.effect, F.fridge.desc],
    ['fridge', 'Fridge', 20000, '🧊', 'eat_hunger', 'Eating restores +15 extra hunger']);
  assert.deepEqual([F.tv.id, F.tv.name, F.tv.price, F.tv.icon, F.tv.effect, F.tv.desc],
    ['tv', 'Flat-screen TV', 25000, '📺', 'fun_happy', 'Fun gives +10 extra happiness']);
  assert.deepEqual([F.sofa.id, F.sofa.name, F.sofa.price, F.sofa.icon, F.sofa.effect, F.sofa.desc],
    ['sofa', 'Sofa Set', 18000, '🛋️', 'fun_happy', 'Fun gives +8 extra happiness']);
  assert.deepEqual([F.gen.id, F.gen.name, F.gen.price, F.gen.icon, F.gen.effect, F.gen.desc],
    ['gen', 'Generator', 30000, '🔌', 'daily_happy', '+5 happiness every game day (no more "up NEPA")']);
  assert.deepEqual([F.ac.id, F.ac.name, F.ac.price, F.ac.icon, F.ac.effect, F.ac.desc],
    ['ac', 'Air Conditioner', 45000, '❄️', 'sleep_happy', 'Sleep restores +10 extra happiness']);
  // every item: valid category + [w,d] cell size
  for (const [id, it] of Object.entries(F)) {
    assert.ok(['sleep', 'kitchen', 'bath', 'comfort'].includes(it.category), `${id}: bad category`);
    assert.ok(Array.isArray(it.size) && it.size.length === 2, `${id}: bad size`);
    for (const s of it.size) assert.ok(Number.isInteger(s) && s >= 1 && s <= 6, `${id}: size out of range`);
  }
  // expected categories for the originals
  assert.equal(F.bed.category, 'sleep');
  assert.equal(F.fridge.category, 'kitchen');
  assert.equal(F.tv.category, 'comfort');
  assert.equal(F.sofa.category, 'comfort');
  assert.equal(F.gen.category, 'comfort');
  assert.equal(F.ac.category, 'comfort');
  assert.deepEqual(F.bed.size, [2, 1]);
  assert.deepEqual(F.tv.size, [2, 1]);
});

test('M14 catalogue: 10 new items present with exact specs', () => {
  const F = data.FURN;
  const expected = {
    mattress:      ['Sturdy Mattress', 3000,  'sleep',   [2, 1], '🛏️', 'sleep_health'],
    cooler:        ['Party Cooler',    2500,  'kitchen', [1, 1], '🧊', 'eat_hunger'],
    stove:         ['Gas Stove',       8000,  'kitchen', [1, 1], '🍳', 'eat_hunger'],
    dining_table:  ['Dining Table',    6600,  'kitchen', [2, 1], '🍽️', 'eat_hunger'],
    drum:          ['Water Drum',      1500,  'bath',    [1, 1], '🛢️', 'day_happy'],
    mirror:        ['Standing Mirror', 4000,  'bath',    [1, 1], '🪞', 'day_happy'],
    plastic_chair: ['Plastic Chair',   500,   'comfort', [1, 1], '🪑', 'fun_happy'],
    fan:           ['Standing Fan',    2200,  'comfort', [1, 1], '🌀', 'sleep_happy'],
    beanbag:       ['Bean Bag',        12000, 'comfort', [1, 1], '🟠', 'fun_happy'],
    bookshelf:     ['Bookshelf',       9000,  'comfort', [1, 1], '📚', 'fun_happy'],
  };
  for (const [id, [name, price, category, size, icon, effect]] of Object.entries(expected)) {
    const it = F[id];
    assert.ok(it, `${id} missing from catalogue`);
    assert.equal(it.name, name);
    assert.equal(it.price, price);
    assert.equal(it.category, category);
    assert.deepEqual(it.size, size);
    assert.equal(it.icon, icon);
    assert.equal(it.effect, effect);
    assert.ok(typeof it.desc === 'string' && it.desc.length > 0, `${id}: desc missing`);
  }
});

test('M14 effects: hooks for all 16 items; day hooks fire via applyDayEconomy', () => {
  const E = data.FURN_EFFECTS;
  assert.deepEqual(E.mattress, { sleep: { health: 8 } });
  assert.deepEqual(E.cooler, { eat: { hunger: 5 } });
  assert.deepEqual(E.stove, { eat: { hunger: 10 } });
  assert.deepEqual(E.dining_table, { eat: { hunger: 8 } });
  assert.deepEqual(E.drum, { day: { happiness: 2 } });
  assert.deepEqual(E.mirror, { day: { happiness: 2 } });
  assert.deepEqual(E.plastic_chair, { fun: { happiness: 2 } });
  assert.deepEqual(E.fan, { sleep: { happiness: 5 } });
  assert.deepEqual(E.beanbag, { fun: { happiness: 6 } });
  assert.deepEqual(E.bookshelf, { fun: { happiness: 4 } });
  // originals unchanged
  assert.deepEqual(E.gen, { day: { happiness: 5 } });
  // sleep/eat/fun hooks aggregate through furnitureEffects
  const e = furnitureEffects(['mattress', 'fan'], data.FURN_EFFECTS);
  assert.equal(e.sleep.health, 8);
  assert.equal(e.sleep.happiness, 5);
  const e2 = furnitureEffects(['cooler', 'stove', 'dining_table'], data.FURN_EFFECTS);
  assert.equal(e2.eat.hunger, 23);
  const e3 = furnitureEffects(['plastic_chair', 'beanbag', 'bookshelf'], data.FURN_EFFECTS);
  assert.equal(e3.fun.happiness, 12);
  // day hooks: gen(5) + drum(2) + mirror(2) = 9
  const c = { money: 0, happiness: 50, savings: 0, loan: 0 };
  const res = applyDayEconomy(c, { placed: ['gen', 'drum', 'mirror', 'bed'] });
  assert.equal(res.happyGain, 9);
  assert.equal(c.happiness, 59);
});

// ---------------- placement validation ----------------
async function buyAndGetId(ws, msgs, item) {
  act(ws, { a: 'buy_furniture', item });
  const you = await waitFor(msgs, m => m.t === 'you' && m.you.furniture.some(f => f.item === item && !f.placed));
  return you.you.furniture.find(f => f.item === item && !f.placed).id;
}

test('M14 placement: valid coords persist; out-of-bounds rejected', async () => {
  const A = await seedGuest();
  await setChar(A.userId, { money: 200000 });
  const { ws, msgs } = await connectAs(A);
  const sofaId = await buyAndGetId(ws, msgs, 'sofa'); // 2×1
  act(ws, { a: 'place_furniture', id: sofaId, placed: true, x: 0, z: 0, rot: 0 });
  const placed = await waitFor(msgs, m => m.t === 'you' && m.you.furniture.some(f => f.id === sofaId && f.placed));
  const f = placed.you.furniture.find(x => x.id === sofaId);
  assert.equal(f.x, 0); assert.equal(f.z, 0); assert.equal(f.rot, 0);
  // DB-level persistence too
  const row = await db.getFurnitureById(sofaId);
  assert.equal(row.x, 0); assert.equal(row.z, 0); assert.equal(row.rot, 0);

  const bedId = await buyAndGetId(ws, msgs, 'bed'); // 2×1
  act(ws, { a: 'place_furniture', id: bedId, placed: true, x: 5, z: 0, rot: 0 }); // 5+2 > 6
  const err1 = await waitForNew(msgs, msgs.length, m => m.t === 'err');
  assert.match(err1.text, /doesn't fit/i);
  // rotated 1×2 fits at (5,0)
  act(ws, { a: 'place_furniture', id: bedId, placed: true, x: 5, z: 0, rot: 1 });
  const placed2 = await waitFor(msgs, m => m.t === 'you' && m.you.furniture.some(g => g.id === bedId && g.placed));
  assert.equal(placed2.you.furniture.find(x => x.id === bedId).rot, 1);
  // z=6 fails coordinate validation (whole numbers 0..5 only)
  const fanId = await buyAndGetId(ws, msgs, 'fan');
  act(ws, { a: 'place_furniture', id: fanId, placed: true, x: 0, z: 6, rot: 0 });
  const err2 = await waitForNew(msgs, msgs.length, m => m.t === 'err');
  assert.match(err2.text, /must be a whole number from 0 to 5/i);
  ws.close();
});

test('M14 placement: overlap rejected; legacy no-coord placement still works', async () => {
  const A = await seedGuest();
  await setChar(A.userId, { money: 200000 });
  const { ws, msgs } = await connectAs(A);
  const sofaId = await buyAndGetId(ws, msgs, 'sofa'); // 2×1
  act(ws, { a: 'place_furniture', id: sofaId, placed: true, x: 0, z: 0, rot: 0 });
  await waitFor(msgs, m => m.t === 'you' && m.you.furniture.some(f => f.id === sofaId && f.placed));

  const bedId = await buyAndGetId(ws, msgs, 'bed'); // 2×1
  act(ws, { a: 'place_furniture', id: bedId, placed: true, x: 1, z: 0, rot: 0 }); // overlaps sofa cells
  const err = await waitFor(msgs, m => m.t === 'err');
  assert.match(err.text, /overlaps/i);
  // non-overlapping spot is fine
  act(ws, { a: 'place_furniture', id: bedId, placed: true, x: 2, z: 0, rot: 0 });
  await waitFor(msgs, m => m.t === 'you' && m.you.furniture.some(f => f.id === bedId && f.placed));

  // old-style placement (no coords) keeps working — coords stay null
  const chairId = await buyAndGetId(ws, msgs, 'plastic_chair');
  act(ws, { a: 'place_furniture', id: chairId, placed: true });
  const placed = await waitFor(msgs, m => m.t === 'you' && m.you.furniture.some(f => f.id === chairId && f.placed));
  const cf = placed.you.furniture.find(x => x.id === chairId);
  assert.equal(cf.x, null); assert.equal(cf.z, null); assert.equal(cf.rot, null);

  // unplacing clears grid coords
  act(ws, { a: 'place_furniture', id: sofaId, placed: false });
  const stored = await waitFor(msgs, m => m.t === 'you' && m.you.furniture.some(f => f.id === sofaId && !f.placed));
  const sf = stored.you.furniture.find(x => x.id === sofaId);
  assert.equal(sf.x, null); assert.equal(sf.z, null); assert.equal(sf.rot, null);
  ws.close();
});

test('M14 placement: 6-slot cap enforced with coords', async () => {
  const A = await seedGuest();
  await setChar(A.userId, { money: 200000 });
  const { ws, msgs } = await connectAs(A);
  assert.equal(data.HOME_SLOTS, 6);
  const items = ['plastic_chair', 'fan', 'cooler', 'drum', 'mirror', 'beanbag'];
  for (let i = 0; i < items.length; i++) {
    const fid = await buyAndGetId(ws, msgs, items[i]); // all 1×1
    act(ws, { a: 'place_furniture', id: fid, placed: true, x: i, z: 0, rot: 0 });
    await waitFor(msgs, m => m.t === 'you' && m.you.furniture.some(f => f.id === fid && f.placed));
  }
  const extraId = await buyAndGetId(ws, msgs, 'stove');
  act(ws, { a: 'place_furniture', id: extraId, placed: true, x: 0, z: 1, rot: 0 });
  const err = await waitFor(msgs, m => m.t === 'err');
  assert.match(err.text, /only 6 slots/i);
  ws.close();
});

// ---------------- sell_furniture ----------------
test('M14 sell: refund = floor(price/2), item gone, ledger row', async () => {
  const A = await seedGuest();
  await setChar(A.userId, { money: 10000 });
  const { ws, msgs } = await connectAs(A);
  act(ws, { a: 'buy_furniture', item: 'plastic_chair' }); // ₦500
  const bought = await waitFor(msgs, m => m.t === 'you' && m.you.furniture.some(f => f.item === 'plastic_chair'));
  const fid = bought.you.furniture.find(f => f.item === 'plastic_chair').id;
  assert.equal(bought.you.money, 9500);

  act(ws, { a: 'sell_furniture', id: fid });
  const sold = await waitFor(msgs, m => m.t === 'you' && !m.you.furniture.some(f => f.id === fid));
  assert.equal(sold.you.money, 9750); // +₦250 refund
  assert.match(sold.note, /sold/i);
  const gone = await db.getFurnitureById(fid);
  assert.equal(gone, null);
  const ledger = await get('/api/transactions', A.token);
  const rows = ledger.json.transactions;
  assert.equal(rows[0].kind, 'sell_furniture');
  assert.equal(rows[0].amount, 250);
  assert.equal(rows[0].balance_after, 9750);
  ws.close();
});

test('M14 sell: placed item rejected; other owner\'s item rejected', async () => {
  const A = await seedGuest();
  await setChar(A.userId, { money: 10000 });
  const { ws: wsA, msgs: msgsA } = await connectAs(A);
  const chairId = await buyAndGetId(wsA, msgsA, 'plastic_chair');
  act(wsA, { a: 'place_furniture', id: chairId, placed: true });
  await waitFor(msgsA, m => m.t === 'you' && m.you.furniture.some(f => f.id === chairId && f.placed));

  act(wsA, { a: 'sell_furniture', id: chairId });
  const err1 = await waitFor(msgsA, m => m.t === 'err');
  assert.match(err1.text, /unplace/i);

  const B = await seedGuest();
  const { ws: wsB, msgs: msgsB } = await connectAs(B);
  act(wsB, { a: 'sell_furniture', id: chairId });
  const err2 = await waitFor(msgsB, m => m.t === 'err');
  assert.match(err2.text, /not yours/i);
  wsA.close(); wsB.close();
});
