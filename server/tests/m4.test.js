// M4 starter-loan tests: street_smart characters claim ONE ₦10,000 loan at
// 0% interest via the `loan` intent; normal ₦100k/10% rules are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

process.env.SESSION_SECRET = 'test-secret-eko-m4';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const { applyDayEconomy } = await import('../src/game/sim.js');

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

async function post(p, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body) });
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
// register + one-time character creation as street_smart (sets the flag)
async function streetSmartPlayer(username) {
  const r = await post('/api/auth/register', { username, password: 'password123', dob: '2000-01-01' });
  assert.equal(r.status, 200);
  const c = await post('/api/characters',
    { name: username, class: 'street_smart', avatar: '🧑', color: '#22d3ee' }, r.json.token);
  assert.equal(c.status, 200);
  assert.equal(c.json.character.starter_loan_available, true);
  return r.json.token;
}

test('starter loan: street_smart claims exactly ₦10,000 at 0%, flag consumed', async () => {
  const token = await streetSmartPlayer('starter_one');
  const me0 = await get('/api/me', token);
  assert.equal(me0.json.money, 5000);

  const { ws, msgs } = await connect(token);
  await waitFor(msgs, m => m.t === 'init');
  msgs.length = 0;
  ws.send(JSON.stringify({ t: 'act', a: 'loan', amount: 10000 }));
  const you = await waitFor(msgs, m => m.t === 'you' && m.note && m.note.includes('0% interest'));
  assert.equal(you.you.money, 15000);
  assert.equal(you.you.loan, 10000);
  assert.equal(you.you.loan_free, true);

  const me = await get('/api/me', token);
  assert.equal(me.json.starter_loan_available, false); // consumed — one per character
  assert.equal(me.json.loan, 10000);
  ws.close();
});

test('starter loan is one-time: a second claim is rejected', async () => {
  const token = await streetSmartPlayer('starter_two');
  const { ws, msgs } = await connect(token);
  await waitFor(msgs, m => m.t === 'init');
  msgs.length = 0;
  ws.send(JSON.stringify({ t: 'act', a: 'loan', amount: 10000 }));
  await waitFor(msgs, m => m.t === 'you' && m.note && m.note.includes('0% interest'));
  msgs.length = 0;
  ws.send(JSON.stringify({ t: 'act', a: 'loan', amount: 10000 }));
  const err = await waitFor(msgs, m => m.t === 'err');
  assert.match(err.text, /Repay your current loan first/);
  const me = await get('/api/me', token);
  assert.equal(me.json.loan, 10000); // no double-grant
  ws.close();
});

test('starter flag does not hijack normal loans: other amounts stay 10%', async () => {
  const token = await streetSmartPlayer('starter_three');
  const { ws, msgs } = await connect(token);
  await waitFor(msgs, m => m.t === 'init');
  msgs.length = 0;
  ws.send(JSON.stringify({ t: 'act', a: 'loan', amount: 50000 }));
  const you = await waitFor(msgs, m => m.t === 'you' && m.note && m.note.includes('10%'));
  assert.equal(you.you.loan, 50000);
  assert.equal(you.you.loan_free, false);
  const me = await get('/api/me', token);
  assert.equal(me.json.starter_loan_available, true); // flag kept for the real starter deal
  ws.close();
});

test('repaying the starter loan in full clears the 0% flag', async () => {
  const token = await streetSmartPlayer('starter_four');
  const { ws, msgs } = await connect(token);
  await waitFor(msgs, m => m.t === 'init');
  msgs.length = 0;
  ws.send(JSON.stringify({ t: 'act', a: 'loan', amount: 10000 }));
  await waitFor(msgs, m => m.t === 'you' && m.note && m.note.includes('0% interest'));
  msgs.length = 0;
  ws.send(JSON.stringify({ t: 'act', a: 'repay', amount: 10000 }));
  const you = await waitFor(msgs, m => m.t === 'you');
  assert.equal(you.you.loan, 0);
  assert.equal(you.you.loan_free, false);
  ws.close();
});

test('day economy: starter loan accrues 0% interest; normal loan accrues 10%', async () => {
  const mk = (loan, loanFree) => ({
    money: 0, savings: 0, loan, loan_free: loanFree, happiness: 60, energy: 100, health: 100, hunger: 100,
  });
  const starter = mk(10000, 1);
  const r1 = applyDayEconomy(starter, {});
  assert.equal(r1.loanInterest, 0);
  assert.equal(starter.loan, 10000);

  const normal = mk(10000, 0);
  const r2 = applyDayEconomy(normal, {});
  assert.equal(r2.loanInterest, 1000); // 10% of 10000, ceiled
  assert.equal(normal.loan, 11000);
});
