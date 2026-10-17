// P1 core-loop tests: vitality (traits/rep/streak/dream/sleep),
// cooking, quests (wishes/goals), perks surface, m9 hustle
// extensions, m12 10th skill + certificate hook, story rewards.
// Pure game-money only — nothing here touches the cash wallet.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET='test';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const vitality = await import('../src/game/vitality.js');
const cooking = await import('../src/game/cooking.js');
const quests = await import('../src/game/quests.js');
const perks = await import('../src/game/perks.js');
const m8 = await import('../src/game/v2/m8.js');
const m9 = await import('../src/game/v2/m9.js');
const m12 = await import('../src/game/v2/m12.js');

let base, app;
test.before(async () => {
  app = await createApp();
  const port = await app.start(0);
  base = `http://127.0.0.1:${port}`;
  await vitality.ensureSchema();
  await m9.ensureSchema();
  await m12.ensureSchema();
});
test.after(async () => { await app.close(); });

let n = 0;
async function seedUser(money = 100000) {
  n += 1;
  const username = 'p1u' + n;
  const userId = await db.createUser({ username, is_guest: 1 });
  const c = await db.getCharacter(userId);
  c.money = money;
  await db.saveCharacter(c);
  return { userId, username, token: signToken(userId), character: await db.getCharacter(userId) };
}
async function get(p, token) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(base + p, { headers });
  return { status: r.status, json: await r.json() };
}
async function post(p, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}

// ---------------- vitality ----------------
test('traits: 2 qualitative traits assigned once, text only', async () => {
  const { userId } = await seedUser();
  const st = await vitality.getVitality(userId);
  assert.equal(st.traits.length, 2);
  for (const id of st.traits) {
    const t = vitality.traitById(id);
    assert.ok(t && t.name && t.blurb, `trait ${id} resolves`);
  }
  const st2 = await vitality.getVitality(userId);
  assert.deepEqual(st2.traits, st.traits, 'traits are stable across reads');
});

test('repLevel: thresholds + titles', () => {
  assert.deepEqual([vitality.repLevel(0).level, vitality.repLevel(0).title], [1, 'JJC']);
  assert.equal(vitality.repLevel(99).level, 1);
  assert.equal(vitality.repLevel(100).level, 2);
  assert.equal(vitality.repLevel(300).title, 'Correct Person');
  const max = vitality.repLevel(99999);
  assert.equal(max.level, 7);
  assert.ok(max.maxed);
});

test('addRepXp: accumulates and detects level-up (pure)', () => {
  const st = { rep: 90 };
  const r = vitality.addRepXp(st, 20);
  assert.equal(st.rep, 110);
  assert.ok(r.leveledUp);
  assert.equal(r.after.level, 2);
  const r2 = vitality.addRepXp(st, 5);
  assert.ok(!r2.leveledUp);
});

test('streak: day-1 claim, double-claim rejected, next day increments', async () => {
  const { userId } = await seedUser();
  const r1 = await vitality.claimStreak(userId);
  assert.equal(r1.error, null);
  assert.equal(r1.count, 1);
  assert.equal(r1.money, 5000);
  assert.equal(r1.rep, 10);
  const r2 = await vitality.claimStreak(userId);
  assert.match(r2.error, /Already checked in/);
  // simulate yesterday's claim, then claim "tomorrow"
  const st = await vitality.getVitality(userId);
  const y = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
  st.streak.lastClaim = y;
  st.streak.count = 4;
  await vitality.saveVitality(userId, st);
  const r3 = await vitality.claimStreak(userId);
  assert.equal(r3.count, 5);
  assert.equal(r3.money, 5000 + 500 * 4);
  // streak escalates but caps at +₦10,000
  assert.ok(vitality.streakRewards(999).money <= 10000);
});

test('dream: set once, weekly change limit', () => {
  const st = { dream: null };
  const r1 = vitality.setDreamState(st, 'oga_top', 1000);
  assert.ok(r1.ok);
  assert.equal(st.dream.id, 'oga_top');
  const r2 = vitality.setDreamState(st, 'landlord', 2000);
  assert.match(r2.error, /once a week/);
  assert.ok(r2.nextChangeInMs > 0);
  const r3 = vitality.setDreamState(st, 'landlord', 1000 + 8 * 24 * 3600 * 1000);
  assert.ok(r3.ok, 'change allowed after a week');
  assert.equal(vitality.setDreamState({ dream: null }, 'nope', 0).error, 'Unknown dream.');
});

test('sleep: start → finish early (half) → full restore when done', () => {
  const st = { timers: { sleep: null, cook: null } };
  assert.equal(vitality.startSleepState(st, 'nope').error, 'Unknown rest mode.');
  const s = vitality.startSleepState(st, 'nap', 1000);
  assert.ok(s.ok);
  assert.equal(st.timers.sleep.endsAt, 1000 + 15 * 1000);
  assert.equal(vitality.startSleepState(st, 'deep', 1000).error.includes('already resting'), true);
  const early = vitality.finishSleepState(st, 2000);
  assert.ok(early.ok && !early.done);
  assert.equal(early.energy, 15, 'cancel pays half');
  assert.equal(st.timers.sleep, null);
  vitality.startSleepState(st, 'deep', 5000);
  const full = vitality.finishSleepState(st, 5000 + 36 * 1000);
  assert.ok(full.ok && full.done);
  assert.equal(full.energy, 60);
  assert.equal(full.fun, 0);
  assert.equal(vitality.finishSleepState(st).error, 'No rest in progress.');
});

test('netWorth: money + savings − loan', () => {
  assert.equal(vitality.netWorth({ money: 1000, savings: 500, loan: 200 }), 1300);
  assert.equal(vitality.netWorth({ money: 100, loan: 5000 }), 0);
});

test('feelingsCatalog: every trigger has cause copy, modifier, duration', () => {
  const cat = vitality.feelingsCatalog();
  assert.ok(cat.length >= 13, `catalog has ${cat.length} feelings`);
  for (const f of cat) {
    assert.ok(f.key && f.label && f.cause && f.durationMs > 0, f.key);
    assert.ok(typeof f.modifier === 'string' && f.modifier.length > 0, `${f.key} modifier`);
  }
  const keys = cat.map(f => f.key);
  assert.ok(keys.includes('belleful_joy'), 'cooking moodlet registered');
});

test('grantGems: adds to perk_stars', async () => {
  const { userId } = await seedUser();
  const bal = await vitality.grantGems(userId, 3);
  assert.equal(bal, 3);
  assert.equal(await vitality.gemBalance(userId), 3);
  const bal2 = await vitality.grantGems(userId, 2);
  assert.equal(bal2, 5);
});

// ---------------- cooking ----------------
test('RECIPES: 8 original dishes, 6–12s, hunger tiers', () => {
  assert.equal(cooking.RECIPES.length, 8);
  const ids = new Set(cooking.RECIPES.map(r => r.id));
  assert.equal(ids.size, 8, 'ids unique');
  for (const r of cooking.RECIPES) {
    assert.ok(r.secs >= 6 && r.secs <= 12, `${r.id} secs ${r.secs}`);
    assert.ok(Object.keys(r.needs).length > 0, `${r.id} needs ingredients`);
  }
  const quick = cooking.recipeById('street_noodles');
  assert.equal(quick.secs, 6);
  assert.equal(quick.hunger, 35);
  const standard = cooking.recipeById('fisherman_soup');
  assert.equal(standard.hunger, 55);
  const feast = cooking.recipeById('owambe_platter');
  assert.equal(feast.hunger, 80);
  assert.ok(feast.favorite);
});

test('cook lifecycle: locked → start → early finish rejected → done auto-eat values', () => {
  const st = { timers: { sleep: null, cook: null }, kitchen: { items: {} }, cooksDone: 0 };
  const locked = cooking.startCookState(st, 'street_noodles', 1000);
  assert.equal(locked.error, 'Missing ingredients.');
  assert.deepEqual(Object.keys(locked.missing), ['noodles', 'egg']);
  st.kitchen.items = { noodles: 2, egg: 1 };
  const started = cooking.startCookState(st, 'street_noodles', 1000);
  assert.ok(started.ok);
  assert.deepEqual(st.kitchen.items, { noodles: 1 }, 'ingredients consumed');
  assert.equal(cooking.startCookState(st, 'street_noodles', 1000).error.includes('already on the fire'), true);
  const early = cooking.finishCookState(st, 2000);
  assert.equal(early.error, 'Still cooking — patience.');
  assert.ok(early.remainingMs > 0);
  const done = cooking.finishCookState(st, 1000 + 6000);
  assert.ok(done.ok);
  assert.equal(done.hunger, 35);
  assert.equal(done.fun, 4);
  assert.equal(done.xp, 15);
  assert.equal(st.cooksDone, 1);
  assert.equal(st.timers.cook, null);
  assert.equal(cooking.cancelCookState(st).error, 'Nothing is cooking.');
});

test('missingIngredients + missingCost', () => {
  const r = cooking.recipeById('party_jollof');
  const missing = cooking.missingIngredients({ rice: 1 }, r);
  assert.deepEqual(missing, { rice: 1, tomato: 2, pepper: 1 });
  assert.equal(cooking.missingCost(missing), 700 + 1000 + 300);
  assert.deepEqual(cooking.missingIngredients({ rice: 5, tomato: 5, pepper: 5 }, r), {});
});

test('hasKitchen / hasBed detect placed furniture', () => {
  assert.ok(cooking.hasKitchen([{ item: 'stove', placed: 1 }]));
  assert.ok(cooking.hasKitchen([{ item: 'fridge' }]));
  assert.ok(!cooking.hasKitchen([{ item: 'bed', placed: 1 }]));
  assert.ok(!cooking.hasKitchen([]));
  assert.ok(cooking.hasBed([{ item: 'bed' }]));
  assert.ok(!cooking.hasBed([{ item: 'stove' }]));
});

// ---------------- quests ----------------
test('WISHES: 8 defs, gems +2..+4', () => {
  assert.equal(quests.WISHES.length, 8);
  for (const w of quests.WISHES) {
    assert.ok(w.gems >= 2 && w.gems <= 4, `${w.id} gems ${w.gems}`);
    assert.ok(typeof w.check === 'function');
  }
});

test('wishProgress refills to 3 active wishes', async () => {
  const { userId, character } = await seedUser();
  const wishes = await quests.wishProgress(userId, character);
  assert.equal(wishes.length, 3);
  const ids = new Set(wishes.map(w => w.id));
  assert.equal(ids.size, 3);
});

test('claimWish: incomplete rejected; complete grants gems', async () => {
  const { userId } = await seedUser();
  let c = await db.getCharacter(userId);
  const wishes = await quests.wishProgress(userId, c);
  const target = wishes.find(w => w.id === 'wish_shift') || wishes[0];
  const bad = await quests.claimWish(userId, c, target.id);
  if (target.id === 'wish_shift') {
    assert.match(bad.error, /not fulfilled/);
    await db.addTransaction(userId, 'shift_pay', 8600, 100000, {});
    c = await db.getCharacter(userId);
    const good = await quests.claimWish(userId, c, 'wish_shift');
    assert.ok(good.ok, JSON.stringify(good));
    assert.equal(good.gems, 3);
    assert.ok(good.balance >= 3);
  } else {
    assert.ok(bad.error, 'unrelated wish stays unclaimable without progress');
  }
});

test('swapWish: 1 free swap per day', async () => {
  const { userId, character } = await seedUser();
  const wishes = await quests.wishProgress(userId, character);
  const first = wishes[0].id;
  const r1 = await quests.swapWish(userId, first);
  assert.ok(r1.ok, JSON.stringify(r1));
  assert.notEqual(r1.wish.id, first);
  const r2 = await quests.swapWish(userId, r1.wish.id);
  assert.match(r2.error, /one per day/);
});

test('claimGoal: incomplete rejected; complete pays money+rep and rotates', async () => {
  const { userId } = await seedUser(50000);
  let c = await db.getCharacter(userId);
  // force the first-buy goal
  const st = await vitality.getVitality(userId);
  st.goal = { id: 'goal_first_buy', assignedAt: Date.now() };
  await vitality.saveVitality(userId, st);
  const bad = await quests.claimGoal(userId, c);
  assert.match(bad.error, /not complete/);
  await db.addTransaction(userId, 'buy_furniture', -20000, 30000, {});
  c = await db.getCharacter(userId);
  const good = await quests.claimGoal(userId, c);
  assert.ok(good.ok, JSON.stringify(good));
  assert.equal(good.money, 1000);
  assert.equal(good.rep, 10);
  assert.notEqual(good.next.id, 'goal_first_buy', 'rotates to next goal');
});

// ---------------- perks surface ----------------
test('getPerkEffects: normalized shape, extended types zeroed', () => {
  const e = perks.getPerkEffects({ perks: '[]' });
  assert.deepEqual(e.owned, []);
  assert.equal(e.decaySlow.hunger, 1);
  assert.equal(e.workPayMult, 1);
  assert.equal(e.buyDiscountMult, 1);
  assert.equal(e.skillXpMult, 1);
  assert.equal(e.socialSuccessPct, 0);
  assert.equal(e.romanceSuccessPct, 0);
  assert.equal(e.jailShortenPct, 0);
  assert.equal(e.moodExtendPct, 0);
  assert.equal(e.sleepBoostPct, 0);
});

test('getPerkEffects: owned perks apply', () => {
  const e = perks.getPerkEffects({ perks: JSON.stringify(['slow_burn', 'overtime']) });
  assert.deepEqual(e.owned.sort(), ['overtime', 'slow_burn']);
  assert.equal(e.decaySlow.hunger, 0.75);
  assert.equal(e.decaySlow.energy, 1);
  assert.equal(e.workPayMult, 1.2);
});

// ---------------- m9 hustle extensions ----------------
function fakeApi(seed) {
  const sent = [];
  const errors = [];
  const api = {
    conn: { user: seed.user, character: seed.character, cds: {}, pos: {}, furniture: [] },
    send: (conn, msg) => sent.push(msg),
    broadcast: () => {},
    youSnapshot: (conn) => ({ money: Number(conn.character.money) }),
    err: (t) => errors.push(t),
    commit: async ({ kind = null, amount = 0, meta = null, note = null } = {}) => {
      const c = api.conn.character;
      c.money = Math.max(0, Math.floor(Number(c.money) || 0));
      if (kind && amount) await db.addTransaction(seed.user.id, kind, Math.floor(amount), c.money, meta);
      await db.saveCharacter(c);
      if (note) sent.push({ t: 'you', note });
    },
    now: Date.now(),
    getDay: () => ({ day: 1, endsIn: 0 }),
  };
  return { api, sent, errors };
}
async function seedHustleUser() {
  const s = await seedUser(20000);
  return { user: { id: s.userId, username: s.username }, character: s.character };
}

test('hustle_swap: replaces a mission, 1 free per day', async () => {
  const seed = await seedHustleUser();
  const f = fakeApi(seed);
  await m9.INTENTS.hustle_status(f.api, {});
  const before = f.sent.find(m => m.t === 'm9_hustle');
  assert.equal(before.missions.length, 3);
  assert.ok(before.resetsInMs > 0, 'reset countdown present');
  assert.equal(before.swapLeft, 1);
  assert.ok(before.missions[0].prize && before.missions[0].prize.money > 0, 'per-mission prize present');
  const target = before.missions[0].id;
  const f2 = fakeApi(seed);
  await m9.INTENTS.hustle_swap(f2.api, { missionId: target });
  assert.deepEqual(f2.errors, [], JSON.stringify(f2.errors));
  const f3 = fakeApi(seed);
  await m9.INTENTS.hustle_status(f3.api, {});
  const after = f3.sent.find(m => m.t === 'm9_hustle');
  assert.ok(!after.missions.map(m => m.id).includes(target), 'swapped out');
  assert.equal(after.swapLeft, 0);
  const f4 = fakeApi(seed);
  await m9.INTENTS.hustle_swap(f4.api, { missionId: after.missions[0].id });
  assert.match(f4.errors[0], /one per day/);
});

test('hustle_claim: stars + game money + rep', async () => {
  const seed = await seedHustleUser();
  const f = fakeApi(seed);
  await m9.INTENTS.hustle_status(f.api, {});
  const missions = f.sent.find(m => m.t === 'm9_hustle').missions;
  const picked = missions[0].id;
  const needKind = { shift_1: 'work_pay', shift_3: 'work_pay', earn_10k: 'work_pay', meals_2: 'food', treat_1: 'fun', travel_2: 'travel', finds_3: 'spawn_cash', deposit_1: 'deposit', save_5k: 'deposit', study_1: 'study', repay_1: 'repay', furniture_1: 'buy_furniture' }[picked];
  const needN = { shift_3: 3, travel_2: 2, meals_2: 2, finds_3: 3 }[picked] || 1;
  const amt = picked === 'save_5k' ? -5000 : picked === 'earn_10k' ? 10000 : (needKind === 'deposit' ? -5000 : 100);
  for (let i = 0; i < needN; i++) await db.addTransaction(seed.user.id, needKind, amt, 0, {});
  const moneyBefore = Number(f.api.conn.character.money);
  const f2 = fakeApi(seed);
  // reuse the same character object so the claim sees the ledger + money
  f2.api.conn.character = f.api.conn.character;
  await m9.INTENTS.hustle_claim(f2.api, { missionId: picked });
  assert.deepEqual(f2.errors, [], JSON.stringify(f2.errors));
  const prize = m9.hustleRewardFor(picked);
  assert.equal(Number(f2.api.conn.character.perk_stars), 2);
  assert.equal(Number(f2.api.conn.character.money), moneyBefore + prize.money);
  const rep = await vitality.getVitality(seed.user.id);
  assert.ok(Number(rep.rep) >= prize.rep, `rep ${rep.rep} >= ${prize.rep}`);
  const tx = await db.listTransactions(seed.user.id);
  assert.ok(tx.some(t => t.kind === 'hustle_reward' && Number(t.amount) === prize.money));
});

test('hustle all-three bonus: +₦15k +2✨ +80 rep once', async () => {
  const seed = await seedHustleUser();
  const f = fakeApi(seed);
  await m9.INTENTS.hustle_status(f.api, {});
  const missions = f.sent.find(m => m.t === 'm9_hustle').missions.map(m => m.id);
  const needKind = { shift_1: 'work_pay', shift_3: 'work_pay', earn_10k: 'work_pay', meals_2: 'food', treat_1: 'fun', travel_2: 'travel', finds_3: 'spawn_cash', deposit_1: 'deposit', save_5k: 'deposit', study_1: 'study', repay_1: 'repay', furniture_1: 'buy_furniture' };
  const needN = { shift_3: 3, travel_2: 2, meals_2: 2, finds_3: 3 };
  for (const id of missions) {
    const kind = needKind[id];
    const cnt = needN[id] || 1;
    const amt = id === 'save_5k' ? -5000 : id === 'earn_10k' ? 10000 : (kind === 'deposit' ? -5000 : 100);
    for (let i = 0; i < cnt; i++) await db.addTransaction(seed.user.id, kind, amt, 0, {});
  }
  let char = f.api.conn.character;
  for (const id of missions) {
    const fx = fakeApi(seed);
    fx.api.conn.character = char;
    await m9.INTENTS.hustle_claim(fx.api, { missionId: id });
    assert.deepEqual(fx.errors, [], `${id}: ${JSON.stringify(fx.errors)}`);
    char = fx.api.conn.character;
  }
  assert.equal(Number(char.perk_stars), 3 * 2 + 2, 'stars + all-done bonus');
  const st = await m9.getHustleState(seed.user.id);
  assert.equal(st.bonusClaimed, 1);
  // claiming again is rejected (already claimed), so no double bonus
  const fx = fakeApi(seed);
  fx.api.conn.character = char;
  await m9.INTENTS.hustle_claim(fx.api, { missionId: missions[0] });
  assert.match(fx.errors[0], /Already claimed/);
});

// ---------------- m12: 10th skill + certificate hook ----------------
test('m12: 10 skills incl. fashion with training gate', () => {
  assert.equal(m12.SKILLS.length, 10);
  const fashion = m12.SKILLS.find(s => s.id === 'fashion');
  assert.ok(fashion);
  assert.equal(fashion.name, 'Fashion');
  assert.ok(m12.TRAIN_GATES.fashion);
  assert.ok(m12.TRAIN_GATES.fashion.tags.includes('mall'));
  assert.ok(m12.SKILL_IDS.includes('fashion'));
});

test('m12 grantCertificate: external cert + career boost hook', async () => {
  const { userId } = await seedUser();
  const c = await db.getCharacter(userId);
  const before = m12.skillLevel(c, 'fashion', await m12.getAcademyCerts(userId));
  assert.equal(before, 0);
  const r = await m12.grantCertificate(userId, { courseId: 'p5-tailoring', title: 'P5 Tailoring Sprint', skillId: 'fashion' });
  assert.ok(r.ok);
  assert.ok(r.courseId.startsWith('ext:fashion:'));
  const certs = await m12.listCertificates(userId);
  const ext = certs.find(x => x.courseId === r.courseId);
  assert.ok(ext && ext.external);
  assert.equal(ext.skillId, 'fashion');
  const boosts = m12.boostedSkills(await m12.getAcademyCerts(userId));
  assert.ok(boosts.includes('fashion'));
  const after = m12.skillLevelWithExt(c, 'fashion', await m12.getAcademyCerts(userId));
  assert.equal(after, 1, '+1 effective level from the external cert');
  await assert.rejects(m12.grantCertificate(userId, { courseId: 'x', skillId: 'nope' }), /unknown skill/);
  await assert.rejects(m12.grantCertificate(userId, { skillId: 'fashion' }), /courseId required/);
});

// ---------------- stories: 6 arcs, net-worth lock, rep/gem rewards ----------------
test('stories: 6 arcs seeded, #6 locked behind ₦50m net worth', async () => {
  const { token } = await seedUser(1000);
  const r = await get('/api/stories', token);
  assert.equal(r.status, 200);
  assert.equal(r.json.stories.length, 6);
  const titles = r.json.stories.map(s => s.title);
  assert.ok(titles.includes('Balogun Hustle'));
  assert.ok(titles.includes('Quilox Nights'));
  const sixth = r.json.stories.find(s => s.id === 6);
  assert.equal(sixth.locked, true);
  assert.equal(sixth.netWorthReq, 50000000);
  assert.equal(sixth.rewardRep, 200);
  assert.equal(sixth.rewardGems, 3);
  const locked = await get('/api/stories/6', token);
  assert.equal(locked.status, 403);
  assert.equal(locked.json.locked, true);
});

test('story advance: rep + gems on choices, completion bonus', async () => {
  const { token, userId } = await seedUser(100000);
  // walk all of story 2 (Balogun Hustle): 5 chapters × 3 scenes
  const d = await get('/api/stories/2', token);
  assert.equal(d.status, 200);
  let chapterNo = 1, sceneNo = 1;
  let completed = false;
  let totalRep = 0, totalGems = 0;
  for (let i = 0; i < 20 && !completed; i++) {
    const detail = await get('/api/stories/2', token);
    const ch = detail.json.chapters.find(x => x.chapterNo === chapterNo);
    const sc = ch.scenes.find(x => x.sceneNo === sceneNo);
    const body = { chapter_no: chapterNo, scene_no: sceneNo };
    if (sc.choices && sc.choices.length) body.choice_id = sc.choices[0].id;
    const adv = await post('/api/stories/2/advance', body, token);
    assert.equal(adv.status, 200, `advance ${chapterNo}.${sceneNo}: ${JSON.stringify(adv.json)}`);
    assert.ok(adv.json.ok);
    totalRep += adv.json.reward.rep || 0;
    totalGems += adv.json.reward.gems || 0;
    completed = adv.json.completed;
    chapterNo = adv.json.progress.chapterNo;
    sceneNo = adv.json.progress.sceneNo;
  }
  assert.ok(completed, 'story 2 completes');
  assert.ok(totalRep >= 120, `rep ${totalRep} includes completion bonus`);
  assert.ok(totalGems >= 2, `gems ${totalGems} includes completion bonus`);
  const vit = await vitality.getVitality(userId);
  assert.ok(Number(vit.rep) >= totalRep, `rep persisted: ${vit.rep} >= ${totalRep}`);
  const again = await post('/api/stories/2/advance', { chapter_no: 5, scene_no: 3, choice_id: 999999 }, token);
  assert.equal(again.status, 400, 'finished story rejects further advances');
});
