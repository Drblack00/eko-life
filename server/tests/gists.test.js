// Phase 3 — Gist social feed + News tab.
//
// Gists: post validation, rate limit, feed tabs (latest/trending/
// following/me), like toggle, comments, report flow, delete rules,
// HTML sanitization, author badges.
// News: RSS/Atom fixture parsing, snippet hygiene, dedupe-by-link,
// /api/headlines pagination + cache metadata, manual refresh respecting cache.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'gist-test-secret';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const { parseFeedXml, stripHtml } = await import('../src/news.js');
const { sanitizePlainText, _resetGistRateLimit } = await import('../src/routes/gists.js');

let base, app;
const users = {};

test.before(async () => {
  app = await createApp();
  const port = await app.start(0);
  base = `http://127.0.0.1:${port}`;
});
test.after(async () => { await app.close(); });
test.beforeEach(() => { _resetGistRateLimit(); });

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
async function del(p, token) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(base + p, { method: 'DELETE', headers });
  return { status: r.status, json: await r.json() };
}

async function mkuser(name, { admin = false } = {}) {
  const id = await db.createUser({ username: name });
  if (admin) await db.setAdmin(id, true);
  const token = signToken(id);
  users[name] = { id, token };
  return users[name];
}
function auth(path, token) { return { post: (b) => post(path, b, token), get: () => get(path, token) }; }

/* ---------------- validation ---------------- */

test('post validation: empty rejected, over-limit rejected, valid accepted', async () => {
  const u = await mkuser('gistval');
  const r1 = await post('/api/gists', { text: '   ' }, u.token);
  assert.equal(r1.status, 400);
  const r2 = await post('/api/gists', { text: 'x'.repeat(281) }, u.token);
  assert.equal(r2.status, 400);
  assert.match(r2.json.error, /280/);
  const r3 = await post('/api/gists', { text: 'x'.repeat(280) }, u.token);
  assert.equal(r3.status, 201);
  assert.equal(r3.json.gist.text.length, 280);
});

test('post rate limit: second post within 30s is rejected', async () => {
  const u = await mkuser('gistrate');
  const r1 = await post('/api/gists', { text: 'first' }, u.token);
  assert.equal(r1.status, 201);
  const r2 = await post('/api/gists', { text: 'second' }, u.token);
  assert.equal(r2.status, 429);
});

test('sanitization: markup is stripped to plain text server-side', async () => {
  const u = await mkuser('gistsan');
  const r = await post('/api/gists', { text: '<b>bold</b> <script>alert(1)</script>hi &amp; bye' }, u.token);
  assert.equal(r.status, 201);
  assert.equal(r.json.gist.text, 'bold hi & bye');
});

test('sanitizePlainText unit: tags/entities/whitespace', () => {
  assert.equal(sanitizePlainText('<p>Hello <b>world</b></p>'), 'Hello world');
  assert.equal(sanitizePlainText('a&nbsp;&nbsp;b &lt;3&gt;'), 'a b <3>');
  assert.equal(sanitizePlainText('  \n too   much\tspace '), 'too much space');
  assert.equal(sanitizePlainText(null), '');
  assert.equal(sanitizePlainText(123), '123');
});

/* ---------------- feed tabs ---------------- */

test('latest + me tabs: post appears in both', async () => {
  const a = await mkuser('gistA');
  const b = await mkuser('gistB');
  await post('/api/gists', { text: 'hello from A' }, a.token);
  const latest = await get('/api/gists?tab=latest', b.token);
  assert.equal(latest.status, 200);
  assert.ok(latest.json.gists.some((g) => g.text === 'hello from A'));
  const meA = await get('/api/gists?tab=me', a.token);
  assert.ok(meA.json.gists.every((g) => g.username === 'gistA'));
  const meB = await get('/api/gists?tab=me', b.token);
  assert.ok(!meB.json.gists.some((g) => g.text === 'hello from A'));
});

test('author badge: fresh accounts get New Kid', async () => {
  const u = await mkuser('gistbadge');
  await post('/api/gists', { text: 'badge check' }, u.token);
  const latest = await get('/api/gists?tab=latest', u.token);
  const g = latest.json.gists.find((x) => x.text === 'badge check');
  assert.equal(g.badge, 'New Kid');
  assert.equal(g.avatar, '🧑');
});

test('like toggle: like → count 1, repeat like stays 1, unlike → 0', async () => {
  const a = await mkuser('gistlikeA');
  const b = await mkuser('gistlikeB');
  const p = await post('/api/gists', { text: 'like me' }, a.token);
  const id = p.json.gist.id;
  const l1 = await post(`/api/gists/${id}/like`, {}, b.token);
  assert.equal(l1.status, 200);
  assert.equal(l1.json.like_count, 1);
  assert.equal(l1.json.liked, true);
  const l2 = await post(`/api/gists/${id}/like`, {}, b.token);
  assert.equal(l2.json.like_count, 1); // idempotent
  const u1 = await del(`/api/gists/${id}/like`, b.token);
  assert.equal(u1.json.like_count, 0);
  assert.equal(u1.json.liked, false);
  const likeMissing = await post('/api/gists/999999/like', {}, b.token);
  assert.equal(likeMissing.status, 404);
});

test('comments: add + list oldest-first with cursor', async () => {
  const a = await mkuser('gistcomA');
  const b = await mkuser('gistcomB');
  const p = await post('/api/gists', { text: 'comment target' }, a.token);
  const id = p.json.gist.id;
  const c1 = await post(`/api/gists/${id}/comments`, { text: 'first!' }, b.token);
  assert.equal(c1.status, 201);
  const c2 = await post(`/api/gists/${id}/comments`, { text: 'x'.repeat(281) }, b.token);
  assert.equal(c2.status, 400);
  const c3 = await post(`/api/gists/${id}/comments`, { text: 'second!' }, a.token);
  assert.equal(c3.status, 201);
  const list = await get(`/api/gists/${id}/comments?limit=1`, a.token);
  assert.equal(list.json.comments.length, 1);
  assert.equal(list.json.comments[0].text, 'first!'); // oldest first
  assert.ok(list.json.next_cursor);
  const page2 = await get(`/api/gists/${id}/comments?cursor=${list.json.next_cursor}`, a.token);
  assert.equal(page2.json.comments[0].text, 'second!');
  assert.equal(page2.json.next_cursor, null);
});

test('trending: most liked in last 7 days first; old gists excluded', async () => {
  const a = await mkuser('gisttrA');
  const b = await mkuser('gisttrB');
  const c = await mkuser('gisttrC');
  const p1 = await post('/api/gists', { text: 'trending-popular' }, a.token);
  const p2 = await post('/api/gists', { text: 'trending-quiet' }, b.token);
  const id1 = p1.json.gist.id, id2 = p2.json.gist.id;
  await post(`/api/gists/${id1}/like`, {}, b.token);
  await post(`/api/gists/${id1}/like`, {}, c.token);
  await post(`/api/gists/${id2}/like`, {}, c.token);
  // backdate a liked gist 8 days — must not appear in trending
  const oldGist = await db.createGist(c.id, 'trending-old');
  const oldId = oldGist.id;
  await db.dbRun(
    'UPDATE gists SET created_at = ? WHERE id = ?',
    'UPDATE gists SET created_at = $1 WHERE id = $2',
    [Date.now() - 8 * 86400000, oldId]);
  await post(`/api/gists/${oldId}/like`, {}, a.token);
  await post(`/api/gists/${oldId}/like`, {}, b.token);
  const tr = await get('/api/gists?tab=trending&limit=10', a.token);
  assert.equal(tr.status, 200);
  const texts = tr.json.gists.map((g) => g.text);
  assert.ok(texts.includes('trending-popular'));
  assert.ok(texts.indexOf('trending-popular') < texts.indexOf('trending-quiet'));
  assert.ok(!texts.includes('trending-old'));
});

test('following: only accepted friends\' posts', async () => {
  const a = await mkuser('gistfolA');
  const b = await mkuser('gistfolB');
  const stranger = await mkuser('gistfolS');
  await db.addFriendRequest(a.id, b.id);
  await db.respondFriendRequest(b.id, a.id, true);
  await post('/api/gists', { text: 'friend-post' }, b.token);
  await post('/api/gists', { text: 'stranger-post' }, stranger.token);
  const fol = await get('/api/gists?tab=following', a.token);
  const texts = fol.json.gists.map((g) => g.text);
  assert.ok(texts.includes('friend-post'));
  assert.ok(!texts.includes('stranger-post'));
});

test('pagination: latest cursor walks the full feed', async () => {
  const u = await mkuser('gistpag');
  const ids = [];
  for (let i = 0; i < 5; i++) {
    _resetGistRateLimit();
    const r = await post('/api/gists', { text: `page-post-${i}` }, u.token);
    ids.push(r.json.gist.id);
  }
  const seen = [];
  let cursor = null;
  for (let round = 0; round < 10; round++) {
    const url = cursor ? `/api/gists?tab=latest&limit=2&cursor=${cursor}` : '/api/gists?tab=latest&limit=2';
    const r = await get(url, u.token);
    assert.equal(r.status, 200);
    seen.push(...r.json.gists.map((g) => g.id));
    cursor = r.json.next_cursor;
    if (!cursor) break;
  }
  for (const id of ids) assert.ok(seen.includes(id), `missing gist ${id}`);
});

/* ---------------- delete + report ---------------- */

test('delete: own post ok, other\'s forbidden, admin allowed', async () => {
  const a = await mkuser('gistdelA');
  const b = await mkuser('gistdelB');
  const admin = await mkuser('gistdelAdmin', { admin: true });
  const p = await post('/api/gists', { text: 'to delete' }, a.token);
  const d1 = await del(`/api/gists/${p.json.gist.id}`, b.token);
  assert.equal(d1.status, 403);
  _resetGistRateLimit();
  const p2 = await post('/api/gists', { text: 'admin deletes this' }, a.token);
  assert.equal(p2.status, 201);
  const d2 = await del(`/api/gists/${p2.json.gist.id}`, admin.token);
  assert.equal(d2.status, 200);
  _resetGistRateLimit();
  const p3 = await post('/api/gists', { text: 'self delete' }, b.token);
  assert.equal(p3.status, 201);
  const d3 = await del(`/api/gists/${p3.json.gist.id}`, b.token);
  assert.equal(d3.status, 200);
  const latest = await get('/api/gists?tab=latest&limit=50', a.token);
  assert.ok(!latest.json.gists.some((g) => g.text === 'self delete'));
});

test('report flow: records a report visible to admins', async () => {
  const a = await mkuser('gistrepA');
  const admin = await mkuser('gistrepAdmin', { admin: true });
  const p = await post('/api/gists', { text: 'reportable post' }, a.token);
  const r1 = await post(`/api/gists/${p.json.gist.id}/report`, { reason: '' }, a.token);
  assert.equal(r1.status, 400);
  const r2 = await post(`/api/gists/${p.json.gist.id}/report`, { reason: 'spam' }, a.token);
  assert.equal(r2.status, 201);
  assert.ok(r2.json.report_id);
  const q = await get('/api/admin/gist-reports', admin.token);
  assert.equal(q.status, 200);
  assert.ok(q.json.reports.some((r) => r.gist_id === p.json.gist.id && r.reason === 'spam'));
  // non-admin cannot see the queue
  const q2 = await get('/api/admin/gist-reports', a.token);
  assert.equal(q2.status, 403);
});

test('auth: gists endpoints require a token', async () => {
  const r = await get('/api/gists');
  assert.equal(r.status, 401);
  const r2 = await post('/api/gists', { text: 'nope' });
  assert.equal(r2.status, 401);
});

/* ---------------- news ---------------- */

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Test News</title>
<item><title><![CDATA[Breaking: Market Fire Contained]]></title>
<link>https://example.com/news/1</link>
<pubDate>Mon, 12 Oct 2026 06:00:00 GMT</pubDate>
<description><![CDATA[<p>Firefighters <b>contained</b> the blaze in two hours.</p>]]></description></item>
<item><title>Economy Grows 3%</title>
<link>https://example.com/news/2</link>
<pubDate>bad-date</pubDate>
<description>Simple description here.</description></item>
</channel></rss>`;

const ATOM_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Feed</title>
<entry><title>Atom Headline</title>
<link href="https://example.com/atom/1"/>
<published>2026-10-12T07:00:00Z</published>
<summary>Atom summary text.</summary></entry>
</feed>`;

test('parseFeedXml: RSS fixture → headlines with plain snippets', () => {
  const items = parseFeedXml(RSS_FIXTURE, 'TestOutlet');
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Breaking: Market Fire Contained');
  assert.equal(items[0].link, 'https://example.com/news/1');
  assert.equal(items[0].snippet, 'Firefighters contained the blaze in two hours.');
  assert.ok(items[0].published_at > 0);
  assert.equal(items[1].published_at, null); // bad date tolerated
  assert.equal(items[1].snippet, 'Simple description here.');
});

test('parseFeedXml: Atom fixture → href link', () => {
  const items = parseFeedXml(ATOM_FIXTURE, 'AtomOutlet');
  assert.equal(items.length, 1);
  assert.equal(items[0].link, 'https://example.com/atom/1');
  assert.equal(items[0].title, 'Atom Headline');
});

test('parseFeedXml: garbage input → empty, never throws', () => {
  assert.deepEqual(parseFeedXml('', 'X'), []);
  assert.deepEqual(parseFeedXml('<html>not xml', 'X'), []);
});

test('stripHtml: no markup survives in snippets', () => {
  const s = stripHtml('<p>Hello <b>world</b><script>x()</script></p> &amp; more');
  assert.ok(!/<[a-z]/i.test(s));
  assert.equal(s, 'Hello world & more');
});

test('news upsert dedupes by link', async () => {
  await db.upsertNewsItem({ source: 'Dedup', title: 'Same link', link: 'https://example.com/dedup/1', snippet: 'a', published_at: Date.now() });
  await db.upsertNewsItem({ source: 'Dedup', title: 'Same link v2', link: 'https://example.com/dedup/1', snippet: 'b', published_at: Date.now() });
  const { items } = await db.listNewsItems(null, 50);
  const hits = items.filter((i) => i.link === 'https://example.com/dedup/1');
  assert.equal(hits.length, 1);
});

test('GET /api/headlines: newest-first, cursor paged, cache metadata', async () => {
  const u = await mkuser('newsreader');
  const now = Date.now() + 60000; // above any rows other tests seeded
  await db.upsertNewsItem({ source: 'HlOutletA', title: 'Oldest story', link: 'https://example.com/n/1', snippet: 's1', published_at: now - 3000 });
  await db.upsertNewsItem({ source: 'HlOutletB', title: 'Newest story', link: 'https://example.com/n/2', snippet: 's2', published_at: now });
  const own = (items) => items.filter((i) => i.source === 'HlOutletA' || i.source === 'HlOutletB');
  const r1 = await get('/api/headlines?limit=1', u.token);
  assert.equal(r1.status, 200);
  const items1 = own(r1.json.items);
  assert.equal(items1.length, 1);
  assert.equal(items1[0].title, 'Newest story');
  assert.ok(r1.json.next_cursor);
  assert.ok(typeof r1.json.stale === 'boolean');
  const r2 = await get(`/api/headlines?cursor=${encodeURIComponent(r1.json.next_cursor)}`, u.token);
  assert.equal(r2.status, 200);
  assert.ok(own(r2.json.items).some((i) => i.title === 'Oldest story'));
});

test('POST /api/headlines/refresh: respects a fresh cache', async () => {
  const u = await mkuser('newsrefresh');
  await db.upsertNewsItem({ source: 'Fresh', title: 'Fresh story', link: 'https://example.com/fresh/1', snippet: 's', published_at: Date.now() });
  const r = await post('/api/headlines/refresh', {}, u.token);
  assert.equal(r.status, 200);
  // cache was just written → refresh must NOT re-fetch
  assert.equal(r.json.refreshed, false);
});

test('news endpoints require auth like other in-game routes', async () => {
  const r = await get('/api/headlines');
  assert.equal(r.status, 401);
});
