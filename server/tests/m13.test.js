// M13 tests: map billboards — validation (pure), storage round-trips,
// REST endpoints mounted from the module's own REST_SPEC (end-to-end via
// HTTP on a throwaway Express app; the coordinator mounts the same spec in
// routes/api.js and routes/admin.js), seed-once behavior, and 403s.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.SESSION_SECRET = 'test'
process.env.EKO_DB_PATH = ':memory:';

const db = await import('../src/db.js');
const m13 = await import('../src/game/v2/m13.js');

await db.initDb();
await m13.ensureSchema();

/** Mount REST_SPEC on a fresh Express app. injectAdmin=false simulates a
 *  non-admin caller (admin handlers must 403 when req.admin is missing). */
function mountSpec(injectAdmin) {
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  for (const r of m13.REST_SPEC) {
    app[r.method.toLowerCase()](r.path, async (req, res) => {
      if (r.admin && injectAdmin) req.admin = { id: 7, username: 'boss' };
      try {
        await r.handler(req, res);
      } catch (e) {
        console.error('handler threw:', e);
        if (!res.headersSent) res.status(500).json({ error: 'boom' });
      }
    });
  }
  return app;
}

let baseAdmin, baseAnon, servers;

test.before(async () => {
  const listen = (app) =>
    new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
  servers = [await listen(mountSpec(true)), await listen(mountSpec(false))];
  baseAdmin = `http://127.0.0.1:${servers[0].address().port}`;
  baseAnon = `http://127.0.0.1:${servers[1].address().port}`;
});

test.after(async () => {
  for (const s of servers) await new Promise((r) => s.close(r));
});

async function call(base, method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await r.json(); } catch { /* ignore */ }
  return { status: r.status, json };
}

const VALID = {
  headline: 'Test Ad',
  subtext: 'Buy things, thank us later.',
  bg: '#111827', fg: '#f9fafb', accent: '#f59e0b',
  x: 50, y: 50, scale: 1.5,
};

// ---- pure validation ----

test('validateBillboard: accepts a good payload, applies defaults', () => {
  const v = m13.validateBillboard({ headline: 'Hi', x: 1, y: 2 });
  assert.equal(v.ok, true);
  assert.equal(v.value.bg, '#0f172a');
  assert.equal(v.value.scale, 1);
  assert.equal(v.value.subtext, '');
});

test('validateBillboard: rejects bad colors, coords, scale, text length', () => {
  for (const bad of [
    { ...VALID, bg: 'red' },
    { ...VALID, fg: '#fff' },        // 3-digit shorthand not allowed
    { ...VALID, accent: '#gggggg' },
    { ...VALID, x: 101 },
    { ...VALID, y: -1 },
    { ...VALID, x: 'far' },
    { ...VALID, scale: 0.4 },
    { ...VALID, scale: 3.1 },
    { ...VALID, headline: 'x'.repeat(61) },
    { ...VALID, subtext: 'x'.repeat(121) },
    { headline: '   ', x: 1, y: 1 }, // blank headline
    { x: 1, y: 1 },                  // missing headline
  ]) {
    const v = m13.validateBillboard(bad);
    assert.equal(v.ok, false, `expected rejection: ${JSON.stringify(bad).slice(0, 60)}`);
    assert.ok(typeof v.error === 'string' && v.error.length > 0);
  }
});

test('validateBillboard: profanity is masked via cleanText', () => {
  const v = m13.validateBillboard({ headline: 'shit happens daily', x: 1, y: 1 });
  assert.equal(v.ok, true);
  assert.ok(!/shit/i.test(v.value.headline), v.value.headline);
});

test('validateBillboardPatch: partial ok, empty/invalid rejected', () => {
  assert.equal(m13.validateBillboardPatch({ headline: 'New' }).ok, true);
  assert.equal(m13.validateBillboardPatch({ active: 0 }).ok, true);
  assert.equal(m13.validateBillboardPatch({}).ok, false);
  assert.equal(m13.validateBillboardPatch({ bg: 'nope' }).ok, false);
  assert.equal(m13.validateBillboardPatch({ x: 200 }).ok, false);
  assert.equal(m13.validateBillboardPatch({ headline: '' }).ok, false);
});

// ---- seed ----

test('ensureSchema seeds 6 billboards exactly once', async () => {
  const before = await m13.listBillboards();
  assert.equal(before.length, 6);
  await m13.ensureSchema();
  await m13.ensureSchema();
  const after = await m13.listBillboards();
  assert.equal(after.length, 6);
  // Seeds carry the required fields and sane coords.
  for (const b of after) {
    assert.ok(b.headline.length >= 1 && b.headline.length <= 60);
    assert.ok(/^#[0-9a-fA-F]{6}$/.test(b.bg));
    assert.ok(b.x >= 0 && b.x <= 100 && b.y >= 0 && b.y <= 100);
    assert.ok(b.scale >= 0.5 && b.scale <= 3);
    assert.equal(b.active, true);
  }
});

// ---- public read ----

test('GET /api/v2/m13/billboards returns only active billboards', async () => {
  let r = await call(baseAnon, 'GET', '/api/v2/m13/billboards');
  assert.equal(r.status, 200);
  assert.equal(r.json.billboards.length, 6);

  // Deactivate one via the admin API; it must disappear from public reads.
  const target = r.json.billboards[0];
  r = await call(baseAdmin, 'PATCH', `/api/admin/billboards/${target.id}`, { active: false });
  assert.equal(r.status, 200);
  assert.equal(r.json.billboard.active, false);

  r = await call(baseAnon, 'GET', '/api/v2/m13/billboards');
  assert.equal(r.status, 200);
  assert.equal(r.json.billboards.length, 5);
  assert.ok(!r.json.billboards.some((b) => b.id === target.id));

  // Reactivate for the remaining tests.
  await call(baseAdmin, 'PATCH', `/api/admin/billboards/${target.id}`, { active: true });
});

// ---- admin CRUD ----

test('POST /api/admin/billboards creates (201) and shows up publicly', async () => {
  const r = await call(baseAdmin, 'POST', '/api/admin/billboards', VALID);
  assert.equal(r.status, 201);
  assert.equal(r.json.billboard.headline, 'Test Ad');
  assert.equal(r.json.billboard.x, 50);
  assert.equal(r.json.billboard.active, true);
  assert.ok(Number.isInteger(r.json.billboard.id));

  const pub = await call(baseAnon, 'GET', '/api/v2/m13/billboards');
  assert.ok(pub.json.billboards.some((b) => b.headline === 'Test Ad'));
});

test('POST rejects invalid payloads with 400', async () => {
  for (const bad of [
    { ...VALID, bg: 'not-a-color' },
    { ...VALID, x: 120 },
    { ...VALID, scale: 9 },
    { ...VALID, headline: 'x'.repeat(61) },
    {},
  ]) {
    const r = await call(baseAdmin, 'POST', '/api/admin/billboards', bad);
    assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(bad).slice(0, 50)}`);
    assert.ok(r.json.error);
  }
});

test('admin endpoints 403 without an admin identity', async () => {
  let r = await call(baseAnon, 'POST', '/api/admin/billboards', VALID);
  assert.equal(r.status, 403);
  r = await call(baseAnon, 'PATCH', '/api/admin/billboards/1', { headline: 'Hacked' });
  assert.equal(r.status, 403);
  r = await call(baseAnon, 'DELETE', '/api/admin/billboards/1', undefined);
  assert.equal(r.status, 403);
  // Public read stays open.
  r = await call(baseAnon, 'GET', '/api/v2/m13/billboards');
  assert.equal(r.status, 200);
});

test('PATCH edits fields; DELETE removes; unknown ids 404', async () => {
  let r = await call(baseAdmin, 'POST', '/api/admin/billboards', { ...VALID, headline: 'Ephemeral' });
  const id = r.json.billboard.id;

  r = await call(baseAdmin, 'PATCH', `/api/admin/billboards/${id}`, {
    headline: 'Updated!', subtext: 'New sub', x: 10, y: 20, scale: 2, bg: '#000000',
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.billboard.headline, 'Updated!');
  assert.equal(r.json.billboard.subtext, 'New sub');
  assert.equal(r.json.billboard.scale, 2);

  r = await call(baseAdmin, 'PATCH', `/api/admin/billboards/${id}`, { bg: 'bad' });
  assert.equal(r.status, 400);

  r = await call(baseAdmin, 'PATCH', '/api/admin/billboards/999999', { headline: 'x' });
  assert.equal(r.status, 404);
  r = await call(baseAdmin, 'DELETE', '/api/admin/billboards/999999', undefined);
  assert.equal(r.status, 404);

  r = await call(baseAdmin, 'DELETE', `/api/admin/billboards/${id}`, undefined);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  r = await call(baseAdmin, 'DELETE', `/api/admin/billboards/${id}`, undefined);
  assert.equal(r.status, 404);

  const pub = await call(baseAnon, 'GET', '/api/v2/m13/billboards');
  assert.ok(!pub.json.billboards.some((b) => b.id === id));
});

test('storage round-trip via helpers', async () => {
  const created = await m13.createBillboard(
    { headline: 'Helper Ad', subtext: '', bg: '#111111', fg: '#eeeeee', accent: '#00ff00', x: 5, y: 5, scale: 0.5 },
    42
  );
  assert.equal(created.headline, 'Helper Ad');
  assert.equal(created.scale, 0.5);
  const got = await m13.getBillboard(created.id);
  assert.equal(got.headline, 'Helper Ad');
  const updated = await m13.updateBillboard(created.id, { active: 0, headline: 'Renamed' });
  assert.equal(updated.active, false);
  assert.equal(updated.headline, 'Renamed');
  const actives = await m13.listActiveBillboards();
  assert.ok(!actives.some((b) => b.id === created.id));
  assert.equal(await m13.deleteBillboard(created.id), true);
  assert.equal(await m13.getBillboard(created.id), null);
});
