// ============================================================
// routes/admin.js — Èkó Life Admin API (M4)
// All routes sit behind requireAdmin: valid Bearer token, is_admin=1,
// and not banned. Adapted from the proven pattern in the user's own
// benin-life-multiplayer server (reference only — original code).
// ============================================================
import { Router } from 'express';
import { verifyToken } from '../auth.js';
import {
  getUserById, getUserByName, setBanned, setAdmin, listRoster,
  listReports, listCandidates, currentElection, getMeta,
} from '../db.js';
import { cleanText } from '../game/data.js';
import { fullElectionState } from '../game/elections.js';
// M13: billboard admin CRUD (handlers read req.admin from requireAdmin).
import {
  handleAdminCreateBillboard, handleAdminUpdateBillboard, handleAdminDeleteBillboard,
} from '../game/v2/m13.js';

export function createAdminRouter({ hub, getDay }) {
  const router = Router();

  async function requireAdmin(req, res, next) {
    const h = req.headers.authorization || '';
    const m = h.match(/^Bearer (.+)$/);
    const id = m ? verifyToken(m[1]) : null;
    const user = id ? await getUserById(id) : null;
    // Banned accounts lose admin access even if the flag is somehow still set.
    if (!user || !Number(user.is_admin) || Number(user.banned)) {
      return res.status(403).json({ error: 'Admin only.' });
    }
    req.admin = user;
    next();
  }

  router.use(requireAdmin);

  // ---- roster: every player + live online flag ----
  router.get('/players', async (req, res) => {
    const rows = await listRoster();
    res.json({
      players: rows.map(r => ({
        id: r.id,
        username: r.username,
        money: Number(r.money || 0),
        stats: {
          energy: Number(r.energy || 0),
          health: Number(r.health || 0),
          happiness: Number(r.happiness || 0),
          hunger: Number(r.hunger || 0),
        },
        housing: r.housing || null,
        online: hub.online.has(Number(r.id)),
        is_admin: !!Number(r.is_admin),
        banned: !!Number(r.banned),
        last_seen: r.last_seen == null ? null : Number(r.last_seen),
      })),
    });
  });

  // ---- broadcast to every online player (profanity-filtered) ----
  router.post('/broadcast', async (req, res) => {
    const text = cleanText(req.body && req.body.text, 200);
    if (!text) return res.status(400).json({ error: 'Empty message.' });
    hub.broadcast({ t: 'sys', text: `📢 ${text}` });
    console.log(`[admin] ${req.admin.username} broadcast: ${text.slice(0, 80)}`);
    res.json({ ok: true });
  });

  // ---- ban / unban ----
  // Admins can never be banned. Banning an online player closes their WS
  // with code 4403, and the hub rejects their future connects the same way.
  router.post('/ban', async (req, res) => {
    const target = await getUserByName(String((req.body && req.body.username) || '').trim());
    if (!target) return res.status(404).json({ error: 'Player not found.' });
    if (Number(target.is_admin)) {
      return res.status(400).json({ error: 'Cannot ban an admin.' });
    }
    const banned = !!(req.body && req.body.banned);
    await setBanned(target.id, banned);
    if (banned) {
      // Synchronous registry drop — the roster shows them offline immediately.
      hub.forceDisconnect(Number(target.id), 4403, 'banned');
    }
    console.log(`[admin] ${req.admin.username} ${banned ? 'banned' : 'unbanned'} ${target.username}`);
    res.json({ ok: true, banned });
  });

  // ---- promote a player to admin ----
  router.post('/make-admin', async (req, res) => {
    const target = await getUserByName(String((req.body && req.body.username) || '').trim());
    if (!target) return res.status(404).json({ error: 'Player not found.' });
    await setAdmin(target.id, true);
    console.log(`[admin] ${req.admin.username} made ${target.username} an admin`);
    res.json({ ok: true });
  });

  // ---- election status (M5; M11: policy + commissioners via fullElectionState) ----
  router.get('/election', async (req, res) => {
    const el = await currentElection();
    const governorId = Number((await getMeta('governor_id')) || 0);
    const candidates = el ? await listCandidates(el.id) : [];
    const governor = governorId ? await getUserById(governorId) : null;
    res.json({
      election: await fullElectionState(el, candidates, { governorId, day: getDay().day }),
      governorId,
      governor: governor ? { id: governor.id, username: governor.username } : null,
    });
  });

  // ---- force the current cycle to tally now (M5) ----
  router.post('/end-election', async (req, res) => {
    const winnerId = await hub.forceTally();
    const governor = winnerId ? await getUserById(winnerId) : null;
    res.json({
      ok: true,
      governorId: winnerId,
      governor: governor ? { id: governor.id, username: governor.username } : null,
    });
  });

  // ---- billboards (M13): admin CRUD — text, colors, position ----
  router.post('/billboards', handleAdminCreateBillboard);
  router.patch('/billboards/:id', handleAdminUpdateBillboard);
  router.delete('/billboards/:id', handleAdminDeleteBillboard);

  // ---- player reports queue (M5) ----
  router.get('/reports', async (req, res) => {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    res.json({ reports: await listReports(limit) });
  });

  return router;
}
