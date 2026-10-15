// Live Events Calendar tests: listing (day groups, order, live flag),
// RSVP upsert + cancel, attendee count math (base + real RSVPs).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'events-test-secret';
process.env.EKO_DB_PATH = ':memory:';

// NOTE: the /api/events mount lines live in server/src/app.js (added by the
// parent agent — see the mount snippet in the delivery report). This file
// mounts createEventsRouter() on a bare express app sharing the same
// in-memory DB so the route is fully exercised without touching app.js.
const { createApp } = await import('../src/app.js');
const { createEventsRouter } = await import('../src/routes/events.js');
const express = (await import('express')).default;
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');

let base, app, routeServer;
test.before(async () => {
  // Full boot: runs migrations (004/005/006 seed the events).
  app = await createApp();
  const routeApp = express();
  routeApp.use(express.json());
  routeApp.use('/api/events', createEventsRouter());
  const port = await new Promise((resolve) => {
    routeServer = routeApp.listen(0, '127.0.0.1', () => resolve(routeServer.address().port));
  });
  base = `http://127.0.0.1:${port}`;
});
test.after(async () => {
  await new Promise((resolve) => routeServer.close(resolve));
  await app.close();
});

async function req(method, p, body, token) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const opts = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(base + p, opts);
  return { status: r.status, json: await r.json() };
}
const get = (p, t) => req('GET', p, undefined, t);
const post = (p, b, t) => req('POST', p, b, t);
const del = (p, t) => req('DELETE', p, undefined, t);

let n = 0;
async function seedUser() {
  n += 1;
  const username = 'evu' + n;
  const userId = await db.createUser({ username, is_guest: 1 });
  return { userId, username, token: signToken(userId) };
}

let A, B, all;
test('setup users', async () => {
  A = await seedUser();
  B = await seedUser();
  assert.ok(A.token && B.token);
});

test('GET /api/events requires auth', async () => {
  const r = await get('/api/events');
  assert.equal(r.status, 401);
});

test('GET /api/events: seeded list shape + order', async () => {
  const r = await get('/api/events', A.token);
  assert.equal(r.status, 200);
  const { seasons, days, now } = r.json;
  assert.ok(typeof now === 'number');
  all = days.flatMap((d) => d.events);
  assert.ok(all.length >= 6, `expected >= 6 seeded events, got ${all.length}`);
  // ascending by startsAt
  const starts = all.map((e) => e.startsAt);
  assert.deepEqual([...starts].sort((a, b) => a - b), starts);
  // each event has a group label; ids/titles present
  assert.ok(days.every((d) => typeof d.label === 'string' && d.label.length > 0));
  assert.ok(all.every((e) => e.id && e.title && e.venue && typeof e.attendees === 'number'));
  // no event without a group; all events sit inside exactly one group
  assert.equal(all.length, days.reduce((s, d) => s + d.events.length, 0));
});

test('GET /api/events: season banner from Detty December', async () => {
  const r = await get('/api/events', A.token);
  assert.equal(r.status, 200);
  const detty = r.json.seasons.find((s) => s.tag === 'detty-december');
  assert.ok(detty, 'detty-december season banner present');
  assert.equal(detty.title, 'Detty December');
  assert.equal(detty.window, 'Dec 1 – Jan 5');
  assert.match(detty.blurb, /beach raves/);
});

test('GET /api/events: exactly one live event right now', async () => {
  const r = await get('/api/events', A.token);
  assert.equal(r.status, 200);
  const live = r.json.days.flatMap((d) => d.events).filter((e) => e.isLive);
  assert.equal(live.length, 1, `expected 1 live event, got ${live.length}`);
  assert.equal(live[0].id, 'freestyle-friday');
  assert.equal(live[0].title, 'Freestyle Friday');
});

test('GET /api/events: today group labelled "TODAY · <DAY>"', async () => {
  const r = await get('/api/events', A.token);
  assert.equal(r.status, 200);
  const liveDay = r.json.days.find((d) => d.events.some((e) => e.id === 'freestyle-friday'));
  assert.ok(liveDay);
  assert.match(liveDay.label, /^TODAY · [A-Z]{3}$/);
});

test('GET /api/events/:id: detail shape', async () => {
  const r = await get('/api/events/owambe-saturdays', A.token);
  assert.equal(r.status, 200);
  const { event, attendees, goingCount } = r.json;
  assert.equal(event.id, 'owambe-saturdays');
  assert.equal(event.emoji, '🎉');
  assert.equal(event.venue, 'VI Event Hall');
  assert.ok(Array.isArray(event.details) && event.details.length === 3);
  assert.ok(event.details[0].rich.includes('VI Event Hall'));
  assert.equal(event.attendees, 1208 + goingCount);
  assert.ok(Array.isArray(attendees));
  assert.equal(event.myStatus, null);
});

test('GET /api/events/:id: 404 for unknown id', async () => {
  const r = await get('/api/events/no-such-event', A.token);
  assert.equal(r.status, 404);
});

test('POST /api/events/:id/rsvp: join + attendee math', async () => {
  const before = (await get('/api/events/owambe-saturdays', A.token)).json;
  const r = await post('/api/events/owambe-saturdays/rsvp', { status: 'going' }, A.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.myStatus, 'going');
  assert.equal(r.json.attendees, before.event.attendees + 1);
  // viewer sees their status in list + detail
  const list = (await get('/api/events', A.token)).json;
  const row = list.days.flatMap((d) => d.events).find((e) => e.id === 'owambe-saturdays');
  assert.equal(row.myStatus, 'going');
  const detail = (await get('/api/events/owambe-saturdays', B.token)).json;
  assert.equal(detail.event.myStatus, null); // B hasn't RSVP'd
});

test('POST /api/events/:id/rsvp: upsert switches going -> remind without double count', async () => {
  const r = await post('/api/events/owambe-saturdays/rsvp', { status: 'remind' }, A.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.myStatus, 'remind');
  // 'remind' does not count toward going; attendee count back to base
  const detail = (await get('/api/events/owambe-saturdays', A.token)).json;
  assert.equal(detail.event.myStatus, 'remind');
  assert.equal(detail.event.attendees, 1208);
  assert.equal(detail.goingCount, 0);
});

test('POST /api/events/:id/rsvp: second user going stacks the count', async () => {
  const r = await post('/api/events/owambe-saturdays/rsvp', { status: 'going' }, B.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.goingCount, 1);
  assert.equal(r.json.attendees, 1208 + 1);
  const detail = (await get('/api/events/owambe-saturdays', B.token)).json;
  assert.ok(detail.attendees.some((a) => a.username === B.username));
  assert.equal(detail.attendees[0].initials, B.username.slice(0, 2).toUpperCase());
});

test('POST /api/events/:id/rsvp: invalid status rejected', async () => {
  const r = await post('/api/events/owambe-saturdays/rsvp', { status: 'maybe' }, A.token);
  assert.equal(r.status, 400);
});

test('DELETE /api/events/:id/rsvp: cancel clears status', async () => {
  const r = await del('/api/events/owambe-saturdays/rsvp', B.token);
  assert.equal(r.status, 200);
  assert.equal(r.json.myStatus, null);
  const detail = (await get('/api/events/owambe-saturdays', B.token)).json;
  assert.equal(detail.event.myStatus, null);
  assert.equal(detail.goingCount, 0);
  // cancel of a non-existent rsvp is still ok
  const r2 = await del('/api/events/owambe-saturdays/rsvp', B.token);
  assert.equal(r2.status, 200);
});
