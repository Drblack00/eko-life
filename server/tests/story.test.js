// Story Questlines tests: list badges, scene detail, advance validation,
// reward application, chapter unlock, and the branch ending.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET='story-test-secret'
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
  const username = 'storyu' + n;
  const userId = await db.createUser({ username, is_guest: 1 });
  const c = await db.getCharacter(userId);
  c.money = money;
  await db.saveCharacter(c);
  return { userId, username, token: signToken(userId) };
}

function musicXp(c) {
  const skills = typeof c.skills === 'string' ? JSON.parse(c.skills || '{}') : (c.skills || {});
  return Number((skills.music && skills.music.xp) || 0);
}

let A;
test('setup user', async () => {
  A = await seedUser(100000);
  assert.ok(A.token);
});

test('GET /api/stories requires auth', async () => {
  const r = await get('/api/stories');
  assert.equal(r.status, 401);
});

test('GET /api/stories lists the seeded arc with unread badge', async () => {
  const r = await get('/api/stories', A.token);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.stories));
  // PORT-P1: 6 arcs seeded (was 1)
  assert.equal(r.json.stories.length, 6);
  const s = r.json.stories.find((x) => x.id === 1);
  assert.equal(s.title, 'Danfo to Headline');
  assert.equal(s.coverEmoji, '🚌');
  assert.equal(s.chaptersCount, 9);
  assert.equal(s.progress, null);
  assert.equal(s.completed, false);
  assert.equal(s.unread, 9);
  assert.ok(s.synopsis.length > 0);
  assert.equal(s.locked, false);
  // PORT-P1: final arc is net-worth locked
  const sixth = r.json.stories.find((x) => x.id === 6);
  assert.equal(sixth.locked, true);
  assert.ok(sixth.netWorthReq > 0);
});

test('GET /api/stories/1 returns chapters + scenes up to progress', async () => {
  const r = await get('/api/stories/1', A.token);
  assert.equal(r.status, 200);
  const d = r.json;
  assert.equal(d.story.title, 'Danfo to Headline');
  assert.equal(d.completed, false);
  assert.equal(d.chapters.length, 9);
  const ch1 = d.chapters[0];
  assert.equal(ch1.title, 'Oshodi Under-Bridge');
  assert.equal(ch1.locked, false);
  assert.equal(ch1.scenes.length, 6);
  // Decision scene carries its choices with hints + rewards.
  const dec = ch1.scenes.find((x) => x.sceneNo === 5);
  assert.ok(dec);
  assert.equal(dec.choices.length, 2);
  assert.ok(dec.choicePrompt);
  assert.ok(dec.choices[0].consequenceHint);
  assert.equal(typeof dec.choices[0].rewardCoins, 'number');
  assert.equal(typeof dec.choices[0].rewardXp, 'number');
  // Later chapters are locked before progress reaches them.
  assert.equal(d.chapters[1].locked, true);
  assert.deepEqual(d.chapters[1].scenes, []);
  // Unknown story → 404.
  const r404 = await get('/api/stories/999', A.token);
  assert.equal(r404.status, 404);
});

test('POST advance rejects out-of-sync position', async () => {
  const r = await post('/api/stories/1/advance', { chapter_no: 2, scene_no: 1 }, A.token);
  assert.equal(r.status, 400);
});

test('POST advance rejects a choice that belongs to another scene', async () => {
  // Scene (1,1) has no choices — sending one is invalid.
  const r1 = await post('/api/stories/1/advance', { chapter_no: 1, scene_no: 1, choice_id: 1 }, A.token);
  assert.equal(r1.status, 400);
  // Choice 1 belongs to scene (1,5), not (1,1).
  const r2 = await post('/api/stories/1/advance', { chapter_no: 1, scene_no: 1, choice_id: 999999 }, A.token);
  assert.equal(r2.status, 400);
});

test('advance through chapter 1; valid choice applies coin + xp rewards', async () => {
  const before = await db.getCharacter(A.userId);
  const moneyBefore = Number(before.money);
  const xpBefore = musicXp(before);

  // Scenes 1..4 have no choices.
  for (const sn of [1, 2, 3, 4]) {
    const r = await post('/api/stories/1/advance', { chapter_no: 1, scene_no: sn }, A.token);
    assert.equal(r.status, 200, `scene ${sn}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.progress.sceneNo, sn + 1);
    // PORT-P1: reward object now carries rep/gem fields too
    assert.deepEqual(
      (({ coins, xp, leveledUp, skill, skillLevel }) => ({ coins, xp, leveledUp, skill, skillLevel }))(r.json.reward),
      { coins: 0, xp: 0, leveledUp: false, skill: 'music', skillLevel: 0 });
    assert.equal(typeof r.json.reward.rep, 'number');
    assert.equal(typeof r.json.reward.gems, 'number');
  }
  // Decision scene 5: choice 1 is worth 0 coins + 25 xp.
  const d = await get('/api/stories/1', A.token);
  const dec = d.json.chapters[0].scenes.find((x) => x.sceneNo === 5);
  const firstChoice = dec.choices[0].id;
  const r = await post('/api/stories/1/advance', { chapter_no: 1, scene_no: 5, choice_id: firstChoice }, A.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.reward.coins, 0);
  assert.equal(r.json.reward.xp, 25);

  const after = await db.getCharacter(A.userId);
  assert.equal(Number(after.money), moneyBefore + 0);
  assert.equal(musicXp(after), xpBefore + 25);

  // A coin-bearing choice credits the character and logs a transaction.
  const B = await seedUser(50000);
  for (const sn of [1, 2, 3, 4]) {
    await post('/api/stories/1/advance', { chapter_no: 1, scene_no: sn }, B.token);
  }
  const bDec = (await get('/api/stories/1', B.token)).json.chapters[0].scenes.find((x) => x.sceneNo === 5);
  const coinChoice = bDec.choices.find((c) => c.rewardCoins > 0);
  assert.ok(coinChoice, 'a coin-bearing choice exists');
  const rc = await post('/api/stories/1/advance', { chapter_no: 1, scene_no: 5, choice_id: coinChoice.id }, B.token);
  assert.equal(rc.status, 200);
  const bAfter = await db.getCharacter(B.userId);
  assert.equal(Number(bAfter.money), 50000 + coinChoice.rewardCoins);
  const txns = await db.listTransactions(B.userId, 5);
  assert.ok(txns.some((t) => t.kind === 'story_reward'), 'story_reward transaction logged');
});

test('completing chapter 1 unlocks chapter 2', async () => {
  // A is at (1,6) after the previous test.
  const r = await post('/api/stories/1/advance', { chapter_no: 1, scene_no: 6 }, A.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.progress.chapterNo, 2);
  assert.equal(r.json.progress.sceneNo, 1);
  const d = await get('/api/stories/1', A.token);
  assert.equal(d.json.chapters[1].locked, false);
  assert.ok(d.json.chapters[1].scenes.length > 0);
  const list = await get('/api/stories', A.token);
  assert.equal(list.json.stories[0].unread, 8);
});

test('branch ending: the label-deal choice jumps to the label epilogue', async () => {
  const C = await seedUser(100000);
  // Walk the whole arc, always picking the first choice at decision points.
  let guard = 0;
  for (;;) {
    guard += 1;
    assert.ok(guard < 200, 'advance loop did not terminate');
    const d = await get('/api/stories/1', C.token);
    if (d.json.completed) break;
    const { chapterNo, sceneNo } = d.json.progress || { chapterNo: 1, sceneNo: 1 };
    const ch = d.json.chapters.find((x) => x.chapterNo === chapterNo);
    assert.ok(ch && !ch.locked, `chapter ${chapterNo} unlocked`);
    const sc = ch.scenes.find((x) => x.sceneNo === sceneNo);
    assert.ok(sc, `scene (${chapterNo},${sceneNo}) exists`);
    const body = { chapter_no: chapterNo, scene_no: sceneNo };
    if (sc.choices.length > 0) body.choice_id = sc.choices[0].id;
    const r = await post('/api/stories/1/advance', body, C.token);
    assert.equal(r.status, 200, `advance (${chapterNo},${sceneNo}): ${JSON.stringify(r.json)}`);
    if (r.json.completed) break;
  }
  const done = await get('/api/stories/1', C.token);
  assert.equal(done.json.completed, true);
  const list = await get('/api/stories', C.token);
  const s = list.json.stories[0];
  assert.equal(s.completed, true);
  assert.equal(s.unread, 0);
  // First choice at the finale is the label deal → epilogue chapter 8 reached.
  const ch8 = done.json.chapters.find((x) => x.chapterNo === 8);
  assert.equal(ch8.locked, false);
  assert.ok(ch8.scenes.length > 0);
  // Street-king epilogue stays locked on this path.
  const ch9 = done.json.chapters.find((x) => x.chapterNo === 9);
  assert.equal(ch9.locked, false); // completed stories unlock everything for reread
  // Advancing a finished story is rejected.
  const r = await post('/api/stories/1/advance', { chapter_no: 8, scene_no: 3 }, C.token);
  assert.equal(r.status, 400);
});
