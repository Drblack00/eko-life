// ============================================================
// routes/social.js — Èkó Life Social REST API (PORT-P4).
//
// Groups, message requests, house invites, closeness bonds
// (family & dating), and social settings — all behind
// authMiddleware (Bearer <redacted>). Game-money only throughout:
// gifts spend gameplay coins; nothing here touches the fintech
// cash system or enables real-money movement of any kind.
//
//   Groups (private rooms backed by the M5 rooms tables; chat itself
//   stays on the realtime socket):
//     POST   /api/social/groups            create (name + icon + members)
//     GET    /api/social/groups            my groups
//     POST   /api/social/groups/:id/members  owner adds a member
//     POST   /api/social/groups/:id/leave
//     DELETE /api/social/groups/:id        owner deletes
//   Message requests (stranger DMs held for approval):
//     GET    /api/social/messages/requests
//     POST   /api/social/messages/requests/:id/approve
//     POST   /api/social/messages/requests/:id/ignore
//   House invites (per-player link, 5-guest cap, knock flow):
//     GET    /api/social/house/invite      my link
//     GET    /api/social/house/visit/:token  resolve a host's link
//     POST   /api/social/house/knock       { token }
//     GET    /api/social/house/knocks      incoming knocks + guests
//     POST   /api/social/house/knocks/:id/approve
//     POST   /api/social/house/knocks/:id/decline
//   Closeness bonds (family & dating unlocks):
//     GET    /api/social/bonds             my bonds
//     GET    /api/social/bonds/:username   closeness detail
//     POST   /api/social/hangouts          { username }
//     POST   /api/social/gifts             { username, gift }
//     POST   /api/social/family/request    { username }
//     POST   /api/social/family/respond    { username, accept }
//     POST   /api/social/dating/request    { username }
//     POST   /api/social/dating/respond    { username, accept }
//   Settings:
//     GET    /api/social/settings
//     PUT    /api/social/settings          partial merge
// ============================================================
import { Router } from 'express';
import { authMiddleware, USER_RE } from '../auth.js';
import {
  getUserById, getUserByName,
  ensureCharacter, saveCharacter, addTransaction,
  createRoom, joinRoom, getRoom, roomMembers, roomMemberRole,
  leaveRoom, deleteRoom, playerRooms,
  areFriends, isBlockedEither,
  createDmRequest, listPendingDmRequests, getDmRequest,
  respondDmRequest, hasPendingDmRequest, hasDmThread,
  countPendingDmRequests, addDm,
  getOrCreateHouseInvite, getHouseInviteByToken, createKnock,
  getKnock, hasPendingKnock, countApprovedGuests, listKnocks, respondKnock,
  getBond, bumpBond, bondScore, BOND_FAMILY_AT, BOND_DATING_AT,
  setBondStatus, listBonds,
  getSocialSettings, setSocialSettings,
} from '../db.js';

// 16-emoji group icon picker (shared with the client).
export const GROUP_ICONS = [
  '💬', '🏠', '💼', '🎶', '⚽', '🍲', '📚', '🎮',
  '🌊', '🔥', '🚗', '💰', '🎓', '🏋️', '🎬', '🌴',
];

// Gift shelf: fixed gameplay-coin prices, original Naija flavor.
// Gifts are pure sentiment — they grow closeness, nothing else.
export const GIFTS = [
  { id: 'gala', emoji: '🥜', name: 'Gala & cold drink', cost: 500 },
  { id: 'puffpuff', emoji: '🍩', name: 'Dozen hot puff-puff', cost: 1500 },
  { id: 'suya', emoji: '🍢', name: 'Suya platter', cost: 3000 },
  { id: 'ankara', emoji: '🧣', name: 'Ankara wristband', cost: 5000 },
  { id: 'asoebi', emoji: '👗', name: 'Aso-ebi fabric', cost: 12000 },
];

export const HOUSE_GUEST_CAP = 5; // max approved guests at once
const HANGOUT_COOLDOWN_MS = 3600 * 1000; // 1/hr per pair (soft anti-farm)

/** Group create: max 5/hour per user (mirrors the WS room cap). */
const GROUP_CREATE_MAX = 5;
const RATE_WINDOW_MS = 3600 * 1000;
const createHits = new Map(); // userId -> [ts]
export function _resetSocialRateLimit() { createHits.clear(); }
const hangoutHits = new Map(); // "a:b" -> ts
export function _resetHangoutCooldown() { hangoutHits.clear(); }

function createRateLimited(userId) {
  const now = Date.now();
  const arr = (createHits.get(Number(userId)) || []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  createHits.set(Number(userId), arr);
  return arr.length > GROUP_CREATE_MAX;
}

function houseLinkFor(req, token) {
  const host = req.get('host') || 'ekolife.onrender.com';
  const proto = /localhost|127\.0\.0\.1/.test(host) ? req.protocol : 'https';
  return `${proto}://${host}/v/${token}`;
}

function pushTo(hub, pid, msg) {
  try {
    const conn = hub && hub.online && hub.online.get(Number(pid));
    if (conn && conn.ws && conn.ws.readyState === 1) {
      conn.ws.send(JSON.stringify(msg));
    }
  } catch { /* best effort */ }
}

/** Resolve a username body field to a user row (400/404 handled by caller). */
async function resolveTarget(username, meId) {
  const name = String(username || '').trim();
  if (!USER_RE.test(name)) return { error: 'Enter a valid username.' };
  const target = await getUserByName(name);
  if (!target) return { error: 'No player found with that username.' };
  if (Number(target.id) === Number(meId)) return { error: "That's you — pick someone else." };
  return { target };
}

export function createSocialRouter({ hub } = {}) {
  const router = Router();
  router.use(authMiddleware);

  // ================= groups =================

  // Create a group: name + icon + members by username.
  // Creator is added automatically as owner; Create requires
  // a name and at least one valid member (client enforces too).
  router.post('/groups', async (req, res) => {
    try {
      if (createRateLimited(req.userId)) {
        return res.status(429).json({ error: 'Too many groups — try again later.' });
      }
      const name = String(req.body?.name || '').trim().slice(0, 32);
      if (!name) return res.status(400).json({ error: 'Give your group a name.' });
      const icon = GROUP_ICONS.includes(req.body?.icon) ? req.body.icon : '💬';
      const rawMembers = Array.isArray(req.body?.members) ? req.body.members : [];
      const seen = new Set();
      const members = [];
      for (const m of rawMembers.slice(0, 20)) {
        const uname = String(m || '').trim();
        if (!USER_RE.test(uname) || seen.has(uname.toLowerCase())) continue;
        seen.add(uname.toLowerCase());
        const u = await getUserByName(uname);
        if (!u || Number(u.id) === req.userId) continue;
        members.push(u);
      }
      if (members.length === 0) {
        return res.status(400).json({ error: 'Add at least one valid member by username.' });
      }
      const roomId = await createRoom(name, '', icon, req.userId);
      await joinRoom(roomId, req.userId, 'owner');
      for (const m of members) {
        try { await joinRoom(roomId, m.id, 'member'); } catch { /* already in */ }
      }
      res.status(201).json({
        group: {
          id: Number(roomId),
          name,
          icon,
          members: members.map((m) => m.username),
        },
      });
    } catch (e) { console.error('[social] group create:', e.message); res.status(500).json({ error: 'Could not create the group.' }); }
  });

  // My groups (rooms I'm a member of, newest first).
  router.get('/groups', async (req, res) => {
    try {
      const roomIds = await playerRooms(req.userId); // array of room ids
      const out = [];
      for (const rid of roomIds) {
        const r = await getRoom(rid);
        if (!r) continue;
        const mems = await roomMembers(r.id);
        out.push({
          id: Number(r.id),
          name: r.name,
          topic: r.topic || '',
          icon: r.icon || '💬',
          member_count: mems.length,
          role: (await roomMemberRole(r.id, req.userId))?.role || null,
        });
      }
      res.json({ groups: out });
    } catch (e) { console.error('[social] groups list:', e.message); res.status(500).json({ error: 'Could not load groups.' }); }
  });

  // Owner adds a member by username.
  router.post('/groups/:id/members', async (req, res) => {
    try {
      const room = await getRoom(req.params.id);
      if (!room) return res.status(404).json({ error: 'Group not found.' });
      const role = (await roomMemberRole(room.id, req.userId))?.role;
      if (role !== 'owner') return res.status(403).json({ error: 'Only the group owner can add members.' });
      const { target, error } = await resolveTarget(req.body?.username, req.userId);
      if (error) return res.status(400).json({ error });
      await joinRoom(room.id, target.id, 'member');
      res.json({ ok: true, username: target.username });
    } catch (e) { console.error('[social] group add:', e.message); res.status(500).json({ error: 'Could not add the member.' }); }
  });

  router.post('/groups/:id/leave', async (req, res) => {
    try {
      const room = await getRoom(req.params.id);
      if (!room) return res.status(404).json({ error: 'Group not found.' });
      await leaveRoom(room.id, req.userId);
      res.json({ ok: true });
    } catch (e) { console.error('[social] group leave:', e.message); res.status(500).json({ error: 'Could not leave the group.' }); }
  });

  router.delete('/groups/:id', async (req, res) => {
    try {
      const room = await getRoom(req.params.id);
      if (!room) return res.status(404).json({ error: 'Group not found.' });
      const role = (await roomMemberRole(room.id, req.userId))?.role;
      if (role !== 'owner' && Number(room.creator_id) !== req.userId) {
        return res.status(403).json({ error: 'Only the group owner can delete it.' });
      }
      await deleteRoom(room.id);
      res.json({ ok: true, deleted: true });
    } catch (e) { console.error('[social] group delete:', e.message); res.status(500).json({ error: 'Could not delete the group.' }); }
  });

  // ================= message requests =================

  router.get('/messages/requests', async (req, res) => {
    try {
      res.json({ requests: await listPendingDmRequests(req.userId) });
    } catch (e) { console.error('[social] requests list:', e.message); res.status(500).json({ error: 'Could not load message requests.' }); }
  });

  // Approve: the held first message is delivered as a real DM; the pair
  // now has a thread, so future DMs flow straight through.
  router.post('/messages/requests/:id/approve', async (req, res) => {
    try {
      const r = await getDmRequest(req.params.id);
      if (!r || Number(r.to_id) !== req.userId || r.status !== 'pending') {
        return res.status(404).json({ error: 'Request not found.' });
      }
      await respondDmRequest(r.id, 'approved');
      await addDm(r.from_id, r.to_id, r.text, Number(r.ts) || Date.now());
      await bumpBond(r.from_id, r.to_id, 'dms');
      const me = await getUserById(req.userId);
      pushTo(hub, r.to_id, {
        t: 'dm', from: r.from_id,
        fromName: (await getUserById(r.from_id))?.username || 'player',
        text: r.text, ts: Number(r.ts) || Date.now(),
      });
      pushTo(hub, r.from_id, { t: 'dm_request_approved', by: req.userId, byName: me?.username || 'player' });
      res.json({ ok: true, approved: true, partner_id: Number(r.from_id) });
    } catch (e) { console.error('[social] request approve:', e.message); res.status(500).json({ error: 'Could not approve the request.' }); }
  });

  router.post('/messages/requests/:id/ignore', async (req, res) => {
    try {
      const r = await getDmRequest(req.params.id);
      if (!r || Number(r.to_id) !== req.userId || r.status !== 'pending') {
        return res.status(404).json({ error: 'Request not found.' });
      }
      await respondDmRequest(r.id, 'ignored');
      res.json({ ok: true, ignored: true });
    } catch (e) { console.error('[social] request ignore:', e.message); res.status(500).json({ error: 'Could not ignore the request.' }); }
  });

  // ================= house invites =================

  // My persistent invite link. Original URL scheme: /v/<token>
  // (distinct from the signup referral ?ref= link).
  router.get('/house/invite', async (req, res) => {
    try {
      const row = await getOrCreateHouseInvite(req.userId);
      const guests = await countApprovedGuests(req.userId);
      res.json({
        token: row.token,
        link: houseLinkFor(req, row.token),
        guests,
        guest_cap: HOUSE_GUEST_CAP,
      });
    } catch (e) { console.error('[social] house invite:', e.message); res.status(500).json({ error: 'Could not load your house link.' }); }
  });

  // Resolve someone's house link (to preview before knocking).
  router.get('/house/visit/:token', async (req, res) => {
    try {
      const row = await getHouseInviteByToken(req.params.token);
      if (!row) return res.status(404).json({ error: 'This house link is invalid.' });
      if (Number(row.host_id) === req.userId) {
        return res.status(400).json({ error: "That's your own house link." });
      }
      res.json({
        host_id: Number(row.host_id),
        host_username: row.host_username,
        guests: await countApprovedGuests(row.host_id),
        guest_cap: HOUSE_GUEST_CAP,
      });
    } catch (e) { console.error('[social] house visit:', e.message); res.status(500).json({ error: 'Could not open this house link.' }); }
  });

  // Knock on a host's door: creates a pending knock for the host to approve.
  router.post('/house/knock', async (req, res) => {
    try {
      const row = await getHouseInviteByToken(String(req.body?.token || ''));
      if (!row) return res.status(404).json({ error: 'This house link is invalid.' });
      if (Number(row.host_id) === req.userId) {
        return res.status(400).json({ error: "You can't knock on your own door." });
      }
      if (await isBlockedEither(req.userId, Number(row.host_id))) {
        return res.status(403).json({ error: 'You cannot visit this house.' });
      }
      if (await hasPendingKnock(row.host_id, req.userId)) {
        return res.status(409).json({ error: 'You already knocked — waiting on the host.' });
      }
      if ((await countApprovedGuests(row.host_id)) >= HOUSE_GUEST_CAP) {
        return res.status(409).json({ error: 'This house is full right now (5 guests).' });
      }
      const knockId = await createKnock(row.host_id, req.userId);
      const me = await getUserById(req.userId);
      pushTo(hub, row.host_id, {
        t: 'knock', knock_id: knockId,
        visitor_id: req.userId, visitor: me?.username || 'player',
      });
      res.status(201).json({ ok: true, knock_id: knockId });
    } catch (e) { console.error('[social] knock:', e.message); res.status(500).json({ error: 'Could not knock.' }); }
  });

  // My incoming knocks (pending) + current approved guests.
  router.get('/house/knocks', async (req, res) => {
    try {
      const [pending, guests] = await Promise.all([
        listKnocks(req.userId, 'pending'),
        listKnocks(req.userId, 'approved'),
      ]);
      res.json({ pending, guests, guest_cap: HOUSE_GUEST_CAP });
    } catch (e) { console.error('[social] knocks list:', e.message); res.status(500).json({ error: 'Could not load knocks.' }); }
  });

  router.post('/house/knocks/:id/approve', async (req, res) => {
    try {
      const k = await getKnock(req.params.id);
      if (!k || Number(k.host_id) !== req.userId || k.status !== 'pending') {
        return res.status(404).json({ error: 'Knock not found.' });
      }
      if ((await countApprovedGuests(req.userId)) >= HOUSE_GUEST_CAP) {
        return res.status(409).json({ error: 'Your house is full (5 guests) — decline someone first.' });
      }
      await respondKnock(k.id, 'approved');
      const me = await getUserById(req.userId);
      pushTo(hub, k.visitor_id, { t: 'knock_approved', by: req.userId, byName: me?.username || 'player' });
      res.json({ ok: true, approved: true });
    } catch (e) { console.error('[social] knock approve:', e.message); res.status(500).json({ error: 'Could not approve.' }); }
  });

  router.post('/house/knocks/:id/decline', async (req, res) => {
    try {
      const k = await getKnock(req.params.id);
      if (!k || Number(k.host_id) !== req.userId || k.status !== 'pending') {
        return res.status(404).json({ error: 'Knock not found.' });
      }
      await respondKnock(k.id, 'declined');
      res.json({ ok: true, declined: true });
    } catch (e) { console.error('[social] knock decline:', e.message); res.status(500).json({ error: 'Could not decline.' }); }
  });

  // ================= closeness bonds =================

  const shapeBond = (b) => ({
    other_id: b.other_id,
    other_username: b.other_username,
    dm_count: b.dm_count,
    hangout_count: b.hangout_count,
    gift_count: b.gift_count,
    score: b.score,
    can_family: b.score >= BOND_FAMILY_AT,
    can_date: b.score >= BOND_DATING_AT,
    family: b.family,
    dating: b.dating,
    family_request_from: b.family === 'pending' ? b.family_by : 0,
    dating_request_from: b.dating === 'pending' ? b.dating_by : 0,
  });

  router.get('/bonds', async (req, res) => {
    try {
      res.json({ bonds: (await listBonds(req.userId)).map(shapeBond) });
    } catch (e) { console.error('[social] bonds list:', e.message); res.status(500).json({ error: 'Could not load bonds.' }); }
  });

  router.get('/bonds/:username', async (req, res) => {
    try {
      const { target, error } = await resolveTarget(req.params.username, req.userId);
      if (error) return res.status(400).json({ error });
      const row = await getBond(req.userId, target.id);
      const otherId = Number(row.a_id) === req.userId ? Number(row.b_id) : Number(row.a_id);
      // PORT-P4: relationships visibility — when the other player hides
      // relationships, their family/dating badges are masked for viewers.
      const targetSettings = await getSocialSettings(target.id);
      const visible = targetSettings.relationships_visible;
      const shaped = shapeBond({
        other_id: otherId,
        other_username: target.username,
        dm_count: Number(row.dm_count) || 0,
        hangout_count: Number(row.hangout_count) || 0,
        gift_count: Number(row.gift_count) || 0,
        score: bondScore(row),
        family: row.family,
        family_by: Number(row.family_by) || 0,
        dating: row.dating,
        dating_by: Number(row.dating_by) || 0,
      });
      if (!visible) {
        shaped.family = 'hidden';
        shaped.dating = 'hidden';
      }
      res.json({
        bond: shaped,
        relationships_visible: visible,
        thresholds: { family_at: BOND_FAMILY_AT, date_at: BOND_DATING_AT },
      });
    } catch (e) { console.error('[social] bond detail:', e.message); res.status(500).json({ error: 'Could not load this bond.' }); }
  });

  // Record a hangout with another player (1/hr per pair, anti-farm).
  router.post('/hangouts', async (req, res) => {
    try {
      const { target, error } = await resolveTarget(req.body?.username, req.userId);
      if (error) return res.status(400).json({ error });
      if (await isBlockedEither(req.userId, Number(target.id))) {
        return res.status(403).json({ error: 'You cannot hang out with this player.' });
      }
      const key = [Math.min(req.userId, Number(target.id)), Math.max(req.userId, Number(target.id))].join(':');
      const last = hangoutHits.get(key) || 0;
      if (Date.now() - last < HANGOUT_COOLDOWN_MS) {
        return res.status(429).json({ error: 'You just hung out — give it a little while.' });
      }
      hangoutHits.set(key, Date.now());
      await bumpBond(req.userId, target.id, 'hangouts');
      const row = await getBond(req.userId, target.id);
      res.json({ ok: true, score: bondScore(row) });
    } catch (e) { console.error('[social] hangout:', e.message); res.status(500).json({ error: 'Could not record the hangout.' }); }
  });

  // Send a gift: spends gameplay coins, grows closeness. Game-money only.
  router.post('/gifts', async (req, res) => {
    try {
      const { target, error } = await resolveTarget(req.body?.username, req.userId);
      if (error) return res.status(400).json({ error });
      const gift = GIFTS.find((g) => g.id === String(req.body?.gift || ''));
      if (!gift) return res.status(400).json({ error: 'Pick a gift from the shelf.' });
      if (await isBlockedEither(req.userId, Number(target.id))) {
        return res.status(403).json({ error: 'You cannot gift this player.' });
      }
      const c = await ensureCharacter(req.userId, (await getUserById(req.userId))?.username || '');
      const bal = Math.floor(Number(c.money) || 0);
      if (bal < gift.cost) {
        return res.status(402).json({ error: `You need ${gift.cost.toLocaleString('en-NG')} coins for this gift.` });
      }
      c.money = bal - gift.cost;
      await saveCharacter(c);
      await addTransaction(req.userId, 'gift_sent', -gift.cost, c.money, { to: target.username, gift: gift.id });
      await bumpBond(req.userId, target.id, 'gifts');
      const row = await getBond(req.userId, target.id);
      pushTo(hub, target.id, {
        t: 'gift', gift_id: gift.id, gift_name: gift.name, gift_emoji: gift.emoji,
        from_id: req.userId, from: (await getUserById(req.userId))?.username || 'player',
      });
      res.json({ ok: true, gift: gift.id, balance: c.money, score: bondScore(row) });
    } catch (e) { console.error('[social] gift:', e.message); res.status(500).json({ error: 'Could not send the gift.' }); }
  });

  router.get('/gifts/shelf', async (req, res) => {
    res.json({ gifts: GIFTS });
  });

  // ---- family & dating unlocks ----

  async function relationRequest(req, res, which) {
    const { target, error } = await resolveTarget(req.body?.username, req.userId);
    if (error) return res.status(400).json({ error });
    const need = which === 'family' ? BOND_FAMILY_AT : BOND_DATING_AT;
    const label = which === 'family' ? 'add as family' : 'start dating';
    const row = await getBond(req.userId, target.id);
    const score = bondScore(row);
    if (score < need) {
      return res.status(403).json({
        error: `Grow closer first — ${label} unlocks at closeness ${need} (you're at ${score}).`,
        score, need,
      });
    }
    const cur = which === 'family' ? row.family : row.dating;
    if (cur === 'family' || cur === 'dating') {
      return res.status(409).json({ error: 'Already set.' });
    }
    if (cur === 'pending') {
      return res.status(409).json({ error: 'A request is already waiting.' });
    }
    await setBondStatus(req.userId, target.id, which, 'pending', req.userId);
    pushTo(hub, target.id, {
      t: which === 'family' ? 'family_request' : 'dating_request',
      from_id: req.userId, from: (await getUserById(req.userId))?.username || 'player',
    });
    res.json({ ok: true, pending: true });
  }

  async function relationRespond(req, res, which) {
    const { target, error } = await resolveTarget(req.body?.username, req.userId);
    if (error) return res.status(400).json({ error });
    const row = await getBond(req.userId, target.id);
    const cur = which === 'family' ? row.family : row.dating;
    const by = which === 'family' ? Number(row.family_by) : Number(row.dating_by);
    if (cur !== 'pending' || by !== Number(target.id)) {
      return res.status(404).json({ error: 'No request waiting from this player.' });
    }
    const accept = req.body?.accept !== false;
    await setBondStatus(req.userId, target.id, which, accept ? which : 'none', 0);
    res.json({ ok: true, accepted: accept });
  }

  router.post('/family/request', (req, res) => relationRequest(req, res, 'family'));
  router.post('/family/respond', (req, res) => relationRespond(req, res, 'family'));
  router.post('/dating/request', (req, res) => relationRequest(req, res, 'dating'));
  router.post('/dating/respond', (req, res) => relationRespond(req, res, 'dating'));

  // ================= settings =================

  router.get('/settings', async (req, res) => {
    try {
      res.json({ settings: await getSocialSettings(req.userId) });
    } catch (e) { console.error('[social] settings get:', e.message); res.status(500).json({ error: 'Could not load settings.' }); }
  });

  router.put('/settings', async (req, res) => {
    try {
      const body = req.body || {};
      const patch = {};
      if (body.read_receipts !== undefined) patch.read_receipts = !!body.read_receipts;
      if (body.message_policy !== undefined) {
        if (!['everyone', 'friends'].includes(body.message_policy)) {
          return res.status(400).json({ error: 'message_policy must be "everyone" or "friends".' });
        }
        patch.message_policy = body.message_policy;
      }
      if (body.relationships_visible !== undefined) patch.relationships_visible = !!body.relationships_visible;
      res.json({ settings: await setSocialSettings(req.userId, patch) });
    } catch (e) { console.error('[social] settings put:', e.message); res.status(500).json({ error: 'Could not save settings.' }); }
  });

  return router;
}
