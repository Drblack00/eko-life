// ============================================================
// routes/gem.js — Daily Gem Hunt REST API (Phase 9).
//
// GET  /api/gem        — today's clue, countdown, finders, ladder
// POST /api/gem/search — search the player's current location
//
// The gem's location NEVER leaves the server: the GET response
// carries only the riddle clue. Gameplay coins only.
// ============================================================
import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import { getUserById, ensureCharacter } from '../db.js';
import {
  GEM_PRIZES, prizeForRank,
  ensureGemDay, gemFindCount, firstFinders, myFind, searchGem,
} from '../game/v2/gem.js';

export function createGemRouter({ getDay }) {
  const router = Router();
  router.use(authMiddleware);

  /** Today's hunt state (viewer-aware). No location leak. */
  router.get('/', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      const { day, endsIn } = getDay();
      const gem = await ensureGemDay(day);
      const count = await gemFindCount(day);
      const finders = await firstFinders(day, 5);
      const mine = await myFind(day, Number(user.id));
      res.json({
        day: Number(day),
        clue: gem.clue,
        nextGemInMs: Math.max(0, Number(endsIn) || 0),
        foundCount: count,
        firstFinders: finders,
        myFound: !!mine,
        myPrize: mine ? Number(mine.prize) : null,
        myRank: mine ? Number(mine.finder_rank) : null,
        nextPrize: prizeForRank(count + 1),
        prizeLadder: GEM_PRIZES.map((p) => ({ label: p.label, prize: p.prize })),
      });
    } catch (e) {
      console.error('[gem] GET / failed:', e.message);
      res.status(500).json({ error: 'Could not load the gem hunt.' });
    }
  });

  /** Search the player's current location for today's gem. */
  router.post('/search', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      if (Number(user.banned)) return res.status(403).json({ error: 'This account is banned.' });
      await ensureCharacter(Number(user.id));
      const { day } = getDay();
      const r = await searchGem({ day, userId: Number(user.id) });
      if (r.error) {
        return res.status(400).json({ error: r.error, cooldownMs: r.cooldownMs || 0 });
      }
      if (!r.found) {
        return res.status(400).json({ error: 'No gem here — follow the clue. 🕵️' });
      }
      res.json({ ok: true, found: true, prize: r.prize, rank: r.rank });
    } catch (e) {
      console.error('[gem] POST /search failed:', e.message);
      res.status(500).json({ error: 'Search failed — try again.' });
    }
  });

  return router;
}
