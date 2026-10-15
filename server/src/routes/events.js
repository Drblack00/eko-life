// ============================================================
// routes/events.js — Live Events Calendar REST API.
//
// Server-authoritative event list, detail, and RSVP surface for the
// Events phone app. Gameplay coins only — prizes are in-game cash,
// never real money.
// ============================================================
import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import { dbAll, dbGet, dbRun, getUserById } from '../db.js';

const pad2 = (n) => String(n).padStart(2, '0');
const WEEKDAY_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const WEEKDAY_FULL = [
  'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY',
];

function dayKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Group label for a day: "TODAY · THU" | "SATURDAY" | "NEXT WEEK". */
function dayLabel(key, todayKey) {
  if (key === todayKey) {
    const d = new Date(`${key}T12:00:00`);
    return `TODAY · ${WEEKDAY_SHORT[d.getDay()]}`;
  }
  const day = new Date(`${key}T12:00:00`);
  const today = new Date(`${todayKey}T12:00:00`);
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
  if (diff >= 0 && diff <= 6) return WEEKDAY_FULL[day.getDay()];
  return 'NEXT WEEK';
}

function initials(username) {
  return String(username || '?').slice(0, 2).toUpperCase();
}

function parseDetails(row) {
  try {
    const v = JSON.parse(row.details_json || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function createEventsRouter() {
  const router = Router();
  router.use(authMiddleware);

  async function authedUser(req, res) {
    const user = await getUserById(req.userId);
    if (!user) { res.status(401).json({ error: 'Account not found.' }); return null; }
    if (Number(user.banned)) { res.status(403).json({ error: 'This account is banned.' }); return null; }
    return user;
  }

  /** Going counts per event id: base_attendees + real 'going' RSVPs. */
  async function attendeeCounts() {
    const rows = await dbAll(
      `SELECT event_id, COUNT(*) AS going FROM event_rsvps WHERE status = 'going' GROUP BY event_id`,
      `SELECT event_id, COUNT(*) AS going FROM event_rsvps WHERE status = 'going' GROUP BY event_id`,
      []
    );
    const counts = {};
    for (const r of rows) counts[String(r.event_id)] = Number(r.going) || 0;
    return counts;
  }

  /** Viewer's RSVP status per event id. */
  async function viewerRsvps(userId) {
    const rows = await dbAll(
      `SELECT event_id, status FROM event_rsvps WHERE user_id = ?`,
      `SELECT event_id, status FROM event_rsvps WHERE user_id = $1`,
      [Number(userId)]
    );
    const map = {};
    for (const r of rows) map[String(r.event_id)] = String(r.status);
    return map;
  }

  function toSummary(row, counts, rsvpMap, now) {
    const isLive = Number(row.starts_at) <= now && now <= Number(row.ends_at);
    return {
      id: String(row.id),
      title: row.title,
      emoji: row.emoji,
      venue: row.venue,
      timeLabel: row.time_label,
      startsAt: Number(row.starts_at),
      endsAt: Number(row.ends_at),
      isLive,
      isRecurring: !!Number(row.is_recurring),
      recurringRule: row.recurring_rule,
      prizeText: row.prize_text,
      attendees: (Number(row.base_attendees) || 0) + (counts[String(row.id)] || 0),
      myStatus: rsvpMap[String(row.id)] || null,
    };
  }

  // ---- GET /api/events: upcoming events, grouped by day ----
  router.get('/', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const now = Math.floor(Date.now() / 1000);
    const rows = await dbAll(
      `SELECT * FROM events WHERE ends_at > ? ORDER BY starts_at ASC`,
      `SELECT * FROM events WHERE ends_at > $1 ORDER BY starts_at ASC`,
      [now]
    );
    const counts = await attendeeCounts();
    const rsvpMap = await viewerRsvps(req.userId);

    const seasons = [];
    const seenSeason = new Set();
    for (const row of rows) {
      if (row.season_tag && !seenSeason.has(row.season_tag)) {
        seenSeason.add(row.season_tag);
        seasons.push({
          tag: row.season_tag,
          title: row.title,
          window: row.time_label,
          blurb: row.season_blurb,
          emoji: row.emoji,
        });
      }
    }

    const todayKey = dayKey(new Date());
    const dayMap = new Map();
    for (const row of rows) {
      const summary = toSummary(row, counts, rsvpMap, now);
      const key = dayKey(new Date(Number(row.starts_at) * 1000));
      if (!dayMap.has(key)) dayMap.set(key, { key, label: dayLabel(key, todayKey), events: [] });
      dayMap.get(key).events.push(summary);
    }

    res.json({ now, seasons, days: [...dayMap.values()] });
  });

  // ---- GET /api/events/:id: detail + attendee sample ----
  router.get('/:id', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const id = String(req.params.id);
    const row = await dbGet(
      `SELECT * FROM events WHERE id = ?`,
      `SELECT * FROM events WHERE id = $1`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'Event not found.' });
    const now = Math.floor(Date.now() / 1000);
    const counts = await attendeeCounts();
    const rsvpMap = await viewerRsvps(req.userId);
    const goingCount = counts[id] || 0;
    const sample = await dbAll(
      `SELECT u.username FROM event_rsvps r JOIN users u ON u.id = r.user_id
       WHERE r.event_id = ? AND r.status = 'going' ORDER BY r.created_at ASC LIMIT 8`,
      `SELECT u.username FROM event_rsvps r JOIN users u ON u.id = r.user_id
       WHERE r.event_id = $1 AND r.status = 'going' ORDER BY r.created_at ASC LIMIT 8`,
      [id]
    );
    res.json({
      event: {
        ...toSummary(row, counts, rsvpMap, now),
        details: parseDetails(row),
        seasonTag: row.season_tag,
      },
      goingCount,
      attendees: sample.map((s) => ({ username: s.username, initials: initials(s.username) })),
    });
  });

  // ---- POST /api/events/:id/rsvp: join / remind (upsert) ----
  router.post('/:id/rsvp', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const id = String(req.params.id);
    const status = String((req.body && req.body.status) || '');
    if (status !== 'going' && status !== 'remind') {
      return res.status(400).json({ error: "Pick 'going' or 'remind'." });
    }
    const row = await dbGet(
      `SELECT * FROM events WHERE id = ?`,
      `SELECT * FROM events WHERE id = $1`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'Event not found.' });
    const now = Math.floor(Date.now() / 1000);
    if (Number(row.ends_at) <= now) {
      return res.status(400).json({ error: 'This event is over.' });
    }
    await dbRun(
      `INSERT INTO event_rsvps (event_id, user_id, status, created_at)
       VALUES (?, ?, ?, ?) ON CONFLICT(event_id, user_id)
       DO UPDATE SET status = excluded.status, created_at = excluded.created_at`,
      `INSERT INTO event_rsvps (event_id, user_id, status, created_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT(event_id, user_id)
       DO UPDATE SET status = excluded.status, created_at = excluded.created_at`,
      [id, Number(req.userId), status, now]
    );
    const counts = await attendeeCounts();
    res.json({
      ok: true,
      myStatus: status,
      attendees: (Number(row.base_attendees) || 0) + (counts[id] || 0),
      goingCount: counts[id] || 0,
    });
  });

  // ---- DELETE /api/events/:id/rsvp: cancel RSVP ----
  router.delete('/:id/rsvp', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const id = String(req.params.id);
    const row = await dbGet(
      `SELECT * FROM events WHERE id = ?`,
      `SELECT * FROM events WHERE id = $1`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'Event not found.' });
    await dbRun(
      `DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?`,
      `DELETE FROM event_rsvps WHERE event_id = $1 AND user_id = $2`,
      [id, Number(req.userId)]
    );
    res.json({ ok: true, myStatus: null });
  });

  return router;
}
