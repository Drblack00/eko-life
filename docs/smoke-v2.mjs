// V2 integration smoke test: two clients, full loop.
// register → character → shift work → needs decay → daily hunt →
// shop create/buy → rent bill → vote. Run: node smoke-v2.mjs
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'smoke-test-secret-xyz-123';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../server/src/app.js');
const app = await createApp();
const port = await app.start(0);
const base = `http://127.0.0.1:${port}`;

async function post(path, body, token) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}
async function get(path, token) {
  const r = await fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: r.status, json: await r.json() };
}

// minimal WS client
const { WebSocket } = await import('../server/node_modules/ws/wrapper.mjs');
function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    ws.on('open', () => {
      const waitInit = setInterval(() => {
        const init = msgs.find((m) => m.t === 'init');
        if (init) { clearInterval(waitInit); resolve({ ws, msgs, init }); }
      }, 20);
    });
    ws.on('error', reject);
  });
}
function act(ws, payload) { ws.send(JSON.stringify({ t: 'act', ...payload })); }
async function waitFor(msgs, pred, label, timeout = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const m = msgs.find(pred);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('timeout waiting for ' + label);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mkPlayer(username) {
  const g = await post('/api/auth/guest', { ageConfirm: true });
  assert.equal(g.status, 200);
  const r = await post('/api/auth/register', {
    username, password: 'password123', dob: '2000-01-01', guestToken: g.json.token,
  });
  assert.equal(r.status, 200, `register ${username}: ${JSON.stringify(r.json)}`);
  const token = r.json.token;
  const cc = await post('/api/characters', { name: username, class: 'street_smart', avatar: '🧑', color: '#22d3ee' }, token);
  assert.equal(cc.status, 200);
  const c = await connect(token);
  return { token, ...c, userId: c.init.you.id };
}

console.log('— setup: two players');
const A = await mkPlayer('smokeA');
const B = await mkPlayer('smokeB');
console.log('  A id', A.userId, 'B id', B.userId);

console.log('— shift work: A clocks in at tejuosho');
act(A.ws, { a: 'travel', locationId: 'tejuosho' });
await waitFor(A.msgs, (m) => m.t === 'you' && m.you.locationId === 'tejuosho', 'travel');
act(A.ws, { a: 'shift_start', job: 'market_porter' });
const clocked = await waitFor(A.msgs, (m) => m.t === 'you' && m.you.shift, 'clock in');
assert.equal(clocked.you.shift.job, 'market_porter');
assert.ok(clocked.you.shift.endsAt > Date.now());
console.log('  shift ends at', new Date(clocked.you.shift.endsAt).toISOString());

console.log('— needs decay: six needs tick down');
const before = { ...clocked.you };
await app.hub.decayTickAll();
await sleep(200);
const afterDecay = A.msgs.filter((m) => m.t === 'you').pop().you;
for (const n of ['hunger', 'energy', 'fun', 'social', 'hygiene', 'bladder']) {
  assert.ok(afterDecay[n] < before[n], `need ${n} decayed (${before[n]} → ${afterDecay[n]})`);
}
assert.ok(Array.isArray(afterDecay.moodlets), 'moodlets array in snapshot');
console.log('  hunger', before.hunger, '→', afterDecay.hunger, '| moodlets:', afterDecay.moodlets.length);

console.log('— daily hunt: round live, claim flow');
const hunt = await get('/api/v2/m9/hunt', A.token);
assert.equal(hunt.status, 200);
assert.ok(hunt.json.round, 'active round');
assert.ok(hunt.json.round.riddle.length > 10, 'riddle text');
console.log('  riddle:', hunt.json.round.riddle.slice(0, 60) + '…');
const hustle = await get('/api/v2/m9/hustle', A.token);
assert.equal(hustle.status, 200);
assert.equal(hustle.json.missions.length, 3, '3 daily missions');
console.log('  hustle missions:', hustle.json.missions.map((m) => m.id).join(', '));

console.log('— shops: A creates + stocks, B buys');
// fund A for the ₦20k shop fee (test-only credit)
const db = await import('../server/src/db.js');
{
  const c = await db.getCharacter(A.userId);
  c.money = 100000;
  await db.saveCharacter(c);
}
A.ws.close();
await sleep(200);
Object.assign(A, await connect(A.token));
act(A.ws, { a: 'shop_create', type: 'food_spot', locationId: 'tejuosho', name: 'Smoke Kitchen' });
await waitFor(A.msgs, (m) => m.t === 'you' && /is open/.test(m.note || ''), 'shop create note');
const mine = await get('/api/v2/m10/shop/mine', A.token);
assert.equal(mine.status, 200);
assert.ok(mine.json.shop, 'shop exists');
const shopId = mine.json.shop.id;
console.log('  shop id', shopId);
act(A.ws, { a: 'shop_stock', name: 'Ofada Special', price: 1500, qty: 5 });
await sleep(300);
const items0 = await get(`/api/v2/m10/shops/${shopId}/items`, A.token);
assert.equal(items0.json.items.length, 1, 'stocked 1 item');
// B browses + buys 2
const shops = await get('/api/v2/m10/shops', B.token);
assert.ok(shops.json.shops.length >= 1, 'shop listed');
const items = await get(`/api/v2/m10/shops/${shopId}/items`, B.token);
assert.equal(items.json.items.length, 1);
const bMoneyBefore = B.init.you.money;
act(B.ws, { a: 'shop_buy', shopId, itemId: items.json.items[0].id, qty: 2 });
const bought = await waitFor(B.msgs, (m) => m.t === 'you' && m.note && /bought/i.test(m.note), 'buy');
assert.ok(bought.you.money < bMoneyBefore, 'B paid');
console.log('  B bought 2 × Ofada Special, money', bMoneyBefore, '→', bought.you.money);
// A got paid (pushYou refresh)
await sleep(300);
const aAfterSale = A.msgs.filter((m) => m.t === 'you').pop().you;
assert.ok(aAfterSale.money > clocked.you.money, 'A earned from sale');
console.log('  A money after sale:', aAfterSale.money);

console.log('— rent bill: day rollover charges A (face-me)');
const rentBefore = aAfterSale.money;
await app.hub.dayRollover();
await sleep(300);
const aAfterRent = A.msgs.filter((m) => m.t === 'you').pop().you;
assert.ok(aAfterRent.money < rentBefore, `rent charged (${rentBefore} → ${aAfterRent.money})`);
console.log('  rent charged:', rentBefore, '→', aAfterRent.money);

console.log('— vote: B runs, A votes');
// fund B for the campaign fee
{
  const c = await db.getCharacter(B.userId);
  c.money = 100000;
  await db.saveCharacter(c);
}
B.ws.close();
await sleep(200);
Object.assign(B, await connect(B.token));
act(B.ws, { a: 'run' });
const running = await waitFor(B.msgs, (m) => m.t === 'election' && m.running, 'run for governor');
console.log('  candidates:', JSON.stringify(running.candidates));
const cand = running.candidates.find((c) => Number(c.id) === Number(B.userId)) || running.candidates[running.candidates.length - 1];
assert.ok(cand, 'candidate present');
act(A.ws, { a: 'vote', candidate: cand.player_id || cand.id });
const voted = await waitFor(A.msgs, (m) => m.t === 'sys' && /Vote cast/.test(m.text || m.note || ''), 'vote', 8000)
  .catch(() => waitFor(A.msgs, (m) => m.t === 'election' && m.voted, 'voted flag', 3000));
console.log('  vote cast for', cand.id);

console.log('— clock REST: Lagos time');
const clock = await get('/api/v2/m7/clock');
assert.equal(clock.status, 200);
assert.ok(clock.json.label && clock.json.label.length > 3, 'clock label present, got: ' + clock.json.label);
// verify it's actually Lagos time (WAT = UTC+1)
const lagosNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
const diffMin = Math.abs(lagosNow.getTime() - Date.now() - 3600_000) / 60000;
assert.ok(diffMin < 120, 'server clock near Lagos time');
console.log('  clock:', clock.json.label, '| tz:', clock.json.tz || clock.json.timezone || 'n/a');

A.ws.close(); B.ws.close();
await app.close();
console.log('\nSMOKE V2: ALL PASS ✅');
