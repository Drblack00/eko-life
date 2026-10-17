// ============================================================
// routes/vitality.js — P1 core loop REST API (game-money only).
//
// Mounted at /api/vitality. Covers: Sim-panel state aggregate,
// timed sleep, cooking + kitchen, wishes, goals, streak, dream,
// perk effects, feelings catalog. All copy is original to Èkó Life.
// ============================================================
import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import {
  getUserById,
  ensureCharacter,
  getCharacter,
  saveCharacter,
  addTransaction,
  listFurniture,
} from '../db.js';
import {
  getVitality, saveVitality, traitById, feelingsCatalog,
  REP_LEVELS, repLevel, grantGems, gemBalance,
  streakRewards, claimStreak, lagosDayKey, msUntilLagosMidnight,
  DREAMS, setDreamState, DREAM_CHANGE_MS, netWorth,
  SLEEP_MODES, startSleepState, finishSleepState, addRep,
} from '../game/vitality.js';
import {
  RECIPES, INGREDIENTS, ingredientById,
  hasKitchen, hasBed, missingIngredients, missingCost,
  startCookState, finishCookState, cancelCookState,
  addIngredients, setKitchenGuests,
} from '../game/cooking.js';
import {
  wishProgress, claimWish, swapWish,
  GOALS, currentGoal, claimGoal,
} from '../game/quests.js';
import { getPerkEffects } from '../game/perks.js';
import { listActiveMoodlets, triggerMoodlet } from '../game/v2/m8.js';
import {
  SKILLS, SKILL_IDS, getSkills, getSkillsUsed, skillLevel, rustLoss,
  getAcademyCerts, addSkillXp,
} from '../game/v2/m12.js';
import { trackOf } from '../game/v2/m7.js';

const naira = (n) => '₦' + Number(n).toLocaleString('en-NG');

export function createVitalityRouter() {
  const router = Router();
  router.use(authMiddleware);

  async function authedUser(req, res) {
    const user = await getUserById(req.userId);
    if (!user) { res.status(401).json({ error: 'Account not found.' }); return null; }
    if (Number(user.banned)) { res.status(403).json({ error: 'This account is banned.' }); return null; }
    return user;
  }

  async function placedItems(userId) {
    const rows = await listFurniture(userId);
    return (rows || []).filter(r => Number(r.placed));
  }

  // ---------- GET /api/vitality/state — Sim-panel aggregate ----------
  router.get('/state', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    try {
      const uid = req.userId;
      const c = await ensureCharacter(uid);
      const vit = await getVitality(uid);
      const now = Date.now();
      const moodlets = await listActiveMoodlets(uid);
      const certIds = await getAcademyCerts(uid);
      const skills = getSkills(c);
      const used = getSkillsUsed(c);
      const skillRows = SKILLS.map(s => {
        const base = skills[s.id] || { xp: 0, level: 0 };
        const rust = rustLoss(used[s.id], now);
        return {
          id: s.id, name: s.name, icon: s.icon,
          level: Number(base.level) || 0,
          xp: Number(base.xp) || 0,
          effective: skillLevel(c, s.id, certIds),
          rust,
          rusty: rust > 0,
          lastUsed: used[s.id] ? Number(used[s.id]) : 0,
        };
      });
      const rep = repLevel(vit.rep);
      const streakDay = lagosDayKey(now);
      const wishes = await wishProgress(uid, c);
      const goal = await currentGoal(uid, c);
      const dreamProg = dreamProgress(c, vit);
      const num = (v, d = 100) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
      res.json({
        needs: {
          hunger: num(c.hunger), energy: num(c.energy),
          fun: num(c.fun), social: num(c.social),
          hygiene: num(c.hygiene), bladder: num(c.bladder),
          happiness: num(c.happiness), health: num(c.health),
        },
        moodlets: moodlets.map(m => ({
          key: m.key, label: m.label, effects: m.effects,
          expiresInMs: Math.max(0, Number(m.expires_at) - now),
        })),
        traits: vit.traits.map(traitById).filter(Boolean),
        kitchen: {
          items: vit.kitchen.items, guestsOk: !!vit.kitchen.guests_ok,
          hasKitchen: hasKitchen(await placedItems(uid)),
        },
        timers: vit.timers,
        sleepModes: Object.values(SLEEP_MODES),
        hasBed: hasBed(await placedItems(uid)),
        dream: vit.dream ? { ...vit.dream, progress: dreamProg, changeInMs: dreamChangeIn(vit, now) } : null,
        dreams: DREAMS,
        rep,
        streak: {
          count: vit.streak.count,
          claimedToday: vit.streak.lastClaim === streakDay,
          next: streakRewards(vit.streak.count + 1),
          resetsInMs: msUntilLagosMidnight(now),
        },
        wishes,
        wishSwapLeft: vit.wishSwap.day === streakDay ? Math.max(0, 1 - vit.wishSwap.used) : 1,
        goal,
        gems: await gemBalance(uid),
        skills: skillRows,
        netWorth: netWorth(c),
      });
    } catch (e) { console.error('[vitality] state:', e.message); res.status(500).json({ error: 'Could not load Sim state.' }); }
  });

  function dreamChangeIn(vit, now) {
    if (!vit.dream || !vit.dream.setAt) return 0;
    return Math.max(0, DREAM_CHANGE_MS - (now - Number(vit.dream.setAt)));
  }

  function dreamProgress(c, vit) {
    if (!vit.dream) return null;
    const clamp01 = (x) => Math.max(0, Math.min(1, x));
    switch (vit.dream.id) {
      case 'oga_top': {
        const track = c.shift_job ? trackOf(c.shift_job) : null;
        if (!track || !track.roles || !track.roles.length) return 0;
        const idx = track.roles.findIndex(r => r.id === c.shift_job);
        return clamp01(idx / Math.max(1, track.roles.length - 1));
      }
      case 'landlord': {
        const cities = new Set([c.home_city, c.current_city].filter(Boolean));
        return clamp01(cities.size / 3);
      }
      case 'skill_master': {
        const certIds = [];
        const eff = SKILL_IDS.map(id => { try { return skillLevel(c, id, certIds); } catch { return 0; } });
        return clamp01(Math.max(0, ...eff) / 10);
      }
      case 'money_magnet': return clamp01(netWorth(c) / 10000000);
      case 'rep_legend': return clamp01(repLevel(vit.rep).level / 7);
      default: return null;
    }
  }

  // ---------- feelings catalog ----------
  router.get('/feelings', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    res.json({ feelings: feelingsCatalog() });
  });

  // ---------- timed sleep ----------
  router.post('/sleep/start', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    try {
      if (!hasBed(await placedItems(req.userId))) {
        return res.status(400).json({ error: 'You need a bed placed at home first. 🛏️' });
      }
      const vit = await getVitality(req.userId);
      const r = startSleepState(vit, String(req.body && req.body.mode));
      if (r.error) return res.status(400).json({ error: r.error });
      await saveVitality(req.userId, vit);
      res.json({ ok: true, timer: r.timer, mode: r.mode });
    } catch (e) { console.error('[vitality] sleep/start:', e.message); res.status(500).json({ error: 'Could not start rest.' }); }
  });

  async function applySleepFinish(req, res, cancelled) {
    const user = await authedUser(req, res);
    if (!user) return;
    try {
      const vit = await getVitality(req.userId);
      const r = finishSleepState(vit);
      if (r.error) return res.status(400).json({ error: r.error });
      const c = await ensureCharacter(req.userId);
      c.energy = Math.max(0, Math.min(100, Math.floor(Number(c.energy) || 0) + r.energy));
      c.fun = Math.max(0, Math.min(100, Math.floor(Number(c.fun) || 0) + r.fun));
      await saveCharacter(c);
      await saveVitality(req.userId, vit);
      await addTransaction(req.userId, 'sleep', 0, Math.floor(Number(c.money) || 0), { mode: r.mode.id, cancelled: !!cancelled });
      res.json({ ok: true, done: r.done, energy: r.energy, fun: r.fun, mode: r.mode });
    } catch (e) { console.error('[vitality] sleep/finish:', e.message); res.status(500).json({ error: 'Could not finish rest.' }); }
  }
  router.post('/sleep/finish', (req, res) => applySleepFinish(req, res, false));
  router.post('/sleep/cancel', (req, res) => applySleepFinish(req, res, true));

  // ---------- cooking ----------
  router.get('/recipes', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const vit = await getVitality(req.userId);
    const items = vit.kitchen.items;
    res.json({
      recipes: RECIPES.map(r => ({ ...r, missing: missingIngredients(items, r) })),
      ingredients: Object.values(INGREDIENTS),
      pantry: items,
      guestsOk: !!vit.kitchen.guests_ok,
      hasKitchen: hasKitchen(await placedItems(req.userId)),
      activeCook: vit.timers.cook,
    });
  });

  router.post('/kitchen/buy', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    try {
      const want = (req.body && req.body.items) || {};
      const adds = {};
      let total = 0;
      for (const [id, qty] of Object.entries(want)) {
        const ing = ingredientById(id);
        const q = Math.max(0, Math.floor(Number(qty) || 0));
        if (!ing || q <= 0 || q > 99) continue;
        adds[id] = q;
        total += ing.price * q;
      }
      if (!Object.keys(adds).length) return res.status(400).json({ error: 'Nothing to buy.' });
      const c = await ensureCharacter(req.userId);
      const bal = Math.floor(Number(c.money) || 0);
      if (bal < total) return res.status(400).json({ error: `Grocery run costs ${naira(total)} — you have ${naira(bal)}.` });
      c.money = bal - total;
      await addTransaction(req.userId, 'groceries', -total, c.money, { items: adds });
      await saveCharacter(c);
      const pantry = await addIngredients(req.userId, adds);
      res.json({ ok: true, spent: total, pantry });
    } catch (e) { console.error('[vitality] kitchen/buy:', e.message); res.status(500).json({ error: 'Grocery run failed.' }); }
  });

  router.post('/kitchen/guests', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const allow = !!(req.body && (req.body.allow === true || req.body.allow === 'true' || req.body.allow === 1));
    const guestsOk = await setKitchenGuests(req.userId, allow);
    res.json({ ok: true, guestsOk });
  });

  router.post('/cook/start', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    try {
      if (!hasKitchen(await placedItems(req.userId))) {
        return res.status(400).json({ error: 'You need a kitchen setup at home first — buy a stove in Buy mode. 🍳' });
      }
      const vit = await getVitality(req.userId);
      const r = startCookState(vit, String(req.body && req.body.recipeId));
      if (r.error) {
        const out = { error: r.error };
        if (r.missing) {
          out.missing = Object.entries(r.missing).map(([id, qty]) => ({ ...ingredientById(id), qty }));
          out.missingCost = missingCost(r.missing);
        }
        return res.status(400).json(out);
      }
      await saveVitality(req.userId, vit);
      res.json({ ok: true, timer: r.timer, recipe: { id: r.recipe.id, name: r.recipe.name, icon: r.recipe.icon, secs: r.recipe.secs } });
    } catch (e) { console.error('[vitality] cook/start:', e.message); res.status(500).json({ error: 'Could not start cooking.' }); }
  });

  router.post('/cook/finish', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    try {
      const vit = await getVitality(req.userId);
      const r = finishCookState(vit);
      if (r.error) return res.status(400).json({ error: r.error, remainingMs: r.remainingMs || 0 });
      const c = await ensureCharacter(req.userId);
      c.hunger = Math.max(0, Math.min(100, Math.floor(Number(c.hunger) || 0) + r.hunger));
      c.fun = Math.max(0, Math.min(100, Math.floor(Number(c.fun) || 0) + r.fun));
      const lvl = addSkillXp(c, 'cooking', r.xp);
      await addTransaction(req.userId, 'cook', 0, Math.floor(Number(c.money) || 0), { recipe: r.recipe.id });
      await saveCharacter(c);
      await saveVitality(req.userId, vit);
      let moodNote = null;
      if (r.recipe.favorite) {
        const t = await triggerMoodlet(req.userId, 'belleful_joy');
        if (t) moodNote = t.note || t;
      }
      res.json({
        ok: true,
        recipe: { id: r.recipe.id, name: r.recipe.name, icon: r.recipe.icon },
        hunger: r.hunger, fun: r.fun,
        cookingLevel: lvl.level, leveledUp: lvl.leveledUp,
        moodNote,
      });
    } catch (e) { console.error('[vitality] cook/finish:', e.message); res.status(500).json({ error: 'Could not finish cooking.' }); }
  });

  router.post('/cook/cancel', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const vit = await getVitality(req.userId);
    const r = cancelCookState(vit);
    if (r.error) return res.status(400).json({ error: r.error });
    await saveVitality(req.userId, vit);
    res.json({ ok: true, cancelled: r.recipe ? r.recipe.id : null });
  });

  // ---------- wishes ----------
  router.get('/wishes', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const c = await ensureCharacter(req.userId);
    const wishes = await wishProgress(req.userId, c);
    const vit = await getVitality(req.userId);
    const day = lagosDayKey();
    res.json({ wishes, gems: await gemBalance(req.userId), swapLeft: vit.wishSwap.day === day ? Math.max(0, 1 - vit.wishSwap.used) : 1 });
  });

  router.post('/wishes/claim', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const c = await ensureCharacter(req.userId);
    const r = await claimWish(req.userId, c, req.body && req.body.id);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  });

  router.post('/wishes/swap', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const r = await swapWish(req.userId, req.body && req.body.id);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  });

  // ---------- goals ----------
  router.get('/goals', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const c = await ensureCharacter(req.userId);
    res.json({ goal: await currentGoal(req.userId, c), all: GOALS.map(g => ({ id: g.id, name: g.name, icon: g.icon })) });
  });

  router.post('/goals/claim', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    try {
      const c = await ensureCharacter(req.userId);
      const r = await claimGoal(req.userId, c);
      if (r.error) return res.status(400).json({ error: r.error });
      const bal = Math.floor(Number(c.money) || 0);
      c.money = bal + r.money;
      await addTransaction(req.userId, 'goal_reward', r.money, c.money, { goal: r.completedName });
      await saveCharacter(c);
      res.json({ ok: true, ...r, money: r.money });
    } catch (e) { console.error('[vitality] goals/claim:', e.message); res.status(500).json({ error: 'Could not claim goal.' }); }
  });

  // ---------- streak ----------
  router.get('/streak', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const vit = await getVitality(req.userId);
    const day = lagosDayKey();
    res.json({
      count: vit.streak.count,
      claimedToday: vit.streak.lastClaim === day,
      next: streakRewards(vit.streak.count + 1),
      resetsInMs: msUntilLagosMidnight(),
      repLevels: REP_LEVELS,
    });
  });

  router.post('/streak/claim', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    try {
      const r = await claimStreak(req.userId);
      if (r.error) return res.status(400).json({ error: r.error });
      const c = await ensureCharacter(req.userId);
      const bal = Math.floor(Number(c.money) || 0);
      c.money = bal + r.money;
      await addTransaction(req.userId, 'streak', r.money, c.money, { day: r.count });
      await saveCharacter(c);
      const repRes = await addRep(req.userId, r.rep);
      res.json({ ok: true, count: r.count, money: r.money, rep: r.rep, repLevel: repRes.level, repTitle: repRes.title, leveledUp: repRes.leveledUp });
    } catch (e) { console.error('[vitality] streak/claim:', e.message); res.status(500).json({ error: 'Check-in failed.' }); }
  });

  // ---------- dream ----------
  router.post('/dream', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const vit = await getVitality(req.userId);
    const r = setDreamState(vit, String(req.body && req.body.id));
    if (r.error) return res.status(400).json({ error: r.error, nextChangeInMs: r.nextChangeInMs || 0 });
    await saveVitality(req.userId, vit);
    res.json({ ok: true, dream: r.dream, dreams: DREAMS });
  });

  // ---------- perk effects (for other phases + UI) ----------
  router.get('/perks/effects', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const c = await ensureCharacter(req.userId);
    res.json(getPerkEffects(c));
  });

  return router;
}
