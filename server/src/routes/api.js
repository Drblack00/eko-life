// ============================================================
// routes/api.js — Èkó Life REST API (M1)
// Implements docs/API_SPEC.md. M1 endpoints only; admin +
// gameplay endpoints land in later milestones.
// ============================================================
import { Router } from 'express';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getUserById, getCharacter, ensureCharacter, saveCharacter, addTransaction, getMeta, dbMode, listTransactions, getPropertyOwnerIds, listFurniture, listTopByMoney } from '../db.js';
import { authMiddleware, createAuthRouter, USER_RE } from '../auth.js';
import { createAdminRouter } from './admin.js';
import {
  CLASSES, LOCATIONS, JOBS, FOOD, FUN, HOUSING, SPAWN, WORLD_BOUNDS,
  AVATARS, COLORS, PROPERTIES, BIZ, VEHICLES, FURN, HOME_SLOTS,
  BANK, TRAVEL_FARES, STUDY_COST,
} from '../game/data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let VERSION = '0.1.0';
try {
  VERSION = JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf8')).version || VERSION;
} catch { /* keep default */ }

// Full character state shared by GET /api/me and POST /api/characters.
function characterBody(user, c, day) {
  const body = {
    id: user.id,
    username: user.username,
    name: c.name,
    class: c.class,
    avatar: c.avatar,
    color: c.color,
    customized: !!Number(c.customized),
    money: Number(c.money),
    energy: Number(c.energy),
    health: Number(c.health),
    happiness: Number(c.happiness),
    hunger: Number(c.hunger),
    housing: c.housing,
    property: c.property,
    biz: c.biz || null,
    vehicle: c.vehicle,
    savings: Number(c.savings),
    loan: Number(c.loan),
    loan_free: !!Number(c.loan_free),
    cert: Number(c.cert),
    starter_loan_available: !!Number(c.starter_loan_available),
    locationId: c.location_id,
    x: c.x == null ? null : Number(c.x),
    y: c.y == null ? null : Number(c.y),
    day,
    is_admin: !!Number(user.is_admin),
    guest: !!Number(user.is_guest),
  };
  body.stats = {
    energy: body.energy,
    health: body.health,
    happiness: body.happiness,
    hunger: body.hunger,
  };
  return body;
}

export function createApiRouter({ hub, getDay }) {
  const router = Router();

  // ---- health ----
  router.get('/health', (req, res) => {
    res.json({ ok: true, online: hub.onlineCount(), day: getDay().day, db: dbMode(), version: VERSION });
  });

  // ---- public live counters ----
  router.get('/stats', async (req, res) => {
    const visits = Number((await getMeta('visits')) || 0);
    // M3: homes = players who own a property; homesOnline = those online now.
    // M5: governor = the sitting governor's username (null when none).
    let homes = 0, homesOnline = 0, governor = null;
    try {
      const ownerIds = await getPropertyOwnerIds();
      homes = ownerIds.length;
      for (const id of ownerIds) if (hub.online.has(id)) homesOnline++;
    } catch (e) { console.error('[stats] homes:', e.message); }
    try { governor = await hub.governorName(); } catch (e) { console.error('[stats] governor:', e.message); }
    res.json({
      online: hub.onlineCount(),
      visits,
      governor,
      homes,
      homesOnline,
    });
  });

  // ---- M5: news ticker feed (public) — last 20 world events ----
  router.get('/news', (req, res) => {
    res.json({ news: hub.getNews() });
  });

  // ---- M5: live presence (public) — capped 200, powers landing player dots ----
  router.get('/presence', (req, res) => {
    const out = [];
    for (const [id, conn] of hub.online) {
      if (out.length >= 200) break;
      out.push({
        id: Number(id),
        username: conn.user.username,
        x: Number(conn.pos?.lat) || 0,
        y: Number(conn.pos?.lng) || 0,
        avatar: conn.character?.avatar || '🧑',
        color: conn.character?.color || '#22d3ee',
      });
    }
    res.json({ presence: out });
  });

  // ---- M5: leaderboard (public) — top 10 players by money ----
  // Kept separate from /api/stats so the landing's live counters stay cheap.
  router.get('/leaderboard', async (req, res) => {
    const leaders = await listTopByMoney(10);
    res.json({ leaders });
  });

  // ---- public game data (server is the source of truth) ----
  router.get('/config', (req, res) => {
    res.json({
      classes: CLASSES,
      locations: LOCATIONS,
      jobs: JOBS,
      food: FOOD,
      fun: FUN,
      housing: HOUSING,
      spawn: SPAWN,
      bounds: WORLD_BOUNDS,
      avatars: AVATARS,
      colors: COLORS,
      properties: PROPERTIES,
      biz: BIZ,
      vehicles: VEHICLES,
      furn: FURN,
      homeSlots: HOME_SLOTS,
      bank: BANK,
      travelFares: TRAVEL_FARES,
      studyCost: STUDY_COST,
    });
  });

  // ---- auth ----
  router.use('/auth', createAuthRouter());

  // ---- admin (M4) ----
  router.use('/admin', createAdminRouter({ hub, getDay }));

  // ---- me (full character state) ----
  router.get('/me', authMiddleware, async (req, res) => {
    const user = await getUserById(req.userId);
    if (!user) return res.status(401).json({ error: 'Account not found.' });
    if (Number(user.banned)) return res.status(403).json({ error: 'This account is banned.' });
    const c = await ensureCharacter(user.id, user.username);
    const body = characterBody(user, c, getDay().day);
    // M3: furniture inventory rides along with /api/me (mirrors WS `you`).
    let furniture = [];
    try {
      furniture = (await listFurniture(user.id)).map(r => ({ id: r.id, item: r.item, placed: !!Number(r.placed) }));
    } catch (e) { console.error('[me] furniture:', e.message); }
    body.furniture = furniture;
    res.json(body);
  });

  // ---- transactions (M3): newest-first ledger, last 50 (client spending history) ----
  router.get('/transactions', authMiddleware, async (req, res) => {
    const rows = await listTransactions(req.userId, 50);
    res.json({
      transactions: rows.map(r => {
        let meta = null;
        if (r.meta) {
          try { meta = JSON.parse(r.meta); } catch { meta = null; }
        }
        return {
          id: r.id,
          kind: r.kind,
          amount: Number(r.amount),
          balance_after: Number(r.balance_after),
          meta,
          created_at: Number(r.created_at),
        };
      }),
    });
  });

  // ---- character creation (M2): one-time customization + class package ----
  // Register auto-creates street_smart defaults (M1); this endpoint lets the
  // player pick name/class/avatar/color exactly ONCE.
  router.post('/characters', authMiddleware, async (req, res) => {
    const user = await getUserById(req.userId);
    if (!user) return res.status(401).json({ error: 'Account not found.' });
    if (Number(user.banned)) return res.status(403).json({ error: 'This account is banned.' });
    const c = await ensureCharacter(user.id, user.username);
    if (Number(c.customized)) {
      return res.status(400).json({ error: 'Character already created — customization is one-time only.' });
    }
    const name = String(req.body.name || '').trim();
    if (!USER_RE.test(name)) {
      return res.status(400).json({ error: 'Name: 3–16 chars, letters, numbers or _.' });
    }
    const classId = String(req.body.class || '');
    if (!CLASSES[classId]) {
      return res.status(400).json({ error: 'Class must be silver_spoon or street_smart.' });
    }
    const avatar = String(req.body.avatar || '');
    const color = String(req.body.color || '').toLowerCase();
    if (!AVATARS.includes(avatar)) return res.status(400).json({ error: 'Invalid avatar.' });
    if (!COLORS.includes(color)) return res.status(400).json({ error: 'Invalid color.' });

    const pkg = CLASSES[classId];
    c.name = name;
    c.class = pkg.id;
    c.avatar = avatar;
    c.color = color;
    c.customized = 1;
    c.rent_misses = 0;
    c.money = pkg.startMoney;
    c.housing = pkg.housing;
    c.happiness = Math.min(100, Number(c.happiness) + (pkg.happinessBonus || 0));
    c.starter_loan_available = classId === 'street_smart' ? 1 : 0;
    await saveCharacter(c);
    await addTransaction(user.id, 'class_package', c.money, c.money, { class: classId });
    console.log(`[characters] ${user.username} created character "${name}" (${classId})`);
    res.json({ ok: true, character: characterBody(user, c, getDay().day) });
  });

  // ---- client error beacon ----
  router.post('/client-error', (req, res) => {
    const { message, stack, where, url, build } = req.body || {};
    console.log('[client-error]', JSON.stringify({
      message: String(message || '').slice(0, 500),
      where: where || null,
      url: url || null,
      build: build || null,
      stack: String(stack || '').slice(0, 1000) || null,
    }));
    res.json({ ok: true });
  });

  return router;
}
