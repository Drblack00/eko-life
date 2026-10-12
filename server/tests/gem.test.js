// Phase 9 tests: Daily Gem Hunt (riddle clue, search, prizes, cooldowns).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'gem-test-secret-only';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const gem = await import('../src/game/v2/gem.js');

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
  const username = 'gemu' + n;
  const userId = await db.createUser({ username, is_guest: 1 });
  const c = await db.getCharacter(userId);
  c.money = money;
  await db.saveCharacter(c);
  return { userId, username, token: signToken(userId) };
}

async function gemLocationId(day) {
  const row = await db.dbGet(
    'SELECT location_id FROM gem_days WHERE day = ?',
    'SELECT location_id FROM gem_days WHERE day = $1',
    [day],
  );
  return row ? row.location_id : null;
}

async function teleport(userId, locationId) {
  const c = await db.getCharacter(userId);
  c.location_id = locationId;
  await db.saveCharacter(c);
}

let A, B, C, day;
test('setup users', async () => {
  A = await seedUser();
  B = await seedUser();
  C = await seedUser();
  gem._resetGemCooldowns();
  assert.ok(A.token && B.token && C.token);
});

test('GET /api/gem: clue shape, no location leak', async () => {
  const r = await get('/api/gem', A.token);
  assert.equal(r.status, 200);
  const s = r.json;
  day = s.day;
  assert.ok(typeof s.clue === 'string' && s.clue.length > 20, 'riddle clue present');
  assert.ok(typeof s.nextGemInMs === 'number' && s.nextGemInMs >= 0);
  assert.equal(s.foundCount, 0);
  assert.deepEqual(s.firstFinders, []);
  assert.equal(s.myFound, false);
  assert.equal(s.nextPrize, 50000);
  assert.deepEqual(s.prizeLadder.map((p) => p.prize), [50000, 25000, 10000, 3000]);
  // The location must NEVER leak through the API.
  assert.ok(!('location_id' in s) && !('locationId' in s), 'no location field');
  const locId = await gemLocationId(day);
  assert.ok(locId, 'gem row created');
  const { LOCATIONS } = await import('../src/game/data.js');
  const loc = LOCATIONS.find((l) => l.id === locId);
  assert.ok(loc, 'gem location is a real location');
  assert.ok(
    !s.clue.toLowerCase().includes(loc.name.toLowerCase()),
    `clue must not name the location (${loc.name})`,
  );
});

test('GET /api/gem requires auth', async () => {
  const r = await get('/api/gem');
  assert.equal(r.status, 401);
});

test('POST /api/gem/search at wrong location fails honestly', async () => {
  const r = await post('/api/gem/search', {}, A.token);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /No gem here/);
});

test('search cooldown blocks rapid repeats', async () => {
  const r = await post('/api/gem/search', {}, A.token);
  assert.equal(r.status, 400);
  assert.ok(r.json.cooldownMs > 0, 'cooldown reported');
  assert.match(r.json.error, /Catch your breath/);
  gem._resetGemCooldowns();
});

test('search at the gem location succeeds with rank-1 prize', async () => {
  const locId = await gemLocationId(day);
  await teleport(A.userId, locId);
  const before = (await db.getCharacter(A.userId)).money;
  const r = await post('/api/gem/search', {}, A.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.found, true);
  assert.equal(r.json.prize, 50000);
  assert.equal(r.json.rank, 1);
  const after = (await db.getCharacter(A.userId)).money;
  assert.equal(after, before + 50000, 'prize credited');
  // Receipt written.
  const txs = await db.listTransactions(A.userId, 5);
  assert.ok(txs.some((t) => t.kind === 'gem' && Number(t.amount) === 50000));
  gem._resetGemCooldowns();
});

test('one find per player per day', async () => {
  const r = await post('/api/gem/search', {}, A.token);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /already found/);
  gem._resetGemCooldowns();
});

test('second finder gets the rank-2 prize', async () => {
  const locId = await gemLocationId(day);
  await teleport(B.userId, locId);
  const r = await post('/api/gem/search', {}, B.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.rank, 2);
  assert.equal(r.json.prize, 25000);
  gem._resetGemCooldowns();
});

test('GET /api/gem reflects finds', async () => {
  const r = await get('/api/gem', A.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.foundCount, 2);
  assert.ok(r.json.firstFinders.includes(A.username));
  assert.ok(r.json.firstFinders.includes(B.username));
  assert.equal(r.json.myFound, true);
  assert.equal(r.json.myPrize, 50000);
  assert.equal(r.json.myRank, 1);
  assert.equal(r.json.nextPrize, 25000, 'third finder would get rank-3 prize');
});

test('prize ladder unit checks', async () => {
  assert.equal(gem.prizeForRank(1), 50000);
  assert.equal(gem.prizeForRank(2), 25000);
  assert.equal(gem.prizeForRank(3), 25000);
  assert.equal(gem.prizeForRank(4), 10000);
  assert.equal(gem.prizeForRank(10), 10000);
  assert.equal(gem.prizeForRank(11), 3000);
  assert.equal(gem.prizeForRank(999), 3000);
});

test('gem pick is stable per day, varies across days, clue never names location', async () => {
  const { LOCATIONS } = await import('../src/game/data.js');
  const seen = new Set();
  for (let d = 1; d <= 30; d++) {
    const loc = gem.pickGemLocation(d);
    assert.ok(LOCATIONS.some((l) => l.id === loc.id), 'pick is a real location');
    assert.deepEqual(gem.pickGemLocation(d), loc, 'stable within a day');
    seen.add(loc.id);
    const clue = gem.pickRiddle(d, loc);
    assert.ok(typeof clue === 'string' && clue.length > 20);
    assert.ok(
      !clue.toLowerCase().includes(loc.name.toLowerCase()),
      `day ${d}: clue must not name ${loc.name}`,
    );
  }
  assert.ok(seen.size >= 5, `expected variety, got ${seen.size} distinct spots`);
});

test('a new day gets a fresh gem row', async () => {
  const row = await gem.ensureGemDay(day + 1);
  assert.ok(row && row.day === day + 1);
  assert.ok(row.location_id && row.clue);
});
