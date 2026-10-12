// ============================================================
// routes/api.js — Èkó Life REST API (M1)
// Implements docs/API_SPEC.md. M1 endpoints only; admin +
// gameplay endpoints land in later milestones.
// ============================================================
import { Router } from 'express';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getUserById, getUserByName, getCharacter, getCharacterById, ensureCharacter, saveCharacter, addTransaction, getMeta, dbMode, listTransactions, getPropertyOwnerIds, listFurniture, listTopByMoney, resolveReferralCode, setUsername, setCharacterName } from '../db.js';
import { authMiddleware, createAuthRouter, USER_RE } from '../auth.js';
import { createAdminRouter } from './admin.js';
import { createFriendsRouter } from './friends.js';
import { createNotificationsRouter } from './notifications.js';
import { createCashWalletRouter } from './cashWallet.js';
import { createCashFlowsRouter } from './cashFlows.js';
import { createCashAdminRouter } from './cashAdmin.js';
import {
  CLASSES, LOCATIONS, JOBS, FOOD, FUN, HOUSING, SPAWN, WORLD_BOUNDS,
  AVATARS, COLORS, PROPERTIES, BIZ, VEHICLES, FURN, HOME_SLOTS,
  BANK, TRAVEL_FARES, STUDY_COST,
  AVATAR_BODIES, AVATAR_SKINS, AVATAR_HAIRS, AVATAR_OUTFITS, AVATAR_FABRICS,
  AVATAR_TOP_COLORS, AVATAR_BOTTOM_COLORS, DEFAULT_AVATAR, sanitizeAvatar,
  WALLS, FLOORS,
} from '../game/data.js';
// M6: versioned appearance persistence (validator + persist + catalog).
import {
  AppearanceValidationError,
  AppearanceConflictError,
  AppearanceNotFoundError,
  persistAppearance,
  buildCatalog,
} from '../game/appearance.js';
// V2 milestones: REST_SPECS + CONFIG_DATA + clock helper, mounted below.
import { REST_SPEC as M7_REST, CONFIG_DATA as M7_CONFIG, lagosNow } from '../game/v2/m7.js';
import { REST_SPEC as M8_REST, CONFIG_DATA as M8_CONFIG } from '../game/v2/m8.js';
import { REST_SPEC as M9_REST } from '../game/v2/m9.js';
import { REST_SPEC as M10_REST, CONFIG_DATA as M10_CONFIG } from '../game/v2/m10.js';
import { CONFIG_DATA as M12_CONFIG } from '../game/v2/m12.js'; // M12 has no REST_SPEC — all WS intents
import { REST_SPEC as M13_REST } from '../game/v2/m13.js';

// Mount a v2 module's REST_SPEC on the router. Entries declare
// {method, path, auth}; auth:true handlers read req.userId (authMiddleware
// convention, matching existing api.js routes). Module paths carry the
// `/api` prefix; the router already sits under `/api`, so strip it.
function mountV2Spec(router, spec) {
  for (const r of spec || []) {
    const method = (r.method || 'GET').toLowerCase();
    const path = String(r.path || '').replace(/^\/api(?=\/)/, '') || '/';
    const chain = [];
    if (r.auth) {
      chain.push(authMiddleware);
      // v2 modules are split on convention (req.userId vs req.user) — provide both.
      chain.push((req, _res, next) => {
        if (req.userId && !req.user) req.user = { id: req.userId };
        next();
      });
    }
    chain.push(async (req, res, next) => {
      try { await r.handler(req, res); } catch (e) { next(e); }
    });
    router[method](path, ...chain);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let VERSION = '0.1.0';
try {
  VERSION = JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf8')).version || VERSION;
} catch { /* keep default */ }

// Full character state shared by GET /api/me and POST /api/characters.
/** Mask an account email for display: j***@g***.com (null when none). */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const at = email.indexOf('@');
  if (at <= 0) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const dom = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local[0]}***@${dom[0]}***${tld}`;
}
function characterBody(user, c, day) {
  const body = {
    id: user.id,
    character_id: c.id,
    username: user.username,
    name: c.name,
    class: c.class,
    avatar: c.avatar,
    color: c.color,
    customized: !!Number(c.customized),
    // M15: avatar look (parsed JSON or null), home style ids
    avatar_look: (() => { try { return c.avatar_look ? JSON.parse(c.avatar_look) : null; } catch { return null; } })(),
    home_wall: c.home_wall || null,
    home_floor: c.home_floor || null,
    money: Number(c.money),
    energy: Number(c.energy),
    health: Number(c.health),
    happiness: Number(c.happiness),
    hunger: Number(c.hunger),
    // V2: six needs (M8), shifts (M7), perks (M9), rent-to-own (M10)
    fun: Number(c.fun),
    social: Number(c.social),
    hygiene: Number(c.hygiene),
    bladder: Number(c.bladder),
    perk_stars: Math.max(0, Math.floor(Number(c.perk_stars) || 0)),
    perks: (() => { try { return JSON.parse(c.perks || '[]'); } catch { return []; } })(),
    housing_owned: !!Number(c.housing_owned),
    shift_job: c.shift_job || null,
    shift_started_at: c.shift_started_at == null ? null : Number(c.shift_started_at),
    shift_ends_at: c.shift_ends_at == null ? null : Number(c.shift_ends_at),
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
    // Character panel: masked account email (null when the account has none).
    email_masked: maskEmail(user.email),
  };
  body.stats = {
    energy: body.energy,
    health: body.health,
    happiness: body.happiness,
    hunger: body.hunger,
    fun: body.fun,
    social: body.social,
    hygiene: body.hygiene,
    bladder: body.bladder,
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
      // V2 milestone config data
      careerTracks: M7_CONFIG.careerTracks,
      skillLabels: M7_CONFIG.skillLabels,
      needs: M8_CONFIG.needs,
      housingBuy: M10_CONFIG.housingBuy,
      shopTypes: M10_CONFIG.shopTypes,
      lapo: M10_CONFIG.lapo,
      tax: M10_CONFIG.tax,
      skills: M12_CONFIG.skills,
      courses: M12_CONFIG.courses,
      skillTuning: M12_CONFIG.tuning,
      // M15: avatar + home-style config (server is the source of truth)
      avatarLook: {
        bodies: AVATAR_BODIES,
        skins: AVATAR_SKINS,
        hairs: AVATAR_HAIRS,
        outfits: AVATAR_OUTFITS,
        fabrics: AVATAR_FABRICS,
        topColors: AVATAR_TOP_COLORS,
        bottomColors: AVATAR_BOTTOM_COLORS,
        defaults: DEFAULT_AVATAR,
      },
      walls: WALLS,
      floors: FLOORS,
    });
  });

  // ---- V2 REST endpoints (see each module's REST_SPEC) ----
  mountV2Spec(router, M7_REST);
  mountV2Spec(router, M8_REST);
  mountV2Spec(router, M9_REST);
  mountV2Spec(router, M10_REST);
  // M13: only the public list route here — admin billboard routes live in
  // routes/admin.js (their handlers require req.admin from requireAdmin).
  mountV2Spec(router, M13_REST.filter(r => !r.admin));

  // ---- auth ----
  router.use('/auth', createAuthRouter());

  // ---- W3: public referral-code resolver (landing ?ref= → "Invited by") ----
  // Invalid codes resolve to 404; the client ignores them gracefully.
  router.get('/referral/:code', async (req, res) => {
    try {
      const user = await resolveReferralCode(req.params.code);
      if (!user) return res.status(404).json({ error: 'Unknown invite code.' });
      res.json({ username: user.username });
    } catch (e) { console.error('[referral] resolve:', e.message); res.status(500).json({ error: 'Lookup failed.' }); }
  });

  // ---- W3: friends page (all routes behind Bearer <redacted>) ----
  router.use('/friends', createFriendsRouter({ hub }));

  // ---- M21: notifications (all routes behind Bearer <redacted>) ----
  router.use('/notifications', createNotificationsRouter());

  // ---- admin (M4) ----
  router.use('/admin', createAdminRouter({ hub, getDay }));

  // ---- cash wallet (fintech M5-M7; all routes behind requireCashOps -> 403 while disabled) ----
  router.use('/cash-wallet', createCashWalletRouter());
  router.use('/cash-wallet', createCashFlowsRouter());
  // ---- cash admin (fintech M9: risk controls, adjustments, review, reconcile) ----
  router.use('/admin/cash', createCashAdminRouter());

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

  // ---- character panel: change username and/or display name ----
  // Username validated exactly like registration (USER_RE); must be unique.
  // Display name: 1–24 chars. Guests may change display name only.
  router.put('/me/profile', authMiddleware, async (req, res) => {
    const user = await getUserById(req.userId);
    if (!user) return res.status(401).json({ error: 'Account not found.' });
    if (Number(user.banned)) return res.status(403).json({ error: 'This account is banned.' });
    const isGuest = !!Number(user.is_guest);
    const out = {};
    if (req.body.username !== undefined) {
      if (isGuest) return res.status(400).json({ error: 'Guests keep their generated username — create a full account to pick your own.' });
      const username = String(req.body.username || '').trim();
      if (!USER_RE.test(username)) {
        return res.status(400).json({ error: 'Username: 3–16 characters, letters, numbers or _.' });
      }
      if (username !== user.username) {
        const taken = await getUserByName(username);
        if (taken && Number(taken.id) !== Number(user.id)) {
          return res.status(409).json({ error: 'That username is taken.' });
        }
        await setUsername(user.id, username);
        out.username = username;
      } else {
        out.username = user.username;
      }
    }
    if (req.body.name !== undefined) {
      const name = String(req.body.name || '').trim().slice(0, 24);
      if (name.length < 1) {
        return res.status(400).json({ error: 'Display name can\'t be empty.' });
      }
      await setCharacterName(user.id, name);
      out.name = name;
    }
    res.json({ ok: true, ...out });
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
    // M15: optional full avatar look (validated; stored as JSON text).
    let avatarLook = null;
    if (req.body.avatar_look != null) {
      const res15 = sanitizeAvatar(req.body.avatar_look);
      if (!res15.ok) return res.status(400).json({ error: res15.error });
      avatarLook = JSON.stringify(res15.avatar);
    }

    const pkg = CLASSES[classId];
    c.name = name;
    c.class = pkg.id;
    c.avatar = avatar;
    c.color = color;
    c.avatar_look = avatarLook; // M15: null unless a valid look was provided
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

  // ---- M6: versioned appearance persistence ----
  // GET /api/characters/:id/appearance → { appearance, revision }
  // `appearance` is the stored JSON parsed verbatim: it may be a legacy
  // flat look (the client migrates on read via migrateAvatarLookToV1) or
  // null when unset. 404 when the character does not exist or is not
  // yours (no existence leaking).
  router.get('/characters/:id/appearance', authMiddleware, async (req, res) => {
    const row = await getCharacterById(Number(req.params.id));
    if (!row || Number(row.user_id) !== Number(req.userId)) {
      return res.status(404).json({ error: 'Character not found.' });
    }
    let appearance = null;
    try {
      appearance = row.avatar_look ? JSON.parse(row.avatar_look) : null;
    } catch {
      appearance = null;
    }
    res.json({ appearance, revision: Number(row.appearance_rev ?? 0) || 0 });
  });

  // PUT /api/characters/:id/appearance { appearance, expectedRev }
  // → 200 { appearance, revision }; 400 validation; 409 revision
  // conflict { error: 'revision_conflict', revision }; 403 not yours;
  // 404 character missing.
  router.put('/characters/:id/appearance', authMiddleware, async (req, res) => {
    const row = await getCharacterById(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Character not found.' });
    if (Number(row.user_id) !== Number(req.userId)) {
      return res.status(403).json({ error: 'Not your character.' });
    }
    try {
      const result = await persistAppearance({
        userId: req.userId,
        characterId: Number(req.params.id),
        appearance: req.body ? req.body.appearance : undefined,
        expectedRev: req.body ? req.body.expectedRev : undefined,
      });
      res.json({ appearance: result.appearance, revision: result.revision });
    } catch (e) {
      if (e instanceof AppearanceValidationError) {
        return res.status(400).json({ error: e.message, errors: e.errors });
      }
      if (e instanceof AppearanceConflictError) {
        return res.status(409).json({ error: 'revision_conflict', revision: e.revision });
      }
      if (e instanceof AppearanceNotFoundError) {
        return res.status(404).json({ error: 'Character not found.' });
      }
      throw e;
    }
  });

  // GET /api/avatar/catalog → { schemaVersion: 1, ...ids } — the
  // server-side mirror of the M2 avatar manifest (M6).
  router.get('/avatar/catalog', authMiddleware, (req, res) => {
    res.json(buildCatalog());
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
