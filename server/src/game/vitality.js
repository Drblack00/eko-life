// ============================================================
// game/vitality.js — P1 core loop: traits, rep, streaks, dreams,
// feelings catalog, timed sleep, and the vitality_state store.
//
// Owns the `vitality_state` table (one JSON row per user) so the core
// loop never needs new `characters` columns: traits, kitchen, timers,
// dream, rep, streak, wishes and goal progress all live here.
//
// Rep XP, streak money and wish gems are game-money only — the cash
// wallet is never touched. All copy is original to Èkó Life.
// ============================================================
// PORT-P3 one-line fix (flagged for P1): was '../../db.js' which resolves
// outside src/ — the db module lives at src/db.js.
import { dbRun, dbGet, addTransaction, getCharacter } from '../db.js';
import { MOODLET_TRIGGERS } from './v2/m8.js';

// ---------------- storage ----------------
export const SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS vitality_state (
  user_id INTEGER PRIMARY KEY,
  state_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL DEFAULT 0
);`;

export const SCHEMA_PG = `
CREATE TABLE IF NOT EXISTS vitality_state (
  user_id INTEGER PRIMARY KEY,
  state_json TEXT NOT NULL DEFAULT '{}',
  updated_at BIGINT NOT NULL DEFAULT 0
);`;

export async function ensureSchema() {
  await dbRun(SCHEMA_SQLITE, SCHEMA_PG);
  // Defensive: the gem currency column is coordinator-owned (m9 also
  // ensures it); without it grantGems would fail on fresh DBs.
  try {
    await dbRun(
      'ALTER TABLE characters ADD COLUMN perk_stars INTEGER DEFAULT 0',
      'ALTER TABLE characters ADD COLUMN perk_stars INTEGER DEFAULT 0');
  } catch { /* exists */ }
}

function defaults() {
  return {
    traits: [],
    kitchen: { items: {}, guests_ok: false },
    timers: { sleep: null, cook: null },
    dream: null,          // { id, text, setAt }
    rep: 0,
    streak: { day: '', count: 0, lastClaim: '' },
    wishes: [],           // [{ id, assignedAt, done }]
    wishSwap: { day: '', used: 0 },
    goal: null,           // { id, assignedAt }
    cooksDone: 0,
    sleepsDone: 0,
  };
}

function mergeState(raw) {
  const d = defaults();
  let o = {};
  try { o = JSON.parse(raw || '{}'); } catch { o = {}; }
  const out = { ...d, ...o };
  out.kitchen = { items: {}, guests_ok: false, ...(o.kitchen || {}) };
  out.timers = { sleep: null, cook: null, ...(o.timers || {}) };
  out.streak = { day: '', count: 0, lastClaim: '', ...(o.streak || {}) };
  out.wishSwap = { day: '', used: 0, ...(o.wishSwap || {}) };
  if (!Array.isArray(out.traits)) out.traits = [];
  if (!Array.isArray(out.wishes)) out.wishes = [];
  return out;
}

export async function getVitality(userId) {
  await ensureSchema();
  const row = await dbGet(
    'SELECT state_json FROM vitality_state WHERE user_id=?',
    'SELECT state_json FROM vitality_state WHERE user_id=$1',
    [userId]);
  const st = mergeState(row && row.state_json);
  if (st.traits.length === 0) {
    st.traits = pickTraits();
    await saveVitality(userId, st);
  }
  return st;
}

export async function saveVitality(userId, state) {
  await ensureSchema();
  const now = Date.now();
  await dbRun(
    `INSERT INTO vitality_state (user_id, state_json, updated_at) VALUES (?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at`,
    `INSERT INTO vitality_state (user_id, state_json, updated_at) VALUES ($1,$2,$3)
     ON CONFLICT (user_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at`,
    [userId, JSON.stringify(state), now]);
}

// ---------------- wall clock (Africa/Lagos) ----------------
export function lagosDayKey(now = Date.now()) {
  return new Date(now).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
}

export function msUntilLagosMidnight(now = Date.now()) {
  // Africa/Lagos is UTC+1 year-round (no DST).
  const [Y, M, D] = lagosDayKey(now).split('-').map(Number);
  const nextMidnight = Date.UTC(Y, M - 1, D) + 24 * 3600 * 1000 - 3600 * 1000;
  return Math.max(0, nextMidnight - now);
}

// ---------------- traits (qualitative only — no numbers, ever) ----------------
export const TRAITS = [
  { id: 'early_bird',    name: 'Early Bird',    blurb: 'Up before the danfo rush.' },
  { id: 'night_owl',      name: 'Night Owl',     blurb: 'Lagos never sleeps, and neither do you.' },
  { id: 'party_starter',  name: 'Party Starter', blurb: 'If there is music, you are already dancing.' },
  { id: 'homebody',       name: 'Homebody',      blurb: 'Your couch knows your name.' },
  { id: 'foodie',         name: 'Foodie',        blurb: 'You rate every buka like a critic.' },
  { id: 'gym_devotee',    name: 'Gym Devotee',   blurb: 'No days off. Leg day included.' },
  { id: 'bookworm',       name: 'Bookworm',      blurb: 'Always one chapter away from sleep.' },
  { id: 'streetwise',     name: 'Streetwise',    blurb: 'You can price anything in three markets.' },
  { id: 'soft_life',      name: 'Soft Life',     blurb: 'Comfort is a lifestyle, not a luxury.' },
  { id: 'hustler_spirit', name: 'Hustler Spirit',blurb: 'Every "no" is just a delayed "yes".' },
];

export function traitById(id) {
  return TRAITS.find(t => t.id === id) || null;
}

// Two random traits per character, drawn once and kept.
export function pickTraits(rng = Math.random) {
  const pool = TRAITS.map(t => t.id);
  const out = [];
  while (out.length < 2 && pool.length) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}

// ---------------- feelings (moodlet display catalog) ----------------
// Numeric modifiers are shown exactly as the simulation applies them:
// per-tick stat shifts and decay slowdowns, with the original cause
// copy and the expiry the trigger registered.
function describeEffects(effects) {
  const parts = [];
  for (const e of effects || []) {
    if (e.type === 'stat_boost') parts.push(`+${Math.abs(Number(e.amount) || 0)} ${e.stat}/min`);
    else if (e.type === 'stat_drain') parts.push(`−${Math.abs(Number(e.amount) || 0)} ${e.stat}/min`);
    else if (e.type === 'decay_slow') parts.push(`${e.need} drains ${Number(e.pct) || 0}% slower`);
    else if (e.type === 'decay_all') parts.push(`all needs drain ${Number(e.pct) || 0}% slower`);
  }
  return parts.join(' · ');
}

export function feelingsCatalog() {
  return Object.entries(MOODLET_TRIGGERS).map(([key, t]) => ({
    key,
    label: t.label,
    cause: t.note,
    modifier: describeEffects(t.effects),
    durationMs: Number(t.ttlMs) || 0,
  }));
}

// ---------------- rep (Lagos Rep: XP + level titles) ----------------
export const REP_LEVELS = [
  { level: 1, xp: 0,    title: 'JJC',               icon: '🧳' },
  { level: 2, xp: 100,  title: 'Street Learner',    icon: '🚶' },
  { level: 3, xp: 300,  title: 'Correct Person',    icon: '😎' },
  { level: 4, xp: 600,  title: 'Area Familiar',     icon: '🏘️' },
  { level: 5, xp: 1000, title: 'Neighbourhood Star',icon: '⭐' },
  { level: 6, xp: 1600, title: 'City Celebrity',    icon: '🌟' },
  { level: 7, xp: 2500, title: 'Lagos Legend',      icon: '👑' },
];

export function repLevel(totalXp) {
  const xp = Math.max(0, Math.floor(Number(totalXp) || 0));
  let cur = REP_LEVELS[0];
  let next = null;
  for (const l of REP_LEVELS) {
    if (xp >= l.xp) cur = l;
    else { next = l; break; }
  }
  return {
    level: cur.level,
    title: cur.title,
    icon: cur.icon,
    xp,
    xpIntoLevel: xp - cur.xp,
    xpForNext: next ? next.xp - cur.xp : 0,
    nextTitle: next ? next.title : null,
    maxed: !next,
  };
}

// Pure: add rep XP to a vitality state object. Returns level info.
export function addRepXp(state, xp) {
  const before = repLevel(state.rep);
  state.rep = Math.max(0, Math.floor(Number(state.rep) || 0) + Math.max(0, Math.floor(Number(xp) || 0)));
  const after = repLevel(state.rep);
  return { before, after, leveledUp: after.level > before.level };
}

export async function addRep(userId, xp) {
  const st = await getVitality(userId);
  const res = addRepXp(st, xp);
  await saveVitality(userId, st);
  return { rep: st.rep, ...res.after, leveledUp: res.leveledUp };
}

// ---------------- gem currency (✨ = perk_stars, game-money only) ----------------
export async function gemBalance(userId) {
  const c = await getCharacter(userId);
  return Math.max(0, Math.floor(Number(c && c.perk_stars) || 0));
}

// Direct DB grant (REST flows). WS intents should use m9's persistPerks on
// the live character object instead so the in-memory row stays in sync.
export async function grantGems(userId, n) {
  await ensureSchema();
  const amt = Math.max(0, Math.floor(Number(n) || 0));
  if (amt <= 0) return 0;
  const c = await getCharacter(userId);
  const bal = Math.max(0, Math.floor(Number(c && c.perk_stars) || 0)) + amt;
  await dbRun(
    'UPDATE characters SET perk_stars=? WHERE user_id=?',
    'UPDATE characters SET perk_stars=$1 WHERE user_id=$2',
    [bal, userId]);
  await addTransaction(userId, 'gems', amt, bal, { reason: 'vitality_grant' });
  return bal;
}

// ---------------- daily check-in streak ----------------
export function streakRewards(dayCount) {
  const d = Math.max(1, Math.floor(Number(dayCount) || 1));
  return {
    money: 5000 + 500 * Math.min(d - 1, 10), // ₦5,000 → ₦10,000 cap
    rep: 10,
  };
}

export async function claimStreak(userId, now = Date.now()) {
  const st = await getVitality(userId);
  const today = lagosDayKey(now);
  if (st.streak.lastClaim === today) {
    return { error: 'Already checked in today — see you tomorrow! 🔥' };
  }
  const y = new Date(now - 86400000).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
  const count = st.streak.lastClaim === y ? st.streak.count + 1 : 1;
  st.streak = { day: today, count, lastClaim: today };
  const rewards = streakRewards(count);
  await saveVitality(userId, st);
  // Money + rep are applied by the caller (router) on the character row.
  return { count, ...rewards, error: null };
}

// ---------------- lifetime dream ----------------
export const DREAMS = [
  { id: 'oga_top',      text: 'Oga at the Top — reach the top rank of any career.' },
  { id: 'landlord',     text: 'Landlord for Real — own homes in 3 different cities.' },
  { id: 'skill_master', text: 'Ten Over Ten — take any skill to level 10.' },
  { id: 'money_magnet', text: 'Money Magnet — build a ₦10,000,000 net worth.' },
  { id: 'rep_legend',   text: 'Lagos Legend — reach Lagos Rep level 7.' },
];

export const DREAM_CHANGE_MS = 7 * 24 * 3600 * 1000;

export function dreamById(id) {
  return DREAMS.find(d => d.id === id) || null;
}

// Changeable once per week. Returns {ok} or {error, nextChangeInMs}.
export function setDreamState(state, dreamId, now = Date.now()) {
  const dream = dreamById(dreamId);
  if (!dream) return { error: 'Unknown dream.' };
  if (state.dream && state.dream.setAt && now - Number(state.dream.setAt) < DREAM_CHANGE_MS) {
    return { error: 'Dreams can only be changed once a week.', nextChangeInMs: DREAM_CHANGE_MS - (now - Number(state.dream.setAt)) };
  }
  state.dream = { id: dream.id, text: dream.text, setAt: now };
  return { ok: true, dream: state.dream };
}

// ---------------- net worth (game-money only) ----------------
export function netWorth(char) {
  const money = Math.max(0, Math.floor(Number(char.money) || 0));
  const savings = Math.max(0, Math.floor(Number(char.savings) || 0));
  const loan = Math.max(0, Math.floor(Number(char.loan) || 0));
  return Math.max(0, money + savings - loan);
}

// ---------------- timed sleep ----------------
// 3 FREE bed actions. Cancellable mid-action (cancel pays half restore).
export const SLEEP_MODES = {
  deep:   { id: 'deep',   name: 'Sleep',       icon: '😴', secs: 36, energy: 60, fun: 0,  blurb: 'Full rest. Wake up brand new.' },
  nap:    { id: 'nap',    name: 'Take a Nap',  icon: '🥱', secs: 15, energy: 30, fun: 0,  blurb: 'Quick recharge.' },
  lounge: { id: 'lounge', name: 'Stay in Bed', icon: '🛌', secs: 36, energy: 25, fun: 10, blurb: 'Lazy morning energy.' },
};

export function sleepModeById(id) {
  return SLEEP_MODES[id] || null;
}

export function startSleepState(state, modeId, now = Date.now()) {
  const mode = sleepModeById(modeId);
  if (!mode) return { error: 'Unknown rest mode.' };
  if (state.timers.sleep) return { error: 'You are already resting — cancel it first.' };
  state.timers.sleep = { mode: mode.id, endsAt: now + mode.secs * 1000, startedAt: now };
  return { ok: true, timer: state.timers.sleep, mode };
}

// Returns the restore to apply (full if done, half if cancelled early).
export function finishSleepState(state, now = Date.now()) {
  const t = state.timers.sleep;
  if (!t) return { error: 'No rest in progress.' };
  const mode = sleepModeById(t.mode);
  const done = now >= t.endsAt;
  const frac = done ? 1 : 0.5;
  state.timers.sleep = null;
  if (done) state.sleepsDone = (Number(state.sleepsDone) || 0) + 1;
  return {
    ok: true,
    done,
    energy: Math.round(mode.energy * frac),
    fun: Math.round(mode.fun * frac),
    mode,
  };
}
