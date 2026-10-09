// WS integration tests: auth gate, presence, chat broadcast, move broadcast.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

process.env.SESSION_SECRET = 'test-secret-eko-ws';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');

let base, wsBase, app;

test.before(async () => {
  app = await createApp();
  const port = await app.start(0);
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
});
test.after(async () => { await app.close(); });

async function post(p, body) {
  const r = await fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}

function collect(ws) {
  const msgs = [];
  ws.on('message', (raw) => {
    try { msgs.push(JSON.parse(raw.toString())); } catch { /* ignore */ }
  });
  return msgs;
}

function waitFor(msgs, pred, timeout = 3000) {
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
    // attach the message collector BEFORE 'open' — the server sends `init`
    // in the same tick as the upgrade, so a post-open attach can lose it
    const msgs = collect(ws);
    ws.once('open', () => resolve({ ws, msgs }));
    ws.once('error', reject);
  });
}

let tokenA, tokenB, wsA, wsB, msgsA, msgsB, idA, idB;

test('two clients connect and receive init', async () => {
  const g = await post('/api/auth/guest', { ageConfirm: true });
  assert.equal(g.status, 200);
  tokenA = g.json.token;
  const r = await post('/api/auth/register', {
    username: 'wstestuser', password: 'password123', dob: '2000-01-01',
  });
  assert.equal(r.status, 200);
  tokenB = r.json.token;

  ({ ws: wsA, msgs: msgsA } = await connect(tokenA));
  const initA = await waitFor(msgsA, m => m.t === 'init');
  idA = initA.you.id;
  assert.ok(initA.you.username.startsWith('Guest_'));
  assert.equal(initA.day, 1);
  assert.ok(initA.config);
  assert.equal(initA.config.locations.length, 68); // M3 world expansion

  ({ ws: wsB, msgs: msgsB } = await connect(tokenB));
  const initB = await waitFor(msgsB, m => m.t === 'init');
  idB = initB.you.id;
  assert.equal(initB.you.username, 'wstestuser');
  assert.ok(initB.players.some(p => p.id === idA), 'B sees A in players list');

  // A sees B join
  const join = await waitFor(msgsA, m => m.t === 'join' && m.p.id === idB);
  assert.equal(join.p.name, 'wstestuser');
});

test('chat broadcast reaches both clients', async () => {
  wsA.send(JSON.stringify({ t: 'chat', text: 'hello eko life' }));
  const onA = await waitFor(msgsA, m => m.t === 'chat' && m.text === 'hello eko life');
  const onB = await waitFor(msgsB, m => m.t === 'chat' && m.text === 'hello eko life');
  assert.equal(onA.name, onB.name);
});

test('profanity is filtered', async () => {
  wsB.send(JSON.stringify({ t: 'chat', text: 'this is shit, honestly' }));
  const hit = await waitFor(msgsA, m => m.t === 'chat' && m.text.includes('***'));
  assert.ok(!hit.text.includes('shit'));
});

test('move broadcast reaches the other client (validated coords)', async () => {
  // small legit step from the spawn area — anti-cheat allows it
  wsA.send(JSON.stringify({ t: 'move', lat: 16, lng: 63 }));
  const mv = await waitFor(msgsB, m => m.t === 'mv' && m.id === idA);
  assert.equal(mv.lat, 16);
  assert.equal(mv.lng, 63);
});

test('teleport-speed move is snapped back (anti-cheat)', async () => {
  wsA.send(JSON.stringify({ t: 'move', lat: 90, lng: 90 })); // ~100 units in ms — impossible
  const snap = await waitFor(msgsA, m => m.t === 'snap');
  assert.ok(Number.isFinite(snap.lat) && Number.isFinite(snap.lng));
  // no far broadcast went out
  const before = msgsB.length;
  await new Promise(r => setTimeout(r, 300));
  const bad = msgsB.slice(before).filter(m => m.t === 'mv' && m.lat === 90);
  assert.equal(bad.length, 0);
});

test('out-of-bounds move is ignored (no broadcast)', async () => {
  const before = msgsB.length;
  wsA.send(JSON.stringify({ t: 'move', lat: 999, lng: -5 }));
  await new Promise(r => setTimeout(r, 400));
  const bad = msgsB.slice(before).filter(m => m.t === 'mv' && m.lat === 999);
  assert.equal(bad.length, 0);
});

test('unknown message types are ignored safely', async () => {
  wsA.send(JSON.stringify({ t: 'nonsense', foo: 1 }));
  wsA.send('not even json{{{');
  await new Promise(r => setTimeout(r, 300));
  // connection still alive: server answers a ping-style chat check via stats on demand
  assert.equal(wsA.readyState, 1);
});

test('unauthenticated WS is rejected', async () => {
  const code = await new Promise((resolve) => {
    const ws = new WebSocket(`${wsBase}/ws?token=bogus-token`);
    ws.on('close', (c) => resolve(c));
    ws.on('error', () => {});
    setTimeout(() => resolve('timeout'), 3000);
  });
  assert.equal(code, 4401);
});

test('leave broadcast on disconnect', async () => {
  wsB.close();
  const leave = await waitFor(msgsA, m => m.t === 'leave' && m.id === idB);
  assert.ok(leave);
  wsA.close();
});
