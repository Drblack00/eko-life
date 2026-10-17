// P6 — Hustle tests: escrow hold/release/refund lifecycle, pro
// listing + ratings, post-a-job validation, direct booking, reports.
// The hustle router is mounted on a standalone express app (in-memory DB),
// following the contests test pattern.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-do-not-use';
process.env.EKO_DB_PATH = ':memory:';

const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const { createHustleRouter } = await import('../src/routes/hustle.js');
const hz = await import('../src/game/hustle.js');

let base, server;
test.before(async () => {
  await db.initDb();
  const { runMigrations } = await import('../migrations/runner.js');
  await runMigrations();
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/hustle', createHustleRouter());
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
async function del(p, token) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(base + p, { method: 'DELETE', headers });
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
  const username = 'htu' + n;
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

const gigBody = (over = {}) => ({
  category: 'decorator',
  title: 'Freshen up my sitting room',
  details: 'Rearrange + new curtains vibe',
  fee: 5000,
  startOption: 'tomorrow',
  ...over,
});

const proBody = (over = {}) => ({
  categories: ['decorator', 'cook'],
  rateFrom: 2000,
  tagline: 'I turn rooms around fast.',
  services: ['Full room refresh', 'Curtain styling'],
  ...over,
});

test('meta: 8 categories, min fee, safety copy', async () => {
  const u = await seedUser();
  const r = await get('/api/hustle', u.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.categories.length, 8);
  assert.equal(r.json.minFee, 1000);
  assert.match(r.json.copy.safety, /never share your password/i);
  assert.match(r.json.copy.noPay, /nothing is paid until you hire/i);
  assert.match(r.json.copy.decorator, /copy of your home/i);
});

test('post-a-job validation: min fee, category, title', async () => {
  const u = await seedUser(10000);
  const low = await post('/api/hustle/gigs', gigBody({ fee: 500 }), u.token);
  assert.equal(low.status, 400);
  const badCat = await post('/api/hustle/gigs', gigBody({ category: 'nope' }), u.token);
  assert.equal(badCat.status, 400);
  const noTitle = await post('/api/hustle/gigs', gigBody({ title: 'ab' }), u.token);
  assert.equal(noTitle.status, 400);
});

test('post-a-job is free; board lists it; nothing held yet', async () => {
  const u = await seedUser(10000);
  const r = await post('/api/hustle/gigs', gigBody(), u.token);
  assert.equal(r.status, 201);
  assert.equal(r.json.gig.status, 'open');
  assert.equal(r.json.gig.escrowed, false);
  assert.equal(await balance(u), 10000); // nothing paid until someone is hired
  const board = await get('/api/hustle/gigs', u.token);
  assert.ok(board.json.gigs.some((g) => g.id === r.json.gig.id));
});

test('hire holds the fee in escrow; done releases it to the pro + records rating', async () => {
  const client = await seedUser(20000);
  const pro = await seedUser(1000);
  const lp = await post('/api/hustle/pros', proBody(), pro.token);
  assert.equal(lp.status, 201);
  assert.equal(lp.json.pro.jobsDone, 0);

  const g = await post('/api/hustle/gigs', gigBody({ fee: 8000 }), client.token);
  const hire = await post(`/api/hustle/gigs/${g.json.gig.id}/hire`,
    { proUserId: pro.userId }, client.token);
  assert.equal(hire.status, 200);
  assert.equal(hire.json.gig.status, 'hired');
  assert.equal(hire.json.gig.escrowed, true);
  assert.equal(await balance(client), 12000); // fee HELD, not paid out
  assert.equal(await balance(pro), 1000); // pro sees nothing yet

  const done = await post(`/api/hustle/gigs/${g.json.gig.id}/done`, { rating: 5 }, client.token);
  assert.equal(done.status, 200);
  assert.equal(done.json.gig.status, 'done');
  assert.equal(await balance(pro), 9000); // released
  assert.equal(await balance(client), 12000); // unchanged since hire

  const pros = await get('/api/hustle/pros', client.token);
  const card = pros.json.pros.find((p) => p.username === pro.username);
  assert.ok(card);
  assert.equal(card.jobsDone, 1);
  assert.equal(card.stars, 5);
});

test('rating validation + running average across two jobs', async () => {
  const client = await seedUser(30000);
  const pro = await seedUser(0);
  await post('/api/hustle/pros', proBody(), pro.token);
  for (const [fee, rating] of [[5000, 5], [5000, 3]]) {
    const g = await post('/api/hustle/gigs', gigBody({ fee }), client.token);
    await post(`/api/hustle/gigs/${g.json.gig.id}/hire`, { proUserId: pro.userId }, client.token);
    const done = await post(`/api/hustle/gigs/${g.json.gig.id}/done`, { rating }, client.token);
    assert.equal(done.status, 200);
  }
  const bad = await post('/api/hustle/gigs', gigBody({ fee: 5000 }), client.token);
  await post(`/api/hustle/gigs/${bad.json.gig.id}/hire`, { proUserId: pro.userId }, client.token);
  const badRate = await post(`/api/hustle/gigs/${bad.json.gig.id}/done`, { rating: 9 }, client.token);
  assert.equal(badRate.status, 400);
  const pros = await get('/api/hustle/pros', client.token);
  const card = pros.json.pros.find((p) => p.username === pro.username);
  assert.equal(card.stars, 4); // (5+3)/2
  assert.equal(card.jobsDone, 2);
  // job still hired after the rejected rating — close it properly
  const ok = await post(`/api/hustle/gigs/${bad.json.gig.id}/done`, { rating: 4 }, client.token);
  assert.equal(ok.status, 200);
});

test('cancel before hiring is free; cancel after hiring refunds the escrow', async () => {
  const client = await seedUser(15000);
  const pro = await seedUser(0);
  const proBefore = await balance(pro);
  await post('/api/hustle/pros', proBody(), pro.token);

  const open = await post('/api/hustle/gigs', gigBody({ fee: 6000 }), client.token);
  const c1 = await post(`/api/hustle/gigs/${open.json.gig.id}/cancel`, {}, client.token);
  assert.equal(c1.status, 200);
  assert.equal(await balance(client), 15000);

  const g = await post('/api/hustle/gigs', gigBody({ fee: 6000 }), client.token);
  await post(`/api/hustle/gigs/${g.json.gig.id}/hire`, { proUserId: pro.userId }, client.token);
  assert.equal(await balance(client), 9000);
  const c2 = await post(`/api/hustle/gigs/${g.json.gig.id}/cancel`, {}, client.token);
  assert.equal(c2.status, 200);
  assert.equal(await balance(client), 15000); // escrow refunded
  assert.equal(await balance(pro), proBefore); // pro gets nothing for cancelled work
});

test('only the poster can hire/done/cancel; cannot hire yourself', async () => {
  const a = await seedUser(20000);
  const b = await seedUser(20000);
  await post('/api/hustle/pros', proBody(), b.token);
  const g = await post('/api/hustle/gigs', gigBody({ fee: 5000 }), a.token);
  const id = g.json.gig.id;
  const stranger = await post(`/api/hustle/gigs/${id}/hire`, { proUserId: b.userId }, b.token);
  assert.equal(stranger.status, 403);
  const self = await post('/api/hustle/pros', proBody(), a.token);
  assert.equal(self.status, 201);
  const selfHire = await post(`/api/hustle/gigs/${id}/hire`, { proUserId: a.userId }, a.token);
  assert.equal(selfHire.status, 400);
});

test('direct book creates a hired gig with escrow in one step', async () => {
  const client = await seedUser(20000);
  const pro = await seedUser(0);
  await post('/api/hustle/pros', proBody({ rateFrom: 3000 }), pro.token);
  const r = await post('/api/hustle/gigs/book',
    { proUserId: pro.userId, category: 'cook', title: 'Owambe rice for 20', fee: 7000 }, client.token);
  assert.equal(r.status, 201);
  assert.equal(r.json.gig.status, 'hired');
  assert.equal(r.json.gig.proUsername, pro.username);
  assert.equal(await balance(client), 13000);
  const my = await get('/api/hustle/myjobs', pro.token);
  assert.ok(my.json.working.some((w) => w.id === r.json.gig.id));
});

test('hire-me validation + unlist; find-a-pro filters', async () => {
  const u = await seedUser();
  const bad = await post('/api/hustle/pros', proBody({ categories: [] }), u.token);
  assert.equal(bad.status, 400);
  const noTag = await post('/api/hustle/pros', proBody({ tagline: 'x' }), u.token);
  assert.equal(noTag.status, 400);
  await post('/api/hustle/pros', proBody(), u.token);
  const filtered = await get('/api/hustle/pros?category=cook', u.token);
  assert.ok(filtered.json.pros.some((p) => p.username === u.username));
  const other = await get('/api/hustle/pros?category=dj', u.token);
  assert.ok(!other.json.pros.some((p) => p.username === u.username));
  const un = await del('/api/hustle/pros', u.token);
  assert.equal(un.status, 200);
  const gone = await get('/api/hustle/pros', u.token);
  assert.ok(!gone.json.pros.some((p) => p.username === u.username));
});

test('report hides a gig from the board', async () => {
  const u = await seedUser(5000);
  const g = await post('/api/hustle/gigs', gigBody(), u.token);
  await post(`/api/hustle/gigs/${g.json.gig.id}/report`, {}, u.token);
  const board = await get('/api/hustle/gigs', u.token);
  assert.ok(!board.json.gigs.some((x) => x.id === g.json.gig.id));
});

test('applyRating math', () => {
  assert.deepEqual(hz.applyRating(0, 0, 5), { stars: 5, ratingsCount: 1 });
  assert.deepEqual(hz.applyRating(5, 1, 3), { stars: 4, ratingsCount: 2 });
});

test('unauthenticated requests are rejected', async () => {
  const r = await get('/api/hustle');
  assert.equal(r.status, 401);
});
