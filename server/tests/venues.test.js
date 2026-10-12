// Phase 5: venue activities ("things to do") — unit tests for v2/venues.js
// plus WS integration tests for the `venue_activity` act.
//
// NOTE: auth endpoints are rate-limited (10/min/IP) in this process, so
// gameplay users are seeded directly via db.createUser + signToken
// (same pattern as act.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

process.env.SESSION_SECRET = 'test-secret-eko-venues';
process.env.EKO_DB_PATH = ':memory:';

const {
  VENUE_ACTIVITIES,
  VENUE_COOLDOWN_MS,
  activitiesForTags,
  activitiesForLocation,
  findActivity,
  activityOfferedAt,
  tagsWithoutActivities,
} = await import('../src/game/v2/venues.js');
const { LOCATIONS } = await import('../src/game/data.js');
const { SKILL_IDS } = await import('../src/game/v2/m12.js');

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');

const NEED_KEYS = new Set(['hunger', 'fun', 'happiness', 'energy', 'social', 'hygiene']);

// ---------------- unit: catalog shape ----------------
test('venues: every location tag has 4-8 activities', () => {
  const allTags = [...new Set(LOCATIONS.flatMap((l) => l.tags || []))];
  const missing = tagsWithoutActivities(allTags);
  assert.deepEqual(missing, [], `tags without activities: ${missing.join(', ')}`);
  for (const t of allTags) {
    const acts = activitiesForTags([t]);
    assert.ok(acts.length >= 4 && acts.length <= 8,
      `tag ${t}: expected 4-8 activities, got ${acts.length}`);
  }
});

test('venues: activity shape — integer cost, valid need keys, valid skill ids', () => {
  const ids = new Set();
  for (const a of VENUE_ACTIVITIES) {
    assert.ok(!ids.has(a.id), `duplicate activity id ${a.id}`);
    ids.add(a.id);
    assert.ok(Number.isInteger(a.cost) && a.cost >= 0, `${a.id}: bad cost`);
    assert.ok(a.name && a.icon && a.blurb && a.teaser, `${a.id}: missing text`);
    assert.ok(Array.isArray(a.tags) && a.tags.length > 0, `${a.id}: no tags`);
    for (const k of Object.keys(a.needs || {})) {
      assert.ok(NEED_KEYS.has(k), `${a.id}: unknown need ${k}`);
      assert.ok(Number.isFinite(a.needs[k]), `${a.id}: non-numeric delta`);
    }
    if (a.skillXp) {
      assert.ok(SKILL_IDS.includes(a.skillXp.skill), `${a.id}: unknown skill`);
      assert.ok(Number.isInteger(a.skillXp.xp) && a.skillXp.xp > 0, `${a.id}: bad xp`);
    }
  }
});

test('venues: lookup helpers', () => {
  assert.equal(findActivity('mama_put_plate')?.name, 'Haggle a Mama Put plate');
  assert.equal(findActivity('nope'), null);
  const tejuosho = LOCATIONS.find((l) => l.id === 'tejuosho');
  const stadium = LOCATIONS.find((l) => l.id === 'surulere_stadium');
  assert.ok(activityOfferedAt(tejuosho, 'mama_put_plate'));
  assert.ok(!activityOfferedAt(stadium, 'mama_put_plate'));
  assert.ok(activityOfferedAt(stadium, 'street_ball'));
  assert.ok(!activityOfferedAt(tejuosho, 'nope'));
  // multi-tag venue gets the union, deduped
  const cms = LOCATIONS.find((l) => l.id === 'cms_marina'); // boat + bank
  const both = activitiesForLocation(cms);
  assert.ok(both.some((a) => a.tags.includes('boat')));
  assert.ok(both.some((a) => a.tags.includes('bank')));
  assert.equal(new Set(both.map((a) => a.id)).size, both.length);
  assert.equal(VENUE_COOLDOWN_MS, 60 * 1000);
});

// ---------------- integration: venue_activity act ----------------
let base, wsBase, app;

test.before(async () => {
  app = await createApp();
  const port = await app.start(0);
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
});

const sockets = new Set();
test.after(async () => {
  for (const ws of sockets) { try { ws.close(); } catch { /* ignore */ } }
  await new Promise((r) => setTimeout(r, 300));
  await app.close();
});

async function post(p, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}

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

let guestN = 0;
async function guestWithCharacter(classId) {
  guestN += 1;
  const username = 'venueguest' + guestN;
  const userId = await db.createUser({ username, is_guest: 1 });
  const token = signToken(userId);
  const name = 'V' + guestN + 'x' + Math.floor(Math.random() * 1e4);
  const cc = await post('/api/characters', {
    name, class: classId, avatar: '🧑', color: '#22d3ee',
  }, token);
  assert.equal(cc.status, 200, `character creation failed: ${JSON.stringify(cc.json)}`);
  return { token, userId };
}

async function connectAs(user) {
  const { ws, msgs } = await connect(user.token);
  await waitFor(msgs, (m) => m.t === 'init');
  return { ws, msgs };
}

async function setChar(userId, patch) {
  const c = await db.getCharacter(userId);
  Object.assign(c, patch);
  await db.saveCharacter(c);
}

function act(ws, payload) {
  ws.send(JSON.stringify({ t: 'act', ...payload }));
}

test('venue_activity: paid activity charges, applies + clamps needs, writes receipt', async () => {
  const A = await guestWithCharacter('street_smart');
  await setChar(A.userId, { location_id: 'tejuosho', money: 100000, hunger: 95, energy: 80 });
  const { ws, msgs } = await connectAs(A);
  act(ws, { a: 'venue_activity', locationId: 'tejuosho', activityId: 'mama_put_plate' });
  const done = await waitFor(msgs, (m) => m.t === 'you' && /Haggle a Mama Put plate/.test(m.note || ''));
  assert.equal(done.you.money, 100000 - 800); // integer coin math
  assert.equal(done.you.hunger, 100); // 95 + 35 clamped to 100
  const tx = await db.listTransactions(A.userId);
  const receipt = tx.find((t) => t.kind === 'venue_activity');
  assert.ok(receipt, 'expected a venue_activity ledger row');
  assert.equal(receipt.amount, -800);
  assert.equal(receipt.balance_after, 100000 - 800);
  ws.close();
});

test('venue_activity: free activity applies needs, moves no money', async () => {
  const A = await guestWithCharacter('street_smart');
  await setChar(A.userId, { location_id: 'tejuosho', money: 5000, social: 10, energy: 80 });
  const { ws, msgs } = await connectAs(A);
  act(ws, { a: 'venue_activity', locationId: 'tejuosho', activityId: 'stall_gist' });
  const done = await waitFor(msgs, (m) => m.t === 'you' && /Gist with a market woman/.test(m.note || ''));
  assert.equal(done.you.money, 5000);
  assert.equal(done.you.social, 24); // 10 + 14
  const tx = await db.listTransactions(A.userId);
  assert.ok(!tx.find((t) => t.kind === 'venue_activity'), 'free activity must not write a receipt');
  ws.close();
});

test('venue_activity: skill XP granted via the M12 hook', async () => {
  const A = await guestWithCharacter('street_smart');
  await setChar(A.userId, { location_id: 'tejuosho', money: 5000, energy: 80 });
  const { ws, msgs } = await connectAs(A);
  act(ws, { a: 'venue_activity', locationId: 'tejuosho', activityId: 'offload_help' });
  const done = await waitFor(msgs, (m) => m.t === 'you' && /offload goods/.test(m.note || ''));
  assert.ok(done);
  const c = await db.getCharacter(A.userId);
  const skills = JSON.parse(c.skills || '{}');
  assert.ok((skills.hustle?.xp || 0) >= 10, 'expected hustle XP from offload_help');
  ws.close();
});

test('venue_activity: unaffordable rejected', async () => {
  const A = await guestWithCharacter('street_smart');
  await setChar(A.userId, { location_id: 'tejuosho', money: 100 });
  const { ws, msgs } = await connectAs(A);
  act(ws, { a: 'venue_activity', locationId: 'tejuosho', activityId: 'mama_put_plate' });
  const err = await waitFor(msgs, (m) => m.t === 'err' && /need ₦800/.test(m.text));
  assert.ok(err);
  const c = await db.getCharacter(A.userId);
  assert.equal(Number(c.money), 100); // nothing moved
  ws.close();
});

test('venue_activity: wrong venue rejected', async () => {
  const A = await guestWithCharacter('street_smart');
  await setChar(A.userId, { location_id: 'tejuosho', money: 50000, energy: 80 });
  const { ws, msgs } = await connectAs(A);
  act(ws, { a: 'venue_activity', locationId: 'tejuosho', activityId: 'street_ball' });
  const err = await waitFor(msgs, (m) => m.t === 'err' && /can't do that at/.test(m.text));
  assert.ok(err);
  ws.close();
});

test('venue_activity: unknown venue / unknown activity rejected', async () => {
  const A = await guestWithCharacter('street_smart');
  await setChar(A.userId, { location_id: 'tejuosho', money: 50000, energy: 80 });
  const { ws, msgs } = await connectAs(A);
  act(ws, { a: 'venue_activity', locationId: 'nowhere', activityId: 'mama_put_plate' });
  const e1 = await waitFor(msgs, (m) => m.t === 'err' && /Unknown venue/.test(m.text));
  assert.ok(e1);
  act(ws, { a: 'venue_activity', locationId: 'tejuosho', activityId: 'nope' });
  const e2 = await waitFor(msgs, (m) => m.t === 'err' && /Unknown activity/.test(m.text));
  assert.ok(e2);
  ws.close();
});

test('venue_activity: must be at the venue', async () => {
  const A = await guestWithCharacter('street_smart');
  await setChar(A.userId, { location_id: 'ojuelegba', money: 50000, energy: 80 });
  const { ws, msgs } = await connectAs(A);
  act(ws, { a: 'venue_activity', locationId: 'tejuosho', activityId: 'mama_put_plate' });
  const err = await waitFor(msgs, (m) => m.t === 'err' && /Travel to/.test(m.text));
  assert.ok(err);
  ws.close();
});

test('venue_activity: 60s per-activity cooldown enforced', async () => {
  const A = await guestWithCharacter('street_smart');
  await setChar(A.userId, { location_id: 'tejuosho', money: 50000, energy: 80 });
  const { ws, msgs } = await connectAs(A);
  act(ws, { a: 'venue_activity', locationId: 'tejuosho', activityId: 'stall_gist' });
  await waitFor(msgs, (m) => m.t === 'you' && /Gist with a market woman/.test(m.note || ''));
  act(ws, { a: 'venue_activity', locationId: 'tejuosho', activityId: 'stall_gist' });
  const err = await waitFor(msgs, (m) => m.t === 'err' && /Catch your breath/.test(m.text));
  const m = /in (\d+)s/.exec(err.text);
  assert.ok(m, 'cooldown error must carry seconds remaining');
  const secs = Number(m[1]);
  assert.ok(secs > 50 && secs <= 60, `expected ~60s cooldown, got ${secs}s`);
  // a DIFFERENT activity is not on cooldown
  act(ws, { a: 'venue_activity', locationId: 'tejuosho', activityId: 'thrift_dig' });
  const other = await waitFor(msgs, (m2) => m2.t === 'you' && /Dig the thrift racks/.test(m2.note || ''));
  assert.ok(other);
  ws.close();
});

test('venues/presence: returns { presence: {locationId: count} }', async () => {
  const A = await guestWithCharacter('street_smart');
  await setChar(A.userId, { location_id: 'tejuosho' });
  const { ws, msgs } = await connectAs(A);
  const r = await fetch(`${base}/api/venues/presence`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.presence && typeof j.presence === 'object');
  assert.ok(Number(j.presence.tejuosho) >= 1, 'connected player must be counted at tejuosho');
  ws.close();
});
