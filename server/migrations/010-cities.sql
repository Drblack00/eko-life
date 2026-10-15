-- dialect: both
-- 010-cities.sql — Home City V1: cities table seeded with the 4 playable cities.
-- The characters.home_city / characters.current_city columns are added by
-- initDb's idempotent ensureColumn() (codebase pattern for character columns —
-- it runs on every boot, before migrations, on both SQLite and Postgres), so
-- this migration only owns the cities table. Gameplay coins only.

CREATE TABLE IF NOT EXISTS cities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  tagline TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🏙️',
  starting_cash INTEGER NOT NULL DEFAULT 5000,
  pay_mult REAL NOT NULL DEFAULT 1,
  cost_mult REAL NOT NULL DEFAULT 1
);

INSERT INTO cities (id, name, state, tagline, emoji, starting_cash, pay_mult, cost_mult) VALUES
  ('lagos', 'Lagos', 'Lagos State',
   'The hustle capital — higher pay, higher bills, zero sleep.',
   '🌉', 2000, 1.15, 1.15),
  ('benin', 'Benin City', 'Edo State',
   'The ancient bronze kingdom — heritage, festivals, and quiet old money.',
   '🏛️', 3000, 1.0, 0.95),
  ('ph', 'Port Harcourt', 'Rivers State',
   'Oil & gas money flows here — big contracts, bigger weekends.',
   '🛢️', 3000, 1.2, 1.1),
  ('abuja', 'Abuja', 'FCT',
   'The capital — government contracts, civil service, planned-city calm.',
   '🦅', 2500, 1.1, 1.1)
ON CONFLICT(id) DO NOTHING;
