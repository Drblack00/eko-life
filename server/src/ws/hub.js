// ============================================================
// ws/hub.js — Èkó Life realtime hub
// Single session per user (old session kicked). Server-authoritative:
// M1 chat + move, M2 gameplay `act` intents, 60s needs-decay tick,
// day-rollover rent, throttled position persistence.
// ============================================================
import { WebSocketServer } from 'ws';
import { verifyToken } from '../auth.js';
import {
  getUserById, getCharacter, ensureCharacter, bumpVisits, saveCharacter, setLastSeen,
  listFurniture, listAllPlacedFurniture, listCharacters, getPropertyOwnerIds, addTransaction,
  isBlocked,
} from '../db.js';
import {
  CLASSES, LOCATIONS, JOBS, FOOD, FUN, HOUSING, SPAWN, WORLD_BOUNDS,
  PROPERTIES, BIZ, VEHICLES, FURN, HOME_SLOTS, BANK, TRAVEL_FARES, STUDY_COST,
  COLLECT_RADIUS, SPAWN_TTL_MS, SPAWN_KINDS, MOVE_BASE_SPEED,
  AVATAR_BODIES, AVATAR_SKINS, AVATAR_HAIRS, AVATAR_OUTFITS, AVATAR_FABRICS,
  AVATAR_TOP_COLORS, AVATAR_BOTTOM_COLORS, DEFAULT_AVATAR, WALLS, FLOORS,
  cleanText, DAY_MS,
} from '../game/data.js';
import { decayTick, distUnits, applyDayEconomy } from '../game/sim.js';
import { handleAct, settleDayRent, settleDayEconomy, collectSpawn } from '../game/actions.js';
// M5: elections + social layer
import {
  GOV_SALARY,
  ensureElection, currentElection, playerElectionState, tallyElection,
  currentGovernorId, currentGovernorName,
} from '../game/elections.js';
import { createSocial } from './social.js';
// V2 milestones: needs/moodlets (M8), daily perks (M9), economy (M10),
// governance (M11), skills (M12) — snapshots, decay, day ticks.
import { activeShiftOf } from '../game/v2/m7.js';
import { listActiveMoodlets } from '../game/v2/m8.js';
import { activePerkEffects } from '../game/v2/m9.js';
import * as m10 from '../game/v2/m10.js';
import { isCommissioner } from '../game/v2/m11.js';
import { m12YouSnapshot } from '../game/v2/m12.js';

const CHAT_COOLDOWN_MS = 1200;
const CHAT_HISTORY = 40;
const MOVE_SAVE_MS = 15000; // persist position at most every 15s (+ on disconnect)
// M4 anti-cheat: gameplay intents are rate-limited per user — 30 acts/min
// sliding window. Past the cap, acts are dropped with an err toast.
const ACT_RATE_MAX = 30;
const ACT_RATE_WINDOW_MS = 60 * 1000;

function spawnCoords() {
  const l = LOCATIONS.find(x => x.id === SPAWN) || LOCATIONS[0];
  return { lat: l.x, lng: l.y };
}

function speedMultOf(character) {
  const v = VEHICLES[character.vehicle];
  return (v && Number(v.mult)) || 1;
}

function pickSpawnKind() {
  let r = Math.random() * 100, acc = 0;
  for (const k of SPAWN_KINDS) { acc += k.w; if (r < acc) return k; }
  return SPAWN_KINDS[0];
}

// Restore the player's last persisted position (M2); fall back to spawn
// for characters created before x/y existed (NULL in old rows).
function initialPos(character) {
  const x = Number(character.x), y = Number(character.y);
  if (Number.isFinite(x) && Number.isFinite(y)) return { lat: x, lng: y };
  return spawnCoords();
}

export function createHub({ getDay }) {
  const online = new Map(); // userId -> conn
  const chatMemory = [];    // { id, name, text, ts, gov }
  let wss = null;
  let governorId = 0; // M5: current governor (restored from meta at boot)

  // M5: social layer (news ring, friends, rooms, DMs, blocks, reports, mentions)
  const social = createSocial({
    online,
    broadcast: (msg) => broadcast(msg),
    getDay,
    isGovernor: (pid) => Number(pid) === governorId,
  });

  // ---- M3: street finds (spawns) — id -> {id,x,y,kind,icon,amount,expires} ----
  const spawns = new Map();
  let spawnSeq = 1;

  function onlineCount() { return online.size; }

  function send(conn, msg) {
    if (conn.ws.readyState === 1) conn.ws.send(JSON.stringify(msg));
  }

  function broadcast(msg, exceptId) {
    const s = JSON.stringify(msg);
    for (const [id, conn] of online) {
      if (id === exceptId) continue;
      if (conn.ws.readyState === 1) conn.ws.send(s);
    }
  }

  function publicPlayer(conn) {
    return {
      id: conn.user.id,
      name: conn.user.username,
      lat: conn.pos.lat,
      lng: conn.pos.lng,
      avatar: conn.character.avatar,
      color: conn.character.color,
    };
  }

  // Sliding-window act counter; false when this attempt is over the cap.
  function actRateOk(conn) {
    const now = Date.now();
    conn.actHits = (conn.actHits || []).filter(t => now - t < ACT_RATE_WINDOW_MS);
    conn.actHits.push(now);
    return conn.actHits.length <= ACT_RATE_MAX;
  }

  function youSnapshot(conn) {
    const c = conn.character;
    return {
      id: conn.user.id,
      username: conn.user.username,
      name: c.name,
      class: c.class,
      avatar: c.avatar,
      color: c.color,
      // M15: avatar look (parsed JSON or null) + home style ids
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
      shift: activeShiftOf(c),
      housing: c.housing,
      property: c.property,
      biz: c.biz || null,
      vehicle: c.vehicle,
      speedMult: speedMultOf(c),
      savings: Number(c.savings),
      loan: Number(c.loan),
      loan_free: !!Number(c.loan_free),
      cert: Number(c.cert),
      locationId: c.location_id,
      x: conn.pos.lat,
      y: conn.pos.lng,
      lat: conn.pos.lat,
      lng: conn.pos.lng,
      furniture: (conn.furniture || []).map(r => ({ id: r.id, item: r.item, placed: !!Number(r.placed),
        x: r.x == null ? null : Number(r.x), z: r.z == null ? null : Number(r.z), rot: r.rot == null ? null : Number(r.rot) })),
      is_admin: !!Number(conn.user.is_admin),
      guest: !!Number(conn.user.is_guest),
    };
  }

  // ---- M3: spawn API handed to action handlers (server-authoritative collect) ----
  const spawnAPI = {
    peek(id) {
      id = Number(id);
      if (!Number.isFinite(id)) return null;
      return spawns.get(id) || null;
    },
    take(id) {
      id = Number(id);
      if (!Number.isFinite(id)) return null;
      const s = spawns.get(id);
      if (!s) return null;
      spawns.delete(id);
      broadcast({ t: 'despawn', id });
      return s;
    },
  };

  // ---- M3: street-find spawn tick (expired pruned; spawns near online players) ----
  function spawnTick() {
    const now = Date.now();
    for (const [id, s] of spawns) {
      if (s.expires < now) { spawns.delete(id); broadcast({ t: 'despawn', id }); }
    }
    if (spawns.size >= 80) return;
    for (const conn of online.values()) {
      let near = 0;
      for (const s of spawns.values()) {
        if (distUnits(conn.pos.lat, conn.pos.lng, s.x, s.y) <= COLLECT_RADIUS) near++;
      }
      if (near >= 4) continue;
      const n = Math.random() < 0.5 ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const d = 0.5 + Math.random() * (COLLECT_RADIUS - 0.5); // 0.5–3.5 units away
        const x = conn.pos.lat + d * Math.cos(ang);
        const y = conn.pos.lng + d * Math.sin(ang);
        if (x < WORLD_BOUNDS.xMin || x > WORLD_BOUNDS.xMax) continue;
        if (y < WORLD_BOUNDS.yMin || y > WORLD_BOUNDS.yMax) continue;
        const kind = pickSpawnKind();
        const s = {
          id: spawnSeq++,
          x: +x.toFixed(2), y: +y.toFixed(2),
          kind: kind.kind, icon: kind.icon,
          amount: kind.kind === 'cash' ? 300 + Math.floor(Math.random() * 1200) : 0,
          expires: now + SPAWN_TTL_MS,
        };
        spawns.set(s.id, s);
        broadcast({ t: 'spawn', s });
      }
    }
  }

  async function onConnection(ws, req) {
    let token = null;
    try {
      const url = new URL(req.url, 'http://x');
      token = url.searchParams.get('token');
    } catch { /* fall through to reject */ }
    const id = verifyToken(token);
    if (!id) { ws.close(4401, 'bad token'); return; }
    const user = await getUserById(id);
    if (!user) { ws.close(4401, 'no user'); return; }
    if (Number(user.banned)) { ws.close(4403, 'banned'); return; }

    // single session per user: kick the old one
    const old = online.get(id);
    if (old) { try { old.ws.close(4409, 'new session'); } catch { /* ignore */ } }

    const character = await ensureCharacter(id, user.username);
    const pos = initialPos(character);
    character.x = pos.lat;
    character.y = pos.lng;
    const conn = {
      ws, user, character, pos, cds: {}, actHits: [], lastChat: 0, lastMoveSave: 0,
      furniture: [], lastMove: { x: pos.lat, y: pos.lng, t: Date.now() },
    };
    try { conn.furniture = await listFurniture(id); } catch (e) { console.error('[hub] furniture load:', e.message); }
    online.set(id, conn);
    // M4: roster last_seen — cheap fire-and-forget; never blocks the connect.
    setLastSeen(id).catch(e => console.error('[hub] last_seen:', e.message));

    let visits = 0;
    try { visits = await bumpVisits(); } catch (e) { console.error('[hub] bumpVisits:', e.message); }
    console.log(`[ws] + ${user.username} connected (${online.size} online)`);

    const { day, endsIn } = getDay();
    // M5: real election state, governor, friends, rooms, DM unread, news.
    // Each is guarded so a social-db hiccup never blocks the connect.
    let elState = { active: false };
    try { elState = await playerElectionState(id, day, governorId); }
    catch (e) { console.error('[init] election:', e.message); }
    let govName = null;
    try { govName = await currentGovernorName(); } catch (e) { console.error('[init] governor:', e.message); }
    let friends = [], rooms = [], unreadDm = 0;
    try {
      friends = await social.friendsFor(id);
      rooms = await social.roomListFor(id);
      unreadDm = await social.unreadDmCount(id);
    } catch (e) { console.error('[init] social:', e.message); }
    // city chat history, hiding messages from users this player blocked
    let chatHist = chatMemory.slice(-CHAT_HISTORY);
    try {
      const vis = [];
      for (const e of chatHist) { if (!(await isBlocked(id, e.id))) vis.push(e); }
      chatHist = vis;
    } catch (e) { console.error('[init] chat filter:', e.message); }
    send(conn, {
      t: 'init',
      you: youSnapshot(conn),
      players: [...online.values()].filter(c => c.user.id !== id).map(publicPlayer),
      day,
      endsIn,
      chat: chatHist,
      config: {
        classes: CLASSES, locations: LOCATIONS, jobs: JOBS,
        food: FOOD, fun: FUN, housing: HOUSING, spawn: SPAWN, bounds: WORLD_BOUNDS,
        properties: PROPERTIES, biz: BIZ, vehicles: VEHICLES, furn: FURN,
        homeSlots: HOME_SLOTS, bank: BANK, travelFares: TRAVEL_FARES, studyCost: STUDY_COST,
        // M17 fix: WS init must carry the same avatar/home-style config as
        // GET /api/config — the client prefers this object, and without it
        // the studio fell back to stale option ids the server rejects.
        avatarLook: {
          bodies: AVATAR_BODIES, skins: AVATAR_SKINS, hairs: AVATAR_HAIRS,
          outfits: AVATAR_OUTFITS, fabrics: AVATAR_FABRICS,
          topColors: AVATAR_TOP_COLORS, bottomColors: AVATAR_BOTTOM_COLORS,
          defaults: DEFAULT_AVATAR,
        },
        walls: WALLS, floors: FLOORS,
      },
      election: elState,
      governor: governorId ? { id: governorId, name: govName } : null,
      friends,
      rooms,
      unreadDm,
      news: social.getNews(),
      spawns: [...spawns.values()],
      visits,
    });
    broadcast({ t: 'join', p: publicPlayer(conn) }, id);
    broadcast({ t: 'stats', online: online.size });

    ws.on('message', async (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (!m || typeof m.t !== 'string') return;
      const now = Date.now();

      // M5: friends / rooms / DMs / blocks / reports are handled by the
      // social layer. `true` = consumed, skip the hub's own dispatch.
      try {
        if (await social.route(conn, m)) return;
      } catch (e) {
        console.error('[social]', e.message);
        return send(conn, { t: 'err', text: 'Something went wrong, try again.' });
      }

      if (m.t === 'chat') {
        if (now - conn.lastChat < CHAT_COOLDOWN_MS) {
          return send(conn, { t: 'err', text: 'Slow down on the chat.' });
        }
        conn.lastChat = now;
        const text = cleanText(m.text, 200);
        if (!text) return;
        // M11: commissioners get the 👑 badge too (async per-message is fine).
        let isGov = id === governorId;
        if (!isGov) {
          try { isGov = await isCommissioner(id); } catch { /* no badge */ }
        }
        const entry = { id, name: conn.user.username, text, ts: now, gov: isGov };
        chatMemory.push(entry);
        if (chatMemory.length > CHAT_HISTORY) chatMemory.splice(0, chatMemory.length - CHAT_HISTORY);
        await social.broadcastCityChat(entry); // hidden from players who blocked the sender
        social.notifyMentions(text, conn.user.username, id, { kind: 'city' });
      }
      else if (m.t === 'move') {
        // NOTE: lat/lng are map coordinates in 0..100 (see docs/API_SPEC.md).
        const lat = Number(m.lat);
        const lng = Number(m.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        if (lat < WORLD_BOUNDS.yMin || lat > WORLD_BOUNDS.yMax) return;
        if (lng < WORLD_BOUNDS.xMin || lng > WORLD_BOUNDS.xMax) return;
        // M3 anti-cheat: max distance = base speed × vehicle mult × elapsed,
        // with a slack margin so lag spikes don't punish legit players.
        const dist = distUnits(conn.lastMove.x, conn.lastMove.y, lat, lng);
        const dt = Math.max(0.05, (now - conn.lastMove.t) / 1000);
        const maxD = MOVE_BASE_SPEED * speedMultOf(conn.character) * dt * 1.5 + 1;
        if (dist > maxD) {
          send(conn, { t: 'snap', lat: conn.lastMove.x, lng: conn.lastMove.y });
          console.log(`[anticheat] ${conn.user.username} snapped (dist ${dist.toFixed(1)} > max ${maxD.toFixed(1)})`);
          return;
        }
        conn.lastMove = { x: lat, y: lng, t: now };
        conn.pos = { lat, lng };
        conn.character.x = lat;
        conn.character.y = lng;
        broadcast({ t: 'mv', id, lat, lng }, id);
        // throttled position persistence: at most every 15s, plus on disconnect
        if (now - conn.lastMoveSave > MOVE_SAVE_MS) {
          conn.lastMoveSave = now;
          saveCharacter(conn.character).catch(e => console.error('[hub] move save:', e.message));
        }
      }
      else if (m.t === 'act') {
        // M4 anti-cheat: over the per-user rate cap → drop with an err toast.
        if (!actRateOk(conn)) {
          console.log(`[anticheat] ${conn.user.username} act-rate-limited`);
          return send(conn, { t: 'err', text: 'Too many actions — slow down a bit.' });
        }
        // M5: election intents need day, governor, news and campaign rooms.
        const ctx = {
          conn, send, broadcast, youSnapshot, spawnAPI, getDay,
          getGovernorId: () => governorId,
          pushNews: (type, text) => social.pushNews(type, text),
          pushElectionAll,
          pushYou, // V2: re-read + push one player's `you`
          social,
        };
        handleAct(ctx, m).catch(e => {
          console.error('[act]', e.message);
          send(conn, { t: 'err', text: 'Something went wrong, try again.' });
        });
      }
      else if (m.t === 'collect') {
        // M3: dedicated street-find message (also available as act collect).
        const ctx = { conn, send, broadcast, youSnapshot, spawnAPI };
        collectSpawn(ctx, m.id).then((res) => {
          if (!res.ok) send(conn, { t: 'err', text: res.error });
        }).catch(e => {
          console.error('[collect]', e.message);
          send(conn, { t: 'err', text: 'Something went wrong, try again.' });
        });
      }
      // unknown message types are ignored safely (M4+ adds more gameplay handlers)
    });

    ws.on('close', () => {
      if (online.get(id) === conn) {
        online.delete(id);
        // persist position on disconnect (fire-and-forget; socket is gone).
        persistPos(id, conn);
        broadcast({ t: 'leave', id });
        broadcast({ t: 'stats', online: online.size });
        console.log(`[ws] - ${conn.user.username} left (${online.size} online)`);
      }
    });

    ws.on('error', () => { /* close handler does cleanup */ });
  }

  // ---- M3: offline day economy — business income, savings/loan interest and
  // placed-furniture day-hook happiness are DB-credited for players who are offline.
  // Online players get the same treatment live via settleDayEconomy.
  async function settleOfflineEconomy() {
    let chars;
    try {
      chars = await listCharacters();
    } catch (e) { console.error('[economy] listCharacters:', e.message); return; }
    let furn = [];
    try { furn = await listAllPlacedFurniture(); } catch (e) { console.error('[economy] furniture:', e.message); }
    // placed furniture day hooks (gen/drum/mirror, ...) apply per owner
    const placedByOwner = new Map();
    for (const f of furn) {
      const k = Number(f.owner_id);
      if (!placedByOwner.has(k)) placedByOwner.set(k, []);
      placedByOwner.get(k).push(f.item);
    }
    for (const ch of chars) {
      const userId = Number(ch.user_id);
      if (online.has(userId)) continue; // handled live
      const bizDef = (ch.biz && BIZ[ch.biz]) || null;
      const propDef = (ch.property && PROPERTIES[ch.property]) || null;
      const placed = placedByOwner.get(userId) || [];
      const res = applyDayEconomy(ch, { bizDef, propDef, placed });
      if (!res.dirty) continue;
      try {
        if (res.income > 0) await addTransaction(userId, 'biz_income', res.income, ch.money, { biz: ch.biz });
        if (res.savingsInterest > 0) await addTransaction(userId, 'savings_interest', res.savingsInterest, ch.savings, { balance: 'savings' });
        if (res.loanInterest > 0) await addTransaction(userId, 'loan_interest', res.loanInterest, ch.loan, { balance: 'loan' });
        await saveCharacter(ch);
      } catch (e) { console.error('[economy] offline credit:', e.message); }
    }
    console.log(`[economy] offline day-economy settled (${chars.length} players)`);
  }

  // ---- Day rollover: rent (M2) → day economy (M3) → announce ----
  // M5: election tick (tally when the cycle's end day arrives) + the
  // governor's ₦25,000/day salary, credited before the day broadcast.
  async function dayRollover() {
    const ctx = { conn: null, send, broadcast, youSnapshot, spawnAPI, getDay,
      getGovernorId: () => governorId,
      pushNews: (type, text) => social.pushNews(type, text),
      pushElectionAll,
      pushYou, // V2: M10 owner refreshes
      social };
    for (const conn of online.values()) {
      ctx.conn = conn;
      try {
        await settleDayRent(ctx, conn);
      } catch (e) { console.error('[rent]', e.message); }
      try {
        await settleDayEconomy(ctx, conn);
      } catch (e) { console.error('[economy]', e.message); }
      // M10: LAPO auto-debits + weekly tax for online players.
      try { await m10.settleOnlinePlayer(ctx, conn); } catch (e) { console.error('[m10]', e.message); }
    }
    try { await settleOfflineEconomy(); } catch (e) { console.error('[economy]', e.message); }
    // M10: LAPO auto-debits + weekly tax for offline players (DB-credited).
    try { await m10.settleOfflinePlayers(ctx, (id) => online.has(Number(id))); } catch (e) { console.error('[m10]', e.message); }
    const { day } = getDay();
    try {
      let el = await currentElection();
      if (!el) el = await ensureElection(day); // safety net: never day without a cycle
      if (el && day >= el.end_day) {
        await settleElection();
      }
    } catch (e) { console.error('[election]', e.message); }
    try { await creditGovernorSalary(); } catch (e) { console.error('[gov salary]', e.message); }
    broadcast({ t: 'day', day, endsIn: DAY_MS });
  }

  // ---- V2: send a raw message to one online user ----
  function sendTo(userId, msg) {
    const conn = online.get(Number(userId));
    if (conn) send(conn, msg);
  }

  // ---- V2: push a fresh `you` snapshot to one player ----
  // Re-reads the character row (covers DB-credit paths like M7 shift ticks
  // and M10 owner refreshes), merges the async M12 skills/academy fields.
  async function pushYou(userId) {
    const conn = online.get(Number(userId));
    if (!conn) return;
    try {
      const fresh = await getCharacter(Number(userId));
      if (fresh) conn.character = fresh;
    } catch (e) { console.error('[pushYou] re-read:', e.message); }
    let extra = {};
    try { extra = await m12YouSnapshot(conn); } catch (e) { console.error('[pushYou] m12:', e.message); }
    send(conn, { t: 'you', you: { ...youSnapshot(conn), ...extra } });
  }

  // ---- M5: push fresh per-player election state to everyone online ----
  async function pushElectionAll() {
    const { day } = getDay();
    for (const conn of online.values()) {
      try {
        send(conn, { t: 'election', ...(await playerElectionState(conn.user.id, day, governorId)) });
      } catch (e) { console.error('[election] push:', e.message); }
    }
  }

  // ---- M5: run one full election tally ----
  // Tallies votes, announces the winner ({t:'gov'} + sys + news), opens the
  // next 7-day cycle, closes finished campaign rooms and pushes fresh
  // per-player election state to everyone online.
  async function settleElection() {
    const { day } = getDay();
    const { winnerId, closedRoomIds } = await tallyElection({
      day, broadcast, pushNews: social.pushNews,
    });
    governorId = await currentGovernorId();
    for (const rid of closedRoomIds) social.dropRoomHistory(rid);
    await social.refreshRooms();
    await pushElectionAll();
    return winnerId;
  }

  // ---- M5: governor salary — ₦25,000/day into the governor's pocket ----
  async function creditGovernorSalary() {
    if (!governorId) return;
    const conn = online.get(governorId);
    if (conn) {
      // Online: mutate the live session's character (the session owns it).
      const c = conn.character;
      c.money = Math.max(0, Math.floor(Number(c.money))) + GOV_SALARY;
      await addTransaction(governorId, 'gov_salary', GOV_SALARY, c.money, {});
      await saveCharacter(c);
      const out = { t: 'you', you: youSnapshot(conn) };
      out.note = `👑 Governor salary: +₦${GOV_SALARY.toLocaleString('en-NG')}`;
      send(conn, out);
    } else {
      // Offline: DB-credit, same as the offline day economy.
      const ch = await getCharacter(governorId);
      if (!ch) return;
      ch.money = Math.max(0, Math.floor(Number(ch.money))) + GOV_SALARY;
      await addTransaction(governorId, 'gov_salary', GOV_SALARY, ch.money, {});
      await saveCharacter(ch);
    }
    console.log(`[gov] salary +${GOV_SALARY} → player ${governorId}`);
  }

  // ---- M2: 60s needs-decay tick — mutate, persist, push fresh `you` ----
  async function decayTickAll() {
    for (const conn of online.values()) {
      try {
        const moodlets = await listActiveMoodlets(conn.user.id);
        const effects = activePerkEffects(conn.character);
        const res = decayTick(conn.character, { moodlets, perks: effects });
        await saveCharacter(conn.character);
        let extra = {};
        try { extra = await m12YouSnapshot(conn); } catch (e) { console.error('[decay] m12:', e.message); }
        const out = { t: 'you', you: { ...youSnapshot(conn), moodlets, ...extra } };
        const dnotes = [];
        if (res.starving) dnotes.push('🍽️ You are starving! Eat something soon.');
        if (res.desperate) dnotes.push('💧 Bladder critical! Find a toilet.');
        if (res.grimy) dnotes.push('🚿 You need a shower - hygiene is tanking.');
        if (res.lonely) dnotes.push('😔 You feel lonely. Spend time with people.');
        if (res.bored) dnotes.push('🥱 You are bored stiff. Do something fun!');
        if (dnotes.length) out.note = dnotes[0];
        send(conn, out);
      } catch (e) { console.error('[decay]', e.message); }
    }
    console.log(`[decay] tick — ${online.size} online`);
  }

  function attach(server) {
    wss = new WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (ws, req) => {
      onConnection(ws, req).catch(e => {
        console.error('[ws] connection error:', e.message);
        try { ws.close(1011, 'server error'); } catch { /* ignore */ }
      });
    });
    console.log('[ws] hub attached on /ws');
  }

  // ---- M5: boot — seed rooms, ensure an election cycle, restore governor ----
  async function bootGame() {
    await social.seedRooms();
    await ensureElection(getDay().day);
    governorId = await currentGovernorId();
    console.log(`[boot] M5: rooms seeded, election live, governor=${governorId || 'none'}`);
  }

  // M5: admin-forced tally (POST /api/admin/end-election).
  function forceTally() { return settleElection(); }

  function getNews() { return social.getNews(); }

  function governorName() { return currentGovernorName(); }

  /**
   * M6: synchronously drop a player's live session (e.g. admin ban).
   * Removes them from the online registry immediately — the roster is
   * correct before the socket's close frame even goes out — then closes
   * the socket. The server's own 'close' handler becomes a no-op.
   */
  function forceDisconnect(userId, code = 4403, reason = 'kicked') {
    const conn = online.get(Number(userId));
    if (!conn) return false;
    online.delete(Number(userId));
    persistPos(Number(userId), conn);
    broadcast({ t: 'leave', id: Number(userId) });
    broadcast({ t: 'stats', online: online.size });
    try { conn.ws.close(code, reason); } catch { /* already gone */ }
    console.log(`[ws] ! ${conn.user.username} force-disconnected (${code})`);
    return true;
  }

  /** Persist a session's last position (used on disconnect and force-kick). */
  function persistPos(id, conn) {
    // Re-read the row so a stale in-session copy never clobbers stats —
    // only x/y are updated here.
    (async () => {
      try {
        const fresh = await getCharacter(id);
        if (fresh) {
          fresh.x = conn.pos.lat;
          fresh.y = conn.pos.lng;
          await saveCharacter(fresh);
        }
      } catch (e) { console.error('[hub] disconnect save:', e.message); }
    })();
  }

  return {
    attach, broadcast, onlineCount, online, dayRollover, decayTickAll, spawnTick, spawnAPI,
    bootGame, forceTally, getNews, governorName, forceDisconnect, pushYou, sendTo,
    pushNews: (type, text) => social.pushNews(type, text),
  };
}
