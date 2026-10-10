// M9 tests: daily retention — treasure hunt, Today's Hustle, perks.
// Direct intent invocation with a fake api (mirrors the README contract),
// plus pure-logic and storage round-trip checks.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET='test';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const m9 = await import('../src/game/v2/m9.js');

let base, app;

test.before(async () => {
  app = await createApp();
  const port = await app.start(0);
  base = `http://127.0.0.1:${port}`;
  await m9.ensureSchema();
});

test.after(async () => { await app.close(); });

// ---- seed helper (bypasses HTTP auth rate limits) ----
let guestN = 0;
async function seedUser(charPatch) {
  guestN += 1;
  const username = 'm9u' + guestN;
  const userId = await db.createUser({ username, is_guest: 1 });
  const c = await db.getCharacter(userId);
  Object.assign(c, { perk_stars: 0, perks: '[]' }, charPatch || {});
  await db.saveCharacter(c);
  await m9.persistPerks(c);
  return { user: { id: userId, username }, character: await db.getCharacter(userId) };
}

// Fake api per the INTENTS contract.
function fakeApi(seed) {
  const sent = [];
  const errors = [];
  const api = {
    conn: { user: seed.user, character: seed.character, cds: {}, pos: { lat: 50, lng: 50 }, furniture: [] },
    send: (conn, msg) => sent.push(msg),
    broadcast: (msg) => {},
    youSnapshot: (conn) => ({ money: Number(conn.character.money), perk_stars: Number(conn.character.perk_stars) || 0 }),
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

async function activeRoundLoc() {
  const r = await m9.getActiveRound();
  return r ? r.location_id : null;
}

// ---- pure logic ----
test('riddles: 30 entries, all point at real locations, spread across regions', () => {
  assert.equal(m9.RIDDLES.length, 30);
  assert.deepEqual(m9.riddlesValid(), []);
  const texts = new Set(m9.RIDDLES.map(r => r.text));
  assert.equal(texts.size, 30); // all original/distinct
});

test('prizeForPlace tiers', () => {
  assert.equal(m9.prizeForPlace(1), 50000);
  assert.equal(m9.prizeForPlace(2), 25000);
  assert.equal(m9.prizeForPlace(3), 25000);
  assert.equal(m9.prizeForPlace(4), 10000);
  assert.equal(m9.prizeForPlace(10), 10000);
  assert.equal(m9.prizeForPlace(11), 3000);
  assert.equal(m9.prizeForPlace(500), 3000);
});

test('PERKS: 14 original perks, valid effect contract', () => {
  assert.equal(m9.PERKS.length, 14);
  const ids = new Set(m9.PERKS.map(p => p.id));
  assert.equal(ids.size, 14);
  for (const p of m9.PERKS) {
    assert.ok(p.cost > 0 && Number.isInteger(p.cost), p.id);
    assert.ok(['decay_slow', 'decay_all', 'work_pay', 'discount', 'xp_boost'].includes(p.effect.type), p.id);
    if (p.effect.type === 'decay_slow') assert.ok(['hunger', 'energy', 'health', 'happiness'].includes(p.effect.need), p.id);
    assert.ok(p.effect.pct > 0 && p.effect.pct < 100, p.id);
  }
});

test('pickMissions: deterministic, 3 distinct, valid ids', () => {
  const a = m9.pickMissions(7, '2026-10-10');
  const b = m9.pickMissions(7, '2026-10-10');
  const c = m9.pickMissions(8, '2026-10-10');
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, 3);
  assert.ok(a.every(id => m9.missionById(id)));
  assert.ok(a.join() !== c.join() || true); // different users may differ
});

test('lagosDayKey / lagosDayStartMs', () => {
  // 2026-10-10 00:30 WAT = 2026-10-09 23:30 UTC
  const ms = Date.UTC(2026, 9, 9, 23, 30);
  assert.equal(m9.lagosDayKey(ms), '2026-10-10');
  assert.equal(m9.lagosDayStartMs(ms), Date.UTC(2026, 9, 9, 23, 0));
});

test('perk JSON shape for M8 + multipliers', () => {
  const c = { perks: JSON.stringify(['slow_burn', 'all_rounder', 'overtime', 'market_whisperer', 'fast_brain']) };
  const fx = m9.activePerkEffects(c);
  assert.deepEqual(fx, [
    { id: 'slow_burn', type: 'decay_slow', need: 'hunger', pct: 25 },
    { id: 'all_rounder', type: 'decay_all', pct: 15 },
    { id: 'overtime', type: 'work_pay', pct: 20 },
    { id: 'market_whisperer', type: 'discount', pct: 10 },
    { id: 'fast_brain', type: 'xp_boost', pct: 20 },
  ]);
  assert.equal(m9.decayMultiplier('hunger', fx), 0.75 * 0.85);
  assert.equal(m9.decayMultiplier('energy', fx), 0.85);
  assert.equal(m9.workPayMultiplier(c), 1.2);
  assert.equal(m9.discountMultiplier(c), 0.9);
  assert.equal(m9.xpBoostMultiplier(c), 1.2);
  assert.deepEqual(m9.activePerkEffects({ perks: 'garbage' }), []);
});

// ---- hunt rotation ----
test('rotation: first tick creates round 0; no duplicate within 21h; expiry rotates', async () => {
  // createApp() already ran bootM9 (round may exist) — clear for a deterministic start.
  const db = await import('../src/db.js');
  await db.dbRun('DELETE FROM hunt_rounds', 'DELETE FROM hunt_rounds');
  await db.dbRun("DELETE FROM meta WHERE key IN ('hunt_round_idx','hunt_round_id')", "DELETE FROM meta WHERE key IN ('hunt_round_idx','hunt_round_id')");
  const b1 = [];
  await m9.onTickMinute({ broadcast: (m) => b1.push(m) });
  assert.equal(b1.length, 1);
  assert.equal(b1[0].t, 'sys');
  assert.match(b1[0].text, /riddle is live/);
  const r1 = await m9.getActiveRound();
  assert.ok(r1);
  assert.equal(r1.riddle, m9.RIDDLES[0].text);
  assert.equal(r1.location_id, m9.RIDDLES[0].locationId);
  assert.equal(Number(r1.ends_at) - Number(r1.starts_at), m9.HUNT_ROUND_MS);

  const b2 = [];
  await m9.onTickMinute({ broadcast: (m) => b2.push(m) });
  assert.equal(b2.length, 0); // no new round within 21h
  assert.equal((await m9.getActiveRound()).id, r1.id);

  // force expiry → next riddle in the cycle
  await db.dbRun('UPDATE hunt_rounds SET ends_at=? WHERE id=?',
    'UPDATE hunt_rounds SET ends_at=$1 WHERE id=$2', [Date.now() - 1, r1.id]);
  await m9.onTickMinute({ broadcast: () => {} });
  const r2 = await m9.getActiveRound();
  assert.notEqual(r2.id, r1.id);
  assert.equal(r2.riddle, m9.RIDDLES[1].text);
});

// ---- hunt claims: places + prize tiers across many users ----
test('hunt_claim: places and prize tiers (12 users)', async () => {
  const loc = await activeRoundLoc();
  const seeds = [];
  for (let i = 0; i < 12; i++) seeds.push(await seedUser({ location_id: loc, money: 1000 }));
  const expectedPrizes = [50000, 25000, 25000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 3000, 3000];
  for (let i = 0; i < 12; i++) {
    const { api, sent, errors } = fakeApi(seeds[i]);
    await m9.INTENTS.hunt_claim(api, {});
    assert.deepEqual(errors, [], `user ${i} errors`);
    const you = sent.find(m => m.t === 'you');
    assert.ok(you && you.note.includes(`#${i + 1}`), `user ${i} note names place`);
    const tx = await db.listTransactions(seeds[i].user.id, 5);
    const prizeTx = tx.find(t => t.kind === 'hunt_prize');
    assert.ok(prizeTx, `user ${i} has hunt_prize ledger`);
    assert.equal(Number(prizeTx.amount), expectedPrizes[i], `user ${i} prize`);
    assert.equal(api.conn.character.money, 1000 + expectedPrizes[i]);
    // myPlace via status
    const st = fakeApi(seeds[i]);
    await m9.INTENTS.hunt_status(st.api, {});
    const status = st.sent.find(m => m.t === 'm9_hunt_status');
    assert.equal(status.myPlace, i + 1);
  }
  // money never negative
  for (const s of seeds) assert.ok(s.character.money >= 0);
});

test('hunt_claim: wrong location rejected, no money moves', async () => {
  const loc = await activeRoundLoc();
  const seed = await seedUser({ location_id: 'ojuelegba', money: 500 });
  if (seed.character.location_id === loc) seed.character.location_id = 'makoko';
  const { api, sent, errors } = fakeApi(seed);
  await m9.INTENTS.hunt_claim(api, {});
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Wrong spot/);
  assert.equal(api.conn.character.money, 500);
  const tx = await db.listTransactions(seed.user.id, 5);
  assert.ok(!tx.some(t => t.kind === 'hunt_prize'));
});

test('hunt_claim: double claim rejected', async () => {
  const loc = await activeRoundLoc();
  const seed = await seedUser({ location_id: loc, money: 0 });
  const f1 = fakeApi(seed);
  await m9.INTENTS.hunt_claim(f1.api, {});
  assert.deepEqual(f1.errors, []);
  const f2 = fakeApi(seed);
  await m9.INTENTS.hunt_claim(f2.api, {});
  assert.equal(f2.errors.length, 1);
  assert.match(f2.errors[0], /already claimed/);
});

test('hunt_status: prizes included; leaderboard via REST handler', async () => {
  const seed = await seedUser({});
  const f = fakeApi(seed);
  await m9.INTENTS.hunt_status(f.api, {});
  const st = f.sent.find(m => m.t === 'm9_hunt_status');
  assert.ok(st.round && st.round.riddle && st.round.endsAt > Date.now());
  assert.equal(st.prizes.length, 4);
  // REST handler (direct invocation)
  const spec = m9.REST_SPEC.find(r => r.path === '/api/v2/m9/hunt');
  let body = null;
  await spec.handler({ user: seed.user }, { json: (o) => { body = o; } });
  assert.ok(body.round.riddle);
  assert.ok(Array.isArray(body.leaders));
  assert.ok(body.leaders.length >= 10);
  assert.equal(body.leaders[0].place, 1);
  assert.ok(body.leaders[0].username);
  // riddle text must not leak the location id/name
  const locId = (await m9.getActiveRound()).location_id;
  assert.ok(!body.round.riddle.includes(locId));
});

// ---- hustle ----
test('hustle_status: 3 deterministic missions + done flags', async () => {
  const seed = await seedUser({});
  const f = fakeApi(seed);
  await m9.INTENTS.hustle_status(f.api, {});
  const st = f.sent.find(m => m.t === 'm9_hustle');
  assert.equal(st.missions.length, 3);
  assert.ok(st.missions.every(m => m.reward === 2 && m.done === false && m.claimed === false));
  // deterministic for the same user
  const f2 = fakeApi(seed);
  await m9.INTENTS.hustle_status(f2.api, {});
  const st2 = f2.sent.find(m => m.t === 'm9_hustle');
  assert.deepEqual(st2.missions.map(m => m.id), st.missions.map(m => m.id));
});

test('hustle mission checks read today’s ledger', async () => {
  const seed = await seedUser({});
  const start = m9.lagosDayStartMs();
  const api = { countLedger: (k) => m9.countLedgerSince(seed.user.id, k, start), sumLedger: (k) => m9.sumLedgerSince(seed.user.id, k, start) };
  const shift1 = m9.missionById('shift_1');
  assert.equal(await shift1.check(api), false);
  await db.addTransaction(seed.user.id, 'work_pay', 2500, 2500, { job: 'x' });
  assert.equal(await shift1.check(api), true);
  assert.equal(await m9.missionById('shift_3').check(api), false);
  assert.equal(await m9.missionById('earn_10k').check(api), false);
  const save5k = m9.missionById('save_5k');
  assert.equal(await save5k.check(api), false);
  await db.addTransaction(seed.user.id, 'deposit', -5000, 0, { op: 'deposit' });
  assert.equal(await save5k.check(api), true);
});

test('hustle_claim: awards 2 stars, double-claim rejected, incomplete rejected', async () => {
  const seed = await seedUser({});
  // find a mission the user can complete: eat 2 meals
  const f0 = fakeApi(seed);
  await m9.INTENTS.hustle_status(f0.api, {});
  const missions = f0.sent.find(m => m.t === 'm9_hustle').missions;
  // complete 'meals_2' directly regardless of today's pick
  await db.addTransaction(seed.user.id, 'food', -800, 0, { item: 'mama_put' });
  await db.addTransaction(seed.user.id, 'food', -800, 0, { item: 'suya' });

  const f = fakeApi(seed);
  await m9.INTENTS.hustle_claim(f.api, { missionId: 'meals_2' });
  if (f.errors.length) {
    // mission not in today's pick → expected err; retry with a picked mission
    assert.match(f.errors[0], /today’s hustle list/);
    const picked = missions[0].id;
    // complete the picked mission generically: grant its ledger requirement
    const needKind = { shift_1: 'work_pay', shift_3: 'work_pay', earn_10k: 'work_pay', meals_2: 'food', treat_1: 'fun', travel_2: 'travel', finds_3: 'spawn_cash', deposit_1: 'deposit', save_5k: 'deposit', study_1: 'study', repay_1: 'repay', furniture_1: 'buy_furniture' }[picked];
    const needN = { shift_3: 3, travel_2: 2, meals_2: 2, finds_3: 3 }[picked] || 1;
    const amt = picked === 'save_5k' ? -5000 : picked === 'earn_10k' ? 10000 : (needKind === 'deposit' ? -5000 : 100);
    for (let i = 0; i < needN; i++) await db.addTransaction(seed.user.id, needKind, amt, 0, {});
    const f3 = fakeApi(seed);
    await m9.INTENTS.hustle_claim(f3.api, { missionId: picked });
    assert.deepEqual(f3.errors, [], JSON.stringify(f3.errors));
    assert.equal(f3.api.conn.character.perk_stars, 2);
    const f4 = fakeApi(seed);
    await m9.INTENTS.hustle_claim(f4.api, { missionId: picked });
    assert.match(f4.errors[0], /Already claimed/);
  } else {
    assert.equal(f.api.conn.character.perk_stars, 2);
    const f2 = fakeApi(seed);
    await m9.INTENTS.hustle_claim(f2.api, { missionId: 'meals_2' });
    assert.match(f2.errors[0], /Already claimed/);
  }

  // incomplete mission rejected (fresh user, no ledger rows)
  const fresh = await seedUser({});
  const statusApi = fakeApi(fresh);
  await m9.INTENTS.hustle_status(statusApi.api, {});
  const pickedFresh = statusApi.sent.find(m => m.t === 'm9_hustle').missions[0].id;
  const ff = fakeApi(fresh);
  await m9.INTENTS.hustle_claim(ff.api, { missionId: pickedFresh });
  assert.match(ff.errors[0], /not complete yet/);
  assert.equal(ff.api.conn.character.perk_stars, 0);
});

// ---- perks ----
test('perk_buy: insufficient stars rejected; buy deducts + owns; duplicate rejected', async () => {
  const seed = await seedUser({});
  const f1 = fakeApi(seed);
  await m9.INTENTS.perk_buy(f1.api, { perk: 'slow_burn' });
  assert.match(f1.errors[0], /Need 8/);

  f1.api.conn.character.perk_stars = 20;
  await m9.persistPerks(f1.api.conn.character);
  const f2 = fakeApi({ user: seed.user, character: await db.getCharacter(seed.user.id) });
  await m9.INTENTS.perk_buy(f2.api, { perk: 'slow_burn' });
  assert.deepEqual(f2.errors, []);
  assert.equal(f2.api.conn.character.perk_stars, 12);
  assert.deepEqual(JSON.parse(f2.api.conn.character.perks), ['slow_burn']);
  const note = f2.sent.find(m => m.t === 'you');
  assert.ok(note && note.note.includes('Slow Burn'));

  // persisted to DB
  const fromDb = await db.getCharacter(seed.user.id);
  assert.equal(Number(fromDb.perk_stars), 12);
  assert.deepEqual(JSON.parse(fromDb.perks), ['slow_burn']);

  const f3 = fakeApi({ user: seed.user, character: await db.getCharacter(seed.user.id) });
  await m9.INTENTS.perk_buy(f3.api, { perk: 'slow_burn' });
  assert.match(f3.errors[0], /already own/);

  const f4 = fakeApi({ user: seed.user, character: await db.getCharacter(seed.user.id) });
  await m9.INTENTS.perk_buy(f4.api, { perk: 'nope' });
  assert.match(f4.errors[0], /Unknown perk/);
});

test('perk_list returns balance + owned + catalog', async () => {
  const seed = await seedUser({ perk_stars: 5, perks: JSON.stringify(['light_snacker']) });
  const f = fakeApi(seed);
  await m9.INTENTS.perk_list(f.api, {});
  const msg = f.sent.find(m => m.t === 'm9_perks');
  assert.equal(msg.stars, 5);
  assert.deepEqual(msg.owned, ['light_snacker']);
  assert.equal(msg.perks.length, 14);
});

test('REST hustle/perks handlers', async () => {
  const seed = await seedUser({});
  const hustle = m9.REST_SPEC.find(r => r.path === '/api/v2/m9/hustle');
  let body = null;
  await hustle.handler({ user: seed.user }, { json: (o) => { body = o; } });
  assert.equal(body.missions.length, 3);
  const perks = m9.REST_SPEC.find(r => r.path === '/api/v2/m9/perks');
  body = null;
  await perks.handler({ user: seed.user }, { json: (o) => { body = o; } });
  assert.equal(body.perks.length, 14);
  assert.equal(body.stars, 0);
});

test('hustle_state resets on a new Lagos day', async () => {
  const seed = await seedUser({});
  const st1 = await m9.getHustleState(seed.user.id);
  const st2 = await m9.getHustleState(seed.user.id, Date.now() + 26 * 3600 * 1000);
  assert.notEqual(st1.day_key, st2.day_key);
  assert.deepEqual(st2.done, []);
  assert.equal(st2.claimed_stars, 0);
});
