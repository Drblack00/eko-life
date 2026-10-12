// ============================================================
// routes/notifications.js — Èkó Life notification REST API (M21)
// All routes behind Bearer <redacted> (authMiddleware). Users can only
// ever read/mutate their own notifications (req.userId scoping).
// ============================================================
import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import {
  listNotifications,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getNotificationPrefs,
  setNotificationPrefs,
} from '../db.js';

export function createNotificationsRouter() {
  const router = Router();
  router.use(authMiddleware);

  // GET /api/notifications?limit&offset — newest first + unread count.
  router.get('/', async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(100, Math.floor(Number(req.query.limit) || 30)));
      const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0));
      const [notifications, unread] = await Promise.all([
        listNotifications(req.userId, limit, offset),
        countUnreadNotifications(req.userId),
      ]);
      res.json({ notifications, unread, limit, offset });
    } catch (e) {
      console.error('[notifications] list:', e.message);
      res.status(500).json({ error: 'Could not load notifications.' });
    }
  });

  // POST /api/notifications/:id/read — mark one read (own only).
  router.post('/:id/read', async (req, res) => {
    try {
      const ok = await markNotificationRead(req.userId, Number(req.params.id));
      res.json({ ok });
    } catch (e) {
      console.error('[notifications] read:', e.message);
      res.status(500).json({ error: 'Could not update notification.' });
    }
  });

  // POST /api/notifications/read-all — clear the badge.
  router.post('/read-all', async (req, res) => {
    try {
      await markAllNotificationsRead(req.userId);
      res.json({ ok: true });
    } catch (e) {
      console.error('[notifications] read-all:', e.message);
      res.status(500).json({ error: 'Could not update notifications.' });
    }
  });

  // GET /api/notifications/preferences
  router.get('/preferences', async (req, res) => {
    try {
      res.json({ preferences: await getNotificationPrefs(req.userId) });
    } catch (e) {
      console.error('[notifications] prefs get:', e.message);
      res.status(500).json({ error: 'Could not load preferences.' });
    }
  });

  // PUT /api/notifications/preferences { friend_online?, room_message?, money_received? }
  router.put('/preferences', async (req, res) => {
    try {
      const body = req.body || {};
      const preferences = await setNotificationPrefs(req.userId, {
        friend_online: body.friend_online !== false,
        room_message: body.room_message !== false,
        money_received: body.money_received !== false,
      });
      res.json({ preferences });
    } catch (e) {
      console.error('[notifications] prefs set:', e.message);
      res.status(500).json({ error: 'Could not save preferences.' });
    }
  });

  return router;
}
