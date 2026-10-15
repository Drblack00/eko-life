-- dialect: both
-- 009-contest-photo.sql — UGC Design Contests: optional entry photo.
-- Adds a nullable `photo` column (image data URL, e.g. "data:image/jpeg;...").
-- Portable: plain ADD COLUMN is valid in both SQLite and Postgres.
-- Idempotent via the runner's meta-table guard (migration:009 is recorded
-- after a successful apply and never re-run). Gameplay coins only —
-- photos are player-snapped outfit/apartment shots, never real money.

ALTER TABLE contest_entries ADD COLUMN photo TEXT;
