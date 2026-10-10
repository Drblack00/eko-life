// ============================================================
// routes/friends.js — Èkó Life Friends page REST API (W3)
// Dedicated Friends tab: list, incoming/outgoing requests, add by
// username, accept/decline/cancel/remove, invite links + referral count.
//
// All routes sit behind the existing authMiddleware (Bearer <redacted>);
// users can only ever see or mutate their own friendships — every
// mutating route re-checks that the friendship involves req.userId.
// Referral attribution is data-only: no coins, no rewards, no payouts.
// The fintech cash system is untouched.
// ============================================================
import { Router } from 'express';
import { authMiddleware, USER_RE } from '../auth.js';
import {
  getUserByName, getCharacter,
  addFriendRequest, respondFriendRequest,
  listFriendships, friendshipById, deleteFriendshipById,
  encodeReferralCode, countReferrals,
} from '../db.js';

// Mirror of the WS social layer's 20/hr friend-add cap (ws/social.js).
const FRIEND_ADD_MAX = 20;
const RATE_WINDOW_MS = 3600 * 1000;
const addHits = new Map(); // userId -> [ts]

function addRateLimited(userId) {
  const now = Date.now();
  const arr = (addHits.get(userId) || []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  addHits.set(userId, arr);
  return arr.length > FRIEND_ADD_MAX;
}

function inviteLinkFor(req, code) {
  const host = req.get('host') || 'ekolife.onrender.com';
  const proto = /localhost|127\.0\.0\.1/.test(host) ? req.protocol : 'https';
  return `${proto}://${host}/?ref=${code}`;
}

export function createFriendsRouter({ hub }) {
  const router = Router();
  router.use(authMiddleware);

  const isOnline = (id) => {
    try { return hub && hub.online ? hub.online.has(Number(id)) : false; }
    catch { return false; }
  };

  const shape = (f) => ({
    id: f.id,
    other_id: f.other_id,
    other_username: f.other_username,
    status: f.status,
    incoming: !!f.incoming,
    online: isOnline(f.other_id),
    last_seen: f.other_last_seen,
    created_ts: f.created_ts,
  });

  // ---- list: pending + accepted friendships with live online flags ----
  router.get('/', async (req, res) => {
    try {
      const friends = await listFriendships(req.userId);
      res.json({ friends: friends.map(shape) });
    } catch (e) { console.error('[friends] list:', e.message); res.status(500).json({ error: 'Could not load friends.' }); }
  });

  // ---- incoming / outgoing pending requests ----
  router.get('/requests', async (req, res) => {
    try {
      const all = await listFriendships(req.userId);
      const pending = all.filter((f) => f.status === 'pending');
      res.json({
        incoming: pending.filter((f) => f.incoming).map(shape),
        outgoing: pending.filter((f) => !f.incoming).map(shape),
      });
    } catch (e) { console.error('[friends] requests:', e.message); res.status(500).json({ error: 'Could not load requests.' }); }
  });

  // ---- exact-username lookup → profile snippet (for "add by username") ----
  router.get('/lookup', async (req, res) => {
    try {
      const username = String(req.query.username || '').trim();
      if (!USER_RE.test(username)) return res.status(400).json({ error: 'Enter a valid username.' });
      const user = await getUserByName(username);
      if (!user) return res.status(404).json({ error: 'No player found with that username.' });
      let avatar = '🧑', color = '#22d3ee';
      try {
        const ch = await getCharacter(user.id);
        if (ch) { avatar = ch.avatar || avatar; color = ch.color || color; }
      } catch { /* snippet still works without character */ }
      res.json({
        id: Number(user.id),
        username: user.username,
        avatar,
        color,
        is_self: Number(user.id) === req.userId,
      });
    } catch (e) { console.error('[friends] lookup:', e.message); res.status(500).json({ error: 'Lookup failed.' }); }
  });

  // ---- send a friend request (idempotent: duplicate → existing row) ----
  router.post('/request', async (req, res) => {
    try {
      if (addRateLimited(req.userId)) {
        return res.status(429).json({ error: 'Too many requests — slow down a little.' });
      }
      const username = String(req.body.username || '').trim();
      if (!USER_RE.test(username)) return res.status(400).json({ error: 'Enter a valid username.' });
      const target = await getUserByName(username);
      if (!target) return res.status(404).json({ error: 'No player found with that username.' });
      if (Number(target.id) === req.userId) {
        return res.status(400).json({ error: "You can't add yourself as a friend." });
      }
      const result = await addFriendRequest(req.userId, target.id);
      if (result === 'self') {
        return res.status(400).json({ error: "You can't add yourself as a friend." });
      }
      const mine = (await listFriendships(req.userId)).find((f) => f.other_id === Number(target.id));
      res.json({ ok: true, result, friendship: mine ? shape(mine) : null });
    } catch (e) { console.error('[friends] request:', e.message); res.status(500).json({ error: 'Could not send request.' }); }
  });

  // ---- accept / decline: only the addressee of a pending request ----
  async function loadOwned(req, res) {
    const f = await friendshipById(req.params.id);
    if (!f || (Number(f.requester_id) !== req.userId && Number(f.addressee_id) !== req.userId)) {
      res.status(404).json({ error: 'Request not found.' });
      return null;
    }
    return f;
  }

  router.post('/:id/accept', async (req, res) => {
    try {
      const f = await loadOwned(req, res);
      if (!f) return;
      if (f.status !== 'pending') return res.status(409).json({ error: 'This request is no longer pending.' });
      if (Number(f.addressee_id) !== req.userId) {
        return res.status(403).json({ error: 'Only the recipient can accept this request.' });
      }
      await respondFriendRequest(req.userId, f.requester_id, true);
      res.json({ ok: true, accepted: true, friendship_id: Number(f.id) });
    } catch (e) { console.error('[friends] accept:', e.message); res.status(500).json({ error: 'Could not accept request.' }); }
  });

  router.post('/:id/decline', async (req, res) => {
    try {
      const f = await loadOwned(req, res);
      if (!f) return;
      if (f.status !== 'pending') return res.status(409).json({ error: 'This request is no longer pending.' });
      if (Number(f.addressee_id) !== req.userId) {
        return res.status(403).json({ error: 'Only the recipient can decline this request.' });
      }
      await respondFriendRequest(req.userId, f.requester_id, false);
      res.json({ ok: true, declined: true, friendship_id: Number(f.id) });
    } catch (e) { console.error('[friends] decline:', e.message); res.status(500).json({ error: 'Could not decline request.' }); }
  });

  // ---- DELETE: cancel an outgoing pending request, or unfriend ----
  router.delete('/:id', async (req, res) => {
    try {
      const f = await loadOwned(req, res);
      if (!f) return;
      if (f.status === 'pending' && Number(f.requester_id) !== req.userId) {
        return res.status(403).json({ error: 'Only the sender can cancel this request.' });
      }
      if (f.status !== 'pending' && f.status !== 'accepted') {
        return res.status(409).json({ error: 'Nothing to remove.' });
      }
      await deleteFriendshipById(f.id);
      res.json({ ok: true, removed: true, friendship_id: Number(f.id) });
    } catch (e) { console.error('[friends] remove:', e.message); res.status(500).json({ error: 'Could not remove.' }); }
  });

  // ---- invite: my referral code + shareable link + join count ----
  router.get('/invite', async (req, res) => {
    try {
      const code = encodeReferralCode(req.userId);
      const joined = await countReferrals(req.userId);
      res.json({ code, link: inviteLinkFor(req, code), joined });
    } catch (e) { console.error('[friends] invite:', e.message); res.status(500).json({ error: 'Could not load invite info.' }); }
  });

  return router;
}
