// ============================================================
// routes/boutique.js — Boutique clothing shop REST API (Phase 6).
//
// GAMEPLAY COINS ONLY. Premium outfits are bought with the in-game
// currency and recorded in the wardrobe table; wearing is enforced
// by the appearance validator (see game/appearance.js).
//
// Endpoints (all behind authMiddleware, Bearer <token>):
//   GET  /api/boutique       catalog + owned flags + balance
//   POST /api/boutique/buy   buy an outfit { itemId }
// ============================================================
import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import {
  getUserById, ensureCharacter, saveCharacter, addTransaction,
  getWardrobe, ownsBoutiqueItem, addWardrobeItem,
} from '../db.js';
import { BOUTIQUE_ITEMS, boutiqueItemById } from '../game/data.js';
import { canAfford, charge } from '../game/money.js';

function boutiqueError(status, error) {
  const e = new Error(error);
  e.status = status;
  e.boutiqueError = true;
  return e;
}

export function createBoutiqueRouter() {
  const router = Router();
  router.use(authMiddleware);

  // ---- catalog + ownership ----
  router.get('/', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      const owned = await getWardrobe(user.id);
      const ownedSet = new Set(owned);
      res.json({
        items: BOUTIQUE_ITEMS.map(i => ({ ...i, owned: ownedSet.has(i.id) })),
        balance: Math.floor(Number((await ensureCharacter(user.id, user.username)).money) || 0),
      });
    } catch (e) {
      console.error('[boutique] catalog:', e.message);
      res.status(500).json({ error: 'Could not load the boutique.' });
    }
  });

  // ---- buy an outfit ----
  router.post('/buy', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      if (Number(user.banned)) return res.status(403).json({ error: 'This account is banned.' });
      const itemId = String((req.body && req.body.itemId) || '');
      const item = boutiqueItemById(itemId);
      if (!item) throw boutiqueError(400, 'Unknown boutique item.');
      if (await ownsBoutiqueItem(user.id, item.id)) {
        throw boutiqueError(400, `You already own the ${item.name}.`);
      }
      const c = await ensureCharacter(user.id, user.username);
      const isAdmin = !!Number(user.is_admin);
      if (!canAfford(c, item.price, isAdmin)) {
        throw boutiqueError(400, `You need ${item.price.toLocaleString('en-NG')} coins for the ${item.name}.`);
      }
      const deducted = charge(c, item.price, isAdmin); // 0 for admins — stealth bypass
      c.money = Math.max(0, Math.floor(Number(c.money) || 0));
      await addWardrobeItem(user.id, item.id);
      await addTransaction(user.id, 'boutique', -deducted, c.money, {
        item_id: item.id, item_name: item.name, price: item.price,
      });
      await saveCharacter(c);
      res.status(201).json({
        item: { ...item, owned: true },
        balance: Math.floor(Number(c.money) || 0),
      });
    } catch (e) {
      if (e && e.boutiqueError) return res.status(e.status || 400).json({ error: e.message });
      console.error('[boutique] buy:', e.message);
      res.status(500).json({ error: 'Could not buy that outfit.' });
    }
  });

  return router;
}
