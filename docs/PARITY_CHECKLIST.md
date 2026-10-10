# Èkó Life — Feature Parity Checklist vs Audit

Columns: **Ref** = reference status (VERIFIED / INFERRED / INACCESSIBLE);
**Impl** = implemented; **Func** = functional; **Persist** = persists across reload;
**Mobile** = works on mobile; **Tests** = automated tests pass; **Diff** = known differences.

Updated per milestone. "—" = not yet built.
**M6 status (2026-10-09):** FINAL QA — server `npm test` 108/108 ✅ (fixed a real
ban/online-registry race, no test weakening); client vitest 36/36 ✅
(new: `toPin`, `naira`, API normalization); `npm run build` ✅; two-client live
smoke 23/23 ✅ (A: register→character→travel→work→eat; friends; A creates room,
B joins, room chat both ways; A loan ₦100k→run→B votes→admin end-election→both
get `{t:'gov'}`; A gov_broadcast received by B; block hides chat, report stored);
security re-scan ✅ (headers live, auth 429 verified live at 11th rapid
register, zero `eval(` / `innerHTML` / hardcoded secrets, SQL all parameterized,
tokens on `crypto`); a11y static audit in `docs/A11Y.md` (touch targets ⚠️ 2
exceptions, labels ❌ 11 inputs, contrast ❌ 5 pairs — flagged, non-blocking).
Unverified: real-browser visuals, iPhone Safari, Postgres paths —
see `docs/KNOWN_LIMITATIONS.md`. Nothing deployed (deploy is the user's call).
**M1 status (2026-10-09):** server `npm test` 18/18 ✅; client `npm run build` ✅;
REST+WS smoke-tested live (guest→/api/me→WS init). 3D visuals NOT yet seen in a
real browser — needs parent's browser check.

| # | Feature (from audit) | Ref | Impl | Func | Persist | Mobile | Tests | Known differences |
|---|---|---|---|---|---|---|---|---|
| 1 | 3D isometric city landing (Three.js, Mainland/Lagoon/Island) | VERIFIED | ✅ | ⚠️ | n/a | ⚠️ | — | Our own procedural art; pinch-zoom ALLOWED (ref disables it). Render verified only by build — needs real-browser visual check |
| 2 | Location pins (100+), hover tooltips, click dialogs | VERIFIED | ✅(24) | ✅ | n/a | ⚠️ | — | Gated dialogs become playable previews for guests (improvement #1); 24 pins M1 → 60+ in M3 |
| 3 | Live player presence figures on map | VERIFIED | ✅ | ✅ | n/a | ⚠️ | — | GET /api/presence (public, polled) renders avatar dots on landing map; in-game presence via WS |
| 4 | Live counters (online, visits, homes) | VERIFIED | ✅ | ✅ | ✅ | — | ✅ | Our own /api/stats with documented semantics |
| 5 | Governor elections (weekly, run/vote) | VERIFIED | ✅ | ✅ | ✅ | ⚠️ | ✅ | 7-game-day cycle, ₦50k fee, 1 vote/player, broadcast perk + salary; mechanics are our own design |
| 6 | Housing on map (player houses, online count) | VERIFIED | ✅ | ✅ | ✅ | ⚠️ | ✅ | Ownable properties count toward public homes counter; on-map house markers M5 |
| 7 | Minimum-wage law mechanic (economy lever) | VERIFIED | — | — | — | — | — | Roadmap: wage lever event in economy tick |
| 8 | Signup/login (username/email + password, 18+) | VERIFIED | ✅ | ✅ | ✅ | ⚠️ | ✅ | 18+ is a hard gate (ref: "recommended"); guest mode added |
| 9 | PWA packaging (manifest, maskable icons, standalone, en-NG) | VERIFIED | ✅ | ⚠️ | n/a | ⚠️ | — | viewport allows scaling; SW install flow needs real-device check |
| 10 | Boot hardening (progressive loading, start-fresh recovery) | VERIFIED | ✅ | ⚠️ | n/a | ⚠️ | — | + offline action queue (M2); chunk-failure auto-reload pending |
| 11 | Client error beacon POST /api/client-error | VERIFIED | ✅ | ✅ | n/a | — | ✅ | Same contract shape |
| 12 | Toast notifications | VERIFIED | ✅ | ⚠️ | n/a | — | — | Needs browser check |
| 13 | News ticker | VERIFIED | ✅ | ✅ | n/a | ⚠️ | — | GET /api/news public feed; landing marquee (static under reduced-motion) |
| 14 | In-game advertising (billboards, Sea Plots) | VERIFIED | — | — | — | — | — | ROADMAP ONLY — no real-money/ad systems in v1 |
| 15 | Character creation + starting classes | INFERRED | ✅ | ✅ | ✅ | ⚠️ | ✅ | Original class names/effects (ref names undecided by user); effects shown before choosing |
| 16 | Character stats (energy/health/happiness/hunger) | INACCESSIBLE | ✅ | ✅ | ✅ | ⚠️ | ✅ | Our own documented rules (decay, eat/sleep/rest/work) |
| 17 | Jobs, earnings, spending, rent | INFERRED | ✅ | ✅ | ✅ | ⚠️ | ✅ | Original balanced economy; rent + eviction (3 misses → bridge) in day loop |
| 18 | Real-time multiplayer (chat, movement, DMs, friends, rooms) | INFERRED | ✅ | ✅ | ✅ | ⚠️ | ✅ | WS realtime; chat safety from day one (filter, block/report, rate limits, kick/mute) |
| 19 | Server-side persistence | INFERRED | — | — | — | — | — | — |
| 20 | Transport (danfo etc.), travel costs | INFERRED | ✅ | ✅ | ✅ | ⚠️ | ✅ | Travel between locations (energy cost); vehicles M3 |
| 21 | Shops/businesses/vehicles/property income | INACCESSIBLE | ✅ | ✅ | ✅ | ⚠️ | ✅ | Businesses pay daily income (online+offline); vehicles gate move speed |
| 22 | Skills/progression, inventory, furniture | INACCESSIBLE | ✅ | ✅ | ✅ | ⚠️ | ✅ | Furniture inventory + 6 placement slots with gameplay effects; study/cert progression |
| 23 | Nightlife/clubs | INACCESSIBLE | ✅ | ✅ | ✅ | ⚠️ | — | Club/beach locations with fun actions (location-tagged) |
| 24 | Leaderboards | INACCESSIBLE | ✅ | ✅ | n/a | ⚠️ | — | GET /api/leaderboard top-10 by money (public) |

## v2 build notes (2026-10-10) — M7–M13 integrated, all original code/art/text
- M7 real-time clock + 1-hour shifts: `work` intent retired (errors, points to shifts); 24 career tracks; Lagos clock broadcast 30s + REST; forfeit-on-leave (no prorata).
- M8 six needs + moodlets: decay tick honors moodlet/perk/city-event multipliers; eat/fun/sleep/rest/travel/loan/bank trigger moodlets.
- M9 daily hunt (21h riddles, tiered prizes) + Today's Hustle (3 missions → stars) + 14 perks on the shared effect contract.
- M10 player shops (city-wide; no open/closed state), rent-to-own 48× weekly rent, LAPO loans (4 weekly debits, 5% flat), progressive tax from the ledger.
- M11 governor policies with real teeth (48h pick window, default fallback, multipliers reset per term) + persistent commissioners.
- M12 nine skills + rust (capped) + academy (2 lessons/day, quizzes, certs boost job gates).
- M13 3D billboards (canvas-generated original ads) + admin CRUD.
- Full suite green: server 245/245, client 36/36; two-client smoke (register→shift→needs→hunt→shop→rent→vote) passed — see docs/smoke-v2.mjs.
- Not deployed; no live-service changes.
