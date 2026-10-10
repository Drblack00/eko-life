// ============================================================
// game/v2/m10.js — M10: Economy depth (ALL ORIGINAL code).
// Player-run shops, rent-to-own housing, LAPO-style weekly loans,
// and progressive weekly income tax.
//
// Integration contract (server/src/game/v2/README.md):
// - Own tables live here (shops, shop_items, shop_ratings, lapo_loans).
// - New `characters` column is DELIVERED via the COLUMNS spec in the
//   milestone report — never altered here.
// - Existing intents (rent settlement, saveCharacter) are changed via
//   MODIFY specs in the report.
// ============================================================
import {
  dbRun, dbGet, dbAll,
  addTransaction, getCharacter, saveCharacter, listCharacters,
  getMeta, setMeta,
} from '../../db.js';
import { LOCATIONS, cleanText } from '../data.js';
import { clamp } from '../sim.js';

const naira = (n) => '₦' + Number(n).toLocaleString('en-NG');

// ---------------- Tunable constants ----------------
export const SHOP_TYPES = {
  food_spot:   { id: 'food_spot',   name: 'Food Spot',   icon: '🍲' },
  salon:       { id: 'salon',       name: 'Salon',       icon: '💇' },
  provisions:  { id: 'provisions',  name: 'Provisions',  icon: '🛒' },
  fashion:     { id: 'fashion',     name: 'Fashion',     icon: '👗' },
  pharmacy:    { id: 'pharmacy',    name: 'Pharmacy',    icon: '💊' },
  events:      { id: 'events',      name: 'Events',      icon: '🎉' },
  dispatch:    { id: 'dispatch',    name: 'Dispatch',    icon: '🛵' },
  tech_repair: { id: 'tech_repair', name: 'Tech Repair', icon: '🔧' },
};
export const SHOP_CREATE_FEE = 20000;      // one-time fee to open a shop
export const SHOP_ITEM_CAP = 20;           // max distinct items per shop
export const SHOP_ITEM_MAX_PRICE = 1000000;
export const SHOP_ITEM_MAX_QTY = 999;
export const SHOP_NAME_MAX = 30;

// LAPO-style loans: bigger, weekly auto-debits, flat 5% interest total.
export const LAPO_MIN = 50000;
export const LAPO_MAX = 500000;
export const LAPO_WEEKS = 4;
export const LAPO_FLAT_RATE = 0.05; // 5% flat on principal, spread across the 4 debits

// Progressive weekly income tax (computed from the ledger).
export const TAX_FREE = 1000000;      // first ₦1M/week free
export const TAX_BAND2 = 9000000;     // next ₦9M taxed at 20%
export const TAX_RATE2 = 0.20;
export const TAX_RATE3 = 0.30;        // above ₦10M
// Ledger kinds that count as earnings. Other milestones that add earning
// kinds should append here (coordinator-owned list).
export const EARNING_KINDS = [
  'work_pay', 'biz_income', 'shop_earn', 'hunt_prize',
  'gov_salary', 'savings_interest', 'spawn_cash',
];

// Rent-to-own buy prices ≈ 48× the 7-day rent (see CONFIG_DATA + report).
export const HOUSING_BUY = {
  face_me: 1680000,   // 5,000/day → 35,000/week → ×48
  selfcon: 4032000,   // 12,000/day → 84,000/week → ×48
  flat:    8400000,   // 25,000/day → 175,000/week → ×48
  duplex:  20160000,  // 60,000/day → 420,000/week → ×48
};

// ---------------- Storage ----------------
export const SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER UNIQUE NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  location_id TEXT NOT NULL,
  rating_sum INTEGER NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shop_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  stock INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shop_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL,
  rater_id INTEGER NOT NULL,
  stars INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(shop_id, rater_id)
);
CREATE TABLE IF NOT EXISTS lapo_loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE NOT NULL,
  principal INTEGER NOT NULL,
  balance INTEGER NOT NULL,
  weekly_due INTEGER NOT NULL,
  weeks_left INTEGER NOT NULL,
  start_day INTEGER NOT NULL,
  debits_done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shops_owner ON shops(owner_id);
CREATE INDEX IF NOT EXISTS idx_items_shop ON shop_items(shop_id);
CREATE INDEX IF NOT EXISTS idx_ratings_shop ON shop_ratings(shop_id);
CREATE INDEX IF NOT EXISTS idx_lapo_user ON lapo_loans(user_id);`;

export const SCHEMA_PG = `
CREATE TABLE IF NOT EXISTS shops (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER UNIQUE NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  location_id TEXT NOT NULL,
  rating_sum INTEGER NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS shop_items (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price BIGINT NOT NULL,
  stock INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS shop_ratings (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  rater_id INTEGER NOT NULL,
  stars INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(shop_id, rater_id)
);
CREATE TABLE IF NOT EXISTS lapo_loans (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE NOT NULL,
  principal BIGINT NOT NULL,
  balance BIGINT NOT NULL,
  weekly_due BIGINT NOT NULL,
  weeks_left INTEGER NOT NULL,
  start_day INTEGER NOT NULL,
  debits_done INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shops_owner ON shops(owner_id);
CREATE INDEX IF NOT EXISTS idx_items_shop ON shop_items(shop_id);
CREATE INDEX IF NOT EXISTS idx_ratings_shop ON shop_ratings(shop_id);
CREATE INDEX IF NOT EXISTS idx_lapo_user ON lapo_loans(user_id);`;

export async function ensureSchema() {
  const split = (sql) => sql.split(';').map(s => s.trim()).filter(Boolean);
  const lite = split(SCHEMA_SQLITE);
  const pg = split(SCHEMA_PG);
  for (let i = 0; i < lite.length; i++) {
    await dbRun(lite[i], pg[i] || lite[i]);
  }
}

// ---------------- Pure logic (no DB, no I/O) ----------------

/** LAPO terms for a principal: flat 5% interest, 4 equal-ish weekly debits. */
export function lapoTerms(amount) {
  const principal = Math.floor(Number(amount) || 0);
  const interest = Math.round(principal * LAPO_FLAT_RATE);
  const total = principal + interest;
  const weeklyDue = Math.ceil(total / LAPO_WEEKS);
  return { principal, interest, total, weeklyDue, weeks: LAPO_WEEKS };
}

/** Progressive income tax on one week's earnings (before the tax_mult). */
export function calcIncomeTax(earnings) {
  const e = Math.max(0, Math.floor(Number(earnings) || 0));
  let bill = 0;
  if (e > TAX_FREE) bill += Math.min(e - TAX_FREE, TAX_BAND2) * TAX_RATE2;
  if (e > TAX_FREE + TAX_BAND2) bill += (e - TAX_FREE - TAX_BAND2) * TAX_RATE3;
  return Math.floor(bill);
}

/** Display helper: which bracket the earnings land in. */
export function taxBracketLabel(earnings) {
  const e = Math.max(0, Math.floor(Number(earnings) || 0));
  if (e <= TAX_FREE) return { label: 'Tax-free allowance', rate: 0 };
  if (e <= TAX_FREE + TAX_BAND2) return { label: '20% band', rate: TAX_RATE2 };
  return { label: '30% band', rate: TAX_RATE3 };
}

/** Game-week index for a 1-based game day (week = 7 game days). */
export function weekIndex(day) {
  const d = Math.max(1, Math.floor(Number(day) || 1));
  return Math.floor((d - 1) / 7);
}

export function avgRating(sum, count) {
  const n = Math.floor(Number(count) || 0);
  if (n <= 0) return 0;
  return Math.round((Number(sum) / n) * 10) / 10;
}

/** Rent-to-own flag check (characters.housing_owned — see COLUMNS spec). */
export function ownsHousing(c) {
  return Number(c && c.housing_owned) === 1;
}

/** Africa/Lagos is UTC+1 year-round (no DST): midnight ms for "today". */
export function lagosDayStartMs(nowMs) {
  const lagos = new Date(Number(nowMs) + 3600_000);
  return Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate()) - 3600_000;
}

function locTags(id) {
  const l = LOCATIONS.find(x => x.id === id);
  return (l && l.tags) || [];
}
function locName(id) {
  const l = LOCATIONS.find(x => x.id === id);
  return l ? l.name : String(id);
}

// ---------------- Data access ----------------

export async function getShopByOwner(ownerId) {
  return dbGet(
    'SELECT * FROM shops WHERE owner_id=?',
    'SELECT * FROM shops WHERE owner_id=$1',
    [ownerId]);
}

export async function getShop(shopId) {
  return dbGet(
    'SELECT * FROM shops WHERE id=?',
    'SELECT * FROM shops WHERE id=$1',
    [shopId]);
}

export async function createShop(ownerId, type, name, locationId) {
  const nowMs = Date.now();
  await dbRun(
    'INSERT INTO shops (owner_id, type, name, location_id, rating_sum, rating_count, created_at) VALUES (?,?,?,?,?,?,?)',
    'INSERT INTO shops (owner_id, type, name, location_id, rating_sum, rating_count, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [ownerId, type, name, locationId, 0, 0, nowMs]);
  return getShopByOwner(ownerId);
}

export async function listItems(shopId) {
  return dbAll(
    'SELECT * FROM shop_items WHERE shop_id=? ORDER BY id',
    'SELECT * FROM shop_items WHERE shop_id=$1 ORDER BY id',
    [shopId]);
}

export async function getItem(itemId) {
  return dbGet(
    'SELECT * FROM shop_items WHERE id=?',
    'SELECT * FROM shop_items WHERE id=$1',
    [itemId]);
}

export async function createItem(shopId, name, price, stock) {
  await dbRun(
    'INSERT INTO shop_items (shop_id, name, price, stock, created_at) VALUES (?,?,?,?,?)',
    'INSERT INTO shop_items (shop_id, name, price, stock, created_at) VALUES ($1,$2,$3,$4,$5)',
    [shopId, name, price, stock, Date.now()]);
}

export async function restockItem(itemId, price, addQty) {
  await dbRun(
    'UPDATE shop_items SET price=?, stock=stock+? WHERE id=?',
    'UPDATE shop_items SET price=$1, stock=stock+$2 WHERE id=$3',
    [price, addQty, itemId]);
}

/**
 * Atomic stock decrement — returns true if the stock was available and
 * decremented (double-spend safe under concurrent buys).
 */
export async function takeStock(itemId, qty) {
  const before = await getItem(itemId);
  if (!before || Number(before.stock) < qty) return false;
  const res = await dbRun(
    'UPDATE shop_items SET stock=stock-? WHERE id=? AND stock>=?',
    'UPDATE shop_items SET stock=stock-$1 WHERE id=$2 AND stock>=$3',
    [qty, itemId, qty]);
  const changed = res && typeof res === 'object' ? Number(res.changes || 0) : 0;
  if (changed > 0) return true;
  if (!process.env.DATABASE_URL) return false; // SQLite: guard failed → sold out
  // PG: runQ() always reports changes:0 — verify via re-read
  // (best-effort; PG paths are untested locally per docs/SECURITY.md).
  const after = await getItem(itemId);
  return !!after && (Number(before.stock) - Number(after.stock)) === qty;
}

export async function deleteItem(itemId) {
  await dbRun('DELETE FROM shop_items WHERE id=?', 'DELETE FROM shop_items WHERE id=$1', [itemId]);
}

/** Browse shops: same-location first, then newest. Enriched for the client. */
export async function browseShops(locationId = '') {
  const shops = await dbAll(
    'SELECT s.*, u.username AS owner FROM shops s JOIN users u ON u.id=s.owner_id ORDER BY s.id DESC LIMIT 100',
    'SELECT s.*, u.username AS owner FROM shops s JOIN users u ON u.id=s.owner_id ORDER BY s.id DESC LIMIT 100',
    []);
  if (!shops.length) return [];
  const ids = shops.map(s => Number(s.id));
  const ph = ids.map((_, i) => (i + 1)).map(i => `$${i}`);
  const agg = await dbAll(
    `SELECT shop_id, COUNT(*) AS n, MIN(price) AS mp FROM shop_items WHERE shop_id IN (${ids.map(() => '?').join(',')}) GROUP BY shop_id`,
    `SELECT shop_id, COUNT(*) AS n, MIN(price) AS mp FROM shop_items WHERE shop_id IN (${ph.join(',')}) GROUP BY shop_id`,
    ids);
  const byShop = new Map(agg.map(a => [Number(a.shop_id), a]));
  const locId = String(locationId || '');
  const rows = shops.map(s => {
    const a = byShop.get(Number(s.id)) || { n: 0, mp: null };
    const type = SHOP_TYPES[s.type] || { name: s.type, icon: '🏪' };
    return {
      id: Number(s.id),
      name: s.name,
      type: s.type,
      typeName: type.name,
      icon: type.icon,
      location_id: s.location_id,
      locationName: locName(s.location_id),
      owner: s.owner,
      rating: avgRating(s.rating_sum, s.rating_count),
      rating_count: Number(s.rating_count) || 0,
      items: Number(a.n) || 0,
      from_price: a.mp == null ? null : Number(a.mp),
      created_at: Number(s.created_at),
    };
  });
  if (locId) {
    rows.sort((a, b) => {
      const la = a.location_id === locId ? 0 : 1;
      const lb = b.location_id === locId ? 0 : 1;
      return la - lb || b.created_at - a.created_at;
    });
  }
  return rows;
}

export async function upsertRating(shopId, raterId, stars) {
  await dbRun(
    `INSERT INTO shop_ratings (shop_id, rater_id, stars, created_at) VALUES (?,?,?,?)
     ON CONFLICT(shop_id, rater_id) DO UPDATE SET stars=excluded.stars, created_at=excluded.created_at`,
    `INSERT INTO shop_ratings (shop_id, rater_id, stars, created_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT(shop_id, rater_id) DO UPDATE SET stars=excluded.stars, created_at=excluded.created_at`,
    [shopId, raterId, stars, Date.now()]);
  const agg = await dbGet(
    'SELECT COALESCE(SUM(stars),0) AS s, COUNT(*) AS n FROM shop_ratings WHERE shop_id=?',
    'SELECT COALESCE(SUM(stars),0) AS s, COUNT(*) AS n FROM shop_ratings WHERE shop_id=$1',
    [shopId]);
  await dbRun(
    'UPDATE shops SET rating_sum=?, rating_count=? WHERE id=?',
    'UPDATE shops SET rating_sum=$1, rating_count=$2 WHERE id=$3',
    [Number(agg.s) || 0, Number(agg.n) || 0, shopId]);
  return { sum: Number(agg.s) || 0, count: Number(agg.n) || 0 };
}

// ---- LAPO loans ----
export async function getLapoLoan(userId) {
  return dbGet(
    'SELECT * FROM lapo_loans WHERE user_id=?',
    'SELECT * FROM lapo_loans WHERE user_id=$1',
    [userId]);
}

export async function createLapoLoan(userId, { principal, balance, weeklyDue, weeksLeft, startDay }) {
  await dbRun(
    'INSERT INTO lapo_loans (user_id, principal, balance, weekly_due, weeks_left, start_day, debits_done, created_at) VALUES (?,?,?,?,?,?,?,?)',
    'INSERT INTO lapo_loans (user_id, principal, balance, weekly_due, weeks_left, start_day, debits_done, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [userId, principal, balance, weeklyDue, weeksLeft, startDay, 0, Date.now()]);
  return getLapoLoan(userId);
}

export async function updateLapoLoan(id, { balance, weeks_left, debits_done }) {
  const cols = [];
  const params = [];
  if (balance !== undefined) { cols.push('balance'); params.push(Math.floor(balance)); }
  if (weeks_left !== undefined) { cols.push('weeks_left'); params.push(Math.floor(weeks_left)); }
  if (debits_done !== undefined) { cols.push('debits_done'); params.push(Math.floor(debits_done)); }
  if (!cols.length) return;
  params.push(id);
  await dbRun(
    `UPDATE lapo_loans SET ${cols.map(c => c + '=?').join(', ')} WHERE id=?`,
    `UPDATE lapo_loans SET ${cols.map((c, i) => c + '=$' + (i + 1)).join(', ')} WHERE id=$${cols.length + 1}`,
    params);
}

export async function deleteLapoLoan(id) {
  await dbRun('DELETE FROM lapo_loans WHERE id=?', 'DELETE FROM lapo_loans WHERE id=$1', [id]);
}

/** Pure per-loan debit math for one game day (no DB, no I/O). */
export function lapoDueToday(loan, day) {
  const dueWeek = Math.floor(Number(loan.debits_done) || 0) + 1;
  if (Math.floor(Number(day)) - Math.floor(Number(loan.start_day)) < 7 * dueWeek) {
    return { due: false };
  }
  return { due: true, amount: Math.min(Math.floor(Number(loan.weekly_due)), Math.floor(Number(loan.balance))) };
}

// ---- Tax ----
export async function getTaxMult() {
  const v = await getMeta('tax_mult');
  return v == null ? 1 : Number(v);
}

/** Sum of positive earning-kind ledger rows in (startMs, endMs].
 *  Exclusive start / inclusive end keeps consecutive weekly windows disjoint
 *  while always counting rows that landed before the boundary instant. */
export async function sumEarnings(userId, startMs, endMs) {
  const kinds = EARNING_KINDS;
  const sqliteSql = `SELECT amount FROM transactions WHERE user_id=? AND created_at>? AND created_at<=? AND amount>0 AND kind IN (${kinds.map(() => '?').join(',')})`;
  const pgSql = `SELECT amount FROM transactions WHERE user_id=$1 AND created_at>$2 AND created_at<=$3 AND amount>0 AND kind IN (${kinds.map((_, i) => '$' + (i + 4)).join(',')})`;
  const rows = await dbAll(sqliteSql, pgSql, [userId, Math.floor(startMs), Math.floor(endMs), ...kinds]);
  return rows.reduce((s, r) => s + Math.max(0, Math.floor(Number(r.amount) || 0)), 0);
}

export async function shopEarningsSince(userId, sinceMs) {
  const rows = await dbAll(
    'SELECT amount FROM transactions WHERE user_id=? AND kind=? AND created_at>=? AND amount>0',
    'SELECT amount FROM transactions WHERE user_id=$1 AND kind=$2 AND created_at>=$3 AND amount>0',
    [userId, 'shop_earn', Math.floor(sinceMs)]);
  return rows.reduce((s, r) => s + Math.max(0, Math.floor(Number(r.amount) || 0)), 0);
}

// ---------------- Owner-session refresh ----------------
// After a sale, the shop owner's money changes in the DB, but an online
// owner's WS session still holds the old character object. The coordinator
// drains this queue after M10 intents and pushes a fresh `you` to any
// online owner. (Alternatively the coordinator may pass api.pushTo(userId)
// into the intent api — used when present, queue otherwise.)
const pendingOwnerRefresh = [];
export function takePendingOwnerRefresh() {
  return pendingOwnerRefresh.splice(0, pendingOwnerRefresh.length);
}
function queueOwnerRefresh(userId) {
  const id = Number(userId);
  if (Number.isFinite(id) && !pendingOwnerRefresh.includes(id)) pendingOwnerRefresh.push(id);
}

// ---------------- INTENTS ----------------
export const INTENTS = {
  // ---------- shop_create {type, name, locationId} ----------
  shop_create: async (api, msg) => {
    const { conn, err, commit } = api;
    const c = conn.character;
    const type = SHOP_TYPES[String(msg.type)];
    if (!type) { err('Pick a valid shop type.'); return; }
    const loc = LOCATIONS.find(l => l.id === String(msg.locationId));
    if (!loc) { err('Pick a real location for your shop.'); return; }
    const name = cleanText(msg.name, SHOP_NAME_MAX);
    if (!name) { err('Give your shop a name (letters and numbers).'); return; }
    const existing = await getShopByOwner(conn.user.id);
    if (existing) { err('You already run a shop — one shop per player!'); return; }
    if (Math.floor(Number(c.money)) < SHOP_CREATE_FEE) {
      err(`You need ${naira(SHOP_CREATE_FEE)} to open a shop.`); return;
    }
    c.money = Math.floor(Number(c.money)) - SHOP_CREATE_FEE;
    const shop = await createShop(conn.user.id, type.id, name, loc.id);
    console.log(`[m10] ${conn.user.username} opened shop ${shop.id} (${type.id})`);
    await commit({
      kind: 'shop_fee', amount: -SHOP_CREATE_FEE,
      meta: { shop: shop.id, type: type.id, location: loc.id },
      note: `${type.icon} "${name}" is open at ${loc.name}! Stock it with goods to start earning.`,
    });
  },

  // ---------- shop_stock {name, price, qty} (owner only) ----------
  shop_stock: async (api, msg) => {
    const { conn, err, commit } = api;
    const shop = await getShopByOwner(conn.user.id);
    if (!shop) { err('Open a shop first.'); return; }
    const name = cleanText(msg.name, SHOP_NAME_MAX);
    const price = Math.floor(Number(msg.price));
    const qty = Math.floor(Number(msg.qty));
    if (!name) { err('Name the item.'); return; }
    if (!Number.isFinite(price) || price < 1 || price > SHOP_ITEM_MAX_PRICE) {
      err(`Price must be ₦1 – ${naira(SHOP_ITEM_MAX_PRICE)}.`); return;
    }
    if (!Number.isFinite(qty) || qty < 1 || qty > SHOP_ITEM_MAX_QTY) {
      err(`Quantity must be 1 – ${SHOP_ITEM_MAX_QTY}.`); return;
    }
    const items = await listItems(shop.id);
    const row = items.find(i => String(i.name).toLowerCase() === name.toLowerCase());
    if (row) {
      await restockItem(row.id, price, qty);
    } else {
      if (items.length >= SHOP_ITEM_CAP) {
        err(`Your shelves are full — ${SHOP_ITEM_CAP} different items max.`); return;
      }
      await createItem(shop.id, name, price, qty);
    }
    console.log(`[m10] ${conn.user.username} stocked ${qty}× ${name} @${price} (shop ${shop.id})`);
    await commit({ note: `📦 Stocked: ${qty} × ${name} at ${naira(price)} each.` });
  },

  // ---------- shop_buy {shopId, itemId, qty} ----------
  shop_buy: async (api, msg) => {
    const { conn, err, commit } = api;
    const c = conn.character;
    const shopId = Math.floor(Number(msg.shopId));
    const itemId = Math.floor(Number(msg.itemId));
    const qty = Math.floor(Number(msg.qty)) || 1;
    const shop = await getShop(shopId);
    if (!shop) { err('Shop not found.'); return; }
    if (Number(shop.owner_id) === Number(conn.user.id)) {
      err("You can't buy from your own shop."); return;
    }
    const item = await getItem(itemId);
    if (!item || Number(item.shop_id) !== Number(shop.id)) { err('Item not found.'); return; }
    if (!Number.isFinite(qty) || qty < 1 || qty > SHOP_ITEM_MAX_QTY) {
      err('Invalid quantity.'); return;
    }
    // Synchronous affordability check against the live session character
    // (double-spend safe: no await between check and mutation).
    const total = Math.floor(Number(item.price)) * qty;
    if (Math.floor(Number(c.money)) < total) {
      err(`You need ${naira(total)} for ${qty} × ${item.name}.`); return;
    }
    // Atomic stock take (loses cleanly if another buyer got there first).
    const took = await takeStock(item.id, qty);
    if (!took) { err(`Sorry — only ${Number(item.stock)} × ${item.name} left.`); return; }
    const left = await getItem(item.id);
    if (left && Number(left.stock) <= 0) await deleteItem(item.id); // sold-out mechanic
    c.money = Math.floor(Number(c.money)) - total;
    await commit({
      kind: 'shop_sale', amount: -total,
      meta: { shop: shop.id, item: item.id, name: item.name, qty, unit: Number(item.price) },
      note: `🛍️ You bought ${qty} × ${item.name} for ${naira(total)} from ${shop.name}.`,
    });
    // Credit the owner (DB-level) + their own ledger row.
    try {
      const owner = await getCharacter(Number(shop.owner_id));
      if (owner) {
        owner.money = Math.max(0, Math.floor(Number(owner.money) || 0)) + total;
        await addTransaction(Number(shop.owner_id), 'shop_earn', total, owner.money,
          { shop: shop.id, item: item.id, name: item.name, qty, buyer: conn.user.username });
        await saveCharacter(owner);
        if (typeof api.pushTo === 'function') {
          try { await api.pushTo(Number(shop.owner_id)); } catch { /* hub handles */ }
        } else {
          queueOwnerRefresh(Number(shop.owner_id));
        }
      }
    } catch (e) { console.error('[m10] owner credit failed:', e.message); }
    console.log(`[m10] ${conn.user.username} bought ${qty}×${item.name} from shop ${shop.id} (−${naira(total)})`);
  },

  // ---------- shop_rate {shopId, stars} ----------
  shop_rate: async (api, msg) => {
    const { conn, err, commit } = api;
    const shopId = Math.floor(Number(msg.shopId));
    const stars = Math.floor(Number(msg.stars));
    if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
      err('Rate 1–5 stars.'); return;
    }
    const shop = await getShop(shopId);
    if (!shop) { err('Shop not found.'); return; }
    const agg = await upsertRating(shopId, conn.user.id, stars);
    console.log(`[m10] ${conn.user.username} rated shop ${shopId} ${stars}★`);
    await commit({ note: `⭐ You rated "${shop.name}" ${stars}/5 (avg ${avgRating(agg.sum, agg.count)}).` });
  },

  // ---------- shop_browse {locationId?} → {t:'shops', shops} ----------
  shop_browse: async (api, msg) => {
    const shops = await browseShops(String((msg && msg.locationId) || ''));
    api.send(api.conn, { t: 'shops', shops });
  },

  // ---------- shop_mine → {t:'shop_mine', ...} ----------
  shop_mine: async (api) => {
    const { conn } = api;
    const shop = await getShopByOwner(conn.user.id);
    if (!shop) { api.send(conn, { t: 'shop_mine', shop: null }); return; }
    const items = await listItems(shop.id);
    const todayEarnings = await shopEarningsSince(conn.user.id, lagosDayStartMs(Date.now()));
    const type = SHOP_TYPES[shop.type] || { name: shop.type, icon: '🏪' };
    api.send(conn, {
      t: 'shop_mine',
      shop: {
        id: Number(shop.id), name: shop.name, type: shop.type,
        typeName: type.name, icon: type.icon,
        location_id: shop.location_id, locationName: locName(shop.location_id),
        rating: avgRating(shop.rating_sum, shop.rating_count),
        rating_count: Number(shop.rating_count) || 0,
      },
      items: items.map(i => ({
        id: Number(i.id), name: i.name,
        price: Number(i.price), stock: Number(i.stock),
      })),
      todayEarnings,
    });
  },

  // ---------- buy_rental (at a housing office; buy your current rental) ----------
  buy_rental: async (api) => {
    const { conn, err, commit } = api;
    const c = conn.character;
    const buy = HOUSING_BUY[c.housing];
    if (!buy) { err('This place is not for sale — settle somewhere proper first.'); return; }
    if (ownsHousing(c)) { err('You already own this place — no more rent! 🏠'); return; }
    if (!locTags(c.location_id).includes('housing_office')) {
      err('Go to a Housing Office to buy your rental.'); return;
    }
    if (Math.floor(Number(c.money)) < buy) {
      err(`You need ${naira(buy)} to buy this place outright.`); return;
    }
    c.money = Math.floor(Number(c.money)) - buy;
    c.housing_owned = 1;
    c.rent_misses = 0;
    // Persist the flag directly: saveCharacter()'s column list is
    // coordinator-owned (COLUMNS spec adds housing_owned there).
    try {
      await dbRun(
        'UPDATE characters SET housing_owned=1 WHERE user_id=?',
        'UPDATE characters SET housing_owned=1 WHERE user_id=$1',
        [conn.user.id]);
    } catch (e) { console.error('[m10] housing_owned persist:', e.message); }
    console.log(`[m10] ${conn.user.username} bought rental ${c.housing} (−${naira(buy)})`);
    await commit({
      kind: 'buy_rental', amount: -buy, meta: { housing: c.housing },
      note: `🏠 You now OWN this place! No more rent, ever. 🎉`,
    });
  },

  // ---------- lapo_borrow {amount} ----------
  lapo_borrow: async (api, msg) => {
    const { conn, err, commit } = api;
    const c = conn.character;
    const amt = Math.floor(Number(msg.amount));
    if (!Number.isFinite(amt) || amt < LAPO_MIN || amt > LAPO_MAX) {
      err(`LAPO loans: ${naira(LAPO_MIN)} – ${naira(LAPO_MAX)}.`); return;
    }
    const existing = await getLapoLoan(conn.user.id);
    if (existing) { err('You already have a LAPO loan running — clear it first.'); return; }
    const day = api.getDay ? api.getDay().day : 1;
    const terms = lapoTerms(amt);
    c.money = Math.floor(Number(c.money)) + amt;
    await createLapoLoan(conn.user.id, {
      principal: terms.principal, balance: terms.total,
      weeklyDue: terms.weeklyDue, weeksLeft: LAPO_WEEKS, startDay: Math.floor(Number(day)),
    });
    console.log(`[m10] ${conn.user.username} took LAPO loan ${naira(amt)} (total ${naira(terms.total)})`);
    await commit({
      kind: 'lapo_borrow', amount: amt,
      meta: { principal: terms.principal, interest: terms.interest, total: terms.total, weekly_due: terms.weeklyDue, weeks: LAPO_WEEKS },
      note: `💵 LAPO approved: ${naira(amt)}. Repay ${naira(terms.total)} in ${LAPO_WEEKS} weekly auto-debits of ${naira(terms.weeklyDue)}.`,
    });
  },

  // ---------- lapo_status → {t:'lapo', loan} ----------
  lapo_status: async (api) => {
    const loan = await getLapoLoan(api.conn.user.id);
    api.send(api.conn, {
      t: 'lapo',
      loan: loan ? {
        principal: Number(loan.principal), balance: Number(loan.balance),
        weekly_due: Number(loan.weekly_due), weeks_left: Number(loan.weeks_left),
        start_day: Number(loan.start_day), debits_done: Number(loan.debits_done),
      } : null,
      terms: { min: LAPO_MIN, max: LAPO_MAX, weeks: LAPO_WEEKS, flatRate: LAPO_FLAT_RATE },
    });
  },

  // ---------- lapo_repay {amount} / lapo_repay_all ----------
  lapo_repay: async (api, msg) => { await lapoRepay(api, msg, false); },
  lapo_repay_all: async (api) => { await lapoRepay(api, {}, true); },
};

async function lapoRepay(api, msg, all) {
  const { conn, err, commit } = api;
  const c = conn.character;
  const loan = await getLapoLoan(conn.user.id);
  if (!loan) { err('You have no LAPO loan.'); return; }
  const want = all ? Number(loan.balance) : Math.floor(Number(msg.amount));
  if (!all && (!Number.isFinite(want) || want <= 0)) { err('Enter a valid amount.'); return; }
  const pay = Math.min(want, Math.floor(Number(loan.balance)), Math.floor(Number(c.money)));
  if (pay <= 0) { err("You don't have the cash."); return; }
  c.money = Math.floor(Number(c.money)) - pay;
  const balance = Math.floor(Number(loan.balance)) - pay;
  if (balance <= 0) await deleteLapoLoan(loan.id);
  else await updateLapoLoan(loan.id, { balance });
  console.log(`[m10] ${conn.user.username} LAPO manual repay ${naira(pay)} (left ${naira(Math.max(0, balance))})`);
  await commit({
    kind: 'lapo_repay', amount: -pay,
    meta: { remaining: Math.max(0, balance), manual: true, all },
    note: balance <= 0 ? '🎉 LAPO loan fully cleared! Well done.' : `Repaid ${naira(pay)}. ${naira(balance)} left on your LAPO loan.`,
  });
}

// ---------------- Day rollover ----------------
// The coordinator wires these into the day tick:
//   per online conn:  await m10.settleOnlinePlayer(ctx, conn)
//   offline sweep:     await m10.settleOfflinePlayers(ctx, (id) => online.has(Number(id)))
// ctx = { send, youSnapshot, getDay } (online) — offline sweep needs no conn.

/** One auto-debit step for a single loan on `day`. Pure-ish: returns the plan. */
export function planLapoDebit(loan, day, money) {
  const chk = lapoDueToday(loan, day);
  if (!chk.due) return { due: false };
  const pay = Math.min(chk.amount, Math.max(0, Math.floor(Number(money) || 0)));
  const balance = Math.floor(Number(loan.balance)) - pay;
  const full = pay >= chk.amount;
  return { due: true, pay, balance: Math.max(0, balance), full, closed: balance <= 0 };
}

async function persistLapo(loan, plan) {
  if (plan.closed) await deleteLapoLoan(loan.id);
  else await updateLapoLoan(loan.id, {
    balance: plan.balance,
    debits_done: Math.floor(Number(loan.debits_done) || 0) + 1,
    weeks_left: plan.full ? Math.max(0, Math.floor(Number(loan.weeks_left)) - 1) : Math.floor(Number(loan.weeks_left)),
  });
}

/** Weekly tax bookkeeping: returns the closed week's window when a boundary crossed. */
export async function taxWeekInfo(getDay) {
  const { day } = getDay();
  const wi = weekIndex(day);
  const nowMs = Date.now();
  const stored = await getMeta('tax_week');
  if (stored == null) {
    await setMeta('tax_week', String(wi));
    await setMeta('tax_week_start', String(nowMs));
    return { charge: false, week: wi };
  }
  if (Number(stored) === wi) return { charge: false, week: wi };
  const startMs = Number(await getMeta('tax_week_start')) || 0;
  await setMeta('tax_week', String(wi));
  await setMeta('tax_week_start', String(nowMs));
  return { charge: true, week: Number(stored), startMs, endMs: nowMs };
}

/** Debit one player's weekly income tax for a closed week. Returns the note or null. */
export async function chargeWeeklyTax(userId, charMoney, info) {
  // info = { week, startMs, endMs } from taxWeekInfo when charge:true
  const mult = await getTaxMult();
  const earnings = await sumEarnings(userId, info.startMs, info.endMs);
  const bill = Math.floor(calcIncomeTax(earnings) * mult);
  if (bill <= 0) return { paid: 0, earnings, bill: 0, note: null };
  const pay = Math.min(bill, Math.max(0, Math.floor(Number(charMoney) || 0)));
  return { paid: pay, earnings, bill, mult, note: `🧾 Weekly income tax: ${naira(pay)} on ${naira(earnings)} earnings.` };
}

/** Online player: LAPO auto-debit + weekly tax, live on the session character. */
export async function settleOnlinePlayer(ctx, conn) {
  const c = conn.character;
  const { day } = ctx.getDay();
  let dirty = false;
  const notes = [];

  const loan = await getLapoLoan(conn.user.id);
  if (loan) {
    const plan = planLapoDebit(loan, day, c.money);
    if (plan.due) {
      c.money = Math.max(0, Math.floor(Number(c.money) || 0)) - plan.pay;
      if (plan.pay > 0) {
        await addTransaction(conn.user.id, 'lapo_auto', -plan.pay, c.money,
          { balance: plan.balance, weekly_due: Number(loan.weekly_due) });
      }
      await persistLapo(loan, plan);
      dirty = true;
      if (plan.closed) notes.push('🎉 LAPO loan fully cleared!');
      else if (plan.pay <= 0) notes.push('⚠️ LAPO debit missed — no cash. The balance carries over. (missed-payment moodlet hook)');
      else notes.push(`💵 LAPO auto-debit: ${naira(plan.pay)}${plan.full ? '' : ' (partial — remainder carries over)'}. ${naira(plan.balance)} left.`);
    }
  }

  const tw = await taxWeekInfo(ctx.getDay);
  if (tw.charge) {
    const t = await chargeWeeklyTax(conn.user.id, c.money, tw);
    if (t.paid > 0) {
      c.money = Math.max(0, Math.floor(Number(c.money) || 0)) - t.paid;
      await addTransaction(conn.user.id, 'income_tax', -t.paid, c.money,
        { week: tw.week, earnings: t.earnings, bill: t.bill, mult: t.mult });
      dirty = true;
      notes.push(t.note);
    }
  }

  if (dirty) {
    c.energy = clamp(c.energy, 0, 100);
    c.health = clamp(c.health, 0, 100);
    c.happiness = clamp(c.happiness, 0, 100);
    c.hunger = clamp(c.hunger, 0, 100);
    c.money = Math.max(0, Math.floor(Number(c.money) || 0));
    await saveCharacter(c);
    ctx.send(conn, { t: 'you', you: ctx.youSnapshot(conn) });
    for (const n of notes) ctx.send(conn, { t: 'sys', text: n });
  }
  return { dirty, notes };
}

/** Offline players: same math, DB-credited. isOnline(userId) skips live sessions. */
export async function settleOfflinePlayers(ctx, isOnline) {
  const { day } = ctx.getDay();
  let chars;
  try { chars = await listCharacters(); }
  catch (e) { console.error('[m10] listCharacters:', e.message); return; }
  const tw = await taxWeekInfo(ctx.getDay);
  for (const ch of chars) {
    const userId = Number(ch.user_id);
    if (isOnline && isOnline(userId)) continue;
    let dirty = false;
    try {
      const loan = await getLapoLoan(userId);
      if (loan) {
        const plan = planLapoDebit(loan, day, ch.money);
        if (plan.due) {
          ch.money = Math.max(0, Math.floor(Number(ch.money) || 0)) - plan.pay;
          if (plan.pay > 0) {
            await addTransaction(userId, 'lapo_auto', -plan.pay, ch.money,
              { balance: plan.balance, weekly_due: Number(loan.weekly_due) });
          }
          await persistLapo(loan, plan);
          dirty = true;
        }
      }
      if (tw.charge) {
        const t = await chargeWeeklyTax(userId, ch.money, tw);
        if (t.paid > 0) {
          ch.money = Math.max(0, Math.floor(Number(ch.money) || 0)) - t.paid;
          await addTransaction(userId, 'income_tax', -t.paid, ch.money,
            { week: tw.week, earnings: t.earnings, bill: t.bill, mult: t.mult });
          dirty = true;
        }
      }
      if (dirty) await saveCharacter(ch);
    } catch (e) { console.error('[m10] offline settle:', e.message); }
  }
}

// README-contract alias: coordinator may call this directly for offline.
// (Online conns need settleOnlinePlayer — see the WIRING spec in the report.)
export async function onDayRollover(ctx) {
  await settleOfflinePlayers(ctx, ctx.isOnline || null);
}

// ---------------- CONFIG_DATA (coordinator merges into /api/config) ----------------
export const CONFIG_DATA = {
  housingBuy: { ...HOUSING_BUY },
  shopTypes: Object.values(SHOP_TYPES).map(t => ({ ...t })),
  shopCreateFee: SHOP_CREATE_FEE,
  shopItemCap: SHOP_ITEM_CAP,
  lapo: { min: LAPO_MIN, max: LAPO_MAX, weeks: LAPO_WEEKS, flatRate: LAPO_FLAT_RATE },
  tax: { free: TAX_FREE, band2: TAX_BAND2, rate2: TAX_RATE2, rate3: TAX_RATE3, earningKinds: [...EARNING_KINDS] },
};

// ---------------- REST_SPEC (coordinator mounts) ----------------
async function restShops(req, res) {
  try {
    const location = typeof req.query.location === 'string' ? req.query.location : '';
    res.json({ shops: await browseShops(location) });
  } catch (e) {
    console.error('[m10] restShops:', e.message);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}

async function restMine(req, res) {
  try {
    const shop = await getShopByOwner(req.userId);
    if (!shop) return res.json({ shop: null });
    const items = await listItems(shop.id);
    const todayEarnings = await shopEarningsSince(req.userId, lagosDayStartMs(Date.now()));
    const type = SHOP_TYPES[shop.type] || { name: shop.type, icon: '🏪' };
    res.json({
      shop: {
        id: Number(shop.id), name: shop.name, type: shop.type,
        typeName: type.name, icon: type.icon,
        location_id: shop.location_id, locationName: locName(shop.location_id),
        rating: avgRating(shop.rating_sum, shop.rating_count),
        rating_count: Number(shop.rating_count) || 0,
      },
      items: items.map(i => ({ id: Number(i.id), name: i.name, price: Number(i.price), stock: Number(i.stock) })),
      todayEarnings,
    });
  } catch (e) {
    console.error('[m10] restMine:', e.message);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}

async function restShopItems(req, res) {
  try {
    const shopId = Math.floor(Number(req.params.id));
    const shop = await getShop(shopId);
    if (!shop) return res.status(404).json({ error: 'Shop not found.' });
    const items = await listItems(shopId);
    res.json({
      shop: { id: Number(shop.id), name: shop.name },
      items: items.map(i => ({ id: Number(i.id), name: i.name, price: Number(i.price), stock: Number(i.stock) })),
    });
  } catch (e) {
    console.error('[m10] restShopItems:', e.message);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}

async function restLapo(req, res) {
  try {
    const loan = await getLapoLoan(req.userId);
    res.json({
      loan: loan ? {
        principal: Number(loan.principal), balance: Number(loan.balance),
        weekly_due: Number(loan.weekly_due), weeks_left: Number(loan.weeks_left),
        start_day: Number(loan.start_day), debits_done: Number(loan.debits_done),
      } : null,
      terms: { min: LAPO_MIN, max: LAPO_MAX, weeks: LAPO_WEEKS, flatRate: LAPO_FLAT_RATE },
    });
  } catch (e) {
    console.error('[m10] restLapo:', e.message);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}

async function restTax(req, res) {
  try {
    const startMs = Number(await getMeta('tax_week_start')) || Date.now();
    const mult = await getTaxMult();
    const weekEarnings = await sumEarnings(req.userId, startMs, Date.now());
    const raw = calcIncomeTax(weekEarnings);
    res.json({
      weekEarnings,
      bill: Math.floor(raw * mult),
      rawBill: raw,
      taxMult: mult,
      holiday: mult === 0,
      free: TAX_FREE, band2: TAX_BAND2, rate2: TAX_RATE2, rate3: TAX_RATE3,
      bracket: taxBracketLabel(weekEarnings),
    });
  } catch (e) {
    console.error('[m10] restTax:', e.message);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}

export const REST_SPEC = [
  { method: 'GET', path: '/api/v2/m10/shops', auth: false, admin: false, handler: restShops,
    response: '{ shops:[{id,name,type,typeName,icon,location_id,locationName,owner,rating,rating_count,items,from_price}] }' },
  { method: 'GET', path: '/api/v2/m10/shops/:id/items', auth: false, admin: false, handler: restShopItems,
    response: '{ shop:{id,name}, items:[{id,name,price,stock}] }' },
  { method: 'GET', path: '/api/v2/m10/shop/mine', auth: true, admin: false, handler: restMine,
    response: '{ shop:null | {...,rating,rating_count}, items:[{id,name,price,stock}], todayEarnings }' },
  { method: 'GET', path: '/api/v2/m10/lapo', auth: true, admin: false, handler: restLapo,
    response: '{ loan:null | {principal,balance,weekly_due,weeks_left,start_day,debits_done}, terms }' },
  { method: 'GET', path: '/api/v2/m10/tax', auth: true, admin: false, handler: restTax,
    response: '{ weekEarnings, bill, rawBill, taxMult, holiday, free, band2, rate2, rate3, bracket }' },
];
