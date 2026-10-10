// M12 tests: skills (XP/levels, location gates, rust math, xp_boost) +
// academy (lessons, 2/day cap, quiz validation, cert gate boost).
// No WS server needed: INTENTS are invoked with a fake api matching the
// coordinator contract {conn, send, broadcast, youSnapshot, err, commit,
// now, getDay}. Skill persistence uses the in-memory character object
// (the skills/skills_used columns are an INTEGRATION SPEC for the
// coordinator; addSkillXp serializes them the same way either way).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'test-secret-m12';
process.env.EKO_DB_PATH = ':memory:';

const db = await import('../src/db.js');
const m12 = await import('../src/game/v2/m12.js');

test.before(async () => {
  await db.initDb();
  await m12.ensureSchema();
  await m12.ensureSchema(); // idempotent
});

let userN = 0;
async function newUser() {
  userN += 1;
  const userId = await db.createUser({ username: 'm12user' + userN, is_guest: 1 });
  const character = await db.getCharacter(userId);
  return { userId, character };
}

// Fake api honoring the v2 contract. commit() mirrors actions.js semantics:
// clamp stats, floor money, ledger on money moves, save, push `you`.
// Skill state stays on conn.character (in-memory); INTENTS never touch
// numbers they didn't derive themselves.
function fakeApi(character, locationId = 'surulere_stadium') {
  const sent = [];
  character.location_id = locationId;
  const conn = {
    user: { id: character.user_id, username: 'm12user' },
    character,
    cds: {},
    pos: { lat: 20, lng: 58 },
    furniture: [],
  };
  const api = {
    conn,
    send: (c, msg) => sent.push(msg),
    broadcast: () => {},
    youSnapshot: () => ({ money: character.money, energy: character.energy }),
    err: (t) => sent.push({ t: 'err', text: t }),
    commit: async ({ kind = null, amount = 0, meta = null, note = null } = {}) => {
      character.money = Math.max(0, Math.floor(Number(character.money) || 0));
      character.energy = Math.max(0, Math.min(100, Number(character.energy) || 0));
      if (kind && amount) {
        await db.addTransaction(conn.user.id, kind, Math.floor(amount), character.money, meta);
      }
      await db.saveCharacter(character);
      sent.push({ t: 'you', note });
    },
    now: Date.now(),
    getDay: () => ({ day: 1 }),
  };
  return { api, sent, conn };
}
const lastErr = (sent) => sent.filter(m => m.t === 'err').pop();
const notes = (sent) => sent.filter(m => m.t === 'you' && m.note).map(m => m.note);

// ---------------- pure logic ----------------
test('xpForLevel: 100 xp for L0→1, 200 for L1→2', () => {
  assert.equal(m12.xpForLevel(0), 100);
  assert.equal(m12.xpForLevel(1), 200);
  assert.equal(m12.xpForLevel(4), 500);
});

test('nine skills, ids match the M7 contract exactly', () => {
  assert.deepEqual(m12.SKILL_IDS, [
    'cooking', 'charisma', 'fitness', 'coding', 'music',
    'hustle', 'dance', 'comedy', 'photography',
  ]);
});

test('addSkillXp: XP accrues, level-ups carry overflow', () => {
  const { character } = { character: { skills: null, skills_used: null } };
  const r1 = m12.addSkillXp(character, 'fitness', 20);
  assert.equal(r1.leveledUp, false);
  let s = m12.getSkills(character);
  assert.equal(s.fitness.xp, 20);
  assert.equal(s.fitness.level, 0);
  const r2 = m12.addSkillXp(character, 'fitness', 90); // 110 total → L1 + 10 carry
  assert.equal(r2.leveledUp, true);
  s = m12.getSkills(character);
  assert.equal(s.fitness.level, 1);
  assert.equal(s.fitness.xp, 10);
  // unknown skill throws — no partial writes
  assert.throws(() => m12.addSkillXp(character, 'telepathy', 50), /unknown skill/);
});

test('rustLoss: grace 7d, ~1 level per 20d beyond, max 2', () => {
  const now = Date.now();
  const d = 86400000;
  assert.equal(m12.rustLoss(null, now), 0);
  assert.equal(m12.rustLoss(now - 6 * d, now), 0);
  assert.equal(m12.rustLoss(now - 7 * d, now), 1);
  assert.equal(m12.rustLoss(now - 26 * d, now), 1);
  assert.equal(m12.rustLoss(now - 27 * d, now), 2);
  assert.equal(m12.rustLoss(now - 200 * d, now), 2); // capped
});

test('xpBoostMult: defensive — absent/malformed perks never break', () => {
  assert.equal(m12.xpBoostMult({}), 1);
  assert.equal(m12.xpBoostMult({ perks: 'not json' }), 1);
  assert.equal(m12.xpBoostMult({ perks: [{ type: 'xp_boost', pct: 20 }] }), 1.2);
  assert.equal(m12.xpBoostMult({ perks: JSON.stringify([{ type: 'xp_boost', pct: 25 }]) }), 1.25);
  assert.equal(m12.xpBoostMult({ perks: [{ type: 'xp_boost', pct: 999 }] }), 2); // clamped
  assert.equal(m12.xpBoostMult({ perks: [{ type: 'other', pct: 50 }] }), 1);
});

test('quiz data: every course has 3 valid questions', () => {
  assert.equal(m12.COURSES.length, 10);
  for (const c of m12.COURSES) {
    const qs = m12.COURSE_QUIZZES[c.id];
    assert.ok(qs, `quiz missing for ${c.id}`);
    assert.equal(qs.length, 3);
    assert.ok(m12.SKILL_IDS.includes(c.skillBoost.skill));
  }
});

test('quizForClient strips answers (no client trust possible)', () => {
  const qc = m12.quizForClient('yaba_code_bootcamp');
  assert.equal(qc.length, 3);
  for (const q of qc) {
    assert.ok(!('answer' in q), 'answer leaked to client');
    assert.equal(q.options.length, 4);
  }
});

// ---------------- skills intents ----------------
test('skills intent lists 9 skills with xp/level', async () => {
  const { userId, character } = await newUser();
  const { api, sent } = fakeApi(character);
  await m12.INTENTS.skills(api, {});
  const msg = sent.find(m => m.t === 'skills');
  assert.ok(msg);
  assert.equal(msg.skills.length, 9);
  const fit = msg.skills.find(s => s.id === 'fitness');
  assert.equal(fit.level, 0);
  assert.equal(fit.xp, 0);
  assert.equal(fit.xpNext, 100);
  assert.equal(fit.effective, 0);
  assert.equal(fit.trainFee, 0);
  assert.match(fit.trainAt, /stadium/);
});

test('train: grants XP, costs energy, respects location gate', async () => {
  const { userId, character } = await newUser();
  character.energy = 100;
  character.money = 10000;
  // fitness at surulere_stadium (stadium tag) — ok
  let f = fakeApi(character, 'surulere_stadium');
  await m12.INTENTS.train(f.api, { skill: 'fitness' });
  assert.ok(!lastErr(f.sent), `unexpected err: ${lastErr(f.sent)?.text}`);
  assert.equal(character.energy, 100 - m12.SKILL_TUNING.trainEnergy);
  const s = m12.getSkills(character);
  assert.equal(s.fitness.xp, m12.SKILL_TUNING.trainXp);
  assert.match(notes(f.sent)[0], /Fitness \+20 XP/);
  assert.equal(f.conn.character.user_id, userId);

  // coding at a stadium — gated off (needs tech_hub)
  f = fakeApi(character, 'surulere_stadium');
  await m12.INTENTS.train(f.api, { skill: 'coding' });
  assert.match(lastErr(f.sent).text, /tech hubs/i);

  // coding at yaba_hub (tech_hub) — ok, small fee charged + ledger row
  character.energy = 100;
  character.money = 10000;
  f = fakeApi(character, 'yaba_hub');
  await m12.INTENTS.train(f.api, { skill: 'coding' });
  assert.ok(!lastErr(f.sent), `unexpected err: ${lastErr(f.sent)?.text}`);
  assert.equal(character.money, 10000 - 1000);
  // unknown skill id rejected
  f = fakeApi(character, 'yaba_hub');
  await m12.INTENTS.train(f.api, { skill: 'teleportation' });
  assert.match(lastErr(f.sent).text, /real skill/);
});

test('train: cooldown + energy floor enforced', async () => {
  const { character } = await newUser();
  character.energy = 100;
  character.money = 5000;
  const f = fakeApi(character, 'surulere_stadium');
  await m12.INTENTS.train(f.api, { skill: 'fitness' });
  assert.ok(!lastErr(f.sent));
  await m12.INTENTS.train(f.api, { skill: 'fitness' }); // same session cds
  assert.match(lastErr(f.sent).text, /breath/i);

  // energy below cost → rejected before any mutation
  const g = fakeApi(character, 'surulere_stadium');
  character.energy = 5;
  await m12.INTENTS.train(g.api, { skill: 'fitness' });
  assert.match(lastErr(g.sent).text, /tired/);
});

test('train: XP carries to level-up and rust shows on the list', async () => {
  const { character } = await newUser();
  character.energy = 100;
  // five sessions = 100 XP → level 1 (fresh cds each time)
  for (let i = 0; i < 5; i++) {
    character.energy = 100;
    const f = fakeApi(character, 'surulere_stadium');
    await m12.INTENTS.train(f.api, { skill: 'fitness' });
    assert.ok(!lastErr(f.sent));
  }
  assert.equal(m12.getSkills(character).fitness.level, 1);

  // simulate 30 idle days → rust 2 visible in the list, effective floored at 0
  const used = m12.getSkillsUsed(character);
  used.fitness = Date.now() - 30 * 86400000;
  character.skills_used = JSON.stringify(used);
  const f = fakeApi(character, 'surulere_stadium');
  await m12.INTENTS.skills(f.api, {});
  const fit = f.sent.find(m => m.t === 'skills').skills.find(s => s.id === 'fitness');
  assert.equal(fit.rust, 2);
  assert.equal(fit.effective, 0); // 1 base − 2 rust → floor 0
});

// ---------------- academy intents ----------------
test('academy_courses: lists 10 courses with progress + stripped quizzes', async () => {
  const { character } = await newUser();
  const f = fakeApi(character, 'unilag');
  await m12.INTENTS.academy_courses(f.api, {});
  const msg = f.sent.find(m => m.t === 'academy_courses');
  assert.ok(msg);
  assert.equal(msg.courses.length, 10);
  const c0 = msg.courses[0];
  assert.equal(c0.lessonsDone, 0);
  assert.equal(c0.certified, false);
  assert.equal(c0.quizUnlocked, false);
  assert.equal(c0.quiz, null); // no quiz until lessons done
  assert.equal(c0.lessonsLeftToday, 2);
});

test('academy_lesson: campus-only, 2/day cap, fee, instant XP', async () => {
  const { userId, character } = await newUser();
  character.money = 50000;
  // not at a campus → rejected
  let f = fakeApi(character, 'surulere_stadium');
  await m12.INTENTS.academy_lesson(f.api, { course: 'owambe_catering' });
  assert.match(lastErr(f.sent).text, /campus/i);

  // at unilag → lesson 1 works, fee charged, XP granted
  f = fakeApi(character, 'unilag');
  await m12.INTENTS.academy_lesson(f.api, { course: 'owambe_catering' });
  assert.ok(!lastErr(f.sent), `unexpected err: ${lastErr(f.sent)?.text}`);
  assert.equal(character.money, 50000 - 2500);
  assert.equal(m12.getSkills(character).cooking.xp, 60);
  assert.match(notes(f.sent)[0], /lesson 1\/4/);
  let p = await m12.getAcademyProgressFor(userId, 'owambe_catering');
  assert.equal(p.lessons_done, 1);

  // lesson 2 same day ok; lesson 3 hits the 2/day cap
  await m12.INTENTS.academy_lesson(f.api, { course: 'owambe_catering' });
  assert.ok(!lastErr(f.sent));
  await m12.INTENTS.academy_lesson(f.api, { course: 'owambe_catering' });
  assert.match(lastErr(f.sent).text, /Two lessons a day/);
  p = await m12.getAcademyProgressFor(userId, 'owambe_catering');
  assert.equal(p.lessons_done, 2); // cap blocked the third
});

test('academy_quiz: requires all lessons; wrong answers rejected; no forging', async () => {
  const { userId, character } = await newUser();
  character.money = 50000;
  const f = fakeApi(character, 'unilag');
  await m12.INTENTS.academy_lesson(f.api, { course: 'yaba_code_bootcamp' });
  // quiz locked before all lessons done
  await m12.INTENTS.academy_quiz(f.api, { course: 'yaba_code_bootcamp', answers: [1, 1, 1] });
  assert.match(lastErr(f.sent).text, /all 4 lessons/);

  // malformed answer payloads rejected (forgery attempts)
  await m12.INTENTS.academy_quiz(f.api, { course: 'owambe_catering', answers: [0, 0] });
  assert.match(lastErr(f.sent).text, /all 4 lessons/); // lessons gate first
  const answers = m12.COURSE_QUIZZES.owambe_catering.map(q => q.answer);

  // finish all 4 lessons across four simulated days
  for (let i = 0; i < 4; i++) {
    const g = fakeApi(character, 'unilag');
    g.api.now = Date.now() + (i + 1) * 86400000; // next day → fresh daily cap
    await m12.INTENTS.academy_lesson(g.api, { course: 'owambe_catering' });
    assert.ok(!lastErr(g.sent), `lesson failed: ${lastErr(g.sent)?.text}`);
  }
  // quiz now unlocked in the course list
  const h = fakeApi(character, 'unilag');
  await m12.INTENTS.academy_courses(h.api, {});
  const qc = h.sent.find(m => m.t === 'academy_courses').courses.find(c => c.id === 'owambe_catering');
  assert.equal(qc.quizUnlocked, true);
  assert.equal(qc.quiz.length, 3);

  // forged payload shapes rejected before scoring
  for (const bad of [[0, 0], [0, 0, 0, 0], ['a', 'b', 'c'], [0, 0, 9], null]) {
    const g = fakeApi(character, 'unilag');
    await m12.INTENTS.academy_quiz(g.api, { course: 'owambe_catering', answers: bad });
    assert.match(lastErr(g.sent).text, /Answer all 3/, `bad payload accepted: ${JSON.stringify(bad)}`);
  }
  assert.equal(await m12.hasAcademyCert(userId, 'owambe_catering'), false);

  // all-wrong answers → fail + 1h cooldown
  const g = fakeApi(character, 'unilag');
  const wrong = answers.map(a => (a + 1) % 4);
  await m12.INTENTS.academy_quiz(g.api, { course: 'owambe_catering', answers: wrong });
  assert.ok(!lastErr(g.sent), `unexpected err: ${lastErr(g.sent)?.text}`);
  assert.match(notes(g.sent)[0], /failed \(0\/3\)/);
  assert.equal(await m12.hasAcademyCert(userId, 'owambe_catering'), false);
  // immediate retry blocked by cooldown
  await m12.INTENTS.academy_quiz(g.api, { course: 'owambe_catering', answers });
  assert.match(lastErr(g.sent).text, /cooldown/i);
});

test('academy_quiz: pass (≥2/3) → certificate + XP chunk + gate boost', async () => {
  const { userId, character } = await newUser();
  character.money = 60000;
  // 4 lessons over 2 days
  for (let i = 0; i < 4; i++) {
    const g = fakeApi(character, 'unilag');
    if (i >= 2) g.api.now = Date.now() + 86400000;
    await m12.INTENTS.academy_lesson(g.api, { course: 'danfo_logistics' });
    assert.ok(!lastErr(g.sent), `lesson failed: ${lastErr(g.sent)?.text}`);
  }
  const totalXpOf = (lvl, xp) => { let t = xp; for (let l = 0; l < lvl; l++) t += m12.xpForLevel(l); return t; };
  const beforeS = m12.getSkills(character).hustle;
  const xpBefore = totalXpOf(beforeS.level, beforeS.xp);
  const g = fakeApi(character, 'unilag');
  const answers = m12.COURSE_QUIZZES.danfo_logistics.map(q => q.answer);
  await m12.INTENTS.academy_quiz(g.api, { course: 'danfo_logistics', answers });
  assert.ok(!lastErr(g.sent), `unexpected err: ${lastErr(g.sent)?.text}`);
  assert.match(notes(g.sent)[0], /CERTIFIED/);
  assert.equal(await m12.hasAcademyCert(userId, 'danfo_logistics'), true);
  const afterS = m12.getSkills(character).hustle;
  const gained = totalXpOf(afterS.level, afterS.xp) - xpBefore;
  assert.ok(gained >= m12.SKILL_TUNING.certXp, `expected ≥${m12.SKILL_TUNING.certXp} xp, got ${gained}`);
  // cert shows in course list; quiz can no longer be retaken
  const h = fakeApi(character, 'unilag');
  await m12.INTENTS.academy_courses(h.api, {});
  const c0 = h.sent.find(m => m.t === 'academy_courses').courses.find(c => c.id === 'danfo_logistics');
  assert.equal(c0.certified, true);
  await m12.INTENTS.academy_quiz(h.api, { course: 'danfo_logistics', answers });
  assert.match(lastErr(h.sent).text, /already hold/);
});

test('skillLevel: cert adds +1 effective level for M7 gates (capped)', async () => {
  const { userId, character } = await newUser();
  const certs = await m12.getAcademyCerts(userId);
  assert.equal(m12.skillLevel(character, 'coding', certs), 0);
  // grant coding cert courses without playing the flow
  await (await import('../src/db.js')).dbRun(
    'INSERT INTO academy_certs (user_id, course_id, awarded_at) VALUES (?, ?, ?)',
    'INSERT INTO academy_certs (user_id, course_id, awarded_at) VALUES ($1, $2, $3)',
    [userId, 'yaba_code_bootcamp', Date.now()],
  );
  const certs2 = await m12.getAcademyCerts(userId);
  assert.deepEqual(certs2, ['yaba_code_bootcamp']);
  assert.equal(m12.skillLevel(character, 'coding', certs2), 1); // 0 base + 1 cert
  assert.equal(m12.skillLevel(character, 'music', certs2), 0); // unrelated skill unaffected
  // base level 2 + cert → 3
  m12.addSkillXp(character, 'coding', 400); // 100+200 → L2, 100 carry
  assert.equal(m12.getSkills(character).coding.level, 2);
  assert.equal(m12.skillLevel(character, 'coding', certs2), 3);
});

test('effectiveSkillLevels: every skill resolved in one call', async () => {
  const { userId, character } = await newUser();
  const eff = m12.effectiveSkillLevels(character, await m12.getAcademyCerts(userId));
  assert.equal(Object.keys(eff).length, 9);
  assert.ok(Object.values(eff).every(v => v === 0));
});

test('economy invariant: money never negative, ledger on fee moves', async () => {  const { character } = await newUser();
  character.money = 100; // cannot afford the ₦1000 coding fee
  character.energy = 100;
  const f = fakeApi(character, 'yaba_hub');
  await m12.INTENTS.train(f.api, { skill: 'coding' });
  assert.match(lastErr(f.sent).text, /costs/);
  assert.ok(character.money >= 0);

  character.money = 5000;
  const g = fakeApi(character, 'yaba_hub');
  await m12.INTENTS.train(g.api, { skill: 'coding' });
  const rows = await db.dbAll(
    'SELECT kind, amount FROM transactions WHERE user_id = ? AND kind = ?',
    'SELECT kind, amount FROM transactions WHERE user_id = $1 AND kind = $2',
    [g.conn.user.id, 'skill_train'],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, -1000);
});

test('m12YouSnapshot: skills + academy parts for the you snapshot', async () => {
  const { userId, character } = await newUser();
  character.money = 60000;
  m12.addSkillXp(character, 'cooking', 120); // → level 1, xp 20
  const conn = { user: { id: userId }, character };
  const snap = await m12.m12YouSnapshot(conn);
  assert.equal(snap.skills.length, 9);
  const cooking = snap.skills.find(s => s.id === 'cooking');
  assert.equal(cooking.level, 1);
  assert.equal(cooking.xp, 20);
  assert.equal(cooking.effective, 1);
  assert.equal(snap.academy.length, 10);
  const c0 = snap.academy.find(c => c.id === 'owambe_catering');
  assert.equal(c0.lessonsDone, 0);
  assert.equal(c0.quiz, null);
  assert.equal(c0.feePerLesson, 2500);
});
