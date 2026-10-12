// Phase 8 tests: Èkó Gov REST API (election state, run, vote, policy,
// commissioners) + the Governor badge perk on Gist badges.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'test-secret-eko-gov';
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
  const username = 'govu' + n;
  const userId = await db.createUser({ username, is_guest: 1 });
  const c = await db.getCharacter(userId);
  c.money = money;
  await db.saveCharacter(c);
  return { userId, username, token: signToken(userId) };
}

let A, B; // A runs for governor, B votes
test('setup users', async () => {
  A = await seedUser(100000);
  B = await seedUser(100000);
  assert.ok(A.token && B.token);
});

test('GET /api/gov: election state shape', async () => {
  const r = await get('/api/gov', A.token);
  assert.equal(r.status, 200);
  const s = r.json;
  assert.ok(s.election, 'an election should be active (auto-created at boot)');
  assert.equal(s.election.status, 'voting');
  assert.ok(s.election.daysLeft >= 0);
  assert.deepEqual(s.candidates, []);
  assert.equal(s.myVote, null);
  assert.equal(s.isCandidate, false);
  assert.equal(s.governor, null);
  assert.equal(s.runFee, 50000);
  assert.equal(s.canRun, true);
  assert.ok(Array.isArray(s.policies) && s.policies.length === 5);
  assert.ok(Array.isArray(s.commissioners));
  assert.ok(Array.isArray(s.commissionerTitles) && s.commissionerTitles.length > 0);
});

test('GET /api/gov requires auth', async () => {
  const r = await get('/api/gov');
  assert.equal(r.status, 401);
});

test('POST /api/gov/run: fee deducted, candidacy listed', async () => {
  const before = (await db.getCharacter(A.userId)).money;
  const r = await post('/api/gov/run', {}, A.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  const after = (await db.getCharacter(A.userId)).money;
  assert.equal(after, before - 50000);
  const st = r.json.state;
  assert.equal(st.isCandidate, true);
  assert.equal(st.canRun, false);
  assert.ok(st.candidates.some((c) => c.username === A.username));
  // receipt written
  const tx = await db.listTransactions(A.userId, 5);
  assert.ok(tx.some((t) => t.kind === 'gov' && Number(t.amount) === -50000));
});

test('POST /api/gov/run: duplicate candidacy rejected', async () => {
  const r = await post('/api/gov/run', {}, A.token);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /already running/);
});

test('POST /api/gov/run: cannot afford rejected', async () => {
  const poor = await seedUser(1000);
  const r = await post('/api/gov/run', {}, poor.token);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /Campaign fee/);
});

test('POST /api/gov/vote: vote counted', async () => {
  const r = await post('/api/gov/vote', { candidateId: A.userId }, B.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  const st = r.json.state;
  assert.equal(st.myVote, A.userId);
  const cand = st.candidates.find((c) => c.username === A.username);
  assert.equal(cand.votes, 1);
});

test('POST /api/gov/vote: double vote rejected', async () => {
  const r = await post('/api/gov/vote', { candidateId: A.userId }, B.token);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /already voted/);
});

test('POST /api/gov/vote: non-candidate rejected', async () => {
  const C = await seedUser();
  const r = await post('/api/gov/vote', { candidateId: C.userId }, C.token);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /not running/);
});

test('governor badge perk: gistBadge returns Governor', async () => {
  assert.equal(db.gistBadge(Date.now(), 0, true), 'Governor');
  assert.equal(db.gistBadge(Date.now(), 5000000, false), 'Odogwu');
  // live path: set governor, author's badge becomes Governor
  await db.setMeta('governor_id', String(A.userId));
  const author = await db.getGistAuthor(A.userId);
  assert.equal(author.badge, 'Governor');
  const other = await db.getGistAuthor(B.userId);
  assert.notEqual(other.badge, 'Governor');
});

test('GET /api/gov: sitting governor shown', async () => {
  const r = await get('/api/gov', A.token);
  assert.equal(r.status, 200);
  assert.ok(r.json.governor);
  assert.equal(r.json.governor.username, A.username);
});

test('POST /api/gov/policy: non-governor rejected', async () => {
  const r = await post('/api/gov/policy', { policyId: 'tax_free' }, B.token);
  assert.equal(r.status, 403);
});

test('POST /api/gov/policy: governor picks within window', async () => {
  await db.setMeta('gov_policy_won_at', String(Date.now()));
  await db.setMeta('gov_policy_picked', '');
  await db.setMeta('gov_policy', '');
  const r = await post('/api/gov/policy', { policyId: 'tax_free' }, A.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.state.policy.id, 'tax_free');
  assert.equal(await db.getMeta('tax_mult'), '0');
});

test('POST /api/gov/commissioners/appoint + dismiss', async () => {
  const title = 'Commissioner for Hustle';
  let r = await post('/api/gov/commissioners/appoint', { title, username: B.username }, B.token);
  assert.equal(r.status, 403, 'non-governor cannot appoint');
  r = await post('/api/gov/commissioners/appoint', { title, username: B.username }, A.token);
  assert.equal(r.status, 200);
  assert.ok(r.json.state.commissioners.some((c) => c.title === title && c.username === B.username));
  r = await post('/api/gov/commissioners/dismiss', { title }, A.token);
  assert.equal(r.status, 200);
  assert.ok(!r.json.state.commissioners.some((c) => c.title === title));
});

test('winner on close becomes governor in state', async () => {
  const el = await db.currentElection();
  // B already voted for A; close with A as winner, then open next cycle
  await db.closeElection(el.id, A.userId);
  await db.setMeta('governor_id', String(A.userId));
  const next = await db.createElection(8, 15);
  assert.ok(next.id !== el.id);
  const r = await get('/api/gov', B.token);
  assert.equal(r.json.governor.username, A.username);
  assert.equal(r.json.election.id, next.id);
  assert.equal(r.json.lastWinner.username, A.username);
});
