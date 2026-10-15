// Cloud saves tests: GET /api/cloud-save lazy-creates a row, PUT
// round-trips payloads, the server-timestamp-wins rule yields 409
// conflicts when the stored row is newer, and guests are rejected.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'cloud-save-test-secret';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');

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
  let json = null;
  try { json = await r.json(); } catch { /* 413s have no JSON body */ }
  return { status: r.status, json };
}

async function register(username) {
  const r = await req('POST', '/api/auth/register', {
    username, password: 'pw123456', dob: '2000-01-01',
  });
  assert.equal(r.status, 200, `register ${username}: ${JSON.stringify(r.json)}`);
  return r.json.token;
}

async function guestToken() {
  const r = await req('POST', '/api/auth/guest', { ageConfirm: true });
  assert.equal(r.status, 200, `guest: ${JSON.stringify(r.json)}`);
  return r.json.token;
}

test('GET lazy-creates an empty row on first hit', async () => {
  const t = await register('clouduser1');
  const r = await req('GET', '/api/cloud-save', null, t);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.payload, {});
  assert.ok(Number.isFinite(r.json.updated_at));
  // second GET returns the same row
  const r2 = await req('GET', '/api/cloud-save', null, t);
  assert.equal(r2.status, 200);
  assert.equal(r2.json.updated_at, r.json.updated_at);
});

test('PUT round-trips the payload', async () => {
  const t = await register('clouduser2');
  const lazy = await req('GET', '/api/cloud-save', null, t); // lazy-create
  const payload = { blocked: { 42: 'spammer' }, walkthroughDone: true, charDone: true, v: 1 };
  const put = await req('PUT', '/api/cloud-save', { payload, client_updated_at: lazy.json.updated_at }, t);
  assert.equal(put.status, 200, JSON.stringify(put.json));
  assert.equal(put.json.ok, true);
  assert.ok(Number.isFinite(put.json.updated_at));
  const get = await req('GET', '/api/cloud-save', null, t);
  assert.deepEqual(get.json.payload, payload);
  assert.equal(get.json.updated_at, put.json.updated_at);
});

test('409 conflict when the stored row is newer than what the client saw', async () => {
  const t = await register('clouduser3');
  const a = { walkthroughDone: false, v: 1 };
  const first = await req('PUT', '/api/cloud-save', { payload: a, client_updated_at: 0 }, t);
  assert.equal(first.status, 200);
  // stale client (saw nothing, updated_at 0) writes a DIFFERENT payload → conflict
  const b = { walkthroughDone: true, v: 1 };
  const conflict = await req('PUT', '/api/cloud-save', { payload: b, client_updated_at: 0 }, t);
  assert.equal(conflict.status, 409, JSON.stringify(conflict.json));
  assert.equal(conflict.json.error, 'conflict');
  assert.deepEqual(conflict.json.server_payload, a);
  assert.equal(conflict.json.server_updated_at, first.json.updated_at);
  // server row is untouched
  const get = await req('GET', '/api/cloud-save', null, t);
  assert.deepEqual(get.json.payload, a);
  // same payload with a stale timestamp is not a conflict (redundant write)
  const same = await req('PUT', '/api/cloud-save', { payload: a, client_updated_at: 0 }, t);
  assert.equal(same.status, 200);
  // a client that SAW the server row wins normally
  const getAfter = await req('GET', '/api/cloud-save', null, t);
  const fresh = await req('PUT', '/api/cloud-save', { payload: b, client_updated_at: getAfter.json.updated_at }, t);
  assert.equal(fresh.status, 200);
  const get2 = await req('GET', '/api/cloud-save', null, t);
  assert.deepEqual(get2.json.payload, b);
});

test('guests are rejected with 403 on both routes', async () => {
  const g = await guestToken();
  const r1 = await req('GET', '/api/cloud-save', null, g);
  assert.equal(r1.status, 403);
  const r2 = await req('PUT', '/api/cloud-save', { payload: { v: 1 }, client_updated_at: 0 }, g);
  assert.equal(r2.status, 403);
});

test('payload validation: must be a plain object, capped at 64KB', async () => {
  const t = await register('clouduser4');
  let r = await req('PUT', '/api/cloud-save', { payload: [1, 2, 3], client_updated_at: 0 }, t);
  assert.equal(r.status, 400);
  r = await req('PUT', '/api/cloud-save', { payload: 'nope', client_updated_at: 0 }, t);
  assert.equal(r.status, 400);
  r = await req('PUT', '/api/cloud-save', { client_updated_at: 0 }, t);
  assert.equal(r.status, 400);
  r = await req('PUT', '/api/cloud-save', { payload: { v: 1 } }, t);
  assert.equal(r.status, 400); // missing client_updated_at
  // >64KB payload is rejected (413 — from the route's cap or the JSON body limit)
  const big = { v: 1, junk: 'x'.repeat(70 * 1024) };
  r = await req('PUT', '/api/cloud-save', { payload: big, client_updated_at: 0 }, t);
  assert.equal(r.status, 413, `expected 413, got ${r.status}`);
});

test('unauthenticated requests get 401', async () => {
  const r1 = await req('GET', '/api/cloud-save');
  assert.equal(r1.status, 401);
  const r2 = await req('PUT', '/api/cloud-save', { payload: { v: 1 }, client_updated_at: 0 });
  assert.equal(r2.status, 401);
});
