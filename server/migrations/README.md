# Migrations

Schema changes go here as numbered, idempotent SQL files. Newest last.

## Convention

- File name: `NNN-short-description.sql` (e.g. `001-initial-schema.sql`).
- Every statement must be idempotent: `CREATE TABLE IF NOT EXISTS`,
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (PG) with a SQLite fallback,
  `CREATE INDEX IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`.
- The migration runner (see `runner.js`) records applied migrations in the
  `meta` table (`key = 'migration:<NNN>'`) and skips them on later boots.
- Never edit an applied migration. Write a new one.

## History

The pre-migration schema lived as inline `CREATE TABLE IF NOT EXISTS` in
`server/src/db.js` (78 statements). `001-initial-schema.sql` is a snapshot
of that baseline — new installs apply it; existing installs already have
these tables and skip it via the meta-table check.
