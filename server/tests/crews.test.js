// Crews tests: discover, create, join, leave, contribute (gameplay coins
// only — no real money anywhere), goal progress math.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'test-secret-eko-crews';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');

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

let n = 0;
async function seedUser(money = 100000) {
  n += 1;
  const username = 'crewu' + n;
  const userId = await db.createUser({ username, is_guest: 1 });
  const c = await db.getCharacter(userId);
  c.money = money;
  await db.saveCharacter(c);
  return { userId, username, token: signToken(userId) };
}

let A, B, C;
test('setup users', async () => {
  A = await seedUser(10_000_000);
  B = await seedUser(100_000);
  C = await seedUser(100_000);
  assert.ok(A.token && B.token && C.token);
});

test('GET /api/crews requires auth', async () => {
  const r = await get('/api/crews');
  assert.equal(r.status, 401);
});

test('GET /api/crews: crews start empty', async () => {
  const r = await get('/api/crews', A.token);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.crews, []);
  assert.equal(r.json.myCrewId, null);
});

let hustlersId, danfoId;
test('POST /api/crews: create + founder membership', async () => {
  const r = await post('/api/crews', { name: 'Lagos Hustlers', tagline: 'We move.', icon: '💼' }, A.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  const crew = r.json.crew;
  assert.equal(crew.name, 'Lagos Hustlers');
  assert.equal(crew.myRole, 'founder');
  assert.equal(crew.memberCount, 1);
  assert.ok(crew.id);
  hustlersId = crew.id;
});

test('POST /api/crews: name validation', async () => {
  let r = await post('/api/crews', { name: 'AB' }, B.token);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /3–24 characters/);
  r = await post('/api/crews', { name: 'x'.repeat(25) }, B.token);
  assert.equal(r.status, 400);
});

test('POST /api/crews: duplicate name rejected', async () => {
  const r = await post('/api/crews', { name: 'Lagos Hustlers' }, B.token);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /already exists/);
});

test('POST /api/crews: already in a crew rejected', async () => {
  const r = await post('/api/crews', { name: 'Second Crew' }, A.token);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /already in a crew/);
});

test('GET /api/crews: list shows member counts + weekly xp, sorted', async () => {
  const r = await post('/api/crews', { name: 'Danfo Kings', icon: '🚌' }, B.token);
  assert.equal(r.status, 200);
  danfoId = r.json.crew.id;
  for (const sort of ['active', 'members', 'xp']) {
    const l = await get(`/api/crews?sort=${sort}`, A.token);
    assert.equal(l.status, 200);
    assert.equal(l.json.crews.length, 2);
    const hustlers = l.json.crews.find((c) => c.name === 'Lagos Hustlers');
    assert.equal(hustlers.memberCount, 1);
    assert.equal(hustlers.weeklyXp, 25, 'join xp lands in the weekly log');
    assert.equal(hustlers.rank, 1, 'ranked by total xp');
    assert.equal(l.json.myCrewId, hustlersId, 'viewer crew surfaced');
  }
});

test('GET /api/crews: bad sort rejected', async () => {
  const r = await get('/api/crews?sort=bogus', A.token);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /Sort must be/);
});

test('POST /api/crews/:id/join: join works, duplicate + second-crew rejected', async () => {
  let r = await post(`/api/crews/${hustlersId}/join`, {}, C.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.match(r.json.notice, /Welcome/);
  r = await post(`/api/crews/${hustlersId}/join`, {}, C.token);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /already in this crew/);
  r = await post(`/api/crews/${danfoId}/join`, {}, C.token);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /leave it first/);
});

test('POST /api/crews/:id/join: unknown crew 404', async () => {
  const r = await post('/api/crews/nope/join', {}, C.token);
  assert.equal(r.status, 404);
});

test('GET /api/crews/:id: detail shape — members, goal, board', async () => {
  const r = await get(`/api/crews/${hustlersId}`, A.token);
  assert.equal(r.status, 200);
  const d = r.json;
  assert.equal(d.crew.name, 'Lagos Hustlers');
  assert.equal(d.crew.memberCount, 2, 'A + C');
  assert.equal(d.my.crewId, hustlersId);
  assert.equal(d.my.role, 'founder');
  assert.equal(d.members.length, 2);
  assert.ok(d.members.some((m) => m.username === A.username && m.role === 'founder'));
  assert.ok(d.goal, 'default shared goal exists');
  assert.equal(d.goal.target, 5_000_000);
  assert.equal(d.goal.raised, 0);
  assert.equal(d.goal.pct, 0);
  assert.ok(d.goal.daysLeft >= 6, '7-day goal window');
  assert.equal(d.board.length, 2);
  assert.deepEqual(d.board.map((b) => b.rank), [1, 2]);
  assert.ok(d.board.every((b) => b.movement === 0));
  const mine = d.board.find((b) => b.isMine);
  assert.equal(mine.name, 'Lagos Hustlers');
});

test('GET /api/crews/:id: unknown crew 404', async () => {
  const r = await get('/api/crews/nope', A.token);
  assert.equal(r.status, 404);
});

test('POST /api/crews/:id/contribute: deducts coins, goal + xp math', async () => {
  const before = (await db.getCharacter(C.userId)).money;
  const r = await post(`/api/crews/${hustlersId}/contribute`, { amount: 10000 }, C.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.raised, 10000);
  assert.equal(r.json.target, 5_000_000);
  assert.equal(r.json.pct, 0, '₦10k of ₦5M floors to 0%');
  assert.equal(r.json.xpEarned, 10, '₦1,000 → 1 xp');
  const after = (await db.getCharacter(C.userId)).money;
  assert.equal(after, before - 10000, 'gameplay coins deducted');
  const tx = await db.listTransactions(C.userId, 5);
  assert.ok(tx.some((t) => t.kind === 'crew' && Number(t.amount) === -10000));
  const d = await get(`/api/crews/${hustlersId}`, A.token);
  const me = d.json.members.find((m) => m.username === C.username);
  assert.equal(me.xp, 25 + 10, 'join xp + contribution xp');
});

test('POST /api/crews/:id/contribute: validation', async () => {
  let r = await post(`/api/crews/${hustlersId}/contribute`, { amount: 50 }, C.token);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /at least ₦100/);
  r = await post(`/api/crews/${hustlersId}/contribute`, { amount: 'nope' }, C.token);
  assert.equal(r.status, 400);
  // non-member can't contribute
  const D = await seedUser(100_000);
  r = await post(`/api/crews/${hustlersId}/contribute`, { amount: 10000 }, D.token);
  assert.equal(r.status, 403);
  // broke member can't afford
  const poor = await seedUser(500);
  const jr = await post(`/api/crews/${hustlersId}/join`, {}, poor.token);
  assert.equal(jr.status, 200);
  r = await post(`/api/crews/${hustlersId}/contribute`, { amount: 10000 }, poor.token);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /Hustle first/);
});

test('goal progress math: pct scales with raised', async () => {
  const r = await post(`/api/crews/${hustlersId}/contribute`, { amount: 2_500_000 }, A.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.raised, 2_510_000);
  assert.equal(r.json.pct, 50, '₦2.51M of ₦5M floors to 50%');
  const d = await get(`/api/crews/${hustlersId}`, A.token);
  assert.equal(d.json.goal.raised, 2_510_000);
  assert.equal(d.json.goal.pct, 50);
});

test('POST /api/crews/:id/leave: founder hands over to earliest member', async () => {
  const E = await seedUser(), F = await seedUser(), G = await seedUser();
  let r = await post('/api/crews', { name: 'Crew Three', icon: '⚽' }, E.token);
  assert.equal(r.status, 200);
  const id = r.json.crew.id;
  await post(`/api/crews/${id}/join`, {}, F.token);
  await post(`/api/crews/${id}/join`, {}, G.token);
  r = await post(`/api/crews/${id}/leave`, {}, E.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.disbanded, undefined);
  const d = await get(`/api/crews/${id}`, F.token);
  const founder = d.json.members.find((m) => m.role === 'founder');
  assert.equal(founder.username, F.username, 'earliest joiner promoted');
  // F + G leave → crew disbands
  await post(`/api/crews/${id}/leave`, {}, G.token);
  r = await post(`/api/crews/${id}/leave`, {}, F.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.disbanded, true);
  const gone = await get(`/api/crews/${id}`, F.token);
  assert.equal(gone.status, 404);
});

test('POST /api/crews/:id/leave: not a member rejected', async () => {
  const H = await seedUser();
  const r = await post(`/api/crews/${hustlersId}/leave`, {}, H.token);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /not in this crew/);
});
