// Home City V1 tests: migration 010, city choice at creation, /api/me city
// fields, city-scoped venues, and inter-city travel (fares, insufficient
// funds). Gameplay coins only — no real money anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'test-secret-eko-cities';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const cities = await import('../src/game/cities.js');

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

let n = 0;
async function seedUser() {
  n += 1;
  const username = 'cityu' + n;
  const userId = await db.createUser({ username, is_guest: 1 });
  return { userId, username, token: signToken(userId) };
}

test('migration 010: cities table seeded, characters columns present', async () => {
  const rows = await db.dbAll('SELECT * FROM cities', 'SELECT * FROM cities', []);
  assert.ok(rows, 'cities table readable');
  assert.equal(rows.length, 4);
  const ids = rows.map((r) => r.id).sort();
  assert.deepEqual(ids, ['abuja', 'benin', 'lagos', 'ph']);
  const lagos = rows.find((r) => r.id === 'lagos');
  assert.equal(lagos.name, 'Lagos');
  assert.ok(Number(lagos.starting_cash) > 0);

  const c = await db.getCharacter((await seedUser()).userId);
  assert.equal(c.home_city, 'lagos');
  assert.equal(c.current_city, 'lagos');
});

test('character creation accepts a city: sets home/current city, spawn, cash', async () => {
  const u = await seedUser();
  const r = await post('/api/characters', {
    name: 'Adaeze', class: 'street_smart', avatar: '🧑', color: '#22d3ee', city: 'benin',
  }, u.token);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const ch = r.json.character;
  assert.equal(ch.homeCity, 'benin');
  assert.equal(ch.currentCity, 'benin');
  assert.equal(ch.city.name, 'Benin City');
  assert.equal(ch.locationId, 'benin_ring_road');
  // class startMoney (5000) + city starting cash (3000)
  assert.equal(ch.money, 5000 + cities.getCity('benin').starting_cash);

  const me = await get('/api/me', u.token);
  assert.equal(me.json.homeCity, 'benin');
  assert.equal(me.json.currentCity, 'benin');
  assert.equal(me.json.city.id, 'benin');
});

test('character creation rejects an unknown city', async () => {
  const u = await seedUser();
  const r = await post('/api/characters', {
    name: 'Xavier', class: 'street_smart', avatar: '🧑', color: '#22d3ee', city: 'atlantis',
  }, u.token);
  assert.equal(r.status, 400);
});

test('city-scoped venues: city venue hidden elsewhere, scoped filtering works', async () => {
  const cfg = await get('/api/config');
  assert.equal(cfg.status, 200);
  const locs = cfg.json.locations;
  assert.ok(locs.length > 68, 'city venues merged into config locations');

  const beninVenue = locs.find((l) => l.id === 'benin_ring_road');
  assert.ok(beninVenue);
  assert.deepEqual(beninVenue.cities, ['benin']);

  // Server helper: absent cities array = everywhere; scoped = only listed.
  const shared = { id: 'x', cities: undefined };
  const lagosOnly = { id: 'y', cities: ['lagos'] };
  assert.ok(cities.locationsForCity([shared, lagosOnly, beninVenue], 'ph').some((l) => l.id === 'x'));
  assert.ok(!cities.locationsForCity([shared, lagosOnly, beninVenue], 'ph').some((l) => l.id === 'y'));
  assert.ok(!cities.locationsForCity([shared, lagosOnly, beninVenue], 'ph').some((l) => l.id === 'benin_ring_road'));
  assert.ok(cities.locationsForCity([shared, lagosOnly, beninVenue], 'benin').some((l) => l.id === 'benin_ring_road'));

  // City jobs: 3 per non-Lagos city, all city-scoped.
  const jobs = cfg.json.jobs;
  const phJobs = jobs.filter((j) => j.cities && j.cities.includes('ph'));
  assert.equal(phJobs.length, 3);
  assert.ok(cities.jobsForCity(jobs, 'lagos').every((j) => !j.cities || j.cities.includes('lagos')));
});

test('travel: bus deducts fare and changes city', async () => {
  const u = await seedUser();
  await post('/api/characters', {
    name: 'Tayo', class: 'silver_spoon', avatar: '🧑', color: '#22d3ee',
  }, u.token); // defaults to lagos
  const before = (await get('/api/me', u.token)).json;
  assert.equal(before.currentCity, 'lagos');

  const fare = cities.cityTravelFare('lagos', 'ph', 'bus');
  assert.ok(fare > 0);
  const r = await post('/api/travel/city', { city: 'ph', mode: 'bus' }, u.token);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.fare, fare);
  assert.equal(r.json.city.id, 'ph');

  const after = (await get('/api/me', u.token)).json;
  assert.equal(after.currentCity, 'ph');
  assert.equal(after.money, before.money - fare);
  assert.equal(after.locationId, 'ph_oil_mill');
  assert.equal(after.homeCity, 'lagos', 'home city is unchanged by travel');
});

test('travel: flight is pricier than bus; same-city/unknown/mode rejected', async () => {
  const u = await seedUser();
  await post('/api/characters', {
    name: 'Tunde', class: 'silver_spoon', avatar: '🧑', color: '#22d3ee', city: 'abuja',
  }, u.token);
  const bus = cities.cityTravelFare('abuja', 'lagos', 'bus');
  const flight = cities.cityTravelFare('abuja', 'lagos', 'flight');
  assert.ok(flight > bus);

  const same = await post('/api/travel/city', { city: 'abuja', mode: 'bus' }, u.token);
  assert.equal(same.status, 400);
  const unknown = await post('/api/travel/city', { city: 'kano', mode: 'bus' }, u.token);
  assert.equal(unknown.status, 400);
  const badMode = await post('/api/travel/city', { city: 'lagos', mode: 'teleport' }, u.token);
  assert.equal(badMode.status, 400);
});

test('travel: insufficient funds rejected, city unchanged', async () => {
  const u = await seedUser();
  await post('/api/characters', {
    name: 'Broke', class: 'street_smart', avatar: '🧑', color: '#22d3ee',
  }, u.token);
  // Drain the wallet below the cheapest inter-city bus fare.
  const c = await db.getCharacter(u.userId);
  c.money = 100;
  await db.saveCharacter(c);

  const r = await post('/api/travel/city', { city: 'benin', mode: 'bus' }, u.token);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /need/i);
  const me = await get('/api/me', u.token);
  assert.equal(me.json.currentCity, 'lagos');
  assert.equal(me.json.money, 100);
});
