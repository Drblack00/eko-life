// M21: notifications system + admin unlimited stealth money.
//
// Notifications: table CRUD via the REST API, preference toggles,
// friend-online live events + 30-min per-friend cooldown, room-message fan-out.
// Admin money: 0-coin admin purchase succeeds with coins column unchanged,
// leaderboard shows the small decoy, non-admin insufficient funds still fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

process.env.SESSION_SECRET='test-secret-notifications';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');

let base, wsBase, app;
const sockets = new Set();

test.before(async () => {
  app = await createApp();
  const port = await app.start(0);
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
});
test.after(async () => {
  for (const s of sockets) { try { s.terminate(); } catch { /* ignore */ } }
  await app.close();
});

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
async function put(p, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(base + p, { method: 'PUT', headers, body: JSON.stringify(body) });
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
    const msgs = collect(ws);
    ws.once('open', () => resolve({ ws, msgs }));
    ws.once('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- users: first registered account is the admin (production behavior) ----
let adminTok, adminId, userTok, userId, userName;
test('setup: admin + regular user with characters', async () => {
  const a = await post('/api/auth/register', { username: 'notifadmin', password: 'password123', dob: '2000-01-01' });
  assert.equal(a.status, 200);
  assert.equal(a.json.is_admin, true);
  adminTok = a.json.token;
  adminId = a.json.user_id ?? a.json.id;

  userId = await db.createUser({ username: 'notifreg' });
  userTok = signToken(userId);
  userName = 'notifreg';

  const ca = await post('/api/characters', { name: 'AdminOne', class: 'street_smart', avatar: '🧑', color: '#22d3ee' }, adminTok);
  assert.equal(ca.status, 200);
  const cu = await post('/api/characters', { name: 'RegOne', class: 'street_smart', avatar: '🧑', color: '#f472b6' }, userTok);
  assert.equal(cu.status, 200);
  adminId = Number((await db.getUserByName('notifadmin')).id);
  assert.ok(Number.isFinite(adminId) && adminId > 0);
});

// ---------------- notification preferences ----------------
test('prefs default all-on; PUT updates; auth required', async () => {
  const d = await get('/api/notifications/preferences', userTok);
  assert.equal(d.status, 200);
  assert.deepEqual(d.json.preferences, { friend_online: true, room_message: true, money_received: true });

  const u = await put('/api/notifications/preferences', { room_message: false }, userTok);
  assert.equal(u.status, 200);
  assert.equal(u.json.preferences.room_message, false);
  assert.equal(u.json.preferences.friend_online, true);

  const back = await put('/api/notifications/preferences', { room_message: true }, userTok);
  assert.equal(back.json.preferences.room_message, true);

  const anon = await get('/api/notifications/preferences');
  assert.equal(anon.status, 401);
});

// ---------------- friend-online: live event + cooldown ----------------
test('friend online: offline→online flip notifies the friend live', async () => {
  // become friends: regular requests, admin accepts
  const req = await post('/api/friends/request', { username: 'notifadmin' }, userTok);
  assert.equal(req.status, 200);
  const fid = req.json.friendship.id;
  const acc = await post(`/api/friends/${fid}/accept`, {}, adminTok);
  assert.equal(acc.status, 200);

  const reg = await connect(userTok);
  await waitFor(reg.msgs, (m) => m.t === 'init');

  const adm = await connect(adminTok);
  await waitFor(adm.msgs, (m) => m.t === 'init');

  // regular's socket should receive the live friend_online event
  const live = await waitFor(reg.msgs, (m) => m.t === 'notification:new' && m.notification?.type === 'friend_online');
  assert.match(String(live.notification.body || ''), /notifadmin/i);

  // and it is persisted + listed newest-first
  const list = await get('/api/notifications?limit=10', userTok);
  assert.equal(list.status, 200);
  assert.ok(list.json.unread >= 1);
  assert.equal(list.json.notifications[0].type, 'friend_online');

  // mark-read + read-all clear the badge
  const nid = list.json.notifications[0].id;
  const one = await post(`/api/notifications/${nid}/read`, {}, userTok);
  assert.equal(one.status, 200);
  assert.equal(one.json.ok, true);
  const all = await post('/api/notifications/read-all', {}, userTok);
  assert.equal(all.status, 200);
  const after = await get('/api/notifications?limit=1', userTok);
  assert.equal(after.json.unread, 0);

  reg.ws.close(); adm.ws.close();
  sockets.delete(reg.ws); sockets.delete(adm.ws);
});

test('friend online: 30-min per-friend cooldown blocks reconnect spam', async () => {
  const reg = await connect(userTok);
  await waitFor(reg.msgs, (m) => m.t === 'init');
  const before = await get('/api/notifications?limit=50', userTok);
  const beforeCount = before.json.notifications.filter((n) => n.type === 'friend_online').length;

  // admin reconnects twice in quick succession — cooldown suppresses both
  for (let i = 0; i < 2; i++) {
    const adm = await connect(adminTok);
    await waitFor(adm.msgs, (m) => m.t === 'init');
    adm.ws.close(); sockets.delete(adm.ws);
    await sleep(150);
  }
  await sleep(400);
  const spam = reg.msgs.filter((m) => m.t === 'notification:new' && m.notification?.type === 'friend_online');
  assert.equal(spam.length, 0, 'cooldown must suppress rapid reconnect notifications');
  const after = await get('/api/notifications?limit=50', userTok);
  assert.equal(
    after.json.notifications.filter((n) => n.type === 'friend_online').length,
    beforeCount,
    'no new friend_online rows during cooldown'
  );
  reg.ws.close(); sockets.delete(reg.ws);
});

test('friend online: pref toggle off suppresses the notification', async () => {
  await put('/api/notifications/preferences', { friend_online: false }, userTok);
  const reg = await connect(userTok);
  await waitFor(reg.msgs, (m) => m.t === 'init');
  const adm = await connect(adminTok);
  await waitFor(adm.msgs, (m) => m.t === 'init');
  await sleep(500);
  const got = reg.msgs.filter((m) => m.t === 'notification:new' && m.notification?.type === 'friend_online');
  assert.equal(got.length, 0, 'pref off must suppress the live event');
  reg.ws.close(); adm.ws.close();
  sockets.delete(reg.ws); sockets.delete(adm.ws);
  await put('/api/notifications/preferences', { friend_online: true }, userTok);
});

// ---------------- room message fan-out ----------------
test('room message: joined members (not sender) get notified', async () => {
  const reg = await connect(userTok);
  await waitFor(reg.msgs, (m) => m.t === 'init');
  const adm = await connect(adminTok);
  await waitFor(adm.msgs, (m) => m.t === 'init');

  // join the first seeded preset room with both users
  adm.ws.send(JSON.stringify({ t: 'rooms' }));
  const roomsMsg = await waitFor(adm.msgs, (m) => m.t === 'rooms' && Array.isArray(m.rooms) && m.rooms.length > 0);
  const roomId = roomsMsg.rooms[0].id;
  adm.ws.send(JSON.stringify({ t: 'join_room', roomId }));
  await waitFor(adm.msgs, (m) => m.t === 'room_joined' && String(m.roomId) === String(roomId));
  reg.ws.send(JSON.stringify({ t: 'join_room', roomId }));
  await waitFor(reg.msgs, (m) => m.t === 'room_joined' && String(m.roomId) === String(roomId));

  // admin posts; regular (not the sender) gets the notification
  adm.ws.send(JSON.stringify({ t: 'room_chat', roomId, text: 'hello room notif test' }));
  const live = await waitFor(reg.msgs, (m) => m.t === 'notification:new' && m.notification?.type === 'room_message');
  assert.equal(String(live.notification.data?.roomId ?? live.notification.data?.room_id), String(roomId));
  assert.match(String(live.notification.body || ''), /hello room notif test/);

  // sender does NOT get one for their own message
  await sleep(400);
  const selfGot = adm.msgs.filter((m) => m.t === 'notification:new' && m.notification?.type === 'room_message');
  assert.equal(selfGot.length, 0, 'sender must not be notified of own message');

  reg.ws.close(); adm.ws.close();
  sockets.delete(reg.ws); sockets.delete(adm.ws);
});

// ---------------- admin unlimited stealth money ----------------
async function setMoney(userIdV, amount) {
  const c = await db.getCharacter(userIdV);
  c.money = amount;
  await db.saveCharacter(c);
}

test('admin with 0 coins: purchase succeeds, coins column untouched', async () => {
  await setMoney(adminId, 0);
  // drop hunger so the purchase has a measurable effect
  {
    const c = await db.getCharacter(adminId);
    c.hunger = 50;
    await db.saveCharacter(c);
  }
  const before = await db.getCharacter(adminId);
  assert.equal(Number(before.money), 0);

  const adm = await connect(adminTok);
  await waitFor(adm.msgs, (m) => m.t === 'init');
  adm.ws.send(JSON.stringify({ t: 'act', a: 'eat', item: 'mama_put' })); // costs 800
  await sleep(700); // let the act apply server-side

  const after = await db.getCharacter(adminId);
  assert.equal(Number(after.money), 0, 'admin spend must deduct nothing');
  assert.ok(Number(after.hunger) > Number(before.hunger), 'the purchase itself succeeded (hunger restored)');
  adm.ws.close(); sockets.delete(adm.ws);
});

test('non-admin with insufficient coins: purchase fails, nothing changes', async () => {
  await setMoney(userId, 100);
  const before = await db.getCharacter(userId);

  const reg = await connect(userTok);
  await waitFor(reg.msgs, (m) => m.t === 'init');
  reg.ws.send(JSON.stringify({ t: 'act', a: 'eat', item: 'mama_put' })); // costs 800 > 100
  await sleep(700);

  const after = await db.getCharacter(userId);
  assert.equal(Number(after.money), 100, 'failed purchase must not touch coins');
  assert.equal(Number(after.hunger), Number(before.hunger), 'failed purchase must not apply effects');
  reg.ws.close(); sockets.delete(reg.ws);
});

test('leaderboard shows the admin small decoy number, leaks no admin flag', async () => {
  await setMoney(adminId, 0);
  const { status, json } = await get('/api/leaderboard');
  assert.equal(status, 200);
  const row = json.leaders.find((l) => l.username === 'notifadmin');
  assert.ok(row, 'admin appears on the board');
  assert.equal(Number(row.money), 0, 'board shows the small coins column, not unlimited');
  assert.ok(!('is_admin' in row) && !('isAdmin' in row) && !('unlimited' in row), 'no admin/unlimited flag leaks');
  assert.deepEqual(Object.keys(row).sort(), ['money', 'username']);
});
