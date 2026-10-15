// ============================================================
// runner.js — idempotent SQL migration runner
// Applies server/migrations/NNN-*.sql in order, recording each in the
// meta table so reruns are no-ops. Uses dbRun/dbGet from db.js so each
// migration can carry both SQLite and Postgres variants.
// Migration file format:
//
//   -- dialect: both | postgres | sqlite
//   <SQL statements, idempotent, ending with ;>
//
// For "both", the same SQL must run on both dialects (use only portable
// syntax: CREATE TABLE IF NOT EXISTS with portable types, etc.).
// ============================================================
import { readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { dbRun, dbGet, dbMode } from '../src/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseMigration(text) {
  const dialectMatch = text.match(/^--\s*dialect:\s*(both|postgres|sqlite)/m);
  const dialect = dialectMatch ? dialectMatch[1] : 'both';
  const sql = text
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { dialect, statements: sql };
}

export async function runMigrations() {
  const mode = dbMode();
  const files = readdirSync(__dirname)
    .filter((f) => /^\d{3}-.*\.sql$/.test(f))
    .sort();
  for (const file of files) {
    const id = file.slice(0, 3);
    const done = await dbGet(
      `SELECT value FROM meta WHERE key = ?`,
      `SELECT value FROM meta WHERE key = $1`,
      [`migration:${id}`]
    );
    if (done) continue;
    const { dialect, statements } = parseMigration(
      readFileSync(join(__dirname, file), 'utf8')
    );
    if (dialect !== 'both' && dialect !== mode) continue;
    for (const stmt of statements) {
      await dbRun(stmt, stmt, []);
    }
    await dbRun(
      `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`,
      `INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT(key) DO NOTHING`,
      [`migration:${id}`, new Date().toISOString()]
    );
    console.log(`[migrate] applied ${file} (${mode})`);
  }
}
