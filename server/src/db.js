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
-- W3 (friends page + referrals): updated_ts tracks the last status change;
-- idx_friendships_unordered_pair enforces one row per unordered user pair
-- (no duplicates in either direction); no-self-add is enforced app-level.
CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL,
  addressee_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_ts INTEGER NOT NULL,
  updated_ts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_friendships_pair ON friendships(requester_id, addressee_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_unordered_pair
  ON friendships (min(requester_id, addressee_id), max(requester_id, addressee_id));
-- M21: notifications (in-app; web-push hook comes later).
-- type: friend_online | room_message | money_received (+ future types).
-- data: JSON blob (e.g. {roomId, userId, amount}).
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  data TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read);
-- M21: per-user notification preferences (row created lazily; absent = all on).
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id INTEGER PRIMARY KEY,
  friend_online INTEGER NOT NULL DEFAULT 1,
  room_message INTEGER NOT NULL DEFAULT 1,
  money_received INTEGER NOT NULL DEFAULT 1
);
-- W3: referral attribution (data-only — no rewards, no payouts, ever).
CREATE TABLE IF NOT EXISTS referrals (
  referrer_id INTEGER NOT NULL,
  referred_id INTEGER NOT NULL UNIQUE,
  created_ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
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
CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_id);
-- Phase 3 (Gist social feed): short public posts, likes, comments, reports.
CREATE TABLE IF NOT EXISTS gists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gists_user ON gists(user_id);
CREATE INDEX IF NOT EXISTS idx_gists_created ON gists(created_at DESC);
CREATE TABLE IF NOT EXISTS gist_likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gist_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (gist_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_gist_likes_gist ON gist_likes(gist_id);
CREATE TABLE IF NOT EXISTS gist_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gist_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gist_comments_gist ON gist_comments(gist_id);
CREATE TABLE IF NOT EXISTS gist_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gist_id INTEGER NOT NULL,
  reporter_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gist_reports_gist ON gist_reports(gist_id);
-- Phase 3 (News tab): headline-aggregator cache; dedupe by link.
CREATE TABLE IF NOT EXISTS news_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT NOT NULL UNIQUE,
  snippet TEXT NOT NULL DEFAULT '',
  published_at INTEGER,
  fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_items_fetched ON news_items(fetched_at DESC);
-- Phase 4 (Èkó Reserve bank app): fixed-term savings bonds. Principal is
-- locked until maturity; maturity settlement credits principal + flat
-- interest and flips matured 0→1 (atomic claim — never double-pays).
CREATE TABLE IF NOT EXISTS bank_bonds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  principal INTEGER NOT NULL,
  rate REAL NOT NULL,
  start_day INTEGER NOT NULL,
  term_days INTEGER NOT NULL,
  matured INTEGER NOT NULL DEFAULT 0,
  matured_day INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bank_bonds_user ON bank_bonds(user_id);
CREATE INDEX IF NOT EXISTS idx_bank_bonds_due ON bank_bonds(matured, start_day, term_days);
-- Phase 6: Boutique wardrobe — premium outfits owned per user.
CREATE TABLE IF NOT EXISTS wardrobe (
  user_id INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  bought_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_wardrobe_user ON wardrobe(user_id);
-- ============================================================
-- FINTECH FOUNDATION (Worker A) — real-money cash ledger.
-- ADDITIVE ONLY: no existing game table, game code, or the
-- gameplay-coins economy (characters.money / transactions) is
-- touched by these tables.
--
-- 1) CASH / GAMEPLAY SEPARATION RULE
--    cash_wallets holds REAL money in NGN kobo. characters.money
--    holds GAMEPLAY coins. The two ledgers are fully independent
--    and no code path may move value between them.
-- 2) NO-CONVERSION RULE
--    There is no exchange rate, purchase, or redemption path
--    between gameplay coins and cash kobo — ever. Treat them as
--    different currencies that can never touch.
-- 3) WITHDRAWAL STATE MACHINE (cash_withdrawal_requests.status):
--       requested → reserved → submitted → processing → completed
--       requested → rejected      (policy/admin reject, pre-reserve)
--       reserved  → rejected      (policy/admin reject, pre-submit)
--       requested|reserved|submitted|processing → failed
--                 (validation, reservation, or provider failure)
--       completed → reversed      (ONLY via a linked 'reversal'
--                 journal: ledger_journals.type='reversal' with
--                 related_journal_id → the original journal)
--    Terminal states: completed, failed, rejected, reversed.
--    Transition enforcement lives in the ledger engine (Worker B);
--    the CHECK constraint here only whitelists valid statuses.
-- 4) IDEMPOTENCY
--    ledger_journals.journal_key is the single idempotency key for
--    every balanced journal; deposit/transfer/withdrawal rows link
--    back via their own journal_key. provider_ref carries the
--    provider's reference and is unique wherever present — the
--    partial unique index below ignores NULLs.
-- ============================================================
CREATE TABLE IF NOT EXISTS ledger_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('asset','liability','revenue','expense','clearing')),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger_journals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_key TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('deposit','transfer','withdrawal','commission','reversal','adjustment')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','posted','reversed','failed')),
  user_id INTEGER REFERENCES users(id),
  related_journal_id INTEGER REFERENCES ledger_journals(id),
  provider_ref TEXT,
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  memo TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  posted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_journals_provider_ref
  ON ledger_journals(provider_ref) WHERE provider_ref IS NOT NULL;
CREATE TABLE IF NOT EXISTS ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_id INTEGER NOT NULL REFERENCES ledger_journals(id),
  account_id INTEGER NOT NULL REFERENCES ledger_accounts(id),
  side TEXT NOT NULL CHECK (side IN ('debit','credit')),
  amount_kobo INTEGER NOT NULL CHECK (amount_kobo >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_journal ON ledger_entries(journal_id);
CREATE TABLE IF NOT EXISTS cash_wallets (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  available_kobo INTEGER NOT NULL DEFAULT 0 CHECK (available_kobo >= 0),
  reserved_kobo INTEGER NOT NULL DEFAULT 0 CHECK (reserved_kobo >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cash_deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  journal_key TEXT UNIQUE NOT NULL,
  amount_kobo INTEGER NOT NULL CHECK (amount_kobo >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  provider TEXT NOT NULL DEFAULT 'mock',
  provider_ref TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','failed','refunded','expired')),
  confirmed_at INTEGER,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cash_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  recipient_id INTEGER NOT NULL REFERENCES users(id),
  journal_key TEXT UNIQUE NOT NULL,
  amount_kobo INTEGER NOT NULL CHECK (amount_kobo > 0),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  status TEXT NOT NULL CHECK (status IN ('pending','completed','failed','reversed')),
  idempotency_key TEXT UNIQUE NOT NULL,
  memo TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  CHECK (sender_id != recipient_id)
);
-- NOTE: account_number stores the FULL account number (the payout
-- provider needs it to send money). NEVER log this column. NEVER
-- store banking passwords, PINs, or OTPs anywhere in this database.
CREATE TABLE IF NOT EXISTS cash_withdrawal_beneficiaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  bank_code TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_name TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, bank_code, account_number)
);
CREATE TABLE IF NOT EXISTS cash_withdrawal_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  beneficiary_id INTEGER NOT NULL REFERENCES cash_withdrawal_beneficiaries(id),
  journal_key TEXT UNIQUE NOT NULL,
  gross_kobo INTEGER NOT NULL CHECK (gross_kobo > 0),
  commission_kobo INTEGER NOT NULL CHECK (commission_kobo >= 0),
  net_kobo INTEGER NOT NULL CHECK (net_kobo >= 0),
  fee_policy_version INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  status TEXT NOT NULL CHECK (status IN ('requested','reserved','submitted','processing','completed','failed','rejected','reversed')),
  provider_ref TEXT UNIQUE,
  failure_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE TABLE IF NOT EXISTS provider_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'mock',
  event_type TEXT NOT NULL,
  provider_ref TEXT,
  payload TEXT NOT NULL,
  signature_valid INTEGER,
  processed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_provider_events_ref ON provider_events(provider_ref);
CREATE TABLE IF NOT EXISTS fee_policies (
  version INTEGER PRIMARY KEY,
  rate_bps INTEGER NOT NULL,
  rounding TEXT NOT NULL DEFAULT 'half_up',
  applies_from INTEGER NOT NULL,
  memo TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS fintech_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fintech_audit_entity ON fintech_audit_logs(entity, entity_id);
-- Milestone 9 (Worker B): manual risk reviews for withdrawals.
-- A withdrawal diverted by the risk policy keeps its row status
-- ('reserved') while an 'open' review exists here; the API reports an
-- effective status of 'under_review'. Approve -> payout proceeds;
-- reject -> reserved funds released via compensating journal.
CREATE TABLE IF NOT EXISTS risk_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  withdrawal_id INTEGER NOT NULL REFERENCES cash_withdrawal_requests(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','rejected','closed')),
  reasons TEXT,
  gross_kobo INTEGER NOT NULL CHECK (gross_kobo > 0),
  note TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  review_reason TEXT,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_risk_reviews_withdrawal ON risk_reviews(withdrawal_id);
CREATE INDEX IF NOT EXISTS idx_risk_reviews_status ON risk_reviews(status);`;

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
-- W3 (friends page + referrals): updated_ts tracks the last status change;
-- idx_friendships_unordered_pair enforces one row per unordered user pair
-- (no duplicates in either direction); no-self-add is enforced app-level.
CREATE TABLE IF NOT EXISTS friendships (
  id SERIAL PRIMARY KEY,
  requester_id INTEGER NOT NULL,
  addressee_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_ts BIGINT NOT NULL,
  updated_ts BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_friendships_pair ON friendships(requester_id, addressee_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_unordered_pair
  ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
-- M21: notifications (in-app; web-push hook comes later).
-- type: friend_online | room_message | money_received (+ future types).
-- data: JSON blob (e.g. {roomId, userId, amount}).
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  data TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read);
-- M21: per-user notification preferences (row created lazily; absent = all on).
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id INTEGER PRIMARY KEY,
  friend_online INTEGER NOT NULL DEFAULT 1,
  room_message INTEGER NOT NULL DEFAULT 1,
  money_received INTEGER NOT NULL DEFAULT 1
);
-- W3: referral attribution (data-only — no rewards, no payouts, ever).
CREATE TABLE IF NOT EXISTS referrals (
  referrer_id INTEGER NOT NULL,
  referred_id INTEGER NOT NULL UNIQUE,
  created_ts BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
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
CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_id);
-- Phase 3 (Gist social feed): short public posts, likes, comments, reports.
CREATE TABLE IF NOT EXISTS gists (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gists_user ON gists(user_id);
CREATE INDEX IF NOT EXISTS idx_gists_created ON gists(created_at DESC);
CREATE TABLE IF NOT EXISTS gist_likes (
  id SERIAL PRIMARY KEY,
  gist_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE (gist_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_gist_likes_gist ON gist_likes(gist_id);
CREATE TABLE IF NOT EXISTS gist_comments (
  id SERIAL PRIMARY KEY,
  gist_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gist_comments_gist ON gist_comments(gist_id);
CREATE TABLE IF NOT EXISTS gist_reports (
  id SERIAL PRIMARY KEY,
  gist_id INTEGER NOT NULL,
  reporter_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gist_reports_gist ON gist_reports(gist_id);
-- Phase 3 (News tab): headline-aggregator cache; dedupe by link.
CREATE TABLE IF NOT EXISTS news_items (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT NOT NULL UNIQUE,
  snippet TEXT NOT NULL DEFAULT '',
  published_at BIGINT,
  fetched_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_items_fetched ON news_items(fetched_at DESC);
-- Phase 4 (Èkó Reserve bank app): fixed-term savings bonds. Principal is
-- locked until maturity; maturity settlement credits principal + flat
-- interest and flips matured 0→1 (atomic claim — never double-pays).
CREATE TABLE IF NOT EXISTS bank_bonds (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  principal INTEGER NOT NULL,
  rate DOUBLE PRECISION NOT NULL,
  start_day INTEGER NOT NULL,
  term_days INTEGER NOT NULL,
  matured INTEGER NOT NULL DEFAULT 0,
  matured_day BIGINT
);
CREATE INDEX IF NOT EXISTS idx_bank_bonds_user ON bank_bonds(user_id);
CREATE INDEX IF NOT EXISTS idx_bank_bonds_due ON bank_bonds(matured, start_day, term_days);
-- Phase 6: Boutique wardrobe — premium outfits owned per user.
CREATE TABLE IF NOT EXISTS wardrobe (
  user_id INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  bought_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_wardrobe_user ON wardrobe(user_id);
-- ============================================================
-- FINTECH FOUNDATION (Worker A) — real-money cash ledger.
-- ADDITIVE ONLY: no existing game table, game code, or the
-- gameplay-coins economy (characters.money / transactions) is
-- touched by these tables.
--
-- 1) CASH / GAMEPLAY SEPARATION RULE
--    cash_wallets holds REAL money in NGN kobo. characters.money
--    holds GAMEPLAY coins. The two ledgers are fully independent
--    and no code path may move value between them.
-- 2) NO-CONVERSION RULE
--    There is no exchange rate, purchase, or redemption path
--    between gameplay coins and cash kobo — ever. Treat them as
--    different currencies that can never touch.
-- 3) WITHDRAWAL STATE MACHINE (cash_withdrawal_requests.status):
--       requested → reserved → submitted → processing → completed
--       requested → rejected      (policy/admin reject, pre-reserve)
--       reserved  → rejected      (policy/admin reject, pre-submit)
--       requested|reserved|submitted|processing → failed
--                 (validation, reservation, or provider failure)
--       completed → reversed      (ONLY via a linked 'reversal'
--                 journal: ledger_journals.type='reversal' with
--                 related_journal_id → the original journal)
--    Terminal states: completed, failed, rejected, reversed.
--    Transition enforcement lives in the ledger engine (Worker B);
--    the CHECK constraint here only whitelists valid statuses.
-- 4) IDEMPOTENCY
--    ledger_journals.journal_key is the single idempotency key for
--    every balanced journal; deposit/transfer/withdrawal rows link
--    back via their own journal_key. provider_ref carries the
--    provider's reference and is unique wherever present — the
--    partial unique index below ignores NULLs.
-- ============================================================
CREATE TABLE IF NOT EXISTS ledger_accounts (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('asset','liability','revenue','expense','clearing')),
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger_journals (
  id SERIAL PRIMARY KEY,
  journal_key TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('deposit','transfer','withdrawal','commission','reversal','adjustment')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','posted','reversed','failed')),
  user_id INTEGER REFERENCES users(id),
  related_journal_id INTEGER REFERENCES ledger_journals(id),
  provider_ref TEXT,
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  memo TEXT,
  metadata TEXT,
  created_at BIGINT NOT NULL,
  posted_at BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_journals_provider_ref
  ON ledger_journals(provider_ref) WHERE provider_ref IS NOT NULL;
CREATE TABLE IF NOT EXISTS ledger_entries (
  id SERIAL PRIMARY KEY,
  journal_id INTEGER NOT NULL REFERENCES ledger_journals(id),
  account_id INTEGER NOT NULL REFERENCES ledger_accounts(id),
  side TEXT NOT NULL CHECK (side IN ('debit','credit')),
  amount_kobo INTEGER NOT NULL CHECK (amount_kobo >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_journal ON ledger_entries(journal_id);
CREATE TABLE IF NOT EXISTS cash_wallets (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  available_kobo INTEGER NOT NULL DEFAULT 0 CHECK (available_kobo >= 0),
  reserved_kobo INTEGER NOT NULL DEFAULT 0 CHECK (reserved_kobo >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS cash_deposits (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  journal_key TEXT UNIQUE NOT NULL,
  amount_kobo INTEGER NOT NULL CHECK (amount_kobo >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  provider TEXT NOT NULL DEFAULT 'mock',
  provider_ref TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','failed','refunded','expired')),
  confirmed_at BIGINT,
  metadata TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS cash_transfers (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  recipient_id INTEGER NOT NULL REFERENCES users(id),
  journal_key TEXT UNIQUE NOT NULL,
  amount_kobo INTEGER NOT NULL CHECK (amount_kobo > 0),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  status TEXT NOT NULL CHECK (status IN ('pending','completed','failed','reversed')),
  idempotency_key TEXT UNIQUE NOT NULL,
  memo TEXT,
  created_at BIGINT NOT NULL,
  completed_at BIGINT,
  CHECK (sender_id != recipient_id)
);
-- NOTE: account_number stores the FULL account number (the payout
-- provider needs it to send money). NEVER log this column. NEVER
-- store banking passwords, PINs, or OTPs anywhere in this database.
CREATE TABLE IF NOT EXISTS cash_withdrawal_beneficiaries (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  bank_code TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_name TEXT,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL,
  UNIQUE (user_id, bank_code, account_number)
);
CREATE TABLE IF NOT EXISTS cash_withdrawal_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  beneficiary_id INTEGER NOT NULL REFERENCES cash_withdrawal_beneficiaries(id),
  journal_key TEXT UNIQUE NOT NULL,
  gross_kobo INTEGER NOT NULL CHECK (gross_kobo > 0),
  commission_kobo INTEGER NOT NULL CHECK (commission_kobo >= 0),
  net_kobo INTEGER NOT NULL CHECK (net_kobo >= 0),
  fee_policy_version INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  status TEXT NOT NULL CHECK (status IN ('requested','reserved','submitted','processing','completed','failed','rejected','reversed')),
  provider_ref TEXT UNIQUE,
  failure_reason TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  completed_at BIGINT
);
CREATE TABLE IF NOT EXISTS provider_events (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'mock',
  event_type TEXT NOT NULL,
  provider_ref TEXT,
  payload TEXT NOT NULL,
  signature_valid BOOLEAN,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_provider_events_ref ON provider_events(provider_ref);
CREATE TABLE IF NOT EXISTS fee_policies (
  version INTEGER PRIMARY KEY,
  rate_bps INTEGER NOT NULL,
  rounding TEXT NOT NULL DEFAULT 'half_up',
  applies_from BIGINT NOT NULL,
  memo TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS fintech_audit_logs (
  id SERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fintech_audit_entity ON fintech_audit_logs(entity, entity_id);
-- Milestone 9 (Worker B): manual risk reviews for withdrawals (PG variant).
CREATE TABLE IF NOT EXISTS risk_reviews (
  id SERIAL PRIMARY KEY,
  withdrawal_id INTEGER NOT NULL REFERENCES cash_withdrawal_requests(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','rejected','closed')),
  reasons TEXT,
  gross_kobo INTEGER NOT NULL CHECK (gross_kobo > 0),
  note TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  review_reason TEXT,
  created_at BIGINT NOT NULL,
  reviewed_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_risk_reviews_withdrawal ON risk_reviews(withdrawal_id);
CREATE INDEX IF NOT EXISTS idx_risk_reviews_status ON risk_reviews(status);`;
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

// Run a statement and report whether it changed anything (atomic claim
// pattern — e.g. flipping bank_bonds.matured 0→1 exactly once).
// sqlite: { changes, rows: [] }; postgres: { changes, rows } — pair with a
// RETURNING clause on the pg variant so rowCount reflects the claim.
export async function dbRunReturning(sqliteSql, pgSql, params = []) {
  if (pool) {
    const r = await pool.query(pgSql, params);
    return { changes: Number(r.rowCount) || 0, rows: r.rows };
  }
  const r = sdb.prepare(sqliteSql).run(...params);
  return { changes: Number(r.changes) || 0, rows: [] };
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
    // M6: appearance revision counter for optimistic-concurrency saves
    // (existing rows keep rev 0; legacy flat JSON stays until the client
    // migrates on read — this migration never rewrites user data)
    await ensureColumn('characters', 'appearance_rev', 'INTEGER NOT NULL DEFAULT 0', 'INTEGER NOT NULL DEFAULT 0');
    // W3: friends page — status-change timestamp on friendships (no-op on fresh DBs)
    await ensureColumn('friendships', 'updated_ts', 'INTEGER NOT NULL DEFAULT 0', 'BIGINT NOT NULL DEFAULT 0');
    // Phase 4 (Èkó Reserve): unpaid weekly upkeep bills (no interest, no lockouts)
    await ensureColumn('characters', 'bill_arrears', 'INTEGER NOT NULL DEFAULT 0', 'INTEGER NOT NULL DEFAULT 0');
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
    // M6: appearance revision counter for optimistic-concurrency saves
    await ensureColumn('characters', 'appearance_rev', 'INTEGER NOT NULL DEFAULT 0', '');
    // W3: friends page — status-change timestamp on friendships (no-op on fresh DBs)
    await ensureColumn('friendships', 'updated_ts', 'INTEGER NOT NULL DEFAULT 0', '');
    // Phase 4 (Èkó Reserve): unpaid weekly upkeep bills (no interest, no lockouts)
    await ensureColumn('characters', 'bill_arrears', 'INTEGER NOT NULL DEFAULT 0', '');
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

/** Character panel: change login username (validated by the caller). */
export async function setUsername(id, username) {
  await runQ('UPDATE users SET username=? WHERE id=?', 'UPDATE users SET username=$1 WHERE id=$2', [username, id]);
}

/** Character panel: change display name (validated by the caller). */
export async function setCharacterName(userId, name) {
  await runQ('UPDATE characters SET name=? WHERE user_id=?', 'UPDATE characters SET name=$1 WHERE user_id=$2', [name, userId]);
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

// M6: character lookup by character id (appearance endpoints —
// ownership is always verified against the session user id).
export async function getCharacterById(id) {
  return getOne(
    'SELECT * FROM characters WHERE id = ?',
    'SELECT * FROM characters WHERE id = $1',
    [id]);
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
  // M6: appearance_rev stays in lockstep with avatar_look.
  // DEFECT FIX (2026-10-11): the REST appearance PUT writes avatar_look +
  // appearance_rev directly to the DB, but the WS hub's in-memory character
  // row is NOT refreshed (only the legacy WS save_avatar path syncs it).
  // The next saveCharacter() of that stale row — the 60s decay tick, any
  // game act, a move-save — used to unconditionally overwrite the fresh
  // write, so "Saved ✓" silently reverted on reopen. The avatar columns are
  // now written only when the in-memory revision is NOT older than the
  // stored one (COALESCE guards pre-M6 NULL revs); all gameplay columns
  // keep the old unconditional behavior — the live session still owns them.
  const appearanceRev = Math.max(0, Math.floor(Number(c.appearance_rev ?? 0) || 0));
  // Phase 4 (Èkó Reserve): weekly-bill arrears — plain gameplay column,
  // persisted like every other character stat.
  const billArrears = Math.max(0, Math.floor(Number(c.bill_arrears) || 0));
  const params = [c.name, c.class, c.avatar, c.color, c.money, c.energy, c.health,
    c.happiness, c.hunger, c.housing, c.property, c.vehicle, c.biz ?? null, c.savings, c.loan,
    c.cert, c.location_id, c.x ?? null, c.y ?? null, c.rent_misses || 0,
    c.customized || 0, c.starter_loan_available || 0, c.loan_free || 0,
    c.shift_job ?? null, c.shift_started_at ?? null, c.shift_ends_at ?? null,
    c.fun ?? 100, c.social ?? 100, c.hygiene ?? 100, c.bladder ?? 100,
    Math.max(0, Math.floor(Number(c.perk_stars) || 0)), perksJson,
    Number(c.housing_owned) ? 1 : 0, skillsJson, skillsUsedJson,
    // Avatar columns: conditional (see the M6 note above) — params are
    // (inMemRev, avatarLookJson) then (inMemRev, inMemRev).
    appearanceRev, avatarLookJson, c.home_wall ?? null, c.home_floor ?? null,
    appearanceRev, appearanceRev,
    billArrears,
    Date.now(), c.user_id];
  await runQ(
    `UPDATE characters SET name=?, class=?, avatar=?, color=?, money=?, energy=?, health=?,
      happiness=?, hunger=?, housing=?, property=?, vehicle=?, biz=?, savings=?, loan=?,
      cert=?, location_id=?, x=?, y=?, rent_misses=?, customized=?, starter_loan_available=?,
      loan_free=?, shift_job=?, shift_started_at=?, shift_ends_at=?,
      fun=?, social=?, hygiene=?, bladder=?, perk_stars=?, perks=?,
      housing_owned=?, skills=?, skills_used=?,
      avatar_look=CASE WHEN COALESCE(appearance_rev,0) <= ? THEN ? ELSE avatar_look END,
      home_wall=?, home_floor=?,
      appearance_rev=CASE WHEN COALESCE(appearance_rev,0) <= ? THEN ? ELSE appearance_rev END,
      bill_arrears=?,
      updated_at=? WHERE user_id=?`,
    `UPDATE characters SET name=$1, class=$2, avatar=$3, color=$4, money=$5, energy=$6, health=$7,
      happiness=$8, hunger=$9, housing=$10, property=$11, vehicle=$12, biz=$13, savings=$14, loan=$15,
      cert=$16, location_id=$17, x=$18, y=$19, rent_misses=$20, customized=$21,
      starter_loan_available=$22, loan_free=$23, shift_job=$24, shift_started_at=$25, shift_ends_at=$26,
      fun=$27, social=$28, hygiene=$29, bladder=$30, perk_stars=$31, perks=$32,
      housing_owned=$33, skills=$34, skills_used=$35,
      avatar_look=CASE WHEN COALESCE(appearance_rev,0) <= $36 THEN $37 ELSE avatar_look END,
      home_wall=$38, home_floor=$39,
      appearance_rev=CASE WHEN COALESCE(appearance_rev,0) <= $40 THEN $41 ELSE appearance_rev END,
      bill_arrears=$42,
      updated_at=$43 WHERE user_id=$44`,
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

// ---------- wardrobe (Phase 6: boutique premium outfits) ----------

/** All boutique item ids owned by a user. */
export async function getWardrobe(userId) {
  const rows = await dbAll(
    'SELECT item_id FROM wardrobe WHERE user_id=? ORDER BY bought_at ASC',
    'SELECT item_id FROM wardrobe WHERE user_id=$1 ORDER BY bought_at ASC',
    [userId]);
  return rows.map(r => r.item_id);
}

/** True when the user owns the boutique item. */
export async function ownsBoutiqueItem(userId, itemId) {
  const row = await dbGet(
    'SELECT 1 AS one FROM wardrobe WHERE user_id=? AND item_id=?',
    'SELECT 1 AS one FROM wardrobe WHERE user_id=$1 AND item_id=$2',
    [userId, itemId]);
  return !!row;
}

/** Record a boutique purchase (idempotent — PK prevents duplicates). */
export async function addWardrobeItem(userId, itemId) {
  await dbRun(
    'INSERT OR IGNORE INTO wardrobe (user_id, item_id, bought_at) VALUES (?,?,?)',
    'INSERT INTO wardrobe (user_id, item_id, bought_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [userId, itemId, Date.now()]);
}

// Newest-first ledger rows for a player (used by tests; M3 economy UI).
export async function listTransactions(userId, limit = 50) {  const lim = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
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

/** Which candidate a voter picked in an election (null = hasn't voted). */
export async function getVote(electionId, voterId) {
  const r = await getOne(
    'SELECT candidate_id FROM votes WHERE election_id = ? AND voter_id = ?',
    'SELECT candidate_id FROM votes WHERE election_id = $1 AND voter_id = $2',
    [electionId, voterId]);
  return r ? Number(r.candidate_id) : null;
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
// M5 — friends (W3: extended with updated_ts + REST helpers)
// ============================================================
// Returns 'self' | 'exists' | 'accepted' (mutual auto-accept) | 'ok'.
// Idempotent: a duplicate pending/accepted pair returns 'exists' with no new
// row (also enforced by idx_friendships_unordered_pair). A past 'declined'
// is not a block — it restarts as a fresh request.
export async function addFriendRequest(requesterId, addresseeId) {
  if (Number(requesterId) === Number(addresseeId)) return 'self';
  let existing = await getOne(
    'SELECT * FROM friendships WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)',
    'SELECT * FROM friendships WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$3 AND addressee_id=$4)',
    [requesterId, addresseeId, addresseeId, requesterId]);
  if (existing && existing.status === 'declined') {
    await deleteFriendshipById(existing.id);
    existing = null;
  }
  if (existing) {
    // They already requested us → mutual interest, auto-accept.
    if (existing.status === 'pending' && Number(existing.requester_id) === Number(addresseeId)) {
      await runQ('UPDATE friendships SET status=?, updated_ts=? WHERE id=?',
        'UPDATE friendships SET status=$1, updated_ts=$2 WHERE id=$3', ['accepted', Date.now(), existing.id]);
      return 'accepted';
    }
    return 'exists';
  }
  const now = Date.now();
  try {
    await runQ(
      'INSERT INTO friendships (requester_id, addressee_id, status, created_ts, updated_ts) VALUES (?,?,?,?,?)',
      'INSERT INTO friendships (requester_id, addressee_id, status, created_ts, updated_ts) VALUES ($1,$2,$3,$4,$5)',
      [requesterId, addresseeId, 'pending', now, now]);
  } catch (e) {
    if (/unique|duplicate/i.test(e.message)) return 'exists'; // raced insert
    throw e;
  }
  return 'ok';
}

export async function respondFriendRequest(addresseeId, requesterId, accept) {
  const r = await getOne(
    'SELECT * FROM friendships WHERE requester_id=? AND addressee_id=? AND status=?',
    'SELECT * FROM friendships WHERE requester_id=$1 AND addressee_id=$2 AND status=$3',
    [requesterId, addresseeId, 'pending']);
  if (!r) return false;
  await runQ('UPDATE friendships SET status=?, updated_ts=? WHERE id=?',
    'UPDATE friendships SET status=$1, updated_ts=$2 WHERE id=$3',
    [accept ? 'accepted' : 'declined', Date.now(), r.id]);
  return true;
}

/** W3: single friendship row by id (REST authz checks). */
export async function friendshipById(id) {
  return getOne(
    'SELECT * FROM friendships WHERE id=?',
    'SELECT * FROM friendships WHERE id=$1',
    [id]);
}

/** W3: delete one friendship row by id (cancel request / unfriend). */
export async function deleteFriendshipById(id) {
  await runQ('DELETE FROM friendships WHERE id=?',
    'DELETE FROM friendships WHERE id=$1', [id]);
}

export async function removeFriend(a, b) {
  await runQ(
    'DELETE FROM friendships WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)',
    'DELETE FROM friendships WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$3 AND addressee_id=$4)',
    [a, b, b, a]);
}

// Pending + accepted rows for a player, with the other side's username
// and last_seen (W3: last_seen powers the friends-page presence display).
export async function listFriendships(playerId) {
  const rows = await getAll(
    `SELECT f.id, f.requester_id, f.addressee_id, f.status, f.created_ts, f.updated_ts,
            u.username AS other_username, u.last_seen AS other_last_seen
     FROM friendships f JOIN users u
       ON u.id = CASE WHEN f.requester_id=? THEN f.addressee_id ELSE f.requester_id END
     WHERE (f.requester_id=? OR f.addressee_id=?) AND f.status IN ('pending','accepted')
     ORDER BY f.created_ts DESC`,
    `SELECT f.id, f.requester_id, f.addressee_id, f.status, f.created_ts, f.updated_ts,
            u.username AS other_username, u.last_seen AS other_last_seen
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
    updated_ts: Number(r.updated_ts) || 0,
    other_last_seen: r.other_last_seen == null ? null : Number(r.other_last_seen),
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
// W3 — referral codes + attribution (data-only; no rewards)
// ============================================================
// Every user gets a unique, URL-safe referral code derived
// deterministically from their user id. The mapping is a bijection
// over 64 bits (multiply by an odd constant mod 2^64, then base62),
// so codes are unique by construction — collisions are impossible,
// no DB column needed, and resolution needs no lookup table.
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const REF_MULT = 6364136223846793005n;
const REF_ADD = 1442695040888963407n;
const REF_MOD = 1n << 64n;
const REF_CODE_LEN = 11; // 62^11 > 2^64, fixed length keeps decode exact
const REF_CODE_RE = /^[0-9A-Za-z]{11}$/;
// Modular inverse of REF_MULT mod 2^64 (odd → invertible), via Newton
// iteration. Each step is normalized to [0, 2^64) because BigInt % keeps
// the dividend's sign.
const REF_INV = (() => {
  let inv = 1n;
  for (let i = 0; i < 6; i++) {
    inv = (inv * (2n - REF_MULT * inv)) % REF_MOD;
    if (inv < 0n) inv += REF_MOD;
  }
  return inv;
})();

function base62Encode11(x) {
  let s = '';
  for (let i = 0; i < REF_CODE_LEN; i++) {
    s = B62[Number(x % 62n)] + s;
    x = x / 62n;
  }
  return s;
}

function base62Decode11(code) {
  let x = 0n;
  for (const ch of code) {
    const d = B62.indexOf(ch);
    if (d < 0) return null;
    x = x * 62n + BigInt(d);
  }
  return x;
}

/** Deterministic, unique, URL-safe referral code for a user id. */
export function encodeReferralCode(userId) {
  const id = BigInt(Number(userId));
  if (id <= 0n) throw new Error('encodeReferralCode: invalid user id');
  return base62Encode11((id * REF_MULT + REF_ADD) % REF_MOD);
}

/** Decode a code back to a user id, or null when malformed. */
export function decodeReferralCode(code) {
  if (typeof code !== 'string' || !REF_CODE_RE.test(code)) return null;
  const x = base62Decode11(code);
  if (x == null) return null;
  const id = ((x - REF_ADD + REF_MOD) % REF_MOD * REF_INV) % REF_MOD;
  return id > 0n && id <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(id) : null;
}

/** Resolve a referral code to its user row, or null (invalid/unknown). */
export async function resolveReferralCode(code) {
  const id = decodeReferralCode(code);
  if (!id) return null;
  return getUserById(id);
}

/**
 * Attribute a signup to a referrer. Returns true when recorded.
 * No self-referral, one attribution per referred user, referrer must exist.
 */
export async function recordReferral(referrerId, referredId) {
  referrerId = Number(referrerId);
  referredId = Number(referredId);
  if (!referrerId || !referredId || referrerId === referredId) return false;
  const [referrer, existing] = await Promise.all([
    getUserById(referrerId),
    getOne('SELECT referred_id FROM referrals WHERE referred_id=?',
      'SELECT referred_id FROM referrals WHERE referred_id=$1', [referredId]),
  ]);
  if (!referrer || existing) return false;
  try {
    await runQ(
      'INSERT INTO referrals (referrer_id, referred_id, created_ts) VALUES (?,?,?)',
      'INSERT INTO referrals (referrer_id, referred_id, created_ts) VALUES ($1,$2,$3)',
      [referrerId, referredId, Date.now()]);
  } catch (e) {
    if (/unique|duplicate/i.test(e.message)) return false; // raced insert
    throw e;
  }
  return true;
}

/** How many users signed up via this referrer's link. */
export async function countReferrals(referrerId) {
  const r = await getOne(
    'SELECT COUNT(*) AS c FROM referrals WHERE referrer_id=?',
    'SELECT COUNT(*) AS c FROM referrals WHERE referrer_id=$1',
    [Number(referrerId)]);
  return Number(r?.c) || 0;
}

/** Attribution row for a referred user (null when none). */
export async function getReferralFor(referredId) {
  return getOne(
    'SELECT * FROM referrals WHERE referred_id=?',
    'SELECT * FROM referrals WHERE referred_id=$1',
    [Number(referredId)]);
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
// Phase 3 — Gist social feed + News aggregator (original social layer).
// Gist text is stored plain; sanitization happens in routes/gists.js.
// ============================================================
export const GIST_MAX = 280;
export const NEWS_CACHE_MS = 30 * 60 * 1000;
export const NEWS_PAGE = 20;

/**
 * Author badge tiers (original names — not copied from any reference).
 * Tycoon tier overrides on net worth; the rest are account-age tiers.
 * Phase 8: the sitting governor always shows the Governor badge.
 */
export function gistBadge(accountCreatedAt, netWorth, isGovernor = false) {
  if (isGovernor) return 'Governor';
  const ageDays = (Date.now() - Number(accountCreatedAt || Date.now())) / 86400000;
  if (Number(netWorth) >= 1000000) return 'Odogwu';
  if (ageDays >= 90) return 'Legend';
  if (ageDays >= 30) return 'Veteran';
  if (ageDays >= 7) return 'Hustler';
  return 'New Kid';
}

/** Author profile for gist attribution (avatar/color/net worth/badge). */
export async function getGistAuthor(userId) {
  const r = await getOne(
    `SELECT u.id, u.username, u.created_at AS account_created,
            c.avatar, c.color, COALESCE(c.money,0) AS money, COALESCE(c.savings,0) AS savings
     FROM users u LEFT JOIN characters c ON c.user_id = u.id WHERE u.id = ?`,
    `SELECT u.id, u.username, u.created_at AS account_created,
            c.avatar, c.color, COALESCE(c.money,0) AS money, COALESCE(c.savings,0) AS savings
     FROM users u LEFT JOIN characters c ON c.user_id = u.id WHERE u.id = $1`,
    [Number(userId)]);
  if (!r) return null;
  const govId = Number(await getMeta('governor_id')) || 0;
  return {
    user_id: Number(r.id),
    username: r.username,
    avatar: r.avatar || '🧑',
    color: r.color || '#22d3ee',
    badge: gistBadge(r.account_created, Number(r.money) + Number(r.savings), govId !== 0 && govId === Number(r.id)),
  };
}

function shapeGist(row, viewerId) {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    username: row.username,
    avatar: row.avatar || '🧑',
    color: row.color || '#22d3ee',
    badge: row.badge || 'New Kid',
    text: row.text,
    created_at: Number(row.created_at),
    like_count: Number(row.like_count || 0),
    comment_count: Number(row.comment_count || 0),
    liked: !!Number(row.liked || 0),
    mine: Number(row.user_id) === Number(viewerId),
  };
}

// Shared FROM/JOIN: gists + author + like/comment counts + viewer's like flag.
const GIST_SELECT_SQLITE = `
  SELECT g.id, g.user_id, g.text, g.created_at,
         u.username, u.created_at AS account_created,
         c.avatar, c.color,
         COALESCE(c.money,0)+COALESCE(c.savings,0) AS net_worth,
         (SELECT COUNT(*) FROM gist_likes l WHERE l.gist_id = g.id) AS like_count,
         (SELECT COUNT(*) FROM gist_comments m WHERE m.gist_id = g.id) AS comment_count,
         EXISTS(SELECT 1 FROM gist_likes l2 WHERE l2.gist_id = g.id AND l2.user_id = ?) AS liked
  FROM gists g
  JOIN users u ON u.id = g.user_id
  LEFT JOIN characters c ON c.user_id = u.id`;
const GIST_SELECT_PG = `
  SELECT g.id, g.user_id, g.text, g.created_at,
         u.username, u.created_at AS account_created,
         c.avatar, c.color,
         COALESCE(c.money,0)+COALESCE(c.savings,0) AS net_worth,
         (SELECT COUNT(*) FROM gist_likes l WHERE l.gist_id = g.id) AS like_count,
         (SELECT COUNT(*) FROM gist_comments m WHERE m.gist_id = g.id) AS comment_count,
         EXISTS(SELECT 1 FROM gist_likes l2 WHERE l2.gist_id = g.id AND l2.user_id = $1) AS liked
  FROM gists g
  JOIN users u ON u.id = g.user_id
  LEFT JOIN characters c ON c.user_id = u.id`;

/**
 * Cursor-paginated gist feed.
 * tabs: latest | trending | following | me.
 * Cursor: last seen gist id for latest/me/following; "likes:id" for trending.
 * Returns { gists, next_cursor } — next_cursor null when the page is full-short.
 */
export async function listGists({ viewerId, tab = 'latest', cursor = null, limit = 15 }) {
  const lim = Math.max(1, Math.min(50, Math.floor(Number(limit) || 15)));
  const v = Number(viewerId);
  const t = ['latest', 'trending', 'following', 'me'].includes(tab) ? tab : 'latest';

  // Condition list in dialect-neutral form: each entry is
  // { s: <sqlite fragment with ?>, p: <pg fragment with @n>, vals: [...] }.
  // params[0] is always the viewer id (liked-flag EXISTS in the SELECT).
  const conds = [];
  const LIKE_COUNT = '(SELECT COUNT(*) FROM gist_likes l WHERE l.gist_id = g.id)';

  if (t === 'me') {
    conds.push({ s: 'g.user_id = ?', p: 'g.user_id = @1', vals: [v] });
  } else if (t === 'following') {
    conds.push({
      s: `g.user_id IN (
        SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END
        FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?))`,
      p: `g.user_id IN (
        SELECT CASE WHEN requester_id = @1 THEN addressee_id ELSE requester_id END
        FROM friendships WHERE status = 'accepted' AND (requester_id = @2 OR addressee_id = @3))`,
      vals: [v, v, v],
    });
  }

  let orderS, orderP, cursorKey;
  if (t === 'trending') {
    conds.push({ s: 'g.created_at >= ?', p: 'g.created_at >= @1', vals: [Date.now() - 7 * 86400000] });
    let likesCursor = null, idCursor = null;
    if (cursor) {
      const m = /^(\d+):(\d+)$/.exec(String(cursor));
      if (m) { likesCursor = Number(m[1]); idCursor = Number(m[2]); }
    }
    if (likesCursor != null) {
      conds.push({
        s: `(${LIKE_COUNT} < ? OR (${LIKE_COUNT} = ? AND g.id < ?))`,
        p: `(${LIKE_COUNT} < @1 OR (${LIKE_COUNT} = @2 AND g.id < @3))`,
        vals: [likesCursor, likesCursor, idCursor],
      });
    }
    orderS = 'ORDER BY like_count DESC, g.id DESC';
    orderP = 'ORDER BY like_count DESC, g.id DESC';
    cursorKey = 'likes';
  } else {
    const idCursor = cursor ? Number(cursor) : null;
    if (idCursor) conds.push({ s: 'g.id < ?', p: 'g.id < @1', vals: [idCursor] });
    orderS = 'ORDER BY g.id DESC';
    orderP = 'ORDER BY g.id DESC';
    cursorKey = 'id';
  }

  // Compile: sqlite keeps '?'; pg renumbers @1..@n across all fragments.
  const vals = [v];
  const fragS = [], fragP = [];
  for (const c of conds) {
    fragS.push(`(${c.s})`);
    let n = vals.length;
    fragP.push('(' + c.p.replace(/@(\\d+)/g, () => '$' + (++n)) + ')');
    vals.push(...c.vals);
  }
  const whereS = fragS.length ? 'WHERE ' + fragS.join(' AND ') : '';
  const whereP = fragP.length ? 'WHERE ' + fragP.join(' AND ') : '';
  const allVals = [...vals, lim + 1];
  const limitP = '$' + allVals.length;

  const rows = await getAll(
    `${GIST_SELECT_SQLITE} ${whereS} ${orderS} LIMIT ?`,
    `${GIST_SELECT_PG} ${whereP} ${orderP} LIMIT ${limitP}`,
    allVals);
  const page = rows.slice(0, lim);
  const last = page[page.length - 1];
  const next_cursor = rows.length > lim && last
    ? (cursorKey === 'likes' ? `${Number(last.like_count)}:${Number(last.id)}` : String(Number(last.id)))
    : null;
  const govId = Number(await getMeta('governor_id')) || 0;
  return {
    gists: page.map(r => ({ ...shapeGist(r, v), badge: gistBadge(r.account_created, r.net_worth, govId !== 0 && Number(r.user_id) === govId) })),
    next_cursor,
  };
}

export async function createGist(userId, text) {
  const now = Date.now();
  let id;
  if (pool) {
    const r = await pool.query(
      'INSERT INTO gists (user_id, text, created_at) VALUES ($1,$2,$3) RETURNING id',
      [Number(userId), String(text), now]);
    id = Number(r.rows[0].id);
  } else {
    const r = sdb.prepare('INSERT INTO gists (user_id, text, created_at) VALUES (?,?,?)')
      .run(Number(userId), String(text), now);
    id = Number(r.lastInsertRowid);
  }
  const author = await getGistAuthor(userId);
  return {
    id,
    user_id: Number(userId),
    username: author ? author.username : '',
    avatar: author ? author.avatar : '🧑',
    color: author ? author.color : '#22d3ee',
    badge: author ? author.badge : 'New Kid',
    text: String(text),
    created_at: now,
    like_count: 0,
    comment_count: 0,
    liked: false,
    mine: true,
  };
}

export async function getGist(id) {
  return getOne(
    'SELECT id, user_id, text, created_at FROM gists WHERE id = ?',
    'SELECT id, user_id, text, created_at FROM gists WHERE id = $1',
    [Number(id)]);
}

export async function deleteGist(id) {
  await runQ('DELETE FROM gist_likes WHERE gist_id = ?', 'DELETE FROM gist_likes WHERE gist_id = $1', [Number(id)]);
  await runQ('DELETE FROM gist_comments WHERE gist_id = ?', 'DELETE FROM gist_comments WHERE gist_id = $1', [Number(id)]);
  await runQ('DELETE FROM gist_reports WHERE gist_id = ?', 'DELETE FROM gist_reports WHERE gist_id = $1', [Number(id)]);
  await runQ('DELETE FROM gists WHERE id = ?', 'DELETE FROM gists WHERE id = $1', [Number(id)]);
}

export async function likeGist(gistId, userId) {
  const now = Date.now();
  await runQ(
    'INSERT OR IGNORE INTO gist_likes (gist_id, user_id, created_at) VALUES (?,?,?)',
    `INSERT INTO gist_likes (gist_id, user_id, created_at) VALUES ($1,$2,$3)
     ON CONFLICT (gist_id, user_id) DO NOTHING`,
    [Number(gistId), Number(userId), now]);
}

export async function unlikeGist(gistId, userId) {
  await runQ(
    'DELETE FROM gist_likes WHERE gist_id = ? AND user_id = ?',
    'DELETE FROM gist_likes WHERE gist_id = $1 AND user_id = $2',
    [Number(gistId), Number(userId)]);
}

export async function likeCount(gistId) {
  const r = await getOne(
    'SELECT COUNT(*) AS n FROM gist_likes WHERE gist_id = ?',
    'SELECT COUNT(*) AS n FROM gist_likes WHERE gist_id = $1',
    [Number(gistId)]);
  return Number(r && r.n ? r.n : 0);
}

export async function addGistComment(gistId, userId, text) {
  const now = Date.now();
  let id;
  if (pool) {
    const r = await pool.query(
      'INSERT INTO gist_comments (gist_id, user_id, text, created_at) VALUES ($1,$2,$3,$4) RETURNING id',
      [Number(gistId), Number(userId), String(text), now]);
    id = Number(r.rows[0].id);
  } else {
    const r = sdb.prepare('INSERT INTO gist_comments (gist_id, user_id, text, created_at) VALUES (?,?,?,?)')
      .run(Number(gistId), Number(userId), String(text), now);
    id = Number(r.lastInsertRowid);
  }
  const author = await getGistAuthor(userId);
  return {
    id,
    gist_id: Number(gistId),
    user_id: Number(userId),
    username: author ? author.username : '',
    avatar: author ? author.avatar : '🧑',
    color: author ? author.color : '#22d3ee',
    badge: author ? author.badge : 'New Kid',
    text: String(text),
    created_at: now,
  };
}

/** Oldest-first comments; cursor = last seen comment id. */
export async function listGistComments(gistId, cursor = null, limit = 20) {
  const lim = Math.max(1, Math.min(50, Math.floor(Number(limit) || 20)));
  const idCursor = cursor ? Number(cursor) : null;
  const rows = await getAll(
    `SELECT m.id, m.gist_id, m.user_id, m.text, m.created_at,
            u.username, u.created_at AS account_created, c.avatar, c.color,
            COALESCE(c.money,0)+COALESCE(c.savings,0) AS net_worth
     FROM gist_comments m JOIN users u ON u.id = m.user_id
     LEFT JOIN characters c ON c.user_id = u.id
     WHERE m.gist_id = ?${idCursor ? ' AND m.id > ?' : ''}
     ORDER BY m.id ASC LIMIT ?`,
    `SELECT m.id, m.gist_id, m.user_id, m.text, m.created_at,
            u.username, u.created_at AS account_created, c.avatar, c.color,
            COALESCE(c.money,0)+COALESCE(c.savings,0) AS net_worth
     FROM gist_comments m JOIN users u ON u.id = m.user_id
     LEFT JOIN characters c ON c.user_id = u.id
     WHERE m.gist_id = $1${idCursor ? ' AND m.id > $2' : ''}
     ORDER BY m.id ASC LIMIT $${idCursor ? 3 : 2}`,
    idCursor ? [Number(gistId), idCursor, lim + 1] : [Number(gistId), lim + 1]);
  const page = rows.slice(0, lim);
  const last = page[page.length - 1];
  const govId = Number(await getMeta('governor_id')) || 0;
  return {
    comments: page.map(r => ({
      id: Number(r.id),
      gist_id: Number(r.gist_id),
      user_id: Number(r.user_id),
      username: r.username,
      avatar: r.avatar || '🧑',
      color: r.color || '#22d3ee',
      badge: gistBadge(r.account_created, r.net_worth, govId !== 0 && Number(r.user_id) === govId),
      text: r.text,
      created_at: Number(r.created_at),
    })),
    next_cursor: rows.length > lim && last ? String(Number(last.id)) : null,
  };
}

export async function addGistReport(gistId, reporterId, reason) {
  const now = Date.now();
  if (pool) {
    const r = await pool.query(
      `INSERT INTO gist_reports (gist_id, reporter_id, reason, status, created_at)
       VALUES ($1,$2,$3,'open',$4) RETURNING id`,
      [Number(gistId), Number(reporterId), String(reason).slice(0, 200), now]);
    return Number(r.rows[0].id);
  }
  const r = sdb.prepare(
    `INSERT INTO gist_reports (gist_id, reporter_id, reason, status, created_at)
     VALUES (?,?,?,?,?)`)
    .run(Number(gistId), Number(reporterId), String(reason).slice(0, 200), 'open', now);
  return Number(r.lastInsertRowid);
}

export async function listGistReports(limit = 50) {
  const lim = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
  const rows = await getAll(
    `SELECT r.id, r.gist_id, g.text AS gist_text, r.reporter_id, ru.username AS reporter,
            r.reason, r.status, r.created_at
     FROM gist_reports r JOIN users ru ON ru.id = r.reporter_id
     LEFT JOIN gists g ON g.id = r.gist_id
     ORDER BY r.id DESC LIMIT ?`,
    `SELECT r.id, r.gist_id, g.text AS gist_text, r.reporter_id, ru.username AS reporter,
            r.reason, r.status, r.created_at
     FROM gist_reports r JOIN users ru ON ru.id = r.reporter_id
     LEFT JOIN gists g ON g.id = r.gist_id
     ORDER BY r.id DESC LIMIT $1`,
    [lim]);
  return rows.map(r => ({
    id: Number(r.id),
    gist_id: Number(r.gist_id),
    gist_text: r.gist_text || null,
    reporter_id: Number(r.reporter_id),
    reporter: r.reporter,
    reason: r.reason,
    status: r.status,
    created_at: Number(r.created_at),
  }));
}

// ============================================================
// Phase 3 — News aggregator cache (headline aggregator hygiene:
// title + source + link + short snippet only, never article bodies).
// ============================================================
export async function upsertNewsItem({ source, title, link, snippet = '', published_at = null }) {
  const now = Date.now();
  const snip = String(snippet || '').slice(0, 160);
  const pub = published_at == null ? null : Number(published_at);
  await runQ(
    `INSERT INTO news_items (source, title, link, snippet, published_at, fetched_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(link) DO UPDATE SET fetched_at = excluded.fetched_at`,
    `INSERT INTO news_items (source, title, link, snippet, published_at, fetched_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT(link) DO UPDATE SET fetched_at = excluded.fetched_at`,
    [String(source), String(title).slice(0, 300), String(link), snip, pub, now]);
}

export async function pruneNewsItems(maxAgeMs = 48 * 3600 * 1000) {
  await runQ(
    'DELETE FROM news_items WHERE fetched_at < ?',
    'DELETE FROM news_items WHERE fetched_at < $1',
    [Date.now() - maxAgeMs]);
}

/** Newest-first; cursor = "publishedAt:id". */
export async function listNewsItems(cursor = null, limit = NEWS_PAGE) {
  const lim = Math.max(1, Math.min(50, Math.floor(Number(limit) || NEWS_PAGE)));
  let pubCursor = null, idCursor = null;
  if (cursor) {
    const m = /^(-?\d+):(\d+)$/.exec(String(cursor));
    if (m) { pubCursor = Number(m[1]); idCursor = Number(m[2]); }
  }
  const andS = pubCursor == null ? '' : ' AND (COALESCE(published_at, 0) < ? OR (COALESCE(published_at, 0) = ? AND id < ?))';
  const andP = pubCursor == null ? '' : ' AND (COALESCE(published_at, 0) < $1 OR (COALESCE(published_at, 0) = $1 AND id < $2))';
  const rows = await getAll(
    `SELECT id, source, title, link, snippet, published_at, fetched_at
     FROM news_items WHERE 1=1${andS}
     ORDER BY COALESCE(published_at, 0) DESC, id DESC LIMIT ?`,
    `SELECT id, source, title, link, snippet, published_at, fetched_at
     FROM news_items WHERE 1=1${andP}
     ORDER BY COALESCE(published_at, 0) DESC, id DESC LIMIT $${pubCursor == null ? 1 : 3}`,
    pubCursor == null ? [lim + 1] : [pubCursor, pubCursor, idCursor, lim + 1]);
  const page = rows.slice(0, lim);
  const last = page[page.length - 1];
  return {
    items: page.map(r => ({
      id: Number(r.id),
      source: r.source,
      title: r.title,
      link: r.link,
      snippet: r.snippet || '',
      published_at: r.published_at == null ? null : Number(r.published_at),
      fetched_at: Number(r.fetched_at),
    })),
    next_cursor: rows.length > lim && last
      ? `${Number(last.published_at) || 0}:${Number(last.id)}` : null,
  };
}

/** ms since the cache was last refreshed (Infinity when empty). */
export async function newsCacheAgeMs() {
  const r = await getOne(
    'SELECT MAX(fetched_at) AS m FROM news_items',
    'SELECT MAX(fetched_at) AS m FROM news_items', []);
  const m = r && r.m != null ? Number(r.m) : null;
  return m == null ? Infinity : Date.now() - m;
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

// ============================================================
// Phase 7 — Èkó Rich List (rank players by net worth, public board)
// Net-worth formula (identical to bank.js netWorth):
//   wallet coins + savings + ACTIVE bond principal.
// Matured bonds already paid out into the wallet, so they are
// counted once (in money), never twice.
// Admin stealth-money note: ranking reads the STORED money/savings/
// bond values only. The admin purchase bypass never inflates stored
// balances, so no unlimited flag can leak through this board.
// ============================================================
const RICH_NW_FROM = `
  FROM users u
  LEFT JOIN characters c ON c.user_id = u.id
  LEFT JOIN (
    SELECT user_id, SUM(principal) AS active_principal
    FROM bank_bonds WHERE matured = 0 GROUP BY user_id
  ) b ON b.user_id = u.id
  WHERE COALESCE(u.banned, 0) = 0`;
const RICH_NW_EXPR = `COALESCE(c.money,0) + COALESCE(c.savings,0) + COALESCE(b.active_principal,0)`;

/** Top players by net worth. Banned users excluded. Limit capped at 50. */
export async function listTopByNetWorth(limit = 25) {
  const lim = Math.max(1, Math.min(50, Math.floor(Number(limit) || 25)));
  const rows = await getAll(
    `SELECT u.id, u.username, COALESCE(c.avatar,'🧑') AS avatar, COALESCE(c.color,'#22d3ee') AS color,
       ${RICH_NW_EXPR} AS net_worth ${RICH_NW_FROM}
     ORDER BY net_worth DESC, u.id ASC LIMIT ?`,
    `SELECT u.id, u.username, COALESCE(c.avatar,'🧑') AS avatar, COALESCE(c.color,'#22d3ee') AS color,
       ${RICH_NW_EXPR} AS net_worth ${RICH_NW_FROM}
     ORDER BY net_worth DESC, u.id ASC LIMIT $1`,
    [lim]);
  return rows.map(r => ({
    id: Number(r.id),
    username: r.username,
    avatar: r.avatar,
    color: r.color,
    netWorth: Math.floor(Number(r.net_worth) || 0),
  }));
}

/**
 * 1-based net-worth rank of a user (1 + players strictly richer; ties
 * share the rank below them), plus total ranked players and the user's
 * own net worth. Returns nulls when the user has no rankable row.
 */
export async function getNetWorthRank(userId) {
  const me = await getOne(
    `SELECT ${RICH_NW_EXPR} AS net_worth ${RICH_NW_FROM} AND u.id = ?`,
    `SELECT ${RICH_NW_EXPR} AS net_worth ${RICH_NW_FROM} AND u.id = $1`,
    [Number(userId)]);
  if (!me) return { rank: null, totalPlayers: 0, netWorth: 0 };
  const myNw = Math.floor(Number(me.net_worth) || 0);
  const higher = await getOne(
    `SELECT COUNT(*) AS n FROM (SELECT ${RICH_NW_EXPR} AS net_worth ${RICH_NW_FROM}) t WHERE t.net_worth > ?`,
    `SELECT COUNT(*) AS n FROM (SELECT ${RICH_NW_EXPR} AS net_worth ${RICH_NW_FROM}) t WHERE t.net_worth > $1`,
    [myNw]);
  const total = await getOne(
    `SELECT COUNT(*) AS n ${RICH_NW_FROM}`,
    `SELECT COUNT(*) AS n ${RICH_NW_FROM}`,
    []);
  return {
    rank: Number(higher.n) + 1,
    totalPlayers: Number(total.n),
    netWorth: myNw,
  };
}

// ============================================================
// M21: notifications — backend-agnostic CRUD + preferences.
// data is stored as a JSON string; callers pass a plain object.
// Preferences: absent row = all toggles on (lazy default).
// ============================================================
export async function createNotification(userId, type, title, body, data) {
  const now = Date.now();
  const dataStr = data != null ? JSON.stringify(data) : null;
  if (pool) {
    const r = await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, data, read, created_at)
       VALUES ($1,$2,$3,$4,$5,0,$6) RETURNING id`,
      [Number(userId), String(type), String(title), body != null ? String(body) : null, dataStr, now]);
    return Number(r.rows[0].id);
  }
  const r = sdb.prepare(
    `INSERT INTO notifications (user_id, type, title, body, data, read, created_at)
     VALUES (?,?,?,?,?,0,?)`)
    .run(Number(userId), String(type), String(title), body != null ? String(body) : null, dataStr, now);
  return Number(r.lastInsertRowid);
}

export async function listNotifications(userId, limit = 30, offset = 0) {
  const lim = Math.max(1, Math.min(100, Math.floor(Number(limit) || 30)));
  const off = Math.max(0, Math.floor(Number(offset) || 0));
  const rows = await getAll(
    `SELECT id, user_id, type, title, body, data, read, created_at FROM notifications
     WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    `SELECT id, user_id, type, title, body, data, read, created_at FROM notifications
     WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
    [Number(userId), lim, off]);
  return rows.map(r => ({
    id: Number(r.id),
    type: r.type,
    title: r.title,
    body: r.body || null,
    data: (() => { try { return r.data ? JSON.parse(r.data) : null; } catch { return null; } })(),
    read: !!Number(r.read),
    created_at: Number(r.created_at),
  }));
}

export async function countUnreadNotifications(userId) {
  const row = await getOne(
    `SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND read=0`,
    `SELECT COUNT(*) AS c FROM notifications WHERE user_id=$1 AND read=0`,
    [Number(userId)]);
  return Number(row ? row.c : 0);
}

export async function markNotificationRead(userId, id) {
  const r = await runQ(
    `UPDATE notifications SET read=1 WHERE id=? AND user_id=? AND read=0`,
    `UPDATE notifications SET read=1 WHERE id=$1 AND user_id=$2 AND read=0`,
    [Number(id), Number(userId)]);
  return Number(r.changes) > 0;
}

export async function markAllNotificationsRead(userId) {
  await runQ(
    `UPDATE notifications SET read=1 WHERE user_id=? AND read=0`,
    `UPDATE notifications SET read=1 WHERE user_id=$1 AND read=0`,
    [Number(userId)]);
}

const NOTIF_PREF_KEYS = ['friend_online', 'room_message', 'money_received'];

export async function getNotificationPrefs(userId) {
  const row = await getOne(
    `SELECT friend_online, room_message, money_received FROM notification_prefs WHERE user_id=?`,
    `SELECT friend_online, room_message, money_received FROM notification_prefs WHERE user_id=$1`,
    [Number(userId)]);
  if (!row) return { friend_online: true, room_message: true, money_received: true };
  const out = {};
  for (const k of NOTIF_PREF_KEYS) out[k] = !!Number(row[k]);
  return out;
}

export async function setNotificationPrefs(userId, prefs) {
  const vals = {};
  for (const k of NOTIF_PREF_KEYS) {
    vals[k] = prefs && prefs[k] === false ? 0 : 1;
  }
  await runQ(
    `INSERT INTO notification_prefs (user_id, friend_online, room_message, money_received)
     VALUES (?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET friend_online=excluded.friend_online,
       room_message=excluded.room_message, money_received=excluded.money_received`,
    `INSERT INTO notification_prefs (user_id, friend_online, room_message, money_received)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT(user_id) DO UPDATE SET friend_online=excluded.friend_online,
       room_message=excluded.room_message, money_received=excluded.money_received`,
    [Number(userId), vals.friend_online, vals.room_message, vals.money_received]);
  return getNotificationPrefs(userId);
}

/** Single preference check without fetching the whole row. */
export async function notificationPrefOn(userId, key) {
  if (!NOTIF_PREF_KEYS.includes(key)) return true;
  const prefs = await getNotificationPrefs(userId);
  return !!prefs[key];
}

// ============================================================
// Fintech — backend-agnostic transaction helper (ADDITIVE only;
// no existing game code path uses it).
//
// dbTransaction(cb) runs cb() inside a single DB transaction on the
// active backend and serializes concurrent transactions with a
// promise mutex, so two journal posts can never interleave on one
// backend connection:
//
// - PostgreSQL: checks out ONE client from the pool and temporarily
//   routes the module's query helpers (dbRun/dbGet/dbAll) through it
//   for the duration of the callback, so every statement in cb()
//   shares the same BEGIN/COMMIT. (Non-transactional game queries may
//   briefly run on that client instead of the pool — same API, harmless.)
// - SQLite (node:sqlite): BEGIN IMMEDIATE / COMMIT / ROLLBACK on the
//   single DatabaseSync connection.
//
// Re-entrant: calling dbTransaction inside an active transaction just
// runs the callback (no nested BEGIN).
// ============================================================
let txChain = Promise.resolve(); // serialization mutex across transactions
let txDepth = 0;                 // >0 while the mutex holder is inside a tx

export async function dbTransaction(cb) {
  if (txDepth > 0) return cb();
  const run = txChain.then(async () => {
    txDepth++;
    try {
      if (pool) {
        const client = await pool.connect();
        const prev = pool;
        pool = client; // route dbRun/dbGet/dbAll through the tx client
        try {
          await client.query('BEGIN');
          const out = await cb();
          await client.query('COMMIT');
          return out;
        } catch (e) {
          try { await client.query('ROLLBACK'); } catch { /* ignore */ }
          throw e;
        } finally {
          pool = prev;
          client.release();
        }
      } else {
        sdb.exec('BEGIN IMMEDIATE');
        try {
          const out = await cb();
          sdb.exec('COMMIT');
          return out;
        } catch (e) {
          try { sdb.exec('ROLLBACK'); } catch { /* ignore */ }
          throw e;
        }
      }
    } finally {
      txDepth--;
    }
  });
  // Keep the chain alive even when a transaction fails; the caller
  // still receives the original rejection via `run`.
  txChain = run.then(() => undefined, () => undefined);
  return run;
}
