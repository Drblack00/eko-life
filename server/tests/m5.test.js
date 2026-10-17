// M5 tests: realtime social + elections.
// Election full cycle (run → vote → tally → governor perks + salary),
// double-vote/double-run rejection, tie → lowest player id, friends
// mutual auto-accept, room kick/mute, block hides chat + blocks DMs,
// reports, leaderboard ordering, news feed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

process.env.SESSION_SECRET = 'test-secret-eko-m5';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');

let base, wsBase, app;
const sockets = [];

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
function collect(ws) {
  const msgs = [];
  ws.on('message', (raw) => {
    try { msgs.push(JSON.parse(raw.toString())); } catch { /* ignore */ }
  });
  return msgs;
}
function waitFor(msgs, pred, timeout = 4000) {
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
    const msgs = collect(ws);
    ws.once('open', () => resolve({ ws, msgs }));
    ws.once('error', reject);
    sockets.push(ws);
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let guestN = 0;
// Seed a user directly (bypasses HTTP auth rate limits), optionally patching
// the character BEFORE connect (the live session holds its own copy).
async function seedUser(charPatch) {
  guestN += 1;
  const username = 'm5u' + guestN;
  const userId = await db.createUser({ username, is_guest: 1 });
  if (charPatch) {
    const c = await db.getCharacter(userId);
    Object.assign(c, charPatch);
    await db.saveCharacter(c);
  }
  const token = signToken(userId);
  const { ws, msgs } = await connect(token);
  const init = await waitFor(msgs, m => m.t === 'init');
  return { ws, msgs, init, userId, username, token };
}
function send(ws, obj) { ws.send(JSON.stringify(obj)); }

// ---- admin (first registered user becomes admin) ----
let adminTok;
test('setup: admin account', async () => {
  const r = await post('/api/auth/register', {
    username: 'm5admin', password: 'password123', dob: '2000-01-01',
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.is_admin, true);
  adminTok = r.json.token;
});

// ---- election players ----
let A, B; // A runs, B votes
test('init carries the live election + social bootstrap', async () => {
  A = await seedUser({ money: 100000, housing: 'bridge' });
  B = await seedUser({ money: 100000, housing: 'bridge' });
  assert.equal(A.init.election.active, true);
  assert.equal(A.init.election.endsInDays, 7);
  assert.deepEqual(A.init.election.candidates, []);
  assert.equal(A.init.governor, null);
  assert.ok(Array.isArray(A.init.friends));
  assert.ok(Array.isArray(A.init.rooms));
  assert.ok(A.init.rooms.length >= 4, 'preset rooms seeded');
  assert.ok(Array.isArray(A.init.news));
  assert.equal(typeof A.init.unreadDm, 'number');
});

test('act run: fee deducted, announcement, campaign room, election state', async () => {
  const before = A.init.you.money;
  send(A.ws, { t: 'act', a: 'run' });
  const you = await waitFor(A.msgs, m => m.t === 'you' && m.you.money === before - 50000);
  assert.equal(you.you.money, before - 50000);
  assert.match(you.note || '', /ballot/);
  // ledger row for the fee
  const tx = await db.listTransactions(A.userId, 5);
  assert.ok(tx.some(r => r.kind === 'campaign_fee' && r.amount === -50000));
  // city-wide announcement
  const ann = await waitFor(B.msgs, m => m.t === 'sys' && /running for Governor/.test(m.text));
  assert.ok(ann.text.includes(A.username));
  // election state shows the candidate
  const el = await waitFor(B.msgs, m => m.t === 'election' && m.active && m.candidates.length === 1);
  assert.equal(el.candidates[0].player_id, A.userId);
  // campaign room created + candidate auto-joined as owner
  const joined = await waitFor(A.msgs, m => m.t === 'room_joined' && m.roomId);
  send(A.ws, { t: 'rooms' });
  const rooms = await waitFor(A.msgs, m => m.t === 'rooms' &&
    m.rooms.some(r => r.name === `${A.username}'s Campaign`));
  const camp = rooms.rooms.find(r => r.name === `${A.username}'s Campaign`);
  assert.equal(camp.icon, '📣');
  assert.equal(camp.joined, true);
  A.campaignRoomId = camp.id;
  assert.equal(joined.roomId, camp.id);
  // news item pushed
  const news = await waitFor(A.msgs, m => m.t === 'news' && /running for Governor/.test(m.item.text));
  assert.equal(news.item.type, 'election');
});

test('act run twice: rejected, no double fee', async () => {
  send(A.ws, { t: 'act', a: 'run' });
  const err = await waitFor(A.msgs, m => m.t === 'err' && /already running/.test(m.text));
  assert.ok(err);
  const c = await db.getCharacter(A.userId);
  assert.equal(Number(c.money), A.init.you.money - 50000, 'fee charged exactly once');
});

test('act vote: recorded; double vote + non-candidate rejected', async () => {
  send(B.ws, { t: 'act', a: 'vote', candidate: A.userId });
  const el = await waitFor(B.msgs, m => m.t === 'election' && m.voted === true);
  assert.equal(el.candidates[0].votes, 1);
  const you = await waitFor(B.msgs, m => m.t === 'you' && /Vote cast/.test(m.note || ''));
  assert.ok(you);
  // double vote
  send(B.ws, { t: 'act', a: 'vote', candidate: A.userId });
  const err1 = await waitFor(B.msgs, m => m.t === 'err' && /already voted/.test(m.text));
  assert.ok(err1);
  // non-candidate
  send(B.ws, { t: 'act', a: 'vote', candidate: 999999 });
  const err2 = await waitFor(B.msgs, m => m.t === 'err' && /not running/.test(m.text));
  assert.ok(err2);
});

test('admin end-election: full tally — gov announced, room closed, new cycle', async () => {
  const r = await post('/api/admin/end-election', {}, adminTok);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.governorId, A.userId);
  assert.equal(r.json.governor.username, A.username);
  // {t:'gov'} + sys announcement to everyone
  const gov = await waitFor(B.msgs, m => m.t === 'gov' && m.id === A.userId);
  assert.equal(gov.name, A.username);
  const ann = await waitFor(B.msgs, m => m.t === 'sys' && /new Governor/.test(m.text));
  assert.ok(ann.text.includes(A.username));
  // fresh cycle pushed, candidates cleared
  const el = await waitFor(B.msgs, m => m.t === 'election' && m.active && m.id === 2);
  assert.deepEqual(el.candidates, []);
  assert.equal(el.endsInDays, 7);
  // campaign room closed
  send(B.ws, { t: 'rooms' });
  const rooms = await waitFor(B.msgs, m => m.t === 'rooms' &&
    !m.rooms.some(r => /'s Campaign$/.test(r.name)));
  assert.ok(rooms);
  // governor news item
  const news = await waitFor(B.msgs, m => m.t === 'news' && /won the governorship/.test(m.item.text));
  assert.equal(news.item.type, 'governor');
  // REST reflects it
  const st = await get('/api/stats');
  assert.equal(st.json.governor, A.username);
  const ae = await get('/api/admin/election', adminTok);
  assert.equal(ae.json.governorId, A.userId);
  assert.equal(ae.json.governor.username, A.username);
  assert.equal(ae.json.election.active, true);
});

test('gov_broadcast: governor only, 1/day cooldown, profanity-filtered', async () => {
  // non-governor rejected
  send(B.ws, { t: 'act', a: 'gov_broadcast', text: 'hello' });
  const err = await waitFor(B.msgs, m => m.t === 'err' && /Only the Governor/.test(m.text));
  assert.ok(err);
  // governor broadcast lands city-wide, filtered
  send(A.ws, { t: 'act', a: 'gov_broadcast', text: 'fuck the potholes, fix them!' });
  const sys = await waitFor(B.msgs, m => m.t === 'sys' && m.text.startsWith('👑 Governor'));
  assert.ok(sys.text.includes(A.username));
  assert.ok(!sys.text.includes('fuck'), 'profanity filtered');
  assert.ok(sys.text.includes('***'));
  // second broadcast within the day → cooldown err
  send(A.ws, { t: 'act', a: 'gov_broadcast', text: 'again' });
  const cd = await waitFor(A.msgs, m => m.t === 'err' && /available in/.test(m.text));
  assert.ok(cd);
});

test('governor salary: +₦25,000/day in the economy tick', async () => {
  const before = (await db.getCharacter(A.userId));
  const m0 = Number(before.money);
  await app.hub.dayRollover();
  const you = await waitFor(A.msgs, m => m.t === 'you' && /Governor salary/.test(m.note || ''));
  assert.equal(you.you.money, m0 + 25000);
  const tx = await db.listTransactions(A.userId, 5);
  assert.ok(tx.some(r => r.kind === 'gov_salary' && r.amount === 25000));
});

test('tie → lowest player id wins', async () => {
  const C = await seedUser({ money: 100000 });
  const D = await seedUser({ money: 100000 });
  const lo = Math.min(C.userId, D.userId), hi = Math.max(C.userId, D.userId);
  send(C.ws, { t: 'act', a: 'run' });
  await waitFor(C.msgs, m => m.t === 'you' && /ballot/.test(m.note || ''));
  send(D.ws, { t: 'act', a: 'run' });
  await waitFor(D.msgs, m => m.t === 'you' && /ballot/.test(m.note || ''));
  // no votes at all: 0–0 tie → lowest player id
  const r = await post('/api/admin/end-election', {}, adminTok);
  assert.equal(r.json.governorId, lo);
  assert.notEqual(r.json.governorId, hi);
  const gov = await waitFor(D.msgs, m => m.t === 'gov' && m.id === lo);
  assert.ok(gov);
});

// ---- friends ----
let F1, F2;
test('friends: request → mutual auto-accept → remove', async () => {
  F1 = await seedUser();
  F2 = await seedUser();
  send(F1.ws, { t: 'friend_add', username: F2.username });
  const req = await waitFor(F2.msgs, m => m.t === 'friend_request' && m.from.username === F1.username);
  assert.ok(req);
  const f1list = await waitFor(F1.msgs, m => m.t === 'friends' &&
    m.friends.some(f => f.other_username === F2.username && f.status === 'pending' && !f.incoming));
  assert.ok(f1list);
  // mutual request auto-accepts (no separate accept needed)
  send(F2.ws, { t: 'friend_add', username: F1.username });
  const acc = await waitFor(F1.msgs, m => m.t === 'sys' && /now friends/.test(m.text));
  assert.ok(acc);
  const both = await waitFor(F2.msgs, m => m.t === 'friends' &&
    m.friends.some(f => f.other_username === F1.username && f.status === 'accepted'));
  assert.equal(both.friends[0].online, true);
  assert.equal(typeof both.friends[0].incoming, 'boolean');
  // remove
  send(F1.ws, { t: 'friend_remove', playerId: F2.userId });
  const gone = await waitFor(F1.msgs, m => m.t === 'friends' &&
    !m.friends.some(f => f.other_username === F2.username));
  assert.ok(gone);
});

test('friends: explicit accept / decline', async () => {
  const G1 = await seedUser();
  const G2 = await seedUser();
  send(G1.ws, { t: 'friend_add', username: G2.username });
  await waitFor(G2.msgs, m => m.t === 'friend_request');
  send(G2.ws, { t: 'friend_decline', playerId: G1.userId });
  const dec = await waitFor(G2.msgs, m => m.t === 'friends' &&
    !m.friends.some(f => f.other_username === G1.username));
  assert.ok(dec);
  // self-add rejected
  send(G1.ws, { t: 'friend_add', username: G1.username });
  const err = await waitFor(G1.msgs, m => m.t === 'sys' && /yourself/.test(m.text));
  assert.ok(err);
});

// ---- rooms ----
let R1, R2;
test('rooms: create, join, chat, members, leave', async () => {
  R1 = await seedUser();
  R2 = await seedUser();
  send(R1.ws, { t: 'create_room', name: 'M5 Test Room', topic: 'testing', icon: '🧪' });
  const joined = await waitFor(R1.msgs, m => m.t === 'room_joined' && m.roomId);
  const roomId = joined.roomId;
  R1.roomId = roomId;
  send(R2.ws, { t: 'join_room', roomId });
  const j2 = await waitFor(R2.msgs, m => m.t === 'room_joined' && m.roomId === roomId);
  assert.ok(Array.isArray(j2.history));
  send(R1.ws, { t: 'room_members', roomId });
  const mem = await waitFor(R1.msgs, m => m.t === 'room_members' && m.roomId === roomId);
  assert.ok(Array.isArray(mem.room_members), 'server sends room_members (client contract)');
  assert.equal(mem.room_members.length, 2);
  assert.ok(mem.room_members.some(x => x.role === 'owner' && x.username === R1.username));
  assert.ok(mem.room_members.some(x => x.username === R2.username));
  // chat reaches members
  send(R2.ws, { t: 'room_chat', roomId, text: 'hello room' });
  const rm = await waitFor(R1.msgs, m => m.t === 'room_msg' && m.roomId === roomId && m.text === 'hello room');
  assert.equal(rm.name, R2.username);
  // unread badge for the other member
  const un = await waitFor(R1.msgs, m => m.t === 'room_unread' && m.roomId === roomId);
  assert.ok(un.unread >= 1);
  // leave
  send(R2.ws, { t: 'leave_room', roomId });
  const left = await waitFor(R2.msgs, m => m.t === 'room_left' && m.roomId === roomId);
  assert.ok(left);
  // members list reflects the leave
  send(R1.ws, { t: 'room_members', roomId });
  const mem2 = await waitFor(
    R1.msgs,
    m => m.t === 'room_members' && m.roomId === roomId && Array.isArray(m.room_members) && m.room_members.length === 1
  );
  assert.equal(mem2.room_members[0].username, R1.username);
});

test('rooms: kick + mute by owner', async () => {
  const roomId = R1.roomId;
  send(R2.ws, { t: 'join_room', roomId });
  await waitFor(R2.msgs, m => m.t === 'room_joined' && m.roomId === roomId);
  // non-owner cannot kick
  send(R2.ws, { t: 'kick_room', roomId, playerId: R1.userId });
  const derr = await waitFor(R2.msgs, m => m.t === 'sys' && /Only the room owner/.test(m.text));
  assert.ok(derr);
  // owner kicks
  send(R1.ws, { t: 'kick_room', roomId, playerId: R2.userId });
  const kicked = await waitFor(R2.msgs, m => m.t === 'room_left' && m.roomId === roomId);
  assert.ok(kicked);
  const ks = await waitFor(R2.msgs, m => m.t === 'sys' && /kicked/.test(m.text));
  assert.ok(ks);
  // kicked player can no longer chat there
  send(R2.ws, { t: 'room_chat', roomId, text: 'im back' });
  const cerr = await waitFor(R2.msgs, m => m.t === 'sys' && /Join the room first/.test(m.text));
  assert.ok(cerr);
  // rejoin, then mute
  send(R2.ws, { t: 'join_room', roomId });
  await waitFor(R2.msgs, m => m.t === 'room_joined' && m.roomId === roomId);
  send(R1.ws, { t: 'mute_room', roomId, playerId: R2.userId, minutes: 10 });
  const msys = await waitFor(R2.msgs, m => m.t === 'sys' && /muted/.test(m.text));
  assert.ok(msys.text.includes('10m'));
  await sleep(1300); // clear the shared chat cooldown before asserting the mute
  send(R2.ws, { t: 'room_chat', roomId, text: 'can you hear me' });
  const merr = await waitFor(R2.msgs, m => m.t === 'sys' && /muted in this room/.test(m.text));
  assert.ok(merr);
  // owner cannot moderate self
  send(R1.ws, { t: 'kick_room', roomId, playerId: R1.userId });
  const serr = await waitFor(R1.msgs, m => m.t === 'sys' && /yourself/.test(m.text));
  assert.ok(serr);
});

test('rooms: create rate limit 5/hour', async () => {
  const U = await seedUser();
  for (let i = 0; i < 5; i++) send(U.ws, { t: 'create_room', name: `Rate Room ${i}` });
  await waitFor(U.msgs, m => m.t === 'room_joined' && m.roomId, 6000);
  await sleep(200);
  const joinedCount = U.msgs.filter(m => m.t === 'room_joined').length;
  assert.equal(joinedCount, 5);
  send(U.ws, { t: 'create_room', name: 'Rate Room 5' });
  const err = await waitFor(U.msgs, m => m.t === 'sys' && /limit reached/.test(m.text));
  assert.ok(err);
});

// ---- DMs ----
let D1, D2;
test('DMs: send, unread, threads, history, read', async () => {
  D1 = await seedUser();
  D2 = await seedUser();
  // PORT-P4: social — stranger DMs now land in the message-requests inbox,
  // so the direct-DM flow is exercised between friends here.
  send(D1.ws, { t: 'friend_add', username: D2.username });
  send(D2.ws, { t: 'friend_add', username: D1.username });
  await waitFor(D1.msgs, m => m.t === 'sys' && /now friends/.test(m.text));
  send(D1.ws, { t: 'dm', to: D2.userId, text: 'yo, hustle o' });
  const dm = await waitFor(D2.msgs, m => m.t === 'dm' && m.text === 'yo, hustle o');
  assert.equal(dm.from, D1.userId);
  assert.equal(dm.fromName, D1.username);
  const sent = await waitFor(D1.msgs, m => m.t === 'dm_sent' && m.to === D2.userId);
  assert.ok(sent);
  const un = await waitFor(D2.msgs, m => m.t === 'dm_unread' && m.n === 1);
  assert.ok(un);
  send(D2.ws, { t: 'dm_threads' });
  const th = await waitFor(D2.msgs, m => m.t === 'dm_threads' && m.threads.length === 1);
  assert.equal(th.threads[0].username, D1.username);
  assert.equal(th.threads[0].unread, 1);
  assert.equal(th.threads[0].last_text, 'yo, hustle o');
  send(D2.ws, { t: 'dm_history', with: D1.userId });
  const hist = await waitFor(D2.msgs, m => m.t === 'dm_history' && m.with === D1.userId);
  assert.equal(hist.msgs.length, 1);
  assert.equal(hist.msgs[0].text, 'yo, hustle o');
  send(D2.ws, { t: 'dm_read', with: D1.userId });
  const cleared = await waitFor(D2.msgs, m => m.t === 'dm_unread' && m.n === 0);
  assert.ok(cleared);
});

// PORT-P4: social — begin (message-request gate over the realtime DM path)
test('DMs: stranger first message becomes a request; approve delivers it', async () => {
  const S1 = await seedUser();
  const S2 = await seedUser();
  send(S1.ws, { t: 'dm', to: S2.userId, text: 'hello stranger' });
  const req = await waitFor(S2.msgs, m => m.t === 'dm_request' && m.text === 'hello stranger');
  assert.equal(req.from, S1.userId);
  // no direct DM was delivered
  assert.ok(!S2.msgs.some(m => m.t === 'dm' && m.text === 'hello stranger'));
  const sent = await waitFor(S1.msgs, m => m.t === 'dm_request_sent' && m.to === S2.userId);
  assert.ok(sent);
  // a second DM while the request is pending does NOT create another request
  send(S1.ws, { t: 'dm', to: S2.userId, text: 'still waiting' });
  const sys = await waitFor(S1.msgs, m => m.t === 'sys' && /still pending/.test(m.text));
  assert.ok(sys);
  // approve over REST → the held message lands as a real DM
  const ap = await post(`/api/social/messages/requests/${req.id}/approve`, {}, S2.token);
  assert.equal(ap.status, 200);
  const dm = await waitFor(S2.msgs, m => m.t === 'dm' && m.text === 'hello stranger');
  assert.equal(dm.from, S1.userId);
  // thread now exists: follow-up DMs flow straight through
  send(S1.ws, { t: 'dm', to: S2.userId, text: 'we chat now' });
  const dm2 = await waitFor(S2.msgs, m => m.t === 'dm' && m.text === 'we chat now');
  assert.ok(dm2);
});

test('DMs: friends-only policy turns strangers away', async () => {
  const T1 = await seedUser();
  const T2 = await seedUser();
  const pr = await fetch(base + '/api/social/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${T2.token}` },
    body: JSON.stringify({ message_policy: 'friends' }),
  });
  assert.equal(pr.status, 200);
  send(T1.ws, { t: 'dm', to: T2.userId, text: 'let me in' });
  const err = await waitFor(T1.msgs, m => m.t === 'err' && /only accepts messages from friends/.test(m.text));
  assert.ok(err);
  assert.ok(!T2.msgs.some(m => m.t === 'dm_request'));
});
// PORT-P4: social — end

// ---- blocks ----
let K1, K2;
test('block: city chat hidden from blocker, DMs rejected both ways', async () => {
  K1 = await seedUser();
  K2 = await seedUser();
  send(K1.ws, { t: 'block', playerId: K2.userId });
  const sys = await waitFor(K1.msgs, m => m.t === 'sys' && /Blocked/.test(m.text));
  assert.ok(sys.text.includes(K2.username));
  const bl = await waitFor(K1.msgs, m => m.t === 'blocks' && m.blocks.some(b => b.blocked_id === K2.userId));
  assert.ok(bl);
  // blocked user's city chat is hidden from the blocker...
  send(K2.ws, { t: 'chat', text: 'you cant see me' });
  await waitFor(K2.msgs, m => m.t === 'chat' && m.text === 'you cant see me'); // sender sees own
  await sleep(300);
  assert.ok(!K1.msgs.some(m => m.t === 'chat' && m.text === 'you cant see me'),
    'blocker must not receive the blocked chat');
  // ...but the blocker is NOT hidden from the blocked user
  send(K1.ws, { t: 'chat', text: 'i can see you' });
  const seen = await waitFor(K2.msgs, m => m.t === 'chat' && m.text === 'i can see you');
  assert.ok(seen);
  // DMs rejected both ways
  send(K1.ws, { t: 'dm', to: K2.userId, text: 'hi' });
  const e1 = await waitFor(K1.msgs, m => m.t === 'err' && /cannot DM/.test(m.text));
  assert.ok(e1);
  send(K2.ws, { t: 'dm', to: K1.userId, text: 'hi back' });
  const e2 = await waitFor(K2.msgs, m => m.t === 'err' && /cannot DM/.test(m.text));
  assert.ok(e2);
  // unblock restores
  send(K1.ws, { t: 'unblock', playerId: K2.userId });
  const un = await waitFor(K1.msgs, m => m.t === 'blocks' && m.blocks.length === 0);
  assert.ok(un);
  // PORT-P4: social — post-unblock they are still strangers, so friend up
  // first; otherwise the DM would (correctly) become a message request.
  send(K1.ws, { t: 'friend_add', username: K2.username });
  send(K2.ws, { t: 'friend_add', username: K1.username });
  await waitFor(K1.msgs, m => m.t === 'sys' && /now friends/.test(m.text));
  send(K2.ws, { t: 'dm', to: K1.userId, text: 'we cool now' });
  const dm = await waitFor(K1.msgs, m => m.t === 'dm' && m.text === 'we cool now');
  assert.ok(dm);
});

test('block: room chat hidden from blocker', async () => {
  const roomId = R1.roomId;
  // K1/K2 join R1's room; K1 blocks K2 again
  send(K1.ws, { t: 'join_room', roomId });
  await waitFor(K1.msgs, m => m.t === 'room_joined' && m.roomId === roomId);
  send(K2.ws, { t: 'join_room', roomId });
  await waitFor(K2.msgs, m => m.t === 'room_joined' && m.roomId === roomId);
  send(K1.ws, { t: 'block', playerId: K2.userId });
  await waitFor(K1.msgs, m => m.t === 'sys' && /Blocked/.test(m.text));
  await sleep(1300); // shared chat cooldown
  send(K2.ws, { t: 'room_chat', roomId, text: 'blocked room msg' });
  await sleep(300);
  assert.ok(!K1.msgs.some(m => m.t === 'room_msg' && m.text === 'blocked room msg'),
    'blocker must not receive blocked room chat');
  // a third member still sees it
  const seen = await waitFor(R1.msgs, m => m.t === 'room_msg' && m.text === 'blocked room msg');
  assert.ok(seen);
});

// ---- reports ----
test('report: stored, reporter notified, admins can list', async () => {
  const P1 = await seedUser();
  const P2 = await seedUser();
  send(P1.ws, { t: 'report', playerId: P2.userId, reason: 'spamming chat nonstop' });
  const sys = await waitFor(P1.msgs, m => m.t === 'sys' && /Report received/.test(m.text));
  assert.ok(sys);
  const r = await get('/api/admin/reports', adminTok);
  assert.equal(r.status, 200);
  const rep = r.json.reports.find(x => x.reporter_id === P1.userId && x.reported_id === P2.userId);
  assert.ok(rep);
  assert.equal(rep.reporter, P1.username);
  assert.equal(rep.reported, P2.username);
  assert.equal(rep.reason, 'spamming chat nonstop');
  assert.equal(rep.status, 'open');
  // non-admin cannot list reports
  const denied = await get('/api/admin/reports', P1.token);
  assert.equal(denied.status, 403);
});

// ---- leaderboard ----
test('leaderboard: top 10 by money, descending', async () => {
  await seedUser({ money: 300000 });
  await seedUser({ money: 200000 });
  await seedUser({ money: 100000 });
  const r = await get('/api/leaderboard');
  assert.equal(r.status, 200);
  const L = r.json.leaders;
  assert.ok(L.length >= 3);
  assert.ok(L.length <= 10);
  for (let i = 1; i < L.length; i++) {
    assert.ok(L[i - 1].money >= L[i].money, 'descending money order');
  }
  assert.equal(L[0].money, 300000);
  assert.ok(L.every(x => typeof x.username === 'string' && typeof x.money === 'number'));
});

// ---- news ----
test('news feed: election events recorded and served', async () => {
  const r = await get('/api/news');
  assert.equal(r.status, 200);
  const texts = r.json.news.map(n => n.text);
  assert.ok(texts.some(t => /running for Governor/.test(t)), 'candidacy event');
  assert.ok(texts.some(t => /won the governorship/.test(t)), 'governor event');
  assert.ok(texts.some(t => /new governor race/.test(t)), 'new cycle event');
  assert.ok(r.json.news.length <= 20);
  assert.ok(r.json.news.every(n => n.ts && n.day >= 1 && n.type));
});
