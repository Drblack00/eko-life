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
//   POST   /api/gists/:id/report    report; hidden from reporter at once,
//                                  auto-hidden globally at 3 distinct reports
//
// Moderation (PORT-P4): DB-backed rate limits (1 post / 5 min, 20 / day),
// banned-word filter, no links for accounts younger than 7 days, and a
// 3-report auto-hide pending admin review. Like/comment/report flows on
// hidden posts still work for the author; everyone else can't see them.
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
  countDistinctGistReporters, hideGist,
  lastGistTs, countGistsSince,
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

// ============================================================
// PORT-P4: gist moderation controls.
// - Rate limits: 1 post per 5 minutes + max 20 posts per rolling
//   24h per user. DB-backed so they survive restarts; the slot is
//   only consumed on a successful post — failed validations don't
//   burn it.
// - Banned-word filter (posts + comments): original list of
//   profanity, slurs, and common scam phrases.
// - Link rule: accounts younger than 7 days may not post URLs.
// - Reports: a post is hidden from its reporter immediately
//   (feed filter) and auto-hidden globally once 3 DISTINCT
//   reporters flag it, pending admin review.
// ============================================================
export const POST_MIN_INTERVAL_MS = 5 * 60 * 1000;
export const POST_DAY_MAX = 20;
const DAY_MS = 24 * 3600 * 1000;

const BANNED_WORDS = [
  'fuck', 'shit', 'bitch', 'bastard', 'dick', 'pussy', 'cunt',
  'whore', 'slut', 'asshole', 'motherfucker', 'nigga', 'nigger',
  'faggot', 'retard', 'kill yourself', 'kys',
  'send me your password', 'double your money', 'free bitcoin',
  'crypto doubler', 'forex doubler', 'buy followers', 'dm for rmt',
];
/**
 * Padded-substring match on punctuation-normalized text: " shit " hits
 * "you are shit" and "shit, honestly", but not "bullshit".
 */
export function containsBannedWord(text) {
  const t = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  return BANNED_WORDS.some((w) => t.includes(` ${w} `));
}

const URL_RE = /(https?:\/\/|www\.)/i;
const NEW_ACCOUNT_MS = 7 * 24 * 3600 * 1000;
export const REPORT_HIDE_THRESHOLD = 3;

/** Legacy test hook (rate limits are DB-backed now): kept as a no-op. */
export function _resetGistRateLimit() {}

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
      const me = await getUserById(req.userId);
      const text = sanitizePlainText(req.body && req.body.text);
      if (!text) return res.status(400).json({ error: 'Write something first.' });
      if (text.length > GIST_MAX) {
        return res.status(400).json({ error: `Gists are ${GIST_MAX} characters max.` });
      }
      if (containsBannedWord(text)) {
        return res.status(400).json({ error: "This gist can't be posted — it contains a banned word." });
      }
      const accountAge = Date.now() - Number(me && me.created_at || 0);
      if (accountAge < NEW_ACCOUNT_MS && URL_RE.test(text)) {
        return res.status(400).json({ error: "New accounts can't post links until they're 7 days old." });
      }
      if (Date.now() - (await lastGistTs(req.userId)) < POST_MIN_INTERVAL_MS) {
        return res.status(429).json({ error: 'Slow down — one gist every 5 minutes.' });
      }
      if ((await countGistsSince(req.userId, DAY_MS)) >= POST_DAY_MAX) {
        return res.status(429).json({ error: 'Daily gist limit reached (20/day) — come back tomorrow.' });
      }
      const gist = await createGist(req.userId, text);
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
      if (containsBannedWord(text)) {
        return res.status(400).json({ error: "This comment can't be posted — it contains a banned word." });
      }
      const commenter = await getUserById(req.userId);
      if (Date.now() - Number(commenter && commenter.created_at || 0) < NEW_ACCOUNT_MS && URL_RE.test(text)) {
        return res.status(400).json({ error: "New accounts can't post links until they're 7 days old." });
      }
      const comment = await addGistComment(gist.id, req.userId, text);
      res.status(201).json({ comment });
    } catch (e) { console.error('[gists] comment:', e.message); res.status(500).json({ error: 'Could not post your comment.' }); }
  });

  // ---- report: hidden from the reporter immediately (feed filter);
  // auto-hidden GLOBALLY once REPORT_HIDE_THRESHOLD distinct reporters
  // flag it, pending admin review. No notification is created.
  router.post('/:id/report', async (req, res) => {
    try {
      const gist = await getGist(req.params.id);
      if (!gist) return res.status(404).json({ error: 'Gist not found.' });
      const reason = sanitizePlainText(req.body && req.body.reason).slice(0, REPORT_MAX);
      if (!reason) return res.status(400).json({ error: 'Tell us why you are reporting this.' });
      const reportId = await addGistReport(gist.id, req.userId, reason);
      const distinct = await countDistinctGistReporters(gist.id);
      let globallyHidden = false;
      if (distinct >= REPORT_HIDE_THRESHOLD && !Number(gist.hidden)) {
        await hideGist(gist.id);
        globallyHidden = true;
      }
      res.status(201).json({
        ok: true,
        report_id: reportId,
        hidden_from_you: true,
        globally_hidden: globallyHidden,
        report_count: distinct,
      });
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
