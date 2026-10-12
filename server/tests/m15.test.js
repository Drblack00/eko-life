// M15 Avatar + home-style customization tests:
// - sanitizeAvatar: accepts DEFAULT_AVATAR + case-insensitive hexes;
//   rejects bad body/skin/hair/outfit/fabric/topColor/bottomColor/missing
// - /config exposes avatarLook {bodies,skins,hairs,outfits,fabrics,
//   topColors,bottomColors,defaults}, walls (5), floors (4)
// - WS save_avatar: legacy flat look migrates to v1 server-side + rev
//   bumps (M6); client sees the canonical v1 in `you`;
//   invalid legacy fields fall back to defaults (migrate policy)
// - WS buy_home_style: charges + persists wall/floor, ledger row;
//   rejects unknown id/kind and insufficient funds
// - init `you` payload carries avatar_look/home_wall/home_floor
// - POST /characters: optional avatar_look accepted (valid), 400 (invalid)
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

process.env.SESSION_SECRET = 'm15-test-secret';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const data = await import('../src/game/data.js');

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
  await new Promise(r => setTimeout(r, 300));
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

function collect(ws) {
  const msgs = [];
  ws.on('message', (raw) => {
    try { msgs.push(JSON.parse(raw.toString())); } catch { /* ignore */ }
  });
  return msgs;
}

function waitFor(msgs, pred, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      const hit = msgs.find(pred);
      if (hit) { clearInterval(iv); resolve(hit); }
      else if (Date.now() - start > timeout) { clearInterval(iv); reject(new Error('timed out waiting for message')); }
    }, 25);
  });
}

// Only matches messages appended after the given index (avoids stale hits).
function waitForNew(msgs, from, pred, timeout = 8000) {
  return waitFor(msgs, (m, i) => i >= from && pred(m), timeout);
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
async function seedGuest(classId = 'street_smart', extraBody = {}) {
  guestN += 1;
  const username = 'm15seed' + guestN;
  const userId = await db.createUser({ username, is_guest: 1 });
  const token = signToken(userId);
  const name = 'M15T' + guestN + 'x' + Math.floor(Math.random() * 1e4);
  const cc = await post('/api/characters',
    { name, class: classId, avatar: '🧑', color: '#22d3ee', ...extraBody }, token);
  assert.equal(cc.status, 200, `character creation failed: ${JSON.stringify(cc.json)}`);
  return { token, userId, character: cc.json.character };
}

async function connectAs(user) {
  const { ws, msgs } = await connect(user.token);
  await waitFor(msgs, m => m.t === 'init');
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

const LOOK = {
  body: 'man', skin: 'mahogany', hair: 'locs', outfit: 'office',
  fabric: 'ankara', topColor: '#F472B6', bottomColor: '#111827',
};

// ---------------- sanitizeAvatar ----------------
test('M15 sanitizeAvatar: accepts valid look, hexes case-insensitive', () => {
  const r = data.sanitizeAvatar(data.DEFAULT_AVATAR);
  assert.equal(r.ok, true);
  assert.deepEqual(r.avatar, data.DEFAULT_AVATAR);
  assert.equal(r.error, null);
  // uppercase hexes are accepted and canonicalized to lowercase
  const r2 = data.sanitizeAvatar(LOOK);
  assert.equal(r2.ok, true);
  assert.equal(r2.avatar.topColor, '#f472b6');
  assert.equal(r2.avatar.bottomColor, '#111827');
  assert.equal(r2.avatar.body, 'man');
});

test('M15 sanitizeAvatar: rejects bad field values, error names the field', () => {
  const base = { ...data.DEFAULT_AVATAR };
  for (const [field, bad, expectName] of [
    ['body', 'alien', 'body'],
    ['skin', 'ghost', 'skin'],
    ['hair', 'mohawk', 'hair'],
    ['outfit', 'spacesuit', 'outfit'],
    ['fabric', 'denim', 'fabric'],
    ['topColor', '#123456', 'topColor'],       // valid hex, not in the list
    ['bottomColor', 'red', 'bottomColor'],     // not a list color
  ]) {
    const r = data.sanitizeAvatar({ ...base, [field]: bad });
    assert.equal(r.ok, false, `${field} should be rejected`);
    assert.equal(r.avatar, null);
    assert.match(r.error, new RegExp(expectName), `error should name '${field}': ${r.error}`);
  }
  // missing/empty payload fails on the first field (body)
  const empty = data.sanitizeAvatar(null);
  assert.equal(empty.ok, false);
  assert.match(empty.error, /body/);
  const partial = data.sanitizeAvatar({ body: 'woman' });
  assert.equal(partial.ok, false);
  assert.match(partial.error, /skin/);
});

// ---------------- /config ----------------
test('M15 /config: avatarLook + walls + floors exposed', async () => {
  const r = await get('/api/config');
  assert.equal(r.status, 200);
  const al = r.json.avatarLook;
  assert.ok(al, 'avatarLook missing from /config');
  assert.deepEqual(al.bodies, [{ id: 'woman', name: 'Woman' }, { id: 'man', name: 'Man' }]);
  assert.equal(al.skins.length, 12);
  assert.ok(al.skins.every(s => s.id && s.name && /^#[0-9a-f]{6}$/i.test(s.hex)));
  assert.deepEqual(al.skins.map(s => s.name), [
    'Deep Espresso', 'Dark Cocoa', 'Burnt Caramel', 'Mahogany', 'Walnut',
    'Cocoa', 'Coffee', 'Latte', 'Honey', 'Sand', 'Amber', 'Cream']);
  assert.deepEqual(al.hairs.map(h => h.id), ['lowcut', 'bald', 'curls', 'afro', 'locs', 'braids', 'classic', 'hair_taper_fade_01', 'hair_waves_01']);
  assert.deepEqual(al.outfits.map(o => o.id), ['casual', 'hoodie', 'office', 'chill', 'sitework']);
  assert.deepEqual(al.fabrics.map(f => f.id), ['plain', 'ankara', 'adire', 'asoke']);
  assert.equal(al.topColors.length, 21); // Phase 6: + boutique signature colors
  assert.equal(al.bottomColors.length, 20);
  assert.ok(al.topColors.every(c => /^#[0-9a-f]{6}$/i.test(c)));
  assert.ok(al.bottomColors.every(c => /^#[0-9a-f]{6}$/i.test(c)));
  assert.deepEqual(al.defaults, data.DEFAULT_AVATAR);
  // walls: 5, ₦1,500–₦25,000; floors: 4, ₦5,000–₦20,000
  const walls = r.json.walls, floors = r.json.floors;
  assert.equal(walls.length, 5);
  assert.equal(floors.length, 4);
  for (const w of walls) {
    assert.ok(w.id && w.name && typeof w.desc === 'string' && w.desc.length > 0);
    assert.ok(Number.isInteger(w.price) && w.price >= 1500 && w.price <= 25000, `${w.id}: bad price`);
    assert.match(w.hex, /^#[0-9a-f]{6}$/i);
  }
  for (const f of floors) {
    assert.ok(f.id && f.name && typeof f.desc === 'string' && f.desc.length > 0);
    assert.ok(Number.isInteger(f.price) && f.price >= 5000 && f.price <= 20000, `${f.id}: bad price`);
    assert.match(f.hex, /^#[0-9a-f]{6}$/i);
  }
  assert.deepEqual(walls.map(w => w.id), ['smooth_matte', 'lagoon_teal', 'sunset_ochre', 'regal_plum', 'gold_leaf']);
  assert.deepEqual(floors.map(f => f.id), ['polished_concrete', 'lagos_hardwood', 'marble_vein', 'obsidian_gloss']);
});

// ---------------- POST /characters avatar_look ----------------
test('M15 POST /characters: accepts valid avatar_look, 400 on invalid', async () => {
  const A = await seedGuest('street_smart', { avatar_look: data.DEFAULT_AVATAR });
  assert.deepEqual(A.character.avatar_look, data.DEFAULT_AVATAR);

  guestN += 1;
  const userId = await db.createUser({ username: 'm15seed' + guestN, is_guest: 1 });
  const token = signToken(userId);
  const bad = await post('/api/characters',
    { name: 'M15BadX1', class: 'street_smart', avatar: '🧑', color: '#22d3ee',
      avatar_look: { ...data.DEFAULT_AVATAR, body: 'alien' } }, token);
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /body/);
  // invalid attempt must not mark the character customized
  const c = await db.getCharacter(userId);
  assert.equal(Number(c.customized), 0);
});

// ---------------- WS save_avatar (M6: legacy flat look migrates to v1 + rev bump) ----------------
test('M15 save_avatar: persists valid look and pushes it in `you`', async () => {
  const A = await seedGuest();
  await setChar(A.userId, { money: 10000 });
  const { ws, msgs } = await connectAs(A);
  // fresh character: avatar_look is null on the init `you`
  const init = msgs.find(m => m.t === 'init');
  assert.equal(init.you.avatar_look, null);
  assert.equal(init.you.home_wall, null);
  assert.equal(init.you.home_floor, null);

  act(ws, { a: 'save_avatar', avatar: LOOK });
  // M6: the legacy flat look is migrated server-side to canonical v1.
  const you = await waitFor(msgs, m => m.t === 'you' && m.you.avatar_look && m.you.avatar_look.schemaVersion === 1);
  assert.equal(you.you.avatar_look.base.bodyPresetId, 'man');
  assert.equal(you.you.avatar_look.base.skinToneId, 'mahogany');
  assert.equal(you.you.avatar_look.hair.styleId, 'locs');
  assert.equal(you.you.avatar_look.clothing.topId, 'top_shirt_office_01'); // office decomposition
  assert.equal(you.you.avatar_look.clothing.shoeId, 'shoe_oxford_01');
  assert.equal(you.you.avatar_look.clothing.fabricId, 'ankara');
  assert.equal(you.you.avatar_look.clothing.topColor, '#f472b6'); // normalized
  assert.equal(you.you.avatar_look.clothing.bottomColor, '#111827');
  assert.match(you.note || '', /new look is saved/i);
  // DB-level persistence: canonical v1 JSON text + rev bumped
  const row = await db.getCharacter(A.userId);
  assert.deepEqual(JSON.parse(row.avatar_look), you.you.avatar_look);
  assert.equal(Number(row.appearance_rev), 1);
  // free: money untouched
  assert.equal(you.you.money, 10000);
  ws.close();
});

test('M15 save_avatar: invalid legacy fields fall back per migrate policy (no err)', async () => {
  const A = await seedGuest();
  const { ws, msgs } = await connectAs(A);
  act(ws, { a: 'save_avatar', avatar: { ...data.DEFAULT_AVATAR, hair: 'mohawk' } });
  // M6: unknown legacy ids fall back field-by-field to defaults (never rejected, never garbage)
  const you = await waitFor(msgs, m => m.t === 'you' && m.you.avatar_look && m.you.avatar_look.schemaVersion === 1);
  assert.equal(you.you.avatar_look.hair.styleId, 'lowcut');
  const row = await db.getCharacter(A.userId);
  assert.equal(Number(row.appearance_rev), 1);
  ws.close();
});

// ---------------- WS buy_home_style ----------------
test('M15 buy_home_style: wall charges, persists, ledger row', async () => {
  const A = await seedGuest();
  await setChar(A.userId, { money: 10000 });
  const { ws, msgs } = await connectAs(A);
  act(ws, { a: 'buy_home_style', kind: 'wall', id: 'lagoon_teal' }); // ₦4,500
  const you = await waitFor(msgs, m => m.t === 'you' && m.you.home_wall === 'lagoon_teal');
  assert.equal(you.you.money, 5500);
  assert.match(you.note, /Lagoon Teal applied to your home/);
  const row = await db.getCharacter(A.userId);
  assert.equal(row.home_wall, 'lagoon_teal');
  assert.equal(row.home_floor, null);
  // ledger
  const ledger = await get('/api/transactions', A.token);
  const tx = ledger.json.transactions[0];
  assert.equal(tx.kind, 'buy_home_style');
  assert.equal(tx.amount, -4500);
  assert.equal(tx.balance_after, 5500);
  assert.deepEqual(tx.meta, { kind: 'wall', id: 'lagoon_teal' });
  ws.close();
});

test('M15 buy_home_style: floor charges + persists; styles are independent', async () => {
  const A = await seedGuest();
  await setChar(A.userId, { money: 30000 });
  const { ws, msgs } = await connectAs(A);
  act(ws, { a: 'buy_home_style', kind: 'floor', id: 'obsidian_gloss' }); // ₦20,000
  const you = await waitFor(msgs, m => m.t === 'you' && m.you.home_floor === 'obsidian_gloss');
  assert.equal(you.you.money, 10000);
  const row = await db.getCharacter(A.userId);
  assert.equal(row.home_floor, 'obsidian_gloss');
  assert.equal(row.home_wall, null); // buying a floor doesn't touch the wall
  // overwrite the wall style later — floor stays
  act(ws, { a: 'buy_home_style', kind: 'wall', id: 'gold_leaf' }); // ₦25,000 — not enough
  const err = await waitForNew(msgs, msgs.length, m => m.t === 'err');
  assert.match(err.text, /₦25,000/);
  const row2 = await db.getCharacter(A.userId);
  assert.equal(row2.home_wall, null);
  ws.close();
});

test('M15 buy_home_style: rejects unknown id, bad kind, insufficient funds', async () => {
  const A = await seedGuest();
  await setChar(A.userId, { money: 1000 });
  const { ws, msgs } = await connectAs(A);
  act(ws, { a: 'buy_home_style', kind: 'wall', id: 'neon_dreams' });
  const err1 = await waitForNew(msgs, msgs.length, m => m.t === 'err');
  assert.match(err1.text, /unknown home wall style/i);
  act(ws, { a: 'buy_home_style', kind: 'roof', id: 'smooth_matte' });
  const err2 = await waitForNew(msgs, msgs.length, m => m.t === 'err');
  assert.match(err2.text, /wall or floor/i);
  act(ws, { a: 'buy_home_style', kind: 'wall', id: 'smooth_matte' }); // ₦1,500 > ₦1,000
  const err3 = await waitForNew(msgs, msgs.length, m => m.t === 'err');
  assert.match(err3.text, /You need ₦1,500 for the Smooth Matte\./);
  // nothing changed
  const row = await db.getCharacter(A.userId);
  assert.equal(row.home_wall, null);
  assert.equal(Number(row.money), 1000);
  ws.close();
});
