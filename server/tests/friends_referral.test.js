// W3 — Friends page REST API + referral links.
// Covers: friend request flow (send → accept → listed; decline; cancel;
// remove), no self-add, idempotent duplicates, authz isolation, referral
// code uniqueness, signup attribution via ref code, invalid codes ignored,
// self-referral blocked, declined-request revival.
// NOTE: user rows are created via db.createUser + signToken (not the HTTP
// register endpoint) so this file stays under the auth rate limit; the
// register-with-ref paths go through HTTP intentionally (3-4 calls).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'w3-friends-referral-test-secret';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');

let base, app;
const ids = {};   // name -> user id
const tokens = {}; // name -> bearer token

test.before(async () => {
  app = await createApp();
  const port = await app.start(0);
  base = `http://127.0.0.1:${port}`;
  for (const name of ['w3_alice', 'w3_bob', 'w3_cara', 'w3_dan']) {
    const id = await db.createUser({ username: name });
    ids[name] = id;
    tokens[name] = signToken(id);
  }
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
async function del(p, token) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(base + p, { method: 'DELETE', headers });
  return { status: r.status, json: await r.json() };
}
const T = (n) => tokens[n];

async function httpRegister(username, ref) {
  return post('/api/auth/register', {
    username, password: 'password123', dob: '2000-01-01', ...(ref ? { ref } : {}),
  });
}

// ---------- referral codes ----------

test('referral codes are deterministic, unique, URL-safe, and round-trip', () => {
  const codes = new Set();
  for (const name of Object.keys(ids)) {
    const code = db.encodeReferralCode(ids[name]);
    assert.match(code, /^[0-9A-Za-z]{11}$/, 'URL-safe fixed-length code');
    assert.ok(!codes.has(code), 'unique per user');
    codes.add(code);
    assert.equal(db.decodeReferralCode(code), ids[name], 'round-trips to the user id');
  }
  assert.equal(db.decodeReferralCode('!!!'), null);
  assert.equal(db.decodeReferralCode('short'), null);
  assert.equal(db.decodeReferralCode(''), null);
  assert.equal(db.decodeReferralCode(null), null);
});

test('GET /api/referral/:code resolves the username; unknown codes 404', async () => {
  const code = db.encodeReferralCode(ids.w3_alice);
  const ok = await get(`/api/referral/${code}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.username, 'w3_alice');

  const missing = await get(`/api/referral/${db.encodeReferralCode(999999)}`);
  assert.equal(missing.status, 404);

  const bad = await get('/api/referral/not-a-code!');
  assert.equal(bad.status, 404);
});

test('signup with a valid ref code attributes the referral', async () => {
  const code = db.encodeReferralCode(ids.w3_alice);
  const r = await httpRegister('w3_erin', code);
  assert.equal(r.status, 200);
  const erinId = Number((await db.getUserByName('w3_erin')).id);
  const row = await db.getReferralFor(erinId);
  assert.ok(row, 'referral row recorded');
  assert.equal(Number(row.referrer_id), ids.w3_alice);
  assert.equal(await db.countReferrals(ids.w3_alice), 1);
});

test('signup with an invalid ref code still succeeds with no attribution', async () => {
  const r = await httpRegister('w3_finn', db.encodeReferralCode(999999));
  assert.equal(r.status, 200);
  const finnId = Number((await db.getUserByName('w3_finn')).id);
  assert.equal(await db.getReferralFor(finnId), null);
});

test('self-referral is blocked (db level + guest-migration register path)', async () => {
  assert.equal(await db.recordReferral(ids.w3_bob, ids.w3_bob), false);
  // guest signs up with their OWN code via the migration path → no row
  const g = await post('/api/auth/guest', { ageConfirm: true });
  assert.equal(g.status, 200);
  const { verifyToken } = await import('../src/auth.js');
  const guestId = verifyToken(g.json.token);
  const ownCode = db.encodeReferralCode(guestId);
  const r = await post('/api/auth/register', {
    username: 'w3_gus', password: 'password123', dob: '2000-01-01',
    guestToken: g.json.token, ref: ownCode,
  });
  assert.equal(r.status, 200);
  assert.equal(await db.getReferralFor(guestId), null);
});

test('duplicate attribution is rejected (one row per referred user)', async () => {
  const erinId = Number((await db.getUserByName('w3_erin')).id);
  assert.equal(await db.recordReferral(ids.w3_bob, erinId), false);
  assert.equal(Number((await db.getReferralFor(erinId)).referrer_id), ids.w3_alice);
});

// ---------- friends REST ----------

test('unauthenticated friends requests are rejected', async () => {
  assert.equal((await get('/api/friends')).status, 401);
  assert.equal((await post('/api/friends/request', { username: 'w3_bob' })).status, 401);
});

test('send → incoming/outgoing → accept → both list as friends', async () => {
  const sent = await post('/api/friends/request', { username: 'w3_bob' }, T('w3_alice'));
  assert.equal(sent.status, 200);
  assert.equal(sent.json.result, 'ok');
  assert.ok(sent.json.friendship.id);

  const bobReqs = await get('/api/friends/requests', T('w3_bob'));
  assert.equal(bobReqs.json.incoming.length, 1);
  assert.equal(bobReqs.json.incoming[0].other_username, 'w3_alice');
  assert.equal(bobReqs.json.outgoing.length, 0);

  const aliceReqs = await get('/api/friends/requests', T('w3_alice'));
  assert.equal(aliceReqs.json.outgoing.length, 1);
  assert.equal(aliceReqs.json.outgoing[0].other_username, 'w3_bob');

  const fid = bobReqs.json.incoming[0].id;
  const acc = await post(`/api/friends/${fid}/accept`, {}, T('w3_bob'));
  assert.equal(acc.status, 200);

  for (const n of ['w3_alice', 'w3_bob']) {
    const list = await get('/api/friends', T(n));
    assert.equal(list.status, 200);
    assert.equal(list.json.friends.length, 1);
    assert.equal(list.json.friends[0].status, 'accepted');
    assert.equal(list.json.friends[0].online, false); // no WS in tests
  }
});

test('duplicate requests are idempotent (no duplicate row)', async () => {
  const again = await post('/api/friends/request', { username: 'w3_bob' }, T('w3_alice'));
  assert.equal(again.status, 200);
  assert.equal(again.json.result, 'exists');
  const list = await get('/api/friends', T('w3_alice'));
  assert.equal(list.json.friends.length, 1);
});

test('mutual requests auto-accept into a single friendship', async () => {
  await post('/api/friends/request', { username: 'w3_alice' }, T('w3_dan'));
  const back = await post('/api/friends/request', { username: 'w3_dan' }, T('w3_alice'));
  assert.equal(back.json.result, 'accepted');
  const list = await get('/api/friends', T('w3_alice'));
  const danRows = list.json.friends.filter((f) => f.other_username === 'w3_dan');
  assert.equal(danRows.length, 1);
  assert.equal(danRows[0].status, 'accepted');
});

test('self-add is rejected', async () => {
  const r = await post('/api/friends/request', { username: 'w3_alice' }, T('w3_alice'));
  assert.equal(r.status, 400);
  assert.match(r.json.error, /yourself/);
});

test('request to unknown user 404s', async () => {
  const r = await post('/api/friends/request', { username: 'w3_nobody' }, T('w3_alice'));
  assert.equal(r.status, 404);
});

test('authz: a third user cannot accept/decline/cancel someone else’s request', async () => {
  await post('/api/friends/request', { username: 'w3_cara' }, T('w3_bob'));
  const caraReqs = await get('/api/friends/requests', T('w3_cara'));
  const fid = caraReqs.json.incoming[0].id;

  assert.equal((await post(`/api/friends/${fid}/accept`, {}, T('w3_alice'))).status, 404);
  assert.equal((await post(`/api/friends/${fid}/decline`, {}, T('w3_alice'))).status, 404);
  assert.equal((await del(`/api/friends/${fid}`, T('w3_alice'))).status, 404);
  // requester cannot accept their own outgoing request either
  assert.equal((await post(`/api/friends/${fid}/accept`, {}, T('w3_bob'))).status, 403);

  // users only ever see their own data: alice's list has no bob↔cara row
  const aliceList = await get('/api/friends', T('w3_alice'));
  assert.ok(!aliceList.json.friends.some((f) => f.other_username === 'w3_cara'));

  // cleanup: cara declines
  assert.equal((await post(`/api/friends/${fid}/decline`, {}, T('w3_cara'))).status, 200);
});

test('decline clears the pending request; a later request starts fresh', async () => {
  await post('/api/friends/request', { username: 'w3_cara' }, T('w3_bob'));
  const caraReqs = await get('/api/friends/requests', T('w3_cara'));
  const fid = caraReqs.json.incoming.find((r) => r.other_username === 'w3_bob').id;
  assert.equal((await post(`/api/friends/${fid}/decline`, {}, T('w3_cara'))).status, 200);
  const after = await get('/api/friends/requests', T('w3_cara'));
  assert.equal(after.json.incoming.length, 0);

  const retry = await post('/api/friends/request', { username: 'w3_cara' }, T('w3_bob'));
  assert.equal(retry.json.result, 'ok');
  const back = await get('/api/friends/requests', T('w3_cara'));
  assert.equal(back.json.incoming.length, 1);
});

test('cancel removes an outgoing pending request', async () => {
  const caraReqs = await get('/api/friends/requests', T('w3_cara'));
  const fid = caraReqs.json.incoming[0].id;
  // addressee cannot cancel via DELETE — only the sender can
  assert.equal((await del(`/api/friends/${fid}`, T('w3_cara'))).status, 403);
  assert.equal((await del(`/api/friends/${fid}`, T('w3_bob'))).status, 200);
  const after = await get('/api/friends/requests', T('w3_bob'));
  assert.equal(after.json.outgoing.length, 0);
});

test('unfriend removes the accepted friendship for both sides', async () => {
  const list = await get('/api/friends', T('w3_alice'));
  const fid = list.json.friends.find((f) => f.other_username === 'w3_bob').id;
  assert.equal((await del(`/api/friends/${fid}`, T('w3_alice'))).status, 200);
  for (const n of ['w3_alice', 'w3_bob']) {
    const l = await get('/api/friends', T(n));
    assert.ok(!l.json.friends.some((f) => f.other_username === (n === 'w3_alice' ? 'w3_bob' : 'w3_alice')));
  }
});

test('lookup returns a profile snippet for an exact username', async () => {
  const hit = await get('/api/friends/lookup?username=w3_bob', T('w3_alice'));
  assert.equal(hit.status, 200);
  assert.equal(hit.json.username, 'w3_bob');
  assert.ok(typeof hit.json.avatar === 'string');
  assert.equal(hit.json.is_self, false);

  const self = await get('/api/friends/lookup?username=w3_alice', T('w3_alice'));
  assert.equal(self.json.is_self, true);

  assert.equal((await get('/api/friends/lookup?username=w3_nobody', T('w3_alice'))).status, 404);
});

test('invite endpoint returns code, link, and join count', async () => {
  const r = await get('/api/friends/invite', T('w3_alice'));
  assert.equal(r.status, 200);
  assert.equal(r.json.code, db.encodeReferralCode(ids.w3_alice));
  assert.ok(r.json.link.includes(`?ref=${r.json.code}`), 'shareable link carries the code');
  assert.equal(r.json.joined, 1); // w3_erin signed up via alice's link
  const bob = await get('/api/friends/invite', T('w3_bob'));
  assert.equal(bob.json.joined, 0);
});
