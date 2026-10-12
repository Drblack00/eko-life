// Phase 7 — Èkó Rich List.
// Ranking by net worth (wallet + savings + ACTIVE bond principal):
// order, your-rank computation, banned exclusion, limit cap, and the
// /api/richlist route (auth, 401/403, shape).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'richlist-test-secret';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const bank = await import('../src/game/v2/bank.js');

let app, base;
test.before(async () => { app = await createApp(); const port = await app.start(0); base = `http://127.0.0.1:${port}`; });
test.after(async () => { await app.close(); });

let n = 0;
async function seedUser({ username, money = 0, savings = 0, bond = 0, banned = false } = {}) {
  n += 1;
  const name = username || 'richseed' + n;
  const id = await db.createUser({ username: name });
  if (banned) await db.setBanned(id, true);
  const c = await db.ensureCharacter(id, 'RichT' + n);
  c.money = money;
  c.savings = savings;
  await db.saveCharacter(c);
  if (bond > 0) {
    // Insert an active bond directly (buyBondFor would charge the wallet).
    await db.dbRun(
      'INSERT INTO bank_bonds (user_id, principal, rate, start_day, term_days, matured) VALUES (?,?,?,?,?,0)',
      'INSERT INTO bank_bonds (user_id, principal, rate, start_day, term_days, matured) VALUES ($1,$2,$3,$4,$5,0)',
      [id, bond, 0.05, 1, 7]);
  }
  const token = signToken(id);
  return { id, token, username: name };
}
async function get(p, token) {
  const r = await fetch(base + p, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.status, json: await r.json() };
}

/* ---------------- ranking order ---------------- */

test('ranks by net worth = money + savings + active bond principal', async () => {
  const a = await seedUser({ money: 100_000 });                       // NW 100k
  const b = await seedUser({ money: 10_000, savings: 200_000 });      // NW 210k
  const c = await seedUser({ money: 5_000, bond: 500_000 });          // NW 505k
  const leaders = await db.listTopByNetWorth(50);
  const order = leaders.map((l) => l.username);
  assert.ok(order.indexOf(c.username) < order.indexOf(b.username));
  assert.ok(order.indexOf(b.username) < order.indexOf(a.username));
  const byName = Object.fromEntries(leaders.map((l) => [l.username, l.netWorth]));
  assert.equal(byName[a.username], 100_000);
  assert.equal(byName[b.username], 210_000);
  assert.equal(byName[c.username], 505_000);
});

test('matured bonds are NOT double-counted', async () => {
  const u = await seedUser({ money: 50_000 });
  await db.dbRun(
    'INSERT INTO bank_bonds (user_id, principal, rate, start_day, term_days, matured, matured_day) VALUES (?,?,?,?,?,1,1)',
    'INSERT INTO bank_bonds (user_id, principal, rate, start_day, term_days, matured, matured_day) VALUES ($1,$2,$3,$4,$5,1,1)',
    [u.id, 999_999, 0.05, 1, 7]);
  const leaders = await db.listTopByNetWorth(50);
  const row = leaders.find((l) => l.username === u.username);
  assert.equal(row.netWorth, 50_000);
});

test('banned users are excluded from the board', async () => {
  const bad = await seedUser({ username: 'richbanned1', money: 9_999_999, banned: true });
  const leaders = await db.listTopByNetWorth(50);
  assert.ok(!leaders.some((l) => l.username === bad.username));
});

test('limit is capped at 50', async () => {
  const leaders = await db.listTopByNetWorth(500);
  assert.ok(leaders.length <= 50);
});

/* ---------------- rank computation ---------------- */

test('your rank = 1 + players strictly richer; total counts the board', async () => {
  const rich = await seedUser({ money: 1_000_000 });
  const mid = await seedUser({ money: 100_000 });
  const poor = await seedUser({ money: 1_000 });
  const rRich = await db.getNetWorthRank(rich.id);
  const rMid = await db.getNetWorthRank(mid.id);
  const rPoor = await db.getNetWorthRank(poor.id);
  // Relative order must hold regardless of other seeded users.
  assert.ok(rRich.rank < rMid.rank, `rich rank ${rRich.rank} < mid rank ${rMid.rank}`);
  assert.ok(rMid.rank < rPoor.rank, `mid rank ${rMid.rank} < poor rank ${rPoor.rank}`);
  assert.ok(rMid.totalPlayers >= 3);
  assert.equal(rRich.totalPlayers, rMid.totalPlayers);
});

/* ---------------- route ---------------- */

test('GET /api/richlist requires auth', async () => {
  const r = await get('/api/richlist');
  assert.equal(r.status, 401);
});

test('GET /api/richlist returns leaders + yourRank + totalPlayers', async () => {
  const u = await seedUser({ money: 42_000, savings: 8_000 });
  const r = await get('/api/richlist?limit=10', u.token);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.leaders));
  assert.ok(r.json.leaders.length <= 10);
  assert.equal(typeof r.json.yourRank, 'number');
  assert.ok(r.json.yourRank >= 1);
  assert.ok(r.json.totalPlayers >= 1);
  const me = r.json.leaders.find((l) => l.username === u.username);
  if (me) {
    assert.equal(me.netWorth, 50_000);
    assert.equal(typeof me.avatar, 'string');
    assert.equal(typeof me.color, 'string');
  }
});

test('GET /api/richlist 403s for banned users', async () => {
  const bad = await seedUser({ username: 'richbanned2', money: 10, banned: true });
  const r = await get('/api/richlist', bad.token);
  assert.equal(r.status, 403);
});
