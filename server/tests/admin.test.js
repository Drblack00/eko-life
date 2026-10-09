// Admin API tests (M4): gates, roster, broadcast, ban/unban, make-admin,
// election stub. First registered user in this fresh DB becomes admin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

process.env.SESSION_SECRET = 'test-secret-eko-admin';
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
function connectCloseCode(token) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${wsBase}/ws?token=${encodeURIComponent(token)}`);
    ws.on('close', (c) => resolve(c));
    ws.on('error', () => {});
    setTimeout(() => resolve('timeout'), 3000);
  });
}

let adminTok, userTok, userName, wsU, msgsU;

test('first registered user becomes admin; second does not', async () => {
  const a = await post('/api/auth/register', { username: 'adminone', password: 'password123', dob: '2000-01-01' });
  assert.equal(a.status, 200);
  assert.equal(a.json.is_admin, true);
  adminTok = a.json.token;
  const u = await post('/api/auth/register', { username: 'regularjoe', password: 'password123', dob: '2000-01-01' });
  assert.equal(u.status, 200);
  assert.equal(u.json.is_admin, false);
  userTok = u.json.token;
  userName = u.json.username;
});

test('requireAdmin gates: no token and non-admin → 403', async () => {
  const noTok = await get('/api/admin/players');
  assert.equal(noTok.status, 403);
  assert.equal(noTok.json.error, 'Admin only.');
  const notAdmin = await get('/api/admin/players', userTok);
  assert.equal(notAdmin.status, 403);
  const badTok = await post('/api/admin/broadcast', { text: 'x' }, 'bogus');
  assert.equal(badTok.status, 403);
});

test('GET /api/admin/players returns the roster', async () => {
  const { status, json } = await get('/api/admin/players', adminTok);
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.players));
  assert.equal(json.players.length, 2);
  const admin = json.players.find(p => p.username === 'adminone');
  const user = json.players.find(p => p.username === userName);
  assert.ok(admin && user);
  // required roster fields
  for (const p of [admin, user]) {
    assert.ok(Number.isInteger(p.id));
    assert.ok(p.stats && typeof p.stats.energy === 'number');
    assert.equal(typeof p.money, 'number');
    assert.equal(typeof p.housing, 'string');
    assert.equal(typeof p.online, 'boolean');
    assert.equal(typeof p.is_admin, 'boolean');
    assert.equal(typeof p.banned, 'boolean');
    assert.ok(p.last_seen === null || typeof p.last_seen === 'number');
  }
  assert.equal(admin.is_admin, true);
  assert.equal(user.is_admin, false);
  assert.equal(user.banned, false);
  assert.equal(user.online, false);
});

test('broadcast is profanity-filtered and reaches all online players', async () => {
  ({ ws: wsU, msgs: msgsU } = await connect(userTok));
  await waitFor(msgsU, m => m.t === 'init');
  msgsU.length = 0;
  const r = await post('/api/admin/broadcast', { text: 'hello fuck world' }, adminTok);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  const sys = await waitFor(msgsU, m => m.t === 'sys' && m.text.startsWith('📢'));
  assert.ok(sys.text.includes('***'), 'profanity must be filtered');
  assert.ok(!sys.text.includes('fuck'));
});

test('broadcast rejects empty text', async () => {
  const r = await post('/api/admin/broadcast', { text: '   ' }, adminTok);
  assert.equal(r.status, 400);
});

test('ban closes the online player WS with 4403', async () => {
  const closedCode = new Promise((resolve) => {
    wsU.once('close', (c) => resolve(c));
  });
  const r = await post('/api/admin/ban', { username: userName, banned: true }, adminTok);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, banned: true });
  assert.equal(await closedCode, 4403);

  // roster reflects the ban
  const roster = await get('/api/admin/players', adminTok);
  const user = roster.json.players.find(p => p.username === userName);
  assert.equal(user.banned, true);
  assert.equal(user.online, false);
});

test('banned player is rejected on WS connect (4403) and on REST (403)', async () => {
  const code = await connectCloseCode(userTok);
  assert.equal(code, 4403);
  const me = await get('/api/me', userTok);
  assert.equal(me.status, 403);
});

test('admins can never be banned; unknown user → 404', async () => {
  const banAdmin = await post('/api/admin/ban', { username: 'adminone', banned: true }, adminTok);
  assert.equal(banAdmin.status, 400);
  assert.match(banAdmin.json.error, /Cannot ban an admin/);
  const unknown = await post('/api/admin/ban', { username: 'ghost_xyz', banned: true }, adminTok);
  assert.equal(unknown.status, 404);
});

test('unban restores access', async () => {
  const r = await post('/api/admin/ban', { username: userName, banned: false }, adminTok);
  assert.deepEqual(r.json, { ok: true, banned: false });
  const me = await get('/api/me', userTok);
  assert.equal(me.status, 200);
});

test('make-admin promotes; unknown user → 404', async () => {
  const unknown = await post('/api/admin/make-admin', { username: 'ghost_xyz' }, adminTok);
  assert.equal(unknown.status, 404);
  const r = await post('/api/admin/make-admin', { username: userName }, adminTok);
  assert.deepEqual(r.json, { ok: true });
  // the promoted user now passes requireAdmin
  const roster = await get('/api/admin/players', userTok);
  assert.equal(roster.status, 200);
  const user = roster.json.players.find(p => p.username === userName);
  assert.equal(user.is_admin, true);
});

test('GET /api/admin/election returns the real cycle (M5)', async () => {
  const { status, json } = await get('/api/admin/election', adminTok);
  assert.equal(status, 200);
  assert.equal(json.election.active, true);
  assert.ok(json.election.id >= 1);
  assert.equal(json.election.endsInDays, 7);
  assert.deepEqual(json.election.candidates, []);
  assert.equal(json.governorId, 0);
  assert.equal(json.governor, null);
});
