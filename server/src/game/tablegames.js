// ============================================================
// game/tablegames.js — Parlor games framework (game-money only).
//
// Five ORIGINAL parlor games with an Èkó flavor. Mechanics are
// re-implemented from scratch; all names, copy, rules text, and
// presentation here are our own.
//
// DEFERRED BY DESIGN (v1 scope): real-time multiplayer and strong AI
// opponents are a follow-up. In v1, lobby + stake escrow + result
// recording + hall of fame are solid; each match is resolved
// instantly against a simple, fully documented placeholder opponent
// ("Èkó CPU") — see simulateMatch(). The v1 AI is intentionally
// dumb: near-even odds with a small draw chance, no skill model.
// A future builder should replace simulateMatch() with a real
// engine and add live seat-filling over the socket hub.
//
// Money rules (game coins only — NEVER real money):
// - Creating or joining a table escrows the player's stake.
// - Winner takes 95% of the pot (HOUSE_CUT = 5%). Pot = stake x seats.
// - A draw refunds every human's stake.
// - When the CPU wins, its share stays with the house (no payout).
// - Friendly (₦0) tables: no escrow, no payouts, still recorded.
// ============================================================

export const HOUSE_CUT_PCT = 5;

/** Stake tiers in gameplay coins. 0 = Friendly (no money on the line). */
export const STAKE_TIERS = [0, 1000, 5000, 20000, 50000, 100000, 500000, 1000000, 5000000, 10000000];

/** CPU placeholder opponent identity. */
export const CPU_NAME = 'Èkó CPU';

/**
 * The five games. `seats` = table size; `variants` = supported table
 * variants; `rules` = original rules copy shown in the House-rules
 * expander.
 */
export const GAMES = [
  {
    key: 'zanga',
    name: 'Zanga Billiards',
    icon: '🎱',
    tagline: 'Pot every ball, then talk. The cue never lies.',
    seats: 2,
    variants: ['stacking', 'blitz'],
    rules: [
      'Race to 5: pot 5 balls before your opponent to take the frame.',
      'A foul hands your opponent the table — one free clean shot.',
      'The black ball decides it: pot it early and you hand over the frame.',
      'Stacking tables: the winner stays, the next challenger steps up.',
      'Blitz tables: 60 seconds per shot. Slow play forfeits the turn.',
    ],
  },
  {
    key: 'seedcircle',
    name: 'Seed Circle',
    icon: '🌰',
    tagline: 'Count like a market woman. Harvest last, win first.',
    seats: 2,
    variants: ['rollover', 'blitz'],
    rules: [
      'Sow your seeds one by one around the circle — plan three moves ahead.',
      'Land your last seed in your store to earn a bonus sow.',
      'Capture: land your last seed in an empty pit facing a full one, and both pits are yours.',
      'The game ends when one side is empty. Most seeds in the store wins.',
      'Rollover tables: nobody takes the pot until someone wins it outright.',
    ],
  },
  {
    key: 'gbam',
    name: 'Gbam! Cards',
    icon: '🃏',
    tagline: 'Shed every card. Shout "Gbam!" on your last one.',
    seats: 2,
    variants: ['stacking', 'four'],
    rules: [
      'Match the top card by number or suit to shed a card.',
      'No match? Pick from the deck and pass — the pile grows teeth.',
      'Down to your last card, you must call "Gbam!" before your next turn.',
      'Forget the call and you pick up two as penalty. The table will remind you — loudly.',
      'Four-player tables: winner takes the whole pot, no splitting.',
    ],
  },
  {
    key: 'fourcorners',
    name: 'Four Corners',
    icon: '🎲',
    tagline: 'Race all four pieces home. No piece left behind.',
    seats: 4,
    variants: ['four', 'stacking', 'rollover'],
    rules: [
      'Roll a six to leave your yard, then race the board clockwise.',
      'Land on an opponent to send them back to start. Safe squares are sacred.',
      'First to bring all four pieces home wins the table.',
      'Exact roll needed to enter home — overshooting keeps you waiting.',
      'Full four-player tables: every seated player plays their own match in v1.',
    ],
  },
  {
    key: 'grandeko',
    name: 'Grand Èkó',
    icon: '♟️',
    tagline: 'Street chess. Think three moves deep or go home.',
    seats: 2,
    variants: ['blitz', 'rollover'],
    rules: [
      'Standard street rules: checkmate wins, stalemate is a draw.',
      'Touch a piece, move it — no take-backs at this table.',
      'Blitz tables: 60 seconds on the clock, flagging loses on the spot.',
      'Threefold repetition or fifty quiet moves: the table calls it a draw.',
      'Draws refund every stake. Nobody leaves angry.',
    ],
  },
];

export const GAME_MAP = Object.fromEntries(GAMES.map((g) => [g.key, g]));

export function gameByKey(key) {
  return GAME_MAP[String(key || '')] || null;
}

/** Table variant catalogue (original copy). */
export const VARIANTS = {
  stacking: { key: 'stacking', name: 'Stacking', icon: '🔥', blurb: 'Winner stays on. New challengers queue up.' },
  rollover: { key: 'rollover', name: 'Rollover', icon: '🔁', blurb: 'The pot rolls over until someone wins it outright.' },
  four: { key: 'four', name: '4-Player', icon: '👥', blurb: 'Four seats at the table. Combined pots arrive with live multiplayer.' },
  blitz: { key: 'blitz', name: 'Blitz', icon: '⚡', blurb: '60-second shot clock. Slow play forfeits the turn.' },
};

/** Venue catalogue (original names). */
export const VENUES = [
  { key: 'cue-house', name: 'Surulere Cue House', icon: '🎱', blurb: 'Felt tables, loud fans, cold drinks.' },
  { key: 'kitchen-yard', name: "Mama's Kitchen Yard", icon: '🍲', blurb: 'Play between plates. The aroma is free.' },
  { key: 'viewing-centre', name: "Oga's Viewing Centre", icon: '⚽', blurb: 'Match on the big screen, games at the back.' },
];

export const VENUE_MAP = Object.fromEntries(VENUES.map((v) => [v.key, v]));

/** House cut + payout math. Pot = stake x seats. Winner takes 95%. */
export function potFor(stake, seats) {
  return Math.floor(Number(stake) || 0) * Math.max(1, Math.floor(Number(seats) || 1));
}

export function winnerPayout(stake, seats) {
  const pot = potFor(stake, seats);
  return Math.floor((pot * (100 - HOUSE_CUT_PCT)) / 100);
}

export function houseKeeps(stake, seats) {
  return potFor(stake, seats) - winnerPayout(stake, seats);
}

/** "Need ₦X more" helper for disabled join buttons. */
export function shortfall(balance, stake) {
  return Math.max(0, Math.floor(Number(stake) || 0) - Math.floor(Number(balance) || 0));
}

// ---------------- Placeholder AI match simulation ----------------
// v1: instantly resolves a human vs Èkó CPU match with flavored,
// game-specific scoreboard logs. Near-even odds, small draw chance,
// NO skill model — documented placeholder until real-time
// multiplayer + a real engine land (deferred, not half-built).

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * @param {string} gameKey
 * @param {function} rng - () => [0,1); injectable for tests
 * @returns {{ outcome:'win'|'loss'|'draw', scoreText:string, log:string[] }}
 */
export function simulateMatch(gameKey, rng = Math.random) {
  const roll = rng();
  const outcome = roll < 0.08 ? 'draw' : roll < 0.53 ? 'win' : 'loss';
  const you = 'You';
  const cpu = CPU_NAME;
  switch (gameKey) {
    case 'zanga': {
      // Race to 5 balls potted.
      let y = 0; let c = 0;
      const log = [];
      let guard = 0;
      while (y < 5 && c < 5 && guard++ < 200) {
        const yPot = 1 + Math.floor(rng() * 3);
        y = Math.min(5, y + yPot);
        log.push(`${you} pot ${yPot} — ${y} of 5.`);
        if (y >= 5) break;
        const cPot = 1 + Math.floor(rng() * 3);
        c = Math.min(5, c + cPot);
        log.push(`${cpu} answers with ${cPot} — ${c} of 5.`);
      }
      return finish(outcome, `Balls ${y}–${c}`, log, you, cpu);
    }
    case 'seedcircle': {
      let y = 0; let c = 0;
      const log = [];
      for (let round = 1; round <= 6; round += 1) {
        const ys = 2 + Math.floor(rng() * 7);
        const cs = 2 + Math.floor(rng() * 7);
        y += ys; c += cs;
        log.push(`Round ${round}: ${you} harvest ${ys} seeds, ${cpu} harvests ${cs}. Stores ${y}–${c}.`);
      }
      return finish(outcome, `Seeds ${y}–${c}`, log, you, cpu);
    }
    case 'gbam': {
      let y = 7; let c = 7;
      const log = [];
      let guard = 0;
      while (y > 0 && c > 0 && guard++ < 200) {
        const shed = 1 + Math.floor(rng() * 2);
        y = Math.max(0, y - shed);
        log.push(y === 1 ? `${you} down to one card — "Gbam!"` : `${you} shed ${shed}. ${y} left.`);
        if (y <= 0) break;
        const cshed = 1 + Math.floor(rng() * 2);
        c = Math.max(0, c - cshed);
        log.push(cshed === 0 ? `${cpu} picks up.` : `${cpu} sheds ${cshed}. ${c} left.`);
      }
      return finish(outcome, `Cards ${7 - y}–${7 - c} shed`, log, you, cpu);
    }
    case 'fourcorners': {
      let y = 0; let c = 0;
      const log = [];
      let guard = 0;
      while (y < 4 && c < 4 && guard++ < 200) {
        if (rng() < 0.5) { y = Math.min(4, y + 1); log.push(`${you} bring a piece home — ${y} of 4.`); }
        else log.push(`${you} roll ${1 + Math.floor(rng() * 6)} — no entry.`);
        if (y >= 4) break;
        if (rng() < 0.5) { c = Math.min(4, c + 1); log.push(`${cpu} brings a piece home — ${c} of 4.`); }
        else log.push(`${cpu} overshoots the home square.`);
      }
      return finish(outcome, `Pieces home ${y}–${c}`, log, you, cpu);
    }
    case 'grandeko':
    default: {
      const moves = 14 + Math.floor(rng() * 18);
      const log = [];
      const openings = ['Market Gambit', 'Danfo Defense', 'Owambe Opening', 'Third Mainland Attack'];
      log.push(`${you} open with the ${pick(rng, openings)}.`);
      for (let m = 2; m <= moves; m += 1) {
        if (m % 2 === 0) log.push(`Move ${m}: ${cpu} presses the center.`);
        else log.push(`Move ${m}: ${you} hold the line.`);
      }
      return finish(outcome, `${moves} moves`, log, you, cpu);
    }
  }
}

function finish(outcome, scoreText, log, you, cpu) {
  if (outcome === 'win') log.push(`${you} take it — ${scoreText}. The table erupts.`);
  else if (outcome === 'loss') log.push(`${cpu} takes it — ${scoreText}. Run it back?`);
  else log.push(`Dead heat — ${scoreText}. Stakes go back to both sides.`);
  return { outcome, scoreText, log };
}

// ---------------- Storage (idempotent schema) ----------------

export const SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS tg_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_key TEXT NOT NULL,
  venue TEXT NOT NULL,
  stake INTEGER NOT NULL DEFAULT 0,
  seats_total INTEGER NOT NULL DEFAULT 2,
  variant TEXT,
  creator_user_id INTEGER NOT NULL,
  creator_username TEXT NOT NULL,
  friend_invite TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  reported INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tg_seats (
  table_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  escrowed INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  UNIQUE(table_id, user_id)
);
CREATE TABLE IF NOT EXISTS tg_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id INTEGER,
  game_key TEXT NOT NULL,
  venue TEXT NOT NULL,
  stake INTEGER NOT NULL DEFAULT 0,
  seats_total INTEGER NOT NULL DEFAULT 2,
  pot INTEGER NOT NULL DEFAULT 0,
  winner TEXT NOT NULL DEFAULT 'draw',
  winner_user_id INTEGER,
  winner_username TEXT,
  payout INTEGER NOT NULL DEFAULT 0,
  log_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'done',
  reported INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  live_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tg_hof (
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  game_key TEXT NOT NULL,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  best_pot INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, game_key)
);`;

export const SCHEMA_PG = `
CREATE TABLE IF NOT EXISTS tg_tables (
  id SERIAL PRIMARY KEY,
  game_key TEXT NOT NULL,
  venue TEXT NOT NULL,
  stake INTEGER NOT NULL DEFAULT 0,
  seats_total INTEGER NOT NULL DEFAULT 2,
  variant TEXT,
  creator_user_id INTEGER NOT NULL,
  creator_username TEXT NOT NULL,
  friend_invite TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  reported INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS tg_seats (
  table_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  escrowed INTEGER NOT NULL DEFAULT 0,
  joined_at BIGINT NOT NULL,
  UNIQUE(table_id, user_id)
);
CREATE TABLE IF NOT EXISTS tg_matches (
  id SERIAL PRIMARY KEY,
  table_id INTEGER,
  game_key TEXT NOT NULL,
  venue TEXT NOT NULL,
  stake INTEGER NOT NULL DEFAULT 0,
  seats_total INTEGER NOT NULL DEFAULT 2,
  pot INTEGER NOT NULL DEFAULT 0,
  winner TEXT NOT NULL DEFAULT 'draw',
  winner_user_id INTEGER,
  winner_username TEXT,
  payout INTEGER NOT NULL DEFAULT 0,
  log_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'done',
  reported INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  finished_at BIGINT NOT NULL,
  live_until BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tg_hof (
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  game_key TEXT NOT NULL,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  best_pot INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, game_key)
);`;

/** Split multi-statement schema into single statements (dbRun = one per call). */
export function schemaStatements(sql) {
  return sql.split(';').map((s) => s.trim()).filter(Boolean);
}
