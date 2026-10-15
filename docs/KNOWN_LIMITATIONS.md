# Èkó Life — Known Limitations (M6, final QA — 2026-10-09; updated post-M6 2026-10-10 ~00:05 WAT)

Everything below is **unverified, untested, or explicitly out of scope** for v1.
This is the handoff list: nothing here blocks a deploy-ready verdict, but each
item names what must still be checked and by whom.

## Verified since M6 (headless Chromium, local server, 2026-10-10)

- **Landing, character creation, City/Work/Chat tabs, and mobile (390×844) game
  view all render correctly** — screenshots taken in headless Chromium; no page
  errors. Lagoon pins were re-scattered (they formed a visible straight column).
- **FIXED — guest character creation was impossible.** The server generated guest
  usernames as `Guest-xxxxxx`, but the username/character-name regex
  (`^[a-zA-Z0-9_]{3,16}$`, client + server) rejects hyphens — so the prefilled
  name failed validation and "Start my Lagos story" silently did nothing for
  every guest. Guest names are now `Guest_xxxxxx`; server suite 108/108 green
  after the fix, and the full guest → character → game flow was re-verified in
  the browser. (Root cause found by real-browser visual check, not by tests —
  the tests asserted the old hyphenated format.)

## Unverified — needs a real browser / device

- **3D city visuals never seen in a real browser.** The client builds green and
  the CityMap code paths are exercised by unit tests (pure mappers only), but no
  human or screenshot has confirmed the Three.js landing actually renders
  correctly. Needs the parent's live-browser check.
- **iPhone Safari.** Touch targets, safe-area insets, `100dvh`, pinch-zoom
  allowance, and the PWA manifest/install flow were verified statically only.
  Real-device check required (iPhone + Android) before announcing.
- **Reduced-motion + focus-visible in practice.** CSS/JS hooks exist and are
  statically verified (see `docs/A11Y.md`), but no keyboard-only or
  reduced-motion user session has been run.
- **Service worker / offline behavior.** `vite-plugin-pwa` is configured, but
  install prompts, offline action queue (M2), and chunk-failure recovery have
  not been exercised in a browser.

## Unverified — production infrastructure

- **Postgres paths are untested.** The entire suite runs against SQLite
  (`:memory:`). The PG branches (`pool` queries, `ensureColumn` on PG, the PG
  `listRoster`) have never executed. The **first production deploy must run the
  post-deploy smoke test** in `docs/DEPLOY.md` (register → login → act →
  `/api/health` reports `db:"postgres"`).
- **Deployed (updated 2026-10-15).** The "Not deployed" note below is stale —
  the game has been deployed to Render many times since M6 and is live at
  https://ekolife.onrender.com. `/api/health` returns 200 with `"db":"postgres"`
  and startup logs confirm `[db] PostgreSQL connected`, so the PG data path
  runs in production. Free-tier cold starts (~30–60s) remain unmeasured.
- **Not deployed (M6, stale).** No deploy was performed in M6 (the user's call). The Render
  Blueprint (`render.yaml`) was re-verified against the repo layout and
  `npm run build:web` works from the repo root, but no build has run on Render
  yet. Free-tier cold starts (~30–60s) are unmeasured.
- **Rate limits are in-memory per instance.** Correct for one free-tier
  instance; a multi-instance future needs Redis/DB-backed limits
  (see `docs/SECURITY.md`).
- **SQLite file is ephemeral on Render.** Production must attach Postgres;
  never rely on the local `eko-life.db` in prod.

## Known gaps (documented, not fixed in M6)

- **Accessibility:** 11 inputs lack accessible labels; 5 palette pairs fail
  AA contrast (links, primary button, success/danger text); 2 touch targets
  are 40px instead of 44px. Full audit with locations and recommended fixes:
  `docs/A11Y.md`.
- **Admin:** no audit log for broadcasts/bans/promotions (stdout only); no
  demote-admin endpoint (manual DB edit); no confirmation on `make-admin`.
- **Async error handling:** Express 4 route handlers are `async` without a
  wrapper — a rejected promise mid-handler may miss the generic 500 JSON.
  JSON-parse and sync throws are covered; add `asyncHandler` or move to
  Express 5 in a follow-up.
- **No `X-RateLimit-*` response headers** — limits are documented in
  `docs/SECURITY.md` instead (small follow-up).
- **No CAPTCHA / bot mitigation** beyond rate limits (accepted for v1).
- **No real money in v1** by design — virtual naira only, no cash-out,
  no wagering, no ads SDK (see `docs/ARCHITECTURE.md` invariant 2).

## Test coverage notes

- Server: 108 `node:test` tests (unit + WS integration) — all green.
- Client: 36 vitest tests covering **pure logic only** (`toPin` mapper,
  `naira` formatter, API response normalization, catalog helpers). No
  DOM/Three.js tests; components, hooks, and the WS client are untested
  by automation.
- The two-client M6 smoke (23/23) was run against a local `:memory:` boot —
  it does not cover Postgres, TLS, or Render networking.

## Out of scope for v1 (roadmap)

- Minimum-wage law economy lever, in-game advertising / Sea Plots
  (no real-money systems in v1), chunk-failure auto-reload on the client.
