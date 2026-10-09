# Èkó Life — Architecture Notes

**Working title:** Èkó Life. All code, art, copy, and game data are original.
The feature inventory of lagoslife.app (docs/AUDIT_REPORT.md) is the only input
taken from the reference — never its code, art, or text.

## Stack decision (M1, coordinator call)

| Layer | Choice | Why |
|---|---|---|
| Client | React 19 + TypeScript + Vite, Three.js r180 for the 3D city, PWA manifest | The audit proved 3D isometric is the genre expectation; Vite PWA gives installability/code-splitting without Next.js SSR weight. |
| Server | Node 22 + Express + `ws`, single service serving `web/dist` + API + WS | Proven pattern from `~/workspace/benin-life-multiplayer/` (live on Render): one free-tier service, no CORS/WS-proxy complexity, trivial deploy. PROJECT_PLAN §1 lists this exact pattern as the blessed fallback — chosen up front because the game is WS-heavy and UI state is client-held, so SSR buys nothing. |
| DB | SQLite (node:sqlite) local dev → PostgreSQL (DATABASE_URL) production | Same dual adapter as prior art; zero native deps locally. |
| Auth | bcryptjs (10 rounds) + HMAC-signed token (7-day expiry), Bearer header / `?token=` for WS | Reuse of the proven token scheme. |
| Realtime | `ws` hub, server-authoritative | All economy/state mutations validated server-side; clients only send intents. |

## Module layout

```
server/src/
  index.js        — boot: express, static web/dist, /api/*, WS hub mount, game loop
  db.js           — SQLite/PG dual adapter + schema (eko-life.db)
  auth.js         — register/login/guest/migrate, rate limits, lockouts, token sign/verify
  game/
    data.js       — LOCATIONS, JOBS, FOOD, FUN, HOUSING, CLASSES, constants (server source of truth)
    sim.js        — needs decay, day loop, rent, economy tick (pure-ish helpers, unit-tested)
    actions.js    — server-authoritative action handlers (work/eat/sleep/travel/buy/...)
    elections.js  — weekly governor cycle helpers
  ws/
    hub.js        — connection registry, presence broadcast, rate-limited message routing
    social.js     — M5: news ring, friends, rooms, DMs, blocks, reports, @mentions
    chat.js       — (planned) chat/DM/rooms helpers (profanity filter, @mentions)
  routes/
    api.js        — REST: health, stats, config, client-error, admin
  util.js         — clamp, haversine, clean(), logging
server/tests/     — node:test unit + WS integration tests (must stay green)

web/src/
  main.tsx, App.tsx, router (views, no react-router — tiny view switch is enough for v1)
  views/          — Landing (3D city), Auth (signup/login/guest), CreateCharacter, Game (HUD+tabs)
  game/           — three CityMap component (instanced low-poly, LOD, chunked), avatar sprites
  components/     — Design-system primitives (Button, Card, Sheet, Toast, StatBar, Dialog)
  styles/         — design tokens (CSS vars), light/day theme + night theme
  hooks/          — useGameSocket (WS client), useApi, useToast
  pwa/            — manifest.webmanifest, icons (original SVG), service worker (vite-plugin-pwa)
```

## Key invariants (non-negotiable)

1. **Server-authoritative economy.** Money, stats, inventory, votes only change in
   `server/src/game/*`. Client sends intents; server validates (affordability, zone,
   cooldown, ownership) and returns the new state. Never trust client-computed values.
2. **No real money in v1.** Virtual naira (₦) only. No cash-out, no wagering, no ads SDK.
3. **Rate limits:** auth 10/min/IP; chat 1/1.2s; votes 1/election; actions per-action cooldowns; gameplay acts 30/min/user (M4, sliding window — see docs/SECURITY.md for the full table).
4. **18+ gate at signup** (DOB check); guest mode allowed (guests are 18+ gated too —
   confirm age before guest play).
5. **Guest → account migration:** registering with a `guestToken` converts the guest row
   in place (same id, progress kept).
6. **Accessibility:** pinch-zoom allowed (`user-scalable=yes`), safe-area insets,
   `prefers-reduced-motion` honored (disable idle animations), touch targets ≥ 44px,
   color contrast AA on text.
7. **Boot hardening (from audit improvement #9):** progressive loading states
   (slow-network notice, start-fresh recovery clearing SW + caches), client-error beacon
   `POST /api/client-error`.
8. **Tests:** `npm test` in server/ runs unit + WS integration tests; keep green every milestone.

## Game constants (v1, original design)

- 1 game day = 5 real minutes. Needs decay tick 60s.
- Stats: energy, health, happiness, hunger, money(₦). Clamp 0–100 (money ≥ 0).
- Starting classes: **Silver Spoon** (privileged: ₦50,000, own self-con, +10 starting happiness,
  jobs pay −10% "soft life tax") vs **Street Smart** (struggling: ₦5,000, face-me housing,
  small ₦10,000 starter loan available once, jobs pay +10% hustle bonus). Effects shown
  before choosing.
- Geography: Mainland (west) / Lagos Lagoon (center water) / Island (east). Locations are
  original riffs (markets, motor parks, campuses, beaches) — not the reference's list.
- Governor elections: 7-game-day cycle, candidacy fee ₦50,000, one vote per player,
  winner gets broadcast perk + salary.
