// ============================================================
// game/notifications.js — Èkó Life in-app notification service (M21)
// Emits persistent notification rows + live `notification:new` WS events.
//
// Types: friend_online | room_message | money_received (+ future types).
// Web-push (VAPID) is intentionally later: this module is the single
// funnel — see docs/NOTIFICATIONS.md "Future: web push" for the hook
// point (sendPushFor(userId, notification)).
// ============================================================
import {
  createNotification,
  notificationPrefOn,
  listFriendships,
} from '../db.js';

// Per-friend "X is online" cooldown: max one notification per friend per
// 30 minutes, so rapid reconnects don't spam. In-memory (resets on
// restart — acceptable; documented in docs/NOTIFICATIONS.md).
const FRIEND_ONLINE_COOLDOWN_MS = 30 * 60 * 1000;
const friendOnlineHits = new Map(); // `${fromId}:${toId}` -> ts

export function createNotifications({ sendTo }) {
  const live = typeof sendTo === 'function' ? sendTo : () => {};

  // Core emit: preference-gated, persistent row + live event.
  // Returns the notification row id, or null when suppressed by prefs.
  async function emit(userId, type, title, body, data) {
    const uid = Number(userId);
    if (!uid) return null;
    let allowed = true;
    try { allowed = await notificationPrefOn(uid, type); }
    catch (e) { console.error('[notif] pref check:', e.message); }
    if (!allowed) return null;
    let id = null;
    try {
      id = await createNotification(uid, type, title, body, data);
    } catch (e) { console.error('[notif] create:', e.message); return null; }
    try {
      live(uid, {
        t: 'notification:new',
        notification: { id, type, title, body: body || null, data: data || null, read: false, created_at: Date.now() },
      });
    } catch (e) { console.error('[notif] live:', e.message); }
    return id;
  }

  // Friend came online: notify each ACCEPTED friend (pref-gated,
  // cooldown-gated). `onlineHas` reports whether a user currently has a
  // live socket — the row is created regardless so offline friends see it
  // when they next open the game.
  async function notifyFriendOnline(userId, username, onlineHas) {
    const uid = Number(userId);
    if (!uid) return;
    let friends = [];
    try { friends = await listFriendships(uid); }
    catch (e) { console.error('[notif] friends:', e.message); return; }
    const now = Date.now();
    for (const f of friends) {
      if (f.status !== 'accepted') continue;
      const fid = Number(f.other_id);
      if (!fid || fid === uid) continue;
      const key = `${uid}:${fid}`;
      const last = friendOnlineHits.get(key) || 0;
      if (now - last < FRIEND_ONLINE_COOLDOWN_MS) continue; // cooldown
      const id = await emit(
        fid,
        'friend_online',
        '🟢 Friend online',
        `${username} is online now.`,
        { userId: uid, username },
      );
      if (id) {
        friendOnlineHits.set(key, now);
        // Prune stale cooldown entries occasionally (bounded memory).
        if (friendOnlineHits.size > 5000) {
          for (const [k, ts] of friendOnlineHits) {
            if (now - ts > FRIEND_ONLINE_COOLDOWN_MS) friendOnlineHits.delete(k);
          }
        }
      }
    }
    void onlineHas;
  }

  // Room message: notify joined members except the sender. `members` is the
  // room's member rows ({player_id}); `isBlocked(recipientId, senderId)`
  // async predicate skips recipients who blocked the sender.
  async function notifyRoomMessage({ roomId, roomName, senderId, senderName, text, members, isBlocked }) {
    const rid = Number(roomId);
    const sid = Number(senderId);
    if (!rid || !sid) return;
    for (const mb of members || []) {
      const pid = Number(mb.player_id);
      if (!pid || pid === sid) continue;
      try {
        if (isBlocked && await isBlocked(pid, sid)) continue;
      } catch { /* deliver on db hiccup */ }
      await emit(
        pid,
        'room_message',
        `💬 ${roomName || 'Room'}`,
        `${senderName}: ${String(text).slice(0, 120)}`,
        { roomId: rid, roomName: roomName || null, senderId: sid, senderName },
      );
    }
  }

  // Gameplay-coins credit between players (e.g. shop sale proceeds).
  // Dormant-ready: call sites that don't exist yet should call this at
  // their completion point — see docs/NOTIFICATIONS.md.
  async function notifyMoneyReceived(userId, { amount, fromName, reason }) {
    const uid = Number(userId);
    const amt = Math.floor(Number(amount) || 0);
    if (!uid || amt <= 0) return null;
    return emit(
      uid,
      'money_received',
      '💰 Coins received',
      `+₦${amt.toLocaleString('en-NG')}${fromName ? ` from ${fromName}` : ''}${reason ? ` — ${reason}` : ''}.`,
      { amount: amt, fromName: fromName || null, reason: reason || null },
    );
  }

  return { emit, notifyFriendOnline, notifyRoomMessage, notifyMoneyReceived };
}
