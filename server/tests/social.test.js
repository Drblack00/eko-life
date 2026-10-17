// PORT-P4 — Social: groups, message requests, house invites,
// closeness bonds (family & dating), social settings.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET='p4-test-secret';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const { _resetSocialRateLimit, _resetHangoutCooldown, GROUP_ICONS, GIFTS, HOUSE_GUEST_CAP } =
  await import('../src/routes/social.js');

let base, app;
const users = {};

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
async function put(p, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(base + p, { method: 'PUT', headers, body: JSON.stringify(body) });
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

async function mkuser(name) {
  const id = await db.createUser({ username: name });
  const token = signToken(id);
  users[name] = { id, token };
  return users[name];
}
async function giveCoins(u, amount) {
  const c = await db.ensureCharacter(u.id, u.id);
  c.money = amount;
  await db.saveCharacter(c);
}

/* ---------------- groups ---------------- */

test('groups: create validates name + members, owner auto-added', async () => {
  const a = await mkuser('socA');
  const b = await mkuser('socB');
  const r0 = await post('/api/social/groups', { name: '', icon: '🔥', members: ['socB'] }, a.token);
  assert.equal(r0.status, 400);
  const r1 = await post('/api/social/groups', { name: 'Owambe Gang', icon: '🔥', members: [] }, a.token);
  assert.equal(r1.status, 400);
  const r2 = await post('/api/social/groups', { name: 'Owambe Gang', icon: '🔥', members: ['nosuchuser99'] }, a.token);
  assert.equal(r2.status, 400);
  const r = await post('/api/social/groups', { name: 'Owambe Gang', icon: '🔥', members: ['socB', 'socB', 'socA'] }, a.token);
  assert.equal(r.status, 201);
  assert.equal(r.json.group.name, 'Owambe Gang');
  assert.equal(r.json.group.icon, '🔥');
  assert.deepEqual(r.json.group.members, ['socB']); // deduped, self skipped
  const list = await get('/api/social/groups', a.token);
  assert.equal(list.status, 200);
  const g = list.json.groups.find((x) => x.id === r.json.group.id);
  assert.ok(g);
  assert.equal(g.member_count, 2); // creator + socB
  assert.equal(g.role, 'owner');
});

test('groups: only owner can add members; members can leave; owner deletes', async () => {
  const a = await mkuser('socC');
  const b = await mkuser('socD');
  const c = await mkuser('socE');
  const r = await post('/api/social/groups', { name: 'Test Group', icon: '💬', members: ['socD'] }, a.token);
  const gid = r.json.group.id;
  const add1 = await post(`/api/social/groups/${gid}/members`, { username: 'socE' }, b.token);
  assert.equal(add1.status, 403); // not the owner
  const add2 = await post(`/api/social/groups/${gid}/members`, { username: 'socE' }, a.token);
  assert.equal(add2.status, 200);
  const leave = await post(`/api/social/groups/${gid}/leave`, {}, b.token);
  assert.equal(leave.status, 200);
  const del1 = await del(`/api/social/groups/${gid}`, b.token);
  assert.equal(del1.status, 403);
  const del2 = await del(`/api/social/groups/${gid}`, a.token);
  assert.equal(del2.status, 200);
  const list = await get('/api/social/groups', a.token);
  assert.ok(!list.json.groups.some((x) => x.id === gid));
});

test('groups: create rate limit (5/hour)', async () => {
  _resetSocialRateLimit();
  const a = await mkuser('socF');
  const b = await mkuser('socG');
  let last = null;
  for (let i = 0; i < 6; i++) {
    last = await post('/api/social/groups', { name: `G${i}`, icon: '💬', members: ['socG'] }, a.token);
  }
  assert.equal(last.status, 429);
});

test('groups: icon picker list has 16 entries', () => {
  assert.equal(GROUP_ICONS.length, 16);
});

/* ---------------- message requests ---------------- */

test('message requests: approve delivers the held DM; ignore drops it', async () => {
  const a = await mkuser('socH');
  const b = await mkuser('socI');
  // simulate the WS gate: stranger's first DM becomes a request row
  const reqId = await db.createDmRequest(a.id, b.id, 'hello stranger');
  assert.ok(!(await db.hasDmThread(a.id, b.id))); // no thread yet
  const pending = await get('/api/social/messages/requests', b.token);
  assert.equal(pending.status, 200);
  assert.equal(pending.json.requests.length, 1);
  assert.equal(pending.json.requests[0].from_username, 'socH');
  assert.equal(pending.json.requests[0].text, 'hello stranger');
  // a stranger's list is empty
  const none = await get('/api/social/messages/requests', a.token);
  assert.equal(none.json.requests.length, 0);
  // approve → the held message lands as a real DM, thread now exists
  const ap = await post(`/api/social/messages/requests/${reqId}/approve`, {}, b.token);
  assert.equal(ap.status, 200);
  assert.equal(ap.json.partner_id, a.id);
  assert.ok(await db.hasDmThread(a.id, b.id));
  const hist = await db.dmHistory(a.id, b.id);
  assert.ok(hist.some((m) => m.text === 'hello stranger'));
  // approving twice is gone
  const ap2 = await post(`/api/social/messages/requests/${reqId}/approve`, {}, b.token);
  assert.equal(ap2.status, 404);

  const c = await mkuser('socJ');
  const reqId2 = await db.createDmRequest(c.id, b.id, 'spam?');
  const ig = await post(`/api/social/messages/requests/${reqId2}/ignore`, {}, b.token);
  assert.equal(ig.status, 200);
  assert.ok(!(await db.hasDmThread(c.id, b.id)));
  const pending2 = await get('/api/social/messages/requests', b.token);
  assert.ok(!pending2.json.requests.some((r) => r.id === reqId2));
  // cannot approve someone else's request
  const ap3 = await post(`/api/social/messages/requests/${reqId2}/approve`, {}, a.token);
  assert.equal(ap3.status, 404);
});

/* ---------------- house invites ---------------- */

test('house invites: link scheme, knock flow, 5-guest cap, no rewards copy', async () => {
  assert.equal(HOUSE_GUEST_CAP, 5);
  const host = await mkuser('socHost');
  const inv = await get('/api/social/house/invite', host.token);
  assert.equal(inv.status, 200);
  assert.ok(inv.json.token.length >= 8);
  assert.match(inv.json.link, /\/v\//); // original scheme, not ?ref=
  assert.equal(inv.json.guest_cap, 5);
  // persistent: same token on repeat calls
  const inv2 = await get('/api/social/house/invite', host.token);
  assert.equal(inv2.json.token, inv.json.token);

  const guest = await mkuser('socGuest');
  const visit = await get(`/api/social/house/visit/${inv.json.token}`, guest.token);
  assert.equal(visit.status, 200);
  assert.equal(visit.json.host_username, 'socHost');
  const badVisit = await get('/api/social/house/visit/nope-not-real', guest.token);
  assert.equal(badVisit.status, 404);
  const ownVisit = await get(`/api/social/house/visit/${inv.json.token}`, host.token);
  assert.equal(ownVisit.status, 400);

  const knock = await post('/api/social/house/knock', { token: inv.json.token }, guest.token);
  assert.equal(knock.status, 201);
  const knock2 = await post('/api/social/house/knock', { token: inv.json.token }, guest.token);
  assert.equal(knock2.status, 409); // already knocking

  const knocks = await get('/api/social/house/knocks', host.token);
  assert.equal(knocks.json.pending.length, 1);
  assert.equal(knocks.json.pending[0].visitor_username, 'socGuest');
  const ok = await post(`/api/social/house/knocks/${knocks.json.pending[0].id}/approve`, {}, host.token);
  assert.equal(ok.status, 200);
  const after = await get('/api/social/house/knocks', host.token);
  assert.equal(after.json.guests.length, 1);

  // fill to the 5-guest cap
  for (let i = 0; i < 4; i++) {
    const g = await mkuser(`socG${i}`);
    const k = await post('/api/social/house/knock', { token: inv.json.token }, g.token);
    assert.equal(k.status, 201);
    const kk = await get('/api/social/house/knocks', host.token);
    const row = kk.json.pending.find((x) => x.visitor_username === `socG${i}`);
    const ap = await post(`/api/social/house/knocks/${row.id}/approve`, {}, host.token);
    assert.equal(ap.status, 200);
  }
  const extra = await mkuser('socExtra');
  const fullKnock = await post('/api/social/house/knock', { token: inv.json.token }, extra.token);
  assert.equal(fullKnock.status, 409); // house full — knock rejected at the door
  assert.match(fullKnock.json.error, /5 guests/);
  // the approve path guards too: force a pending row past the door check
  const forcedId = await db.createKnock(host.id, extra.id);
  const full = await post(`/api/social/house/knocks/${forcedId}/approve`, {}, host.token);
  assert.equal(full.status, 409); // house full at 5 guests
  assert.match(full.json.error, /5 guests/);
  const dec = await post(`/api/social/house/knocks/${forcedId}/decline`, {}, host.token);
  assert.equal(dec.status, 200);
});

/* ---------------- bonds: hangouts, gifts, family, dating ---------------- */

test('bonds: hangouts grow closeness with an hourly cooldown', async () => {
  _resetHangoutCooldown();
  const a = await mkuser('socK');
  const b = await mkuser('socL');
  const h1 = await post('/api/social/hangouts', { username: 'socL' }, a.token);
  assert.equal(h1.status, 200);
  assert.equal(h1.json.score, 15);
  const h2 = await post('/api/social/hangouts', { username: 'socL' }, a.token);
  assert.equal(h2.status, 429); // cooldown
  const detail = await get('/api/social/bonds/socL', a.token);
  assert.equal(detail.json.bond.hangout_count, 1);
  assert.equal(detail.json.bond.can_family, false);
  assert.equal(detail.json.thresholds.family_at, 50);
  assert.equal(detail.json.thresholds.date_at, 150);
});

test('bonds: gifts spend game coins and grow closeness', async () => {
  const a = await mkuser('socM');
  const b = await mkuser('socN');
  assert.ok(GIFTS.length >= 4);
  await giveCoins(a, 100000);
  const shelf = await get('/api/social/gifts/shelf', a.token);
  assert.ok(shelf.json.gifts.some((g) => g.id === 'gala' && g.cost === 500));
  const g1 = await post('/api/social/gifts', { username: 'socN', gift: 'gala' }, a.token);
  assert.equal(g1.status, 200);
  assert.equal(g1.json.balance, 99500);
  assert.equal(g1.json.score, 10);
  const poor = await mkuser('socPoor');
  const g2 = await post('/api/social/gifts', { username: 'socN', gift: 'asoebi' }, poor.token);
  assert.equal(g2.status, 402); // can't afford
  const g3 = await post('/api/social/gifts', { username: 'socN', gift: 'notreal' }, a.token);
  assert.equal(g3.status, 400);
});

test('bonds: family unlocks at closeness 50 with mutual accept', async () => {
  _resetHangoutCooldown();
  const a = await mkuser('socO');
  const b = await mkuser('socP');
  await giveCoins(a, 100000);
  // below threshold → blocked
  const early = await post('/api/social/family/request', { username: 'socP' }, a.token);
  assert.equal(early.status, 403);
  assert.match(early.json.error, /closeness 50/);
  // build closeness: 1 hangout (15) + 4 gifts (40) = 55
  await post('/api/social/hangouts', { username: 'socP' }, a.token);
  for (let i = 0; i < 4; i++) {
    const g = await post('/api/social/gifts', { username: 'socP', gift: 'gala' }, a.token);
    assert.equal(g.status, 200);
  }
  const req = await post('/api/social/family/request', { username: 'socP' }, a.token);
  assert.equal(req.status, 200);
  assert.equal(req.json.pending, true);
  const dup = await post('/api/social/family/request', { username: 'socP' }, a.token);
  assert.equal(dup.status, 409);
  // wrong direction can't accept
  const wrong = await post('/api/social/family/respond', { username: 'socP', accept: true }, a.token);
  assert.equal(wrong.status, 404);
  const acc = await post('/api/social/family/respond', { username: 'socO', accept: true }, b.token);
  assert.equal(acc.status, 200);
  assert.equal(acc.json.accepted, true);
  const detail = await get('/api/social/bonds/socP', a.token);
  assert.equal(detail.json.bond.family, 'family');
  assert.equal(detail.json.bond.can_family, true);
  const list = await get('/api/social/bonds', a.token);
  assert.ok(list.json.bonds.some((x) => x.other_username === 'socP' && x.family === 'family'));
});

test('bonds: dating unlocks at closeness 150', async () => {
  const a = await mkuser('socQ');
  const b = await mkuser('socR');
  const early = await post('/api/social/dating/request', { username: 'socR' }, a.token);
  assert.equal(early.status, 403);
  assert.match(early.json.error, /closeness 150/);
  for (let i = 0; i < 150; i++) await db.bumpBond(a.id, b.id, 'dms');
  const req = await post('/api/social/dating/request', { username: 'socR' }, a.token);
  assert.equal(req.status, 200);
  const no = await post('/api/social/dating/respond', { username: 'socQ', accept: false }, b.token);
  assert.equal(no.status, 200);
  assert.equal(no.json.accepted, false);
  const detail = await get('/api/social/bonds/socR', a.token);
  assert.equal(detail.json.bond.dating, 'none'); // declined resets
  assert.equal(detail.json.bond.can_date, true);
});

test('bonds: relationships visibility masks family/dating for viewers', async () => {
  const a = await mkuser('socT');
  const b = await mkuser('socU');
  for (let i = 0; i < 50; i++) await db.bumpBond(a.id, b.id, 'dms');
  await post('/api/social/family/request', { username: 'socU' }, a.token);
  await post('/api/social/family/respond', { username: 'socT', accept: true }, b.token);
  const vis = await get('/api/social/bonds/socU', a.token);
  assert.equal(vis.json.relationships_visible, true);
  assert.equal(vis.json.bond.family, 'family');
  await put('/api/social/settings', { relationships_visible: false }, b.token);
  const hid = await get('/api/social/bonds/socU', a.token);
  assert.equal(hid.json.relationships_visible, false);
  assert.equal(hid.json.bond.family, 'hidden');
  assert.equal(hid.json.bond.score, 50); // closeness itself stays visible
});

/* ---------------- settings ---------------- */

test('social settings: defaults, partial merge, validation', async () => {
  const a = await mkuser('socS');
  const d = await get('/api/social/settings', a.token);
  assert.equal(d.status, 200);
  assert.deepEqual(d.json.settings, {
    read_receipts: true,
    message_policy: 'everyone',
    relationships_visible: true,
  });
  const p1 = await put('/api/social/settings', { message_policy: 'friends' }, a.token);
  assert.equal(p1.status, 200);
  assert.equal(p1.json.settings.message_policy, 'friends');
  assert.equal(p1.json.settings.read_receipts, true); // merge, not reset
  const p2 = await put('/api/social/settings', { read_receipts: false }, a.token);
  assert.equal(p2.json.settings.read_receipts, false);
  assert.equal(p2.json.settings.message_policy, 'friends');
  const bad = await put('/api/social/settings', { message_policy: 'nobody' }, a.token);
  assert.equal(bad.status, 400);
});

test('auth: social endpoints require a token', async () => {
  const r = await get('/api/social/groups');
  assert.equal(r.status, 401);
  const r2 = await post('/api/social/groups', { name: 'x', members: ['y'] });
  assert.equal(r2.status, 401);
  const r3 = await get('/api/social/settings');
  assert.equal(r3.status, 401);
});
