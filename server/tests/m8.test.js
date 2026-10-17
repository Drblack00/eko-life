// M8 tests: six needs + moodlets + city events.
// Pure decay math (from v2/m8.js — the sim.js replacement), moodlet
// storage round-trips + expiry, city-event broadcast, wash/toilet
// intents, and anti-cheat (forged client values ignored).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'test-secret-eko-m8';
process.env.EKO_DB_PATH = ':memory:';

const db = await import('../src/db.js');
const m8 = await import('../src/game/v2/m8.js');
const { clamp } = await import('../src/game/sim.js');

const {
  decayTick, DECAY_RATES, collectEffects, decayMultiplier,
  ensureSchema, addMoodlet, listActiveMoodlets, pruneMoodlets,
  addCityEvent, listActiveCityEvents, pruneCityEvents,
  triggerMoodlet, MOODLET_TRIGGERS, CITY_EVENTS, maybeCityEvent,
  onTickMinute, INTENTS, REST_SPEC, CONFIG_DATA,
} = m8;

test.before(async () => {
  await db.initDb();
  await ensureSchema();
});

function freshChar() {
  return {
    user_id: 0,
    hunger: 100, energy: 100, fun: 100, social: 100, hygiene: 100, bladder: 100,
    happiness: 100, health: 100, money: 5000, location_id: 'mende_villa',
  };
}

// ---- decay math (PORT-P1: timestamp-based slow decay) ----

test('decayTick: ~1–2 pts per 15 real minutes (timestamp-based)', () => {
  const c = freshChar();
  const t0 = Date.now();
  decayTick(c, { moodlets: [], perks: [] }, t0);
  assert.equal(c.hunger, 100); // 60s is a fraction of a point — nothing whole yet
  assert.ok(c.needs_at === t0, 'needs_at marker recorded');
  const flags = decayTick(c, { moodlets: [], perks: [] }, t0 + 15 * 60 * 1000);
  assert.equal(c.hunger, 100 - DECAY_RATES.hunger); // 2
  assert.equal(c.energy, 100 - DECAY_RATES.energy); // 1
  assert.equal(c.fun, 100 - DECAY_RATES.fun);
  assert.equal(c.social, 100 - DECAY_RATES.social);
  assert.equal(c.hygiene, 100 - DECAY_RATES.hygiene);
  assert.equal(c.bladder, 100 - DECAY_RATES.bladder); // 2
  assert.equal(flags.starving, false);
  assert.equal(flags.desperate, false);
  assert.equal(c.happiness, 100); // no cascade while needs are healthy
  assert.equal(c.health, 100);
});

test('decayTick: fractional points accumulate across ticks', () => {
  const c = freshChar();
  const t0 = Date.now();
  // 7 × 60s ticks ≈ 7 min → hunger loses ~0.93 pts → still 100, then 1 more tick crosses 1
  for (let i = 1; i <= 8; i++) decayTick(c, { moodlets: [], perks: [] }, t0 + i * 60 * 1000);
  assert.equal(c.hunger, 99);
  assert.equal(c.energy, 100); // 8/15 of a point — not yet whole
});

test('decayTick: offline catch-up capped at 1h', () => {
  const c = freshChar();
  const t0 = Date.now();
  c.needs_at = t0 - 48 * 3600 * 1000; // last tick 2 days "ago"
  decayTick(c, { moodlets: [], perks: [] }, t0);
  // capped at 1h = 4 × 15min windows → hunger loses 8, not 384
  assert.equal(c.hunger, 100 - 4 * DECAY_RATES.hunger);
});

test('decayTick: decay_slow perk halves the drain', () => {
  const c = freshChar();
  const t0 = Date.now();
  const perks = [{ type: 'decay_slow', need: 'hunger', pct: 50 }];
  decayTick(c, { moodlets: [], perks }, t0); // prime needs_at
  decayTick(c, { moodlets: [], perks }, t0 + 15 * 60 * 1000);
  assert.equal(c.hunger, 100 - Math.floor(DECAY_RATES.hunger * 0.5));
  assert.equal(c.energy, 100 - DECAY_RATES.energy); // other needs unaffected
});

test('decayTick: documented rates are sane (1–2 pts per 15 min)', () => {
  for (const [need, rate] of Object.entries(DECAY_RATES)) {
    assert.ok(rate >= 1 && rate <= 2, `${need} rate ${rate} out of 1–2/15min range`);
  }
});

test('decayTick: starvation cascade unchanged (hunger 0 → energy/happiness/health)', () => {
  const c = freshChar();
  c.hunger = 2;
  const t0 = Date.now();
  decayTick(c, { moodlets: [], perks: [] }, t0); // prime needs_at
  const flags = decayTick(c, { moodlets: [], perks: [] }, t0 + 15 * 60 * 1000);
  assert.equal(c.hunger, 0);
  assert.equal(flags.starving, true);
  assert.equal(c.energy, 100 - DECAY_RATES.energy - 5);
  assert.equal(c.happiness, 100 - 5);
  assert.equal(c.health, 100 - 2);
});

test('decayTick: bladder at 0 drags happiness + hygiene (desperate cascade)', () => {
  const c = freshChar();
  c.bladder = 2;
  const t0 = Date.now();
  decayTick(c, { moodlets: [], perks: [] }, t0); // prime needs_at
  const flags = decayTick(c, { moodlets: [], perks: [] }, t0 + 15 * 60 * 1000);
  assert.equal(c.bladder, 0);
  assert.equal(flags.desperate, true);
  assert.equal(c.happiness, 100 - 5);
  // hygiene decays 1 then takes the −10 accident hit
  assert.equal(c.hygiene, 100 - DECAY_RATES.hygiene - 10);
});

test('decayTick: hygiene/social/fun at 0 drag happiness (grimy/lonely/bored cascades)', () => {
  const c = freshChar();
  c.hygiene = 1; c.social = 1; c.fun = 1;
  const t0 = Date.now();
  decayTick(c, { moodlets: [], perks: [] }, t0); // prime needs_at
  const flags = decayTick(c, { moodlets: [], perks: [] }, t0 + 15 * 60 * 1000);
  assert.equal(flags.grimy, true);
  assert.equal(flags.lonely, true);
  assert.equal(flags.bored, true);
  assert.equal(c.happiness, 100 - 3 - 3 - 2);
  assert.equal(c.health, 100 - 1); // grimy health hit
  assert.equal(c.energy, 100 - DECAY_RATES.energy - 1); // boredom drains
});

test('decayTick: decay_slow moodlet slows one need', () => {
  const c = freshChar();
  const mods = { moodlets: [{ effects: [{ type: 'decay_slow', need: 'bladder', pct: 50 }] }], perks: [] };
  const t0b = Date.now();
  decayTick(c, mods, t0b); // prime needs_at
  decayTick(c, mods, t0b + 15 * 60 * 1000);
  assert.equal(c.bladder, 100 - 1); // 2 * 0.5
  assert.equal(c.hunger, 100 - DECAY_RATES.hunger); // others unaffected
});

test('decayTick: decay_all perk slows every need', () => {
  const c = freshChar();
  const mods = { moodlets: [], perks: [{ type: 'decay_all', pct: 50 }] };
  const t0c = Date.now();
  decayTick(c, mods, t0c); // prime needs_at
  decayTick(c, mods, t0c + 15 * 60 * 1000);
  assert.equal(c.bladder, 100 - 1);
  assert.equal(c.hunger, 100 - 1); // floor(2 × 0.5)
});

test('decayTick: decay_slow + decay_all stack multiplicatively', () => {
  const mult = decayMultiplier('hunger', [
    { type: 'decay_slow', need: 'hunger', pct: 50 },
    { type: 'decay_all', pct: 20 },
  ]);
  assert.ok(Math.abs(mult - 0.5 * 0.8) < 1e-9);
});

test('decayTick: stat_drain / stat_boost applied per call', () => {
  const c = freshChar();
  c.energy = 90; c.happiness = 90;
  const mods = {
    moodlets: [{ effects: [
      { type: 'stat_drain', stat: 'happiness', amount: 5 },
      { type: 'stat_boost', stat: 'energy', amount: 3 },
    ] }],
    perks: [],
  };
  decayTick(c, mods); // single 60s call: no whole-point need decay, moodlet shifts apply
  assert.equal(c.happiness, 85);
  assert.equal(c.energy, 93);
});

test('decayTick: unknown/malformed effects are ignored defensively', () => {
  const c = freshChar();
  c.money = 1234;
  const mods = {
    moodlets: [{ effects: [
      { type: 'decay_slow', need: 'nonsense', pct: 25 },
      { type: 'bogus', need: 'hunger', pct: 99 },
      { type: 'stat_drain', stat: 'money', amount: 100 },
      { type: 'stat_drain', stat: 'happiness', amount: 'lots' },
      null, 'junk', 42,
    ] }],
    perks: [null],
  };
  const t0d = Date.now();
  decayTick(c, mods, t0d); // prime needs_at
  decayTick(c, mods, t0d + 15 * 60 * 1000);
  assert.equal(c.hunger, 100 - DECAY_RATES.hunger);
  assert.equal(c.money, 1234); // money is never a moodlet stat
  assert.equal(c.happiness, 100);
});

test('decayTick: missing new-need fields default full-ish (pre-M8 rows)', () => {
  const c = { hunger: 100, energy: 100, happiness: 100, health: 100 }; // no fun/social/hygiene/bladder
  decayTick(c); // single 60s call: normalizes, no whole-point decay yet
  assert.equal(c.fun, 100);
  assert.equal(c.bladder, 100);
});

test('decayTick: negative stats clamp to 0 (anti-cheat floor)', () => {
  const c = freshChar();
  c.fun = -30; c.bladder = -5;
  decayTick(c);
  assert.equal(c.fun, 0);
  assert.equal(c.bladder, 0);
});

// ---- moodlet storage ----

let userN = 0;
async function seedUser() {
  userN += 1;
  const id = await db.createUser({ username: 'm8u' + userN, is_guest: 1 });
  const c = await db.getCharacter(id);
  return { id, char: c };
}

test('moodlets: add → list round-trip; same key replaces', async () => {
  const { id } = await seedUser();
  await addMoodlet(id, { key: 'suya_spice_rush', label: 'Suya Spice Rush', effects: [{ type: 'stat_boost', stat: 'happiness', amount: 2 }], ttlMs: 60000 });
  let list = await listActiveMoodlets(id);
  assert.equal(list.length, 1);
  assert.equal(list[0].key, 'suya_spice_rush');
  assert.deepEqual(list[0].effects, [{ type: 'stat_boost', stat: 'happiness', amount: 2 }]);
  assert.equal(list[0].citywide, false);
  assert.ok(list[0].expires_at > Date.now());
  // same key → replace, not duplicate
  await addMoodlet(id, { key: 'suya_spice_rush', label: 'Suya Spice Rush v2', effects: [], ttlMs: 60000 });
  list = await listActiveMoodlets(id);
  assert.equal(list.length, 1);
  assert.equal(list[0].label, 'Suya Spice Rush v2');
});

test('moodlets: expired rows are excluded and pruned', async () => {
  const { id } = await seedUser();
  await db.dbRun(
    `INSERT INTO moodlets (user_id, key, label, effects_json, expires_at, created_at) VALUES (?,?,?,?,?,?)`,
    `INSERT INTO moodlets (user_id, key, label, effects_json, expires_at, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, 'stale', 'Stale', '[]', Date.now() - 1000, Date.now() - 2000]
  );
  await addMoodlet(id, { key: 'fresh', label: 'Fresh', effects: [], ttlMs: 60000 });
  let list = await listActiveMoodlets(id);
  assert.ok(list.every(m => m.key !== 'stale'));
  assert.ok(list.some(m => m.key === 'fresh'));
  await pruneMoodlets();
  list = await listActiveMoodlets(id);
  assert.ok(list.every(m => m.key !== 'stale'));
});

test('triggerMoodlet: registry key applies the moodlet; unknown key is a no-op', async () => {
  const { id } = await seedUser();
  const note = await triggerMoodlet(id, 'payday_groove');
  assert.ok(typeof note === 'string' && note.length > 0);
  const list = await listActiveMoodlets(id);
  const m = list.find(x => x.key === 'payday_groove');
  assert.ok(m);
  assert.equal(m.label, MOODLET_TRIGGERS.payday_groove.label);
  const noop = await triggerMoodlet(id, 'no_such_key');
  assert.equal(noop, null);
  assert.equal((await listActiveMoodlets(id)).length, 1);
});

test('moodlet triggers: all registry entries are well-formed', () => {
  const keys = Object.keys(MOODLET_TRIGGERS);
  assert.ok(keys.length >= 8, `expected ≥8 moodlets, got ${keys.length}`);
  for (const [k, t] of Object.entries(MOODLET_TRIGGERS)) {
    assert.ok(t.label && t.label.length > 0, `${k}: label`);
    assert.ok(Array.isArray(t.effects) && t.effects.length > 0, `${k}: effects`);
    assert.ok(t.ttlMs > 0, `${k}: ttlMs`);
    // every effect must survive the defensive decayTick path
    const c = freshChar();
    decayTick(c, { moodlets: [{ effects: t.effects }], perks: [] });
  }
});

// ---- city events ----

test('city events: catalog has 2–3 original events with valid effects', () => {
  assert.ok(CITY_EVENTS.length >= 2 && CITY_EVENTS.length <= 4);
  const keys = new Set();
  for (const e of CITY_EVENTS) {
    assert.ok(!keys.has(e.key), `duplicate key ${e.key}`);
    keys.add(e.key);
    assert.ok(e.text && e.text.length > 20, `${e.key}: news-worthy text`);
    const c = freshChar();
    decayTick(c, { moodlets: [{ effects: e.effects }], perks: [] }); // must not throw
  }
});

test('maybeCityEvent: forced roll applies a city-wide moodlet + broadcast', async () => {
  const { id } = await seedUser();
  const orig = Math.random;
  const sent = [], news = [];
  try {
    Math.random = () => 0; // force the roll AND pick the first event
    const ev = await maybeCityEvent({ broadcast: (m) => sent.push(m), pushNews: async (t, x) => news.push([t, x]) });
    assert.ok(ev, 'expected an event');
    assert.equal(ev.key, CITY_EVENTS[0].key);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].t, 'sys');
    assert.ok(sent[0].text.length > 20);
    assert.equal(news.length, 1);
    assert.equal(news[0][0], 'city');
    // visible to the player as a citywide moodlet
    const list = await listActiveMoodlets(id);
    const cm = list.find(x => x.key === ev.key);
    assert.ok(cm && cm.citywide, 'city event should appear as a citywide moodlet');
    // decay actually feels it: blackout drains happiness per tick
    if (ev.key === 'city_blackout') {
      const c = freshChar();
      decayTick(c, { moodlets: [cm], perks: [] });
      assert.equal(c.happiness, 100 - 2);
    }
    // second forced roll: all events active? only 3 exist — still picks from the rest
    const ev2 = await maybeCityEvent({ broadcast: () => {} });
    assert.ok(!ev2 || ev2.key !== ev.key, 'should not double-apply the same event');
  } finally {
    Math.random = orig;
  }
});

test('maybeCityEvent: event_mult=0 suppresses rolls', async () => {
  const orig = Math.random;
  try {
    Math.random = () => 0;
    await db.setMeta('event_mult', '0');
    const ev = await maybeCityEvent({ broadcast: () => {} });
    assert.equal(ev, null);
  } finally {
    Math.random = orig;
    await db.setMeta('event_mult', '1');
  }
});

test('maybeCityEvent: missing ctx pieces never throw', async () => {
  const orig = Math.random;
  try {
    Math.random = () => 0;
    await maybeCityEvent(); // no broadcast, no pushNews
    await maybeCityEvent({ broadcast: null });
  } finally {
    Math.random = orig;
  }
});

test('city events: expiry + prune', async () => {
  await addCityEvent({ key: 'city_blackout', label: 'X', effects: [], ttlMs: 60000 });
  let active = await listActiveCityEvents();
  assert.ok(active.some(e => e.key === 'city_blackout'));
  // expire it manually
  await db.dbRun(
    `UPDATE city_events SET expires_at=? WHERE key=?`,
    `UPDATE city_events SET expires_at=$1 WHERE key=$2`,
    [Date.now() - 1000, 'city_blackout']
  );
  active = await listActiveCityEvents();
  assert.ok(!active.some(e => e.key === 'city_blackout'));
  await pruneCityEvents();
});

// ---- INTENTS (direct invocation, fake api) ----

function fakeApi(char, userId) {
  const sent = [];
  const conn = { user: { id: userId }, character: char, cds: {}, pos: { lat: 0, lng: 0 }, furniture: [] };
  const api = {
    conn,
    send: (c, msg) => sent.push(msg),
    broadcast: () => {},
    youSnapshot: () => ({}),
    err: (t) => sent.push({ t: 'err', text: t }),
    // mirrors actions.js commit: harden (extended M8 spec), ledger, save, push `you`
    commit: async ({ kind = null, amount = 0, meta = null, note = null } = {}) => {
      char.fun = clamp(char.fun, 0, 100);
      char.social = clamp(char.social, 0, 100);
      char.hygiene = clamp(char.hygiene, 0, 100);
      char.bladder = clamp(char.bladder, 0, 100);
      if (kind && amount) await db.addTransaction(userId, kind, Math.floor(amount), char.money, meta);
      await db.saveCharacter(char);
      sent.push({ t: 'you', note });
    },
    now: Date.now(),
    getDay: () => ({ day: 1 }),
  };
  return { api, sent, conn };
}

test('intent wash: free at residential, hygiene → 100', async () => {
  const { id, char } = await seedUser();
  char.location_id = 'mende_villa'; // residential tag
  char.hygiene = 40;
  char.money = 5000;
  const { api, sent } = fakeApi(char, id);
  await INTENTS.wash(api, {});
  assert.equal(char.hygiene, 100);
  assert.equal(char.money, 5000); // free — no fee
  assert.ok(sent.some(m => m.t === 'you'));
});

test('intent wash: ₦500 bathhouse fee elsewhere + ledger row', async () => {
  const { id, char } = await seedUser();
  char.location_id = 'tejuosho'; // market tag — not free
  char.hygiene = 30;
  char.money = 5000;
  const { api, sent } = fakeApi(char, id);
  await INTENTS.wash(api, {});
  assert.equal(char.hygiene, 100);
  assert.equal(char.money, 4500);
  const tx = await db.listTransactions(id, 5);
  assert.ok(tx.some(t => t.kind === 'wash' && t.amount === -500));
  assert.ok(sent.some(m => m.t === 'you' && /500/.test(m.note || '')));
});

test('intent wash: rejects when already clean / on cooldown / broke', async () => {
  const { id, char } = await seedUser();
  char.location_id = 'tejuosho';
  char.hygiene = 100;
  const { api, sent } = fakeApi(char, id);
  await INTENTS.wash(api, {});
  assert.ok(sent.some(m => m.t === 'err'));
  // broke at a paid spot
  char.hygiene = 10; char.money = 100;
  const f2 = fakeApi(char, id);
  await INTENTS.wash(f2.api, {});
  assert.ok(f2.sent.some(m => m.t === 'err' && /500/.test(m.text)));
  assert.equal(char.hygiene, 10); // untouched
  // cooldown after a successful wash
  char.money = 5000;
  const f3 = fakeApi(char, id);
  await INTENTS.wash(f3.api, {});
  assert.ok(f3.sent.some(m => m.t === 'you'));
  await INTENTS.wash(f3.api, {});
  assert.ok(f3.sent.some(m => m.t === 'err' && /again in/.test(m.text)));
});

test('intent toilet: free anywhere, bladder → 100', async () => {
  const { id, char } = await seedUser();
  char.location_id = 'tejuosho';
  char.bladder = 25;
  char.money = 5000;
  const { api, sent } = fakeApi(char, id);
  await INTENTS.toilet(api, {});
  assert.equal(char.bladder, 100);
  assert.equal(char.money, 5000); // free
  assert.ok(sent.some(m => m.t === 'you'));
  // already fine → err, no state change
  const f2 = fakeApi(char, id);
  await INTENTS.toilet(f2.api, {});
  assert.ok(f2.sent.some(m => m.t === 'err'));
});

test('intent moodlets: returns active moodlets with countdowns', async () => {
  const { id } = await seedUser();
  await triggerMoodlet(id, 'payday_groove');
  const { api, sent } = fakeApi({}, id);
  await INTENTS.moodlets(api, {});
  const msg = sent.find(m => m.t === 'moodlets');
  assert.ok(msg);
  const m = msg.moodlets.find(x => x.key === 'payday_groove');
  assert.ok(m);
  assert.ok(m.expires_in_ms > 0 && m.expires_in_ms <= 10 * 60 * 1000);
});

test('anti-cheat: forged client values in wash/toilet are ignored', async () => {
  const { id, char } = await seedUser();
  char.location_id = 'mende_villa';
  char.hygiene = 20;
  char.money = 5000;
  const { api } = fakeApi(char, id);
  // client tries to set its own stats/money — the intents never read msg numbers
  await INTENTS.wash(api, { hygiene: 0, money: 999999 });
  assert.equal(char.hygiene, 100); // server-derived
  assert.equal(char.money, 5000);  // forged money ignored
  char.bladder = 10;
  await INTENTS.toilet(api, { bladder: 999 });
  assert.equal(char.bladder, 100);
});

test('REST_SPEC + CONFIG_DATA: moodlets endpoint + needs catalog declared', () => {
  assert.equal(REST_SPEC.length, 1);
  assert.equal(REST_SPEC[0].method, 'GET');
  assert.equal(REST_SPEC[0].path, '/api/v2/m8/moodlets');
  assert.equal(REST_SPEC[0].auth, true);
  assert.ok(Array.isArray(CONFIG_DATA.needs) && CONFIG_DATA.needs.length === 6);
  assert.deepEqual(CONFIG_DATA.needs.map(n => n.id), ['hunger', 'energy', 'fun', 'social', 'hygiene', 'bladder']);
});

test('onTickMinute: prunes expired rows and never throws', async () => {
  const { id } = await seedUser();
  await db.dbRun(
    `INSERT INTO moodlets (user_id, key, label, effects_json, expires_at, created_at) VALUES (?,?,?,?,?,?)`,
    `INSERT INTO moodlets (user_id, key, label, effects_json, expires_at, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, 'dead', 'Dead', '[]', Date.now() - 5000, Date.now() - 6000]
  );
  await onTickMinute({ broadcast: () => {}, pushNews: async () => {} });
  const list = await listActiveMoodlets(id);
  assert.ok(list.every(m => m.key !== 'dead'));
});
