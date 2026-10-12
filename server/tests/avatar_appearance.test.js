// M6 Versioned appearance persistence tests:
// - GET /api/characters/:id/appearance: null + rev 0 on fresh character;
//   legacy flat JSON returned verbatim (client migrates); 404 cross-user.
// - PUT /api/characters/:id/appearance: happy path stores canonical v1 +
//   bumps rev; 409 on stale rev (carries current revision); 400 on bad
//   ids/morphs; 403 cross-user; 404 missing character.
// - GET /api/avatar/catalog: schemaVersion 1, ids match the M2 manifest.
// - persistAppearance/validateAppearanceV1/legacyLookToV1 unit coverage.
// - WS save_avatar (legacy path): valid flat look migrates to v1 and bumps
//   rev; invalid legacy fields fall back per migrate policy (no err).
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

process.env.SESSION_SECRET = 'm6-test-secret';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const appearance = await import('../src/game/appearance.js');

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

async function put(p, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(base + p, { method: 'PUT', headers, body: JSON.stringify(body) });
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
async function seedGuest(extraBody = {}) {
  guestN += 1;
  const username = 'm6seed' + guestN;
  const userId = await db.createUser({ username, is_guest: 1 });
  const token = signToken(userId);
  const name = 'M6T' + guestN + 'x' + Math.floor(Math.random() * 1e4);
  const cc = await post('/api/characters',
    { name, class: 'street_smart', avatar: '🧑', color: '#22d3ee', ...extraBody }, token);
  assert.equal(cc.status, 200, `character creation failed: ${JSON.stringify(cc.json)}`);
  const char = await db.getCharacter(userId);
  return { token, userId, characterId: char.id };
}

async function connectAs(user) {
  const { ws, msgs } = await connect(user.token);
  await waitFor(msgs, m => m.t === 'init');
  return { ws, msgs };
}

const LEGACY_LOOK = {
  body: 'man', skin: 'mahogany', hair: 'locs', outfit: 'office',
  fabric: 'ankara', topColor: '#F472B6', bottomColor: '#111827',
};

// ---------------- unit: validateAppearanceV1 ----------------

test('M6 validateAppearanceV1: defaults + normalization', () => {
  const r = appearance.validateAppearanceV1({ schemaVersion: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.appearance.schemaVersion, 1);
  assert.equal(r.appearance.base.bodyPresetId, 'woman');
  assert.equal(r.appearance.morphs.jawWidth, 0.5);
  assert.equal(Object.keys(r.appearance.morphs).length, 9);
  assert.deepEqual(r.appearance.accessories, []);
});

test('M6 validateAppearanceV1: rejects bad ids, morphs, colours, mismatches', () => {
  assert.equal(appearance.validateAppearanceV1(null).ok, false);
  assert.equal(appearance.validateAppearanceV1('nope').ok, false);
  assert.equal(appearance.validateAppearanceV1({ schemaVersion: 2 }).ok, false);
  // unknown ids
  let r = appearance.validateAppearanceV1({ hair: { styleId: 'mohawk' } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.startsWith('hair.styleId')), JSON.stringify(r.errors));
  r = appearance.validateAppearanceV1({ hair: { colorId: 'hair_blue_99' } });
  assert.equal(r.ok, false);
  r = appearance.validateAppearanceV1({ clothing: { topId: 'top_leather_99' } });
  assert.equal(r.ok, false);
  // path/URL injection attempts rejected
  r = appearance.validateAppearanceV1({ hair: { styleId: '../../etc/passwd' } });
  assert.equal(r.ok, false);
  r = appearance.validateAppearanceV1({ clothing: { topId: 'https://evil.com/x.glb' } });
  assert.equal(r.ok, false);
  // morphs: unknown key, out of range, non-numeric
  r = appearance.validateAppearanceV1({ morphs: { noseLength: 1.5 } });
  assert.equal(r.ok, false);
  r = appearance.validateAppearanceV1({ morphs: { noSuchMorph: 0.5 } });
  assert.equal(r.ok, false);
  r = appearance.validateAppearanceV1({ morphs: { noseLength: 'half' } });
  assert.equal(r.ok, false);
  r = appearance.validateAppearanceV1({ morphs: NaN });
  assert.equal(r.ok, false);
  // colours outside the palettes / bad shape
  r = appearance.validateAppearanceV1({ clothing: { topColor: '#000000' } });
  assert.equal(r.ok, false);
  r = appearance.validateAppearanceV1({ clothing: { bottomColor: 'red' } });
  assert.equal(r.ok, false);
  // colour normalization: uppercase accepted, stored lowercase
  r = appearance.validateAppearanceV1({ clothing: { topColor: '#F472B6' } });
  assert.equal(r.ok, true);
  assert.equal(r.appearance.clothing.topColor, '#f472b6');
  // body preset/type mismatch
  r = appearance.validateAppearanceV1({ base: { bodyType: 'feminine', bodyPresetId: 'man' } });
  assert.equal(r.ok, false);
  // duplicate accessory slot
  r = appearance.validateAppearanceV1({
    accessories: [{ slot: 'head', assetId: 'x' }, { slot: 'head', assetId: 'y' }],
  });
  assert.equal(r.ok, false);
});

test('M8 new fields: accessories, eye colour, brow style, expanded catalog', () => {
  // valid M8 payload passes
  let r = appearance.validateAppearanceV1({
    base: { skinToneId: 'onyx', eyeColorId: 'eye_green_01', browStyleId: 'brow_bold_01' },
    hair: { styleId: 'hair_bun_01', colorId: 'hair_auburn_01' },
    clothing: { topId: 'top_agbada_01', bottomId: 'bottom_trouser_01', shoeId: 'shoe_sandal_01' },
    accessories: [
      { slot: 'head', assetId: 'acc_cap_01' },
      { slot: 'face', assetId: 'acc_glasses_01' },
      { slot: 'ears', assetId: 'acc_earrings_01' },
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.appearance.base.skinToneId, 'onyx');
  assert.equal(r.appearance.base.eyeColorId, 'eye_green_01');
  assert.equal(r.appearance.base.browStyleId, 'brow_bold_01');
  assert.equal(r.appearance.accessories.length, 3);
  // unknown ids reject
  r = appearance.validateAppearanceV1({ base: { eyeColorId: 'eye_purple_01' } });
  assert.equal(r.ok, false);
  r = appearance.validateAppearanceV1({ base: { browStyleId: 'brow_wild_01' } });
  assert.equal(r.ok, false);
  r = appearance.validateAppearanceV1({ base: { skinToneId: 'ultraviolet' } });
  assert.equal(r.ok, false);
  r = appearance.validateAppearanceV1({ hair: { styleId: 'hair_mullet_99' } });
  assert.equal(r.ok, false);
  r = appearance.validateAppearanceV1({
    accessories: [{ slot: 'face', assetId: 'acc_monocle_99' }],
  });
  assert.equal(r.ok, false);
  // missing M8 fields default
  r = appearance.validateAppearanceV1({});
  assert.equal(r.ok, true);
  assert.equal(r.appearance.base.eyeColorId, 'eye_brown_01');
  assert.equal(r.appearance.base.browStyleId, 'brow_natural_01');
  assert.deepEqual(r.appearance.accessories, []);
});

test('M6 legacyLookToV1: total, mirrors migrate policy', () => {
  // null/garbage → defaults, never throws
  for (const bad of [null, undefined, 'nope', 42, [], { body: 'alien', hair: 'mohawk', outfit: 'spacesuit' }]) {
    const a = appearance.legacyLookToV1(bad, 'c1');
    assert.equal(a.schemaVersion, 1);
    assert.equal(appearance.validateAppearanceV1(a).ok, true);
  }
  // full legacy look
  const a = appearance.legacyLookToV1(LEGACY_LOOK, 'c9');
  assert.equal(a.base.bodyType, 'masculine');
  assert.equal(a.base.bodyPresetId, 'man');
  assert.equal(a.base.skinToneId, 'mahogany');
  assert.equal(a.hair.styleId, 'locs');
  assert.equal(a.hair.colorId, 'hair_black_01');
  // office decomposition: shirt + oxfords, no outerwear
  assert.equal(a.clothing.topId, 'top_shirt_office_01');
  assert.equal(a.clothing.bottomId, 'bottom_trouser_01');
  assert.equal(a.clothing.outerwearId, null);
  assert.equal(a.clothing.shoeId, 'shoe_oxford_01');
  assert.equal(a.clothing.topColor, '#f472b6'); // normalized
  assert.equal(appearance.validateAppearanceV1(a).ok, true);
});

// ---------------- GET /characters/:id/appearance ----------------

test('M6 GET appearance: null + rev 0 on fresh character', async () => {
  const A = await seedGuest();
  const r = await get(`/api/characters/${A.characterId}/appearance`, A.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.appearance, null);
  assert.equal(r.json.revision, 0);
});

test('M6 GET appearance: legacy flat JSON returned verbatim (client migrates)', async () => {
  const A = await seedGuest({ avatar_look: LEGACY_LOOK });
  // POST /characters → sanitizeAvatar normalizes colours; the GET must
  // return exactly what was stored (not migrated server-side).
  const stored = { ...LEGACY_LOOK, topColor: '#f472b6' };
  const r = await get(`/api/characters/${A.characterId}/appearance`, A.token);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.appearance, stored);
  assert.equal(r.json.revision, 0);
  // DB untouched by the read
  const row = await db.getCharacter(A.userId);
  assert.deepEqual(JSON.parse(row.avatar_look), stored);
});

test('M6 GET appearance: 404 cross-user / missing', async () => {
  const A = await seedGuest();
  const B = await seedGuest();
  const cross = await get(`/api/characters/${A.characterId}/appearance`, B.token);
  assert.equal(cross.status, 404);
  const missing = await get('/api/characters/999999/appearance', A.token);
  assert.equal(missing.status, 404);
  const anon = await get(`/api/characters/${A.characterId}/appearance`);
  assert.equal(anon.status, 401);
});

// ---------------- PUT /characters/:id/appearance ----------------

test('M6 PUT appearance: happy path stores canonical v1 + bumps rev', async () => {
  const A = await seedGuest();
  const draft = {
    schemaVersion: 1,
    base: { bodyType: 'masculine', bodyPresetId: 'man', skinToneId: 'deep_espresso' },
    hair: { styleId: 'afro' },
    clothing: { fabricId: 'ankara', topColor: '#F472B6' }, // uppercase → normalized
  };
  const r = await put(`/api/characters/${A.characterId}/appearance`, { appearance: draft, expectedRev: 0 }, A.token);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.revision, 1);
  const a = r.json.appearance;
  assert.equal(a.schemaVersion, 1);
  assert.equal(a.characterId, String(A.characterId));
  assert.equal(a.base.skinToneId, 'deep_espresso');
  assert.equal(a.hair.styleId, 'afro');
  assert.equal(a.hair.colorId, 'hair_black_01'); // default filled
  assert.equal(a.clothing.topColor, '#f472b6'); // normalized
  assert.equal(a.clothing.bottomId, 'bottom_trouser_01'); // default filled
  assert.equal(Object.keys(a.morphs).length, 9);
  // DB: canonical JSON + rev bumped
  const row = await db.getCharacter(A.userId);
  assert.equal(Number(row.appearance_rev), 1);
  assert.deepEqual(JSON.parse(row.avatar_look), a);
});

test('M6 PUT appearance: 409 on stale rev carries current revision', async () => {
  const A = await seedGuest();
  const first = await put(`/api/characters/${A.characterId}/appearance`, { appearance: {}, expectedRev: 0 }, A.token);
  assert.equal(first.status, 200);
  assert.equal(first.json.revision, 1);
  const stale = await put(`/api/characters/${A.characterId}/appearance`, { appearance: {}, expectedRev: 0 }, A.token);
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error, 'revision_conflict');
  assert.equal(stale.json.revision, 1);
  // stale write must not have changed anything
  const row = await db.getCharacter(A.userId);
  assert.equal(Number(row.appearance_rev), 1);
  // correct rev succeeds again
  const ok = await put(`/api/characters/${A.characterId}/appearance`, { appearance: {}, expectedRev: 1 }, A.token);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.revision, 2);
});

test('M6 PUT appearance: 400 on bad ids/morphs', async () => {
  const A = await seedGuest();
  let r = await put(`/api/characters/${A.characterId}/appearance`,
    { appearance: { hair: { styleId: 'mohawk' } }, expectedRev: 0 }, A.token);
  assert.equal(r.status, 400);
  assert.ok(Array.isArray(r.json.errors) && r.json.errors.length > 0);
  r = await put(`/api/characters/${A.characterId}/appearance`,
    { appearance: { morphs: { jawWidth: 2 } }, expectedRev: 0 }, A.token);
  assert.equal(r.status, 400);
  r = await put(`/api/characters/${A.characterId}/appearance`,
    { appearance: { clothing: { topColor: '#123456' } }, expectedRev: 0 }, A.token);
  assert.equal(r.status, 400);
  // failed validation never bumps the rev
  const row = await db.getCharacter(A.userId);
  assert.equal(Number(row.appearance_rev), 0);
});

test('M6 PUT appearance: 403 cross-user, 404 missing', async () => {
  const A = await seedGuest();
  const B = await seedGuest();
  const cross = await put(`/api/characters/${A.characterId}/appearance`,
    { appearance: {}, expectedRev: 0 }, B.token);
  assert.equal(cross.status, 403);
  const missing = await put('/api/characters/999999/appearance',
    { appearance: {}, expectedRev: 0 }, A.token);
  assert.equal(missing.status, 404);
});

test('M6 persistAppearance: ownership is by user id, never client-supplied', async () => {
  const A = await seedGuest();
  const B = await seedGuest();
  await assert.rejects(
    appearance.persistAppearance({ userId: B.userId, characterId: A.characterId, appearance: {}, expectedRev: null }),
    (e) => e && e.code === 'not_found');
  // force-write (expectedRev null) still bumps rev
  const r1 = await appearance.persistAppearance({ userId: A.userId, characterId: A.characterId, appearance: {}, expectedRev: null });
  assert.equal(r1.revision, 1);
  const r2 = await appearance.persistAppearance({ userId: A.userId, characterId: A.characterId, appearance: {}, expectedRev: null });
  assert.equal(r2.revision, 2);
  // stale rev conflicts
  await assert.rejects(
    appearance.persistAppearance({ userId: A.userId, characterId: A.characterId, appearance: {}, expectedRev: 1 }),
    (e) => e && e.code === 'revision_conflict' && e.revision === 2);
});

// ---------------- GET /api/avatar/catalog ----------------

test('M6 GET /api/avatar/catalog: shape + ids match the M2 manifest', async () => {
  const A = await seedGuest();
  const r = await get('/api/avatar/catalog', A.token);
  assert.equal(r.status, 200);
  const cat = r.json;
  assert.equal(cat.schemaVersion, 1);
  assert.deepEqual(cat.bodies, ['woman', 'man']);
  assert.deepEqual(cat.bodyPresets, ['woman', 'man']);
  assert.deepEqual(cat.facePresets, ['face_default_01']);
  assert.deepEqual(cat.skins, [
    'onyx', 'deep_espresso', 'dark_cocoa', 'truffle', 'burnt_caramel',
    'mahogany', 'walnut', 'sienna', 'cocoa', 'coffee',
    'caramel', 'latte', 'honey', 'sand', 'butterscotch',
    'amber', 'cream', 'ivory',
  ]);
  assert.deepEqual(cat.eyeColors, ['eye_brown_01', 'eye_hazel_01', 'eye_amber_01', 'eye_green_01']);
  assert.deepEqual(cat.browStyles, ['brow_natural_01', 'brow_bold_01', 'brow_arched_01', 'brow_trimmed_01']);
  assert.deepEqual(cat.hairs, ['lowcut', 'bald', 'curls', 'afro', 'locs', 'braids', 'classic', 'hair_taper_fade_01', 'hair_waves_01', 'hair_bun_01', 'hair_ponytail_01', 'hair_mohawk_01', 'hair_bantu_knots_01']);
  assert.deepEqual(cat.hairColors, ['hair_black_01', 'hair_dark_brown_01', 'hair_brown_01', 'hair_auburn_01', 'hair_blonde_01', 'hair_grey_01']);
  assert.deepEqual(cat.facialHair, ['facialhair_none_01', 'facialhair_mustache_01', 'facialhair_goatee_01', 'facialhair_beard_short_01']);
  assert.deepEqual(cat.fabrics, ['plain', 'ankara', 'adire', 'asoke']);
  assert.deepEqual(cat.tops, ['top_tee_01', 'top_shirt_office_01', 'top_tank_01', 'top_agbada_01', 'top_dress_01']);
  assert.deepEqual(cat.bottoms, ['bottom_trouser_01', 'bottom_short_01', 'bottom_cargo_01', 'bottom_skirt_01']);
  assert.deepEqual(cat.outerwear, ['outer_hoodie_01', 'outer_hivis_vest_01']);
  assert.deepEqual(cat.shoes, ['shoe_sneaker_01', 'shoe_oxford_01', 'shoe_boot_01', 'shoe_sandal_01', 'shoe_heel_01']);
  assert.deepEqual(cat.outfits, ['casual', 'hoodie', 'office', 'chill', 'sitework']);
  assert.deepEqual(cat.accessories, ['acc_glasses_01', 'acc_cap_01', 'acc_earrings_01']);
  assert.equal(cat.morphs.length, 9);
  assert.deepEqual(cat.morphs.map(m => m.key), [
    'jawWidth', 'cheekboneHeight', 'noseWidth', 'noseLength', 'lipFullness',
    'browProminence', 'chinLength', 'eyeSpacing', 'foreheadSlope',
  ]);
  for (const m of cat.morphs) {
    assert.equal(m.default, 0.5);
    assert.equal(m.min, 0);
    assert.equal(m.max, 1);
  }
});

// ---------------- WS save_avatar (legacy path) ----------------

test('M6 WS save_avatar: valid flat look migrates to v1 + bumps rev', async () => {
  const A = await seedGuest();
  const { ws, msgs } = await connectAs(A);
  ws.send(JSON.stringify({ t: 'act', a: 'save_avatar', avatar: LEGACY_LOOK }));
  const you = await waitFor(msgs, m => m.t === 'you' && m.you.avatar_look && m.you.avatar_look.schemaVersion === 1);
  assert.equal(you.you.avatar_look.hair.styleId, 'locs');
  assert.equal(you.you.avatar_look.base.skinToneId, 'mahogany');
  assert.equal(you.you.avatar_look.clothing.topColor, '#f472b6');
  assert.match(you.note || '', /new look is saved/i);
  const row = await db.getCharacter(A.userId);
  assert.equal(Number(row.appearance_rev), 1);
  assert.deepEqual(JSON.parse(row.avatar_look), you.you.avatar_look);
  // second save bumps again (force-write, no rev gate on legacy path)
  const from = msgs.length;
  ws.send(JSON.stringify({ t: 'act', a: 'save_avatar', avatar: LEGACY_LOOK }));
  await waitForNew(msgs, from, m => m.t === 'you' && m.you.avatar_look);
  const row2 = await db.getCharacter(A.userId);
  assert.equal(Number(row2.appearance_rev), 2);
  ws.close();
});

test('M6 WS save_avatar: invalid legacy fields fall back per migrate policy (no err)', async () => {
  const A = await seedGuest();
  const { ws, msgs } = await connectAs(A);
  ws.send(JSON.stringify({
    t: 'act', a: 'save_avatar',
    avatar: { ...LEGACY_LOOK, hair: 'mohawk', body: 'alien' },
  }));
  const you = await waitFor(msgs, m => m.t === 'you' && m.you.avatar_look && m.you.avatar_look.schemaVersion === 1);
  // unknown ids fall back to defaults — never rejected, never garbage
  assert.equal(you.you.avatar_look.hair.styleId, 'lowcut');
  assert.equal(you.you.avatar_look.base.bodyPresetId, 'woman');
  const row = await db.getCharacter(A.userId);
  assert.equal(Number(row.appearance_rev), 1);
  ws.close();
});
