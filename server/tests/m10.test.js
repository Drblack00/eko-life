// M10 — Economy depth: player shops, rent-to-own housing, LAPO loans,
// progressive income tax. Must NOT break existing loan/rent semantics
// (m3/m4 tests cover those; the full suite is run after this file).
//
// NOTE: auth endpoints are rate-limited (10/min/IP), so users are seeded
// directly via db.createUser (same convention as act.test.js / m3.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET='test';
process.env.EKO_DB_PATH = ':memory:';

const { createApp } = await import('../src/app.js');
const db = await import('../src/db.js');
const m10 = await import('../src/game/v2/m10.js');

let app;
test.before(async () => {
  app = await createApp();
  await m10.ensureSchema();
  // characters.housing_owned is coordinator-owned (COLUMNS spec); the test
  // DB gets it idempotently so the rent-to-own round-trip is fully verifiable.
  await db.ensureColumn('characters', 'housing_owned', 'INTEGER NOT NULL DEFAULT 0', 'INTEGER NOT NULL DEFAULT 0');
});
test.after(async () => { await app.close(); });

let n = 0;
async function seedUser(money = 5_000_000) {
  n += 1;
  const userId = await db.createUser({ username: 'm10seed' + n });
  const c = await db.ensureCharacter(userId, 'M10T' + n);
  c.money = money;
  c.location_id = 'housing_office_m'; // housing-office tag for buy_rental tests
  await db.saveCharacter(c);
  return { userId, character: c, user: { id: userId, username: 'm10seed' + n } };
}

// Fake intent api mirroring actions.js's commit()/err()/send() semantics.
function fakeApi(user, character, day = 1) {
  const sent = [];
  const api = {
    conn: { user, character, cds: {}, pos: { lat: 50, lng: 50 }, furniture: [] },
    send: (c, msg) => sent.push(msg),
    broadcast: () => {},
    youSnapshot: (conn) => ({ ...conn.character }),
    err: (text) => sent.push({ t: 'err', text }),
    commit: async ({ kind = null, amount = 0, meta = null, note = null } = {}) => {
      if (kind && amount) await db.addTransaction(user.id, kind, Math.floor(amount), character.money, meta);
      await db.saveCharacter(character);
      sent.push({ t: 'you', you: { ...character }, note });
    },
    now: Date.now(),
    getDay: () => ({ day, endsIn: 0 }),
  };
  return { api, sent };
}
const errs = (sent) => sent.filter(m => m.t === 'err').map(m => m.text);
const lastYou = (sent) => [...sent].reverse().find(m => m.t === 'you');

async function txns(userId) {
  return db.listTransactions(userId, 200);
}

// ---------------- pure logic ----------------
test('pure: lapoTerms math (flat 5%, 4 weekly debits)', () => {
  const t = m10.lapoTerms(100000);
  assert.equal(t.principal, 100000);
  assert.equal(t.interest, 5000);
  assert.equal(t.total, 105000);
  assert.equal(t.weeklyDue, 26250);
  assert.equal(t.weeklyDue * 4 >= t.total, true);
});

test('pure: calcIncomeTax brackets', () => {
  assert.equal(m10.calcIncomeTax(0), 0);
  assert.equal(m10.calcIncomeTax(999999), 0);
  assert.equal(m10.calcIncomeTax(1000000), 0);
  assert.equal(m10.calcIncomeTax(2000000), 75000);       // 7.5% of 1M
  assert.equal(m10.calcIncomeTax(10000000), 675000);     // 7.5% of 9M
  assert.equal(m10.calcIncomeTax(12000000), 825000);     // 7.5% of 11M
});

test('pure: weekIndex / avgRating / lagosDayStartMs', () => {
  assert.equal(m10.weekIndex(1), 0);
  assert.equal(m10.weekIndex(7), 0);
  assert.equal(m10.weekIndex(8), 1);
  assert.equal(m10.avgRating(9, 2), 4.5);
  assert.equal(m10.avgRating(0, 0), 0);
  const start = m10.lagosDayStartMs(Date.now());
  assert.equal(start <= Date.now(), true);
  assert.equal((Date.now() - start) < 24 * 3600 * 1000, true);
});

// ---------------- shops ----------------
test('shop_create: happy path charges fee + ledger row', async () => {
  const { user, character } = await seedUser(100000);
  const { api, sent } = fakeApi(user, character);
  await m10.INTENTS.shop_create(api, { type: 'food_spot', name: 'Mama Test Kitchen', locationId: 'ogba_market' });
  assert.equal(errs(sent).length, 0, JSON.stringify(errs(sent)));
  assert.equal(character.money, 100000 - m10.SHOP_CREATE_FEE);
  const shop = await m10.getShopByOwner(user.id);
  assert.ok(shop);
  assert.equal(shop.type, 'food_spot');
  assert.equal(shop.name, 'Mama Test Kitchen');
  const rows = await txns(user.id);
  const fee = rows.find(r => r.kind === 'shop_fee');
  assert.ok(fee && fee.amount === -m10.SHOP_CREATE_FEE);
});

test('shop_create: rejects bad type, bad location, second shop, poor player', async () => {
  const { user, character } = await seedUser(100000);
  let f = fakeApi(user, character);
  await m10.INTENTS.shop_create(f.api, { type: 'nope', name: 'X', locationId: 'ogba_market' });
  assert.match(errs(f.sent)[0], /valid shop type/);
  f = fakeApi(user, character);
  await m10.INTENTS.shop_create(f.api, { type: 'salon', name: 'X', locationId: 'nowhere' });
  assert.match(errs(f.sent)[0], /real location/);
  // profanity is filtered, not rejected
  f = fakeApi(user, character);
  await m10.INTENTS.shop_create(f.api, { type: 'salon', name: 'shit Show Salon', locationId: 'ogba_market' });
  assert.equal(errs(f.sent).length, 0);
  const shop = await m10.getShopByOwner(user.id);
  assert.ok(!/shit/i.test(shop.name));
  // second shop rejected
  f = fakeApi(user, character);
  await m10.INTENTS.shop_create(f.api, { type: 'salon', name: 'Second', locationId: 'ogba_market' });
  assert.match(errs(f.sent)[0], /already run a shop/);
  // poor player
  const poor = await seedUser(100);
  f = fakeApi(poor.user, poor.character);
  await m10.INTENTS.shop_create(f.api, { type: 'salon', name: 'Broke', locationId: 'ogba_market' });
  assert.match(errs(f.sent)[0], /need/);
});

test('shop_stock: owner-only, bounds, 20-item cap, restock merges', async () => {
  const { user, character } = await seedUser();
  let f = fakeApi(user, character);
  await m10.INTENTS.shop_create(f.api, { type: 'provisions', name: 'Stock Shop', locationId: 'ogba_market' });
  f = fakeApi(user, character);
  await m10.INTENTS.shop_stock(f.api, { name: 'Gala', price: 200, qty: 50 });
  assert.equal(errs(f.sent).length, 0, JSON.stringify(errs(f.sent)));
  // non-owner cannot stock
  const other = await seedUser();
  const g = fakeApi(other.user, other.character);
  await m10.INTENTS.shop_stock(g.api, { name: 'Sneaky', price: 10, qty: 1 });
  assert.match(errs(g.sent)[0], /Open a shop first/);
  // bounds (fresh api handle per check — sent[] accumulates)
  let b = fakeApi(user, character);
  await m10.INTENTS.shop_stock(b.api, { name: 'X', price: 0, qty: 5 });
  assert.match(errs(b.sent)[0], /Price/);
  b = fakeApi(user, character);
  await m10.INTENTS.shop_stock(b.api, { name: 'X', price: 10, qty: 1000 });
  assert.match(errs(b.sent)[0], /Quantity/);
  // restock same name merges
  f = fakeApi(user, character);
  await m10.INTENTS.shop_stock(f.api, { name: 'gala', price: 250, qty: 10 });
  const shop = await m10.getShopByOwner(user.id);
  const items = await m10.listItems(shop.id);
  assert.equal(items.length, 1);
  assert.equal(Number(items[0].stock), 60);
  assert.equal(Number(items[0].price), 250);
  // 20-item cap
  for (let i = 0; i < 19; i++) {
    const h = fakeApi(user, character);
    await m10.INTENTS.shop_stock(h.api, { name: 'Item' + i, price: 100, qty: 1 });
    assert.equal(errs(h.sent).length, 0);
  }
  f = fakeApi(user, character);
  await m10.INTENTS.shop_stock(f.api, { name: 'Overflow', price: 100, qty: 1 });
  assert.match(errs(f.sent)[0], /shelves are full/);
});

test('shop_buy: money conservation, two ledger rows, sold-out deletes item', async () => {
  const owner = await seedUser();
  let f = fakeApi(owner.user, owner.character);
  await m10.INTENTS.shop_create(f.api, { type: 'food_spot', name: 'Buy Shop', locationId: 'ogba_market' });
  f = fakeApi(owner.user, owner.character);
  await m10.INTENTS.shop_stock(f.api, { name: 'Jollof', price: 2500, qty: 3 });
  const shop = await m10.getShopByOwner(owner.user.id);
  const item = (await m10.listItems(shop.id))[0];

  const buyer = await seedUser(20000);
  const ownerBefore = owner.character.money;
  const g = fakeApi(buyer.user, buyer.character);
  await m10.INTENTS.shop_buy(g.api, { shopId: shop.id, itemId: item.id, qty: 2 });
  assert.equal(errs(g.sent).length, 0, JSON.stringify(errs(g.sent)));
  assert.equal(buyer.character.money, 20000 - 5000);
  // owner credited in DB (+5000)
  const ownerChar = await db.getCharacter(owner.user.id);
  assert.equal(Number(ownerChar.money), ownerBefore + 5000);
  // two ledger rows: buyer shop_sale (-), owner shop_earn (+)
  const buyerTx = (await txns(buyer.user.id)).find(r => r.kind === 'shop_sale');
  const ownerTx = (await txns(owner.user.id)).find(r => r.kind === 'shop_earn');
  assert.ok(buyerTx && buyerTx.amount === -5000, 'buyer ledger row');
  assert.ok(ownerTx && ownerTx.amount === 5000, 'owner ledger row');
  // stock decremented
  assert.equal(Number((await m10.getItem(item.id)).stock), 1);
  // owner queued for session refresh
  assert.deepEqual(m10.takePendingOwnerRefresh(), [owner.user.id]);

  // buy the last one → sold-out deletes the row
  const g2 = fakeApi(buyer.user, buyer.character);
  await m10.INTENTS.shop_buy(g2.api, { shopId: shop.id, itemId: item.id, qty: 1 });
  assert.equal(errs(g2.sent).length, 0, JSON.stringify(errs(g2.sent)));
  assert.equal(await m10.getItem(item.id), null);
});

test('shop_buy: rejects self-buy, low stock, insufficient funds', async () => {
  const owner = await seedUser();
  let f = fakeApi(owner.user, owner.character);
  await m10.INTENTS.shop_create(f.api, { type: 'fashion', name: 'Self Shop', locationId: 'ogba_market' });
  f = fakeApi(owner.user, owner.character);
  await m10.INTENTS.shop_stock(f.api, { name: 'Cap', price: 5000, qty: 1 });
  const shop = await m10.getShopByOwner(owner.user.id);
  const item = (await m10.listItems(shop.id))[0];
  // self-buy
  f = fakeApi(owner.user, owner.character);
  await m10.INTENTS.shop_buy(f.api, { shopId: shop.id, itemId: item.id, qty: 1 });
  assert.match(errs(f.sent)[0], /own shop/);
  // low stock
  const buyer = await seedUser(100000);
  let g = fakeApi(buyer.user, buyer.character);
  await m10.INTENTS.shop_buy(g.api, { shopId: shop.id, itemId: item.id, qty: 5 });
  assert.match(errs(g.sent)[0], /left/);
  // insufficient funds
  const broke = await seedUser(100);
  g = fakeApi(broke.user, broke.character);
  await m10.INTENTS.shop_buy(g.api, { shopId: shop.id, itemId: item.id, qty: 1 });
  assert.match(errs(g.sent)[0], /need/);
  // unknown shop
  g = fakeApi(buyer.user, buyer.character);
  await m10.INTENTS.shop_buy(g.api, { shopId: 999999, itemId: item.id, qty: 1 });
  assert.match(errs(g.sent)[0], /Shop not found/);
});

test('shop_rate: one rating per rater, avg math, bounds', async () => {
  const owner = await seedUser();
  let f = fakeApi(owner.user, owner.character);
  await m10.INTENTS.shop_create(f.api, { type: 'pharmacy', name: 'Rate Shop', locationId: 'ogba_market' });
  const shop = await m10.getShopByOwner(owner.user.id);
  const r1 = await seedUser(), r2 = await seedUser();
  let g = fakeApi(r1.user, r1.character);
  await m10.INTENTS.shop_rate(g.api, { shopId: shop.id, stars: 5 });
  g = fakeApi(r2.user, r2.character);
  await m10.INTENTS.shop_rate(g.api, { shopId: shop.id, stars: 3 });
  let s = await m10.getShop(shop.id);
  assert.equal(Number(s.rating_count), 2);
  assert.equal(m10.avgRating(s.rating_sum, s.rating_count), 4);
  // rater 1 changes mind → still one rating
  g = fakeApi(r1.user, r1.character);
  await m10.INTENTS.shop_rate(g.api, { shopId: shop.id, stars: 1 });
  s = await m10.getShop(shop.id);
  assert.equal(Number(s.rating_count), 2);
  assert.equal(m10.avgRating(s.rating_sum, s.rating_count), 2);
  // bounds
  g = fakeApi(r2.user, r2.character);
  await m10.INTENTS.shop_rate(g.api, { shopId: shop.id, stars: 6 });
  assert.match(errs(g.sent)[0], /1–5/);
});

test('shop_browse / shop_mine intents return enriched payloads', async () => {
  const owner = await seedUser();
  let f = fakeApi(owner.user, owner.character);
  await m10.INTENTS.shop_create(f.api, { type: 'dispatch', name: 'Browse Shop', locationId: 'ogba_market' });
  f = fakeApi(owner.user, owner.character);
  await m10.INTENTS.shop_stock(f.api, { name: 'Parcel', price: 1500, qty: 4 });
  const shop = await m10.getShopByOwner(owner.user.id);

  const viewer = await seedUser();
  const g = fakeApi(viewer.user, viewer.character);
  await m10.INTENTS.shop_browse(g.api, {});
  const browseMsg = g.sent.find(m => m.t === 'shops');
  assert.ok(browseMsg && browseMsg.shops.length >= 1);
  const row = browseMsg.shops.find(s => s.id === Number(shop.id));
  assert.ok(row);
  assert.equal(row.items, 1);
  assert.equal(row.from_price, 1500);
  assert.equal(row.rating, 0);

  const h = fakeApi(owner.user, owner.character);
  await m10.INTENTS.shop_mine(h.api, {});
  const mineMsg = h.sent.find(m => m.t === 'shop_mine');
  assert.ok(mineMsg && mineMsg.shop);
  assert.equal(mineMsg.items.length, 1);
  assert.equal(mineMsg.todayEarnings, 0);

  const h2 = fakeApi(viewer.user, viewer.character);
  await m10.INTENTS.shop_mine(h2.api, {});
  assert.equal(h2.sent.find(m => m.t === 'shop_mine').shop, null);
});

// ---------------- rent-to-own ----------------
test('buy_rental: buys current tier, sets flag, ledger row, stops rent (MODIFY contract)', async () => {
  const { user, character } = await seedUser(10_000_000);
  character.housing = 'face_me';
  await db.saveCharacter(character);
  const { api, sent } = fakeApi(user, character);
  await m10.INTENTS.buy_rental(api, {});
  assert.equal(errs(sent).length, 0, JSON.stringify(errs(sent)));
  assert.equal(character.money, 10_000_000 - m10.HOUSING_BUY.face_me);
  assert.equal(Number(character.housing_owned), 1);
  const rows = await txns(user.id);
  const buy = rows.find(r => r.kind === 'buy_rental');
  assert.ok(buy && buy.amount === -m10.HOUSING_BUY.face_me);
  // flag persists in the DB (via the module's direct UPDATE until the
  // coordinator adds the column to saveCharacter)
  const fresh = await db.getCharacter(user.id);
  assert.equal(Number(fresh.housing_owned), 1);
  // MODIFY contract: the day-tick rent settlement skips owned housing —
  // mirror the coordinator's spec here (ownsHousing gate).
  const { chargeRent } = await import('../src/game/sim.js');
  const { HOUSING } = await import('../src/game/data.js');
  const simChar = { ...fresh, money: 999999 };
  const res = m10.ownsHousing(simChar) ? { outcome: 'owned', rent: 0 } : chargeRent(simChar, HOUSING);
  assert.equal(res.outcome, 'owned');
  assert.equal(simChar.money, 999999); // no rent deducted
  // double-buy rejected
  const f2 = fakeApi(user, character);
  await m10.INTENTS.buy_rental(f2.api, {});
  assert.match(errs(f2.sent)[0], /already own/);
});

test('buy_rental: rejects when broke, not at housing office, bridge housing', async () => {
  const poor = await seedUser(100);
  poor.character.housing = 'face_me';
  let f = fakeApi(poor.user, poor.character);
  await m10.INTENTS.buy_rental(f.api, {});
  assert.match(errs(f.sent)[0], /need/);
  const away = await seedUser(10_000_000);
  away.character.housing = 'face_me';
  away.character.location_id = 'lekki_beach';
  f = fakeApi(away.user, away.character);
  await m10.INTENTS.buy_rental(f.api, {});
  assert.match(errs(f.sent)[0], /Housing Office/);
  const bridge = await seedUser(10_000_000);
  bridge.character.housing = 'bridge';
  f = fakeApi(bridge.user, bridge.character);
  await m10.INTENTS.buy_rental(f.api, {});
  assert.match(errs(f.sent)[0], /not for sale/);
});

// ---------------- LAPO loans ----------------
test('lapo_borrow: instant cash, terms, one-at-a-time, bounds', async () => {
  const { user, character } = await seedUser(1000);
  const { api, sent } = fakeApi(user, character, 10);
  await m10.INTENTS.lapo_borrow(api, { amount: 100000 });
  assert.equal(errs(sent).length, 0, JSON.stringify(errs(sent)));
  assert.equal(character.money, 101000);
  const loan = await m10.getLapoLoan(user.id);
  assert.ok(loan);
  assert.equal(Number(loan.principal), 100000);
  assert.equal(Number(loan.balance), 105000);
  assert.equal(Number(loan.weekly_due), 26250);
  assert.equal(Number(loan.weeks_left), 4);
  assert.equal(Number(loan.start_day), 10);
  const rows = await txns(user.id);
  const b = rows.find(r => r.kind === 'lapo_borrow');
  assert.ok(b && b.amount === 100000);
  // second loan rejected
  const f = fakeApi(user, character, 10);
  await m10.INTENTS.lapo_borrow(f.api, { amount: 50000 });
  assert.match(errs(f.sent)[0], /already have/);
  // bounds
  const u2 = await seedUser();
  const g = fakeApi(u2.user, u2.character);
  await m10.INTENTS.lapo_borrow(g.api, { amount: 10000 });
  assert.match(errs(g.sent)[0], /LAPO loans/);
  await m10.INTENTS.lapo_borrow(g.api, { amount: 999999999 });
  assert.match(errs(g.sent)[0], /LAPO loans/);
});

test('lapo_repay / lapo_repay_all: manual payments + ledger', async () => {
  const { user, character } = await seedUser(200000);
  let f = fakeApi(user, character, 10);
  await m10.INTENTS.lapo_borrow(f.api, { amount: 100000 });
  f = fakeApi(user, character, 10);
  await m10.INTENTS.lapo_repay(f.api, { amount: 30000 });
  assert.equal(errs(f.sent).length, 0, JSON.stringify(errs(f.sent)));
  let loan = await m10.getLapoLoan(user.id);
  assert.equal(Number(loan.balance), 75000);
  assert.equal(character.money, 200000 + 100000 - 30000);
  let rows = await txns(user.id);
  assert.ok(rows.find(r => r.kind === 'lapo_repay' && r.amount === -30000));
  // repay_all clears the row
  f = fakeApi(user, character, 10);
  await m10.INTENTS.lapo_repay_all(f.api, {});
  assert.equal(errs(f.sent).length, 0, JSON.stringify(errs(f.sent)));
  assert.equal(await m10.getLapoLoan(user.id), null);
  // no loan → err
  f = fakeApi(user, character, 10);
  await m10.INTENTS.lapo_repay(f.api, { amount: 100 });
  assert.match(errs(f.sent)[0], /no LAPO loan/);
  // invalid amount
  const u2 = await seedUser(500000);
  let g = fakeApi(u2.user, u2.character, 10);
  await m10.INTENTS.lapo_borrow(g.api, { amount: 50000 });
  g = fakeApi(u2.user, u2.character, 10);
  await m10.INTENTS.lapo_repay(g.api, { amount: -5 });
  assert.match(errs(g.sent)[0], /valid amount/);
});

test('lapo auto-debit: weekly debit on day 7, ledger lapo_auto, weeks_left ticks', async () => {
  const { user, character } = await seedUser(100000);
  const f = fakeApi(user, character, 1);
  await m10.INTENTS.lapo_borrow(f.api, { amount: 100000 }); // start_day=1
  // day 5: no debit yet
  const g = fakeApi(user, character, 5);
  const ctx = { send: g.api.send, youSnapshot: g.api.youSnapshot, getDay: () => ({ day: 5, endsIn: 0 }) };
  let r = await m10.settleOnlinePlayer(ctx, g.api.conn);
  assert.equal(r.dirty, false);
  assert.equal(Number((await m10.getLapoLoan(user.id)).debits_done), 0);
  // day 8: first weekly debit (7 days after start_day=1)
  const h = fakeApi(user, character, 8);
  const ctx8 = { send: h.api.send, youSnapshot: h.api.youSnapshot, getDay: () => ({ day: 8, endsIn: 0 }) };
  r = await m10.settleOnlinePlayer(ctx8, h.api.conn);
  assert.equal(r.dirty, true);
  assert.equal(character.money, 100000 + 100000 - 26250);
  const loan = await m10.getLapoLoan(user.id);
  assert.equal(Number(loan.balance), 105000 - 26250);
  assert.equal(Number(loan.weeks_left), 3);
  assert.equal(Number(loan.debits_done), 1);
  const rows = await txns(user.id);
  assert.ok(rows.find(x => x.kind === 'lapo_auto' && x.amount === -26250));
  assert.ok(h.sent.find(m => m.t === 'sys' && /auto-debit/.test(m.text)));
});

test('lapo auto-debit: broke player → partial debit, weeks_left stays', async () => {
  const { user, character } = await seedUser(0);
  const f = fakeApi(user, character, 1);
  await m10.INTENTS.lapo_borrow(f.api, { amount: 100000 });
  character.money = 10000; // spent almost everything
  const g = fakeApi(user, character, 8);
  const ctx = { send: g.api.send, youSnapshot: g.api.youSnapshot, getDay: () => ({ day: 8, endsIn: 0 }) };
  const r = await m10.settleOnlinePlayer(ctx, g.api.conn);
  assert.equal(r.dirty, true);
  assert.equal(character.money, 0); // debit what's available
  const loan = await m10.getLapoLoan(user.id);
  assert.equal(Number(loan.balance), 105000 - 10000);
  assert.equal(Number(loan.weeks_left), 4); // stays — not a full payment
  assert.ok(g.sent.find(m => m.t === 'sys' && /partial/.test(m.text)));
});

test('lapo auto-debit: final debit closes the loan', async () => {
  const { user, character } = await seedUser(1000000);
  const f = fakeApi(user, character, 1);
  await m10.INTENTS.lapo_borrow(f.api, { amount: 50000 }); // total 52500, due 13125
  // jump to the 4th debit week (day 29)
  const g = fakeApi(user, character, 29);
  await m10.updateLapoLoan((await m10.getLapoLoan(user.id)).id, { balance: 13125, weeks_left: 1, debits_done: 3 });
  const ctx = { send: g.api.send, youSnapshot: g.api.youSnapshot, getDay: () => ({ day: 29, endsIn: 0 }) };
  const r = await m10.settleOnlinePlayer(ctx, g.api.conn);
  assert.equal(r.dirty, true);
  assert.equal(await m10.getLapoLoan(user.id), null);
  assert.ok(g.sent.find(m => m.t === 'sys' && /cleared/.test(m.text)));
});

test('lapo offline sweep skips online players', async () => {
  const off = await seedUser(50000);
  const f = fakeApi(off.user, off.character, 1);
  await m10.INTENTS.lapo_borrow(f.api, { amount: 50000 });
  const on = await seedUser(50000);
  const g = fakeApi(on.user, on.character, 1);
  await m10.INTENTS.lapo_borrow(g.api, { amount: 50000 });
  const ctx = { getDay: () => ({ day: 8, endsIn: 0 }) };
  await m10.settleOfflinePlayers(ctx, (id) => id === on.user.id);
  const offLoan = await m10.getLapoLoan(off.user.id);
  const onLoan = await m10.getLapoLoan(on.user.id);
  assert.equal(Number(offLoan.debits_done), 1); // debited
  assert.equal(Number(onLoan.debits_done), 0);   // skipped (online)
  const offChar = await db.getCharacter(off.user.id);
  assert.equal(Number(offChar.money), 50000 + 50000 - 13125);
});

// ---------------- tax ----------------
test('tax: weekly boundary charges flat bill (online)', async () => {
  const { user, character } = await seedUser(5_000_000);
  // window start FIRST, then earnings land inside the closed week
  await db.setMeta('tax_week', '0');
  await db.setMeta('tax_week_start', String(Date.now() - 60000));
  await db.addTransaction(user.id, 'work_pay', 2000000, character.money, {});
  const f = fakeApi(user, character, 8); // day 8 → week 1, boundary crossed
  const ctx = { send: f.api.send, youSnapshot: f.api.youSnapshot, getDay: () => ({ day: 8, endsIn: 0 }) };
  const r = await m10.settleOnlinePlayer(ctx, f.api.conn);
  assert.equal(r.dirty, true);
  assert.equal(character.money, 5_000_000 - 75000); // 7.5% of (2M-1M)
  const rows = await txns(user.id);
  const t = rows.find(x => x.kind === 'income_tax');
  assert.ok(t && t.amount === -75000, JSON.stringify(rows.map(x => x.kind)));
  assert.ok(f.sent.find(m => m.t === 'sys' && /income tax/.test(m.text)));
  // tax_week advanced; a second settle in the same week charges nothing
  const g = fakeApi(user, character, 9);
  const ctx2 = { send: g.api.send, youSnapshot: g.api.youSnapshot, getDay: () => ({ day: 9, endsIn: 0 }) };
  const r2 = await m10.settleOnlinePlayer(ctx2, g.api.conn);
  assert.equal(r2.dirty, false);
});

test('tax: free allowance (≤₦1M) → no debit; tax_mult=0 → holiday', async () => {
  const { user, character } = await seedUser(5_000_000);
  await db.setMeta('tax_week', '4');
  await db.setMeta('tax_week_start', String(Date.now() - 60000));
  await db.addTransaction(user.id, 'work_pay', 500000, character.money, {});
  const f = fakeApi(user, character, 36); // week 5
  const ctx = { send: f.api.send, youSnapshot: f.api.youSnapshot, getDay: () => ({ day: 36, endsIn: 0 }) };
  const r = await m10.settleOnlinePlayer(ctx, f.api.conn);
  assert.equal(r.dirty, false);
  assert.equal(character.money, 5_000_000);

  const u2 = await seedUser(5_000_000);
  await db.setMeta('tax_mult', '0'); // governor tax holiday (M11)
  await db.setMeta('tax_week', '4');
  await db.setMeta('tax_week_start', String(Date.now() - 60000));
  await db.addTransaction(u2.user.id, 'work_pay', 3000000, u2.character.money, {});
  const g = fakeApi(u2.user, u2.character, 36);
  const ctx2 = { send: g.api.send, youSnapshot: g.api.youSnapshot, getDay: () => ({ day: 36, endsIn: 0 }) };
  const r2 = await m10.settleOnlinePlayer(ctx2, g.api.conn);
  assert.equal(r2.dirty, false);
  assert.equal(u2.character.money, 5_000_000);
  await db.setMeta('tax_mult', '1');
});

test('tax: flat 7.5% above ₦1M; non-earning kinds excluded', async () => {
  const { user, character } = await seedUser(50_000_000);
  await db.setMeta('tax_week', '9');
  await db.setMeta('tax_week_start', String(Date.now() - 60000));
  await db.addTransaction(user.id, 'work_pay', 12000000, character.money, {});
  await db.addTransaction(user.id, 'lapo_borrow', 500000, character.money, {}); // NOT earnings
  await db.addTransaction(user.id, 'loan', 100000, character.money, {});       // NOT earnings
  const f = fakeApi(user, character, 71); // week 10
  const ctx = { send: f.api.send, youSnapshot: f.api.youSnapshot, getDay: () => ({ day: 71, endsIn: 0 }) };
  await m10.settleOnlinePlayer(ctx, f.api.conn);
  // bill on 12M only: 7.5% of 11M = 825k
  assert.equal(character.money, 50_000_000 - 825000);
});

test('tax: offline players are taxed in the sweep', async () => {
  const { user } = await seedUser(5_000_000);
  await db.setMeta('tax_week', '2');
  await db.setMeta('tax_week_start', String(Date.now() - 60000));
  await db.addTransaction(user.id, 'biz_income', 2000000, 5000000, {});
  const ctx = { getDay: () => ({ day: 22, endsIn: 0 }) }; // week 3
  await m10.settleOfflinePlayers(ctx, () => false);
  const c = await db.getCharacter(user.id);
  assert.equal(Number(c.money), 5_000_000 - 75000);
});

// ---------------- REST handlers ----------------
test('REST_SPEC handlers: shops browse + tax shape', async () => {
  const mkRes = () => {
    const res = {};
    res.statusCode = 200;
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  };
  const shopsSpec = m10.REST_SPEC.find(s => s.path === '/api/v2/m10/shops');
  const res = mkRes();
  await shopsSpec.handler({ query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.shops));

  const { user } = await seedUser(100000);
  const taxSpec = m10.REST_SPEC.find(s => s.path === '/api/v2/m10/tax');
  const res2 = mkRes();
  await db.setMeta('tax_week_start', String(Date.now() - 60000));
  await db.addTransaction(user.id, 'work_pay', 1500000, 100000, {});
  await taxSpec.handler({ userId: user.id }, res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.weekEarnings, 1500000);
  assert.equal(res2.body.bill, 37500); // 7.5% of 500k
  assert.equal(res2.body.holiday, false);

  const lapoSpec = m10.REST_SPEC.find(s => s.path === '/api/v2/m10/lapo');
  const res3 = mkRes();
  await lapoSpec.handler({ userId: user.id }, res3);
  assert.equal(res3.body.loan, null);
  assert.equal(res3.body.terms.min, m10.LAPO_MIN);
});

test('REST_SPEC: public shop items shelf', async () => {
  const mkRes = () => {
    const res = {};
    res.statusCode = 200;
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  };
  const { user, character } = await seedUser();
  const f = fakeApi(user, character);
  await m10.INTENTS.shop_create(f.api, { type: 'food_spot', name: 'Shelf Shop', locationId: 'ogba_market' });
  const g = fakeApi(user, character);
  await m10.INTENTS.shop_stock(g.api, { name: 'Puff Puff', price: 500, qty: 12 });
  const shop = await m10.getShopByOwner(user.id);
  const spec = m10.REST_SPEC.find(s => s.path === '/api/v2/m10/shops/:id/items');
  assert.ok(spec, 'items endpoint registered');
  const res = mkRes();
  await spec.handler({ params: { id: String(shop.id) } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].name, 'Puff Puff');
  assert.equal(res.body.items[0].stock, 12);
  const res404 = mkRes();
  await spec.handler({ params: { id: '999999' } }, res404);
  assert.equal(res404.statusCode, 404);
});
