# Èkó Life — Deploy Guide (Render Blueprint, M4)

Single service: Node 22 + Express + `ws` serving `web/dist` + `/api/*` + WS on
`/ws`, with Postgres. Blueprint file: `render.yaml` at the repo root.

## render.yaml — verified against the real layout (M4)

| Key | Value | Verified |
|---|---|---|
| `buildCommand` | `npm run install:all && npm run build:web` | Runs from repo root; root scripts use `--prefix`, so both `server/` and `web/` install and the client builds correctly. |
| `startCommand` | `npm start` | Root `start` → `npm --prefix server start` → `node src/index.js` in `server/`. No `cd server` needed — the `--prefix` chain handles it. |
| Build output | `web/dist` | Matches `vite.config.ts` (`outDir: "dist"`) and `app.js`, which serves `<repo>/web/dist` and falls back to API-only when absent. |
| `healthCheckPath` | `/api/health` | Public, returns `{ ok:true, online, day, db, version }`. |
| `SESSION_SECRET` | `generateValue: true` | Render injects a random secret; the server refuses to boot quietly with the dev fallback (it logs a loud warning — check logs). |
| `DATABASE_URL` | `fromDatabase: eko-life-db` | Postgres attached automatically; the server uses the PG adapter when `DATABASE_URL` is set, SQLite otherwise. |
| DB | `eko-life-db`, free plan | Database name `ekolife`, user `ekolife`. |

No fix was needed — the Blueprint already matches the layout. (One tweak made
in M4: `"engines": { "node": ">=22" }` added to the **root** `package.json`,
because Render reads the Node version from the root and `node:sqlite` requires
Node 22.5+.)

## Deploy steps (Blueprint)

1. Push the repo to GitHub (branch `main`).
2. In Render: **New → Blueprint** → select the repo. Render reads `render.yaml`
   and proposes the `eko-life` web service + `eko-life-db` Postgres.
3. Confirm the plan (free), the build/start commands (pre-filled from the
   Blueprint), and the two env vars (`SESSION_SECRET` generated,
   `DATABASE_URL` from the database). No manual env vars needed.
4. **Apply.** Build takes a few minutes (`npm install` × 2 + Vite build).
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
| `DATABASE_URL` | `fromDatabase: eko-life-db` | Full connection string; the server enables `ssl: { rejectUnauthorized:false }` for Render PG. |
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
- **Ephemeral disk:** anything written to the local filesystem (including a
  fallback `eko-life.db`) is wiped on redeploy/restart — Postgres is the
  only durable store. Never set `EKO_DB_PATH` in production.
- Rate limits are in-memory per instance (fine at one instance; see
  `docs/SECURITY.md` if scaling up).
