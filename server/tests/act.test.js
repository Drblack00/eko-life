// M2 gameplay integration tests: act intents over WS, rent rollover,
// character creation, position persistence, money-safety fuzz.
//
// NOTE: auth endpoints are rate-limited (10/min/IP) in this process, so
// gameplay users are seeded directly via db.createUser + signToken.
// Only the tests that specifically exercise the HTTP auth flow use it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

process.env.SESSION_SECRET = 'test-secret-eko-act';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');

let base, wsBase, app;

test.before(async () => {
  app = await createApp();
  const port = await app.start(0);
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
});

// Track every client socket: failed assertions must not leak an open
// connection, or server.close() in test.after hangs forever.
const sockets = new Set();
test.after(async () => {
  for (const ws of sockets) { try { ws.close(); } catch { /* ignore */ } }
  await new Promise(r => setTimeout(r, 300));
  await app.close();
});

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

function waitFor(msgs, pred, timeout = 5000) {
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

// Seed a playable user directly (bypasses HTTP auth rate limits), then run
// the real character-creation endpoint over HTTP.
let guestN = 0;
async function guestWithCharacter(classId) {
  guestN += 1;
  const username = 'seedguest' + guestN;
  const userId = await db.createUser({ username, is_guest: 1 });
  const token = signToken(userId);
  const name = 'T' + guestN + 'x' + Math.floor(Math.random() * 1e4);
  const cc = await post('/api/characters', {
    name, class: classId, avatar: '🧑', color: '#22d3ee',
  }, token);
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

async function act(msgs, ws, payload) {
  ws.send(JSON.stringify({ t: 'act', ...payload }));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------- character creation (HTTP) ----------------
test('character creation: one-time only, class package applied', async () => {
  const g = await post('/api/auth/guest', { ageConfirm: true });
  assert.equal(g.status, 200);

  const first = await post('/api/characters', {
    name: 'SilverOne', class: 'silver_spoon', avatar: '😎', color: '#fbbf24',
  }, g.json.token);
  assert.equal(first.status, 200);
  assert.equal(first.json.ok, true);
  const ch = first.json.character;
  assert.equal(ch.name, 'SilverOne');
  assert.equal(ch.class, 'silver_spoon');
  assert.equal(ch.money, 50000);          // silver_spoon package
  assert.equal(ch.housing, 'selfcon');
  assert.equal(ch.happiness, 70);         // 60 base + 10 class bonus
  assert.equal(ch.avatar, '😎');
  assert.equal(ch.color, '#fbbf24');
  assert.equal(ch.customized, true);
  assert.equal(ch.starter_loan_available, false);

  // second attempt is rejected — customization is one-time
  const second = await post('/api/characters', {
    name: 'Other', class: 'street_smart', avatar: '🧑', color: '#22d3ee',
  }, g.json.token);
  assert.equal(second.status, 400);
  assert.match(second.json.error, /already created/i);

  // street_smart package on a different account
  const g2 = await post('/api/auth/guest', { ageConfirm: true });
  const ss = await post('/api/characters', {
    name: 'Hustler', class: 'street_smart', avatar: '🧑', color: '#22d3ee',
  }, g2.json.token);
  assert.equal(ss.status, 200);
  assert.equal(ss.json.character.money, 5000);
  assert.equal(ss.json.character.housing, 'face-me');
  assert.equal(ss.json.character.starter_loan_available, true);
});

test('character creation: validation', async () => {
  const g = await post('/api/auth/guest', { ageConfirm: true });
  const bad = (body) => post('/api/characters', body, g.json.token);
  assert.equal((await bad({ name: 'ab', class: 'street_smart', avatar: '🧑', color: '#22d3ee' })).status, 400);
  assert.equal((await bad({ name: 'Bad Name!', class: 'street_smart', avatar: '🧑', color: '#22d3ee' })).status, 400);
  assert.equal((await bad({ name: 'FineName', class: 'nope', avatar: '🧑', color: '#22d3ee' })).status, 400);
  assert.equal((await bad({ name: 'FineName', class: 'street_smart', avatar: '💩', color: '#22d3ee' })).status, 400);
  assert.equal((await bad({ name: 'FineName', class: 'street_smart', avatar: '🧑', color: '#ffffff' })).status, 400);
  assert.equal((await bad({})).status, 400);
  // still customizable after failed attempts
  const ok = await bad({ name: 'ValidOne', class: 'street_smart', avatar: '🧑', color: '#22d3ee' });
  assert.equal(ok.status, 200);
});

// ---------------- work ----------------
test('work: street_smart pays 10% hustle bonus, ledger row written', async () => {
  const A = await guestWithCharacter('street_smart');
  const { ws, msgs, init } = await connectAs(A);
  assert.ok(Number.isFinite(init.you.x));
  assert.ok(Number.isFinite(init.you.y));
  assert.equal(init.you.locationId, 'ojuelegba');

  await act(msgs, ws, { a: 'travel', locationId: 'tejuosho' });
  const traveled = await waitFor(msgs, m => m.t === 'you' && m.you.locationId === 'tejuosho');
  assert.equal(traveled.you.energy, 95); // travel costs 5 energy
  assert.equal(traveled.you.x, 28);      // tejuosho coords in snapshot

  await act(msgs, ws, { a: 'work', job: 'market_porter' });
  const worked = await waitFor(msgs, m => m.t === 'you' && m.you.money === 7750);
  assert.equal(worked.you.money, 5000 + Math.floor(2500 * 1.1)); // +2750
  assert.equal(worked.you.energy, 70);   // 95 − 25
  assert.match(worked.note, /2,750/);

  const tx = await db.listTransactions(A.userId);
  const pay = tx.find(t => t.kind === 'work_pay');
  assert.ok(pay);
  assert.equal(pay.amount, 2750);
  assert.equal(pay.balance_after, 7750);
  ws.close();
});

test('work: blocked at wrong location', async () => {
  const A = await guestWithCharacter('street_smart');
  const { ws, msgs } = await connectAs(A);
  await act(msgs, ws, { a: 'work', job: 'market_porter' }); // at ojuelegba, job at tejuosho
  const err = await waitFor(msgs, m => m.t === 'err' && /Tejuosho/.test(m.text));
  assert.ok(err);
  ws.close();
});

test('work: blocked by per-job cooldown', async () => {
  const A = await guestWithCharacter('street_smart');
  const { ws, msgs } = await connectAs(A);
  await act(msgs, ws, { a: 'travel', locationId: 'tejuosho' });
  await waitFor(msgs, m => m.t === 'you' && m.you.locationId === 'tejuosho');
  await act(msgs, ws, { a: 'work', job: 'market_porter' });
  await waitFor(msgs, m => m.t === 'you' && /Market Porter/.test(m.note || ''));
  await act(msgs, ws, { a: 'work', job: 'market_porter' });
  const err = await waitFor(msgs, m => m.t === 'err' && /available in \d+s/.test(m.text));
  assert.ok(err);
  ws.close();
});

test('work: blocked by low energy', async () => {
  const A = await guestWithCharacter('street_smart');
  await setChar(A.userId, { energy: 10, location_id: 'tejuosho' });
  const { ws, msgs } = await connectAs(A);
  await act(msgs, ws, { a: 'work', job: 'market_porter' });
  const err = await waitFor(msgs, m => m.t === 'err' && /Too tired/.test(m.text));
  assert.ok(err);
  ws.close();
});

test('work: silver_spoon pays 10% less (soft-life tax)', async () => {
  const B = await guestWithCharacter('silver_spoon');
  const { ws, msgs } = await connectAs(B);
  await act(msgs, ws, { a: 'travel', locationId: 'tejuosho' });
  await waitFor(msgs, m => m.t === 'you' && m.you.locationId === 'tejuosho');
  await act(msgs, ws, { a: 'work', job: 'market_porter' });
  const worked = await waitFor(msgs, m => m.t === 'you' && m.you.money === 52250);
  assert.equal(worked.you.money, 50000 + Math.floor(2500 * 0.9)); // +2250
  ws.close();
});

test('work: cert-required job rejects without certificate; unknown job → err', async () => {
  const A = await guestWithCharacter('street_smart');
  const { ws, msgs } = await connectAs(A);
  await act(msgs, ws, { a: 'travel', locationId: 'ikoyi' });
  await waitFor(msgs, m => m.t === 'you' && m.you.locationId === 'ikoyi');
  await act(msgs, ws, { a: 'work', job: 'junior_dev' });
  const certErr = await waitFor(msgs, m => m.t === 'err' && /certificate/i.test(m.text));
  assert.ok(certErr);
  await act(msgs, ws, { a: 'work', job: 'astronaut' });
  const unknownErr = await waitFor(msgs, m => m.t === 'err' && /Unknown job/.test(m.text));
  assert.ok(unknownErr);
  ws.close();
});

// ---------------- eat / sleep / rest / fun / travel ----------------
test('eat: blocked when broke; succeeds when affordable', async () => {
  const B = await guestWithCharacter('street_smart');
  await setChar(B.userId, { money: 100 });
  let s = await connectAs(B);
  await act(s.msgs, s.ws, { a: 'eat', item: 'mama_put' });
  const err = await waitFor(s.msgs, m => m.t === 'err' && /afford/.test(m.text));
  assert.ok(err);
  s.ws.close();
  await sleep(250);

  await setChar(B.userId, { money: 1000 });
  s = await connectAs(B);
  await act(s.msgs, s.ws, { a: 'eat', item: 'mama_put' });
  const ate = await waitFor(s.msgs, m => m.t === 'you' && m.you.money === 200);
  assert.equal(ate.you.money, 200); // 1000 − 800
  const tx = await db.listTransactions(B.userId);
  const food = tx.find(t => t.kind === 'food');
  assert.ok(food);
  assert.equal(food.amount, -800);
  assert.equal(food.balance_after, 200);
  s.ws.close();
});

test('sleep: restores energy, 60s cooldown', async () => {
  const C = await guestWithCharacter('street_smart');
  await setChar(C.userId, { energy: 20, hunger: 100, health: 90 });
  const { ws, msgs } = await connectAs(C);
  await act(msgs, ws, { a: 'sleep' });
  const slept = await waitFor(msgs, m => m.t === 'you' && m.you.energy === 100);
  assert.equal(slept.you.hunger, 85);   // −15
  assert.equal(slept.you.health, 100); // +10 clamped
  await act(msgs, ws, { a: 'sleep' });
  const err = await waitFor(msgs, m => m.t === 'err' && /just slept/.test(m.text));
  assert.ok(err);
  ws.close();
});

test('rest: +15 energy with 30s soft cooldown', async () => {
  const A = await guestWithCharacter('street_smart');
  await setChar(A.userId, { energy: 20 });
  const { ws, msgs } = await connectAs(A);
  await act(msgs, ws, { a: 'rest' });
  const rested = await waitFor(msgs, m => m.t === 'you' && m.you.energy === 35);
  assert.equal(rested.you.energy, 35);
  await act(msgs, ws, { a: 'rest' });
  const err = await waitFor(msgs, m => m.t === 'err' && /Catch your breath/.test(m.text));
  assert.ok(err);
  ws.close();
});

test('fun: requires being at the linked location', async () => {
  const A = await guestWithCharacter('street_smart');
  await setChar(A.userId, { money: 5000, energy: 100 });
  const { ws, msgs } = await connectAs(A);
  await act(msgs, ws, { a: 'fun', what: 'beach_day' });
  const err = await waitFor(msgs, m => m.t === 'err' && /Lekki Beach/.test(m.text));
  assert.ok(err);
  await act(msgs, ws, { a: 'travel', locationId: 'lekki_beach' });
  await waitFor(msgs, m => m.t === 'you' && m.you.locationId === 'lekki_beach');
  await act(msgs, ws, { a: 'fun', what: 'beach_day' });
  const fun = await waitFor(msgs, m => m.t === 'you' && m.note && /Beach Day/.test(m.note));
  assert.equal(fun.you.money, 3800); // −200 cross-region fare (M3), −1000 fun
  assert.equal(fun.you.energy, 85);  // 95 − 10
  ws.close();
});

test('travel: unknown location → err; unknown action → err; connection survives', async () => {
  const A = await guestWithCharacter('street_smart');
  const { ws, msgs } = await connectAs(A);
  await act(msgs, ws, { a: 'travel', locationId: 'atlantis' });
  const e1 = await waitFor(msgs, m => m.t === 'err' && /Unknown location/.test(m.text));
  assert.ok(e1);
  await act(msgs, ws, { a: 'fly_to_moon' });
  const e2 = await waitFor(msgs, m => m.t === 'err' && /Unknown action/.test(m.text));
  assert.ok(e2);
  assert.equal(ws.readyState, 1);
  ws.close();
});

// ---------------- position persistence ----------------
test('move: position persisted on disconnect, restored on reconnect', async () => {
  const D = await guestWithCharacter('street_smart');
  const s = await connectAs(D);
  s.ws.send(JSON.stringify({ t: 'move', lat: 16, lng: 63 })); // small legit step (anti-cheat)
  await sleep(150);
  s.ws.close();
  await sleep(400); // disconnect save is fire-and-forget
  const c = await db.getCharacter(D.userId);
  assert.equal(Number(c.x), 16);
  assert.equal(Number(c.y), 63);

  const s2 = await connectAs(D);
  assert.equal(s2.init.you.x, 16);
  assert.equal(s2.init.you.y, 63);
  s2.ws.close();
});

// ---------------- decay tick ----------------
test('decayTickAll: hunger decays, persists, pushes you', async () => {
  const E = await guestWithCharacter('street_smart');
  await setChar(E.userId, { hunger: 50 });
  const { ws, msgs } = await connectAs(E);
  await app.hub.decayTickAll();
  const pushed = await waitFor(msgs, m => m.t === 'you' && m.you.hunger === 47);
  assert.equal(pushed.you.hunger, 47);
  const c = await db.getCharacter(E.userId);
  assert.equal(Number(c.hunger), 47);
  ws.close();
});

// ---------------- rent rollover ----------------
test('day rollover: rent charged for online players', async () => {
  const F = await guestWithCharacter('street_smart'); // face_me rent 5000
  await setChar(F.userId, { money: 9000 });
  const { ws, msgs } = await connectAs(F);
  await app.hub.dayRollover();
  // NOTE: dayRollover resolves after the server SENDS; the client receives
  // over TCP a tick later, so poll with waitFor instead of asserting inline.
  const rentSys = await waitFor(msgs, m => m.t === 'sys' && /Rent paid/.test(m.text));
  assert.ok(rentSys);
  const youPaid = await waitFor(msgs, m => m.t === 'you' && m.you.money === 4000);
  assert.ok(youPaid);
  const tx = await db.listTransactions(F.userId);
  const rent = tx.find(t => t.kind === 'rent');
  assert.ok(rent);
  assert.equal(rent.amount, -5000);
  assert.equal(rent.balance_after, 4000);
  ws.close();
});

test('day rollover: 3 missed rents → eviction to bridge', async () => {
  const G = await guestWithCharacter('street_smart');
  await setChar(G.userId, { money: 0, housing: 'face-me', rent_misses: 0, happiness: 80 });
  const { ws, msgs } = await connectAs(G);
  await app.hub.dayRollover();
  await app.hub.dayRollover();
  await app.hub.dayRollover();
  const evicted = await waitFor(msgs, m => m.t === 'sys' && /EVICTED/.test(m.text));
  assert.ok(evicted);
  const c = await db.getCharacter(G.userId);
  assert.equal(c.housing, 'bridge');
  assert.equal(Number(c.happiness), 60);
  assert.equal(Number(c.rent_misses), 0);
  assert.ok(Number(c.money) >= 0);
  ws.close();
});

// ---------------- money-safety fuzz ----------------
test('fuzz: random action sequences never drive money negative', async () => {
  const H = await guestWithCharacter('street_smart');
  const { ws, msgs } = await connectAs(H);
  const acts = [
    { a: 'work', job: 'market_porter' },
    { a: 'work', job: 'danfo_conductor' },
    { a: 'work', job: 'junior_dev' },
    { a: 'work', job: 'nope' },
    { a: 'eat', item: 'mama_put' },
    { a: 'eat', item: 'ofada' },
    { a: 'eat', item: 'bogus' },
    { a: 'fun', what: 'beach_day' },
    { a: 'fun', what: 'cinema' },
    { a: 'fun', what: 'bogus' },
    { a: 'sleep' },
    { a: 'rest' },
    { a: 'travel', locationId: 'tejuosho' },
    { a: 'travel', locationId: 'lekki_beach' },
    { a: 'travel', locationId: 'nowhere' },
    { a: 'bogus_action' },
    {},
  ];
  let seed = 123456789;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 120; i++) {
    const p = acts[Math.floor(rand() * acts.length)];
    ws.send(JSON.stringify({ t: 'act', ...p }));
    if (i % 20 === 0) ws.send(JSON.stringify({ t: 'move', lat: 10, lng: 90 }));
    await sleep(8);
  }
  await sleep(600);
  assert.equal(ws.readyState, 1, 'connection must survive the fuzz run');
  // every server reply is a known message type
  const known = new Set(['init', 'you', 'err', 'sys', 'mv', 'day', 'stats', 'join', 'leave', 'chat', 'snap', 'spawn', 'despawn']);
  for (const m of msgs) assert.ok(known.has(m.t), `unexpected message type: ${m.t}`);
  const c = await db.getCharacter(H.userId);
  assert.ok(Number(c.money) >= 0, 'money went negative');
  assert.equal(Number(c.money), Math.floor(Number(c.money)), 'money not an integer');
  for (const s of ['energy', 'health', 'happiness', 'hunger']) {
    assert.ok(Number(c[s]) >= 0 && Number(c[s]) <= 100, `stat ${s} out of range`);
  }
  ws.close();
});

// ---------------- full flow ----------------
test('guest → register → create-character → WS act full flow', async () => {
  const g = await post('/api/auth/guest', { ageConfirm: true });
  assert.equal(g.status, 200);
  const guestToken = g.json.token;

  // connect briefly as guest
  const wg = await connectAs({ token: guestToken });
  wg.ws.close();

  // migrate to a full account (progress kept)
  const r = await post('/api/auth/register', {
    username: 'fullflow1', password: 'password123', dob: '2000-01-01', guestToken,
  });
  assert.equal(r.status, 200);
  const token = r.json.token;

  // create character
  const cc = await post('/api/characters', {
    name: 'FullFlow', class: 'street_smart', avatar: '🧑', color: '#22d3ee',
  }, token);
  assert.equal(cc.status, 200);
  assert.equal(cc.json.character.name, 'FullFlow');

  // play over WS
  const { ws, msgs, init } = await connectAs({ token });
  assert.equal(init.you.name, 'FullFlow');
  assert.equal(init.you.money, 5000);
  await act(msgs, ws, { a: 'travel', locationId: 'oshodi' });
  await waitFor(msgs, m => m.t === 'you' && m.you.locationId === 'oshodi');
  await act(msgs, ws, { a: 'work', job: 'danfo_conductor' });
  const worked = await waitFor(msgs, m => m.t === 'you' && m.note && /Danfo Conductor/.test(m.note));
  assert.equal(worked.you.money, 5000 + Math.floor(3200 * 1.1)); // +3520
  ws.close();
});
