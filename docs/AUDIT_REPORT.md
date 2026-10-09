# Lagos Life — Reverse-Engineering Audit Report

**Reference:** https://lagoslife.app/ (browser game by Shalom Rayhamen / Vatar)
**Audit date:** 2026-10-09, ~21:26–21:30 WAT (Africa/Lagos)
**Method:** Live-browser inspection of the public surface + page-source analysis + news coverage.
**Constraints honored:** No accounts created, no personal data entered, no purchases,
no authentication bypass, no private endpoints probed. All gameplay sits behind a
login wall; there is no guest/demo mode on the reference.

> All observations below are paraphrased feature facts. No proprietary code,
> assets, or text were copied. Claims are tagged VERIFIED / INFERRED / INACCESSIBLE.

---

## 1. Page & route inventory (public)

| Route / surface | Status | Notes |
|---|---|---|
| `/` (landing) | VERIFIED | The landing page IS the city: full-viewport 3D isometric Lagos rendered on a Three.js canvas. Regions labeled MAINLAND (left), LAGOS LAGOON (center water), ISLAND (right). 100+ circular emoji location pins float over 3D points; hover reveals labels. Animated colored avatar figures near some pins (presence). A wall of in-game advertising billboards on the Island. |
| Signup view (in-app) | VERIFIED | Full-page takeover. Tabs: Create account / Log in. Fields: username-or-email, password (show toggle), forgot-password link. Caption notes free forever, no credit card. An 18+ recommendation badge is shown. |
| Login view (in-app) | VERIFIED | Same card, login tab. Username-or-email + password. |
| Location dialogs (in-app, guest) | VERIFIED | Clicking any map pin opens a gated dialog (e.g. for a market) inviting the guest to create a character to hang out, meet players, and chat. Dismiss via Escape/X. |
| Governor dialog (in-app, guest) | VERIFIED | Pill in top bar opens a "state house" dialog: a named player is governor this week; guests are invited to sign up to vote in the next election or run themselves. |
| Sea Plots dialog (in-app, guest) | VERIFIED | Advertising product: brands rent patches of water on the lagoon to display ads to players, from a stated floor price per plot. Hundreds of brands already listed. |
| Homes dialog (in-app, guest) | VERIFIED | Housing teaser: a few hundred player houses on the map, dozens online at check time. Guests invited to sign up to move in. |
| `/robots.txt`, `/api/stats`, `/api/online`, `/api/landing` | VERIFIED | All return the default Next.js 404 — these are not public routes. |
| `/manifest.webmanifest` | VERIFIED | PWA manifest: standalone display, any orientation, categories games/entertainment/social, locale en-NG, icons incl. maskable. |
| Gameplay screens (HUD, stats, jobs, chat, map-as-player) | INACCESSIBLE | Everything interactive beyond teasers requires an account. |

### Named locations observed on the map (sample; 100+ pins total)

Afrika Shrine, Viewing Centre, Amala Shitta, CcHub, Market, Freedom Park, i-Fitness,
Office, Quilox, Canopy Walk, The Palms, The Library, Beach, General Hospital,
Mama Bisi's Salon, Ivory Rooftop, Police Station, Church, Mosque, Naija Radio,
Polling Unit, Eko Hotels, Polanco Motors, Boat Cruise, Ikoyi Golf Club, High Court,
UNILAG, Eko Casino, MindSpace, Stadium, Snooker Spot, Balogun Market, plus
"coming soon" pins (a crowned figure, Airport, Refinery).

### Live counters observed (landing, drifting upward)

- Online users (~144k at check time, pulsing dot)
- Total visits (~28.9M, incrementing)
- Homes on map (~400), homes online (~72)
- Current governor handle pill
- News ticker (e.g. a minimum-wage law announcement)

---

## 2. Feature inventory

### VERIFIED (seen directly)

1. **3D isometric city landing** — Three.js r186, bright daytime toy-like art: pastel sky,
   saturated green landmasses, blue lagoon water, white low-poly buildings, emoji pins.
   Pan/zoom by drag; pins clickable; hover tooltips.
2. **Live player presence on map** — animated colored avatar figures rendered around
   location pins (appearance suggests live players).
3. **In-game advertising network** — billboards with real brand creatives on the Island;
   Sea Plots product for lagoon water plots (floor price per plot published in dialog).
4. **Governor elections** — weekly cycle implied by "governor this week" copy; named
   incumbent; candidacy and voting offered to registered players.
5. **Housing on the map** — player-owned houses placed on the city; count + online-now
   counters public.
6. **Minimum-wage law mechanic** — news ticker announces wage law changes (economy lever).
7. **Signup/login** — username-or-email + password; 18+ recommended; free, no card.
8. **PWA packaging** — installable, standalone, maskable icons, en-NG locale.
9. **Boot hardening** — progressive loading states (slow-network notice ~15s, "start fresh"
   recovery ~40s that clears service worker + caches); auto-reload on chunk-load failure
   (max 3 in 3 min); old-browser gate (iOS 16.4+ required).
10. **Client error beacon** — POST /api/client-error with message/stack/context/build id.
11. **Toast notification infrastructure** (sonner) present in markup.
12. **Gated-dialog UX pattern** — consistent title + description + signup/login CTAs +
    lock note; dismissible.

### INFERRED (strong signals, not directly seen)

- Real-time multiplayer (copy: "real people", "meet real players", presence figures).
- Server-side persistence (boot copy: "Your game is saved on our servers").
- Character creation with two starting classes — "Nepo" (privileged start) vs "Lapo"
  (struggling start, small loans) — widely reported in press coverage, not seen in-app.
- Jobs, virtual-naira earnings/spending, rent, nightlife, transport (danfo), food spots —
  reported in press; exact screens unseen.
- Expanded cities: Abuja and Port Harcourt added post-launch (press).

### INACCESSIBLE (behind login; not verified)

Character creation flow and starting stats; HUD and stat list (energy/health/happiness/
hunger/etc.); job list and pay rates; rent amounts and housing purchase flow; shop/
business/vehicle catalogs and prices; inventory; skills/progression; chat, DMs, friends,
leaderboards; election mechanics (fees, terms, powers); club/nightlife systems;
empty/error/confirmation states in-game; mobile navigation patterns; exact API routes
for live counters (not discoverable from public surface).

---

## 3. Interaction inventory

| Screen | Element | User action | Result | State changes | Verification |
|---|---|---|---|---|---|
| Landing | Location pin | Click | Gated dialog for that location | None (guest) | VERIFIED |
| Landing | Gated dialog | Escape / X | Dialog closes | None | VERIFIED |
| Landing | Sign up / Sign up free | Click | Full-page signup view | None | VERIFIED |
| Landing | Log in | Click | Full-page login view | None | VERIFIED |
| Landing | Governor pill | Click | Governor dialog | None (guest) | VERIFIED |
| Landing | Sea Plots pill | Click | Ad-product dialog | None (guest) | VERIFIED |
| Landing | Homes pill | Click | Housing teaser dialog | None (guest) | VERIFIED |
| Landing | City canvas | Drag | Pan/zoom the 3D city | None | VERIFIED |
| Landing | Pin | Hover | Label tooltip | None | VERIFIED |
| Signup | Create free account | Click (empty) | Not submitted (rule) | None | Not tested |
| Any | Online/visits counters | Observe | Numbers drift upward live | None observable | VERIFIED |
| Boot | Slow network | Wait 15s/40s | Progressive loading/recovery UI | SW+cache clear on "start fresh" | VERIFIED (code) |

---

## 4. Technical surface (public)

- **Stack:** Next.js App Router (Turbopack chunks), React, Three.js r186, CSS modules.
- **Type:** Fredoka (display) + Plus Jakarta Sans (body), woff2 preloads.
- **SEO/meta:** title "Lagos Life — live your Lagos story"; Sims-style life game in Lagos;
  og:locale en_NG; theme-color #eef2f7; JSON-LD Organization with support email.
- **PWA:** manifest, 192/512 + maskable icons, SVG icon, apple touch icon,
  start_url "/?source=pwa". Viewport: maximum-scale=1, user-scalable=no, viewport-fit=cover.
- **Confirmed public endpoint:** POST /api/client-error (JSON: message, stack, where,
  url, uid, screen, build).
- **Not public:** /api/stats, /api/online, /api/landing (404). Live-counter route unknown.
- **Persistence (client):** sessionStorage key for autoreload guard; service-worker
  caches "ll-(code|shell)-*". Server-side saves implied.
- **Social:** X, TikTok, Instagram, LinkedIn links in footer card.

---

## 5. Unknowns & assumptions

| # | Unknown | Assumption for v1 | How to verify later |
|---|---|---|---|
| 1 | Exact stat list & rules | Energy/health/happiness/hunger + money, documented rules of our own | Authorized test account or public gameplay footage |
| 2 | Job list, pay, rent, prices | Original balanced economy (minimum-wage lever kept) | Same as above |
| 3 | Election mechanics | Weekly cycle, candidacy fee, one vote per player, governor perks | Same as above |
| 4 | Chat/DM implementation | WS chat, rate limits, filters, block/report | Same as above |
| 5 | Mobile nav pattern | Bottom tab bar + sheets (standard) | Device testing |
| 6 | Counter endpoints | Our own /api/stats | n/a (original) |

Assumptions are documented as ours, not claimed as the reference's behavior.

---

## 6. Prioritized improvements (over the reference)

1. **Guest/demo mode** — reference forces signup before any play; let guests explore
   the city and try core loops, convert to account later (progress migration).
2. **Faster, clearer onboarding** — character creation inline after signup; show what
   Nepo/Lapo-style starting classes change before choosing.
3. **3D map performance** — reference ships the full city at boot; use LOD, chunked
   loading, and instancing so low-end phones stay smooth.
4. **Economy legibility** — always-visible earnings/expenses ledger; affordability
   checks before actions; no dead-end purchases.
5. **Accessibility** — reference disables pinch zoom; allow user scaling, keep
   contrast, honor reduced motion, safe-area spacing on iOS.
6. **First-run guidance** — contextual hints for the first day loop (work → eat →
   rest → rent), vs. the reference's sink-or-swim.
7. **Chat safety from day one** — rate limits, profanity filter, block/report,
   elections abuse guards (reference scale makes this critical).
8. **Transparent live counters** — our own public stats endpoint with documented
   semantics (online = active WS sessions, etc.).
9. **Boot recovery** — keep the reference's good pattern (progressive states +
   start-fresh) and add offline queue for actions.
10. **Monetization (roadmap, not v1)** — reference earns via in-game ads (billboards,
    sea plots); v1 ships no real-money systems. Ad inventory design reserved.
