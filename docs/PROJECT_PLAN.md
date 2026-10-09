# Èkó Life — Architecture Recommendation & Implementation Plan

**Working title:** Èkó Life ("Èkó" = Lagos in Yoruba — distinct brand, Lagos-inspired).
Rename is cheap at any point before launch.
**Basis:** Audit of lagoslife.app (docs/AUDIT_REPORT.md) + original code only.
Prior art (reusable patterns, same user's project): `~/workspace/benin-life-multiplayer/`
(Node/Express/ws/SQLite→Postgres, proven live on Render).

---

## 1. Platform recommendation

**Frontend:** Next.js (App Router) + React + TypeScript, Three.js for the 3D city map,
Tailwind CSS, PWA packaging (manifest, maskable icons, standalone, en-NG).
**Backend:** Node.js API + WebSocket server (`ws`), server-authoritative game rules.
**Database:** PostgreSQL (Render/Supabase free tier); SQLite for local dev.
**Auth:** username/email + bcrypt password, 18+ gate, token sessions; **guest mode**
(Improvement #1 over reference — play instantly, migrate progress on signup).
**Realtime:** WebSockets for presence, movement, chat/DMs, elections, live counters.
**Deploy:** Frontend on Cloudflare Pages (or Render static); backend + Postgres on
Render via Blueprint (`render.yaml`); Cloudflare Pages for preview deploys.
**Observability:** structured logs, `/api/health`, client-error beacon
(`POST /api/client-error`, same contract shape as reference), boot-hardening states.

### Alternatives evaluated (and rejected)

| Option | Verdict |
|---|---|
| Phaser 2D game | Cheaper, but reference proved 3D isometric is the genre expectation; 2D would feel like a downgrade. |
| Single Express-serves-static (Benin Life pattern) | Proven and simpler; but Next.js gives PWA/SEO/code-splitting the reference relies on at scale. Keep Express pattern as fallback if Next.js WS hosting gets hairy. |
| Firebase/Supabase-only backend | Realtime is easy, but server-authoritative economy/anti-cheat needs our own logic; Postgres direct is fine. |
| Native apps | Reference won with zero-download browser play; stay browser-first, PWA for installability. |
| Unity/Unreal web | Overkill weight for a UI-heavy life sim; kills low-end phone performance. |

---

## 2. UX design direction (enhanced, original)

- **Identity:** bright daytime "toy Lagos" like the reference's appeal, but our own art:
  procedural low-poly city (instanced meshes), Mainland / Lagoon / Island geography,
  our own location set (markets, clubs, campuses, motor parks — inspired by, not copied).
- **Type:** Fredoka-style rounded display + clean grotesque body (public Google Fonts).
- **Palette:** lagoon blue, palm green, danfo yellow accents, warm neutrals; dark mode for night.
- **Mobile-first:** bottom tab bar (City, Work, Home, Chat, Me), bottom sheets for actions,
  safe-area aware, touch targets ≥44px, pinch-zoom allowed (unlike reference).
- **Feedback:** every action shows immediate optimistic UI + server confirmation; toast
  system; transaction ledger for money in/out.
- **Onboarding:** 4 steps — guest explore → signup → class choice (Privileged/Struggling,
  effects shown) → character → guided first day.
- **States:** loading skeletons, empty states with CTAs, confirm dialogs for spending,
  offline action queue.

## 3. Module breakdown

`auth` · `characters` · `simulation` (needs/time) · `economy` (jobs/transactions/ledger) ·
`city` (locations/actions/travel) · `housing` · `inventory` · `social` (chat/DM/friends) ·
`governance` (elections) · `plots` (ad-inventory-ready, v1 stub) · `persistence` ·
`admin` · `client` (Next.js PWA + Three.js map) · `realtime` (WS hub).

## 4. Data sketch (Postgres)

`users(id, handle, email, pass_hash, dob_18plus, created_at)` ·
`characters(user_id, name, class, avatar, stats JSON, money, energy…, updated_at)` ·
`transactions(id, user_id, kind, amount, balance_after, meta, created_at)` ·
`properties(id, owner_id, type, location, level)` · `plots(id, owner_brand, x, y, expires_at)` ·
`jobs(id, title, pay, energy_cost, requirements)` ·
`elections(id, week, candidates JSON, votes JSON, winner_id)` ·
`messages(id, room, sender_id, body, created_at)` · `dms`, `friendships` ·
`sessions(token, user_id, expires_at)` · `audit_log`.

## 5. API / WS sketch

- REST: `/api/auth/*`, `/api/me`, `/api/actions/{work,eat,sleep,travel,buy}`, `/api/stats`
  (public counters), `/api/elections`, `/api/client-error`.
- WS events: `presence`, `move`, `chat`, `dm`, `election`, `counters`, `notify`.
- All economy mutations server-validated; idempotency keys on purchases; rate limits
  on auth/chat/votes.

## 6. Milestones (acceptance criteria)

- **M1 Foundation:** repo structure, design tokens, routing, landing with 3D city,
  signup/login/guest, loading/error states, PWA manifest. *Done when: landing renders
  the 3D city at 60fps on a mid phone, auth flows work locally.*
- **M2 Playable core:** character creation, class choice, needs (energy/health/
  happiness/hunger), time loop, actions (work hustle, eat, sleep, rest), local→server
  saves. *Done when: a full game day is playable end-to-end with stat changes persisting.*
- **M3 World & progression:** 60+ locations across Mainland/Lagoon/Island, location
  actions, 4+ job paths with wages, rent + housing upgrades, travel costs, businesses/
  property income, vehicles. *Done when: earn→spend→rent loop + property income verified.*
- **M4 Backend & accounts:** Postgres persistence, server-authoritative economy,
  rate limits, anti-cheat basics, admin dashboard, deploy pipeline. *Done when:
  deployed, multi-user smoke tests pass, no client-side money manipulation possible.*
- **M5 Advanced:** realtime chat/DMs/friends, weekly governor elections (run/vote),
  live counters on landing, leaderboards, clubs/nightlife spots. *Done when:
  two browsers chat/move/vote together live.*
- **M6 Quality & deploy:** automated tests, mobile QA (iPhone Safari), a11y pass,
  security review, production deploy, monitoring, parity checklist vs audit.

## 7. Roadmap (post-v1)

Sea Plots ad inventory (real brand uploads), Abuja/PH-style city expansions, guilds/
crews, seasonal events, creator revenue share, native wrappers. **No real-money
wagering or cash-out, ever** (virtual naira has no cash value — same line as reference).

## 8. Open decisions for the user (do not block build)

1. Final product name (working title: Èkó Life).
2. Deploy targets/accounts when M4 lands (GitHub + Render flow already proven).
3. Whether to keep the Nepo/Lapo naming or our own class names.
