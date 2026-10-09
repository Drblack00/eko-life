# Èkó Life — Security Notes (M4)

Threat model, what's enforced where, and known limitations. v1 has **no real
money** — the asset being protected is game integrity (virtual ₦, stats,
accounts) plus account credentials.

## Threat model

| Threat | Impact | Mitigation |
|---|---|---|
| Client forges money/stats in WS messages | Economy corruption | Server-authoritative: every number is re-derived or validated in `game/actions.js`; client params like `money:999999` are ignored. Covered by `tests/anti_cheat.test.js`. |
| Double-spend (two concurrent purchases, one balance) | Duplicated items / negative money | Affordability checks run synchronously against the shared session character before the first `await`; second request sees the deducted balance. Race test in `tests/anti_cheat.test.js`. |
| Negative / zero amounts in money intents | Money creation | `bank`, `loan`, `repay` reject non-positive amounts before any mutation. |
| Teleport / speed hacks | Map cheating | `move` validated against bounds + max speed (base × vehicle mult × elapsed + slack); violations snap back (`snap`). |
| Spawn-collect from anywhere | Free money | `collect` is proximity-checked (≤ 4 map units); failed attempts never consume the spawn (peek-first). |
| Act spam / brute-force gameplay | Server load, cooldown bypass | Per-user act rate limit: 30 acts/min sliding window → dropped with `err` (hub). Per-action cooldowns (work/sleep/rest/study) are server-side timestamps. |
| Credential stuffing / password guessing | Account takeover | Auth endpoints rate-limited to 10/min/IP; 5 bad passwords → 15-min lockout per username. bcrypt (10 rounds). |
| Session forgery | Account takeover | HMAC-SHA256 signed tokens, 7-day expiry; signature compared with `crypto.timingSafeEqual` (auth.js). |
| Banned user reconnects | Ban evasion | Ban sets `users.banned`; WS connect gate closes with 4403, `/api/me` and gameplay return 403; admin ban also kills the live session (4403). |
| XSS / clickjacking / MIME sniffing | Client compromise | Security headers on all responses (see below). |
| Stack-trace / internals leakage | Info disclosure | Generic error middleware: 500s return `{ error:'Something went wrong.' }`; details logged server-side only. |
| Mass account creation (guest spam) | DB bloat | Guests require the 18+ `ageConfirm` gate; no CAPTCHA yet (accepted for v1, revisit if abused). |

## Enforcement map (where each check lives)

- `server/src/game/actions.js` — all gameplay validation: affordability, location/cooldown/ownership gates, `harden()` (ints, stats clamped 0–100, money floored ≥ 0) before every persist; every money move writes a `transactions` ledger row.
- `server/src/ws/hub.js` — connection auth (token → user → banned check), single session per user (old kicked with 4409), move anti-cheat, act rate limit (30/min), chat cooldown (1.2s) + `cleanText` profanity filter.
- `server/src/auth.js` — HMAC token sign/verify (timing-safe), bcrypt passwords, 18+ DOB check, guest flow, auth rate limit (10/min/IP), password lockout (5 fails → 15 min).
- `server/src/routes/admin.js` — `requireAdmin` (Bearer, `is_admin=1`, not banned); admins can never be banned.
- `server/src/app.js` — security headers, `express.json({ limit:'32kb' })`, generic 500 handler.

### Security headers (all responses)
`X-Content-Type-Options: nosniff` · `X-Frame-Options: DENY` ·
`Referrer-Policy: strict-origin-when-cross-origin` ·
`Cross-Origin-Opener-Policy: same-origin` ·
`Permissions-Policy: camera=(), microphone=(), geolocation=()` ·
`Strict-Transport-Security: max-age=31536000` (no-op on local HTTP; enforced on Render's TLS).

### Rate limits (current)
| Scope | Limit | Response |
|---|---|---|
| Auth endpoints (`/api/auth/*`) | 10 req/min per IP | 429 `{ error:'Too many attempts, slow down.' }` |
| Bad passwords | 5 fails → 15-min lockout per username | 429 with retry minutes |
| Chat (`chat` WS msg) | 1 per 1.2s per user | `{ t:'err', text:'Slow down on the chat.' }` |
| Gameplay acts (`act` WS msg) | 30 per 60s per user (sliding window) | `{ t:'err', text:'Too many actions — slow down a bit.' }` |
| JSON body | 32 KB max | 413 → generic error JSON |

> **X-RateLimit note:** the API does not currently send `X-RateLimit-Limit` /
> `X-RateLimit-Remaining` / `X-RateLimit-Reset` response headers — limits are
> documented here instead. Adding those headers is a small, safe follow-up
> (compute from the existing sliding-window counters).

## What's NOT yet covered

- **Admin surface has no audit log.** Broadcasts/bans/promotions are logged to stdout only; consider a DB `admin_audit` table in M5.
- **`make-admin` has no confirmation / demote path.** There is no remove-admin endpoint yet; demotion is a manual DB edit.
- **No CSRF tokens** — the API is Bearer-token based (no cookies), so CSRF does not apply; if cookie auth is ever added, revisit.
- **No WAF / bot mitigation** beyond rate limits. The 18+ gate and guest flow are abuse-tolerant, not abuse-proof.
- **Express 4 async errors:** route handlers are `async` without a wrapper — a rejected promise inside a handler (e.g. a DB failure mid-request) may not reach the generic error middleware. The JSON-parse path and sync throws are covered; a future pass should add an `asyncHandler` wrapper or move to Express 5.

## Known limitations (deploy-relevant)

- **No Postgres staging here.** All M4 work was tested against SQLite (`:memory:` in tests, file locally). The PG code paths (`pool` branches, `ensureColumn` on PG, `listRoster` PG query) are written but **untested** — the first production deploy must be smoke-tested: register, login, play an act, check `/api/health` reports `db:"postgres"`.
- **SQLite file lives on ephemeral disk.** On Render's free tier the local `eko-life.db` is wiped on every redeploy/restart — production must attach the Postgres database (see `docs/DEPLOY.md`); never rely on the SQLite file in prod.
- **Rate limits are in-memory per instance.** Auth hits, lockouts, chat cooldowns, and act windows live in process Maps. With one free-tier instance this is correct; if the service ever scales to multiple instances, move these to Redis/DB.
- **First-admin bootstrap:** the first-ever registered user becomes admin automatically (`maybeFirstAdmin`). After the first admin exists, promotion is via `POST /api/admin/make-admin` only. Guard the launch window: register the owner's account first.
- **Secrets:** `SESSION_SECRET` must be set in production (Render generates one via the Blueprint). The dev fallback is logged loudly at boot — never ship with it.

## M6 re-scan (2026-10-09)

Static grep over `server/src` + live checks against a fresh local boot
(`PORT=3010`, `:memory:` DB, test `SESSION_SECRET` — no real secrets touched).

**Static results — all clean:**
- `eval(`: zero matches. `innerHTML`: zero matches server-side; client is
  React with no `dangerouslySetInnerHTML` usage.
- Template-literal SQL: the only `${}` interpolations in `db.js` are
  hardcoded literals (`ensureColumn('users','email',…)` migration names;
  fixed column lists in `listRoster`). All user values go through
  parameterized queries (79 `?` placeholders via the `exec`/`get`/`all`
  helpers). No concatenation-built queries.
- `Math.random`: used only for gameplay randomness (street-find spawn
  placement/amounts in `ws/hub.js`) — never in auth, tokens, or security
  decisions. Tokens: HMAC-SHA256 via `crypto.createHmac`, signature compared
  with `crypto.timingSafeEqual` (auth.js:26-38); guest names from
  `crypto.randomBytes` (auth.js:128). ✅
- Hardcoded secrets: none found (no `password = '…'`, `secret = '…'`,
  `api_key = '…'` outside test/dev fallbacks).

**Live results (curl against the fresh boot):**
- Security headers present on both API and static responses: `nosniff`,
  `X-Frame-Options: DENY`, `strict-origin-when-cross-origin`,
  `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy`
  (camera/mic/geolocation disabled), `Strict-Transport-Security`
  (no-op on local HTTP). ✅
- 404s return JSON `{ error:'Not found.' }` (HTTP 404). Malformed JSON body →
  generic `{ error:'Something went wrong.' }` with **no stack trace**
  (server logs the parse error only). ✅
- Auth rate limit verified live: 10 rapid `POST /api/auth/register` →
  all 200; the 11th → **429** `{ error:'Too many attempts, slow down.' }`
  (auth.js:73). Window resets after 60s (subsequent register → 200). ✅

**Bug found and fixed during this scan:** admin ban raced the `online`
registry — a banned player's WS was closed with 4403 but they remained in
`hub.online` until the async socket-close handler ran, so a roster read in
between showed them online (flaky failure of `admin.test.js`'s ban/roster
assertion). Fix: new `hub.forceDisconnect(id, 4403, 'banned')` removes the
session synchronously (persists position, broadcasts `leave` + `stats`) before
closing the socket; `/api/admin/ban` uses it. Server `npm test` still
108/108, and the previously-flaky assertion is now deterministic.
