-- dialect: postgres
-- 001-initial-schema.sql — baseline snapshot of PG_SCHEMA from server/src/db.js
-- (extracted 2026-10-15). Idempotent: all statements use IF NOT EXISTS.
-- SQLite installs keep using the inline SQLITE_SCHEMA in db.js.

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
  money BIGINT NOT NULL DEFAULT 5000,
  energy INTEGER NOT NULL DEFAULT 100,
  health INTEGER NOT NULL DEFAULT 100,
  happiness INTEGER NOT NULL DEFAULT 60,
  hunger INTEGER NOT NULL DEFAULT 100,
  housing TEXT NOT NULL DEFAULT 'face-me',
  property TEXT NOT NULL DEFAULT 'none',
  vehicle TEXT NOT NULL DEFAULT 'none',
  savings BIGINT NOT NULL DEFAULT 0,
  loan BIGINT NOT NULL DEFAULT 0,
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
  amount BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
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
-- Phase 9: Daily Gem Hunt — one hidden gem per game day.
CREATE TABLE IF NOT EXISTS gem_days (
  day INTEGER PRIMARY KEY,
  location_id TEXT NOT NULL,
  clue TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS gem_finds (
  day INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  found_at BIGINT NOT NULL,
  prize INTEGER NOT NULL,
  finder_rank INTEGER NOT NULL,
  PRIMARY KEY (day, user_id)
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
  principal BIGINT NOT NULL,
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
