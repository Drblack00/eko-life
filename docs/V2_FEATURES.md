# Èkó Life v2 — feature notes (2026-10-10)

How each v2 milestone maps to the mechanics observed in the reference
(`docs/REFERENCE_ANALYSIS.md` — facts only), and what's intentionally
different. All code, art, and text are original Èkó Life creations;
only feature concepts and numeric values were reused.

## M7 — Real-time clock + work shifts
- **Reference:** 30 career tracks; work = 1-hour real-time shifts; pay on completion.
- **Ours:** 24 career tracks (entry + mid-tier roles; our 10 legacy jobs kept as
  entry roles). 1-hour real-time shifts, Africa/Lagos clock broadcast every
  30s + REST `GET /api/v2/m7/clock`, live countdown in the Jobs tab.
- **Intentional differences:** mid-tier roles gated by skill levels (ties into
  M12) instead of pure tenure; leaving mid-shift **forfeits** the shift (no
  prorata — documented in `server/src/game/v2/m7.js`); legacy instant `work`
  returns an error pointing at shifts rather than silently mapping.

## M8 — Needs + moodlets
- **Reference:** 6 needs with decay; moodlets (+/- modifiers) from events.
- **Ours:** Hunger, Energy, Fun, Social, Hygiene, Bladder with per-minute
  decay; 8+ original moodlets (e.g. suya spice rush, beach bliss, debt dread)
  plus city events (e.g. power outage hurting mood). Needs panel with bars.
- **Intentional differences:** moodlet/effect contract is shared with perks
  (`decay_slow`, `decay_all`, `stat_boost`, `stat_drain`) so M9 perks plug in
  cleanly; eating/fun/sleep/rest also touch the new needs.

## M9 — Daily retention
- **Reference:** daily treasure hunt (riddle → map location, tiered prizes by
  find order); "Today's Hustle" missions earning perk stars; ~14 spendable perks.
- **Ours:** riddle every 21h with tiered prizes (1st / 2nd–3rd / 4th–10th /
  rest), server-tracked claims, original riddles; 3 daily hustle missions →
  perk stars; 14 original perks (need-decay slowers, work boosters, discounts).
- **Intentional differences:** 21h cadence kept; perk effects reuse the
  M8 effect-type contract; hunt prizes paid from the game treasury.

## M10 — Economy depth
- **Reference:** player-run shops (create, stock, sold-out, ratings); housing
  rent-to-own (buy ≈ 47× weekly rent); LAPO-style loans (weekly auto-repayments,
  pay now / pay it all); progressive income tax.
- **Ours:** shops (8 types, ₦20k create fee, stock/qty/price, sold-out deletes
  the item row, 1–5 star ratings, double-spend-safe buys); rent-to-own at
  48× weekly rent; LAPO loans ₦50k–₦500k, 4 weekly auto-debits, 5% flat;
  progressive tax (first ₦1M/wk free, 20% to ₦10M, 30% above) computed from
  the ledger.
- **Intentional differences:** shops are city-wide (no open/closed state, no
  proximity buying — cut for scope); existing `loan`/`repay` intents untouched;
  tax respects the governor's `tax_mult` (M11).

## M11 — Governance with teeth
- **Reference:** weekly elections; winner's policy applies city-wide (wage
  boost, tax holiday, event frequency); governor appoints commissioners.
- **Ours:** winner signs ONE policy per term within 48h (6 original policies:
  wage boost, tax holiday, market boom, event surge, frugal city, balanced);
  policies write `wage_mult`/`tax_mult`/`event_mult`/`market_mult`/`decay_mult`
  meta keys consumed by M7/M8/M10/economy; commissioners (flavor titles,
  persist across terms, 👑 chat badge). Campaign fee + min account age kept.
- **Intentional differences:** default policy auto-applies if the governor
  doesn't pick in 48h (no dead term); multipliers reset at each tally.

## M12 — Skills + academy
- **Reference:** 9 skills; academy courses with lessons + quiz; certificates
  boost related jobs.
- **Ours:** 9 skills (cooking, charisma, fitness, coding, music, hustle,
  dance, comedy, photography) with levels + rust (decay after 7 idle days,
  capped); academy courses (max 2 lessons/day, quiz per course), certificates
  raise effective skill for job gates.
- **Intentional differences:** XP comes from training + relevant actions, not
  just courses; rust is capped so progress is never wiped.

## M13 — Map billboards
- **Reference:** billboards on the map.
- **Ours:** 3D billboard meshes on the Three.js city map with original
  canvas-generated ad creatives (funny Lagos-flavored ads + game promos, our
  own designs); admin UI to add/remove/edit (text, colors, position),
  persisted server-side, live-updated to clients.

## Map v2.1 (2026-10-10, from owner iPhone testing)
- **Blank-map bug:** the scene builder was guarded by an inverted
  `if (!cancelled)` check, so the canvas was never created on any device.
  Fixed to `if (cancelled) return;`. Added a WebGL-unavailable fallback panel
  with retry instead of a dead blank box.
- **Gestures:** one finger pans, pinch zooms, two fingers tilt (polar) and
  turn (azimuth); mouse: left-drag pan, wheel zoom, right-drag rotate. Tap
  still selects pins. `touch-action: none` on the map so the browser never
  hijacks gestures.
- **Detail pass (all original procedural geometry):** 90 warm houses with
  pitched roofs + 60 mid-rise blocks + 8 glass towers (instanced), gray roads
  with dashed center lines, two lagoon bridges, landmarks (stadium, hospital
  with red-cross sign, school, striped market stalls), 6 animated sailboats,
  palms + leafy trees, region + landmark labels. ~40 static draw calls,
  pixelRatio capped at 2 for mobile.
- **HUD overlap fix:** the governor pill rendered as a native iOS button and
  painted over the ₦ balance; now `appearance: none` + `flex: none` +
  `max-width` with ellipsis, and the HUD row tightens under 400px.

## Cross-cutting
- No real-money features anywhere (no payments, no cash-out).
- Server-authoritative economy: every money move is a ledger row.
- Game clock = real Africa/Lagos time; game "days" still tick every 5 min.
