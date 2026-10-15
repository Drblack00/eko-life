-- dialect: sqlite
-- 007-contests.sql — UGC Design Contests tables (SQLite variant).
-- Postgres twin: 008-contests.sql (runner allows one dialect per file).
-- Idempotent: IF NOT EXISTS everywhere; seed guarded with WHERE NOT EXISTS.

CREATE TABLE IF NOT EXISTS contests (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  prize_text TEXT NOT NULL,
  vote_budget_per_day INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS contest_entries (
  id INTEGER PRIMARY KEY,
  contest_id INTEGER NOT NULL REFERENCES contests(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  design_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contest_votes (
  id INTEGER PRIMARY KEY,
  contest_id INTEGER NOT NULL REFERENCES contests(id),
  voter_id INTEGER NOT NULL REFERENCES users(id),
  entry_id INTEGER NOT NULL REFERENCES contest_entries(id),
  voted_at TEXT NOT NULL,
  UNIQUE (voter_id, entry_id)
);

CREATE INDEX IF NOT EXISTS idx_contest_entries_contest ON contest_entries(contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_votes_entry ON contest_votes(contest_id, entry_id);
CREATE INDEX IF NOT EXISTS idx_contest_votes_voter ON contest_votes(voter_id, voted_at);

INSERT INTO contests (title, category, starts_at, ends_at, prize_text, vote_budget_per_day, status)
SELECT
  'Owambe Fit Check',
  'outfit',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now',
    '+' || (CASE WHEN CAST(strftime('%w', 'now') AS INTEGER) = 0 THEN 7
                ELSE 7 - CAST(strftime('%w', 'now') AS INTEGER) END) || ' days',
    '+23 hours', '+59 minutes'),
  '₦500K game cash + featured boutique slot',
  5,
  'active'
WHERE NOT EXISTS (SELECT 1 FROM contests WHERE title = 'Owambe Fit Check' AND status = 'active');
