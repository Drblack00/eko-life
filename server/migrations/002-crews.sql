-- dialect: both
-- 002-crews.sql — Crews (player clans): crews, crew_members, crew_xp_log.
-- Idempotent: every statement uses IF NOT EXISTS. Portable syntax only
-- (TEXT / INTEGER / BIGINT / UNIQUE / plain indexes) so the same SQL runs
-- unchanged on SQLite and Postgres. Crews start EMPTY — no seed rows.

CREATE TABLE IF NOT EXISTS crews (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '🛡️',
  founded_at BIGINT NOT NULL DEFAULT 0,
  goal_title TEXT NOT NULL DEFAULT '',
  goal_target BIGINT NOT NULL DEFAULT 0,
  goal_raised BIGINT NOT NULL DEFAULT 0,
  goal_ends_at BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS crew_members (
  crew_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  xp BIGINT NOT NULL DEFAULT 0,
  joined_at BIGINT NOT NULL DEFAULT 0,
  UNIQUE(crew_id, user_id)
);
CREATE TABLE IF NOT EXISTS crew_xp_log (
  crew_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  xp BIGINT NOT NULL DEFAULT 0,
  earned_at BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_crew_members_crew ON crew_members(crew_id);
CREATE INDEX IF NOT EXISTS idx_crew_members_user ON crew_members(user_id);
CREATE INDEX IF NOT EXISTS idx_crew_xp_log_crew ON crew_xp_log(crew_id);
CREATE INDEX IF NOT EXISTS idx_crew_xp_log_earned ON crew_xp_log(earned_at);
