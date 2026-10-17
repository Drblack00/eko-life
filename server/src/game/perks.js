// ============================================================
// game/perks.js — P1: the perk query surface other phases use.
//
// m9 owns the 14-perk roster, star currency and purchases. This
// module exposes ONE normalized view — getPerkEffects(character) —
// so careers, buy mode, social, crime and any other phase can ask
// "what do this player's perks do?" without importing m9 internals.
//
// EXTENDED EFFECT CONTRACT (additive to the M8↔M9 contract):
//   {type:'social_success', pct}  — social-phase success rolls × (1+pct/100)
//   {type:'romance_success', pct} — romance/flirt rolls × (1+pct/100)
//   {type:'jail_shorten', pct}     — jail sentences × (1-pct/100)
//   {type:'mood_extend', pct}      — good-mood durations × (1+pct/100)
//   {type:'sleep_boost', pct}      — sleep energy restore × (1+pct/100)
// Unknown / malformed effects are ignored defensively (same rule as m8).
// No perk in the current roster grants the extended types yet — they
// read 0 here — but the surface is stable for phases that need them.
// ============================================================
import {
  activePerkEffects,
  workPayMultiplier,
  discountMultiplier,
  xpBoostMultiplier,
  decayMultiplier,
} from './v2/m9.js';

const NEEDS = ['hunger', 'energy', 'fun', 'social', 'hygiene', 'bladder'];

function sumPct(effects, type) {
  let total = 0;
  for (const e of effects || []) {
    if (e && e.type === type) {
      const pct = Number(e.pct);
      if (Number.isFinite(pct) && pct > 0) total += pct;
    }
  }
  return total;
}

/**
 * Normalized perk effects for one character.
 * character.perks may be a JSON string or an array of perk ids
 * (m9's ownedPerks handles both shapes).
 */
export function getPerkEffects(character) {
  const effects = activePerkEffects(character || {});
  const decaySlow = {};
  for (const need of NEEDS) decaySlow[need] = decayMultiplier(need, effects);
  return {
    owned: effects.map(e => e.id).filter(Boolean),
    // per-need decay multipliers (1 = normal, 0.75 = 25% slower)
    decaySlow,
    // economy multipliers
    workPayMult: workPayMultiplier(character),
    buyDiscountMult: discountMultiplier(character),
    skillXpMult: xpBoostMultiplier(character),
    // extended contract (percent bonuses, 0 when ungranted)
    socialSuccessPct: sumPct(effects, 'social_success'),
    romanceSuccessPct: sumPct(effects, 'romance_success'),
    jailShortenPct: sumPct(effects, 'jail_shorten'),
    moodExtendPct: sumPct(effects, 'mood_extend'),
    sleepBoostPct: sumPct(effects, 'sleep_boost'),
    // raw owned effect objects for phases with custom math
    raw: effects,
  };
}

// Convenience predicates for phases that only need one answer.
export function decayMultiplierFor(character, need) {
  return getPerkEffects(character).decaySlow[need] ?? 1;
}
