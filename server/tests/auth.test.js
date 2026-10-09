// auth flow tests: guest → register migration, 18+ gate, lockout.
// NOTE: auth endpoints are rate-limited (10/min/IP), so this file makes
// exactly 10 auth requests. Keep it that way.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'test-secret-eko-auth';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { verifyToken } = await import('../src/auth.js');

let base, app;

test.before(async () => {
  app = await createApp();
  const port = await app.start(0);
  base = `http://127.0.0.1:${port}`;
});
test.after(async () => { await app.close(); });

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

test('guest creation + guest → register migration keeps character progress (in place)', async () => {
  const g = await post('/api/auth/guest', { ageConfirm: true });
  assert.equal(g.status, 200);
  assert.ok(g.json.token);
  assert.match(g.json.username, /^Guest_[0-9a-f]{6}$/);
  assert.equal(g.json.guest, true);
  const guestId = verifyToken(g.json.token);
  assert.ok(guestId);

  // simulate gameplay progress directly in the DB (no gameplay mutations in M1)
  const ch = await db.getCharacter(guestId);
  ch.money = 12345;
  ch.energy = 42;
  await db.saveCharacter(ch);

  const r = await post('/api/auth/register', {
    username: 'migrator1',
    password: 'password123',
    dob: '2000-01-01',
    guestToken: g.json.token,
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.username, 'migrator1');
  // same user id, new token
  assert.equal(verifyToken(r.json.token), guestId);

  const me = await get('/api/me', r.json.token);
  assert.equal(me.status, 200);
  assert.equal(me.json.money, 12345);
  assert.equal(me.json.energy, 42);
  assert.equal(me.json.guest, false);
  assert.equal(me.json.username, 'migrator1');

  // first-ever user becomes admin
  assert.equal(me.json.is_admin, true);
});

test('under-18 register is rejected', async () => {
  const { status, json } = await post('/api/auth/register', {
    username: 'kiddo1',
    password: 'password123',
    dob: '2015-06-01',
  });
  assert.equal(status, 400);
  assert.match(json.error, /18/);
});

test('5 wrong passwords → 15-minute lockout', async () => {
  const reg = await post('/api/auth/register', {
    username: 'lockme1',
    password: 'correcthorsebatterystaple',
    dob: '1999-05-05',
  });
  assert.equal(reg.status, 200);

  for (let i = 0; i < 5; i++) {
    const { status } = await post('/api/auth/login', { username: 'lockme1', password: 'wrong' });
    assert.equal(status, 401);
  }
  // even the correct password is now locked out
  const { status, json } = await post('/api/auth/login', {
    username: 'lockme1',
    password: 'correcthorsebatterystaple',
  });
  assert.equal(status, 429);
  assert.match(json.error, /locked/i);
});
