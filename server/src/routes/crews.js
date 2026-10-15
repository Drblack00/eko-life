// ============================================================
// routes/crews.js — Crews REST API (player clans).
//
// Discover / create / join / leave / contribute to shared crew goals.
// Viewer-aware, server-validated. Gameplay coins only — contributions
// charge character money via the shared money helpers (admin god-mode
// applies: admins can afford anything and are never charged).
// ============================================================
import { randomUUID } from 'crypto';
import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import {
  getUserById,
  ensureCharacter, saveCharacter, addTransaction,
  dbRun, dbGet, dbAll,
} from '../db.js';
import { canAfford, charge } from '../game/money.js';

const JOIN_XP = 25;
const MIN_CONTRIBUTE = 100;
const MAX_CONTRIBUTE = 100_000_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const DEFAULT_GOAL_TITLE = 'Open a crew plaza';
const DEFAULT_GOAL_TARGET = 5_000_000;
const DEFAULT_GOAL_DAYS = 7;

const naira = (n) => '₦' + Math.floor(Number(n) || 0).toLocaleString('en-NG');

export function createCrewsRouter() {
  const router = Router();
  router.use(authMiddleware);

  async function authedUser(req, res) {
    const user = await getUserById(req.userId);
    if (!user) { res.status(401).json({ error: 'Account not found.' }); return null; }
    if (Number(user.banned)) { res.status(403).json({ error: 'This account is banned.' }); return null; }
    return user;
  }

  /** Viewer-aware membership: { crewId, role } or nulls. */
  async function myMembership(userId) {
    const row = await dbGet(
      `SELECT crew_id, role FROM crew_members WHERE user_id = ?`,
      `SELECT crew_id, role FROM crew_members WHERE user_id = $1`,
      [Number(userId)]
    );
    return row
      ? { crewId: String(row.crew_id), role: row.role }
      : { crewId: null, role: null };
  }

  /** Award xp to a member row and the weekly log. */
  async function awardXp(crewId, userId, xp) {
    const amt = Math.floor(Number(xp) || 0);
    if (amt <= 0) return;
    await dbRun(
      `UPDATE crew_members SET xp = xp + ? WHERE crew_id = ? AND user_id = ?`,
      `UPDATE crew_members SET xp = xp + $1 WHERE crew_id = $2 AND user_id = $3`,
      [amt, crewId, Number(userId)]
    );
    await dbRun(
      `INSERT INTO crew_xp_log (crew_id, user_id, xp, earned_at) VALUES (?, ?, ?, ?)`,
      `INSERT INTO crew_xp_log (crew_id, user_id, xp, earned_at) VALUES ($1, $2, $3, $4)`,
      [crewId, Number(userId), amt, Date.now()]
    );
  }

  function crewRow(c) {
    return {
      id: String(c.id),
      name: c.name,
      tagline: c.tagline || '',
      icon: c.icon || '🛡️',
      foundedAt: Number(c.founded_at) || 0,
      memberCount: Number(c.member_count) || 0,
      weeklyXp: Number(c.weekly_xp) || 0,
      totalXp: Number(c.total_xp) || 0,
      rank: Number(c.rank) || 0,
    };
  }

  /** All crews with member counts + xp aggregates, ranked by total xp. */
  async function rankedCrews() {
    const weekAgo = Date.now() - WEEK_MS;
    const rows = await dbAll(
      `SELECT cr.*,
         (SELECT COUNT(*) FROM crew_members cm WHERE cm.crew_id = cr.id) AS member_count,
         COALESCE((SELECT SUM(cm2.xp) FROM crew_members cm2 WHERE cm2.crew_id = cr.id), 0) AS total_xp,
         COALESCE((SELECT SUM(l.xp) FROM crew_xp_log l WHERE l.crew_id = cr.id AND l.earned_at >= ?), 0) AS weekly_xp
       FROM crews cr`,
      `SELECT cr.*,
         (SELECT COUNT(*) FROM crew_members cm WHERE cm.crew_id = cr.id) AS member_count,
         COALESCE((SELECT SUM(cm2.xp) FROM crew_members cm2 WHERE cm2.crew_id = cr.id), 0) AS total_xp,
         COALESCE((SELECT SUM(l.xp) FROM crew_xp_log l WHERE l.crew_id = cr.id AND l.earned_at >= $1), 0) AS weekly_xp
       FROM crews cr`,
      [weekAgo]
    );
    const sorted = [...rows].sort(
      (a, b) => (Number(b.total_xp) || 0) - (Number(a.total_xp) || 0)
    );
    sorted.forEach((r, i) => { r.rank = i + 1; });
    return sorted;
  }

  // ---- GET /api/crews — discover (sorted list, empty until created) ----
  router.get('/', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const sort = String(req.query.sort || 'active');
    if (!['active', 'members', 'xp'].includes(sort)) {
      return res.status(400).json({ error: 'Sort must be active, members or xp.' });
    }
    const rows = await rankedCrews();
    const mine = await myMembership(req.userId);
    const myRoles = {};
    if (mine.crewId) myRoles[mine.crewId] = mine.role;
    const crews = [...rows].sort((a, b) => {
      if (sort === 'members') return (Number(b.member_count) || 0) - (Number(a.member_count) || 0);
      if (sort === 'xp') return (Number(b.total_xp) || 0) - (Number(a.total_xp) || 0);
      return (Number(b.weekly_xp) || 0) - (Number(a.weekly_xp) || 0);
    }).map((r) => ({ ...crewRow(r), myRole: myRoles[r.id] || null }));
    res.json({ crews, myCrewId: mine.crewId, sort });
  });

  // ---- POST /api/crews — create a crew (founder joins automatically) ----
  router.post('/', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const name = String((req.body && req.body.name) || '').trim();
    if (name.length < 3 || name.length > 24) {
      return res.status(400).json({ error: 'Crew name must be 3–24 characters.' });
    }
    const tagline = String((req.body && req.body.tagline) || '').trim().slice(0, 80);
    const icon = String((req.body && req.body.icon) || '').trim().slice(0, 8) || '🛡️';
    const mine = await myMembership(req.userId);
    if (mine.crewId) {
      return res.status(400).json({ error: "You're already in a crew — leave it first." });
    }
    const id = randomUUID();
    const now = Date.now();
    try {
      await dbRun(
        `INSERT INTO crews (id, name, tagline, icon, founded_at, goal_title, goal_target, goal_raised, goal_ends_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        `INSERT INTO crews (id, name, tagline, icon, founded_at, goal_title, goal_target, goal_raised, goal_ends_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8)`,
        [id, name, tagline, icon, now, DEFAULT_GOAL_TITLE, DEFAULT_GOAL_TARGET, now + DEFAULT_GOAL_DAYS * 24 * 60 * 60 * 1000]
      );
    } catch (e) {
      return res.status(400).json({ error: 'A crew with that name already exists.' });
    }
    await dbRun(
      `INSERT INTO crew_members (crew_id, user_id, role, xp, joined_at) VALUES (?, ?, 'founder', 0, ?)`,
      `INSERT INTO crew_members (crew_id, user_id, role, xp, joined_at) VALUES ($1, $2, 'founder', 0, $3)`,
      [id, Number(req.userId), now]
    );
    await awardXp(id, req.userId, JOIN_XP);
    const row = await dbGet(
      `SELECT * FROM crews WHERE id = ?`,
      `SELECT * FROM crews WHERE id = $1`,
      [id]
    );
    res.json({ ok: true, crew: { ...crewRow({ ...row, member_count: 1, weekly_xp: JOIN_XP, total_xp: JOIN_XP, rank: 1 }), myRole: 'founder' } });
  });

  // ---- GET /api/crews/:id — detail: info, members, goal, league board ----
  router.get('/:id', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const id = String(req.params.id);
    const row = await dbGet(
      `SELECT * FROM crews WHERE id = ?`,
      `SELECT * FROM crews WHERE id = $1`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'Crew not found.' });

    const members = await dbAll(
      `SELECT cm.user_id, cm.role, cm.xp, cm.joined_at, u.username
       FROM crew_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.crew_id = ? ORDER BY cm.xp DESC, cm.joined_at ASC`,
      `SELECT cm.user_id, cm.role, cm.xp, cm.joined_at, u.username
       FROM crew_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.crew_id = $1 ORDER BY cm.xp DESC, cm.joined_at ASC`,
      [id]
    );
    const rows = await rankedCrews();
    const mine = await myMembership(req.userId);
    const me = rows.find((r) => String(r.id) === id);
    const target = Number(row.goal_target) || 0;
    const raised = Number(row.goal_raised) || 0;
    const endsAt = Number(row.goal_ends_at) || 0;
    res.json({
      crew: { ...crewRow({ ...row, member_count: members.length, weekly_xp: Number(me?.weekly_xp) || 0, total_xp: Number(me?.total_xp) || 0, rank: Number(me?.rank) || 0 }), myRole: mine.crewId === id ? mine.role : null },
      goal: row.goal_title
        ? {
            title: row.goal_title,
            target,
            raised,
            pct: target > 0 ? Math.min(100, Math.floor((raised / target) * 100)) : 0,
            endsAt,
            daysLeft: endsAt > 0 ? Math.max(0, Math.ceil((endsAt - Date.now()) / 86400000)) : 0,
          }
        : null,
      members: members.map((m) => ({
        userId: Number(m.user_id),
        username: m.username,
        role: m.role,
        xp: Number(m.xp) || 0,
        joinedAt: Number(m.joined_at) || 0,
      })),
      board: rows.map((r) => ({
        id: String(r.id),
        name: r.name,
        icon: r.icon || '🛡️',
        memberCount: Number(r.member_count) || 0,
        weeklyXp: Number(r.weekly_xp) || 0,
        rank: Number(r.rank) || 0,
        movement: 0, // no rank history yet — client hides the arrow at 0
        isMine: String(r.id) === id,
      })),
      my: { crewId: mine.crewId, role: mine.role },
    });
  });

  // ---- POST /api/crews/:id/join ----
  router.post('/:id/join', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const id = String(req.params.id);
    const row = await dbGet(
      `SELECT id, name FROM crews WHERE id = ?`,
      `SELECT id, name FROM crews WHERE id = $1`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'Crew not found.' });
    const mine = await myMembership(req.userId);
    if (mine.crewId === id) {
      return res.status(400).json({ error: "You're already in this crew." });
    }
    if (mine.crewId) {
      return res.status(400).json({ error: "You're already in a crew — leave it first." });
    }
    await dbRun(
      `INSERT INTO crew_members (crew_id, user_id, role, xp, joined_at) VALUES (?, ?, 'member', 0, ?)`,
      `INSERT INTO crew_members (crew_id, user_id, role, xp, joined_at) VALUES ($1, $2, 'member', 0, $3)`,
      [id, Number(req.userId), Date.now()]
    );
    await awardXp(id, req.userId, JOIN_XP);
    res.json({ ok: true, crewId: id, notice: `🛡️ Welcome to ${row.name}! +${JOIN_XP} xp for repping the crew.` });
  });

  // ---- POST /api/crews/:id/leave ----
  router.post('/:id/leave', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const id = String(req.params.id);
    const mine = await dbGet(
      `SELECT crew_id, role FROM crew_members WHERE crew_id = ? AND user_id = ?`,
      `SELECT crew_id, role FROM crew_members WHERE crew_id = $1 AND user_id = $2`,
      [id, Number(req.userId)]
    );
    if (!mine) return res.status(400).json({ error: "You're not in this crew." });
    await dbRun(
      `DELETE FROM crew_members WHERE crew_id = ? AND user_id = ?`,
      `DELETE FROM crew_members WHERE crew_id = $1 AND user_id = $2`,
      [id, Number(req.userId)]
    );
    const remaining = await dbAll(
      `SELECT user_id, joined_at FROM crew_members WHERE crew_id = ? ORDER BY joined_at ASC`,
      `SELECT user_id, joined_at FROM crew_members WHERE crew_id = $1 ORDER BY joined_at ASC`,
      [id]
    );
    if (remaining.length === 0) {
      // Last one out — the crew disbands.
      await dbRun(`DELETE FROM crew_xp_log WHERE crew_id = ?`, `DELETE FROM crew_xp_log WHERE crew_id = $1`, [id]);
      await dbRun(`DELETE FROM crews WHERE id = ?`, `DELETE FROM crews WHERE id = $1`, [id]);
      return res.json({ ok: true, disbanded: true, notice: 'The crew has disbanded — you were the last one out.' });
    }
    if (mine.role === 'founder') {
      // Hand the crown to the longest-serving member.
      await dbRun(
        `UPDATE crew_members SET role = 'founder' WHERE crew_id = ? AND user_id = ?`,
        `UPDATE crew_members SET role = 'founder' WHERE crew_id = $1 AND user_id = $2`,
        [id, Number(remaining[0].user_id)]
      );
    }
    res.json({ ok: true, notice: 'You left the crew. Hustle on. 👋' });
  });

  // ---- POST /api/crews/:id/contribute — gameplay coins into the shared goal ----
  router.post('/:id/contribute', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const id = String(req.params.id);
    const row = await dbGet(
      `SELECT * FROM crews WHERE id = ?`,
      `SELECT * FROM crews WHERE id = $1`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'Crew not found.' });
    const mine = await dbGet(
      `SELECT role FROM crew_members WHERE crew_id = ? AND user_id = ?`,
      `SELECT role FROM crew_members WHERE crew_id = $1 AND user_id = $2`,
      [id, Number(req.userId)]
    );
    if (!mine) {
      return res.status(403).json({ error: 'Join this crew to chip in for its goal.' });
    }
    const amt = Math.floor(Number(req.body && req.body.amount));
    if (!Number.isFinite(amt) || amt < MIN_CONTRIBUTE) {
      return res.status(400).json({ error: `Contribute at least ${naira(MIN_CONTRIBUTE)}.` });
    }
    if (amt > MAX_CONTRIBUTE) {
      return res.status(400).json({ error: `One contribution can't pass ${naira(MAX_CONTRIBUTE)}.` });
    }
    const target = Number(row.goal_target) || 0;
    const raised = Number(row.goal_raised) || 0;
    if (!row.goal_title) {
      return res.status(400).json({ error: 'This crew has no active goal yet.' });
    }
    if (target > 0 && raised >= target) {
      return res.status(400).json({ error: 'This crew\u2019s shared goal is already complete.' });
    }
    const endsAt = Number(row.goal_ends_at) || 0;
    if (endsAt > 0 && Date.now() > endsAt) {
      return res.status(400).json({ error: 'This crew\u2019s shared goal has expired.' });
    }
    const c = await ensureCharacter(req.userId);
    const isAdmin = !!Number(user.is_admin);
    if (!canAfford(c, amt, isAdmin)) {
      return res.status(400).json({ error: `You need ${naira(amt)} in your wallet. Hustle first!` });
    }
    const deducted = charge(c, amt, isAdmin); // 0 for admins — stealth bypass
    await saveCharacter(c);
    const newRaised = raised + amt;
    await dbRun(
      `UPDATE crews SET goal_raised = ? WHERE id = ?`,
      `UPDATE crews SET goal_raised = $1 WHERE id = $2`,
      [newRaised, id]
    );
    const xpEarned = Math.floor(amt / 1000);
    await awardXp(id, req.userId, xpEarned);
    await addTransaction(Number(req.userId), 'crew', -deducted, Math.floor(Number(c.money)), {
      kind: 'goal_contribution', crew: id, amount: amt,
    });
    const pct = target > 0 ? Math.min(100, Math.floor((newRaised / target) * 100)) : 0;
    res.json({
      ok: true,
      raised: newRaised,
      target,
      pct,
      balance: Math.floor(Number(c.money)),
      xpEarned,
      notice: `🛡️ ${naira(amt)} added to the crew goal!${xpEarned > 0 ? ` +${xpEarned} xp.` : ''}`,
    });
  });

  return router;
}
