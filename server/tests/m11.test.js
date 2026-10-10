// M11 tests: governance with teeth.
// Winner's policy (meta multipliers, 48h pick window, automatic default,
// expiry on the next tally) + commissioners (appoint/re-appoint/dismiss,
// governor-only gate, chat-badge helper) + election state payload shape.
// INTENTS are invoked directly with a fake api (README contract pattern).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'test-secret-eko-m11';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const E = await import('../src/game/elections.js');
const M11 = await import('../src/game/v2/m11.js');

let app;
const bcast = [];
const news = [];
let pushed = 0;

test.before(async () => {
  app = await createApp();
  await M11.ensureSchema();
});
test.after(async () => {
  await app.close();
});

let n = 0;
async function seedUser() {
  n += 1;
  const username = 'm11u' + n;
  const id = await db.createUser({ username, is_guest: 1 });
  return { id, username };
}
function fakeApi(user, governorId) {
  const errs = [], sent = [];
  const api = {
    conn: {
      user: { id: user.id, username: user.username },
      character: {}, cds: {}, pos: { lat: 50, lng: 50 }, furniture: [],
    },
    send: (c, m) => sent.push(m),
    broadcast: (m) => bcast.push(m),
    youSnapshot: () => ({}),
    err: (t) => errs.push(t),
    commit: async () => {},
    now: Date.now(),
    getDay: () => ({ day: 8, endsIn: 0 }),
    getGovernorId: () => governorId,
    pushNews: (t, x) => news.push({ type: t, text: x }),
    pushElectionAll: async () => { pushed += 1; },
  };
  return { api, errs, sent };
}

let A, B, C;
const DAY = 8;

test('setup: tally → winner set, policy meta reset, 48h window opens', async () => {
  A = await seedUser();
  B = await seedUser();
  C = await seedUser();
  const el = await E.createElection(1, DAY);
  assert.ok(await E.addCandidate(el.id, A.id));
  assert.ok(await E.castVote(el.id, B.id, A.id));
  const res = await E.tallyElection({
    day: DAY,
    broadcast: (m) => bcast.push(m),
    pushNews: (t, x) => news.push({ type: t, text: x }),
  });
  assert.equal(res.winnerId, A.id);
  assert.equal(await E.currentGovernorId(), A.id);
  // all five multipliers reset to 1 on the new term
  const mults = await E.getPolicyMultipliers();
  assert.deepEqual(mults, { wage_mult: 1, tax_mult: 1, event_mult: 1, market_mult: 1, decay_mult: 1 });
  assert.equal(await db.getMeta('gov_policy'), '');
  const wonAt = Number(await db.getMeta('gov_policy_won_at'));
  assert.ok(wonAt > 0 && Date.now() - wonAt < 60000, 'window anchored at tally time');
  // sys + gov announcement went out
  assert.ok(bcast.some(m => m.t === 'sys' && /new Governor/.test(m.text)));
  assert.ok(bcast.some(m => m.t === 'gov' && m.id === A.id));
});

test('gov_policy: governor picks → meta keys written, sys + news broadcast', async () => {
  const { api, errs } = fakeApi(A, A.id);
  const pushedBefore = pushed;
  await M11.INTENTS.gov_policy(api, { policy: 'wage_boost_15' });
  assert.deepEqual(errs, []);
  const mults = await E.getPolicyMultipliers();
  assert.equal(mults.wage_mult, 1.15);
  assert.equal(mults.tax_mult, 1);
  assert.equal(mults.event_mult, 1);
  assert.equal(mults.market_mult, 1);
  assert.equal(mults.decay_mult, 1);
  assert.equal(await db.getMeta('gov_policy'), 'wage_boost_15');
  assert.ok(bcast.some(m => m.t === 'sys' && /Hustle Pay Rise/.test(m.text)), 'sys broadcast names the policy');
  assert.ok(news.some(x => x.type === 'governor' && /Hustle Pay Rise/.test(x.text)), 'news item recorded');
  assert.ok(pushed > pushedBefore, 'fresh election state pushed to everyone');
});

test('gov_policy: non-governor rejected', async () => {
  const { api, errs } = fakeApi(B, A.id);
  await M11.INTENTS.gov_policy(api, { policy: 'tax_free' });
  assert.ok(errs.some(e => /Only the sitting Governor/.test(e)));
  assert.equal(await db.getMeta('gov_policy'), 'wage_boost_15', 'no state change on rejection');
});

test('gov_policy: unknown policy id rejected', async () => {
  const { api, errs } = fakeApi(A, A.id);
  await M11.INTENTS.gov_policy(api, { policy: 'moon_tax' });
  assert.ok(errs.some(e => /Unknown policy/.test(e)));
  // the automatic default is not pickable by hand
  await M11.INTENTS.gov_policy(api, { policy: 'wage_boost_10' });
  assert.ok(errs.some(e => /Unknown policy/.test(e)));
});

test('gov_policy: re-pick inside the 48h window is allowed', async () => {
  const { api, errs } = fakeApi(A, A.id);
  await M11.INTENTS.gov_policy(api, { policy: 'tax_free' });
  assert.deepEqual(errs, []);
  const mults = await E.getPolicyMultipliers();
  assert.equal(mults.tax_mult, 0, 'income tax holiday active');
  assert.equal(mults.wage_mult, 1, 'previous policy fully replaced');
  assert.equal(await db.getMeta('gov_policy'), 'tax_free');
});

test('gov_policy: window closed (48h+) → rejected', async () => {
  await db.setMeta('gov_policy_won_at', String(Date.now() - 49 * 3600 * 1000));
  const { api, errs } = fakeApi(A, A.id);
  await M11.INTENTS.gov_policy(api, { policy: 'market_boom' });
  assert.ok(errs.some(e => /window has closed/.test(e)));
});

test('policy defaults to wage_boost_10 after the 48h timeout', async () => {
  // simulate a term where the winner never picked
  await db.setMeta('gov_policy', '');
  await db.setMeta('gov_policy_picked', '');
  await db.setMeta('gov_policy_won_at', String(Date.now() - 49 * 3600 * 1000));
  const mults = await E.getPolicyMultipliers();
  assert.equal(mults.wage_mult, 1.1, 'default applied lazily on read');
  assert.equal(await db.getMeta('gov_policy'), 'wage_boost_10');
  const st = await E.getPolicyState(A.id, A.id);
  assert.equal(st.id, 'wage_boost_10');
  assert.equal(st.picked, false);
  assert.equal(st.defaulted, true);
  assert.equal(st.can_pick, false, 'window closed → governor can no longer pick');
});

test('new tally expires the policy: keys back to 1, window re-opens', async () => {
  await E.applyPolicy('event_fever'); // an active policy to expire
  const el2 = await E.currentElection();
  assert.ok(el2, 'next cycle was opened by the first tally');
  await E.addCandidate(el2.id, A.id);
  await E.tallyElection({
    day: 15,
    broadcast: (m) => bcast.push(m),
    pushNews: (t, x) => news.push({ type: t, text: x }),
  });
  const mults = await E.getPolicyMultipliers();
  assert.deepEqual(mults, { wage_mult: 1, tax_mult: 1, event_mult: 1, market_mult: 1, decay_mult: 1 });
  assert.equal(await db.getMeta('gov_policy'), '');
  assert.equal(await E.currentGovernorId(), A.id);
  // fresh window: governor can pick again
  const st = await E.getPolicyState(A.id, A.id);
  assert.equal(st.id, null);
  assert.equal(st.can_pick, true);
  assert.ok(st.pick_deadline > Date.now() + 47 * 3600 * 1000, '~48h deadline');
});

test('gov_appoint: appoint → listed; re-appoint replaces holder', async () => {
  const { api, errs } = fakeApi(A, A.id);
  await M11.INTENTS.gov_appoint(api, { username: C.username, title: 'Commissioner for Hustle' });
  assert.deepEqual(errs, []);
  let comms = await E.listCommissioners();
  assert.equal(comms.length, 1);
  assert.equal(comms[0].title, 'Commissioner for Hustle');
  assert.equal(comms[0].username, C.username);
  assert.equal(comms[0].user_id, C.id);
  assert.equal(await E.isCommissioner(C.id), true);
  assert.equal(await E.isCommissioner(B.id), false);
  assert.ok(bcast.some(m => m.t === 'sys' && /Commissioner for Hustle/.test(m.text) && m.text.includes(C.username)));
  // re-appoint the same title → holder replaced, still one row
  await M11.INTENTS.gov_appoint(api, { username: B.username, title: 'Commissioner for Hustle' });
  assert.deepEqual(errs, []);
  comms = await E.listCommissioners();
  assert.equal(comms.length, 1);
  assert.equal(comms[0].username, B.username);
  assert.equal(await E.isCommissioner(B.id), true);
  assert.equal(await E.isCommissioner(C.id), false);
});

test('gov_appoint: validation — unknown user, unknown title, non-governor', async () => {
  const { api, errs } = fakeApi(A, A.id);
  await M11.INTENTS.gov_appoint(api, { username: 'nobody_here_zzz', title: 'Commissioner for Chop' });
  assert.ok(errs.some(e => /No player called/.test(e)));
  await M11.INTENTS.gov_appoint(api, { username: C.username, title: 'Minister of Vibes' });
  assert.ok(errs.some(e => /Unknown commissioner title/.test(e)));
  await M11.INTENTS.gov_appoint(api, { username: '' , title: 'Commissioner for Chop' });
  assert.ok(errs.some(e => /Name the player/.test(e)));
  const b = fakeApi(B, A.id);
  await M11.INTENTS.gov_appoint(b.api, { username: C.username, title: 'Commissioner for Chop' });
  assert.ok(b.errs.some(e => /Only the sitting Governor/.test(e)));
});

test('gov_dismiss: dismiss → seat empty; double-dismiss + non-governor rejected', async () => {
  const { api, errs } = fakeApi(A, A.id);
  await M11.INTENTS.gov_dismiss(api, { title: 'Commissioner for Hustle' });
  assert.deepEqual(errs, []);
  assert.deepEqual(await E.listCommissioners(), []);
  assert.equal(await E.isCommissioner(B.id), false);
  assert.ok(bcast.some(m => m.t === 'sys' && /dismissed the Commissioner for Hustle/.test(m.text)));
  // dismissing an empty seat
  await M11.INTENTS.gov_dismiss(api, { title: 'Commissioner for Hustle' });
  assert.ok(errs.some(e => /already empty/.test(e)));
  // unknown title
  await M11.INTENTS.gov_dismiss(api, { title: 'Oga of Everything' });
  assert.ok(errs.some(e => /Unknown commissioner title/.test(e)));
  // non-governor
  const b = fakeApi(B, A.id);
  await M11.INTENTS.gov_dismiss(b.api, { title: 'Commissioner for Chop' });
  assert.ok(b.errs.some(e => /Only the sitting Governor/.test(e)));
});

test('playerElectionState carries policy + commissioners', async () => {
  const { api } = fakeApi(A, A.id);
  await M11.INTENTS.gov_appoint(api, { username: C.username, title: 'Commissioner for Waka' });
  const st = await E.playerElectionState(A.id, 15, A.id);
  assert.equal(st.active, true);
  assert.ok(st.policy, 'policy payload present');
  assert.equal(st.policy.id, null, 'no policy picked yet this term');
  assert.equal(st.policy.can_pick, true, 'governor may pick inside the window');
  assert.deepEqual(st.policy.mults, { wage_mult: 1, tax_mult: 1, event_mult: 1, market_mult: 1, decay_mult: 1 });
  assert.ok(Array.isArray(st.commissioners));
  const seat = st.commissioners.find(c => c.title === 'Commissioner for Waka');
  assert.ok(seat);
  assert.equal(seat.username, C.username);
  // a regular player cannot pick
  const stB = await E.playerElectionState(B.id, 15, A.id);
  assert.equal(stB.policy.can_pick, false);
});

test('pure helpers: policy/title validation + window math', () => {
  assert.ok(M11.isPickablePolicy('tax_free'));
  assert.ok(M11.isPickablePolicy('soft_life'));
  assert.ok(!M11.isPickablePolicy('wage_boost_10'), 'the automatic default is not hand-pickable');
  assert.ok(!M11.isPickablePolicy('nope'));
  assert.ok(M11.policyWindowOpen(Date.now() - 1000));
  assert.ok(!M11.policyWindowOpen(Date.now() - 49 * 3600 * 1000));
  assert.ok(!M11.policyWindowOpen(0));
  assert.ok(M11.isKnownTitle('Commissioner for Chop'));
  assert.ok(!M11.isKnownTitle('Minister of Vibes'));
  assert.equal(
    M11.policyEffectLine({ wage_mult: 1.15, tax_mult: 1, event_mult: 1, market_mult: 1, decay_mult: 1 }),
    'pay ×1.15');
  assert.equal(
    M11.policyEffectLine({ wage_mult: 1, tax_mult: 0, event_mult: 1, market_mult: 1, decay_mult: 1 }),
    'zero income tax');
  assert.equal(M11.COMMISSIONER_TITLES.length, 6);
  assert.equal(M11.PICKABLE_POLICIES.length, 5);
});
