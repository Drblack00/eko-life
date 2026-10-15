// UGC Design Contests tests: leaderboard ranking, duel pairs, vote budget,
// no self-votes, streak across days, 2-tap entry submit.
// The contests router is mounted on a standalone express app here because
// server/src/app.js wiring (the 2 mount lines) lands in a follow-up commit.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'eko-life-test-secret';
process.env.EKO_DB_PATH = ':memory:';

const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const { createContestsRouter } = await import('../src/routes/contests.js');

let base, server;
test.before(async () => {
  await db.initDb();
  const { runMigrations } = await import('../migrations/runner.js');
  await runMigrations();
  const app = express();
  // 2mb here (not the 1mb prod cap): the oversized-photo test must reach
  // route validation to assert the 400, not die at the body parser.
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/contests', createContestsRouter());
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
async function seedUser() {
  n += 1;
  const username = 'ctu' + n;
  const userId = await db.createUser({ username, is_guest: 1 });
  return { userId, username, token: signToken(userId) };
}

const design = (emoji) => ({ emoji, colors: ['#3b0764', '#a855f7'], blurb: 'test blurb' });
let contestId;
let voter, entrants;

test('seed: migration created the active contest', async () => {
  voter = await seedUser();
  const r = await get('/api/contests', voter.token);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json) && r.json.length >= 1);
  const c = r.json.find((x) => x.title === 'Owambe Fit Check');
  assert.ok(c, 'seeded contest present');
  assert.equal(c.category, 'outfit');
  assert.equal(c.status, 'active');
  assert.equal(c.voteBudgetPerDay, 5);
  assert.ok(c.prizeText.includes('₦500K'));
  assert.ok(Date.parse(c.endsAt) > Date.now(), 'ends in the future');
  contestId = c.id;
});

test('2-tap submit creates an entry with its design', async () => {
  entrants = [];
  for (let i = 0; i < 6; i += 1) entrants.push(await seedUser());
  const r = await post(`/api/contests/${contestId}/entries`,
    { title: 'Royal Purple Aso-ebi', design: design('👗') }, entrants[0].token);
  assert.equal(r.status, 200);
  assert.ok(r.json.ok);
  assert.equal(r.json.entry.title, 'Royal Purple Aso-ebi');
  assert.equal(r.json.entry.design.emoji, '👗');
  assert.deepEqual(r.json.entry.design.colors, ['#3b0764', '#a855f7']);
  assert.equal(r.json.entry.design.blurb, 'test blurb');
  assert.equal(r.json.entry.isMine, true);
  // title is required
  const bad = await post(`/api/contests/${contestId}/entries`,
    { title: '   ', design: design('👔') }, entrants[1].token);
  assert.equal(bad.status, 400);
});

test('leaderboard ranks entries by votes with vote bars', async () => {
  // 5 more entries (one per remaining entrant)
  const ids = [];
  for (let i = 1; i < 6; i += 1) {
    const r = await post(`/api/contests/${contestId}/entries`,
      { title: 'Entry ' + i, design: design('👔') }, entrants[i].token);
    assert.equal(r.status, 200);
    ids.push(r.json.entry.id);
  }
  const first = await post(`/api/contests/${contestId}/entries`,
    { title: 'Second of E1', design: design('💃') }, entrants[0].token);
  const e1 = first.json.entry.id;
  // voter casts 3 votes for e1 (via 3 voters), 1 for ids[0]
  const v2 = await seedUser(); const v3 = await seedUser();
  for (const v of [voter, v2, v3]) {
    const r = await post(`/api/contests/${contestId}/vote`, { entry_id: e1 }, v.token);
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
  const r1 = await post(`/api/contests/${contestId}/vote`, { entry_id: ids[0] }, voter.token);
  assert.equal(r1.status, 200);
  const d = await get(`/api/contests/${contestId}`, voter.token);
  assert.equal(d.status, 200);
  const rows = d.json.entries;
  assert.ok(rows.length >= 7);
  assert.equal(rows[0].id, e1, 'most-voted entry ranks first');
  assert.equal(rows[0].votes, 3);
  assert.equal(rows[0].share, 1, 'leader gets a full vote bar');
  assert.ok(rows[1].share < 1 && rows[1].share > 0, 'runner-up has a partial bar');
  assert.ok(rows.every((e, i, a) => i === 0 || a[i - 1].votes >= e.votes), 'sorted desc');
  assert.ok(d.json.streak >= 1, 'streak counts today');
  assert.equal(d.json.votesLeft, 5 - 2, 'voter used 2 of 5 daily votes');
});

test("can't vote your own entry", async () => {
  const own = await post(`/api/contests/${contestId}/entries`,
    { title: 'My Own Fit', design: design('🧥') }, voter.token);
  assert.equal(own.status, 200);
  const r = await post(`/api/contests/${contestId}/vote`, { entry_id: own.json.entry.id }, voter.token);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /own design/);
});

test('one vote per entry per user', async () => {
  const d = await get(`/api/contests/${contestId}`, voter.token);
  const target = d.json.entries.find((e) => !e.isMine && e.votes === 0);
  assert.ok(target, 'an unvoted entry exists');
  const r1 = await post(`/api/contests/${contestId}/vote`, { entry_id: target.id }, voter.token);
  assert.equal(r1.status, 200);
  const r2 = await post(`/api/contests/${contestId}/vote`, { entry_id: target.id }, voter.token);
  assert.equal(r2.status, 400);
  assert.match(r2.json.error, /already voted/);
});

test('duel returns a random unvoted pair, then none when exhausted', async () => {
  const dueler = await seedUser();
  const r = await get(`/api/contests/${contestId}/duel`, dueler.token);
  assert.equal(r.status, 200);
  assert.ok(r.json.pair && r.json.pair.length === 2, 'a pair is dealt');
  const [a, b] = r.json.pair;
  assert.notEqual(a.id, b.id);
  assert.ok(a.design && a.design.emoji, 'design travels with the pair');
  // vote one of the pair -> next duel must not include it
  const v = await post(`/api/contests/${contestId}/vote`, { entry_id: a.id }, dueler.token);
  assert.equal(v.status, 200);
  const r2 = await get(`/api/contests/${contestId}/duel`, dueler.token);
  assert.ok(r2.json.pair, 'still entries left');
  assert.ok(!r2.json.pair.some((e) => e.id === a.id), 'voted entry excluded');
  // exhaust: vote every remaining unvoted entry (fresh voter for budget)
  const fresh = await seedUser();
  const detail = await get(`/api/contests/${contestId}`, fresh.token);
  for (const e of detail.json.entries) {
    if (!e.isMine) {
      const vr = await post(`/api/contests/${contestId}/vote`, { entry_id: e.id }, fresh.token);
      if (vr.status !== 200) break; // budget exhausted -> stop
    }
  }
  const done = await get(`/api/contests/${contestId}/duel`, fresh.token);
  assert.equal(done.json.pair, null, 'no pair once everything is voted or budget is gone');
  assert.ok(done.json.reason, 'empty state explains why');
});

test('daily vote budget is enforced', async () => {
  const spender = await seedUser();
  const d = await get(`/api/contests/${contestId}`, spender.token);
  const targets = d.json.entries.filter((e) => !e.isMine).slice(0, 6);
  assert.ok(targets.length >= 6, 'enough entries to spend the budget');
  for (let i = 0; i < 5; i += 1) {
    const r = await post(`/api/contests/${contestId}/vote`, { entry_id: targets[i].id }, spender.token);
    assert.equal(r.status, 200, `vote ${i + 1} ok`);
    assert.equal(r.json.votesLeft, 4 - i);
  }
  const over = await post(`/api/contests/${contestId}/vote`, { entry_id: targets[5].id }, spender.token);
  assert.equal(over.status, 400);
  assert.match(over.json.error, /out of votes/);
});

test('streak increments across days', async () => {
  const s = await seedUser();
  const d = await get(`/api/contests/${contestId}`, s.token);
  const targets = d.json.entries.filter((e) => !e.isMine).slice(0, 2);
  const r1 = await post(`/api/contests/${contestId}/vote`, { entry_id: targets[0].id }, s.token);
  assert.equal(r1.status, 200);
  assert.equal(r1.json.streak, 1);
  // backdate that vote to yesterday in the test DB
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  await db.dbRun(
    `UPDATE contest_votes SET voted_at = ? WHERE voter_id = ?`,
    `UPDATE contest_votes SET voted_at = $1 WHERE voter_id = $2`,
    [yesterday, s.userId],
  );
  const r2 = await post(`/api/contests/${contestId}/vote`, { entry_id: targets[1].id }, s.token);
  assert.equal(r2.status, 200);
  assert.equal(r2.json.streak, 2, 'consecutive days -> streak 2');
  // a gap breaks the streak: move both votes 3 days back, vote again today
  const old = new Date(Date.now() - 3 * 86400000).toISOString();
  await db.dbRun(
    `UPDATE contest_votes SET voted_at = ? WHERE voter_id = ?`,
    `UPDATE contest_votes SET voted_at = $1 WHERE voter_id = $2`,
    [old, s.userId],
  );
  const d2 = await get(`/api/contests/${contestId}`, s.token);
  assert.equal(d2.json.streak, 0, 'gap -> streak resets');
});

test('auth is required', async () => {
  const r = await get('/api/contests');
  assert.equal(r.status, 401);
  const r2 = await post(`/api/contests/${contestId}/vote`, { entry_id: 1 });
  assert.equal(r2.status, 401);
});

const tinyPhoto = 'data:image/jpeg;base64,' + 'A'.repeat(1000);

test('entry photo: valid photo is accepted and round-trips', async () => {
  const u = await seedUser();
  const r = await post(`/api/contests/${contestId}/entries`,
    { title: 'My Real Aso-ebi', design: design('👗'), photo: tinyPhoto }, u.token);
  assert.equal(r.status, 200);
  assert.ok(r.json.ok);
  assert.equal(r.json.entry.photo, tinyPhoto);
  // photo appears on the leaderboard row…
  const d = await get(`/api/contests/${contestId}`, u.token);
  const row = d.json.entries.find((e) => e.id === r.json.entry.id);
  assert.ok(row, 'entry on leaderboard');
  assert.equal(row.photo, tinyPhoto);
  // …and in duel pairs (vote out others' entries is not needed: just check shape)
  const dueler = await seedUser();
  const duel = await get(`/api/contests/${contestId}/duel`, dueler.token);
  if (duel.json.pair) {
    for (const p of duel.json.pair) {
      assert.ok('photo' in p, 'duel pair entries carry photo');
    }
  }
});

test('entry photo: invalid prefix is rejected', async () => {
  const u = await seedUser();
  const r = await post(`/api/contests/${contestId}/entries`,
    { title: 'Sneaky', design: design('👔'), photo: 'data:text/plain;base64,AAAA' }, u.token);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /data URL/);
  const r2 = await post(`/api/contests/${contestId}/entries`,
    { title: 'Sneaky 2', design: design('👔'), photo: 'not-a-data-url' }, u.token);
  assert.equal(r2.status, 400);
});

test('entry photo: oversized photo is rejected', async () => {
  const u = await seedUser();
  const big = 'data:image/jpeg;base64,' + 'A'.repeat(512 * 1024);
  const r = await post(`/api/contests/${contestId}/entries`,
    { title: 'Too Big', design: design('👔'), photo: big }, u.token);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /too large/);
});

test('entry photo: omitted photo still works (photo null)', async () => {
  const u = await seedUser();
  const r = await post(`/api/contests/${contestId}/entries`,
    { title: 'Emoji Only', design: design('💃') }, u.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.entry.photo, null);
  const d = await get(`/api/contests/${contestId}`, u.token);
  const row = d.json.entries.find((e) => e.id === r.json.entry.id);
  assert.ok(row);
  assert.equal(row.photo, null);
});
