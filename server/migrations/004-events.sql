-- dialect: both
-- 004-events.sql — Live Events Calendar schema (Phase: events).
-- Idempotent, portable to SQLite and Postgres: no dialect-specific
-- types or functions (event ids are TEXT slugs, no auto-increment).
-- Gameplay coins only — nothing here touches real money.

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '📅',
  venue TEXT NOT NULL,
  time_label TEXT NOT NULL DEFAULT '',
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  details_json TEXT NOT NULL DEFAULT '[]',
  prize_text TEXT,
  is_recurring INTEGER NOT NULL DEFAULT 0,
  recurring_rule TEXT,
  season_tag TEXT,
  season_blurb TEXT,
  base_attendees INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id),
  CHECK (status IN ('going', 'remind'))
);
CREATE INDEX IF NOT EXISTS idx_events_starts ON events (starts_at);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_event ON event_rsvps (event_id);
