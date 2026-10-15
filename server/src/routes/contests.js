// ============================================================
// routes/contests.js — UGC Design Contests REST API (Duel style).
//
// Player-created design contests: ranked live leaderboard, head-to-head
// duel voting with streaks, snap-first 2-tap entry submit.
// Anti-gaming: one vote per entry per user, per-day vote budget per
// contest, no self-votes. Gameplay coins only — prizes are game cash
// and boutique slots, never real money.
// ============================================================
import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import {
  getUserById,
  dbGet, dbAll, dbRunReturning,
} from '../db.js';

/** Rewrite `?` placeholders to `$1..$n` for the Postgres variant. */
function pg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

const CATEGORIES = new Set(['outfit', 'apartment']);
const TITLE_MAX = 60;
const BLURB_MAX = 140;
const EMOJI_RE = /^.{1,12}$/u;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_DESIGN = { emoji: '🎨', colors: ['#0ea5e9', '#22c55e'], blurb: '' };

function parseDesign(raw) {
  let d = DEFAULT_DESIGN;
  try {
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (p && typeof p === 'object') d = p;
  } catch { /* fall through to default */ }
  const emoji = typeof d.emoji === 'string' && EMOJI_RE.test(d.emoji.trim())
    ? d.emoji.trim() : DEFAULT_DESIGN.emoji;
  const colors = Array.isArray(d.colors) && d.colors.length >= 2
    && COLOR_RE.test(String(d.colors[0])) && COLOR_RE.test(String(d.colors[1]))
    ? [String(d.colors[0]), String(d.colors[1])] : [...DEFAULT_DESIGN.colors];
  const blurb = typeof d.blurb === 'string' ? d.blurb.trim().slice(0, BLURB_MAX) : '';
  return { emoji, colors, blurb };
}

function utcDay(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

async function getContest(id) {
  return dbGet(
    `SELECT id, title, category, starts_at AS startsAt, ends_at AS endsAt,
            prize_text AS prizeText, vote_budget_per_day AS voteBudgetPerDay, status
     FROM contests WHERE id = ?`,
    pg(`SELECT id, title, category, starts_at AS "startsAt", ends_at AS "endsAt",
               prize_text AS "prizeText", vote_budget_per_day AS "voteBudgetPerDay", status
        FROM contests WHERE id = ?`),
    [Number(id)],
  );
}

async function entryVotes(entryId) {
  const r = await dbGet(
    `SELECT COUNT(*) AS n FROM contest_votes WHERE entry_id = ?`,
    pg(`SELECT COUNT(*) AS n FROM contest_votes WHERE entry_id = ?`),
    [entryId],
  );
  return Number(r.n) || 0;
}

async function contestStats(contestId) {
  const r = await dbGet(
    `SELECT (SELECT COUNT(*) FROM contest_entries WHERE contest_id = ?) AS entries,
            (SELECT COUNT(*) FROM contest_votes WHERE contest_id = ?) AS votes`,
    pg(`SELECT (SELECT COUNT(*) FROM contest_entries WHERE contest_id = ?) AS entries,
               (SELECT COUNT(*) FROM contest_votes WHERE contest_id = ?) AS votes`),
    [contestId, contestId],
  );
  return { entryCount: Number(r.entries) || 0, totalVotes: Number(r.votes) || 0 };
}

/** Votes the viewer has left today for this contest. */
async function votesLeftToday(contestId, voterId) {
  const c = await getContest(contestId);
  const budget = Number(c.voteBudgetPerDay) || 0;
  const r = await dbGet(
    `SELECT COUNT(*) AS n FROM contest_votes
     WHERE contest_id = ? AND voter_id = ? AND date(voted_at) = date('now')`,
    pg(`SELECT COUNT(*) AS n FROM contest_votes
        WHERE contest_id = ? AND voter_id = ? AND voted_at::date = CURRENT_DATE`),
    [contestId, voterId],
  );
  return Math.max(0, budget - (Number(r.n) || 0));
}

/** Streak = consecutive days (ending today or yesterday) with >= 1 vote. */
async function voteStreak(voterId) {
  const rows = await dbAll(
    `SELECT DISTINCT date(voted_at) AS d FROM contest_votes
     WHERE voter_id = ? ORDER BY d DESC`,
    pg(`SELECT DISTINCT (voted_at::date)::text AS d FROM contest_votes
        WHERE voter_id = ? ORDER BY d DESC`),
    [voterId],
  );
  const dates = rows.map((r) => String(r.d));
  if (!dates.length) return 0;
  if (dates[0] !== utcDay(0) && dates[0] !== utcDay(-1)) return 0;
  let streak = 0;
  let cursor = dates[0];
  for (const d of dates) {
    if (d !== cursor) break;
    streak += 1;
    // Step one day back from the date just counted.
    const prev = new Date(`${d}T00:00:00Z`).getTime() - 86400000;
    cursor = new Date(prev).toISOString().slice(0, 10);
  }
  return streak;
}

/** Ranked leaderboard rows for a contest. */
async function leaderboard(contestId, viewerId) {
  const rows = await dbAll(
    `SELECT e.id, e.title, e.design_json AS designJson, e.user_id AS userId, u.username,
            (SELECT COUNT(*) FROM contest_votes v WHERE v.entry_id = e.id) AS votes
     FROM contest_entries e JOIN users u ON u.id = e.user_id
     WHERE e.contest_id = ? ORDER BY votes DESC, e.id ASC`,
    pg(`SELECT e.id, e.title, e.design_json AS "designJson", e.user_id AS "userId", u.username,
               (SELECT COUNT(*) FROM contest_votes v WHERE v.entry_id = e.id) AS votes
        FROM contest_entries e JOIN users u ON u.id = e.user_id
        WHERE e.contest_id = ? ORDER BY votes DESC, e.id ASC`),
    [contestId],
  );
  const max = rows.reduce((m, r) => Math.max(m, Number(r.votes) || 0), 0);
  return rows.map((r) => ({
    id: Number(r.id),
    title: r.title,
    design: parseDesign(r.designJson),
    username: r.username,
    votes: Number(r.votes) || 0,
    share: max > 0 ? (Number(r.votes) || 0) / max : 0,
    isMine: Number(r.userId) === Number(viewerId),
  }));
}

async function insertReturningId(sqliteSql, params) {
  const r = await dbRunReturning(sqliteSql, `${pg(sqliteSql)} RETURNING id`, params);
  if (r.rows && r.rows.length) return Number(r.rows[0].id);
  const row = await dbGet(`SELECT last_insert_rowid() AS id`, `SELECT 1 AS id`, []);
  return Number(row.id);
}

function contestJson(c, stats) {
  const daysLeft = Math.max(0, Math.ceil((Date.parse(c.endsAt) - Date.now()) / 86400000));
  return {
    id: Number(c.id),
    title: c.title,
    category: c.category,
    status: c.status,
    endsAt: c.endsAt,
    daysLeft,
    prizeText: c.prizeText,
    voteBudgetPerDay: Number(c.voteBudgetPerDay) || 0,
    entryCount: stats.entryCount,
    totalVotes: stats.totalVotes,
  };
}

export function createContestsRouter() {
  const router = Router();
  router.use(authMiddleware);

  async function authedUser(req, res) {
    const user = await getUserById(req.userId);
    if (!user) { res.status(401).json({ error: 'Account not found.' }); return null; }
    if (Number(user.banned)) { res.status(403).json({ error: 'This account is banned.' }); return null; }
    return user;
  }

  // ---- list: active contests first, then past ----
  router.get('/', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const rows = await dbAll(
      `SELECT id, title, category, starts_at AS startsAt, ends_at AS endsAt,
              prize_text AS prizeText, vote_budget_per_day AS voteBudgetPerDay, status
       FROM contests
       ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, ends_at DESC`,
      pg(`SELECT id, title, category, starts_at AS "startsAt", ends_at AS "endsAt",
                 prize_text AS "prizeText", vote_budget_per_day AS "voteBudgetPerDay", status
          FROM contests
          ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, ends_at DESC`),
      [],
    );
    const out = [];
    for (const c of rows) {
      out.push(contestJson(c, await contestStats(c.id)));
    }
    res.json(out);
  });

  // ---- detail: ranked leaderboard + viewer's votes-left + streak ----
  router.get('/:id', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const c = await getContest(req.params.id);
    if (!c) return res.status(404).json({ error: 'Contest not found.' });
    res.json({
      contest: contestJson(c, await contestStats(c.id)),
      entries: await leaderboard(c.id, user.id),
      votesLeft: await votesLeftToday(c.id, user.id),
      streak: await voteStreak(user.id),
    });
  });

  // ---- duel: random pair the viewer hasn't voted on (never their own) ----
  router.get('/:id/duel', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const c = await getContest(req.params.id);
    if (!c) return res.status(404).json({ error: 'Contest not found.' });
    if (c.status !== 'active') return res.status(400).json({ error: 'This contest has ended.' });
    const rows = await dbAll(
      `SELECT e.id, e.title, e.design_json AS designJson, e.user_id AS userId, u.username
       FROM contest_entries e JOIN users u ON u.id = e.user_id
       WHERE e.contest_id = ? AND e.user_id != ?
         AND NOT EXISTS (SELECT 1 FROM contest_votes v WHERE v.entry_id = e.id AND v.voter_id = ?)
       ORDER BY RANDOM() LIMIT 2`,
      pg(`SELECT e.id, e.title, e.design_json AS "designJson", e.user_id AS "userId", u.username
          FROM contest_entries e JOIN users u ON u.id = e.user_id
          WHERE e.contest_id = ? AND e.user_id != ?
            AND NOT EXISTS (SELECT 1 FROM contest_votes v WHERE v.entry_id = e.id AND v.voter_id = ?)
          ORDER BY RANDOM() LIMIT 2`),
      [c.id, user.id, user.id],
    );
    const votesLeft = await votesLeftToday(c.id, user.id);
    const streak = await voteStreak(user.id);
    if (votesLeft <= 0) {
      return res.json({
        pair: null,
        reason: "You're out of votes for today — come back tomorrow! ⏳",
        duelNo: 1, votesLeft, streak,
      });
    }
    if (rows.length < 2) {
      const stats = await contestStats(c.id);
      const reason = stats.entryCount < 2
        ? 'Need at least 2 entries to duel — enter your design!'
        : 'You have voted on every entry. Come back when new designs drop!';
      return res.json({ pair: null, reason, duelNo: 1, votesLeft, streak });
    }
    const mine = await dbGet(
      `SELECT COUNT(*) AS n FROM contest_votes WHERE contest_id = ? AND voter_id = ?`,
      pg(`SELECT COUNT(*) AS n FROM contest_votes WHERE contest_id = ? AND voter_id = ?`),
      [c.id, user.id],
    );
    const pair = rows.map((r) => ({
      id: Number(r.id),
      title: r.title,
      design: parseDesign(r.designJson),
      username: r.username,
    }));
    res.json({ pair, reason: null, duelNo: (Number(mine.n) || 0) + 1, votesLeft, streak });
  });

  // ---- vote: tap-the-winner ----
  router.post('/:id/vote', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const c = await getContest(req.params.id);
    if (!c) return res.status(404).json({ error: 'Contest not found.' });
    if (c.status !== 'active') return res.status(400).json({ error: 'This contest has ended.' });
    const entryId = Number(req.body && req.body.entry_id);
    if (!Number.isFinite(entryId)) return res.status(400).json({ error: 'Pick an entry.' });
    const entry = await dbGet(
      `SELECT id, user_id AS userId FROM contest_entries WHERE id = ? AND contest_id = ?`,
      pg(`SELECT id, user_id AS "userId" FROM contest_entries WHERE id = ? AND contest_id = ?`),
      [entryId, c.id],
    );
    if (!entry) return res.status(400).json({ error: 'That entry is not in this contest.' });
    if (Number(entry.userId) === Number(user.id)) {
      return res.status(400).json({ error: "You can't vote for your own design." });
    }
    const already = await dbGet(
      `SELECT id FROM contest_votes WHERE voter_id = ? AND entry_id = ?`,
      pg(`SELECT id FROM contest_votes WHERE voter_id = ? AND entry_id = ?`),
      [user.id, entry.id],
    );
    if (already) return res.status(400).json({ error: 'You already voted for this entry.' });
    const left = await votesLeftToday(c.id, user.id);
    if (left <= 0) {
      return res.status(400).json({ error: "You're out of votes for today — come back tomorrow!" });
    }
    try {
      await insertReturningId(
        `INSERT INTO contest_votes (contest_id, voter_id, entry_id, voted_at) VALUES (?,?,?,?)`,
        [c.id, user.id, entry.id, new Date().toISOString()],
      );
    } catch (e) {
      // Lost a race on the UNIQUE(voter_id, entry_id) guard.
      return res.status(400).json({ error: 'You already voted for this entry.' });
    }
    res.json({
      ok: true,
      entryId: Number(entry.id),
      votes: await entryVotes(entry.id),
      votesLeft: left - 1,
      streak: await voteStreak(user.id),
    });
  });

  // ---- entries: 2-tap submit (title + emoji/colors/blurb design) ----
  router.post('/:id/entries', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const c = await getContest(req.params.id);
    if (!c) return res.status(404).json({ error: 'Contest not found.' });
    if (c.status !== 'active') return res.status(400).json({ error: 'Entries are closed for this contest.' });
    const title = String((req.body && req.body.title) || '').trim().slice(0, TITLE_MAX);
    if (!title) return res.status(400).json({ error: 'Give your design a title.' });
    if (!CATEGORIES.has(String(c.category))) {
      return res.status(400).json({ error: 'Unknown contest category.' });
    }
    const design = parseDesign((req.body && req.body.design) || {});
    const now = new Date().toISOString();
    const id = await insertReturningId(
      `INSERT INTO contest_entries (contest_id, user_id, title, design_json, created_at)
       VALUES (?,?,?,?,?)`,
      [c.id, user.id, title, JSON.stringify(design), now],
    );
    res.json({
      ok: true,
      entry: {
        id, title, design, username: user.username, votes: 0, share: 0, isMine: true,
      },
    });
  });

  return router;
}
