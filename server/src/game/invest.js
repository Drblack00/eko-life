// ============================================================
// game/invest.js — PORT-P2: investable assets (gameplay coins only).
//
// Three asset classes, all original names/copy:
//   - Land parcels (₦250k–₦150m): weekly yield 1.9–5%. Once a week each
//     parcel rolls a land-dispute risk event that can dent its value.
//   - Businesses (₦150k–₦250m): daily yield by tier, collected manually.
//   - Haulage (truck ₦18m): fixed weekly income.
// Buy / sell / collect flows. Yields accrue on the day tick; selling
// pays out current value + accrued yield. No real-money linkage.
// ============================================================
import {
  dbRun, dbGet, dbAll, dbRunReturning, dbMode, addTransaction, listCharacters,
} from '../db.js';
import { canAfford, charge } from './money.js';
import { weekIndex } from './v2/m10.js';

const naira = (n) => '₦' + Math.floor(Number(n) || 0).toLocaleString('en-NG');

// ---------------- Asset definitions ----------------

export const LAND_PARCELS = {
  plot_ikorodu: { id: 'plot_ikorodu', name: 'Plot · Ikorodu',      icon: '🟫', price: 250000,    weeklyYield: 0.019 },
  plot_egbeda:  { id: 'plot_egbeda',  name: 'Plot · Egbeda',       icon: '🟨', price: 800000,    weeklyYield: 0.024 },
  acre_mowe:    { id: 'acre_mowe',    name: 'Acre · Mowe',          icon: '🌾', price: 2500000,   weeklyYield: 0.030 },
  plot_ajah:    { id: 'plot_ajah',    name: 'Plot · Ajah',          icon: '🏖️', price: 8000000,   weeklyYield: 0.036 },
  acres_lekki:  { id: 'acres_lekki',  name: 'Acres · Lekki',        icon: '🌴', price: 35000000,  weeklyYield: 0.042 },
  estate_eko:   { id: 'estate_eko',   name: 'Estate Land · Eko Atlantic', icon: '🌊', price: 150000000, weeklyYield: 0.050 },
};

export const BUSINESSES = {
  kiosk:      { id: 'kiosk',      name: 'Provision Kiosk',      icon: '🏪', price: 150000,    dailyYield: 0.012 },
  grill_spot: { id: 'grill_spot', name: 'Grill Spot',           icon: '🍢', price: 600000,    dailyYield: 0.011 },
  salon:      { id: 'salon',      name: 'Unisex Salon',         icon: '💈', price: 2500000,   dailyYield: 0.010 },
  dispatch:   { id: 'dispatch',   name: 'Dispatch Riders Fleet',icon: '🛵', price: 12000000,  dailyYield: 0.009 },
  water_plant:{ id: 'water_plant',name: 'Pure Water Factory',   icon: '💧', price: 60000000,  dailyYield: 0.008 },
  mini_mall:  { id: 'mini_mall',  name: 'Mini Mall',            icon: '🏬', price: 250000000, dailyYield: 0.007 },
};

export const HAULAGE = {
  truck: { id: 'truck', name: 'Haulage Truck', icon: '🚚', price: 18000000, weeklyIncome: 900000 },
};

export const INVEST_DEFS = {
  land: LAND_PARCELS,
  business: BUSINESSES,
  haulage: HAULAGE,
};

// Weekly land-dispute risk: chance per parcel per week + value dent range.
export const LAND_RISK_WEEKLY_CHANCE = 0.08;
export const LAND_RISK_DENT_MIN = 0.10;
export const LAND_RISK_DENT_MAX = 0.25;
export const LAND_RISK_FLAVOR = [
  'A distant family surfaced with old survey papers — the plot’s value takes a hit while the matter settles.',
  'Encroachers fenced off a corner of the land. Sorting it out cost value.',
  'The community youth levy landed unexpectedly — value dented.',
  'A boundary dispute with the next compound dragged on — value dented.',
];

export function defFor(kind, id) {
  const table = INVEST_DEFS[String(kind)];
  return table ? table[String(id)] || null : null;
}

/** Yield accrued per holding per settle step (pure). */
export function yieldFor(kind, def, principal) {
  const p = Math.max(0, Math.floor(Number(principal) || 0));
  if (kind === 'business') return Math.floor(p * Number(def.dailyYield));
  if (kind === 'land') return Math.floor(p * Number(def.weeklyYield));
  if (kind === 'haulage') return Math.floor(Number(def.weeklyIncome) || 0);
  return 0;
}

/** Weekly risk roll for a land parcel (pure; rng injectable for tests). */
export function rollLandRisk(rng = Math.random) {
  if (rng() >= LAND_RISK_WEEKLY_CHANCE) return null;
  const dent = LAND_RISK_DENT_MIN + rng() * (LAND_RISK_DENT_MAX - LAND_RISK_DENT_MIN);
  const flavor = LAND_RISK_FLAVOR[Math.floor(rng() * LAND_RISK_FLAVOR.length)];
  return { dent, flavor };
}

// ---------------- Module-owned table ----------------

const SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS p2_invest (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  def_id TEXT NOT NULL,
  principal INTEGER NOT NULL,
  accrued INTEGER NOT NULL DEFAULT 0,
  last_yield_day INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_p2_invest_user ON p2_invest(user_id);`;

const SCHEMA_PG = `
CREATE TABLE IF NOT EXISTS p2_invest (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  def_id TEXT NOT NULL,
  principal BIGINT NOT NULL,
  accrued BIGINT NOT NULL DEFAULT 0,
  last_yield_day INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_p2_invest_user ON p2_invest(user_id);`;

let schemaReady = false;
export async function ensureInvestSchema() {
  if (schemaReady) return;
  const split = (sql) => sql.split(';').map((s) => s.trim()).filter(Boolean);
  const lite = split(SCHEMA_SQLITE);
  const pg = split(SCHEMA_PG);
  for (let i = 0; i < lite.length; i++) await dbRun(lite[i], pg[i] || lite[i]);
  schemaReady = true;
}

/** Test hook: drop the invest table so tests start clean. */
export async function _resetInvestSchema() {
  schemaReady = false;
  await dbRun('DROP TABLE IF EXISTS p2_invest', 'DROP TABLE IF EXISTS p2_invest', []);
  await ensureInvestSchema();
}

function normalizeHolding(r) {
  return {
    id: Number(r.id),
    user_id: Number(r.user_id),
    kind: String(r.kind),
    def_id: String(r.def_id),
    principal: Math.floor(Number(r.principal) || 0),
    accrued: Math.floor(Number(r.accrued) || 0),
    last_yield_day: Math.floor(Number(r.last_yield_day) || 0),
  };
}

export async function listHoldings(userId) {
  await ensureInvestSchema();
  const rows = await dbAll(
    'SELECT * FROM p2_invest WHERE user_id=? ORDER BY id',
    'SELECT * FROM p2_invest WHERE user_id=$1 ORDER BY id',
    [userId]);
  return rows.map(normalizeHolding);
}

export async function getHolding(id) {
  await ensureInvestSchema();
  const row = await dbGet('SELECT * FROM p2_invest WHERE id=?', 'SELECT * FROM p2_invest WHERE id=$1', [id]);
  return row ? normalizeHolding(row) : null;
}

function investError(status, error) {
  const e = new Error(error);
  e.status = status;
  e.investError = true;
  return e;
}

/** Buy an asset. Server-validated kind/def + affordability. */
export async function buyHoldingFor({ user, character, isAdmin, kind, defId, day }) {
  const def = defFor(kind, defId);
  if (!def) throw investError(400, 'Unknown investment.');
  const c = character;
  if (!canAfford(c, def.price, isAdmin)) throw investError(400, "You don't have that much cash.");
  const deducted = charge(c, def.price, isAdmin);
  await ensureInvestSchema();
  const now = Date.now();
  const startDay = Math.floor(Number(day) || 1);
  let id = null;
  if (dbMode() === 'postgres') {
    const r = await dbRunReturning(
      'INSERT INTO p2_invest (user_id, kind, def_id, principal, accrued, last_yield_day, created_at) VALUES (?,?,?,?,?,?,?)',
      'INSERT INTO p2_invest (user_id, kind, def_id, principal, accrued, last_yield_day, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [user.id, kind, def.id, def.price, 0, startDay, now]);
    id = r.rows.length ? Number(r.rows[0].id) : null;
  } else {
    await dbRun(
      'INSERT INTO p2_invest (user_id, kind, def_id, principal, accrued, last_yield_day, created_at) VALUES (?,?,?,?,?,?,?)',
      'INSERT INTO p2_invest (user_id, kind, def_id, principal, accrued, last_yield_day, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [user.id, kind, def.id, def.price, 0, startDay, now]);
    const row = await dbGet(
      'SELECT id FROM p2_invest WHERE user_id=? ORDER BY id DESC LIMIT 1',
      'SELECT id FROM p2_invest WHERE user_id=$1 ORDER BY id DESC LIMIT 1',
      [user.id]);
    id = row ? Number(row.id) : null;
  }
  c.money = Math.max(0, Math.floor(Number(c.money) || 0));
  await addTransaction(user.id, 'invest_buy', -deducted, c.money, { kind, def_id: def.id, price: def.price });
  console.log(`[invest] ${user.username} bought ${def.name} (${naira(def.price)})`);
  return { holding: await getHolding(id) };
}

/** Collect accrued yield into the wallet. */
export async function collectYieldFor({ user, character, holdingId }) {
  const holding = await getHolding(holdingId);
  if (!holding || Number(holding.user_id) !== Number(user.id)) throw investError(404, 'Investment not found.');
  if (holding.accrued <= 0) throw investError(400, 'Nothing to collect yet — yields accrue on the day tick.');
  const c = character;
  const amt = holding.accrued;
  c.money = Math.max(0, Math.floor(Number(c.money) || 0)) + amt;
  await dbRun('UPDATE p2_invest SET accrued=0 WHERE id=?', 'UPDATE p2_invest SET accrued=0 WHERE id=$1', [holding.id]);
  await addTransaction(user.id, 'invest_collect', amt, c.money, {
    kind: holding.kind, def_id: holding.def_id, holding_id: holding.id,
  });
  return { collected: amt, holding: await getHolding(holding.id) };
}

/** Sell: pays out current value + accrued yield, closes the holding. */
export async function sellHoldingFor({ user, character, holdingId }) {
  const holding = await getHolding(holdingId);
  if (!holding || Number(holding.user_id) !== Number(user.id)) throw investError(404, 'Investment not found.');
  const c = character;
  const payout = Math.max(0, holding.principal) + Math.max(0, holding.accrued);
  c.money = Math.max(0, Math.floor(Number(c.money) || 0)) + payout;
  await dbRun('DELETE FROM p2_invest WHERE id=?', 'DELETE FROM p2_invest WHERE id=$1', [holding.id]);
  await addTransaction(user.id, 'invest_sell', payout, c.money, {
    kind: holding.kind, def_id: holding.def_id, holding_id: holding.id,
    principal: holding.principal, accrued: holding.accrued,
  });
  console.log(`[invest] ${user.username} sold ${holding.def_id} (+${naira(payout)})`);
  return { payout, holding };
}

async function saveHolding(h) {
  await dbRun(
    'UPDATE p2_invest SET principal=?, accrued=?, last_yield_day=? WHERE id=?',
    'UPDATE p2_invest SET principal=$1, accrued=$2, last_yield_day=$3 WHERE id=$4',
    [h.principal, h.accrued, h.last_yield_day, h.id]);
}

/**
 * Day-tick settlement for one player's holdings (pure-ish, DB-backed).
 * Businesses accrue daily; land + haulage accrue weekly. Land rolls the
 * weekly dispute risk. Returns { dirty, notes, events }.
 */
export async function settleInvestForUser(userId, day, { rng = Math.random } = {}) {
  await ensureInvestSchema();
  const holdings = await listHoldings(userId);
  const d = Math.floor(Number(day) || 0);
  const wi = weekIndex(d);
  let dirty = false;
  const notes = [];
  for (const h of holdings) {
    const def = defFor(h.kind, h.def_id);
    if (!def) continue;
    if (h.kind === 'business') {
      const daysElapsed = d - h.last_yield_day;
      if (daysElapsed > 0) {
        const perDay = yieldFor('business', def, h.principal);
        h.accrued += perDay * daysElapsed;
        h.last_yield_day = d;
        dirty = true;
      }
    } else {
      // land + haulage: weekly accrual
      const lastWi = weekIndex(h.last_yield_day);
      if (wi > lastWi) {
        const weeks = wi - lastWi;
        h.accrued += yieldFor(h.kind, def, h.principal) * weeks;
        h.last_yield_day = d;
        dirty = true;
        if (h.kind === 'land') {
          const risk = rollLandRisk(rng);
          if (risk) {
            const dentAmt = Math.floor(h.principal * risk.dent);
            h.principal = Math.max(0, h.principal - dentAmt);
            notes.push(`⚠️ ${def.name}: ${risk.flavor} Value −${naira(dentAmt)}.`);
          }
        }
      }
    }
    if (dirty) await saveHolding(h);
  }
  if (dirty) {
    const total = holdings.reduce((a, h) => a + h.accrued, 0);
    if (total > 0) notes.unshift(`📈 Investments yielded ${naira(total)} — collect it from the Invest app.`);
  }
  return { dirty, notes };
}

/** Online wrapper (sys notes to the player). */
export async function settleInvestOnline(ctx, conn) {
  const { day } = ctx.getDay();
  return settleInvestForUser(conn.user.id, day);
}

/** Offline sweep (DB-credited, no notes). */
export async function settleInvestOffline(ctx, isOnline) {
  const { day } = ctx.getDay();
  let chars;
  try { chars = await listCharacters(); }
  catch (e) { console.error('[invest] listCharacters:', e.message); return; }
  for (const ch of chars) {
    const userId = Number(ch.user_id);
    if (isOnline && isOnline(userId)) continue;
    try { await settleInvestForUser(userId, day); }
    catch (e) { console.error('[invest] offline settle:', e.message); }
  }
}
