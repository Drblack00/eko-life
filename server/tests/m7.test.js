// M7 tests: Lagos game clock, career tracks data, shift intents
// (validation, forfeit, forged values), tick completion (payout math,
// wage_mult, offline completion, unknown roles), perk/skill readers.
//
// NOTE: auth endpoints are rate-limited (10/min/IP), so users are seeded
// directly via db.createUser + signToken (same convention as act.test.js).
// Shift INTENTS are invoked directly with a fake api (per the v2 README
// pattern) because actions.js wiring is the coordinator's step; the
// onTickMinute online path is exercised over a real WS using the exact
// ctx contract from the integration spec.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

process.env.SESSION_SECRET = 'test-secret-eko-m7';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const data = await import('../src/game/data.js');
const m7 = await import('../src/game/v2/m7.js');

let base, wsBase, app;

test.before(async () => {
  app = await createApp();
  await m7.ensureSchema(); // M7 shift columns on the characters table
  const port = await app.start(0);
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
});

const sockets = new Set();
test.after(async () => {
  for (const ws of sockets) { try { ws.close(); } catch { /* ignore */ } }
  await new Promise(r => setTimeout(r, 300));
  await app.close();
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function collect(ws) {
  const msgs = [];
  ws.on('message', (raw) => {
    try { msgs.push(JSON.parse(raw.toString())); } catch { /* ignore */ }
  });
  return msgs;
}

function waitFor(msgs, pred, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      const hit = msgs.find(pred);
      if (hit) { clearInterval(iv); resolve(hit); }
      else if (Date.now() - start > timeout) { clearInterval(iv); reject(new Error('timed out waiting for message')); }
    }, 25);
  });
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/ws?token=${encodeURIComponent(token)}`);
    sockets.add(ws);
    ws.on('close', () => sockets.delete(ws));
    const msgs = collect(ws);
    ws.once('open', () => resolve({ ws, msgs }));
    ws.once('error', reject);
  });
}

let n = 0;
async function seedUser() {
  n += 1;
  const username = 'm7user' + n;
  const userId = await db.createUser({ username, is_guest: 1 });
  const token = signToken(userId);
  const user = await db.getUserById(userId);
  const character = await db.ensureCharacter(userId, 'M7Player' + n);
  return { user, character, token };
}

// Fake api matching the v2 README INTENTS contract. commit() mirrors
// actions.js: ledger on money moves only, real saveCharacter, `you` push.
function fakeApi(user, character) {
  const sent = [];
  const conn = { user, character, cds: {}, pos: { lat: 28, lng: 55 }, furniture: [] };
  const api = {
    conn,
    send: (c, msg) => sent.push(msg),
    broadcast: () => {},
    youSnapshot: (c) => ({ money: Number(c.character.money) }),
    err: (text) => sent.push({ t: 'err', text }),
    commit: async ({ kind = null, amount = 0, meta = null, note = null } = {}) => {
      if (kind && amount) {
        await db.addTransaction(user.id, kind, Math.floor(amount), character.money, meta);
      }
      await db.saveCharacter(character);
      sent.push({ t: 'you', note });
    },
    now: Date.now(),
    getDay: () => ({ day: 1, endsIn: 0 }),
  };
  return { api, sent, conn };
}

async function setShiftDb(userId, job, endsAtOffsetMs) {
  const now = Date.now();
  await m7.persistShiftState(userId, {
    shift_job: job,
    shift_started_at: now + endsAtOffsetMs - m7.SHIFT_MS,
    shift_ends_at: now + endsAtOffsetMs,
  });
}

function fakeTickCtx(capture = {}) {
  capture.done = [];
  capture.refreshed = [];
  return {
    ctx: {
      broadcast: () => {},
      sendTo: async (userId, msg) => capture.done.push({ userId, msg }),
      refreshYou: async (userId) => capture.refreshed.push(Number(userId)),
      getDay: () => ({ day: 1, endsIn: 0 }),
      now: Date.now(),
    },
    capture,
  };
}

// ---------------- game clock ----------------
test('lagosNow: label shape "Sat · 3:16 AM" in Africa/Lagos', () => {
  const { ts, label } = m7.lagosNow();
  assert.ok(Number.isFinite(ts));
  assert.match(label, /^\w{3} · \d{1,2}:\d{2} [AP]M$/);
});

test('lagosNow: deterministic — 2026-10-10T02:16:00Z is Sat 3:16 AM WAT', () => {
  // Africa/Lagos is UTC+1 with no DST, so this is exact.
  const { label } = m7.lagosNow(Date.parse('2026-10-10T02:16:00Z'));
  assert.equal(label, 'Sat · 3:16 AM');
});

test('REST_SPEC: /api/v2/m7/clock handler returns { ts, label }', async () => {
  assert.equal(m7.REST_SPEC.length, 1);
  const spec = m7.REST_SPEC[0];
  assert.equal(spec.method, 'GET');
  assert.equal(spec.path, '/api/v2/m7/clock');
  assert.equal(spec.auth, false);
  let body = null;
  await spec.handler({}, { json: (o) => { body = o; } });
  assert.ok(Number.isFinite(body.ts));
  assert.match(body.label, /^\w{3} · \d{1,2}:\d{2} [AP]M$/);
});

// ---------------- career tracks data ----------------
const LEGACY_IDS = ['market_porter', 'danfo_conductor', 'shop_assistant', 'beach_lifeguard',
  'lounge_barista', 'junior_dev', 'bank_teller', 'hospital_orderly', 'market_trader', 'campus_tutor'];

test('career tracks: 24 tracks, 10 legacy entry roles kept (same ids)', () => {
  assert.equal(m7.CAREER_TRACKS.length, 24);
  for (const id of LEGACY_IDS) {
    const role = m7.findRole(id);
    assert.ok(role, `legacy role missing: ${id}`);
    const track = m7.CAREER_TRACKS.find((t) => t.id === role.trackId);
    assert.ok(track, `track missing for ${id}`);
    assert.equal(track.tier, 'entry');
    assert.ok(track.roles.includes(role));
  }
});

test('career tracks: every locationId exists; pay bands; skill gates valid', () => {
  const locIds = new Set(data.LOCATIONS.map((l) => l.id));
  let entry = 0, mid = 0;
  for (const track of m7.CAREER_TRACKS) {
    assert.ok(track.id && track.name && track.icon);
    for (const role of track.roles) {
      assert.equal(role.trackId, track.id);
      assert.ok(locIds.has(role.locationId), `bad locationId ${role.locationId} on ${role.id}`);
      assert.ok(Number.isInteger(role.payPerShift) && role.payPerShift > 0);
      assert.ok(Number.isInteger(role.energyCost) && role.energyCost > 0);
      if (track.tier === 'entry') {
        entry += 1;
        assert.ok(role.payPerShift >= 5700 && role.payPerShift <= 10400,
          `entry pay out of band: ${role.id} = ${role.payPerShift}`);
      } else {
        mid += 1;
        assert.ok(role.payPerShift >= 12000 && role.payPerShift <= 18500,
          `mid pay out of band: ${role.id} = ${role.payPerShift}`);
      }
      if (role.skillGate) {
        assert.ok(m7.SKILL_IDS.includes(role.skillGate.skill), `bad skill ${role.skillGate.skill}`);
        assert.ok(Number.isInteger(role.skillGate.level) && role.skillGate.level >= 1);
      }
    }
  }
  assert.equal(entry, 10);
  assert.equal(mid, 14);
  assert.equal(m7.findRole('nope'), null);
});

test('CONFIG_DATA: exposes careerTracks (+ skillLabels) for /api/config', () => {
  assert.ok(Array.isArray(m7.CONFIG_DATA.careerTracks));
  assert.equal(m7.CONFIG_DATA.careerTracks.length, 24);
});

// ---------------- pure logic ----------------
test('calcShiftPay: class mult × wage_mult × perk boost', () => {
  assert.equal(m7.calcShiftPay(10000, { classMult: 1.1 }), 11000);
  assert.equal(m7.calcShiftPay(10000, { classMult: 0.9 }), 9000);
  assert.equal(m7.calcShiftPay(10000, { classMult: 1.1, wageMult: 1.15 }), 12649); // 12649.99… floored
  assert.equal(m7.calcShiftPay(10000, { classMult: 1.1, perkPct: 20 }), 13200);
  assert.equal(m7.calcShiftPay(5700, { classMult: 1.1, wageMult: 1.15 }), 7210);
  // garbage inputs fall back to 1 (never NaN, never negative)
  assert.equal(m7.calcShiftPay(10000, { wageMult: NaN }), 10000);
  assert.equal(m7.calcShiftPay(10000, { wageMult: -5 }), 10000);
  assert.equal(m7.calcShiftPay(10000, { wageMult: 999 }), 10000);
  assert.equal(m7.calcShiftPay(10000, { perkPct: 500 }), 20000); // clamped to 100%
});

test('skillLevelOf / workPayPerkPct: defensive on missing or invalid data', () => {
  assert.equal(m7.skillLevelOf({}, 'hustle'), 0);
  assert.equal(m7.skillLevelOf({ skills: 'not-json' }, 'hustle'), 0);
  assert.equal(m7.skillLevelOf({ skills: '{"hustle":3}' }, 'hustle'), 3);
  assert.equal(m7.skillLevelOf({ skills: { hustle: 2 } }, 'hustle'), 2);
  assert.equal(m7.skillLevelOf({ skills: { hustle: 2 } }, 'coding'), 0);
  assert.equal(m7.workPayPerkPct({}), 0);
  assert.equal(m7.workPayPerkPct({ perks: 'junk' }), 0);
  assert.equal(m7.workPayPerkPct({ perks: [] }), 0);
  assert.equal(
    m7.workPayPerkPct({ perks: JSON.stringify([{ effect: { type: 'work_pay', pct: 25 } }]) }), 25);
  assert.equal(m7.workPayPerkPct({ perks: [{ effect: { type: 'other', pct: 50 } }] }), 0);
  assert.equal(m7.workPayPerkPct({ perks: [{ effect: { type: 'work_pay', pct: 999 } }] }), 100);
});

// ---------------- shift_start validation ----------------
test('shift_start: unknown job → err', async () => {
  const { user, character } = await seedUser();
  const { api, sent } = fakeApi(user, character);
  await m7.INTENTS.shift_start(api, { job: 'astronaut' });
  assert.match(sent.find((m) => m.t === 'err').text, /Unknown job/);
});

test('shift_start: wrong location → err naming the right place', async () => {
  const { user, character } = await seedUser(); // spawns at ojuelegba
  const { api, sent } = fakeApi(user, character);
  await m7.INTENTS.shift_start(api, { job: 'market_porter' }); // at tejuosho
  assert.match(sent.find((m) => m.t === 'err').text, /Tejuosho/);
});

test('shift_start: low energy → err', async () => {
  const { user, character } = await seedUser();
  character.energy = 10;
  character.location_id = 'tejuosho';
  const { api, sent } = fakeApi(user, character);
  await m7.INTENTS.shift_start(api, { job: 'market_porter' });
  assert.match(sent.find((m) => m.t === 'err').text, /Too tired/);
});

test('shift_start: cert gate enforced', async () => {
  const { user, character } = await seedUser();
  character.location_id = 'kudi_row';
  const { api, sent } = fakeApi(user, character);
  await m7.INTENTS.shift_start(api, { job: 'bank_teller' });
  assert.match(sent.find((m) => m.t === 'err').text, /certificate/i);
});

test('shift_start: skill gate enforced, then passes with the skill', async () => {
  const { user, character } = await seedUser();
  character.location_id = 'agungi_round';
  let f = fakeApi(user, character);
  await m7.INTENTS.shift_start(f.api, { job: 'keke_rider' }); // hustle 2
  assert.match(f.sent.find((m) => m.t === 'err').text, /Hustle level 2/);

  character.skills = JSON.stringify({ hustle: 2 });
  f = fakeApi(user, character);
  await m7.INTENTS.shift_start(f.api, { job: 'keke_rider' });
  assert.ok(!f.sent.some((m) => m.t === 'err'));
  assert.match(f.sent.find((m) => m.t === 'you').note, /Clocked in/);
});

test('shift_start: success deducts energy, sets 1h shift in DB', async () => {
  const { user, character } = await seedUser();
  character.location_id = 'tejuosho';
  character.energy = 100;
  const { api, sent } = fakeApi(user, character);
  const before = Date.now();
  await m7.INTENTS.shift_start(api, { job: 'market_porter' });
  assert.equal(character.energy, 75); // 100 − 25 server-side cost
  const row = await db.getCharacter(user.id);
  assert.equal(row.shift_job, 'market_porter');
  const endsAt = Number(row.shift_ends_at);
  assert.ok(endsAt - before >= m7.SHIFT_MS - 5000 && endsAt - before <= m7.SHIFT_MS + 5000);
  assert.match(sent.find((m) => m.t === 'you').note, /Clocked in as Market Porter/);
});

test('shift_start: double shift refused', async () => {
  const { user, character } = await seedUser();
  character.location_id = 'tejuosho';
  const { api, sent } = fakeApi(user, character);
  await m7.INTENTS.shift_start(api, { job: 'market_porter' });
  character.location_id = 'oshodi';
  await m7.INTENTS.shift_start(api, { job: 'danfo_conductor' });
  assert.match(sent.filter((m) => m.t === 'err').pop().text, /already on a shift/);
});

test('shift_start: forged client values ignored (pay/cost/duration from server)', async () => {
  const { user, character } = await seedUser();
  character.location_id = 'tejuosho';
  character.energy = 100;
  const { api, sent } = fakeApi(user, character);
  const before = Date.now();
  await m7.INTENTS.shift_start(api, {
    job: 'market_porter', payPerShift: 999999, energyCost: 0,
    shift_ends_at: before + 1000, // try to force a 1-second shift
  });
  assert.equal(character.energy, 75, 'energy cost must come from server data');
  const row = await db.getCharacter(user.id);
  assert.ok(Number(row.shift_ends_at) - before > m7.SHIFT_MS - 5000, 'duration must be server-side 1h');
  // complete it: pay must be server-derived (5700 × 1.1), not 999999
  await setShiftDb(user.id, 'market_porter', -1000);
  const { ctx, capture } = fakeTickCtx();
  const done = await m7.onTickMinute(ctx);
  assert.equal(done.length, 1);
  assert.equal(done[0].pay, Math.floor(5700 * 1.1));
  assert.ok(!sent.some((m) => m.t === 'err'));
});

// ---------------- shift_leave (forfeit) ----------------
test('shift_leave: forfeit — no pay, shift cleared, ledger untouched', async () => {
  const { user, character } = await seedUser();
  character.location_id = 'tejuosho';
  character.money = 5000;
  const { api, sent } = fakeApi(user, character);
  await m7.INTENTS.shift_start(api, { job: 'market_porter' });
  await m7.INTENTS.shift_leave(api, {});
  assert.equal(character.money, 5000, 'leaving early must not pay');
  const row = await db.getCharacter(user.id);
  assert.equal(row.shift_job, null);
  assert.match(sent.filter((m) => m.t === 'you').pop().note, /earn nothing/);
  const tx = await db.listTransactions(user.id);
  assert.ok(!tx.some((t) => t.kind === 'shift_pay'), 'no shift_pay ledger on forfeit');
});

test('shift_leave: not on a shift → err', async () => {
  const { user, character } = await seedUser();
  const { api, sent } = fakeApi(user, character);
  await m7.INTENTS.shift_leave(api, {});
  assert.match(sent.find((m) => m.t === 'err').text, /not on a shift/);
});

// ---------------- shift_status ----------------
test('shift_status: returns live shift, null when idle', async () => {
  const { user, character } = await seedUser();
  let f = fakeApi(user, character);
  await m7.INTENTS.shift_status(f.api, {});
  assert.equal(f.sent.find((m) => m.t === 'shift_status').shift, null);

  character.location_id = 'tejuosho';
  await m7.INTENTS.shift_start(f.api, { job: 'market_porter' });
  f = fakeApi(user, character);
  await m7.INTENTS.shift_status(f.api, {});
  const shift = f.sent.find((m) => m.t === 'shift_status').shift;
  assert.equal(shift.job, 'market_porter');
  assert.ok(shift.endsAt > Date.now());
  assert.ok(shift.secondsLeft > 3500 && shift.secondsLeft <= 3600);
});

// ---------------- onTickMinute: completion ----------------
test('onTickMinute: payout = pay × class mult × wage_mult, ledger shift_pay', async () => {
  const { user } = await seedUser(); // street_smart → 1.1
  await setShiftDb(user.id, 'market_porter', -1000); // expired 1s ago
  await db.setMeta('wage_mult', '1.15'); // governor policy (M11 writes this)
  const { ctx, capture } = fakeTickCtx();
  const done = await m7.onTickMinute(ctx);
  assert.equal(done.length, 1);
  const expected = Math.floor(5700 * 1.1 * 1.15); // 7210
  assert.equal(done[0].pay, expected);
  assert.equal(done[0].userId, user.id);
  const row = await db.getCharacter(user.id);
  assert.equal(Number(row.money), 5000 + expected);
  assert.equal(row.shift_job, null);
  const tx = await db.listTransactions(user.id);
  const pay = tx.find((t) => t.kind === 'shift_pay');
  assert.ok(pay);
  assert.equal(pay.amount, expected);
  assert.equal(pay.balance_after, 5000 + expected);
  assert.equal(capture.refreshed[0], user.id, 'coordinator must refresh the live session');
  assert.match(capture.done[0].msg.note, /shift complete/);
  await db.setMeta('wage_mult', '1');
});

test('onTickMinute: silver_spoon pays 10% less (soft-life tax)', async () => {
  const { user, character } = await seedUser();
  character.class = 'silver_spoon';
  await db.saveCharacter(character);
  await setShiftDb(user.id, 'market_porter', -1000);
  const { ctx } = fakeTickCtx();
  const done = await m7.onTickMinute(ctx);
  assert.equal(done[0].pay, Math.floor(5700 * 0.9));
});

test('onTickMinute: invalid wage_mult falls back to 1', async () => {
  const { user } = await seedUser();
  await setShiftDb(user.id, 'market_porter', -1000);
  await db.setMeta('wage_mult', 'banana');
  const { ctx } = fakeTickCtx();
  const done = await m7.onTickMinute(ctx);
  assert.equal(done[0].pay, Math.floor(5700 * 1.1));
  await db.setMeta('wage_mult', '1');
});

test('onTickMinute: live shifts untouched; unknown roles cleared without pay', async () => {
  const a = await seedUser();
  const b = await seedUser();
  await setShiftDb(a.user.id, 'market_porter', 30 * 60 * 1000); // 30 min left
  await setShiftDb(b.user.id, 'ghost_job', -1000); // unknown role id
  const { ctx } = fakeTickCtx();
  const done = await m7.onTickMinute(ctx);
  assert.equal(done.length, 0);
  const ra = await db.getCharacter(a.user.id);
  assert.equal(ra.shift_job, 'market_porter', 'live shift must survive the tick');
  const rb = await db.getCharacter(b.user.id);
  assert.equal(rb.shift_job, null, 'unknown role cleared');
  const tx = await db.listTransactions(b.user.id);
  assert.ok(!tx.some((t) => t.kind === 'shift_pay'));
});

test('onTickMinute: offline player completes (DB-driven, no socket)', async () => {
  const { user } = await seedUser();
  // never connects — pure DB row
  await setShiftDb(user.id, 'danfo_conductor', -5000);
  const { ctx, capture } = fakeTickCtx();
  const done = await m7.onTickMinute(ctx);
  assert.equal(done.length, 1);
  assert.equal(done[0].pay, Math.floor(6400 * 1.1));
  const row = await db.getCharacter(user.id);
  assert.equal(Number(row.money), 5000 + Math.floor(6400 * 1.1));
  assert.equal(capture.refreshed[0], user.id); // harmless when offline
});

test('shift_start: failed validation leaves a stale shift for the tick (no double-pay)', async () => {
  const { user, character } = await seedUser();
  // expired shift on the session, but the player is at the WRONG location
  character.shift_job = 'market_porter';
  character.shift_started_at = Date.now() - m7.SHIFT_MS - 60000;
  character.shift_ends_at = Date.now() - 60000;
  character.money = 5000;
  character.location_id = 'oshodi'; // market_porter is at tejuosho
  const { api, sent } = fakeApi(user, character);
  await m7.INTENTS.shift_start(api, { job: 'market_porter' });
  assert.match(sent.find((m) => m.t === 'err').text, /Tejuosho/);
  assert.equal(character.money, 5000, 'stale shift must NOT be settled on a failed clock-in');
  assert.equal(character.shift_job, 'market_porter', 'stale shift row left intact');
  // the tick settles it exactly once
  await m7.persistShiftState(user.id, {
    shift_job: 'market_porter',
    shift_started_at: character.shift_started_at,
    shift_ends_at: character.shift_ends_at,
  });
  const { ctx } = fakeTickCtx();
  const done = await m7.onTickMinute(ctx);
  assert.equal(done.length, 1);
  assert.equal(done[0].pay, Math.floor(5700 * 1.1));
  const again = await m7.onTickMinute(ctx);
  assert.equal(again.length, 0, 'second tick must not re-pay');
});

test('onTickMinute: stale shift settles with ledger when a new shift starts', async () => {  const { user, character } = await seedUser();
  // expired shift sitting on the session character (tick hasn't run yet)
  character.shift_job = 'market_porter';
  character.shift_started_at = Date.now() - m7.SHIFT_MS - 60000;
  character.shift_ends_at = Date.now() - 60000;
  character.money = 5000;
  character.location_id = 'tejuosho';
  const { api, sent } = fakeApi(user, character);
  await m7.INTENTS.shift_start(api, { job: 'market_porter' });
  const expected = Math.floor(5700 * 1.1);
  assert.equal(character.money, 5000 + expected, 'stale shift paid out before the new one');
  assert.equal(character.shift_job, 'market_porter');
  const tx = await db.listTransactions(user.id);
  const stale = tx.find((t) => t.kind === 'shift_pay');
  assert.ok(stale, 'stale settle must write a ledger row');
  assert.equal(stale.amount, expected);
});

// ---------------- online path over a real socket ----------------
test('onTickMinute online: shift_done toast + refreshed you reach the client', async () => {
  const { user, token } = await seedUser();
  const { ws, msgs } = await connect(token);
  await waitFor(msgs, (m) => m.t === 'init');
  await setShiftDb(user.id, 'market_porter', -1000);

  // ctx wired exactly per the integration spec: sendTo → socket,
  // refreshYou → re-read row, push fresh `you`.
  const sendTo = (uid, msg) => {
    const c = app.hub.online.get(Number(uid));
    if (c && c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
  };
  const refreshYou = async (uid) => {
    const c = app.hub.online.get(Number(uid));
    if (!c) return;
    c.character = await db.getCharacter(Number(uid));
    c.ws.send(JSON.stringify({
      t: 'you',
      you: { money: Number(c.character.money), shift: c.character.shift_job },
    }));
  };
  const expected = Math.floor(5700 * 1.1);
  const done = await m7.onTickMinute({
    broadcast: () => {}, sendTo, refreshYou,
    getDay: () => ({ day: 1, endsIn: 0 }), now: Date.now(),
  });
  assert.equal(done.length, 1);
  const toast = await waitFor(msgs, (m) => m.t === 'shift_done');
  assert.equal(toast.pay, expected);
  const you = await waitFor(msgs, (m) => m.t === 'you' && m.you.money === 5000 + expected);
  assert.equal(you.you.shift, null);
  ws.close();
  await sleep(150);
});
