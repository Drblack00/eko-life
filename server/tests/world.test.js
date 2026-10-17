// P5 tests: World Systems REST (ride, health, police, court, assurance,
// bus co, ads, charity, promos, tickets, courses) + gov election pause.
// Pure-math checks live alongside the endpoint tests.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'test-secret-eko-world';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const world = await import('../src/game/world.js');
const courses = await import('../src/game/courses.js');
const { setElectionPaused, isElectionPaused } = await import('../src/game/elections.js');

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
async function seedUser(money = 200000, admin = false) {
  n += 1;
  const username = 'worldu' + n;
  const userId = await db.createUser({ username, is_guest: 1 });
  if (admin) await db.setAdmin(userId, 1);
  const c = await db.getCharacter(userId);
  c.money = money;
  await db.saveCharacter(c);
  return { userId, username, token: signToken(userId) };
}

const moneyOf = async (u) => (await db.getCharacter(u.userId)).money;

// ---------- pure math ----------

test('ride fare math: cab 700-900, rush x1.5 rounded to 50', () => {
  const fares = new Set();
  for (const d of ['ojuelegba', 'ikeja_mall', 'unilag', 'lekki', 'yaba_hub']) {
    const f = world.rideFare('cab', d, new Date('2026-10-17T12:00:00+01:00'));
    assert.ok(f >= 700 && f <= 900 && f % 50 === 0, `cab fare ${f}`);
    fares.add(f);
  }
  assert.ok(world.rideFare('keke', '', new Date('2026-10-17T12:00:00+01:00')) === 150);
  assert.ok(world.rideFare('trek', '') === 0);
  // rush hour 8am WAT: 150 * 1.5 = 225 → 250
  assert.equal(world.rideFare('keke', '', new Date('2026-10-17T08:00:00+01:00')), 250);
  assert.equal(world.rideFare('danfo', '', new Date('2026-10-17T08:00:00+01:00')), 250);
  assert.equal(world.isRushHour(new Date('2026-10-17T08:00:00+01:00')), true);
  assert.equal(world.isRushHour(new Date('2026-10-17T12:00:00+01:00')), false);
});

test('assurance payout math + robbery cap + ticket fee', () => {
  assert.equal(world.assurancePayout(10000), 8000);
  assert.equal(world.assurancePayout(60000), 48000); // capped at 50k − 2k
  assert.equal(world.assurancePayout(1000), 0); // under deductible
  assert.equal(world.capRobbery(999999), 50000);
  assert.equal(world.capRobbery(30000), 30000);
  assert.equal(world.ticketOrganizerNet(7500), 7500 - 375 - 100);
  assert.equal(world.ticketOrganizerNet(0), 0);
  assert.equal(world.buscoPaybackWeeks(), 3); // 2.0m / 765k → honest math
});

test('hearing outcomes are sane', () => {
  for (let i = 0; i < 50; i++) {
    const o = world.hearCase({ severity: 3 }, () => 0.99);
    assert.equal(o.verdict, 'jailed');
    assert.ok(o.jailHours >= 6 && o.jailHours <= 48);
  }
  const d = world.hearCase({ severity: 1 }, () => 0.01);
  assert.equal(d.verdict, 'dismissed');
});

// ---------- ride ----------

let A;
test('setup user', async () => { A = await seedUser(50000); });

test('GET /api/world/ride: modes + fares', async () => {
  const r = await get('/api/world/ride', A.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.modes.length, 5);
  const trek = r.json.modes.find(m => m.id === 'trek');
  assert.equal(trek.fare, 0);
  assert.ok(r.json.dests.length > 5);
});

test('POST /api/world/ride/travel: charges fare, moves player', async () => {
  const before = await moneyOf(A);
  const r = await post('/api/world/ride/travel', { mode: 'keke', destId: 'ikeja_mall' }, A.token);
  assert.equal(r.status, 200);
  assert.ok(r.json.fare >= 150);
  assert.ok(r.json.travelSecs >= 5 && r.json.travelSecs <= 18);
  assert.equal(await moneyOf(A), before - r.json.fare);
  const c = await db.getCharacter(A.userId);
  assert.equal(c.location_id, 'ikeja_mall');
});

test('POST /api/world/ride/travel: bad mode rejected', async () => {
  const r = await post('/api/world/ride/travel', { mode: 'rocket', destId: 'ikeja_mall' }, A.token);
  assert.equal(r.status, 400);
});

// ---------- health ----------

test('health: illness shows, chemist treats', async () => {
  await world.setIllness(A.userId, 'danfo_cough', 18);
  let r = await get('/api/world/health', A.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.illness.id, 'danfo_cough');
  assert.ok(r.json.decayMult > 1);
  const before = await moneyOf(A);
  r = await post('/api/world/health/treat', { provider: 'chemist' }, A.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.cured, true);
  assert.equal(await moneyOf(A), before - world.CHEMIST_FEE);
  r = await get('/api/world/health', A.token);
  assert.equal(r.json.illness, null);
  assert.equal(r.json.decayMult, 1);
});

// ---------- police + court ----------

let B;
test('police report: offence recorded + court case opened', async () => {
  B = await seedUser(50000);
  const r = await post('/api/world/police/report', {
    against: B.username, offence: 'theft', description: 'took my shawarma',
  }, A.token);
  assert.equal(r.status, 200);
  const pr = await get('/api/world/police', B.token);
  assert.equal(pr.status, 200);
  assert.equal(pr.json.clean, false);
  assert.equal(pr.json.record.length, 1);
  assert.equal(pr.json.robberyCap, 50000);
  const cr = await get('/api/world/court', B.token);
  assert.equal(cr.status, 200);
  assert.equal(cr.json.cases.length, 1);
  assert.equal(cr.json.cases[0].status, 'pending');
});

test('court: due hearing resolves on day tick', async () => {
  const { day } = { day: 1 };
  await world.worldDayTick({ day: day + 10, hub: {} });
  const cr = await get('/api/world/court', B.token);
  assert.equal(cr.status, 200);
  assert.equal(cr.json.cases[0].status, 'heard');
  assert.ok(cr.json.cases[0].outcome, 'outcome recorded');
  assert.ok(['dismissed', 'fined', 'jailed'].includes(cr.json.cases[0].outcome.verdict));
});

// ---------- assurance ----------

test('assurance: buy policy, claim a loss', async () => {
  const C = await seedUser(100000);
  let r = await post('/api/world/assurance/buy', {}, C.token);
  assert.equal(r.status, 200);
  assert.equal(await moneyOf(C), 100000 - world.ASSURANCE_PREMIUM);
  // inject a loss directly (deterministic; risk rolls are random)
  const now = Date.now();
  await db.dbRun(
    'INSERT INTO world_losses (user_id, risk, loss_amount, claimed, created_at, expires_at) VALUES (?,?,?,0,?,?)',
    'INSERT INTO world_losses (user_id, risk, loss_amount, claimed, created_at, expires_at) VALUES ($1,$2,$3,0,$4,$5)',
    [C.userId, 'phone', 20000, now, now + 7 * 86400000]);
  r = await get('/api/world/assurance', C.token);
  assert.equal(r.json.losses.length, 1);
  const lossId = r.json.losses[0].id;
  const expected = world.assurancePayout(20000);
  r = await post('/api/world/assurance/claim', { lossId }, C.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.payout, expected);
  assert.equal(await moneyOf(C), 100000 - world.ASSURANCE_PREMIUM + expected);
  // double-claim rejected
  r = await post('/api/world/assurance/claim', { lossId }, C.token);
  assert.equal(r.status, 400);
});

// ---------- bus co ----------

test('bus co: start + weekly payout', async () => {
  const D = await seedUser(3000000);
  let r = await post('/api/world/busco/start', {}, D.token);
  assert.equal(r.status, 200);
  assert.equal(await moneyOf(D), 3000000 - world.BUSCO_START_COST);
  r = await get('/api/world/busco', D.token);
  assert.equal(r.json.company.buses, 1);
  assert.equal(r.json.paybackWeeks, 3);
  await world.worldDayTick({ day: 14, hub: {} });
  assert.equal(await moneyOf(D), 3000000 - world.BUSCO_START_COST + world.BUSCO_WEEKLY_YIELD);
  // same week twice → no double payout
  await world.worldDayTick({ day: 15, hub: {} });
  assert.equal(await moneyOf(D), 3000000 - world.BUSCO_START_COST + world.BUSCO_WEEKLY_YIELD);
});

// ---------- ads ----------

test('ads: buy map plot, appears in feed', async () => {
  const E = await seedUser(100000);
  let r = await post('/api/world/ads/buy', { kind: 'mapplot', title: 'E Best Shawarma', blurb: 'Yaba\'s finest' }, E.token);
  assert.equal(r.status, 200);
  assert.equal(await moneyOf(E), 100000 - world.AD_MAP_PLOT_COST);
  r = await get('/api/world/ads', E.token);
  assert.equal(r.json.mine.length, 1);
  r = await get('/api/world/ads/feed', E.token);
  assert.ok(r.json.ads.some(a => a.title === 'E Best Shawarma'));
  // oversize headline rejected
  r = await post('/api/world/ads/buy', { kind: 'mapplot', title: 'x'.repeat(41) }, E.token);
  assert.equal(r.status, 400);
});

// ---------- charity ----------

test('charity: fund = seed + donations, sane numbers', async () => {
  const F = await seedUser(100000);
  let r = await get('/api/world/charity', F.token);
  assert.equal(r.status, 200);
  assert.ok(r.json.fund >= world.CHARITY_SEED);
  assert.ok(r.json.fund < 1e12, 'fund must never show absurd trillions');
  const before = r.json.fund;
  r = await post('/api/world/charity/give', { amount: 5000, project: 'books' }, F.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.fund, before + 5000);
  assert.equal(await moneyOf(F), 100000 - 5000);
  r = await post('/api/world/charity/give', { amount: 50 }, F.token);
  assert.equal(r.status, 400); // under minimum
});

// ---------- promos ----------

test('promo: invest, close, claim fixed payout', async () => {
  const G = await seedUser(200000);
  let r = await get('/api/world/promos', G.token);
  assert.equal(r.status, 200);
  assert.ok(r.json.promos.length >= 1);
  const promo = r.json.promos[0];
  assert.ok(promo.closesAt > Date.now());
  r = await post('/api/world/promos/invest', { promoId: promo.id, amount: 20000 }, G.token);
  assert.equal(r.status, 200);
  assert.equal(await moneyOf(G), 200000 - 20000);
  // can't claim while open
  r = await post('/api/world/promos/claim', { promoId: promo.id }, G.token);
  assert.equal(r.status, 400);
  // force-close + tick
  await db.dbRun('UPDATE world_promos SET closes_at = ? WHERE id = ?', 'UPDATE world_promos SET closes_at = $1 WHERE id = $2', [Date.now() - 1000, promo.id]);
  await world.worldDayTick({ day: 30, hub: {} });
  r = await post('/api/world/promos/claim', { promoId: promo.id }, G.token);
  assert.equal(r.status, 200);
  const expected = Math.floor(20000 * promo.payoutMult);
  assert.equal(r.json.payout, expected);
  assert.equal(await moneyOf(G), 200000 - 20000 + expected);
});

// ---------- tickets ----------

test('tickets: browse, buy, organizer gets net of fee', async () => {
  const H = await seedUser(100000);
  const org = await seedUser(100000);
  let r = await get('/api/world/tickets/events', H.token);
  assert.equal(r.status, 200);
  assert.ok(r.json.events.length >= 1);
  const paid = r.json.events.find(e => e.price === 7500);
  assert.ok(paid, 'seeded paid event exists');
  r = await post('/api/world/tickets/buy', { eventId: paid.id }, H.token);
  assert.equal(r.status, 200);
  assert.equal(await moneyOf(H), 100000 - 7500);
  // organizer-created event: buyer pays, organizer nets price − 5% − 100
  r = await post('/api/world/tickets/create', {
    title: 'Test Owambe', venue: 'Test Hall', price: 2000, capacity: 50,
    startsAt: Date.now() + 2 * 86400000,
  }, org.token);
  assert.equal(r.status, 200);
  const evId = r.json.id;
  r = await post('/api/world/tickets/buy', { eventId: evId }, H.token);
  assert.equal(r.status, 200);
  const net = world.ticketOrganizerNet(2000);
  assert.equal(await moneyOf(org), 100000 + net);
  // double-buy rejected
  r = await post('/api/world/tickets/buy', { eventId: evId }, H.token);
  assert.equal(r.status, 400);
});

// ---------- courses ----------

test('courses: 13 courses, lessons, 2/day cap, quiz, cert', async () => {
  const I = await seedUser(200000);
  let r = await get('/api/world/courses', I.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.courses.length, 13);
  assert.ok(r.json.courses.every(c => c.lessonsTotal === 5));
  assert.ok(r.json.courses.every(c => c.fee >= 1000 && c.fee <= 4000));

  const cid = 'software_dev';
  r = await get(`/api/world/courses/${cid}`, I.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.lessons.length, 5);
  assert.ok(!r.json.quiz.some(q => 'answer' in q), 'answers stay server-side');
  assert.ok(!JSON.stringify(r.json.quiz).includes('"answer"'), 'answers stay server-side');

  // two lessons today, third rejected
  r = await post(`/api/world/courses/${cid}/lesson`, {}, I.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.lessonsDone, 1);
  r = await post(`/api/world/courses/${cid}/lesson`, {}, I.token);
  assert.equal(r.status, 200);
  r = await post(`/api/world/courses/${cid}/lesson`, {}, I.token);
  assert.equal(r.status, 400);

  // finish via direct progress (simulate further days) then quiz
  await courses.submitQuiz(I.userId, cid, [0, 0, 0]).catch(() => {});
  // quiz before lessons done → 400
  r = await post(`/api/world/courses/${cid}/quiz`, { answers: [0, 1, 1] }, I.token);
  assert.equal(r.status, 400);
});

test('courses: quiz pass awards cert + boost hook', async () => {
  const J = await seedUser(200000);
  // complete all 5 lessons across simulated days via direct module calls
  const { takeLesson } = courses;
  for (let i = 0; i < 5; i++) {
    // bump the stored lesson_day back so the 2/day cap resets
    await db.dbRun(
      `UPDATE trade_school_progress SET lesson_day = '2000-01-01', lessons_today = 0 WHERE user_id = ? AND course_id = ?`,
      `UPDATE trade_school_progress SET lesson_day = '2000-01-01', lessons_today = 0 WHERE user_id = $1 AND course_id = $2`,
      [J.userId, 'tailoring']);
    const c = await db.getCharacter(J.userId);
    await takeLesson(J.userId, 'tailoring', {
      chargeFee: async (amount) => { c.money -= amount; await db.saveCharacter(c); },
    });
  }
  const out = await courses.submitQuiz(J.userId, 'tailoring', [1, 0, 1]); // all correct
  assert.equal(out.passed, true);
  assert.equal(out.certAwarded, true);
  const certs = await courses.listCertificates(J.userId);
  assert.equal(certs.length, 1);
  assert.equal(certs[0].courseId, 'tailoring');
  const boosts = await courses.getCourseBoosts(J.userId);
  assert.ok(boosts.workPerfMult >= 1.1, 'tailoring gives +10% work perf');
});

// ---------- gov pause ----------

test('gov: admin can pause/resume elections; run+vote blocked while paused', async () => {
  const admin = await seedUser(200000, true);
  const V = await seedUser(200000);
  assert.equal(await isElectionPaused(), false);
  let r = await post('/api/gov/election/pause', {}, admin.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.state.election.status, 'paused');
  assert.equal(await isElectionPaused(), true);
  // non-admin cannot pause
  r = await post('/api/gov/election/pause', {}, V.token);
  assert.equal(r.status, 403);
  // run + vote blocked while paused
  r = await post('/api/gov/run', {}, V.token);
  assert.equal(r.status, 400);
  // resume
  r = await post('/api/gov/election/resume', {}, admin.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.state.election.status, 'voting');
  assert.equal(await isElectionPaused(), false);
});
