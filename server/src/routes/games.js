// ============================================================
// routes/games.js — Table-games REST API (game-money only).
//
// Lobby + stake escrow + instant result recording + hall of fame.
// v1 matches resolve instantly vs the documented placeholder AI
// ("Èkó CPU", see game/tablegames.js simulateMatch); real-time
// multiplayer + stronger AI are deferred — the endpoints below are
// the stable contract that work will build on.
//
// Every route requires Bearer <redacted> Game coins only — nothing here
// touches real money.
// ============================================================
import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import {
  getUserById, ensureCharacter, saveCharacter, addTransaction,
  dbGet, dbAll, dbRun, dbRunReturning,
} from '../db.js';
import { canAfford, charge } from '../game/money.js';
import {
  GAMES, GAME_MAP, gameByKey, VENUES, VENUE_MAP, VARIANTS,
  STAKE_TIERS, HOUSE_CUT_PCT, CPU_NAME,
  potFor, winnerPayout, houseKeeps, shortfall,
  simulateMatch, SCHEMA_SQLITE, SCHEMA_PG, schemaStatements,
} from '../game/tablegames.js';

/** Rewrite `?` placeholders to `$1..$n` for the Postgres variant. */
function pg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/** How long a finished match stays on the "On the tables now" rail (replay window). */
const LIVE_WINDOW_MS = 120_000;

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  const mode = process.env.DATABASE_URL ? 'pg' : 'sqlite';
  const stmts = schemaStatements(mode === 'pg' ? SCHEMA_PG : SCHEMA_SQLITE);
  for (const s of stmts) await dbRun(s, s);
  schemaReady = true;
}

/** Insert + return the new row id on both dialects. */
async function insertId(sqliteSql, pgSql, params) {
  const r = await dbRunReturning(sqliteSql, `${pgSql} RETURNING id`, params);
  if (r.rows && r.rows.length) return Number(r.rows[0].id);
  const row = await dbGet('SELECT last_insert_rowid() AS id', 'SELECT 1', []);
  return Number(row.id);
}

const USER_RE = /^[a-zA-Z0-9_]{3,16}$/;

function cleanUsername(v) {
  const s = String(v || '').trim();
  return USER_RE.test(s) ? s : null;
}

function parseGame(v) {
  const g = gameByKey(v);
  return g ? g.key : null;
}

function parseVenue(v) {
  const s = String(v || '').trim();
  return VENUE_MAP[s] ? s : null;
}

function parseVariant(game, v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  return game.variants.includes(s) ? s : null;
}

function parseStake(v) {
  const n = Math.floor(Number(v));
  return STAKE_TIERS.includes(n) ? n : null;
}

function tableJson(t, seats) {
  const game = GAME_MAP[t.game_key];
  const venue = VENUE_MAP[t.venue];
  return {
    id: t.id,
    game: { key: game.key, name: game.name, icon: game.icon, tagline: game.tagline },
    venue: venue ? { key: venue.key, name: venue.name, icon: venue.icon } : { key: t.venue, name: t.venue, icon: '📍' },
    stake: t.stake,
    variant: t.variant ? VARIANTS[t.variant] : null,
    creatorUsername: t.creator_username,
    friendInvite: t.friend_invite,
    seatsTaken: seats.length,
    seatsTotal: t.seats_total,
    seats: seats.map((s) => s.username),
    winnerTakes: winnerPayout(t.stake, 2),
    createdAt: t.created_at,
  };
}

async function seatsFor(tableId) {
  return dbAll(
    'SELECT user_id AS userId, username, escrowed FROM tg_seats WHERE table_id=? ORDER BY joined_at ASC',
    pg('SELECT user_id AS "userId", username, escrowed FROM tg_seats WHERE table_id=? ORDER BY joined_at ASC'),
    [tableId],
  );
}

async function getTable(id) {
  return dbGet(
    `SELECT id, game_key AS gameKey, venue, stake, seats_total AS seatsTotal, variant,
            creator_user_id AS creatorUserId, creator_username AS creatorUsername,
            friend_invite AS friendInvite, status, reported, created_at AS createdAt
     FROM tg_tables WHERE id=?`,
    pg(`SELECT id, game_key AS "gameKey", venue, stake, seats_total AS "seatsTotal", variant,
               creator_user_id AS "creatorUserId", creator_username AS "creatorUsername",
               friend_invite AS "friendInvite", status, reported, created_at AS "createdAt"
        FROM tg_tables WHERE id=?`),
    [Number(id)],
  );
}

function mapRow(t) {
  // normalize camelCase aliases for both dialects (sqlite returns as-aliased)
  return {
    id: t.id,
    game_key: t.gameKey || t.game_key,
    venue: t.venue,
    stake: t.stake,
    seats_total: t.seatsTotal || t.seats_total,
    variant: t.variant,
    creator_user_id: t.creatorUserId || t.creator_user_id,
    creator_username: t.creatorUsername || t.creator_username,
    friend_invite: t.friendInvite !== undefined ? t.friendInvite : t.friend_invite,
    status: t.status,
    reported: t.reported,
    created_at: t.createdAt || t.created_at,
  };
}

/** Credit coins to a player's character + ledger line. Caller owns saveCharacter timing. */
function creditCoins(c, amt) {
  c.money = Math.floor(Number(c.money) || 0) + Math.floor(Number(amt) || 0);
}

export function createGamesRouter() {
  const router = Router();
  router.use(authMiddleware);
  router.use(async (_req, _res, next) => {
    try { await ensureSchema(); next(); } catch (e) { next(e); }
  });

  // ---- catalogue -------------------------------------------------
  router.get('/', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      const c = await ensureCharacter(user.id, user.username);
      res.json({
        games: GAMES,
        stakes: STAKE_TIERS,
        venues: VENUES,
        variants: VARIANTS,
        houseCutPct: HOUSE_CUT_PCT,
        cpuName: CPU_NAME,
        myBalance: Math.floor(Number(c.money) || 0),
        note: 'Matches are played against Èkó CPU (placeholder AI). Real-time multiplayer arrives in a later update.',
      });
    } catch (e) { console.error('[games] catalogue:', e.message); res.status(500).json({ error: 'Could not load the games hall.' }); }
  });

  // ---- open tables ------------------------------------------------
  router.get('/tables', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      const gameKey = req.query.game ? parseGame(req.query.game) : null;
      if (req.query.game && !gameKey) return res.status(400).json({ error: 'Unknown game.' });
      const rows = await dbAll(
        `SELECT id, game_key AS gameKey, venue, stake, seats_total AS seatsTotal, variant,
                creator_user_id AS creatorUserId, creator_username AS creatorUsername,
                friend_invite AS friendInvite, status, reported, created_at AS createdAt
         FROM tg_tables WHERE status='open' AND reported=0
         ${gameKey ? 'AND game_key=?' : ''} ORDER BY created_at DESC LIMIT 60`,
        pg(`SELECT id, game_key AS "gameKey", venue, stake, seats_total AS "seatsTotal", variant,
                   creator_user_id AS "creatorUserId", creator_username AS "creatorUsername",
                   friend_invite AS "friendInvite", status, reported, created_at AS "createdAt"
            FROM tg_tables WHERE status='open' AND reported=0
            ${gameKey ? 'AND game_key=$1' : ''} ORDER BY created_at DESC LIMIT 60`),
        gameKey ? [gameKey] : [],
      );
      const tables = [];
      for (const r of rows) {
        const t = mapRow(r);
        tables.push(tableJson(t, await seatsFor(t.id)));
      }
      const c = await ensureCharacter(user.id, user.username);
      const balance = Math.floor(Number(c.money) || 0);
      res.json({
        tables: tables.map((t) => ({ ...t, needMore: shortfall(balance, t.stake) })),
        myBalance: balance,
      });
    } catch (e) { console.error('[games] tables:', e.message); res.status(500).json({ error: 'Could not load tables.' }); }
  });

  // ---- create a table ---------------------------------------------
  router.post('/tables', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      const body = req.body || {};
      const game = gameByKey(body.game);
      if (!game) return res.status(400).json({ error: 'Pick a game first.' });
      const venue = parseVenue(body.venue);
      if (!venue) return res.status(400).json({ error: 'Pick a venue first.' });
      const stake = parseStake(body.stake);
      if (stake == null) return res.status(400).json({ error: 'Pick a stake.' });
      const variant = parseVariant(game, body.variant);
      if (body.variant && !variant) return res.status(400).json({ error: 'That variant is not offered for this game.' });
      let friendInvite = null;
      if (body.friendInvite) {
        friendInvite = cleanUsername(body.friendInvite);
        if (!friendInvite) return res.status(400).json({ error: 'Invite needs a valid @username.' });
        if (friendInvite.toLowerCase() === user.username.toLowerCase()) {
          return res.status(400).json({ error: 'You cannot invite yourself.' });
        }
      }
      const c = await ensureCharacter(user.id, user.username);
      const isAdmin = !!Number(user.is_admin);
      if (!canAfford(c, stake, isAdmin)) {
        return res.status(400).json({ error: `You need ₦${shortfall(c.money, stake).toLocaleString('en-NG')} more for this table.` });
      }
      // Creation fee equals the stake: the creator's seat is escrowed now.
      const escrowed = charge(c, stake, isAdmin);
      await saveCharacter(c);
      await addTransaction(user.id, 'games_escrow', -escrowed, Math.floor(Number(c.money) || 0),
        { action: 'create_table', stake });
      const now = Date.now();
      const tableId = await insertId(
        `INSERT INTO tg_tables (game_key, venue, stake, seats_total, variant, creator_user_id,
           creator_username, friend_invite, status, created_at)
         VALUES (?,?,?,?,?,?,?,?, 'open', ?)`,
        pg(`INSERT INTO tg_tables (game_key, venue, stake, seats_total, variant, creator_user_id,
           creator_username, friend_invite, status, created_at)
         VALUES (?,?,?,?,?,?,?,?, 'open', ?)`),
        [game.key, venue, stake, game.seats, variant, user.id, user.username, friendInvite, now],
      );
      await dbRun(
        'INSERT INTO tg_seats (table_id, user_id, username, escrowed, joined_at) VALUES (?,?,?,?,?)',
        pg('INSERT INTO tg_seats (table_id, user_id, username, escrowed, joined_at) VALUES (?,?,?,?,?)'),
        [tableId, user.id, user.username, escrowed, now],
      );
      const t = mapRow(await getTable(tableId));
      res.status(201).json({
        table: tableJson(t, await seatsFor(tableId)),
        myBalance: Math.floor(Number(c.money) || 0),
      });
    } catch (e) { console.error('[games] create:', e.message); res.status(500).json({ error: 'Could not create the table.' }); }
  });

  // ---- join a table ------------------------------------------------
  router.post('/tables/:id/join', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      const t = mapRow(await getTable(req.params.id));
      if (!t || t.status !== 'open' || t.reported) return res.status(404).json({ error: 'That table is gone.' });
      const seats = await seatsFor(t.id);
      if (seats.some((s) => Number(s.userId) === user.id)) {
        return res.status(400).json({ error: 'You are already seated here.' });
      }
      if (seats.length >= t.seats_total) return res.status(400).json({ error: 'This table is full.' });
      const c = await ensureCharacter(user.id, user.username);
      const isAdmin = !!Number(user.is_admin);
      if (!canAfford(c, t.stake, isAdmin)) {
        return res.status(400).json({ error: `You need ₦${shortfall(c.money, t.stake).toLocaleString('en-NG')} more to sit here.` });
      }
      const escrowed = charge(c, t.stake, isAdmin);
      await saveCharacter(c);
      await addTransaction(user.id, 'games_escrow', -escrowed, Math.floor(Number(c.money) || 0),
        { action: 'join_table', table_id: t.id, stake: t.stake });
      let seatCount;
      try {
        await dbRun(
          'INSERT INTO tg_seats (table_id, user_id, username, escrowed, joined_at) VALUES (?,?,?,?,?)',
          pg('INSERT INTO tg_seats (table_id, user_id, username, escrowed, joined_at) VALUES (?,?,?,?,?)'),
          [t.id, user.id, user.username, escrowed, Date.now()],
        );
      } catch (e) {
        if (e && /UNIQUE/i.test(e.message)) return res.status(400).json({ error: 'You are already seated here.' });
        throw e;
      }
      seatCount = (await seatsFor(t.id)).length;
      if (seatCount > t.seats_total) {
        // Lost a race for the last seat: stand back up and refund in full.
        await dbRun('DELETE FROM tg_seats WHERE table_id=? AND user_id=?',
          pg('DELETE FROM tg_seats WHERE table_id=? AND user_id=?'), [t.id, user.id]);
        if (escrowed > 0) {
          const c2 = await ensureCharacter(user.id, user.username);
          c2.money = Math.floor(Number(c2.money) || 0) + escrowed;
          await saveCharacter(c2);
          await addTransaction(user.id, 'games_refund', escrowed, Math.floor(Number(c2.money) || 0),
            { reason: 'join_race_refund', table_id: t.id });
        }
        return res.status(409).json({ error: 'That seat just filled up.' });
      }
      res.json({
        table: tableJson(t, await seatsFor(t.id)),
        myBalance: Math.floor(Number(c.money) || 0),
      });
    } catch (e) {
      if (e && /UNIQUE/i.test(e.message)) return res.status(400).json({ error: 'You are already seated here.' });
      console.error('[games] join:', e.message); res.status(500).json({ error: 'Could not join the table.' });
    }
  });

  // ---- leave a table (stake refunded) -------------------------------
  router.post('/tables/:id/leave', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      const t = mapRow(await getTable(req.params.id));
      if (!t || t.status !== 'open') return res.status(404).json({ error: 'That table is gone.' });
      const seats = await seatsFor(t.id);
      const mine = seats.find((s) => Number(s.userId) === user.id);
      if (!mine) return res.status(400).json({ error: 'You are not seated here.' });
      await dbRun('DELETE FROM tg_seats WHERE table_id=? AND user_id=?',
        pg('DELETE FROM tg_seats WHERE table_id=? AND user_id=?'), [t.id, user.id]);
      let balance = 0;
      const escrowed = Math.floor(Number(mine.escrowed) || 0);
      if (escrowed > 0) {
        const c = await ensureCharacter(user.id, user.username);
        creditCoins(c, escrowed);
        await saveCharacter(c);
        await addTransaction(user.id, 'games_refund', escrowed, Math.floor(Number(c.money) || 0), { reason: 'leave_table' });
        balance = Math.floor(Number(c.money) || 0);
      } else {
        balance = Math.floor(Number((await ensureCharacter(user.id, user.username)).money) || 0);
      }
      const rest = await seatsFor(t.id);
      if (rest.length === 0) {
        await dbRun("UPDATE tg_tables SET status='done' WHERE id=?", pg("UPDATE tg_tables SET status='done' WHERE id=?"), [t.id]);
      }
      res.json({ ok: true, myBalance: balance });
    } catch (e) { console.error('[games] leave:', e.message); res.status(500).json({ error: 'Could not leave the table.' }); }
  });

  // ---- start my match (vs Èkó CPU, instant) --------------------------
  // v1: each seated human resolves their own match. The pot for the
  // match is stake x 2 (you + the CPU). Combined-pot multiplayer
  // tables arrive with real-time play (deferred).
  router.post('/tables/:id/start', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      const t = mapRow(await getTable(req.params.id));
      if (!t || t.status !== 'open' || t.reported) return res.status(404).json({ error: 'That table is gone.' });
      const seats = await seatsFor(t.id);
      const mine = seats.find((s) => Number(s.userId) === user.id);
      if (!mine) return res.status(400).json({ error: 'Take a seat before you start.' });

      const sim = simulateMatch(t.game_key, Math.random);
      const pot = potFor(t.stake, 2);
      const payout = winnerPayout(t.stake, 2);
      const kept = houseKeeps(t.stake, 2);
      const now = Date.now();
      const c = await ensureCharacter(user.id, user.username);

      let winner, winnerUserId = null, winnerUsername = null, paid = 0;
      if (sim.outcome === 'win') {
        winner = 'player'; winnerUserId = user.id; winnerUsername = user.username;
        paid = payout;
        creditCoins(c, paid);
        await addTransaction(user.id, 'games_win', paid, Math.floor(Number(c.money) || 0),
          { game: t.game_key, stake: t.stake, pot, house_kept: kept });
      } else if (sim.outcome === 'draw') {
        winner = 'draw';
        // Draw: the player's own stake comes back (escrow was never at risk).
        creditCoins(c, Math.floor(Number(mine.escrowed) || 0));
        await addTransaction(user.id, 'games_refund', Math.floor(Number(mine.escrowed) || 0),
          Math.floor(Number(c.money) || 0), { reason: 'draw_refund' });
      } else {
        winner = 'cpu'; winnerUsername = CPU_NAME;
        await addTransaction(user.id, 'games_loss', 0, Math.floor(Number(c.money) || 0),
          { game: t.game_key, stake: t.stake, pot, escrowed: mine.escrowed });
      }
      await saveCharacter(c);
      const balance = Math.floor(Number(c.money) || 0);

      const matchId = await insertId(
        `INSERT INTO tg_matches (table_id, game_key, venue, stake, seats_total, pot, winner,
            winner_user_id, winner_username, payout, log_json, status, created_at, finished_at, live_until)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'done',?,?,?)`,
        pg(`INSERT INTO tg_matches (table_id, game_key, venue, stake, seats_total, pot, winner,
            winner_user_id, winner_username, payout, log_json, status, created_at, finished_at, live_until)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'done',?,?,?)`),
        [t.id, t.game_key, t.venue, t.stake, 2, pot, winner, winnerUserId, winnerUsername,
          paid, JSON.stringify(sim.log), now, now, now + LIVE_WINDOW_MS],
      );

      // Hall of fame: money games only (stake > 0).
      if (t.stake > 0) {
        const won = sim.outcome === 'win' ? 1 : 0;
        await dbRun(
          `INSERT INTO tg_hof (user_id, username, game_key, games, wins, best_pot)
           VALUES (?,?,?,1,?,?)
           ON CONFLICT(user_id, game_key) DO UPDATE SET
             games = tg_hof.games + 1,
             wins = tg_hof.wins + ?,
             username = excluded.username,
             best_pot = MAX(tg_hof.best_pot, excluded.best_pot)`,
          pg(`INSERT INTO tg_hof (user_id, username, game_key, games, wins, best_pot)
           VALUES ($1,$2,$3,1,$4,$5)
           ON CONFLICT (user_id, game_key) DO UPDATE SET
             games = tg_hof.games + 1,
             wins = tg_hof.wins + $4,
             username = EXCLUDED.username,
             best_pot = GREATEST(tg_hof.best_pot, EXCLUDED.best_pot)`),
          [user.id, user.username, t.game_key, won, paid, won],
        );
      }

      // My seat is consumed; table closes when nobody is seated.
      await dbRun('DELETE FROM tg_seats WHERE table_id=? AND user_id=?',
        pg('DELETE FROM tg_seats WHERE table_id=? AND user_id=?'), [t.id, user.id]);
      const rest = await seatsFor(t.id);
      if (rest.length === 0) {
        await dbRun("UPDATE tg_tables SET status='done' WHERE id=?", pg("UPDATE tg_tables SET status='done' WHERE id=?"), [t.id]);
      }

      res.json({
        match: {
          id: matchId,
          game: GAME_MAP[t.game_key].name,
          gameIcon: GAME_MAP[t.game_key].icon,
          stake: t.stake,
          pot,
          outcome: sim.outcome,
          scoreText: sim.scoreText,
          log: sim.log,
          payout: paid,
          houseKept: kept,
          winner: winner === 'player' ? user.username : winnerUsername,
        },
        myBalance: balance,
        note: t.stake === 0 ? 'Friendly table — no coins moved.' : undefined,
      });
    } catch (e) { console.error('[games] start:', e.message); res.status(500).json({ error: 'Could not start the match.' }); }
  });

  // ---- on the tables now (replay window) ------------------------------
  router.get('/live', async (req, res) => {
    try {
      const now = Date.now();
      const rows = await dbAll(
        `SELECT id, game_key AS gameKey, venue, stake, pot, winner, winner_username AS winnerUsername,
                payout, log_json AS logJson, finished_at AS finishedAt, live_until AS liveUntil
         FROM tg_matches WHERE live_until > ? AND reported=0 ORDER BY finished_at DESC LIMIT 20`,
        pg(`SELECT id, game_key AS "gameKey", venue, stake, pot, winner, winner_username AS "winnerUsername",
                   payout, log_json AS "logJson", finished_at AS "finishedAt", live_until AS "liveUntil"
            FROM tg_matches WHERE live_until > $1 AND reported=0 ORDER BY finished_at DESC LIMIT 20`),
        [now],
      );
      res.json({
        live: rows.map((m) => ({
          id: m.id,
          game: GAME_MAP[m.gameKey] ? { key: m.gameKey, name: GAME_MAP[m.gameKey].name, icon: GAME_MAP[m.gameKey].icon } : { key: m.gameKey, name: m.gameKey, icon: '🎮' },
          stake: m.stake,
          pot: m.pot,
          winner: m.winnerUsername,
          payout: m.payout,
          justFinished: now - m.finishedAt < 60_000,
        })),
      });
    } catch (e) { console.error('[games] live:', e.message); res.status(500).json({ error: 'Could not load live matches.' }); }
  });

  // ---- watch a match (scoreboard replay) --------------------------------
  router.get('/live/:id', async (req, res) => {
    try {
      const m = await dbGet(
        `SELECT id, game_key AS gameKey, venue, stake, seats_total AS seatsTotal, pot, winner,
                winner_user_id AS winnerUserId, winner_username AS winnerUsername,
                payout, log_json AS logJson, finished_at AS finishedAt
         FROM tg_matches WHERE id=?`,
        pg(`SELECT id, game_key AS "gameKey", venue, stake, seats_total AS "seatsTotal", pot, winner,
                   winner_user_id AS "winnerUserId", winner_username AS "winnerUsername",
                   payout, log_json AS "logJson", finished_at AS "finishedAt"
            FROM tg_matches WHERE id=$1`),
        [Number(req.params.id)],
      );
      if (!m) return res.status(404).json({ error: 'Match not found.' });
      let log = [];
      try { log = JSON.parse(m.logJson || '[]'); } catch { /* keep empty */ }
      res.json({
        id: m.id,
        game: GAME_MAP[m.gameKey] ? { key: m.gameKey, name: GAME_MAP[m.gameKey].name, icon: GAME_MAP[m.gameKey].icon } : { key: m.gameKey, name: m.gameKey, icon: '🎮' },
        venue: VENUE_MAP[m.venue] ? VENUE_MAP[m.venue].name : m.venue,
        stake: m.stake,
        pot: m.pot,
        winner: m.winnerUsername,
        payout: m.payout,
        log,
        finishedAt: m.finishedAt,
      });
    } catch (e) { console.error('[games] watch:', e.message); res.status(500).json({ error: 'Could not load the match.' }); }
  });

  // ---- hall of fame ------------------------------------------------------
  router.get('/fame/:game', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      const game = gameByKey(req.params.game);
      if (!game) return res.status(400).json({ error: 'Unknown game.' });
      const rows = await dbAll(
        `SELECT user_id AS userId, username, games, wins, best_pot AS bestPot
         FROM tg_hof WHERE game_key=? ORDER BY wins DESC, best_pot DESC LIMIT 10`,
        pg(`SELECT user_id AS "userId", username, games, wins, best_pot AS "bestPot"
            FROM tg_hof WHERE game_key=$1 ORDER BY wins DESC, best_pot DESC LIMIT 10`),
        [game.key],
      );
      const leaders = rows.map((r, i) => ({
        rank: i + 1,
        username: r.username,
        games: r.games,
        winPct: r.games ? Math.round((r.wins / r.games) * 100) : 0,
        bestPot: r.bestPot,
        isYou: Number(r.userId) === user.id,
      }));
      const mine = await dbGet(
        'SELECT games, wins, best_pot AS bestPot FROM tg_hof WHERE user_id=? AND game_key=?',
        pg('SELECT games, wins, best_pot AS "bestPot" FROM tg_hof WHERE user_id=$1 AND game_key=$2'),
        [user.id, game.key],
      );
      res.json({
        game: { key: game.key, name: game.name, icon: game.icon },
        leaders,
        me: mine
          ? { games: mine.games, wins: mine.wins, winPct: Math.round((mine.wins / mine.games) * 100), bestPot: mine.bestPot }
          : null,
        emptyCopy: `You haven't played a money game of ${game.name} yet.`,
      });
    } catch (e) { console.error('[games] fame:', e.message); res.status(500).json({ error: 'Could not load the hall of fame.' }); }
  });

  // ---- reports -------------------------------------------------------------
  router.post('/tables/:id/report', async (req, res) => {
    try {
      await dbRun('UPDATE tg_tables SET reported=1 WHERE id=?', pg('UPDATE tg_tables SET reported=1 WHERE id=?'), [Number(req.params.id)]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: 'Could not report.' }); }
  });
  router.post('/matches/:id/report', async (req, res) => {
    try {
      await dbRun('UPDATE tg_matches SET reported=1 WHERE id=?', pg('UPDATE tg_matches SET reported=1 WHERE id=?'), [Number(req.params.id)]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: 'Could not report.' }); }
  });

  return router;
}
