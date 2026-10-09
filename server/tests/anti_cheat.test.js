// Anti-cheat tests (M4): the server is the ONLY writer of money/stats.
// Forged client values must never move money; negative amounts are rejected
// everywhere; concurrent double-spend loses; per-user act rate limiting holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

process.env.SESSION_SECRET = 'test-secret-eko-anticheat';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');

let base, wsBase, app;
const sockets = []; // force-closed in after() so a failed test can't hang server.close()

test.before(async () => {
  app = await createApp();
  const port = await app.start(0);
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
});
test.after(async () => {
  for (const s of sockets) { try { s.terminate(); } catch { /* ignore */ } }
  await app.close();
});

async function post(p, body) {
  const r = await fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}
async function get(p, token) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(base + p, { headers });
  return { status: r.status, json: await r.json() };
}

function collect(ws) {
  const msgs = [];
  ws.on('message', (raw) => {
    try { msgs.push(JSON.parse(raw.toString())); } catch { /* ignore */ }
  });
  return msgs;
}
function waitFor(msgs, pred, timeout = 4000) {
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
    sockets.push(ws);
    const msgs = collect(ws);
    ws.once('open', () => resolve({ ws, msgs }));
    ws.once('error', reject);
  });
}

test('forged money param on an act is ignored (server re-derives everything)', async () => {
  const g = await post('/api/auth/guest', { ageConfirm: true });
  assert.equal(g.status, 200);
  const { ws, msgs } = await connect(g.json.token);
  const init = await waitFor(msgs, m => m.t === 'init');
  const before = init.you.money; // 5000
  msgs.length = 0;

  // client claims a fantasy balance alongside a legit eat intent
  ws.send(JSON.stringify({ t: 'act', a: 'eat', item: 'agege_bread', money: 999999 }));
  const you = await waitFor(msgs, m => m.t === 'you');
  // only the real food cost (500) moved; the forged 999999 never landed
  assert.equal(you.you.money, before - 500);
  assert.ok(you.you.money < 5000 && you.you.money > 4000);
  ws.close();
});

test('negative amounts are rejected everywhere (bank / loan / repay)', async () => {
  const g = await post('/api/auth/guest', { ageConfirm: true });
  const { ws, msgs } = await connect(g.json.token);
  await waitFor(msgs, m => m.t === 'init');
  msgs.length = 0;

  ws.send(JSON.stringify({ t: 'act', a: 'bank', op: 'deposit', amount: -500 }));
  ws.send(JSON.stringify({ t: 'act', a: 'bank', op: 'withdraw', amount: -500 }));
  ws.send(JSON.stringify({ t: 'act', a: 'loan', amount: -1000 }));
  ws.send(JSON.stringify({ t: 'act', a: 'repay', amount: -50 }));
  const errs = [];
  for (let i = 0; i < 4; i++) {
    errs.push(await waitFor(msgs, m => m.t === 'err' && !errs.includes(m), 4000));
  }
  assert.equal(errs.length, 4);

  // nothing moved: DB is untouched by all four attempts
  const me = await get('/api/me', g.json.token);
  assert.equal(me.status, 200);
  assert.equal(me.json.money, 5000);
  assert.equal(me.json.savings, 0);
  assert.equal(me.json.loan, 0);
  ws.close();
});

test('double-spend race: two concurrent deposits → only one succeeds', async () => {
  const g = await post('/api/auth/guest', { ageConfirm: true });
  // guest starts with exactly ₦5,000 cash — enough for ONE deposit of 5,000
  const { ws, msgs } = await connect(g.json.token);
  const init = await waitFor(msgs, m => m.t === 'init');
  assert.equal(init.you.money, 5000);
  msgs.length = 0;

  // fire both requests in the same tick — no waiting between them
  ws.send(JSON.stringify({ t: 'act', a: 'bank', op: 'deposit', amount: 5000 }));
  ws.send(JSON.stringify({ t: 'act', a: 'bank', op: 'deposit', amount: 5000 }));

  const okMsg = await waitFor(msgs, m => m.t === 'you' && m.note && m.note.includes('Deposited'));
  assert.equal(okMsg.you.money, 0);
  assert.equal(okMsg.you.savings, 5000);
  // the second request sees the already-deducted balance and is refused
  const errMsg = await waitFor(msgs, m => m.t === 'err' && /don't have that much/.test(m.text));
  assert.ok(errMsg, 'second request must fail with insufficient funds');

  // final authoritative state: deposited once, nothing duplicated
  const after = await get('/api/me', g.json.token);
  assert.equal(after.json.money, 0);
  assert.equal(after.json.savings, 5000);
  ws.close();
});

test('act rate limit: past 30 acts/min the server drops with err', async () => {
  const g = await post('/api/auth/guest', { ageConfirm: true });
  const { ws, msgs } = await connect(g.json.token);
  await waitFor(msgs, m => m.t === 'init');
  msgs.length = 0;

  for (let i = 0; i < 35; i++) ws.send(JSON.stringify({ t: 'act', a: 'rest' }));
  const hit = await waitFor(msgs, m => m.t === 'err' && /Too many actions/.test(m.text), 5000);
  assert.ok(hit);
  // the connection itself survives the drop
  await new Promise(r => setTimeout(r, 100));
  assert.equal(ws.readyState, 1);
  ws.close();
});
