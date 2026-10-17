// P3 careers tests: 27-career data + registration, promotion rules,
// schedules, the work-event mini-game, core ops, tick behavior
// (bonus, promotion flag, auto-start, event spawn/timeout), WS
// intents and the REST router.
//
// NOTE: gameplay users are seeded directly via db.createUser +
// signToken (same convention as act.test.js) to dodge auth rate limits.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'p3-test-secret';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const p3 = await import('../src/game/careers.js');
const m7 = await import('../src/game/v2/m7.js');

let base, app;

test.before(async () => {
  app = await createApp();
  await p3.ensureSchema();
  const port = await app.start(0);
  base = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await app.close();
});

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

let n = 0;
async function seedUser(skills = {}) {
  n += 1;
  const userId = await db.createUser({ username: 'p3user' + n, is_guest: 1 });
  const token = signToken(userId);
  await db.ensureCharacter(userId, 'P3 Tester ' + n);
  if (Object.keys(skills).length) {
    await db.dbRun(
      'UPDATE characters SET skills=? WHERE user_id=?',
      'UPDATE characters SET skills=$1 WHERE user_id=$2',
      [JSON.stringify(skills), userId],
    );
  }
  return { userId, token };
}
async function setChar(userId, patch) {
  const keys = Object.keys(patch);
  await db.dbRun(
    `UPDATE characters SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE user_id=?`,
    `UPDATE characters SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(', ')} WHERE user_id=$${keys.length + 1}`,
    [...keys.map((k) => patch[k]), userId],
  );
}
async function charOf(userId) {
  return db.getCharacter(userId);
}

// A fixed Lagos Monday 10:00 (2026-10-19 is a Monday) for schedule tests.
const MON_10 = Date.parse('2026-10-19T10:00:00+01:00');
const SAT_10 = Date.parse('2026-10-17T10:00:00+01:00'); // Saturday

// ---------------- data ----------------
test('27 careers, 5 ranks each, pay in the 8600–18300 band', () => {
  assert.equal(p3.CAREERS.length, 27);
  const ids = new Set(p3.CAREERS.map((c) => c.id));
  assert.equal(ids.size, 27, 'career ids unique');
  for (const c of p3.CAREERS) {
    assert.equal(c.ranks.length, 5, `${c.id} needs 5 ranks`);
    assert.ok(c.ranks[0].payPerShift >= 8600, `${c.id} rank0 pay`);
    assert.ok(c.ranks[4].payPerShift <= 18300, `${c.id} rank4 pay`);
    assert.ok(c.ranks[4].payPerShift > c.ranks[0].payPerShift, `${c.id} pay rises`);
    assert.ok(c.schedule.days.length === 5, `${c.id} 5-day week`);
  }
});

test('every rank registers as an M7 shift role', () => {
  for (const c of p3.CAREERS) {
    for (let r = 0; r < 5; r++) {
      const id = p3.shiftRoleId(c.id, r);
      const role = m7.findRole(id);
      assert.ok(role, `role ${id} registered`);
      assert.equal(role.careerId, c.id);
      assert.ok(m7.isExtendedRole(id));
    }
  }
  assert.equal(m7.isExtendedRole('junior_dev'), false, 'legacy roles are not extended');
});

test('schedules: office careers rest on weekends, shift careers on their own days', () => {
  const software = p3.careerById('software');
  const media = p3.careerById('media');
  assert.equal(p3.isWorkDay(software, MON_10), true);
  assert.equal(p3.isWorkDay(software, SAT_10), false);
  assert.equal(p3.isWorkDay(media, SAT_10), true); // media works Tue–Sat
  const strip = p3.scheduleStrip(software);
  assert.equal(strip.length, 7);
  assert.deepEqual(strip.filter((d) => d.work).map((d) => d.day), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
});

// ---------------- bonus reader (Phase 1 contract) ----------------
test('getWorkPerformanceBonus reads the work_performance perk', () => {
  assert.equal(p3.getWorkPerformanceBonus({}), 0);
  assert.equal(p3.getWorkPerformanceBonus({ perks: '[]' }), 0);
  assert.equal(p3.getWorkPerformanceBonus({ perks: [{ effect: { type: 'work_pay', pct: 20 } }] }), 0);
  assert.equal(
    p3.getWorkPerformanceBonus({ perks: JSON.stringify([{ effect: { type: 'work_performance', pct: 25 } }]) }),
    0.25,
  );
  assert.equal(p3.getWorkPerformanceBonus({ perks: [{ effect: { type: 'work_performance', pct: 200 } }] }), 1, 'capped');
});

// ---------------- mini-game pure logic ----------------
test('event deltas scale with the bonus, clamp 0–100, client never sees deltas', () => {
  assert.equal(p3.applyEventDelta(50, 15, 0), 65);
  assert.equal(p3.applyEventDelta(50, 15, 0.25), 69, 'perk boosts gains (50 + 15*1.25 = 68.75 → 69)');
  assert.equal(p3.applyEventDelta(50, -8, 0.25), 42, 'penalties are never softened');
  assert.equal(p3.applyEventDelta(95, 15, 0), 100, 'clamped');
  assert.equal(p3.applyEventDelta(5, -10, 0), 0, 'floored');
  const def = p3.pickEvent('tech', 0, () => 0.9999); // last pool entry
  assert.ok(def && def.id && def.choices.length >= 2);
  const stored = p3.buildStoredEvent(def, 1000);
  assert.equal(stored.emittedAt, 1000);
  assert.equal(stored.expiresAt, 1000 + p3.EVENT_WINDOW_MS);
  const pub = p3.publicEvent(stored);
  assert.ok(!JSON.stringify(pub).includes('"delta"'), 'no delta leak');
  assert.ok(pub.expiresAt > 0);
});

test('perfBonusPct tiers + promotion rule', () => {
  assert.equal(p3.perfBonusPct(100), 20);
  assert.equal(p3.perfBonusPct(90), 20);
  assert.equal(p3.perfBonusPct(89), 10);
  assert.equal(p3.perfBonusPct(70), 10);
  assert.equal(p3.perfBonusPct(69), 5);
  assert.equal(p3.perfBonusPct(49), 0);
  const software = p3.careerById('software');
  assert.equal(p3.promotionEligible(software, 0, 3, 100), true);
  assert.equal(p3.promotionEligible(software, 0, 2, 100), false, 'needs 3 shifts at rank 0');
  assert.equal(p3.promotionEligible(software, 0, 9, 99), false, 'needs exactly 100%');
  assert.equal(p3.promotionEligible(software, 4, 99, 100), false, 'top rank has nowhere to go');
});

// ---------------- core ops ----------------
test('apply: skill/cert gates enforced', async () => {
  const u = await seedUser(); // no skills, no cert
  let r = await p3.applyCareer(u.userId, 'software');
  assert.equal(r.ok, false, 'coding lock blocks');
  assert.match(r.error, /Coding level 2/);
  const u2 = await seedUser({ coding: 2 });
  r = await p3.applyCareer(u2.userId, 'software');
  assert.equal(r.ok, true);
  assert.equal(r.status.careerId, 'software');
  assert.equal(r.status.rank, 1);
  const u3 = await seedUser();
  r = await p3.applyCareer(u3.userId, 'civil'); // certRequired
  assert.equal(r.ok, false);
  assert.match(r.error, /certificate/i);
});

test('apply: blocked while on a live shift; switch restarts at rank 1', async () => {
  const u = await seedUser({ coding: 3, fitness: 3 });
  await p3.applyCareer(u.userId, 'software');
  await setChar(u.userId, { shift_job: 'p3_software_r0', shift_ends_at: Date.now() + 3600000 });
  let r = await p3.applyCareer(u.userId, 'product');
  assert.equal(r.ok, false, 'cannot switch mid-shift');
  await setChar(u.userId, { shift_job: null, shift_started_at: null, shift_ends_at: null });
  await p3.promoteCareer(u.userId).catch(() => {}); // no-op, not eligible
  r = await p3.applyCareer(u.userId, 'product');
  assert.equal(r.ok, true);
  assert.equal(r.switching, true);
  const c = await charOf(u.userId);
  assert.equal(c.career_id, 'product');
  assert.equal(Number(c.career_rank), 0, 'switch restarts at rank 1');
});

test('quit: blocked on shift, clears everything otherwise', async () => {
  const u = await seedUser({ coding: 2 });
  await p3.applyCareer(u.userId, 'software');
  await setChar(u.userId, { shift_job: 'p3_software_r0', shift_ends_at: Date.now() + 3600000 });
  let r = await p3.quitCareer(u.userId);
  assert.equal(r.ok, false, 'cannot quit mid-shift');
  await setChar(u.userId, { shift_job: null, shift_started_at: null, shift_ends_at: null });
  r = await p3.quitCareer(u.userId);
  assert.equal(r.ok, true);
  const c = await charOf(u.userId);
  assert.equal(c.career_id, null);
});

test('promote: needs the flag; advances rank and resets progress', async () => {
  const u = await seedUser({ coding: 2 });
  await p3.applyCareer(u.userId, 'software');
  let r = await p3.promoteCareer(u.userId);
  assert.equal(r.ok, false, 'not eligible yet');
  await setChar(u.userId, { career_shifts: 3, career_promo: 1 });
  r = await p3.promoteCareer(u.userId);
  assert.equal(r.ok, true);
  assert.equal(r.newTitle, 'Junior Developer');
  const c = await charOf(u.userId);
  assert.equal(Number(c.career_rank), 1);
  assert.equal(Number(c.career_shifts), 0);
  assert.equal(Number(c.career_promo), 0);
});

test('respond: good answer raises perf, bad lowers, timeout costs, stale id rejected', async () => {
  const u = await seedUser({ coding: 2 });
  await p3.applyCareer(u.userId, 'software');
  const now = Date.now();
  await setChar(u.userId, {
    shift_job: 'p3_software_r0', shift_started_at: now - 600000, shift_ends_at: now + 3000000,
    shift_perf: 50,
    shift_event: JSON.stringify(p3.buildStoredEvent(p3.pickEvent('tech', 0, () => 0), now)),
    shift_event_count: 1,
  });
  const c0 = await charOf(u.userId);
  const stored = JSON.parse(c0.shift_event);
  const good = stored.choices.reduce((a, b) => (a.delta > b.delta ? a : b));
  let r = await p3.respondToEvent(u.userId, stored.id, good.id, now + 1000);
  assert.equal(r.ok, true);
  assert.ok(r.performance > 50, 'good answer raises performance');
  const c1 = await charOf(u.userId);
  assert.equal(c1.shift_event, null, 'event cleared');

  // bad answer
  await setChar(u.userId, {
    shift_event: JSON.stringify(p3.buildStoredEvent(p3.pickEvent('tech', 0, () => 0.5), now)),
    shift_perf: 50,
  });
  const c2 = await charOf(u.userId);
  const stored2 = JSON.parse(c2.shift_event);
  const bad = stored2.choices.reduce((a, b) => (a.delta < b.delta ? a : b));
  r = await p3.respondToEvent(u.userId, stored2.id, bad.id, now + 1000);
  assert.ok(r.performance < 50, 'bad answer lowers performance');

  // stale event id
  r = await p3.respondToEvent(u.userId, 'nope', 'x', now + 1000);
  assert.equal(r.ok, false);

  // timeout: answer after the window counts as a miss
  await setChar(u.userId, {
    shift_event: JSON.stringify(p3.buildStoredEvent(p3.pickEvent('tech', 0, () => 0.2), now - p3.EVENT_WINDOW_MS - 1000)),
    shift_perf: 60,
  });
  const c3 = await charOf(u.userId);
  const stored3 = JSON.parse(c3.shift_event);
  r = await p3.respondToEvent(u.userId, stored3.id, stored3.choices[0].id, now);
  assert.equal(r.ok, true);
  assert.equal(r.timedOut, true);
  assert.equal(r.performance, 50, 'timeout costs 10');
});

test('status view model carries the Career tab fields', async () => {
  const u = await seedUser({ coding: 2 });
  assert.deepEqual((await p3.getCareerStatus(u.userId)).employed, false);
  await p3.applyCareer(u.userId, 'software');
  const st = await p3.getCareerStatus(u.userId, MON_10);
  assert.equal(st.employed, true);
  assert.equal(st.rank, 1);
  assert.equal(st.rankOf, 5);
  assert.equal(st.ladder.length, 5);
  assert.equal(st.nextRank.title, 'Junior Developer');
  assert.equal(st.dayOffToday, false);
  assert.equal(st.scheduleStrip.filter((d) => d.work).length, 5);
  assert.equal(st.shiftRoleId, 'p3_software_r0');
  const stSat = await p3.getCareerStatus(u.userId, SAT_10);
  assert.equal(stSat.dayOffToday, true);
});

// ---------------- tick ----------------
test('tick: expired career shift banks bonus + promotion flag before base pay', async () => {
  const u = await seedUser({ coding: 2 });
  await p3.applyCareer(u.userId, 'software');
  const now = Date.now();
  // 2 shifts banked at rank 0 (needs 3), shift ends at 100% → promotion-ready.
  await setChar(u.userId, {
    shift_job: 'p3_software_r0', shift_started_at: now - 3700000, shift_ends_at: now - 1000,
    shift_perf: 100, shift_event_count: 2, career_shifts: 2, money: 10000,
  });
  const sent = [];
  const summary = await p3.onTickMinute({ now, sendTo: async (uid, m) => sent.push(m), rand: () => 0.99 });
  assert.equal(summary.shiftsClosed, 1);
  const c = await charOf(u.userId);
  assert.equal(Number(c.career_shifts), 3);
  assert.equal(Number(c.career_promo), 1, 'promotion flagged');
  assert.equal(c.shift_perf, null, 'shift perf cleared');
  assert.ok(Number(c.money) > 10000, 'bonus credited');
  assert.equal(c.shift_job, 'p3_software_r0', 'm7 still owns the settle');
  const closed = sent.find((m) => m.t === 'career_shift_closed');
  assert.ok(closed && closed.promotionReady === true);
});

test('tick: live shift spawns events, times them out, auto-starts on workdays', async () => {
  const u = await seedUser({ coding: 2, fitness: 3 });
  await p3.applyCareer(u.userId, 'software');
  const now = MON_10; // Monday 10:00 Lagos — a workday, after 9:00 start
  await setChar(u.userId, {
    shift_job: 'p3_software_r0', shift_started_at: now - 600000, shift_ends_at: now + 3000000,
    shift_perf: 50, energy: 100,
  });
  const sent = [];
  // rand 0 → always spawns (0 < 0.35)
  await p3.onTickMinute({ now, sendTo: async (uid, m) => sent.push(m), rand: () => 0 });
  const c = await charOf(u.userId);
  assert.ok(c.shift_event, 'event spawned');
  const spawned = sent.find((m) => m.t === 'career_event');
  assert.ok(spawned, 'event pushed to player');
  assert.ok(!JSON.stringify(spawned.event).includes('"delta"'), 'no delta leak over the wire');

  // next minute with the event expired → timeout penalty
  const stored = JSON.parse(c.shift_event);
  stored.expiresAt = now - 1;
  await setChar(u.userId, { shift_event: JSON.stringify(stored) });
  const sent2 = [];
  await p3.onTickMinute({ now: now + 60000, sendTo: async (uid, m) => sent2.push(m), rand: () => 0.99 });
  const c2 = await charOf(u.userId);
  assert.equal(Number(c2.shift_perf), 40, 'timeout −10');
  assert.equal(c2.shift_event, null);
  assert.ok(sent2.find((m) => m.t === 'career_event_expired'));

  // auto-start: clear shift, opt in, tick on a workday morning
  await setChar(u.userId, {
    shift_job: null, shift_started_at: null, shift_ends_at: null,
    shift_perf: null, shift_event: null, career_auto: 1, career_last_day: '2026-10-18',
  });
  const sent3 = [];
  const summary = await p3.onTickMinute({ now, sendTo: async (uid, m) => sent3.push(m), rand: () => 0.99 });
  assert.equal(summary.autoStarted, 1);
  const c3 = await charOf(u.userId);
  assert.equal(c3.shift_job, 'p3_software_r0');
  assert.equal(Number(c3.energy), 70, 'energy deducted');
  assert.ok(sent3.find((m) => m.t === 'career_auto_started'));

  // no double auto-start the same day
  const sent4 = [];
  const s2 = await p3.onTickMinute({ now: now + 60000, sendTo: async (uid, m) => sent4.push(m), rand: () => 0.99 });
  assert.equal(s2.autoStarted, 0);
});

// ---------------- WS intents ----------------
test('WS intents: apply/quit/promote/respond round-trip', async () => {
  const u = await seedUser({ coding: 3 });
  const conn = { user: { id: u.userId, username: 'ws' }, character: await charOf(u.userId), cds: {} };
  const notes = [];
  const api = {
    conn,
    send: () => {},
    broadcast: () => {},
    youSnapshot: () => ({}),
    err: (m) => { throw new Error('unexpected err: ' + m); },
    commit: async ({ note } = {}) => { notes.push(note); },
    now: Date.now(),
    getDay: () => ({ day: 1 }),
  };
  await p3.INTENTS.career_apply(api, { careerId: 'product' });
  assert.ok(notes[0].includes('Product Management'));
  assert.equal(conn.character.career_id, 'product');
  await p3.INTENTS.career_auto(api, { on: true });
  assert.equal(conn.character.career_auto, 1);
  await p3.INTENTS.career_quit(api, {});
  assert.equal(conn.character.career_id, null);
});

// ---------------- REST ----------------
test('REST: catalogue, apply, respond, me', async () => {
  const list = await get('/api/careers');
  assert.equal(list.status, 200);
  assert.equal(list.json.careers.length, 27);
  assert.ok(list.json.careers[0].payBand.length === 2);

  const u = await seedUser({ coding: 2 });
  let r = await post('/api/careers/apply', { careerId: 'software' }, u.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.status.careerId, 'software');

  r = await get('/api/careers/me', u.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.rankTitle, 'Code Intern');
  assert.equal(r.json.ladder.length, 5);

  r = await post('/api/careers/auto', { on: true }, u.token);
  assert.equal(r.json.auto, true);

  // respond with no event → 400
  r = await post('/api/careers/respond', { eventId: 'x', choiceId: 'y' }, u.token);
  assert.equal(r.status, 400);

  r = await post('/api/careers/promote', {}, u.token);
  assert.equal(r.status, 400, 'not eligible');

  r = await post('/api/careers/quit', {}, u.token);
  assert.equal(r.status, 200);
});
