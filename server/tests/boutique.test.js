// Phase 6 — Boutique clothing shop.
// - GET /api/boutique: catalog (12 items) + owned flags + balance.
// - POST /api/boutique/buy: unknown item → 400; already owned → 400;
//   can't afford → 400; success → coins decrease, wardrobe row, 'boutique'
//   receipt; admin buy is free (stealth bypass).
// - Appearance PUT: premium outfit clothing without ownership → 400;
//   after buying → 200. Wardrobe persists across reads.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-boutique-secret';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');

let app, base;
test.before(async () => { app = await createApp(); const port = await app.start(0); base = `http://127.0.0.1:${port}`; });
test.after(async () => { await app.close(); });

let n = 0;
async function seedUser({ money = 200_000, admin = false } = {}) {
  n += 1;
  const id = await db.createUser({ username: 'bqseed' + n });
  if (admin) await db.setAdmin(id, true);
  const c = await db.ensureCharacter(id, 'BqT' + n);
  c.money = money;
  await db.saveCharacter(c);
  const char = await db.getCharacter(id);
  return { id, token: signToken(id), characterId: char.id };
}
async function post(p, body, token) {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}
async function get(p, token) {
  const r = await fetch(base + p, { headers: { authorization: `Bearer ${token}` } });
  return { status: r.status, json: await r.json() };
}
async function put(p, body, token) {
  const r = await fetch(base + p, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}

// Senator decomposition (mirrors client OUTFIT_ROWS).
const SENATOR_CLOTHING = {
  topId: 'top_agbada_01',
  bottomId: 'bottom_trouser_01',
  outerwearId: null,
  shoeId: 'shoe_oxford_01',
};

test('GET /api/boutique: 12 items, owned=false, balance', async () => {
  const u = await seedUser();
  const r = await get('/api/boutique', u.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.items.length, 12);
  assert.ok(r.json.items.every((i) => i.owned === false));
  assert.equal(r.json.balance, 200_000);
  const prices = r.json.items.map((i) => i.price);
  assert.ok(Math.min(...prices) >= 15000);
  assert.ok(Math.max(...prices) <= 1_800_000);
  const occasions = new Set(r.json.items.map((i) => i.occasion));
  for (const o of ['owambe', 'street', 'office', 'traditional']) assert.ok(occasions.has(o));
});

test('POST /api/boutique/buy: unknown item → 400', async () => {
  const u = await seedUser();
  const r = await post('/api/boutique/buy', { itemId: 'bq_nope' }, u.token);
  assert.equal(r.status, 400);
});

test('POST /api/boutique/buy: cannot afford → 400', async () => {
  const u = await seedUser({ money: 1000 });
  const r = await post('/api/boutique/buy', { itemId: 'bq_royalty' }, u.token);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /need/i);
});

test('POST /api/boutique/buy: success → coins down, wardrobe row, receipt', async () => {
  const u = await seedUser({ money: 200_000 });
  const r = await post('/api/boutique/buy', { itemId: 'bq_dashiki' }, u.token);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.item.owned, true);
  assert.equal(r.json.balance, 200_000 - 45_000);
  assert.deepEqual(await db.getWardrobe(u.id), ['bq_dashiki']);
  const txns = (await db.listTransactions(u.id, 50)).filter((t) => t.kind === 'boutique');
  assert.equal(txns.length, 1);
  assert.equal(txns[0].amount, -45_000);
  // catalog now shows owned
  const cat = await get('/api/boutique', u.token);
  assert.equal(cat.json.items.find((i) => i.id === 'bq_dashiki').owned, true);
});

test('POST /api/boutique/buy: already owned → 400', async () => {
  const u = await seedUser({ money: 200_000 });
  await post('/api/boutique/buy', { itemId: 'bq_dashiki' }, u.token);
  const r = await post('/api/boutique/buy', { itemId: 'bq_dashiki' }, u.token);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /already own/i);
});

test('POST /api/boutique/buy: admin stealth — free, balance untouched', async () => {
  const u = await seedUser({ money: 5000, admin: true });
  const r = await post('/api/boutique/buy', { itemId: 'bq_royalty' }, u.token);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.balance, 5000);
  assert.deepEqual(await db.getWardrobe(u.id), ['bq_royalty']);
});

test('PUT appearance: premium outfit without ownership → 400', async () => {
  const u = await seedUser();
  const draft = {
    schemaVersion: 1,
    base: { bodyType: 'masculine', bodyPresetId: 'man', skinToneId: 'cocoa' },
    hair: { styleId: 'lowcut' },
    clothing: SENATOR_CLOTHING,
  };
  const r = await put(`/api/characters/${u.characterId}/appearance`, { appearance: draft, expectedRev: 0 }, u.token);
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.match(r.json.error, /boutique/i);
});

test('PUT appearance: premium outfit after buying → 200', async () => {
  const u = await seedUser({ money: 200_000 });
  const buy = await post('/api/boutique/buy', { itemId: 'bq_senator' }, u.token);
  assert.equal(buy.status, 201);
  const cur = await get(`/api/characters/${u.characterId}/appearance`, u.token);
  const draft = {
    schemaVersion: 1,
    base: { bodyType: 'masculine', bodyPresetId: 'man', skinToneId: 'cocoa' },
    hair: { styleId: 'lowcut' },
    clothing: SENATOR_CLOTHING,
  };
  const r = await put(
    `/api/characters/${u.characterId}/appearance`,
    { appearance: draft, expectedRev: cur.json.revision },
    u.token
  );
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.appearance.clothing.topId, 'top_agbada_01');
  assert.equal(r.json.appearance.clothing.shoeId, 'shoe_oxford_01');
});

test('PUT appearance: free outfits still save without boutique', async () => {
  const u = await seedUser();
  const draft = {
    schemaVersion: 1,
    base: { bodyType: 'feminine', bodyPresetId: 'woman', skinToneId: 'cocoa' },
    hair: { styleId: 'braids' },
    clothing: {
      topId: 'top_dress_01',
      bottomId: 'bottom_skirt_01',
      outerwearId: null,
      shoeId: 'shoe_heel_01', // free owambe
    },
  };
  const r = await put(`/api/characters/${u.characterId}/appearance`, { appearance: draft, expectedRev: 0 }, u.token);
  assert.equal(r.status, 200, JSON.stringify(r.json));
});
