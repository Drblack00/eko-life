// ============================================================
// fintech/config.js — live-money feature flag.
//
// Live cash operations stay OFF by default. Nothing in the fintech
// stack may move real money unless the operator explicitly sets
// CASH_OPS_ENABLED=true in the environment. There are no live
// provider credentials anywhere in this codebase (see mockProvider.js).
// ============================================================

// True only when the operator explicitly enables live cash operations.
export function cashOpsEnabled() {
  return process.env.CASH_OPS_ENABLED === 'true';
}

// Express middleware: hard-gates any cash route while the flag is off.
// Mount it BEFORE the route handler, e.g.:
//   app.post('/api/cash/deposit', requireCashOps, handler)
export function requireCashOps(req, res, next) {
  if (cashOpsEnabled()) return next();
  return res.status(403).json({ error: 'Cash operations are disabled.' });
}
