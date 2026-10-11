// Regression tests for the avatar-editor "Save doesn't persist" defect.
//
// ROOT CAUSE (found 2026-10-11): the M6 REST save
// (PUT /api/characters/:id/appearance) wrote avatar_look + appearance_rev to
// the DB, but the WS hub's in-memory character row was never updated (unlike
// the legacy WS save_avatar path, which syncs c.avatar_look/c.appearance_rev).
// The next saveCharacter() of that stale in-memory row — the 60s decay tick,
// any game act, a move-save, disconnect — did an UNCONDITIONAL
// `UPDATE ... SET avatar_look=?, appearance_rev=?`, silently clobbering the
// fresh REST write. The client had already shown "Saved ✓" (PUT really did
// return 200), but close + reopen reverted to defaults.
//
// These tests pin the fixed behavior:
//   1. REST PUT → stale saveCharacter (decay-tick simulation) → GET still
//      returns the saved look at the bumped revision.
//   2. The legacy WS save_avatar path keeps working (in-memory row is synced
//      there, so saveCharacter must still persist it).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-1234567890';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');

let base, app;

test.before(async () => {
  app = await createApp();
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

let guestN = 0;
async function seedGuest() {
  guestN += 1;
  const username = 'persistseed' + guestN;
  const userId = await db.createUser({ username, is_guest: 1 });
  const token = signToken(userId);
  const name = 'PS' + guestN + 'x' + Math.floor(Math.random() * 1e4);
  const cc = await post('/api/characters',
    { name, class: 'street_smart', avatar: '🧑', color: '#22d3ee' }, token);
  assert.equal(cc.status, 200, `character creation failed: ${JSON.stringify(cc.json)}`);
  const char = await db.getCharacter(userId);
  return { token, userId, characterId: char.id };
}

// Distinctive v1 look (mahogany skin + locs + beard), far from the defaults.
function distinctiveLook(characterId) {
  return {
    schemaVersion: 1,
    characterId: String(characterId),
    base: { bodyType: 'masculine', bodyPresetId: 'man', facePresetId: 'face_default_01', skinToneId: 'mahogany' },
    morphs: {},
    hair: { styleId: 'locs', colorId: 'hair_black_01', facialHairId: 'facialhair_beard_short_01' },
    clothing: {
      topId: 'top_tee_01', bottomId: 'bottom_cargo_01', outerwearId: null,
      shoeId: 'shoe_boot_01', fabricId: 'ankara', topColor: '#f472b6', bottomColor: '#111827',
    },
    accessories: [],
  };
}

test('save → stale saveCharacter (decay tick) → reopen: saved look survives', async () => {
  const u = await seedGuest();

  // The WS hub's in-memory row, loaded BEFORE the editor save (stale:
  // avatar_look null, appearance_rev 0).
  const staleInMemory = await db.getCharacter(u.userId);
  assert.equal(staleInMemory.avatar_look, null);

  // Editor save via REST: the client sees 200 and shows "Saved ✓".
  const p1 = await put(
    `/api/characters/${u.characterId}/appearance`,
    { appearance: distinctiveLook(u.characterId), expectedRev: 0 },
    u.token);
  assert.equal(p1.status, 200, `PUT failed: ${JSON.stringify(p1.json)}`);
  assert.equal(p1.json.revision, 1);

  // <60s later the decay tick / any act / move-save persists the STALE
  // in-memory row. This must NOT clobber the fresh write.
  await db.saveCharacter(staleInMemory);

  // Close + reopen: the editor GETs the appearance again.
  const g = await get(`/api/characters/${u.characterId}/appearance`, u.token);
  assert.equal(g.status, 200);
  assert.equal(g.json.revision, 1, 'revision was clobbered by the stale saveCharacter');
  assert.equal(
    g.json.appearance && g.json.appearance.base && g.json.appearance.base.skinToneId,
    'mahogany',
    'saved look was clobbered by the stale saveCharacter — reopen reverts to defaults');
  assert.equal(g.json.appearance.hair.styleId, 'locs');
});

test('saveCharacter with a FRESH in-memory row still persists avatar columns', async () => {
  const u = await seedGuest();

  // Simulate the legacy WS save_avatar path: persistAppearance + in-memory
  // sync (as server/src/game/actions.js does), then a normal saveCharacter.
  const { persistAppearance } = await import('../src/game/appearance.js');
  const result = await persistAppearance({
    userId: u.userId,
    characterId: u.characterId,
    appearance: distinctiveLook(u.characterId),
    expectedRev: null, // force-write, like the legacy path
  });
  assert.equal(result.revision, 1);
  const freshInMemory = await db.getCharacter(u.userId);
  freshInMemory.avatar_look = JSON.stringify(result.appearance);
  freshInMemory.appearance_rev = result.revision;
  await db.saveCharacter(freshInMemory);

  const g = await get(`/api/characters/${u.characterId}/appearance`, u.token);
  assert.equal(g.json.revision, 1);
  assert.equal(g.json.appearance.base.skinToneId, 'mahogany');
});

test('two sequential REST saves both stick (rev 1 → 2)', async () => {
  const u = await seedGuest();
  const look1 = distinctiveLook(u.characterId);
  const p1 = await put(
    `/api/characters/${u.characterId}/appearance`,
    { appearance: look1, expectedRev: 0 }, u.token);
  assert.equal(p1.status, 200);
  const look2 = { ...look1, hair: { ...look1.hair, styleId: 'afro' } };
  const p2 = await put(
    `/api/characters/${u.characterId}/appearance`,
    { appearance: look2, expectedRev: 1 }, u.token);
  assert.equal(p2.status, 200);
  assert.equal(p2.json.revision, 2);
  const g = await get(`/api/characters/${u.characterId}/appearance`, u.token);
  assert.equal(g.json.revision, 2);
  assert.equal(g.json.appearance.hair.styleId, 'afro');
});
