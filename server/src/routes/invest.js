// ============================================================
// routes/invest.js — PORT-P2: investable assets REST API.
//
// GAMEPLAY COINS ONLY. Nothing here touches fintech / the cash wallet.
//
// Endpoints (all behind authMiddleware, Bearer <redacted>):
//   GET  /api/invest            defs + holdings + accrued totals
//   POST /api/invest/buy        { kind: 'land'|'business'|'haulage', defId }
//   POST /api/invest/collect    { holdingId }
//   POST /api/invest/sell       { holdingId }
// ============================================================
import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import { getUserById, ensureCharacter, saveCharacter } from '../db.js';
import {
  LAND_PARCELS, BUSINESSES, HAULAGE, defFor,
  listHoldings, buyHoldingFor, collectYieldFor, sellHoldingFor, yieldFor,
} from '../game/invest.js';

const naira = (n) => '₦' + Math.floor(Number(n) || 0).toLocaleString('en-NG');

function shapeHolding(h) {
  const def = defFor(h.kind, h.def_id) || {};
  return {
    ...h,
    name: def.name || h.def_id,
    icon: def.icon || '📦',
    price: def.price || 0,
    value: h.principal + h.accrued,
  };
}

export function createInvestRouter({ getDay } = {}) {
  const router = Router();
  router.use(authMiddleware);

  // ---- overview: defs + holdings ----
  router.get('/', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      const c = await ensureCharacter(user.id, user.username);
      const holdings = (await listHoldings(user.id)).map(shapeHolding);
      const totalValue = holdings.reduce((a, h) => a + h.value, 0);
      const totalAccrued = holdings.reduce((a, h) => a + h.accrued, 0);
      res.json({
        balance: Math.floor(Number(c.money) || 0),
        holdings,
        totalValue,
        totalAccrued,
        defs: {
          land: Object.values(LAND_PARCELS),
          business: Object.values(BUSINESSES),
          haulage: Object.values(HAULAGE),
        },
        day: getDay ? getDay().day : 1,
        isAdmin: !!Number(user.is_admin),
      });
    } catch (e) { console.error('[invest] overview:', e.message); res.status(500).json({ error: 'Could not load investments.' }); }
  });

  // ---- buy ----
  router.post('/buy', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      if (Number(user.banned)) return res.status(403).json({ error: 'This account is banned.' });
      const c = await ensureCharacter(user.id, user.username);
      const isAdmin = !!Number(user.is_admin);
      const day = getDay ? getDay().day : 1;
      const { holding } = await buyHoldingFor({
        user, character: c, isAdmin,
        kind: req.body && req.body.kind,
        defId: req.body && req.body.defId,
        day,
      });
      await saveCharacter(c);
      res.status(201).json({ holding: shapeHolding(holding), balance: Math.floor(Number(c.money) || 0) });
    } catch (e) {
      if (e && e.investError) return res.status(e.status || 400).json({ error: e.message });
      console.error('[invest] buy:', e.message);
      res.status(500).json({ error: 'Could not buy that investment.' });
    }
  });

  // ---- collect yield ----
  router.post('/collect', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      if (Number(user.banned)) return res.status(403).json({ error: 'This account is banned.' });
      const c = await ensureCharacter(user.id, user.username);
      const { collected, holding } = await collectYieldFor({
        user, character: c, holdingId: req.body && req.body.holdingId,
      });
      await saveCharacter(c);
      res.json({ collected, holding: shapeHolding(holding), balance: Math.floor(Number(c.money) || 0) });
    } catch (e) {
      if (e && e.investError) return res.status(e.status || 400).json({ error: e.message });
      console.error('[invest] collect:', e.message);
      res.status(500).json({ error: 'Could not collect that yield.' });
    }
  });

  // ---- sell ----
  router.post('/sell', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      if (Number(user.banned)) return res.status(403).json({ error: 'This account is banned.' });
      const c = await ensureCharacter(user.id, user.username);
      const { payout } = await sellHoldingFor({
        user, character: c, holdingId: req.body && req.body.holdingId,
      });
      await saveCharacter(c);
      res.json({ payout, balance: Math.floor(Number(c.money) || 0) });
    } catch (e) {
      if (e && e.investError) return res.status(e.status || 400).json({ error: e.message });
      console.error('[invest] sell:', e.message);
      res.status(500).json({ error: 'Could not sell that investment.' });
    }
  });

  return router;
}
