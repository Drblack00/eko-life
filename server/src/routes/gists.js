// ============================================================
// routes/gists.js — Èkó Life Gist social feed + News tab REST API.
//
// Gist endpoints (all behind authMiddleware, Bearer <redacted>):
//   GET    /api/gists?tab=&cursor=   latest|trending|following|me (default latest)
//   POST   /api/gists                1–280 chars, 30s/user rate limit
//   POST   /api/gists/:id/like      idempotent
//   DELETE /api/gists/:id/like      idempotent
//   DELETE /api/gists/:id           own post or admin
//   GET    /api/gists/:id/comments  oldest-first, cursor paged
//   POST   /api/gists/:id/comments  1–280 chars
//   POST   /api/gists/:id/report    records a report row for admins
//
// News endpoints (standard in-game session auth, no extra keys):
//   GET    /api/news?cursor=        newest-first, 20/page, cache metadata
//   POST   /api/news/refresh       re-fetch in background when cache is stale
//
// Text is stored plain: server strips markup/entities; clients must
// render it as text, never as HTML. Likes/comments create NO
// notifications (the v2.4 notification set is fixed).
// ============================================================
import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import {
  getUserById,
  listGists, createGist, getGist, deleteGist,
  likeGist, unlikeGist, likeCount,
  addGistComment, listGistComments, addGistReport,
  GIST_MAX,
  listNewsItems, newsCacheAgeMs, NEWS_CACHE_MS,
} from '../db.js';
import { refreshNewsFeeds } from '../news.js';

/** Server-side sanitization: strip markup/entities down to plain text. */
export function sanitizePlainText(input) {
  return String(input ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Post rate limit: max 1 gist per 30s per user (spam guard). The slot is
 *  only consumed on a successful post — failed validations don't burn it. */
const POST_WINDOW_MS = 30 * 1000;
const postHits = new Map(); // userId -> last successful post ts
export function checkPostRateLimited(userId) {
  const last = postHits.get(Number(userId)) || 0;
  return Date.now() - last < POST_WINDOW_MS;
}
export function markPostRate(userId) {
  postHits.set(Number(userId), Date.now());
}
/** Test hook: clear the in-memory rate-limit state. */
export function _resetGistRateLimit() { postHits.clear(); }

const REPORT_MAX = 200;

export function createGistsRouter() {
  const router = Router();
  router.use(authMiddleware);

  // ---- feed: tab + cursor pagination ----
  router.get('/', async (req, res) => {
    try {
      const tab = String(req.query.tab || 'latest');
      const { gists, next_cursor } = await listGists({
        viewerId: req.userId,
        tab,
        cursor: req.query.cursor,
        limit: req.query.limit,
      });
      res.json({ gists, next_cursor, tab });
    } catch (e) { console.error('[gists] list:', e.message); res.status(500).json({ error: 'Could not load gists.' }); }
  });

  // ---- post a gist ----
  router.post('/', async (req, res) => {
    try {
      if (checkPostRateLimited(req.userId)) {
        return res.status(429).json({ error: 'Slow down — one gist every 30 seconds.' });
      }
      const text = sanitizePlainText(req.body && req.body.text);
      if (!text) return res.status(400).json({ error: 'Write something first.' });
      if (text.length > GIST_MAX) {
        return res.status(400).json({ error: `Gists are ${GIST_MAX} characters max.` });
      }
      const gist = await createGist(req.userId, text);
      markPostRate(req.userId);
      res.status(201).json({ gist });
    } catch (e) { console.error('[gists] post:', e.message); res.status(500).json({ error: 'Could not post your gist.' }); }
  });

  // ---- like / unlike (idempotent toggles) ----
  router.post('/:id/like', async (req, res) => {
    try {
      const gist = await getGist(req.params.id);
      if (!gist) return res.status(404).json({ error: 'Gist not found.' });
      await likeGist(gist.id, req.userId);
      res.json({ ok: true, liked: true, like_count: await likeCount(gist.id) });
    } catch (e) { console.error('[gists] like:', e.message); res.status(500).json({ error: 'Could not like this gist.' }); }
  });

  router.delete('/:id/like', async (req, res) => {
    try {
      const gist = await getGist(req.params.id);
      if (!gist) return res.status(404).json({ error: 'Gist not found.' });
      await unlikeGist(gist.id, req.userId);
      res.json({ ok: true, liked: false, like_count: await likeCount(gist.id) });
    } catch (e) { console.error('[gists] unlike:', e.message); res.status(500).json({ error: 'Could not unlike this gist.' }); }
  });

  // ---- delete: own post or admin ----
  router.delete('/:id', async (req, res) => {
    try {
      const gist = await getGist(req.params.id);
      if (!gist) return res.status(404).json({ error: 'Gist not found.' });
      const me = await getUserById(req.userId);
      const isAdmin = me && Number(me.is_admin);
      if (Number(gist.user_id) !== Number(req.userId) && !isAdmin) {
        return res.status(403).json({ error: 'You can only delete your own gists.' });
      }
      await deleteGist(gist.id);
      res.json({ ok: true, deleted: true });
    } catch (e) { console.error('[gists] delete:', e.message); res.status(500).json({ error: 'Could not delete this gist.' }); }
  });

  // ---- comments: oldest-first, cursor paged ----
  router.get('/:id/comments', async (req, res) => {
    try {
      const gist = await getGist(req.params.id);
      if (!gist) return res.status(404).json({ error: 'Gist not found.' });
      const { comments, next_cursor } = await listGistComments(gist.id, req.query.cursor, req.query.limit);
      res.json({ comments, next_cursor });
    } catch (e) { console.error('[gists] comments:', e.message); res.status(500).json({ error: 'Could not load comments.' }); }
  });

  router.post('/:id/comments', async (req, res) => {
    try {
      const gist = await getGist(req.params.id);
      if (!gist) return res.status(404).json({ error: 'Gist not found.' });
      const text = sanitizePlainText(req.body && req.body.text);
      if (!text) return res.status(400).json({ error: 'Write something first.' });
      if (text.length > GIST_MAX) {
        return res.status(400).json({ error: `Comments are ${GIST_MAX} characters max.` });
      }
      const comment = await addGistComment(gist.id, req.userId, text);
      res.status(201).json({ comment });
    } catch (e) { console.error('[gists] comment:', e.message); res.status(500).json({ error: 'Could not post your comment.' }); }
  });

  // ---- report: records a row for admins (no notification) ----
  router.post('/:id/report', async (req, res) => {
    try {
      const gist = await getGist(req.params.id);
      if (!gist) return res.status(404).json({ error: 'Gist not found.' });
      const reason = sanitizePlainText(req.body && req.body.reason).slice(0, REPORT_MAX);
      if (!reason) return res.status(400).json({ error: 'Tell us why you are reporting this.' });
      const reportId = await addGistReport(gist.id, req.userId, reason);
      res.status(201).json({ ok: true, report_id: reportId });
    } catch (e) { console.error('[gists] report:', e.message); res.status(500).json({ error: 'Could not record your report.' }); }
  });

  return router;
}

/**
 * News tab router. `triggerRefresh` kicks a background refresh (owned by
 * app.js); this router never blocks the response on a fetch.
 */
export function createNewsRouter({ triggerRefresh } = {}) {
  const router = Router();
  router.use(authMiddleware);

  router.get('/', async (req, res) => {
    try {
      const age = await newsCacheAgeMs();
      const stale = !(age < NEWS_CACHE_MS);
      if (stale && triggerRefresh) triggerRefresh();
      const { items, next_cursor } = await listNewsItems(req.query.cursor, req.query.limit);
      res.json({
        items,
        next_cursor,
        stale,
        updated_minutes_ago: age === Infinity ? null : Math.floor(age / 60000),
      });
    } catch (e) { console.error('[news] list:', e.message); res.status(500).json({ error: 'Could not load headlines.' }); }
  });

  // Manual refresh: respected cache — only re-fetches when stale.
  router.post('/refresh', async (req, res) => {
    try {
      const age = await newsCacheAgeMs();
      if (age < NEWS_CACHE_MS) {
        return res.json({ ok: true, refreshed: false, updated_minutes_ago: Math.floor(age / 60000) });
      }
      if (triggerRefresh) triggerRefresh();
      else refreshNewsFeeds().catch((e) => console.error('[news] refresh:', e.message));
      res.json({ ok: true, refreshed: true, refreshing: true });
    } catch (e) { console.error('[news] refresh:', e.message); res.status(500).json({ error: 'Could not refresh headlines.' }); }
  });

  return router;
}
