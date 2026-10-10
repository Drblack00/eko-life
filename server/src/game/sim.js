// ============================================================
// game/sim.js — Èkó Life simulation helpers (M2)
// PURE functions: mutate a plain character object, no DB, no I/O.
// Side effects (ledger rows, saves, broadcasts) live in
// game/actions.js and ws/hub.js. Unit-tested in tests/sim.test.js.
// ============================================================

export function clamp(n, lo, hi) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

// ---- Needs decay (runs once per 60s tick) — M8: six needs ----
// Canonical implementation lives in v2/m8.js (decayTick + DECAY_RATES +
// collectEffects + decayMultiplier). New signature: decayTick(char, mods)
// with mods = { moodlets: [], perks: [] } honoring the M8↔M9 effect contract
// (decay_slow / decay_all / stat_boost / stat_drain; malformed ignored).
// Returns { starving, desperate, grimy, lonely, bored }.
export { decayTick, DECAY_RATES } from './v2/m8.js';

// ---- Daily rent settlement (runs once per game day) ----
// Pure: deducts rent from char.money when affordable, otherwise tracks
// misses on char.rent_misses. 3 consecutive misses → evicted to 'bridge'
// housing, happiness −20, misses reset. Returns the outcome; callers
// handle ledger rows / saves / notifications.
export function chargeRent(char, housingDefs) {
  const defs = housingDefs || {};
  const h = defs[char.housing] || defs.face_me || { rent: 0 };
  const rent = Math.max(0, Math.floor(Number(h.rent) || 0));
  char.money = Math.max(0, Math.floor(Number(char.money) || 0));

  if (rent <= 0) return { outcome: 'paid', rent: 0, misses: 0 };

  if (char.money >= rent) {
    char.money -= rent;
    char.rent_misses = 0;
    return { outcome: 'paid', rent, misses: 0 };
  }

  char.rent_misses = (Number(char.rent_misses) || 0) + 1;
  if (char.rent_misses >= 3) {
    char.housing = 'bridge';
    char.rent_misses = 0;
    char.happiness = clamp(Number(char.happiness) - 20, 0, 100);
    return { outcome: 'evicted', rent, misses: 0 };
  }
  return { outcome: 'missed', rent, misses: char.rent_misses };
}

// ---- Day economy (M3) ----
// Business income, savings interest (+2%/day, floored), loan interest
// (+10%/day, ceiled), owned-property happiness and placed-generator
// happiness. Pure: mutates a plain character object, no DB/IO.
// Returns the deltas so callers can write ledger rows / notifications.
export function applyDayEconomy(char, { bizDef = null, propDef = null, placed = [] } = {}) {
  const res = { income: 0, savingsInterest: 0, loanInterest: 0, happyGain: 0, dirty: false };

  // business income (paid to online players with a note, DB-credited to
  // offline players — the caller decides the side effects)
  if (bizDef && Number(bizDef.income) > 0) {
    res.income = Math.floor(Number(bizDef.income));
    char.money = Math.max(0, Math.floor(Number(char.money) || 0)) + res.income;
    res.dirty = true;
  }

  // savings grow 2%/day
  const savings = Math.max(0, Math.floor(Number(char.savings) || 0));
  if (savings > 0) {
    res.savingsInterest = Math.floor(savings * 0.02);
    char.savings = savings + res.savingsInterest;
    res.dirty = true;
  }

  // loans grow 10%/day — the house always collects.
  // Exception (M4): the street_smart one-time starter loan (loan_free) is 0%.
  const loan = Math.max(0, Math.floor(Number(char.loan) || 0));
  if (loan > 0 && !Number(char.loan_free)) {
    res.loanInterest = Math.ceil(loan * 0.10);
    char.loan = loan + res.loanInterest;
    res.dirty = true;
  }

  // owned property + placed generator happiness
  let happy = 0;
  if (propDef) happy += Math.max(0, Math.floor(Number(propDef.happy) || 0));
  if ((placed || []).includes('gen')) happy += 5; // Generator: "up NEPA" immunity
  if (happy > 0) {
    char.happiness = clamp(Number(char.happiness) + happy, 0, 100);
    res.happyGain = happy;
    res.dirty = true;
  }
  return res;
}

// ---- Furniture effect hooks (M3) ----
// Aggregate the placed items' per-action bonuses:
// { eat: {hunger, happiness}, fun: {happiness}, sleep: {health, happiness} }.
// Items arrive as ids (e.g. ['bed','fridge']) or {id} rows.
export function furnitureEffects(items, effectsDefs) {
  const e = {
    eat: { hunger: 0, happiness: 0 },
    fun: { happiness: 0 },
    sleep: { health: 0, happiness: 0 },
  };
  for (const raw of items || []) {
    const id = typeof raw === 'string' ? raw : raw && raw.item;
    const fx = effectsDefs && effectsDefs[id];
    if (!fx) continue;
    for (const action of Object.keys(fx)) {
      if (!e[action]) continue;
      for (const [stat, v] of Object.entries(fx[action])) {
        if (typeof e[action][stat] === 'number') e[action][stat] += Number(v) || 0;
      }
    }
  }
  return e;
}

// ---- Map distance (coords are 0–100 units, not meters) ----
export function distUnits(x1, y1, x2, y2) {
  return Math.hypot(Number(x2) - Number(x1), Number(y2) - Number(y1));
}
