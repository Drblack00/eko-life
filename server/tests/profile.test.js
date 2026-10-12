// Character panel profile tests: PUT /api/me/profile (username + display
// name changes) and email_masked on GET /api/me.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'test-secret-for-profile-tests';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');

let base, app;

test.before(async () => {
  app = await createApp();
  const port = await app.start(0);
  base = `http://127.0.0.1:${port}`;
});
test.after(async () => { await app.close(); });

async function req(method, p, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json() };
}

async function register(username, email) {
  const r = await req('POST', '/api/auth/register', {
    username, password: 'pw123456', dob: '2000-01-01', ...(email ? { email } : {}),
  });
  assert.equal(r.status, 200, `register ${username}: ${JSON.stringify(r.json)}`);
  return r.json.token;
}

test('username change validates like registration and enforces uniqueness', async () => {
  const t1 = await register('profuser1');
  const t2 = await register('profuser2');

  // invalid: too short
  let r = await req('PUT', '/api/me/profile', { username: 'ab' }, t1);
  assert.equal(r.status, 400);
  // invalid: bad chars
  r = await req('PUT', '/api/me/profile', { username: 'has space' }, t1);
  assert.equal(r.status, 400);
  // taken
  r = await req('PUT', '/api/me/profile', { username: 'profuser2' }, t1);
  assert.equal(r.status, 409);
  // ok
  r = await req('PUT', '/api/me/profile', { username: 'profuser1_new' }, t1);
  assert.equal(r.status, 200);
  assert.equal(r.json.username, 'profuser1_new');
  // reflected on /api/me
  const me = await req('GET', '/api/me', null, t1);
  assert.equal(me.json.username, 'profuser1_new');
  // same value is a no-op success
  r = await req('PUT', '/api/me/profile', { username: 'profuser1_new' }, t1);
  assert.equal(r.status, 200);
  // other user unaffected
  const me2 = await req('GET', '/api/me', null, t2);
  assert.equal(me2.json.username, 'profuser2');
});

test('display name change works; guests can change name but not username', async () => {
  const t = await register('profuser3');
  let r = await req('PUT', '/api/me/profile', { name: 'Lagos Big Boy' }, t);
  assert.equal(r.status, 200);
  assert.equal(r.json.name, 'Lagos Big Boy');
  const me = await req('GET', '/api/me', null, t);
  assert.equal(me.json.name, 'Lagos Big Boy');
  // empty name rejected
  r = await req('PUT', '/api/me/profile', { name: '   ' }, t);
  assert.equal(r.status, 400);

  const g = await req('POST', '/api/auth/guest', { ageConfirm: true });
  const gt = g.json.token;
  r = await req('PUT', '/api/me/profile', { username: 'guestpick' }, gt);
  assert.equal(r.status, 400);
  r = await req('PUT', '/api/me/profile', { name: 'Guest Star' }, gt);
  assert.equal(r.status, 200);
  assert.equal(r.json.name, 'Guest Star');
});

test('email_masked is masked on /api/me and null without email', async () => {
  const t = await register('profuser4', 'jane.doe@example.com');
  const me = await req('GET', '/api/me', null, t);
  assert.equal(me.json.email_masked, 'j***@e***.com');
  assert.ok(!String(me.json.email_masked).includes('jane'));

  const t2 = await register('profuser5');
  const me2 = await req('GET', '/api/me', null, t2);
  assert.equal(me2.json.email_masked, null);
});

test('profile endpoint requires auth', async () => {
  const r = await req('PUT', '/api/me/profile', { name: 'Nope' });
  assert.equal(r.status, 401);
});
