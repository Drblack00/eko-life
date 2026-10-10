// sim.js unit tests — pure functions, no server, no DB.
import test from 'node:test';
import assert from 'node:assert/strict';

const { clamp, decayTick, chargeRent, applyDayEconomy, furnitureEffects, distUnits, DECAY_RATES } = await import('../src/game/sim.js');
const { HOUSING, FURN_EFFECTS, DEFAULT_CHARACTER } = await import('../src/game/data.js');

function freshChar() {
  return { hunger: 100, energy: 100, happiness: 100, health: 100, money: 0, housing: 'face_me', rent_misses: 0 };
}

test('decayTick (M8): decays six needs at their rates', () => {
  const c = { hunger: 100, energy: 100, fun: 100, social: 100, hygiene: 100, bladder: 100, happiness: 100, health: 100 };
  const res = decayTick(c);
  assert.equal(c.hunger, 100 - DECAY_RATES.hunger);
  assert.equal(c.energy, 100 - DECAY_RATES.energy);
  assert.equal(c.fun, 100 - DECAY_RATES.fun);
  assert.equal(c.social, 100 - DECAY_RATES.social);
  assert.equal(c.hygiene, 100 - DECAY_RATES.hygiene);
  assert.equal(c.bladder, 100 - DECAY_RATES.bladder);
  assert.equal(res.starving, false);
  assert.equal(res.desperate, false);
  // stats untouched while needs are healthy
  assert.equal(c.energy, 100 - DECAY_RATES.energy);
});

test('decayTick (M8): starving (hunger 0) drains energy/happiness/health', () => {
  const c = { hunger: DECAY_RATES.hunger, energy: 100, happiness: 100, health: 100, fun: 100, social: 100, hygiene: 100, bladder: 100 };
  const res = decayTick(c);
  assert.equal(c.hunger, 0);
  assert.equal(res.starving, true);
  assert.equal(c.energy, 100 - DECAY_RATES.energy - 5); // decay + starving drain
  assert.equal(c.happiness, 100 - 5);
  assert.equal(c.health, 100 - 2);
});

test('decayTick (M8): starving clamps; hunger never negative', () => {
  const c = { hunger: 1, energy: 2, happiness: 3, health: 1, fun: 100, social: 100, hygiene: 100, bladder: 100 };
  decayTick(c);
  assert.equal(c.hunger, 0);
  assert.equal(c.energy, 0);
  assert.equal(c.happiness, 0);
  assert.equal(c.health, 0);
  decayTick(c); // another tick while starving stays at 0
  assert.equal(c.energy, 0);
});

test('chargeRent: paid when affordable, misses reset', () => {
  const c = freshChar();
  c.money = 6000; c.rent_misses = 2; c.housing = 'face_me'; // rent 5000
  const res = chargeRent(c, HOUSING);
  assert.equal(res.outcome, 'paid');
  assert.equal(res.rent, 5000);
  assert.equal(c.money, 1000);
  assert.equal(c.rent_misses, 0);
});

test('chargeRent: missed rent increments counter, money untouched', () => {
  const c = freshChar();
  c.money = 100;
  const r1 = chargeRent(c, HOUSING);
  assert.equal(r1.outcome, 'missed');
  assert.equal(c.rent_misses, 1);
  assert.equal(c.money, 100); // never deducted when unaffordable
  const r2 = chargeRent(c, HOUSING);
  assert.equal(r2.outcome, 'missed');
  assert.equal(c.rent_misses, 2);
});

test('chargeRent: 3 missed rents → evicted to bridge, happiness −20', () => {
  const c = freshChar();
  c.money = 0; c.happiness = 80;
  chargeRent(c, HOUSING);
  chargeRent(c, HOUSING);
  const r3 = chargeRent(c, HOUSING);
  assert.equal(r3.outcome, 'evicted');
  assert.equal(c.housing, 'bridge');
  assert.equal(c.rent_misses, 0);
  assert.equal(c.happiness, 60);
  // bridge has no rent — subsequent ticks are 'paid'
  const r4 = chargeRent(c, HOUSING);
  assert.equal(r4.outcome, 'paid');
  assert.equal(r4.rent, 0);
});

test('chargeRent: unknown housing falls back to face_me rent', () => {
  const c = freshChar();
  c.money = 5000; c.housing = 'nonsense';
  const res = chargeRent(c, HOUSING);
  assert.equal(res.outcome, 'paid');
  assert.equal(res.rent, 5000);
});

test('chargeRent: money never goes negative', () => {
  const c = freshChar();
  c.money = 0; c.housing = 'duplex'; // rent 60000, can't afford
  for (let i = 0; i < 10; i++) chargeRent(c, HOUSING);
  assert.ok(c.money >= 0);
});

test('applyDayEconomy: business income lands on money', () => {
  const c = freshChar();
  c.money = 1000;
  const res = applyDayEconomy(c, { bizDef: { income: 4000 } });
  assert.equal(res.income, 4000);
  assert.equal(c.money, 5000);
  assert.ok(res.dirty);
});

test('applyDayEconomy: savings +2%/day (floored), loan +10%/day (ceiled)', () => {
  const c = freshChar();
  c.savings = 10000; c.loan = 10000;
  const res = applyDayEconomy(c, {});
  assert.equal(res.savingsInterest, 200);
  assert.equal(res.loanInterest, 1000);
  assert.equal(c.savings, 10200);
  assert.equal(c.loan, 11000);
  // zero balances → inert, no dirty flag
  const c2 = freshChar();
  const r2 = applyDayEconomy(c2, {});
  assert.equal(r2.dirty, false);
  assert.equal(r2.income, 0);
});

test('applyDayEconomy: property + generator happiness', () => {
  const c = freshChar();
  c.happiness = 50;
  const res = applyDayEconomy(c, { propDef: { happy: 10 }, placed: ['gen', 'bed'] });
  assert.equal(res.happyGain, 15);
  assert.equal(c.happiness, 65);
});

test('furnitureEffects: aggregates placed-item hooks', () => {
  const e = furnitureEffects(['bed', 'fridge', 'tv', 'sofa', 'ac', 'unknown'], FURN_EFFECTS);
  assert.equal(e.sleep.health, 20);
  assert.equal(e.sleep.happiness, 10);
  assert.equal(e.eat.hunger, 15);
  assert.equal(e.fun.happiness, 18); // tv 10 + sofa 8
});

test('distUnits: map-unit euclidean distance', () => {
  assert.equal(distUnits(0, 0, 3, 4), 5);
});

test('DEFAULT_CHARACTER includes M2 persistence fields', () => {
  const c = DEFAULT_CHARACTER('street_smart', 'Testy');
  assert.ok(Number.isFinite(c.x));
  assert.ok(Number.isFinite(c.y));
  assert.equal(c.rent_misses, 0);
  assert.equal(c.customized, 0);
  assert.equal(c.starter_loan_available, 0);
});
