// P6 — Table games tests: catalogue, escrow on create/join/leave,
// 5%-house-cut payout math, draw refunds, hall of fame, watch-live,
// and the placeholder-AI simulator's invariants.
// The games router is mounted on a standalone express app (in-memory DB),
// following the contests test pattern.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-do-not-use';
process.env.EKO_DB_PATH = ':memory:';

const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const { createGamesRouter } = await import('../src/routes/games.js');
const tg = await import('../src/game/tablegames.js');

let base, server;
test.before(async () => {
  await db.initDb();
  const { runMigrations } = await import('../migrations/runner.js');
  await runMigrations();
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/games', createGamesRouter());
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  if (server) await new Promise((r) => server.close(r));
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

let n = 0;
async function seedUser(money = 0) {
  n += 1;
  const username = 'gmu' + n;
  const userId = await db.createUser({ username, is_guest: 1 });
  await db.ensureCharacter(userId, username);
  if (money) {
    await db.dbRun('UPDATE characters SET money=? WHERE user_id=?',
      'UPDATE characters SET money=$1 WHERE user_id=$2', [money, userId]);
  }
  return { userId, username, token: signToken(userId) };
}
async function balance(u) {
  const c = await db.ensureCharacter(u.userId, u.username);
  return Math.floor(Number(c.money) || 0);
}

// ---------- pure game-module math ----------

test('catalogue: 5 original games, stakes, venues, variants', () => {
  assert.equal(tg.GAMES.length, 5);
  const keys = tg.GAMES.map((g) => g.key);
  assert.deepEqual(keys, ['zanga', 'seedcircle', 'gbam', 'fourcorners', 'grandeko']);
  // None of the reference's names leak into ours.
  const blob = JSON.stringify(tg.GAMES).toLowerCase();
  for (const banned of ['8-ball', 'ayo olopon', 'whot!', 'lagos life']) assert.ok(!blob.includes(banned));
  assert.ok(tg.STAKE_TIERS.includes(0) && tg.STAKE_TIERS.includes(10000000));
  assert.equal(tg.VENUES.length, 3);
  assert.ok(tg.VENUES.every((v) => !/ojuelegba|amala shitta|oga sunday/i.test(v.name)));
});

test('pot math: winner takes 95%, house keeps 5%', () => {
  assert.equal(tg.potFor(10000, 2), 20000);
  assert.equal(tg.winnerPayout(10000, 2), 19000);
  assert.equal(tg.houseKeeps(10000, 2), 1000);
  assert.equal(tg.winnerPayout(1000, 2), 1900); // matches the ₦1,000 → ₦1,900 shape
  assert.equal(tg.shortfall(500, 1000), 500);
  assert.equal(tg.shortfall(5000, 1000), 0);
});

test('simulateMatch: every game returns a valid outcome + log with a fixed rng', () => {
  // Cycling deterministic RNG — makes progress in every simulator branch.
  let s = 0.13;
  const rng = () => { s = (s + 0.37) % 1; return s; };
  for (const g of tg.GAMES) {
    const r = tg.simulateMatch(g.key, rng);
    assert.ok(['win', 'loss', 'draw'].includes(r.outcome), g.key);
    assert.ok(r.scoreText.length > 0);
    assert.ok(Array.isArray(r.log) && r.log.length >= 2, g.key);
  }
  // draw forced
  const d = tg.simulateMatch('zanga', () => 0.01);
  assert.equal(d.outcome, 'draw');
  // loss forced
  const l = tg.simulateMatch('zanga', () => 0.99);
  assert.equal(l.outcome, 'loss');
});

// ---------- API ----------

test('GET / returns catalogue + myBalance', async () => {
  const u = await seedUser(5000);
  const r = await get('/api/games', u.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.games.length, 5);
  assert.equal(r.json.houseCutPct, 5);
  assert.equal(r.json.myBalance, 5000);
  assert.ok(r.json.note.toLowerCase().includes('cpu'));
});

test('create table escrows the creator stake; join disabled math surfaces needMore', async () => {
  const rich = await seedUser(100000);
  const poor = await seedUser(500);
  const c = await post('/api/games/tables',
    { game: 'zanga', venue: 'cue-house', stake: 5000 }, rich.token);
  assert.equal(c.status, 201);
  assert.equal(c.json.table.stake, 5000);
  assert.equal(c.json.table.seatsTaken, 1);
  assert.equal(await balance(rich), 95000); // stake held

  const j = await post(`/api/games/tables/${c.json.table.id}/join`, {}, poor.token);
  assert.equal(j.status, 400);
  assert.match(j.json.error, /need ₦4,500 more/);

  const tables = await get('/api/games/tables', poor.token);
  const row = tables.json.tables.find((t) => t.id === c.json.table.id);
  assert.ok(row);
  assert.equal(row.needMore, 4500);
});

test('join seats a second player and charges them; leave refunds', async () => {
  const a = await seedUser(20000);
  const b = await seedUser(20000);
  const c = await post('/api/games/tables',
    { game: 'gbam', venue: 'kitchen-yard', stake: 20000 }, a.token);
  const id = c.json.table.id;
  const j = await post(`/api/games/tables/${id}/join`, {}, b.token);
  assert.equal(j.status, 200);
  assert.equal(j.json.table.seatsTaken, 2);
  assert.equal(await balance(b), 0);
  const lv = await post(`/api/games/tables/${id}/leave`, {}, b.token);
  assert.equal(lv.status, 200);
  assert.equal(await balance(b), 20000); // refunded
});

test('start resolves a match with consistent money + hof + replay window', async () => {
  const u = await seedUser(50000);
  const c = await post('/api/games/tables',
    { game: 'fourcorners', venue: 'viewing-centre', stake: 20000 }, u.token);
  const id = c.json.table.id;
  const before = await balance(u);
  assert.equal(before, 30000);
  const s = await post(`/api/games/tables/${id}/start`, {}, u.token);
  assert.equal(s.status, 200);
  const m = s.json.match;
  assert.ok(['win', 'loss', 'draw'].includes(m.outcome));
  assert.equal(m.pot, 40000);
  assert.ok(m.log.length >= 2);
  const after = await balance(u);
  // win: +38000 · draw: +20000 back · loss: +0
  assert.ok([before + 38000, before + 20000, before].includes(after),
    `balance ${after} not one of the legal outcomes`);
  if (m.outcome === 'win') assert.equal(m.payout, 38000);

  const fame = await get('/api/games/fame/fourcorners', u.token);
  assert.equal(fame.status, 200);
  assert.ok(fame.json.me, 'money game recorded in hof');
  assert.equal(fame.json.me.games, 1);
  assert.ok(fame.json.me.winPct === 100 || fame.json.me.winPct === 0);

  const live = await get('/api/games/live', u.token);
  assert.ok(live.json.live.some((x) => x.id === m.id), 'match visible in the replay window');
  const watch = await get(`/api/games/live/${m.id}`, u.token);
  assert.equal(watch.status, 200);
  assert.deepEqual(watch.json.log, m.log);
});

test('friendly tables move no coins and skip the hall of fame', async () => {
  const u = await seedUser(1000);
  const c = await post('/api/games/tables',
    { game: 'grandeko', venue: 'cue-house', stake: 0 }, u.token);
  assert.equal(c.status, 201);
  assert.equal(await balance(u), 1000);
  const s = await post(`/api/games/tables/${c.json.table.id}/start`, {}, u.token);
  assert.equal(s.status, 200);
  assert.equal(await balance(u), 1000);
  const fame = await get('/api/games/fame/grandeko', u.token);
  assert.equal(fame.json.me, null);
  assert.match(fame.json.emptyCopy, /haven't played a money game/);
});

test('validation: bad game / venue / stake / invite rejected', async () => {
  const u = await seedUser(999999);
  const bad1 = await post('/api/games/tables', { game: 'nope', venue: 'cue-house', stake: 1000 }, u.token);
  assert.equal(bad1.status, 400);
  const bad2 = await post('/api/games/tables', { game: 'zanga', venue: 'nope', stake: 1000 }, u.token);
  assert.equal(bad2.status, 400);
  const bad3 = await post('/api/games/tables', { game: 'zanga', venue: 'cue-house', stake: 123 }, u.token);
  assert.equal(bad3.status, 400);
  const inv = await post('/api/games/tables',
    { game: 'zanga', venue: 'cue-house', stake: 1000, friendInvite: 'some_player' }, u.token);
  assert.equal(inv.status, 201);
  assert.equal(inv.json.table.friendInvite, 'some_player');
  const self = await post('/api/games/tables',
    { game: 'zanga', venue: 'cue-house', stake: 1000, friendInvite: u.username }, u.token);
  assert.equal(self.status, 400);
});

test('report hides a table from the lobby', async () => {
  const u = await seedUser(20000);
  const c = await post('/api/games/tables',
    { game: 'seedcircle', venue: 'kitchen-yard', stake: 1000 }, u.token);
  const id = c.json.table.id;
  const rep = await post(`/api/games/tables/${id}/report`, {}, u.token);
  assert.equal(rep.status, 200);
  const tables = await get('/api/games/tables', u.token);
  assert.ok(!tables.json.tables.some((t) => t.id === id));
});

test('unauthenticated requests are rejected', async () => {
  const r = await get('/api/games');
  assert.equal(r.status, 401);
});
