// ============================================================
// ws/social.js — Èkó Life realtime social layer (M5)
// News ticker ring, friends, topic rooms, DMs, blocks, reports,
// @mention pings. Created once per hub via createSocial() and
// given the hub's online map + broadcast. Block-aware delivery:
// chat/room messages from a blocked user are hidden from the
// blocker, and DMs between blocked pairs are rejected both ways.
// ============================================================
import {
  getUserById, getUserByName,
  addFriendRequest, respondFriendRequest, removeFriend, listFriendships,
  createRoom, listRooms, getRoom, joinRoom, leaveRoom,
  roomMembers, roomMemberRole, setRoomMuted, playerRooms,
  addDm, dmThreads, dmHistory, unreadDmCount, setDmReadTs,
  addBlock, removeBlock, isBlocked, isBlockedEither, listBlocks,
  addReport,
  // PORT-P4: social — begin
  areFriends, getSocialSettings,
  hasDmThread, hasPendingDmRequest, createDmRequest, countPendingDmRequests,
  bumpBond,
  // PORT-P4: social — end
} from '../db.js';
import { cleanText } from '../game/data.js';

const ROOM_HISTORY = 50;
const NEWS_MAX = 20;
const CHAT_COOLDOWN_MS = 1200;

const PRESET_ROOMS = [
  { name: 'Hustle Talk', topic: 'Money moves & business gist', icon: '💼' },
  { name: 'Market Deals', topic: 'Buy & sell with other players', icon: '🛒' },
  { name: 'Governance', topic: 'Elections, laws & city talk', icon: '🗳️' },
  { name: 'Street Gist', topic: 'Bants, vibes & randomness', icon: '🎲' },
];

// rate limits: friend_add 20/hour, room create 5/hour (per user, in-memory)
const FRIEND_ADD_MAX = 20;
const ROOM_CREATE_MAX = 5;
const RATE_WINDOW_MS = 3600 * 1000;

export function createSocial({ online, broadcast, getDay, isGovernor, notifications }) {
  const govOf = typeof isGovernor === 'function' ? isGovernor : () => false;
  // M21: notification service (may be null in unit tests that build social standalone).
  const notif = notifications || null;
  // ---- news ticker ring (in-memory, last 20) ----
  const news = []; // { type, text, ts, day }
  function pushNews(type, text) {
    const item = { type, text: String(text).slice(0, 160), ts: Date.now(), day: getDay().day };
    news.push(item);
    if (news.length > NEWS_MAX) news.splice(0, news.length - NEWS_MAX);
    broadcast({ t: 'news', item });
    return item;
  }
  function getNews() { return news.slice(); }

  // ---- presence helper ----
  function sendTo(pid, msg) {
    const c = online.get(Number(pid));
    if (c && c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
  }
  const sysTo = (conn, text) => sendTo(conn.user.id, { t: 'sys', text });

  // ---- @mention pings ----
  function notifyMentions(text, fromName, fromId, where) {
    const seen = new Set();
    for (const m of String(text).matchAll(/@([A-Za-z0-9_]{3,20})/g)) {
      const uname = m[1].toLowerCase();
      if (seen.has(uname)) continue;
      seen.add(uname);
      for (const c of online.values()) {
        if (c.user.username.toLowerCase() === uname && Number(c.user.id) !== Number(fromId)) {
          // never ping someone who blocked the sender
          isBlocked(c.user.id, fromId).then((blocked) => {
            if (blocked) return;
            sendTo(c.user.id, {
              t: 'mention', from: fromName,
              where: where.kind === 'room' ? `room:${where.roomId}` : 'city',
              roomName: where.roomName || null,
              text: String(text).slice(0, 80),
            });
          }).catch(() => {});
        }
      }
    }
  }

  // ---- city chat broadcast (block-aware: hidden from the blocker) ----
  async function broadcastCityChat(entry) {
    for (const c of online.values()) {
      try {
        if (await isBlocked(c.user.id, entry.id)) continue; // blocker hides it
      } catch { /* deliver on db hiccup */ }
      sendTo(c.user.id, { t: 'chat', ...entry });
    }
  }

  // ---- friends ----
  async function friendsFor(pid) {
    const list = await listFriendships(pid);
    return list.map(f => {
      const o = online.get(f.other_id);
      return { ...f, online: !!o };
    });
  }
  async function pushFriends(pid) {
    try { sendTo(pid, { t: 'friends', friends: await friendsFor(pid) }); }
    catch (e) { console.error('[friends] push:', e.message); }
  }

  const friendAddHits = new Map(); // userId -> [ts]
  function friendAddOk(userId) {
    const now = Date.now();
    const hits = (friendAddHits.get(userId) || []).filter(t => now - t < RATE_WINDOW_MS);
    hits.push(now);
    friendAddHits.set(userId, hits);
    return hits.length <= FRIEND_ADD_MAX;
  }

  // ---- rooms ----
  const roomChats = new Map(); // roomId -> [{id,name,text,ts,gov}] (last 50)
  const roomRead = new Map();  // `${pid}:${roomId}` -> ts
  function roomHistory(roomId) {
    if (!roomChats.has(roomId)) roomChats.set(roomId, []);
    return roomChats.get(roomId);
  }
  function dropRoomHistory(roomId) {
    roomChats.delete(roomId);
    for (const k of [...roomRead.keys()]) {
      if (k.endsWith(`:${roomId}`)) roomRead.delete(k);
    }
  }

  async function seedRooms() {
    const existing = await listRooms();
    if (existing.length) return;
    for (const r of PRESET_ROOMS) await createRoom(r.name, r.topic, r.icon, 0);
    console.log('[rooms] seeded preset rooms');
  }

  // per-player room list with joined + unread flags
  async function roomListFor(pid) {
    const rooms = await listRooms();
    const mine = new Set(await playerRooms(pid));
    const me = online.get(Number(pid));
    const myName = me ? me.user.username : null;
    return Promise.all(rooms.map(async (r) => {
      const hist = roomHistory(Number(r.id));
      const readTs = roomRead.get(`${pid}:${r.id}`) || 0;
      // filter messages from users this player blocked
      let visible = hist;
      try {
        const visibleIds = new Set();
        for (const m of hist) {
          if (!(await isBlocked(pid, m.id))) visibleIds.add(m.id);
        }
        visible = hist.filter(m => visibleIds.has(m.id));
      } catch { /* show all on db hiccup */ }
      const unread = visible.filter(m => m.ts > readTs && m.name !== myName).length;
      return {
        id: Number(r.id), name: r.name, topic: r.topic, icon: r.icon,
        creator_id: Number(r.creator_id),
        members: Number(r.members),
        joined: mine.has(Number(r.id)),
        unread,
      };
    }));
  }

  async function refreshRooms() {
    for (const pid of online.keys()) {
      try { sendTo(pid, { t: 'rooms', rooms: await roomListFor(pid) }); }
      catch (e) { console.error('[rooms] refresh:', e.message); }
    }
  }

  async function pushRoomMembers(roomId) {
    const members = await roomMembers(roomId);
    const enriched = members.map(x => ({ ...x, online: online.has(x.player_id) }));
    for (const mb of members) sendTo(mb.player_id, { t: 'room_members', roomId, room_members: enriched });
  }

  // campaign room for a governor candidate ("X's Campaign", owner auto-joined)
  async function createCampaignRoom(playerId, username) {
    const roomId = await createRoom(
      `${username}'s Campaign`,
      `Campaign HQ — vote ${username} for Governor!`,
      '📣', playerId);
    await joinRoom(roomId, playerId, 'owner');
    roomRead.set(`${playerId}:${roomId}`, Date.now());
    return roomId;
  }

  const roomCreateHits = new Map(); // userId -> [ts]
  function roomCreateOk(userId) {
    const now = Date.now();
    const hits = (roomCreateHits.get(userId) || []).filter(t => now - t < RATE_WINDOW_MS);
    hits.push(now);
    roomCreateHits.set(userId, hits);
    return hits.length <= ROOM_CREATE_MAX;
  }

  // ---- message routing ----
  // Returns true when the message was handled (hub skips its own dispatch).
  async function route(conn, m) {
    const id = conn.user.id;
    const t = m && m.t;

    // ---------- friends ----------
    if (t === 'friend_add') {
      const uname = String(m.username || '').trim();
      if (!uname) return true;
      if (!friendAddOk(id)) { sysTo(conn, 'Too many friend requests — try again later.'); return true; }
      const target = await getUserByName(uname);
      if (!target) { sysTo(conn, `No player named "${uname}".`); return true; }
      const res = await addFriendRequest(id, target.id);
      if (res === 'self') sysTo(conn, 'You cannot add yourself.');
      else if (res === 'exists') sysTo(conn, 'Already friends or request pending.');
      else if (res === 'accepted') {
        sysTo(conn, `🤝 You and ${target.username} are now friends!`);
        sendTo(target.id, { t: 'sys', text: `🤝 You and ${conn.user.username} are now friends!` });
        await pushFriends(target.id);
      } else {
        sysTo(conn, `🤝 Friend request sent to ${target.username}.`);
        sendTo(target.id, {
          t: 'friend_request',
          from: { id: conn.user.id, username: conn.user.username },
        });
        await pushFriends(target.id);
      }
      await pushFriends(id);
      return true;
    }
    if (t === 'friend_accept' || t === 'friend_decline') {
      const otherId = Number(m.playerId);
      const ok = await respondFriendRequest(id, otherId, t === 'friend_accept');
      if (!ok) { sysTo(conn, 'No such request.'); return true; }
      const other = await getUserById(otherId);
      const uname = other ? other.username : 'them';
      sysTo(conn, t === 'friend_accept'
        ? `🤝 You are now friends with ${uname}!`
        : `Request from ${uname} declined.`);
      sendTo(otherId, {
        t: 'sys',
        text: t === 'friend_accept'
          ? `🤝 ${conn.user.username} accepted your friend request!`
          : `😶 ${conn.user.username} declined your friend request.`,
      });
      await pushFriends(otherId);
      await pushFriends(id);
      return true;
    }
    if (t === 'friend_remove') {
      const otherId = Number(m.playerId);
      await removeFriend(id, otherId);
      sysTo(conn, 'Friend removed.');
      await pushFriends(otherId);
      await pushFriends(id);
      return true;
    }
    if (t === 'friends') {
      await pushFriends(id);
      return true;
    }

    // ---------- rooms ----------
    if (t === 'rooms') {
      sendTo(id, { t: 'rooms', rooms: await roomListFor(id) });
      return true;
    }
    if (t === 'create_room') {
      if (!roomCreateOk(id)) { sysTo(conn, 'Room creation limit reached — try again later.'); return true; }
      const name = cleanText(m.name, 30);
      if (!name) { sysTo(conn, 'Give the room a name.'); return true; }
      const topic = cleanText(m.topic, 80);
      const icon = String(m.icon || '💬').slice(0, 4);
      const roomId = await createRoom(name, topic, icon, id);
      await joinRoom(roomId, id, 'owner');
      roomRead.set(`${id}:${roomId}`, Date.now());
      await refreshRooms();
      sendTo(id, { t: 'room_joined', roomId });
      return true;
    }
    if (t === 'join_room') {
      const roomId = Number(m.roomId);
      const room = await getRoom(roomId);
      if (!room) { sysTo(conn, 'Room not found.'); return true; }
      await joinRoom(roomId, id, 'member');
      roomRead.set(`${id}:${roomId}`, Date.now());
      const hist = roomHistory(roomId).slice(-ROOM_HISTORY)
        .filter(x => x.id !== undefined);
      // hide messages from users this player blocked
      const visible = [];
      for (const x of hist) {
        try { if (await isBlocked(id, x.id)) continue; } catch { /* show */ }
        visible.push(x);
      }
      sendTo(id, { t: 'room_joined', roomId, history: visible });
      await refreshRooms();
      await pushRoomMembers(roomId);
      return true;
    }
    if (t === 'leave_room') {
      const roomId = Number(m.roomId);
      await leaveRoom(roomId, id);
      roomRead.delete(`${id}:${roomId}`);
      sendTo(id, { t: 'room_left', roomId });
      await refreshRooms();
      await pushRoomMembers(roomId);
      return true;
    }
    if (t === 'room_chat') {
      const roomId = Number(m.roomId);
      const mem = await roomMemberRole(roomId, id);
      if (!mem) { sysTo(conn, 'Join the room first.'); return true; }
      if (Date.now() < mem.muted_until) { sysTo(conn, '🔇 You are muted in this room.'); return true; }
      const now = Date.now();
      if (now - conn.lastChat < CHAT_COOLDOWN_MS) {
        sendTo(id, { t: 'err', text: 'Slow down on the chat.' });
        return true;
      }
      conn.lastChat = now;
      const text = cleanText(m.text, 200);
      if (!text) return true;
      const room = await getRoom(roomId);
      const entry = { id, name: conn.user.username, text, ts: now, gov: govOf(id) };
      const hist = roomHistory(roomId);
      hist.push(entry);
      if (hist.length > ROOM_HISTORY) hist.splice(0, hist.length - ROOM_HISTORY);
      const members = await roomMembers(roomId);
      for (const mb of members) {
        const mo = online.get(mb.player_id);
        if (!mo || mo.ws.readyState !== 1) continue;
        try { if (await isBlocked(mb.player_id, id)) continue; } catch { /* deliver */ }
        sendTo(mb.player_id, { t: 'room_msg', roomId, ...entry });
        if (mb.player_id !== id) {
          const readTs = roomRead.get(`${mb.player_id}:${roomId}`) || 0;
          const unread = hist.filter(
            x => x.ts > readTs && x.name !== mo.user.username).length;
          sendTo(mb.player_id, { t: 'room_unread', roomId, unread });
        }
      }
      notifyMentions(text, conn.user.username, id,
        { kind: 'room', roomId, roomName: room ? room.name : '' });
      // M21: room-message notifications for joined members (sender skipped;
      // blocked-by-sender skipped; client suppresses while the room is open).
      if (notif) {
        try {
          await notif.notifyRoomMessage({
            roomId, roomName: room ? room.name : '',
            senderId: id, senderName: conn.user.username, text,
            members, isBlocked,
          });
        } catch (e) { console.error('[notif] room_message:', e.message); }
      }
      return true;
    }
    if (t === 'room_members') {
      const roomId = Number(m.roomId);
      const mem = await roomMemberRole(roomId, id);
      if (!mem) return true;
      const members = await roomMembers(roomId);
      sendTo(id, {
        t: 'room_members', roomId,
        room_members: members.map(x => ({ ...x, online: online.has(x.player_id) })),
      });
      return true;
    }
    if (t === 'room_read') {
      roomRead.set(`${id}:${Number(m.roomId)}`, Date.now());
      return true;
    }
    if (t === 'kick_room' || t === 'mute_room') {
      const roomId = Number(m.roomId);
      const targetId = Number(m.playerId);
      const mem = await roomMemberRole(roomId, id);
      const room = await getRoom(roomId);
      const isAdmin = !!Number(conn.user.is_admin);
      if (!mem || (mem.role !== 'owner' && !isAdmin)) {
        sysTo(conn, 'Only the room owner can do that.');
        return true;
      }
      if (targetId === id) { sysTo(conn, 'You cannot moderate yourself.'); return true; }
      const targetMem = await roomMemberRole(roomId, targetId);
      if (!targetMem) { sysTo(conn, 'They are not in this room.'); return true; }
      const roomName = room ? room.name : 'a room';
      if (t === 'kick_room') {
        await leaveRoom(roomId, targetId);
        roomRead.delete(`${targetId}:${roomId}`);
        sendTo(targetId, { t: 'sys', text: `👢 You were kicked from "${roomName}".` });
        sendTo(targetId, { t: 'room_left', roomId });
        sysTo(conn, 'Member kicked.');
      } else {
        const mins = Math.max(1, Math.min(1440, Number(m.minutes) || 10));
        await setRoomMuted(roomId, targetId, Date.now() + mins * 60000);
        sendTo(targetId, { t: 'sys', text: `🔇 You are muted in "${roomName}" for ${mins}m.` });
        sysTo(conn, `Muted for ${mins}m.`);
      }
      await pushRoomMembers(roomId);
      await refreshRooms();
      return true;
    }

    // ---------- DMs (block-aware, rejected both ways) ----------
    if (t === 'dm') {
      const toId = Number(m.to);
      const target = toId && toId !== id ? await getUserById(toId) : null;
      if (!target) { sendTo(id, { t: 'err', text: 'Player not found.' }); return true; }
      if (await isBlockedEither(id, toId)) {
        sendTo(id, { t: 'err', text: 'You cannot DM this player.' });
        return true;
      }
      const text = cleanText(m.text, 200);
      if (!text) return true;
      const now = Date.now();
      // PORT-P4: social — begin (message requests: stranger DMs are held
      // for the recipient's approval; "friends-only" recipients reject).
      const dmSettings = await getSocialSettings(toId).catch(() => ({ message_policy: 'everyone' }));
      const dmFriends = await areFriends(id, toId).catch(() => false);
      const dmThread = await hasDmThread(id, toId).catch(() => true);
      if (!dmFriends && !dmThread) {
        if (dmSettings.message_policy === 'friends') {
          sendTo(id, { t: 'err', text: `@${target.username} only accepts messages from friends.` });
          return true;
        }
        if (await hasPendingDmRequest(id, toId).catch(() => true)) {
          sendTo(id, { t: 'sys', text: `Your message request to @${target.username} is still pending.` });
          return true;
        }
        const reqId = await createDmRequest(id, toId, text);
        sendTo(toId, { t: 'dm_request', id: reqId, from: id, fromName: conn.user.username, text, ts: now });
        sendTo(toId, { t: 'dm_requests', n: await countPendingDmRequests(toId).catch(() => 0) });
        sendTo(id, { t: 'dm_request_sent', to: toId });
        return true;
      }
      // PORT-P4: social — end
      await addDm(id, toId, text, now);
      // PORT-P4: social — begin (closeness grows with every exchanged DM)
      bumpBond(id, toId, 'dms').catch(() => {});
      // PORT-P4: social — end
      const to = online.get(toId);
      if (to) {
        sendTo(toId, { t: 'dm', from: id, fromName: conn.user.username, text, ts: now });
        sendTo(toId, { t: 'dm_unread', n: await unreadDmCount(toId) });
      }
      sendTo(id, { t: 'dm_sent', to: toId });
      return true;
    }
    if (t === 'dm_threads') {
      sendTo(id, { t: 'dm_threads', threads: await dmThreads(id) });
      return true;
    }
    if (t === 'dm_history') {
      const withId = Number(m.with);
      const other = withId ? await getUserById(withId) : null;
      if (!other) return true;
      sendTo(id, {
        t: 'dm_history', with: withId, withName: other.username,
        msgs: await dmHistory(id, withId),
      });
      return true;
    }
    if (t === 'dm_read') {
      const now = Date.now();
      const withId = Number(m.with);
      if (withId) {
        await setDmReadTs(id, withId, now);
      } else {
        // mark every thread read
        const threads = await dmThreads(id);
        for (const th of threads) await setDmReadTs(id, th.pid, now);
      }
      sendTo(id, { t: 'dm_unread', n: await unreadDmCount(id) });
      return true;
    }

    // ---------- blocks ----------
    if (t === 'block') {
      const targetId = Number(m.playerId);
      const target = targetId && targetId !== id ? await getUserById(targetId) : null;
      if (!target) { sysTo(conn, 'Player not found.'); return true; }
      await addBlock(id, targetId);
      sysTo(conn, `🚫 Blocked ${target.username}. You won't see their chats or DMs.`);
      sendTo(id, { t: 'blocks', blocks: await listBlocks(id) });
      return true;
    }
    if (t === 'unblock') {
      const targetId = Number(m.playerId);
      await removeBlock(id, targetId);
      sysTo(conn, 'Unblocked.');
      sendTo(id, { t: 'blocks', blocks: await listBlocks(id) });
      return true;
    }
    if (t === 'blocks') {
      sendTo(id, { t: 'blocks', blocks: await listBlocks(id) });
      return true;
    }

    // ---------- reports ----------
    if (t === 'report') {
      const targetId = Number(m.playerId);
      const target = targetId && targetId !== id ? await getUserById(targetId) : null;
      if (!target) { sysTo(conn, 'Player not found.'); return true; }
      const reason = cleanText(m.reason, 200);
      if (!reason) { sysTo(conn, 'Give a reason for the report.'); return true; }
      await addReport(id, targetId, reason);
      sysTo(conn, 'Report received — admins will review.');
      console.log(`[report] ${conn.user.username} reported ${target.username}: ${reason.slice(0, 60)}`);
      return true;
    }

    return false; // not a social message — hub handles it
  }

  return {
    pushNews, getNews,
    broadcastCityChat, notifyMentions,
    friendsFor, pushFriends,
    seedRooms, roomListFor, refreshRooms, pushRoomMembers,
    createCampaignRoom, dropRoomHistory,
    dmThreads, unreadDmCount,
    route,
  };
}
