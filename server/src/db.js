// ============================================================
// db.js — Èkó Life database adapter
// PostgreSQL when DATABASE_URL is set (production),
// otherwise local SQLite (node:sqlite, zero native deps).
// EKO_DB_PATH overrides the SQLite file (':memory:' for tests).
// All operations are async with an identical API.
// ============================================================
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_CHARACTER } from './game/data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pool = null; // pg Pool (production or injected test pool)
let sdb = null;  // sqlite db (local dev / tests)

// Test hook: inject a pg-compatible pool. Not used in prod.
export function _injectPool(p) { pool = p; }

export function dbMode() { return pool ? 'postgres' : 'sqlite'; }

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT,
  pass_hash TEXT,
  dob TEXT,
  is_guest INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE NOT NULL,
  name TEXT NOT NULL,
  class TEXT NOT NULL DEFAULT 'street_smart',
  avatar TEXT NOT NULL DEFAULT '🧑',
  color TEXT NOT NULL DEFAULT '#22d3ee',
  money INTEGER NOT NULL DEFAULT 5000,
  energy INTEGER NOT NULL DEFAULT 100,
  health INTEGER NOT NULL DEFAULT 100,
  happiness INTEGER NOT NULL DEFAULT 60,
  hunger INTEGER NOT NULL DEFAULT 100,
  housing TEXT NOT NULL DEFAULT 'face-me',
  property TEXT NOT NULL DEFAULT 'none',
  vehicle TEXT NOT NULL DEFAULT 'none',
  savings INTEGER NOT NULL DEFAULT 0,
  loan INTEGER NOT NULL DEFAULT 0,
  cert INTEGER NOT NULL DEFAULT 0,
  location_id TEXT NOT NULL DEFAULT 'ojuelegba',
  x REAL,
  y REAL,
  rent_misses INTEGER NOT NULL DEFAULT 0,
  customized INTEGER NOT NULL DEFAULT 0,
  starter_loan_available INTEGER NOT NULL DEFAULT 0,
  loan_free INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  meta TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE TABLE IF NOT EXISTS furniture (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  item TEXT NOT NULL,
  placed INTEGER NOT NULL DEFAULT 0,
  x INTEGER,
  z INTEGER,
  rot INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_furniture_owner ON furniture(owner_id);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- M5: governor elections
CREATE TABLE IF NOT EXISTS elections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_day INTEGER NOT NULL,
  end_day INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'voting',
  winner_id INTEGER
);
CREATE TABLE IF NOT EXISTS candidates (
  election_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (election_id, player_id)
);
CREATE TABLE IF NOT EXISTS votes (
  election_id INTEGER NOT NULL,
  voter_id INTEGER NOT NULL,
  candidate_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (election_id, voter_id)
);
-- M5: social graph
CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL,
  addressee_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_friendships_pair ON friendships(requester_id, addressee_id);
-- M5: topic rooms
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '💬',
  creator_id INTEGER NOT NULL DEFAULT 0,
  created_ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS room_members (
  room_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  muted_until INTEGER NOT NULL DEFAULT 0,
  joined_ts INTEGER NOT NULL,
  PRIMARY KEY (room_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_room_members_player ON room_members(player_id);
-- M5: DMs + per-thread read timestamps
CREATE TABLE IF NOT EXISTS dms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL,
  to_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dms_pair ON dms(from_id, to_id);
CREATE TABLE IF NOT EXISTS dm_reads (
  user_id INTEGER NOT NULL,
  partner_id INTEGER NOT NULL,
  last_read_ts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, partner_id)
);
-- M5: blocks + reports
CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blocker_id INTEGER NOT NULL,
  blocked_id INTEGER NOT NULL,
  created_ts INTEGER NOT NULL,
  UNIQUE (blocker_id, blocked_id)
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL,
  reported_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_id);`;

const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT,
  pass_hash TEXT,
  dob TEXT,
  is_guest INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  last_seen BIGINT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS characters (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE NOT NULL,
  name TEXT NOT NULL,
  class TEXT NOT NULL DEFAULT 'street_smart',
  avatar TEXT NOT NULL DEFAULT '🧑',
  color TEXT NOT NULL DEFAULT '#22d3ee',
  money INTEGER NOT NULL DEFAULT 5000,
  energy INTEGER NOT NULL DEFAULT 100,
  health INTEGER NOT NULL DEFAULT 100,
  happiness INTEGER NOT NULL DEFAULT 60,
  hunger INTEGER NOT NULL DEFAULT 100,
  housing TEXT NOT NULL DEFAULT 'face-me',
  property TEXT NOT NULL DEFAULT 'none',
  vehicle TEXT NOT NULL DEFAULT 'none',
  savings INTEGER NOT NULL DEFAULT 0,
  loan INTEGER NOT NULL DEFAULT 0,
  cert INTEGER NOT NULL DEFAULT 0,
  location_id TEXT NOT NULL DEFAULT 'ojuelegba',
  x DOUBLE PRECISION,
  y DOUBLE PRECISION,
  rent_misses INTEGER NOT NULL DEFAULT 0,
  customized INTEGER NOT NULL DEFAULT 0,
  starter_loan_available INTEGER NOT NULL DEFAULT 0,
  loan_free INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  meta TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE TABLE IF NOT EXISTS furniture (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  item TEXT NOT NULL,
  placed INTEGER NOT NULL DEFAULT 0,
  x INTEGER,
  z INTEGER,
  rot INTEGER,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_furniture_owner ON furniture(owner_id);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- M5: governor elections
CREATE TABLE IF NOT EXISTS elections (
  id SERIAL PRIMARY KEY,
  start_day INTEGER NOT NULL,
  end_day INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'voting',
  winner_id INTEGER
);
CREATE TABLE IF NOT EXISTS candidates (
  election_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (election_id, player_id)
);
CREATE TABLE IF NOT EXISTS votes (
  election_id INTEGER NOT NULL,
  voter_id INTEGER NOT NULL,
  candidate_id INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (election_id, voter_id)
);
-- M5: social graph
CREATE TABLE IF NOT EXISTS friendships (
  id SERIAL PRIMARY KEY,
  requester_id INTEGER NOT NULL,
  addressee_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_ts BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_friendships_pair ON friendships(requester_id, addressee_id);
-- M5: topic rooms
CREATE TABLE IF NOT EXISTS rooms (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '💬',
  creator_id INTEGER NOT NULL DEFAULT 0,
  created_ts BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS room_members (
  room_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  muted_until BIGINT NOT NULL DEFAULT 0,
  joined_ts BIGINT NOT NULL,
  PRIMARY KEY (room_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_room_members_player ON room_members(player_id);
-- M5: DMs + per-thread read timestamps
CREATE TABLE IF NOT EXISTS dms (
  id SERIAL PRIMARY KEY,
  from_id INTEGER NOT NULL,
  to_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  ts BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dms_pair ON dms(from_id, to_id);
CREATE TABLE IF NOT EXISTS dm_reads (
  user_id INTEGER NOT NULL,
  partner_id INTEGER NOT NULL,
  last_read_ts BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, partner_id)
);
-- M5: blocks + reports
CREATE TABLE IF NOT EXISTS blocks (
  id SERIAL PRIMARY KEY,
  blocker_id INTEGER NOT NULL,
  blocked_id INTEGER NOT NULL,
  created_ts BIGINT NOT NULL,
  UNIQUE (blocker_id, blocked_id)
);
CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  reporter_id INTEGER NOT NULL,
  reported_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_id);`;

// ---------- low-level helpers (same API, both backends) ----------
async function runQ(sqliteSql, pgSql, params) {
  if (pool) { await pool.query(pgSql, params); return { changes: 0 }; }
  const r = sdb.prepare(sqliteSql).run(...params);
  return { changes: Number(r.changes) };
}
async function getOne(sqliteSql, pgSql, params) {
  if (pool) { const r = await pool.query(pgSql, params); return r.rows[0] || null; }
  return sdb.prepare(sqliteSql).get(...params) || null;
}
// M5: multi-row reads with the same dual-backend contract.
async function getAll(sqliteSql, pgSql, params) {
  if (pool) { const r = await pool.query(pgSql, params); return r.rows; }
  return sdb.prepare(sqliteSql).all(...params);
}

// V2: generic exported query helpers for milestone modules.
// Each v2 game module (server/src/game/v2/*.js) owns its own tables and
// implements its storage against these — no db.js edits needed per milestone.
// Dialect rule: pass BOTH variants; SQLite uses `?` placeholders,
// Postgres uses `$1, $2, ...`. Tests run on SQLite (:memory:).
export async function dbRun(sqliteSql, pgSql, params = []) {
  return runQ(sqliteSql, pgSql, params);
}
export async function dbGet(sqliteSql, pgSql, params = []) {
  return getOne(sqliteSql, pgSql, params);
}
export async function dbAll(sqliteSql, pgSql, params = []) {
  return getAll(sqliteSql, pgSql, params);
}

// Add a column if missing (for upgrading existing databases)
// V2: exported so tests can add/verify coordinator-owned columns idempotently.
export async function ensureColumn(table, col, sqliteDef, pgDef) {
  try {
    await runQ(
      `ALTER TABLE ${table} ADD COLUMN ${col} ${sqliteDef}`,
      `ALTER TABLE ${table} ADD COLUMN ${col} ${pgDef}`,
      []);
  } catch (e) {
    if (/duplicate|already exists/i.test(e.message)) return; // already there
    throw e;
  }
}

export async function initDb() {
  if (pool || process.env.DATABASE_URL) {
    if (!pool) {
      pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 5,
      });
    }
    await pool.query(PG_SCHEMA);
    await ensureColumn('users', 'email', 'TEXT', 'TEXT');
    await ensureColumn('users', 'dob', 'TEXT', 'TEXT');
    await ensureColumn('users', 'is_guest', 'INTEGER NOT NULL DEFAULT 0', 'INTEGER NOT NULL DEFAULT 0');
    // M4 admin columns
    await ensureColumn('users', 'last_seen', 'INTEGER', 'BIGINT');
    // M2 gameplay columns (no-op on fresh DBs, upgrades existing ones)
    await ensureColumn('characters', 'x', 'REAL', 'DOUBLE PRECISION');
    await ensureColumn('characters', 'y', 'REAL', 'DOUBLE PRECISION');
    await ensureColumn('characters', 'rent_misses', 'INTEGER NOT NULL DEFAULT 0', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn('characters', 'customized', 'INTEGER NOT NULL DEFAULT 0', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn('characters', 'starter_loan_available', 'INTEGER NOT NULL DEFAULT 0', 'INTEGER NOT NULL DEFAULT 0');
    // M3 economy columns
    await ensureColumn('characters', 'biz', 'TEXT', 'TEXT');
    // M4 economy columns
    await ensureColumn('characters', 'loan_free', 'INTEGER NOT NULL DEFAULT 0', 'INTEGER NOT NULL DEFAULT 0');
    // V2 columns (M7 shifts, M8 needs, M9 perks, M10 rent-to-own, M12 skills)
    await ensureColumn('characters', 'shift_job', 'TEXT', 'TEXT');
    await ensureColumn('characters', 'shift_started_at', 'INTEGER', 'BIGINT');
    await ensureColumn('characters', 'shift_ends_at', 'INTEGER', 'BIGINT');
    await ensureColumn('characters', 'fun', 'INTEGER NOT NULL DEFAULT 100', 'INTEGER NOT NULL DEFAULT 100');
    await ensureColumn('characters', 'social', 'INTEGER NOT NULL DEFAULT 100', 'INTEGER NOT NULL DEFAULT 100');
    await ensureColumn('characters', 'hygiene', 'INTEGER NOT NULL DEFAULT 100', 'INTEGER NOT NULL DEFAULT 100');
    await ensureColumn('characters', 'bladder', 'INTEGER NOT NULL DEFAULT 100', 'INTEGER NOT NULL DEFAULT 100');
    await ensureColumn('characters', 'perk_stars', 'INTEGER NOT NULL DEFAULT 0', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn('characters', 'perks', "TEXT NOT NULL DEFAULT '[]'", "TEXT NOT NULL DEFAULT '[]'");
    await ensureColumn('characters', 'housing_owned', 'INTEGER NOT NULL DEFAULT 0', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn('characters', 'skills', 'TEXT', 'TEXT');
    await ensureColumn('characters', 'skills_used', 'TEXT', 'TEXT');
    // M14: home-grid placement columns (no-op on fresh DBs)
    await ensureColumn('furniture', 'x', 'INTEGER', 'INTEGER');
    await ensureColumn('furniture', 'z', 'INTEGER', 'INTEGER');
    await ensureColumn('furniture', 'rot', 'INTEGER', 'INTEGER');
    // M15: avatar look (JSON text) + home style ids (no-op on fresh DBs)
    await ensureColumn('characters', 'avatar_look', 'TEXT', 'TEXT');
    await ensureColumn('characters', 'home_wall', 'TEXT', 'TEXT');
    await ensureColumn('characters', 'home_floor', 'TEXT', 'TEXT');
    console.log('[db] PostgreSQL connected');
  } else {
    const dbPath = process.env.EKO_DB_PATH || path.join(__dirname, 'eko-life.db');
    sdb = new DatabaseSync(dbPath);
    sdb.exec(SQLITE_SCHEMA);
    await ensureColumn('users', 'email', 'TEXT', '');
    await ensureColumn('users', 'dob', 'TEXT', '');
    await ensureColumn('users', 'is_guest', 'INTEGER NOT NULL DEFAULT 0', '');
    // M2 gameplay columns (no-op on fresh DBs, upgrades existing ones)
    await ensureColumn('characters', 'x', 'REAL', '');
    await ensureColumn('characters', 'y', 'REAL', '');
    await ensureColumn('characters', 'rent_misses', 'INTEGER NOT NULL DEFAULT 0', '');
    await ensureColumn('characters', 'customized', 'INTEGER NOT NULL DEFAULT 0', '');
    await ensureColumn('characters', 'starter_loan_available', 'INTEGER NOT NULL DEFAULT 0', '');
    // M3 economy columns
    await ensureColumn('characters', 'biz', 'TEXT', '');
    // M4 economy columns
    await ensureColumn('characters', 'loan_free', 'INTEGER NOT NULL DEFAULT 0', '');
    // V2 columns (M7 shifts, M8 needs, M9 perks, M10 rent-to-own, M12 skills)
    await ensureColumn('characters', 'shift_job', 'TEXT', '');
    await ensureColumn('characters', 'shift_started_at', 'INTEGER', '');
    await ensureColumn('characters', 'shift_ends_at', 'INTEGER', '');
    await ensureColumn('characters', 'fun', 'INTEGER NOT NULL DEFAULT 100', '');
    await ensureColumn('characters', 'social', 'INTEGER NOT NULL DEFAULT 100', '');
    await ensureColumn('characters', 'hygiene', 'INTEGER NOT NULL DEFAULT 100', '');
    await ensureColumn('characters', 'bladder', 'INTEGER NOT NULL DEFAULT 100', '');
    await ensureColumn('characters', 'perk_stars', 'INTEGER NOT NULL DEFAULT 0', '');
    await ensureColumn('characters', 'perks', "TEXT NOT NULL DEFAULT '[]'", '');
    await ensureColumn('characters', 'housing_owned', 'INTEGER NOT NULL DEFAULT 0', '');
    await ensureColumn('characters', 'skills', 'TEXT', '');
    await ensureColumn('characters', 'skills_used', 'TEXT', '');
    // M14: home-grid placement columns (no-op on fresh DBs)
    await ensureColumn('furniture', 'x', 'INTEGER', '');
    await ensureColumn('furniture', 'z', 'INTEGER', '');
    await ensureColumn('furniture', 'rot', 'INTEGER', '');
    // M15: avatar look (JSON text) + home style ids (no-op on fresh DBs)
    await ensureColumn('characters', 'avatar_look', 'TEXT', '');
    await ensureColumn('characters', 'home_wall', 'TEXT', '');
    await ensureColumn('characters', 'home_floor', 'TEXT', '');
    console.log(`[db] SQLite connected (${dbPath === ':memory:' ? 'in-memory' : 'local file'})`);
  }
}

// ---------- users ----------
export async function getUserByName(username) {
  return getOne(
    'SELECT * FROM users WHERE username = ?',
    'SELECT * FROM users WHERE username = $1',
    [username]);
}

export async function getUserById(id) {
  return getOne(
    'SELECT * FROM users WHERE id = ?',
    'SELECT * FROM users WHERE id = $1',
    [id]);
}

// Creates a user AND their character row (guests get a playable character too).
// opts: { username, email, pass_hash, dob, is_guest }
export async function createUser(opts) {
  const now = Date.now();
  const isGuest = opts.is_guest ? 1 : 0;
  let id;
  if (pool) {
    const r = await pool.query(
      `INSERT INTO users (username, email, pass_hash, dob, is_guest, is_admin, banned, created_at)
       VALUES ($1,$2,$3,$4,$5,0,0,$6) RETURNING id`,
      [opts.username, opts.email || null, opts.pass_hash || null, opts.dob || null, isGuest, now]);
    id = r.rows[0].id;
  } else {
    const r = sdb.prepare(
      `INSERT INTO users (username, email, pass_hash, dob, is_guest, is_admin, banned, created_at)
       VALUES (?,?,?,?,?,0,0,?)`)
      .run(opts.username, opts.email || null, opts.pass_hash || null, opts.dob || null, isGuest, now);
    id = Number(r.lastInsertRowid);
  }
  const c = DEFAULT_CHARACTER('street_smart', opts.username);
  await insertCharacter(id, c, now);
  return id;
}

async function insertCharacter(userId, c, now) {
  const perksJson = typeof c.perks === 'string' ? c.perks : JSON.stringify(c.perks || []);
  const skillsJson = typeof c.skills === 'string' ? c.skills : (c.skills == null ? null : JSON.stringify(c.skills));
  const skillsUsedJson = typeof c.skills_used === 'string' ? c.skills_used : (c.skills_used == null ? null : JSON.stringify(c.skills_used));
  // M15: avatar look is JSON text (null until the player saves a look)
  const avatarLookJson = typeof c.avatar_look === 'string' ? c.avatar_look : (c.avatar_look == null ? null : JSON.stringify(c.avatar_look));
  const params = [userId, c.name, c.class, c.avatar, c.color, c.money, c.energy, c.health,
    c.happiness, c.hunger, c.housing, c.property, c.vehicle, c.biz ?? null, c.savings, c.loan, c.cert,
    c.location_id, c.x ?? null, c.y ?? null, c.rent_misses || 0, c.customized || 0,
    c.starter_loan_available || 0, c.loan_free || 0,
    c.shift_job ?? null, c.shift_started_at ?? null, c.shift_ends_at ?? null,
    c.fun ?? 100, c.social ?? 100, c.hygiene ?? 100, c.bladder ?? 100,
    Math.max(0, Math.floor(Number(c.perk_stars) || 0)), perksJson,
    Number(c.housing_owned) ? 1 : 0, skillsJson, skillsUsedJson,
    avatarLookJson, c.home_wall ?? null, c.home_floor ?? null,
    now || Date.now()];
  await runQ(
    `INSERT INTO characters (user_id, name, class, avatar, color, money, energy, health, happiness,
      hunger, housing, property, vehicle, biz, savings, loan, cert, location_id,
      x, y, rent_misses, customized, starter_loan_available, loan_free,
      shift_job, shift_started_at, shift_ends_at, fun, social, hygiene, bladder,
      perk_stars, perks, housing_owned, skills, skills_used, avatar_look, home_wall, home_floor,
      updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    `INSERT INTO characters (user_id, name, class, avatar, color, money, energy, health, happiness,
      hunger, housing, property, vehicle, biz, savings, loan, cert, location_id,
      x, y, rent_misses, customized, starter_loan_available, loan_free,
      shift_job, shift_started_at, shift_ends_at, fun, social, hygiene, bladder,
      perk_stars, perks, housing_owned, skills, skills_used, avatar_look, home_wall, home_floor,
      updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40)`,
    params);
}

// Guest → account migration: converts the guest row in place
// (same id, character progress kept). Returns true on success.
export async function migrateGuestToAccount(id, { username, email, pass_hash, dob }) {
  const r = await runQ(
    `UPDATE users SET username=?, email=?, pass_hash=?, dob=?, is_guest=0
     WHERE id=? AND is_guest=1`,
    `UPDATE users SET username=$1, email=$2, pass_hash=$3, dob=$4, is_guest=0
     WHERE id=$5 AND is_guest=1`,
    [username, email || null, pass_hash, dob, id]);
  if (pool) {
    // pg path: verify via a select since runQ can't report changes for pg
    const u = await getUserById(id);
    return !!u && Number(u.is_guest) === 0;
  }
  return r.changes > 0;
}

export async function setAdmin(id, isAdmin) {
  await runQ('UPDATE users SET is_admin=? WHERE id=?', 'UPDATE users SET is_admin=$1 WHERE id=$2', [isAdmin ? 1 : 0, id]);
}

export async function setBanned(id, banned) {
  await runQ('UPDATE users SET banned=? WHERE id=?', 'UPDATE users SET banned=$1 WHERE id=$2', [banned ? 1 : 0, id]);
}

export async function setLastSeen(id) {
  await runQ('UPDATE users SET last_seen=? WHERE id=?', 'UPDATE users SET last_seen=$1 WHERE id=$2', [Date.now(), id]);
}

export async function countAdmins() {
  const r = await getOne(
    'SELECT COUNT(*) AS c FROM users WHERE is_admin = 1',
    'SELECT COUNT(*) AS c FROM users WHERE is_admin = 1',
    []);
  return Number(r.c);
}

// ---------- admin roster (M4) ----------
// users LEFT JOIN characters — every row needed for GET /api/admin/players.
export async function listRoster() {
  const cols = `u.id AS uid, u.username, u.is_guest, u.is_admin, u.banned, u.last_seen, u.created_at,
    c.money, c.energy, c.health, c.happiness, c.hunger, c.housing,
    c.property, c.vehicle, c.savings, c.loan`;
  if (pool) {
    const r = await pool.query(
      `SELECT ${cols} FROM users u LEFT JOIN characters c ON c.user_id = u.id ORDER BY u.id`);
    return r.rows.map(row => ({ ...row, id: row.uid }));
  }
  return sdb.prepare(
    `SELECT ${cols} FROM users u LEFT JOIN characters c ON c.user_id = u.id ORDER BY u.id`).all()
    .map(row => ({ ...row, id: row.uid }));
}

// ---------- characters ----------
export async function getCharacter(userId) {
  return getOne(
    'SELECT * FROM characters WHERE user_id = ?',
    'SELECT * FROM characters WHERE user_id = $1',
    [userId]);
}

// Returns the character, creating a default one if missing (self-healing).
export async function ensureCharacter(userId, displayName) {
  let c = await getCharacter(userId);
  if (!c) {
    await insertCharacter(userId, DEFAULT_CHARACTER('street_smart', displayName || 'Player'));
    c = await getCharacter(userId);
  }
  return c;
}

// Gameplay save: never touches users (is_admin/banned live there), so a stale
// session can never clobber admin flags or bans.
export async function saveCharacter(c) {
  // V2: normalize JSON-ish columns (modules may keep them as objects in memory).
  const perksJson = typeof c.perks === 'string' ? c.perks : JSON.stringify(c.perks || []);
  const skillsJson = typeof c.skills === 'string' ? c.skills : (c.skills == null ? null : JSON.stringify(c.skills));
  const skillsUsedJson = typeof c.skills_used === 'string' ? c.skills_used : (c.skills_used == null ? null : JSON.stringify(c.skills_used));
  // M15: avatar look is JSON text (null until the player saves a look)
  const avatarLookJson = typeof c.avatar_look === 'string' ? c.avatar_look : (c.avatar_look == null ? null : JSON.stringify(c.avatar_look));
  const params = [c.name, c.class, c.avatar, c.color, c.money, c.energy, c.health,
    c.happiness, c.hunger, c.housing, c.property, c.vehicle, c.biz ?? null, c.savings, c.loan,
    c.cert, c.location_id, c.x ?? null, c.y ?? null, c.rent_misses || 0,
    c.customized || 0, c.starter_loan_available || 0, c.loan_free || 0,
    c.shift_job ?? null, c.shift_started_at ?? null, c.shift_ends_at ?? null,
    c.fun ?? 100, c.social ?? 100, c.hygiene ?? 100, c.bladder ?? 100,
    Math.max(0, Math.floor(Number(c.perk_stars) || 0)), perksJson,
    Number(c.housing_owned) ? 1 : 0, skillsJson, skillsUsedJson,
    avatarLookJson, c.home_wall ?? null, c.home_floor ?? null,
    Date.now(), c.user_id];
  await runQ(
    `UPDATE characters SET name=?, class=?, avatar=?, color=?, money=?, energy=?, health=?,
      happiness=?, hunger=?, housing=?, property=?, vehicle=?, biz=?, savings=?, loan=?,
      cert=?, location_id=?, x=?, y=?, rent_misses=?, customized=?, starter_loan_available=?,
      loan_free=?, shift_job=?, shift_started_at=?, shift_ends_at=?,
      fun=?, social=?, hygiene=?, bladder=?, perk_stars=?, perks=?,
      housing_owned=?, skills=?, skills_used=?,
      avatar_look=?, home_wall=?, home_floor=?, updated_at=? WHERE user_id=?`,
    `UPDATE characters SET name=$1, class=$2, avatar=$3, color=$4, money=$5, energy=$6, health=$7,
      happiness=$8, hunger=$9, housing=$10, property=$11, vehicle=$12, biz=$13, savings=$14, loan=$15,
      cert=$16, location_id=$17, x=$18, y=$19, rent_misses=$20, customized=$21,
      starter_loan_available=$22, loan_free=$23, shift_job=$24, shift_started_at=$25, shift_ends_at=$26,
      fun=$27, social=$28, hygiene=$29, bladder=$30, perk_stars=$31, perks=$32,
      housing_owned=$33, skills=$34, skills_used=$35,
      avatar_look=$36, home_wall=$37, home_floor=$38, updated_at=$39 WHERE user_id=$40`,
    params);
}

// ---------- furniture (M3: inventory + placed items; M14: home-grid x/z/rot) ----------
export async function addFurniture(ownerId, item, placement = {}) {
  const now = Date.now();
  // x/z/rot default NULL (inventory items have no grid position).
  const x = placement.x == null ? null : Math.floor(Number(placement.x));
  const z = placement.z == null ? null : Math.floor(Number(placement.z));
  const rot = placement.rot == null ? null : Math.floor(Number(placement.rot));
  let id;
  if (pool) {
    const r = await pool.query(
      'INSERT INTO furniture (owner_id, item, placed, x, z, rot, created_at) VALUES ($1,$2,0,$3,$4,$5,$6) RETURNING id',
      [ownerId, item, x, z, rot, now]);
    id = r.rows[0].id;
  } else {
    const r = sdb.prepare('INSERT INTO furniture (owner_id, item, placed, x, z, rot, created_at) VALUES (?,?,0,?,?,?,?)')
      .run(ownerId, item, x, z, rot, now);
    id = Number(r.lastInsertRowid);
  }
  return id;
}

export async function listFurniture(ownerId) {
  if (pool) {
    const r = await pool.query('SELECT * FROM furniture WHERE owner_id=$1 ORDER BY id', [ownerId]);
    return r.rows;
  }
  return sdb.prepare('SELECT * FROM furniture WHERE owner_id=? ORDER BY id').all(ownerId);
}

export async function getFurnitureById(id) {
  return getOne('SELECT * FROM furniture WHERE id=?', 'SELECT * FROM furniture WHERE id=$1', [id]);
}

// Owner-checked place/unplace (placed = 1|0). Returns false if not the owner's item.
export async function setFurniturePlaced(id, ownerId, placed) {
  return setFurniturePlacement(id, ownerId, { placed });
}

// M14: placement persistence with optional grid coordinates. Passing x/z/rot
// (integers, may be null to clear) is validated by the caller (actions.js).
// Backward-compatible: behaves like setFurniturePlaced when called with
// { placed } only.
export async function setFurniturePlacement(id, ownerId, { placed, x = null, z = null, rot = null } = {}) {
  const px = x == null ? null : Math.floor(Number(x));
  const pz = z == null ? null : Math.floor(Number(z));
  const pr = rot == null ? null : Math.floor(Number(rot));
  const r = await runQ(
    'UPDATE furniture SET placed=?, x=?, z=?, rot=? WHERE id=? AND owner_id=?',
    'UPDATE furniture SET placed=$1, x=$2, z=$3, rot=$4 WHERE id=$5 AND owner_id=$6',
    [placed ? 1 : 0, px, pz, pr, id, ownerId]);
  if (pool) {
    const row = await getFurnitureById(id);
    return !!row && Number(row.owner_id) === Number(ownerId) && Number(row.placed) === (placed ? 1 : 0);
  }
  return r.changes > 0;
}

// Owner-checked delete (M14: sell_furniture). Returns false if not the owner's item.
export async function deleteFurniture(id, ownerId) {
  const r = await runQ(
    'DELETE FROM furniture WHERE id=? AND owner_id=?',
    'DELETE FROM furniture WHERE id=$1 AND owner_id=$2',
    [id, ownerId]);
  if (pool) {
    const row = await getFurnitureById(id);
    return !row;
  }
  return r.changes > 0;
}

export async function countPlacedFurniture(ownerId) {
  const r = await getOne(
    'SELECT COUNT(*) AS c FROM furniture WHERE owner_id=? AND placed=1',
    'SELECT COUNT(*) AS c FROM furniture WHERE owner_id=$1 AND placed=1',
    [ownerId]);
  return Number(r.c);
}

// All placed furniture (for the offline day-economy generator bonus).
export async function listAllPlacedFurniture() {
  if (pool) {
    const r = await pool.query('SELECT owner_id, item FROM furniture WHERE placed=1');
    return r.rows;
  }
  return sdb.prepare('SELECT owner_id, item FROM furniture WHERE placed=1').all();
}

// ---------- day economy (M3) ----------
// Every character row (online players are credited through their live
// session instead — the hub skips their user ids).
export async function listCharacters() {
  if (pool) {
    const r = await pool.query('SELECT * FROM characters');
    return r.rows;
  }
  return sdb.prepare('SELECT * FROM characters').all();
}

// User ids that own a property (drives GET /api/stats homes/homesOnline).
export async function getPropertyOwnerIds() {
  const r = await getOne(
    "SELECT GROUP_CONCAT(user_id) AS ids FROM characters WHERE property IS NOT NULL AND property != 'none' AND property != ''",
    "SELECT STRING_AGG(user_id::text, ',') AS ids FROM characters WHERE property IS NOT NULL AND property != 'none' AND property != ''",
    []);
  if (!r || !r.ids) return [];
  return String(r.ids).split(',').map(Number).filter(Number.isFinite);
}
export async function addTransaction(userId, kind, amount, balanceAfter, meta) {
  await runQ(
    'INSERT INTO transactions (user_id, kind, amount, balance_after, meta, created_at) VALUES (?,?,?,?,?,?)',
    'INSERT INTO transactions (user_id, kind, amount, balance_after, meta, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [userId, kind, amount, balanceAfter, meta ? JSON.stringify(meta) : null, Date.now()]);
}

// Newest-first ledger rows for a player (used by tests; M3 economy UI).
export async function listTransactions(userId, limit = 50) {
  const lim = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
  if (pool) {
    const r = await pool.query(
      'SELECT * FROM transactions WHERE user_id=$1 ORDER BY id DESC LIMIT $2', [userId, lim]);
    return r.rows;
  }
  return sdb.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT ?').all(userId, lim);
}

// ---------- meta (visits counter, etc.) ----------
export async function getMeta(key) {
  const r = await getOne('SELECT value FROM meta WHERE key=?', 'SELECT value FROM meta WHERE key=$1', [key]);
  return r ? r.value : null;
}

export async function setMeta(key, value) {
  if (pool) {
    await pool.query(
      'INSERT INTO meta (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2',
      [key, String(value)]);
  } else {
    sdb.prepare('INSERT INTO meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
  }
}

export async function bumpVisits() {
  const v = Number((await getMeta('visits')) || 0) + 1;
  await setMeta('visits', v);
  return v;
}

// ============================================================
// M5 — governor elections
// ============================================================
export async function currentElection() {
  return getOne(
    "SELECT * FROM elections WHERE status = 'voting' ORDER BY id DESC LIMIT 1",
    "SELECT * FROM elections WHERE status = 'voting' ORDER BY id DESC LIMIT 1",
    []);
}

export async function createElection(startDay, endDay) {
  if (pool) {
    const r = await pool.query(
      "INSERT INTO elections (start_day, end_day, status) VALUES ($1,$2,'voting') RETURNING *",
      [startDay, endDay]);
    return r.rows[0];
  }
  const r = sdb.prepare("INSERT INTO elections (start_day, end_day, status) VALUES (?,?,'voting')")
    .run(startDay, endDay);
  return getOne('SELECT * FROM elections WHERE id = ?',
    'SELECT * FROM elections WHERE id = $1', [Number(r.lastInsertRowid)]);
}

export async function closeElection(id, winnerId) {
  await runQ(
    "UPDATE elections SET status='done', winner_id=? WHERE id=?",
    "UPDATE elections SET status='done', winner_id=$1 WHERE id=$2",
    [winnerId, id]);
}

// One candidacy per election: the PK rejects duplicates, reported as false.
export async function addCandidate(electionId, playerId) {
  try {
    await runQ(
      'INSERT INTO candidates (election_id, player_id, created_at) VALUES (?,?,?)',
      'INSERT INTO candidates (election_id, player_id, created_at) VALUES ($1,$2,$3)',
      [electionId, playerId, Date.now()]);
    return true;
  } catch (e) { return false; }
}

export async function listCandidates(electionId) {
  return getAll(
    `SELECT c.player_id, u.username, COUNT(v.voter_id) AS votes
     FROM candidates c JOIN users u ON u.id = c.player_id
     LEFT JOIN votes v ON v.election_id = c.election_id AND v.candidate_id = c.player_id
     WHERE c.election_id = ? GROUP BY c.player_id, u.username`,
    `SELECT c.player_id, u.username, COUNT(v.voter_id)::int AS votes
     FROM candidates c JOIN users u ON u.id = c.player_id
     LEFT JOIN votes v ON v.election_id = c.election_id AND v.candidate_id = c.player_id
     WHERE c.election_id = $1 GROUP BY c.player_id, u.username`,
    [electionId]);
}

export async function hasVoted(electionId, voterId) {
  const r = await getOne(
    'SELECT 1 AS x FROM votes WHERE election_id = ? AND voter_id = ?',
    'SELECT 1 AS x FROM votes WHERE election_id = $1 AND voter_id = $2',
    [electionId, voterId]);
  return !!r;
}

// One vote per voter per election: the PK rejects doubles, reported as false.
export async function castVote(electionId, voterId, candidateId) {
  try {
    await runQ(
      'INSERT INTO votes (election_id, voter_id, candidate_id, created_at) VALUES (?,?,?,?)',
      'INSERT INTO votes (election_id, voter_id, candidate_id, created_at) VALUES ($1,$2,$3,$4)',
      [electionId, voterId, candidateId, Date.now()]);
    return true;
  } catch (e) { return false; }
}

export async function lastWinner() {
  return getOne(
    "SELECT e.*, u.username AS winner_name FROM elections e LEFT JOIN users u ON u.id = e.winner_id WHERE e.status='done' ORDER BY e.id DESC LIMIT 1",
    "SELECT e.*, u.username AS winner_name FROM elections e LEFT JOIN users u ON u.id = e.winner_id WHERE e.status='done' ORDER BY e.id DESC LIMIT 1",
    []);
}

// ============================================================
// M5 — friends
// ============================================================
// Returns 'self' | 'exists' | 'accepted' (mutual auto-accept) | 'ok'.
export async function addFriendRequest(requesterId, addresseeId) {
  if (Number(requesterId) === Number(addresseeId)) return 'self';
  const existing = await getOne(
    'SELECT * FROM friendships WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)',
    'SELECT * FROM friendships WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$3 AND addressee_id=$4)',
    [requesterId, addresseeId, addresseeId, requesterId]);
  if (existing) {
    // They already requested us → mutual interest, auto-accept.
    if (existing.status === 'pending' && Number(existing.requester_id) === Number(addresseeId)) {
      await runQ('UPDATE friendships SET status=? WHERE id=?',
        'UPDATE friendships SET status=$1 WHERE id=$2', ['accepted', existing.id]);
      return 'accepted';
    }
    return 'exists';
  }
  await runQ(
    'INSERT INTO friendships (requester_id, addressee_id, status, created_ts) VALUES (?,?,?,?)',
    'INSERT INTO friendships (requester_id, addressee_id, status, created_ts) VALUES ($1,$2,$3,$4)',
    [requesterId, addresseeId, 'pending', Date.now()]);
  return 'ok';
}

export async function respondFriendRequest(addresseeId, requesterId, accept) {
  const r = await getOne(
    'SELECT * FROM friendships WHERE requester_id=? AND addressee_id=? AND status=?',
    'SELECT * FROM friendships WHERE requester_id=$1 AND addressee_id=$2 AND status=$3',
    [requesterId, addresseeId, 'pending']);
  if (!r) return false;
  await runQ('UPDATE friendships SET status=? WHERE id=?',
    'UPDATE friendships SET status=$1 WHERE id=$2',
    [accept ? 'accepted' : 'declined', r.id]);
  return true;
}

export async function removeFriend(a, b) {
  await runQ(
    'DELETE FROM friendships WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)',
    'DELETE FROM friendships WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$3 AND addressee_id=$4)',
    [a, b, b, a]);
}

// Pending + accepted rows for a player, with the other side's username.
export async function listFriendships(playerId) {
  const rows = await getAll(
    `SELECT f.id, f.requester_id, f.addressee_id, f.status, f.created_ts, u.username AS other_username
     FROM friendships f JOIN users u
       ON u.id = CASE WHEN f.requester_id=? THEN f.addressee_id ELSE f.requester_id END
     WHERE (f.requester_id=? OR f.addressee_id=?) AND f.status IN ('pending','accepted')
     ORDER BY f.created_ts DESC`,
    `SELECT f.id, f.requester_id, f.addressee_id, f.status, f.created_ts, u.username AS other_username
     FROM friendships f JOIN users u
       ON u.id = CASE WHEN f.requester_id=$1 THEN f.addressee_id ELSE f.requester_id END
     WHERE (f.requester_id=$2 OR f.addressee_id=$3) AND f.status IN ('pending','accepted')
     ORDER BY f.created_ts DESC`,
    [playerId, playerId, playerId]);
  return rows.map(r => ({
    id: Number(r.id),
    other_id: Number(r.requester_id) === Number(playerId) ? Number(r.addressee_id) : Number(r.requester_id),
    other_username: r.other_username,
    status: r.status,
    incoming: r.status === 'pending' && Number(r.addressee_id) === Number(playerId),
    created_ts: Number(r.created_ts),
  }));
}

export async function areFriends(a, b) {
  const r = await getOne(
    `SELECT 1 AS x FROM friendships WHERE status='accepted' AND
     ((requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?))`,
    `SELECT 1 AS x FROM friendships WHERE status='accepted' AND
     ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$3 AND addressee_id=$4))`,
    [a, b, b, a]);
  return !!r;
}

// ============================================================
// M5 — rooms
// ============================================================
export async function createRoom(name, topic, icon, creatorId) {
  const now = Date.now();
  if (pool) {
    const r = await pool.query(
      'INSERT INTO rooms (name, topic, icon, creator_id, created_ts) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [name, topic || '', icon || '💬', creatorId, now]);
    return Number(r.rows[0].id);
  }
  const r = sdb.prepare('INSERT INTO rooms (name, topic, icon, creator_id, created_ts) VALUES (?,?,?,?,?)')
    .run(name, topic || '', icon || '💬', creatorId, now);
  return Number(r.lastInsertRowid);
}

export async function listRooms() {
  return getAll(
    `SELECT r.id, r.name, r.topic, r.icon, r.creator_id, COUNT(m.player_id) AS members
     FROM rooms r LEFT JOIN room_members m ON m.room_id = r.id
     GROUP BY r.id, r.name, r.topic, r.icon, r.creator_id ORDER BY r.id`,
    `SELECT r.id, r.name, r.topic, r.icon, r.creator_id, COUNT(m.player_id) AS members
     FROM rooms r LEFT JOIN room_members m ON m.room_id = r.id
     GROUP BY r.id, r.name, r.topic, r.icon, r.creator_id ORDER BY r.id`,
    []);
}

export async function getRoom(id) {
  return getOne('SELECT * FROM rooms WHERE id=?', 'SELECT * FROM rooms WHERE id=$1', [id]);
}

export async function deleteRoom(id) {
  await runQ('DELETE FROM room_members WHERE room_id=?',
    'DELETE FROM room_members WHERE room_id=$1', [id]);
  await runQ('DELETE FROM rooms WHERE id=?', 'DELETE FROM rooms WHERE id=$1', [id]);
}

export async function joinRoom(roomId, playerId, role) {
  await runQ(
    `INSERT INTO room_members (room_id, player_id, role, muted_until, joined_ts) VALUES (?,?,?,?,?)
     ON CONFLICT(room_id, player_id) DO NOTHING`,
    `INSERT INTO room_members (room_id, player_id, role, muted_until, joined_ts) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT(room_id, player_id) DO NOTHING`,
    [roomId, playerId, role || 'member', 0, Date.now()]);
}

export async function leaveRoom(roomId, playerId) {
  await runQ('DELETE FROM room_members WHERE room_id=? AND player_id=?',
    'DELETE FROM room_members WHERE room_id=$1 AND player_id=$2', [roomId, playerId]);
}

export async function roomMembers(roomId) {
  const rows = await getAll(
    `SELECT m.player_id, m.role, m.muted_until, u.username FROM room_members m
     JOIN users u ON u.id = m.player_id WHERE m.room_id=? ORDER BY m.joined_ts`,
    `SELECT m.player_id, m.role, m.muted_until, u.username FROM room_members m
     JOIN users u ON u.id = m.player_id WHERE m.room_id=$1 ORDER BY m.joined_ts`,
    [roomId]);
  return rows.map(r => ({
    player_id: Number(r.player_id), username: r.username,
    role: r.role, muted_until: Number(r.muted_until),
  }));
}

export async function roomMemberRole(roomId, playerId) {
  const r = await getOne(
    'SELECT role, muted_until FROM room_members WHERE room_id=? AND player_id=?',
    'SELECT role, muted_until FROM room_members WHERE room_id=$1 AND player_id=$2',
    [roomId, playerId]);
  return r ? { role: r.role, muted_until: Number(r.muted_until) } : null;
}

export async function setRoomMuted(roomId, playerId, untilTs) {
  await runQ('UPDATE room_members SET muted_until=? WHERE room_id=? AND player_id=?',
    'UPDATE room_members SET muted_until=$1 WHERE room_id=$2 AND player_id=$3',
    [untilTs, roomId, playerId]);
}

export async function playerRooms(playerId) {
  const rows = await getAll('SELECT room_id FROM room_members WHERE player_id=?',
    'SELECT room_id FROM room_members WHERE player_id=$1', [playerId]);
  return rows.map(r => Number(r.room_id));
}

// ============================================================
// M5 — DMs (block-aware; callers check blocks before writing)
// ============================================================
export async function addDm(fromId, toId, text, ts) {
  await runQ(
    'INSERT INTO dms (from_id, to_id, text, ts) VALUES (?,?,?,?)',
    'INSERT INTO dms (from_id, to_id, text, ts) VALUES ($1,$2,$3,$4)',
    [fromId, toId, text, ts]);
}

// Conversation partners, newest first, with last message + per-thread unread.
export async function dmThreads(playerId) {
  const partners = await getAll(
    'SELECT DISTINCT CASE WHEN from_id=? THEN to_id ELSE from_id END AS pid FROM dms WHERE from_id=? OR to_id=?',
    'SELECT DISTINCT CASE WHEN from_id=$1 THEN to_id ELSE from_id END AS pid FROM dms WHERE from_id=$1 OR to_id=$1',
    [playerId, playerId, playerId]);
  const out = [];
  for (const row of partners) {
    const pid = Number(row.pid);
    const other = await getUserById(pid);
    if (!other) continue;
    const last = await getOne(
      'SELECT text, ts FROM dms WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) ORDER BY id DESC LIMIT 1',
      'SELECT text, ts FROM dms WHERE (from_id=$1 AND to_id=$2) OR (from_id=$3 AND to_id=$4) ORDER BY id DESC LIMIT 1',
      [playerId, pid, pid, playerId]);
    const unread = await dmUnreadFrom(playerId, pid);
    out.push({
      pid, username: other.username,
      last_text: (last && last.text) || '', last_ts: Number((last && last.ts) || 0),
      unread,
    });
  }
  out.sort((a, b) => b.last_ts - a.last_ts);
  return out.slice(0, 30);
}

export async function dmHistory(a, b, limit = 50) {
  const rows = await getAll(
    'SELECT from_id, to_id, text, ts FROM dms WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) ORDER BY id ASC LIMIT ?',
    'SELECT from_id, to_id, text, ts FROM dms WHERE (from_id=$1 AND to_id=$2) OR (from_id=$3 AND to_id=$4) ORDER BY id ASC LIMIT $5',
    [a, b, b, a, limit]);
  return rows.map(r => ({
    from_id: Number(r.from_id), to_id: Number(r.to_id),
    text: r.text, ts: Number(r.ts),
  }));
}

// Read watermark for one thread (playerId reading partnerId's messages).
export async function getDmReadTs(userId, partnerId) {
  const r = await getOne(
    'SELECT last_read_ts FROM dm_reads WHERE user_id=? AND partner_id=?',
    'SELECT last_read_ts FROM dm_reads WHERE user_id=$1 AND partner_id=$2',
    [userId, partnerId]);
  return r ? Number(r.last_read_ts) : 0;
}

export async function setDmReadTs(userId, partnerId, ts) {
  await runQ(
    `INSERT INTO dm_reads (user_id, partner_id, last_read_ts) VALUES (?,?,?)
     ON CONFLICT(user_id, partner_id) DO UPDATE SET last_read_ts=excluded.last_read_ts`,
    `INSERT INTO dm_reads (user_id, partner_id, last_read_ts) VALUES ($1,$2,$3)
     ON CONFLICT(user_id, partner_id) DO UPDATE SET last_read_ts=excluded.last_read_ts`,
    [userId, partnerId, ts]);
}

export async function dmUnreadFrom(userId, partnerId) {
  const readTs = await getDmReadTs(userId, partnerId);
  const r = await getOne(
    'SELECT COUNT(*) AS c FROM dms WHERE to_id=? AND from_id=? AND ts>?',
    'SELECT COUNT(*) AS c FROM dms WHERE to_id=$1 AND from_id=$2 AND ts>$3',
    [userId, partnerId, readTs]);
  return Number(r.c);
}

export async function unreadDmCount(playerId) {
  const partners = await getAll(
    'SELECT DISTINCT from_id AS pid FROM dms WHERE to_id=?',
    'SELECT DISTINCT from_id AS pid FROM dms WHERE to_id=$1',
    [playerId]);
  let n = 0;
  for (const row of partners) n += await dmUnreadFrom(playerId, Number(row.pid));
  return n;
}

// ============================================================
// M5 — blocks & reports
// ============================================================
// idempotent: returns true when a new block was created
export async function addBlock(blockerId, blockedId) {
  if (Number(blockerId) === Number(blockedId)) return false;
  try {
    await runQ(
      'INSERT INTO blocks (blocker_id, blocked_id, created_ts) VALUES (?,?,?)',
      'INSERT INTO blocks (blocker_id, blocked_id, created_ts) VALUES ($1,$2,$3)',
      [blockerId, blockedId, Date.now()]);
    return true;
  } catch (e) { return false; } // already blocked
}

export async function removeBlock(blockerId, blockedId) {
  const r = await runQ(
    'DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?',
    'DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2',
    [blockerId, blockedId]);
  if (pool) {
    return !(await isBlocked(blockerId, blockedId));
  }
  return r.changes > 0;
}

// blockerId blocks blockedId (one direction)
export async function isBlocked(blockerId, blockedId) {
  const r = await getOne(
    'SELECT 1 AS x FROM blocks WHERE blocker_id=? AND blocked_id=?',
    'SELECT 1 AS x FROM blocks WHERE blocker_id=$1 AND blocked_id=$2',
    [blockerId, blockedId]);
  return !!r;
}

// either direction — used for DM rejection
export async function isBlockedEither(a, b) {
  return (await isBlocked(a, b)) || (await isBlocked(b, a));
}

export async function listBlocks(blockerId) {
  const rows = await getAll(
    `SELECT b.blocked_id, u.username FROM blocks b JOIN users u ON u.id = b.blocked_id
     WHERE b.blocker_id=? ORDER BY b.created_ts DESC`,
    `SELECT b.blocked_id, u.username FROM blocks b JOIN users u ON u.id = b.blocked_id
     WHERE b.blocker_id=$1 ORDER BY b.created_ts DESC`,
    [blockerId]);
  return rows.map(r => ({ blocked_id: Number(r.blocked_id), username: r.username }));
}

export async function addReport(reporterId, reportedId, reason) {
  const now = Date.now();
  if (pool) {
    const r = await pool.query(
      'INSERT INTO reports (reporter_id, reported_id, reason, status, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [reporterId, reportedId, reason, 'open', now]);
    return Number(r.rows[0].id);
  }
  const r = sdb.prepare(
    'INSERT INTO reports (reporter_id, reported_id, reason, status, created_at) VALUES (?,?,?,?,?)')
    .run(reporterId, reportedId, reason, 'open', now);
  return Number(r.lastInsertRowid);
}

export async function listReports(limit = 50) {
  const lim = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
  const rows = await getAll(
    `SELECT r.id, r.reporter_id, ru.username AS reporter, r.reported_id, uu.username AS reported,
            r.reason, r.status, r.created_at
     FROM reports r JOIN users ru ON ru.id = r.reporter_id JOIN users uu ON uu.id = r.reported_id
     ORDER BY r.id DESC LIMIT ?`,
    `SELECT r.id, r.reporter_id, ru.username AS reporter, r.reported_id, uu.username AS reported,
            r.reason, r.status, r.created_at
     FROM reports r JOIN users ru ON ru.id = r.reporter_id JOIN users uu ON uu.id = r.reported_id
     ORDER BY r.id DESC LIMIT $1`,
    [lim]);
  return rows.map(r => ({
    id: Number(r.id),
    reporter_id: Number(r.reporter_id), reporter: r.reporter,
    reported_id: Number(r.reported_id), reported: r.reported,
    reason: r.reason, status: r.status, created_at: Number(r.created_at),
  }));
}

// ============================================================
// M5 — leaderboard (top players by money, public)
// ============================================================
export async function listTopByMoney(limit = 10) {
  const lim = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));
  const rows = await getAll(
    `SELECT u.username, COALESCE(c.money,0) AS money FROM users u
     LEFT JOIN characters c ON c.user_id = u.id
     ORDER BY c.money DESC LIMIT ?`,
    `SELECT u.username, COALESCE(c.money,0) AS money FROM users u
     LEFT JOIN characters c ON c.user_id = u.id
     ORDER BY c.money DESC NULLS LAST LIMIT $1`,
    [lim]);
  return rows.map(r => ({ username: r.username, money: Number(r.money) }));
}
