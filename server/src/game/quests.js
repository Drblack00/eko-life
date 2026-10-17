// ============================================================
// game/quests.js — P1: wishes, personal goals card, daily-quest
// reward tables.
//
// Wishes: 3 active at a time, each swappable (1 free swap per Lagos
// day), completion grants ✨ gems (+2 to +4). Goals: one rotating
// personal goal at a time with game-money + rep rewards; claiming
// rotates to the next goal. All copy is original to Èkó Life.
//
// State lives in vitality_state (see game/vitality.js); progress
// checks read the transactions ledger like m9's missions do.
// ============================================================
import { dbGet } from '../db.js'; // P4 unblock: was '../../db.js' (server/db.js — doesn't exist); fixed so the app boots
import {
  countLedgerSince, sumLedgerSince, lagosDayStartMs,
  hustleRewardFor, HUSTLE_ALL_DONE_BONUS,
} from './v2/m9.js';
import { getSkills } from './v2/m12.js';
import { getVitality, saveVitality, lagosDayKey, grantGems, addRep } from './vitality.js';

// Re-exported for the web client (single source of truth lives in m9).
export { hustleRewardFor, HUSTLE_ALL_DONE_BONUS };

// ---------------- wishes ----------------
// check: async ({ userId, char, sinceMs, vitality }) => boolean
export const WISHES = [
  { id: 'wish_home', name: 'Home Sweet Home', icon: '🪑', gems: 2,
    text: 'Buy something for the house.',
    check: async (a) => (await countLedgerSince(a.userId, 'buy_furniture', a.sinceMs)) >= 1 },
  { id: 'wish_cook', name: 'Chef Mode', icon: '🍳', gems: 2,
    text: 'Cook a hot meal in your kitchen.',
    check: async (a) => (await countLedgerSince(a.userId, 'cook', a.sinceMs)) >= 1 },
  { id: 'wish_shift', name: 'Paper Chaser', icon: '💼', gems: 3,
    text: 'Finish a full work shift.',
    check: async (a) => (await countLedgerSince(a.userId, 'shift_pay', a.sinceMs)) >= 1 },
  { id: 'wish_move', name: 'Waka Waka', icon: '🚌', gems: 3,
    text: 'Travel to 2 different places today.',
    check: async (a) => (await countLedgerSince(a.userId, 'travel', a.sinceMs)) >= 2 },
  { id: 'wish_charisma', name: 'Smooth Talker', icon: '✨', gems: 4,
    text: 'Reach Charisma level 1.',
    check: async (a) => Number((getSkills(a.char).charisma || {}).level || 0) >= 1 },
  { id: 'wish_save', name: 'Aza Saver', icon: '🏦', gems: 3,
    text: 'Stash ₦5,000 in your savings.',
    check: async (a) => (await sumLedgerSince(a.userId, 'deposit', a.sinceMs)) <= -5000 },
  { id: 'wish_gem', name: 'Sharp Eyes', icon: '💎', gems: 4,
    text: "Find today's hidden gem.",
    check: async (a) => {
      const r = await dbGet(
        'SELECT 1 AS ok FROM gem_finds WHERE user_id=? AND found_at>=? LIMIT 1',
        'SELECT 1 AS ok FROM gem_finds WHERE user_id=$1 AND found_at>=$2 LIMIT 1',
        [a.userId, lagosDayStartMs()]);
      return !!(r && r.ok);
    } },
  { id: 'wish_sleep', name: 'Rest Well', icon: '😴', gems: 2,
    text: 'Take a proper sleep in your bed.',
    check: async (a) => (Number(a.vitality.sleepsDone) || 0) > (Number(a.assignedSleeps) || 0) },
];

export function wishById(id) {
  return WISHES.find(w => w.id === id) || null;
}

// Refill the active set to 3 wishes (keeps done ones until claimed).
export function refillWishes(state) {
  const active = new Set(state.wishes.map(w => w.id));
  const pool = WISHES.filter(w => !active.has(w.id));
  while (state.wishes.filter(w => !w.done).length < 3 && pool.length) {
    const w = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    state.wishes.push({ id: w.id, assignedAt: Date.now(), done: false, sleepsAtAssign: Number(state.sleepsDone) || 0 });
  }
  // drop stale done entries beyond the active 3 so the list stays fresh
  return state;
}

export async function wishProgress(userId, char) {
  const st = await getVitality(userId);
  refillWishes(st);
  await saveVitality(userId, st);
  const out = [];
  for (const w of st.wishes) {
    const def = wishById(w.id);
    if (!def) continue;
    const done = w.done || await def.check({
      userId, char, sinceMs: Number(w.assignedAt) || 0, vitality: st, assignedSleeps: w.sleepsAtAssign || 0,
    });
    out.push({ id: def.id, name: def.name, icon: def.icon, text: def.text, gems: def.gems, done: !!done, claimed: !!w.done });
  }
  return out;
}

export async function claimWish(userId, char, wishId) {
  const def = wishById(String(wishId));
  if (!def) return { error: 'Unknown wish.' };
  const st = await getVitality(userId);
  const w = st.wishes.find(x => x.id === def.id);
  if (!w) return { error: 'That wish is not active.' };
  if (w.done) return { error: 'Wish already granted.' };
  const ok = await def.check({
    userId, char, sinceMs: Number(w.assignedAt) || 0, vitality: st, assignedSleeps: w.sleepsAtAssign || 0,
  });
  if (!ok) return { error: 'Wish not fulfilled yet — check the requirement.' };
  w.done = true;
  const gems = await grantGems(userId, def.gems);
  // retire the granted wish and refill
  st.wishes = st.wishes.filter(x => x.id !== def.id);
  refillWishes(st);
  await saveVitality(userId, st);
  return { ok: true, gems: def.gems, balance: gems, name: def.name };
}

// 1 free swap per Lagos day: replace an active wish with a fresh one.
export async function swapWish(userId, wishId) {
  const st = await getVitality(userId);
  const today = lagosDayKey();
  if (st.wishSwap.day !== today) st.wishSwap = { day: today, used: 0 };
  if (st.wishSwap.used >= 1) return { error: 'Free swap used up — one per day.' };
  const idx = st.wishes.findIndex(x => x.id === String(wishId) && !x.done);
  if (idx < 0) return { error: 'That wish cannot be swapped.' };
  const active = new Set(st.wishes.map(w => w.id));
  const pool = WISHES.filter(w => !active.has(w.id));
  if (!pool.length) return { error: 'No fresh wishes left today.' };
  const next = pool[Math.floor(Math.random() * pool.length)];
  st.wishes[idx] = { id: next.id, assignedAt: Date.now(), done: false, sleepsAtAssign: Number(st.sleepsDone) || 0 };
  st.wishSwap.used += 1;
  await saveVitality(userId, st);
  return { ok: true, wish: { id: next.id, name: next.name, icon: next.icon, text: next.text, gems: next.gems }, swapsLeft: 0 };
}

// ---------------- goals card ----------------
// One rotating personal goal: claim → reward → next goal.
export const GOALS = [
  { id: 'goal_first_buy', name: 'First Touch', icon: '🛋️', text: 'Buy something new for your place.',
    money: 1000, rep: 10,
    check: async (a) => (await countLedgerSince(a.userId, 'buy_furniture', a.sinceMs)) >= 1 },
  { id: 'goal_buka', name: 'Buka Run', icon: '🍲', text: 'Eat a proper meal.',
    money: 500, rep: 8,
    check: async (a) => (await countLedgerSince(a.userId, 'food', a.sinceMs)) >= 1 },
  { id: 'goal_cook', name: 'Home Chef', icon: '👨‍🍳', text: 'Cook your first meal.',
    money: 750, rep: 10,
    check: async (a) => (await countLedgerSince(a.userId, 'cook', a.sinceMs)) >= 1 },
  { id: 'goal_traveler', name: 'City Hopper', icon: '🗺️', text: 'Travel to 2 places.',
    money: 800, rep: 10,
    check: async (a) => (await countLedgerSince(a.userId, 'travel', a.sinceMs)) >= 2 },
  { id: 'goal_saver', name: 'Rainy Day', icon: '💰', text: 'Save ₦2,000 in the bank.',
    money: 500, rep: 12,
    check: async (a) => (await sumLedgerSince(a.userId, 'deposit', a.sinceMs)) <= -2000 },
  { id: 'goal_social', name: 'Outside!', icon: '🎉', text: 'Do something fun.',
    money: 600, rep: 8,
    check: async (a) => (await countLedgerSince(a.userId, 'fun', a.sinceMs)) >= 1 },
];

export function goalById(id) {
  return GOALS.find(g => g.id === id) || null;
}

function nextGoalId(currentId) {
  if (!currentId) return GOALS[0].id;
  const i = GOALS.findIndex(g => g.id === currentId);
  return GOALS[(i + 1) % GOALS.length].id;
}

export async function currentGoal(userId, char) {
  const st = await getVitality(userId);
  if (!st.goal || !goalById(st.goal.id)) {
    st.goal = { id: nextGoalId(st.goal && st.goal.id), assignedAt: Date.now() };
    await saveVitality(userId, st);
  }
  const def = goalById(st.goal.id);
  const done = await def.check({ userId, char, sinceMs: Number(st.goal.assignedAt) || 0, vitality: st });
  return { id: def.id, name: def.name, icon: def.icon, text: def.text, money: def.money, rep: def.rep, done: !!done };
}

// Claim the goal reward (money is credited by the caller via the
// character row; rep is granted here) and rotate to the next goal.
export async function claimGoal(userId, char) {
  const st = await getVitality(userId);
  if (!st.goal || !goalById(st.goal.id)) {
    st.goal = { id: nextGoalId(null), assignedAt: Date.now() };
    await saveVitality(userId, st);
    return { error: 'No active goal — here is a fresh one.' };
  }
  const def = goalById(st.goal.id);
  const done = await def.check({ userId, char, sinceMs: Number(st.goal.assignedAt) || 0, vitality: st });
  if (!done) return { error: 'Goal not complete yet.' };
  const repRes = await addRep(userId, def.rep);
  st.goal = { id: nextGoalId(def.id), assignedAt: Date.now() };
  await saveVitality(userId, st);
  const next = goalById(st.goal.id);
  return {
    ok: true, money: def.money, rep: def.rep, repLevel: repRes.level, repTitle: repRes.title,
    leveledUp: repRes.leveledUp, completedName: def.name,
    next: { id: next.id, name: next.name, icon: next.icon, text: next.text },
  };
}

// ---------------- daily quest reward tables (m9 hustle extensions) ----------------
// Per-mission game-money + rep rewards and the all-three bonus live in
// m9.js (HUSTLE_REWARDS / HUSTLE_DIFFICULTY / HUSTLE_ALL_DONE_BONUS) —
// re-exported above so the web client has one source of truth.
