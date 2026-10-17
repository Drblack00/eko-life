// ============================================================
// routes/topup.js — PORT-P2: top-up pack STRUCTURE ONLY.
//
// The purchase path is STUBBED: REAL_MONEY_ENABLED is false, the
// purchase endpoint always refuses, and there is NO payment code
// anywhere in this router (no provider SDK, no checkout session, no
// webhook). Packs credit GAMEPLAY COINS ONLY once the real-money
// compliance chain is complete and the flag is flipped by hand.
//
// Endpoints:
//   GET  /api/topup/packs     pack definitions + disabled state (public)
//   POST /api/topup/purchase  always 403 while disabled
// ============================================================
import { Router } from 'express';

// ---- Master switch: real-money top-ups stay OFF until the compliance
// chain (CAC → SCUML → Paystack) is complete. Flip by hand, never by code.
export const REAL_MONEY_ENABLED = false;

// Pack definitions: real-money price → gameplay-coin credit.
// ids/names are original; USD figures are display approximations.
export const TOPUP_PACKS = [
  {
    id: 'starter',
    name: 'Starter Stack',
    icon: '🌱',
    ngn: 1000,
    usd: 1,
    coins: 50_000,
    tagline: 'Small money, sharp start.',
  },
  {
    id: 'hustler',
    name: "Hustler's Boost",
    icon: '🔥',
    ngn: 5000,
    usd: 4,
    coins: 300_000,
    tagline: 'Fuel for the grind.',
  },
  {
    id: 'big_moves',
    name: 'Big Moves',
    icon: '💼',
    ngn: 10000,
    usd: 7,
    coins: 700_000,
    tagline: 'Best value — stretch every naira.',
    bestValue: true,
  },
  {
    id: 'odogwu',
    name: 'Odogwu Vault',
    icon: '👑',
    ngn: 20000,
    usd: 14,
    coins: 1_600_000,
    tagline: 'For the ones playing the long game.',
  },
];

export function createTopupRouter() {
  const router = Router();

  // ---- pack definitions + disabled state (public; no secrets here) ----
  router.get('/packs', (_req, res) => {
    res.json({
      realMoneyEnabled: REAL_MONEY_ENABLED,
      currencyToggle: ['NGN', 'USD'],
      packs: TOPUP_PACKS.map((p) => ({ ...p })),
      notice: REAL_MONEY_ENABLED
        ? null
        : 'Top-ups are not available yet — they open after the real-money compliance chain is complete. Gameplay coins only, always.',
    });
  });

  // ---- purchase: STUBBED — always refuses while disabled ----
  router.post('/purchase', (req, res) => {
    if (!REAL_MONEY_ENABLED) {
      return res.status(403).json({
        error: 'Top-ups are not available yet.',
        realMoneyEnabled: false,
        detail: 'Real-money top-ups open after the compliance chain (CAC → SCUML → Paystack) is complete. No payment was started and no coins were credited.',
        packId: (req.body && req.body.packId) || null,
      });
    }
    // Unreachable until the flag is flipped by hand. There is
    // deliberately no payment provider code below this line.
    return res.status(501).json({ error: 'Checkout is not wired yet.' });
  });

  return router;
}
