// ============================================================
// routes/careers.js — P3 Careers REST API (game money only).
//
// GET  /api/careers          — the 27 careers (public list)
// GET  /api/careers/me       — viewer's career status (Career tab)
// POST /api/careers/apply    — { careerId }: one-action apply/switch
// POST /api/careers/quit     — quit current career (confirmation is client-side)
// POST /api/careers/promote  — take a ready promotion
// POST /api/careers/auto     — { on }: auto-start shifts on workdays
// POST /api/careers/respond  — { eventId, choiceId }: answer a work event
//
// Mutations share the core ops in game/careers.js with the WS
// intents — one implementation, two transports.
// ============================================================
import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import {
  CAREERS, publicCareer, getCareerStatus,
  applyCareer, quitCareer, promoteCareer, setAutoStart, respondToEvent,
} from '../game/careers.js';

export function createCareersRouter() {
  const router = Router();

  /** Public catalogue — the client renders gates from skillLock/certRequired. */
  router.get('/', (req, res) => {
    res.json({ careers: CAREERS.map(publicCareer) });
  });

  router.get('/me', authMiddleware, async (req, res) => {
    try {
      res.json(await getCareerStatus(Number(req.userId)));
    } catch (e) {
      console.error('[careers] GET /me:', e.message);
      res.status(500).json({ error: 'Could not load your career.' });
    }
  });

  router.post('/apply', authMiddleware, async (req, res) => {
    try {
      const r = await applyCareer(Number(req.userId), req.body && req.body.careerId);
      if (!r.ok) return res.status(400).json({ error: r.error });
      res.json({ ok: true, switching: r.switching, status: r.status });
    } catch (e) {
      console.error('[careers] POST /apply:', e.message);
      res.status(500).json({ error: 'Application failed.' });
    }
  });

  router.post('/quit', authMiddleware, async (req, res) => {
    try {
      const r = await quitCareer(Number(req.userId));
      if (!r.ok) return res.status(400).json({ error: r.error });
      res.json({ ok: true, careerName: r.careerName });
    } catch (e) {
      console.error('[careers] POST /quit:', e.message);
      res.status(500).json({ error: 'Could not quit.' });
    }
  });

  router.post('/promote', authMiddleware, async (req, res) => {
    try {
      const r = await promoteCareer(Number(req.userId));
      if (!r.ok) return res.status(400).json({ error: r.error });
      res.json({ ok: true, newTitle: r.newTitle, status: r.status });
    } catch (e) {
      console.error('[careers] POST /promote:', e.message);
      res.status(500).json({ error: 'Promotion failed.' });
    }
  });

  router.post('/auto', authMiddleware, async (req, res) => {
    try {
      const on = !!(req.body && (req.body.on === true || req.body.on === 1 || req.body.on === '1'));
      const r = await setAutoStart(Number(req.userId), on);
      if (!r.ok) return res.status(400).json({ error: r.error });
      res.json({ ok: true, auto: r.auto });
    } catch (e) {
      console.error('[careers] POST /auto:', e.message);
      res.status(500).json({ error: 'Could not update auto-start.' });
    }
  });

  router.post('/respond', authMiddleware, async (req, res) => {
    try {
      const r = await respondToEvent(
        Number(req.userId),
        req.body && req.body.eventId,
        req.body && req.body.choiceId,
      );
      if (!r.ok) return res.status(400).json({ error: r.error });
      res.json({ ok: true, performance: r.performance, delta: r.delta, timedOut: r.timedOut });
    } catch (e) {
      console.error('[careers] POST /respond:', e.message);
      res.status(500).json({ error: 'Response failed.' });
    }
  });

  return router;
}
