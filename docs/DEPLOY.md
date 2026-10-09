# Èkó Life — Deploy Guide (Render Blueprint + Supabase Postgres, M4; updated 2026-10-10)

Web service: Node 22 + Express + `ws` serving `web/dist` + `/api/*` + WS on
`/ws`, on Render (free). Database: Supabase Postgres (free tier) — Render
allows only one free managed Postgres per workspace and that slot is taken by
`benin-life-db`, so the Blueprint no longer provisions a database; `DATABASE_URL`
is set manually in the Render dashboard (`sync: false` in render.yaml).
Blueprint file: `render.yaml` at the repo root.

## render.yaml — verified against the real layout

| Key | Value | Verified |
|---|---|---|
| `buildCommand` | `npm run install:all && npm run build:web` | Runs from repo root; root scripts use `--prefix`, so both `server/` and `web/` install and the client builds correctly. |
| `startCommand` | `npm start` | Root `start` → `npm --prefix server start` → `node src/index.js` in `server/`. No `cd server` needed — the `--prefix` chain handles it. |
| Build output | `web/dist` | Matches `vite.config.ts` (`outDir: "dist"`) and `app.js`, which serves `<repo>/web/dist` and falls back to API-only when absent. |
| `healthCheckPath` | `/api/health` | Public, returns `{ ok:true, online, day, db, version }`. |
| `SESSION_SECRET` | `generateValue: true` | Render injects a random secret; the server refuses to boot quietly with the dev fallback (it logs a loud warning — check logs). |
| `DATABASE_URL` | `sync: false` (manual) | Set in the Render dashboard → Environment from the Supabase project's connection string. The Blueprint never overwrites it. |

No `databases:` section — the Supabase project is created once in the Supabase
dashboard (see below), not via the Blueprint.

## 0. Create the Supabase project (one-time)

1. Sign up / sign in at supabase.com (GitHub OAuth works).
2. New project: name `eko-life-db`, generate a strong database password
   (save it in a password manager — it is only shown once), pick the region
   closest to the players (EU West / Ireland is the usual pick for Nigeria).
3. Wait for the project to finish provisioning (a few minutes).
4. Project → Connect → connection string, **URI** format
   (`postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres`).
   Copy the full URI — this is the value for `DATABASE_URL`.
   The server's pg pool uses `ssl: { rejectUnauthorized: false }`, which works
   with Supabase out of the box.

## Deploy steps (Blueprint)

1. Push the repo to GitHub (branch `main`).
2. In Render: open the existing **`eko-life` Blueprint** (registered 2026-10-09;
   it previously failed only on the database step) and sync/refresh it so it
   picks up the new `render.yaml` (no `databases:` section). It will propose
   just the `eko-life` web service.
   - If the Blueprint misbehaves, alternative: delete it and create the web
     service manually via New → Web Service → Public Git Repository
     `https://github.com/Drblack00/eko-life`, with the same build/start
     commands and health check path as in `render.yaml`.
3. In the service → **Environment**: add `DATABASE_URL` = the Supabase URI
   from step 0. Confirm `SESSION_SECRET` was generated.
4. **Deploy** (manual deploy if auto-deploy is off). Build takes a few
   minutes (`npm install` × 2 + Vite build).
5. Watch the deploy logs for the boot line:
   `[boot] Èkó Life server live on port … — Day 1 — db: postgres`
   `db: postgres` confirms the PG adapter picked up `DATABASE_URL`.
   Also confirm there is **no** `[warn] SESSION_SECRET not set` line.

## Post-deploy smoke test (required — PG paths are untested in CI)

The test suite runs against SQLite; the PG branches have never executed.
Run this checklist against the live URL before announcing:

1. `GET /api/health` → 200, `db:"postgres"`.
2. `GET /api/config` → 200, 68 locations.
3. Register a user (this becomes the **first admin** — do it before anyone else).
4. Login → token; `GET /api/me` → 200.
5. Open the client, connect WS, run a `work` act → money increases.
6. Admin: `GET /api/admin/players` with the admin token → roster.
7. Check Render Postgres metrics: tables `users`, `characters`, `transactions` exist.

## First-admin flow

- The **first-ever registered account** is auto-promoted to admin
  (`maybeFirstAdmin`). Register the owner's account immediately after deploy,
  before sharing the link.
- After that, promote others only via `POST /api/admin/make-admin`.
  There is no demote endpoint yet — demotion is a manual DB edit
  (`UPDATE users SET is_admin=0 WHERE username='…'`).
- If the owner account is somehow not first: the DB is fresh at first deploy,
  so this only matters if you wipe the database later.

## Env vars

| Key | Source | Notes |
|---|---|---|
| `SESSION_SECRET` | Render `generateValue` | Random per deploy; rotating it invalidates all existing tokens (users re-login). |
| `DATABASE_URL` | Manual → Supabase project connection string (URI) | Full `postgresql://…` URI; server enables `ssl: { rejectUnauthorized:false }`. Never commit it to the repo. |
| `PORT` | Render-injected | The server listens on `process.env.PORT \|\| 3000`. |
| `EKO_DB_PATH` | _not set in prod_ | Only for local dev/tests (`:memory:` in tests). |

## Viewing logs

Render dashboard → `eko-life` service → **Logs** tab. Useful server log
prefixes: `[boot]`, `[db]`, `[auth]`, `[ws]`, `[act]`, `[admin]`,
`[anticheat]`, `[economy]`, `[rent]`, `[decay]`, `[client-error]`, `[500]`.

## Rollback

Render keeps every deploy. To roll back: dashboard → service → **Deploys** →
find the last good deploy → **Rollback** (re-deploys that commit's build).
Database migrations in M4 are additive (`ensureColumn`, new tables are
`IF NOT EXISTS`), so rolling the code back does not break the DB.

## Free-tier caveats

- The service **sleeps when idle** — first request after idle takes ~30–60s
  (cold start). The client should show its slow-network loading state.
- **Supabase free tier:** the project **pauses after ~7 days of inactivity**
  and resumes on next use (first connection after a pause is slow). 500 MB
  database size limit — plenty for launch.
- **Ephemeral disk:** anything written to the local filesystem (including a
  fallback `eko-life.db`) is wiped on redeploy/restart — Supabase Postgres is
  the only durable store. Never set `EKO_DB_PATH` in production.
- Rate limits are in-memory per instance (fine at one instance; see
  `docs/SECURITY.md` if scaling up).
