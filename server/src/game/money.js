// ============================================================
// game/money.js — Èkó Life gameplay-coins spend helpers
// Admin unlimited stealth money: admins (is_admin=1 on the users row,
// first registered account is admin) can afford ANYTHING and are never
// charged. Their characters.money column stays small on purpose —
// the leaderboard and every other player only ever see that column.
//
// Rules (all enforced server-side; client balances are never trusted):
// - canAfford(c, cost, isAdmin): true for admins regardless of balance.
// - charge(c, cost, isAdmin): deducts `cost` from c.money for regular
//   players; for admins it deducts NOTHING and returns 0.
// - charge returns the amount actually deducted (0 for admins) so callers
//   can refund on failure without inflating admin balances.
// - Earnings (credits) are untouched: admins earn normally.
// - The coins column is NEVER inflated for admins anywhere.
// ============================================================

/** Server-side admin check. `conn.user` comes from the DB row at WS
 *  connect / REST auth — never from client input. */
export function isAdminConn(conn) {
  return !!Number(conn && conn.user && conn.user.is_admin);
}

/** Affordability gate for every coin spend. */
export function canAfford(c, cost, isAdmin) {
  if (isAdmin) return true;
  return Number(c.money) >= Number(cost);
}

/**
 * Deduct `cost` gameplay coins. Returns the amount actually deducted
 * (0 for admins — unlimited stealth: the charge succeeds, balance
 * untouched). Callers MUST use the return value for any refund path:
 * refunding a charge that never happened would inflate the balance.
 */
export function charge(c, cost, isAdmin) {
  const amt = Math.floor(Number(cost) || 0);
  if (isAdmin) return 0;
  c.money = Math.floor(Number(c.money)) - amt;
  return amt;
}
