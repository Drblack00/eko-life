// REST endpoint tests: health, stats, config, client-error, /me auth gate.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'test-secret-eko-rest';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');

let base, app;

test.before(async () => {
  app = await createApp();
  const port = await app.start(0);
  base = `http://127.0.0.1:${port}`;
});
test.after(async () => { await app.close(); });

async function post(p, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}
async function get(p, token) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(base + p, { headers });
  return { status: r.status, json: await r.json() };
}

test('GET /api/health', async () => {
  const { status, json } = await get('/api/health');
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.online, 0);
  assert.equal(json.day, 1);
  assert.equal(json.db, 'sqlite');
  assert.ok(typeof json.version === 'string');
});

test('GET /api/stats (public counters)', async () => {
  const { status, json } = await get('/api/stats');
  assert.equal(status, 200);
  assert.equal(json.online, 0);
  assert.equal(json.visits, 0);
  assert.equal(json.governor, null); // M1: no elections
  assert.equal(json.homes, 0);
  assert.equal(json.homesOnline, 0);
});

test('GET /api/config returns server-authoritative game data', async () => {
  const { status, json } = await get('/api/config');
  assert.equal(status, 200);
  assert.equal(json.locations.length, 68); // M3 world expansion
  assert.equal(json.jobs.length, 10);     // M3 job paths
  assert.equal(json.food.length, 5);
  assert.equal(json.fun.length, 5);       // M3: +club_night
  assert.ok(json.classes.silver_spoon);
  assert.ok(json.classes.street_smart);
  assert.equal(json.classes.silver_spoon.startMoney, 50000);
  assert.equal(json.classes.street_smart.payMult, 1.1);
  assert.equal(typeof json.spawn, 'string');
  assert.ok(json.locations.some(l => l.id === json.spawn));
  assert.deepEqual(json.bounds, { xMin: 0, xMax: 100, yMin: 0, yMax: 100 });
  // map coords in range
  for (const l of json.locations) {
    assert.ok(l.x >= 0 && l.x <= 100 && l.y >= 0 && l.y <= 100, `location ${l.id} out of bounds`);
  }
});

test('POST /api/auth/guest rejects without ageConfirm', async () => {
  const { status, json } = await post('/api/auth/guest', { ageConfirm: false });
  assert.equal(status, 400);
  assert.match(json.error, /18/);
});

test('POST /api/client-error logs and returns ok', async () => {
  const { status, json } = await post('/api/client-error', { message: 'boom', where: 'test' });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
});

test('GET /api/me requires auth', async () => {
  const noAuth = await get('/api/me');
  assert.equal(noAuth.status, 401);
  const badToken = await get('/api/me', 'bogus-token');
  assert.equal(badToken.status, 401);
});

test('GET /api/me returns full character state', async () => {
  const g = await post('/api/auth/guest', { ageConfirm: true });
  assert.equal(g.status, 200);
  const { status, json } = await get('/api/me', g.json.token);
  assert.equal(status, 200);
  assert.equal(json.username, g.json.username);
  assert.equal(json.money, 5000); // street_smart default
  assert.equal(json.guest, true);
  assert.ok(json.stats);
  assert.equal(json.day, 1);
});
