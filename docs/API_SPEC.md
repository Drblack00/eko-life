# Èkó Life — API & WebSocket Specification (v1 contract)

Base URL: same origin as the client (server serves `web/dist`).
Auth: `Authorization: Bearer <token>` for REST; `wss://host/ws?token=<token>` for WS.
All money values are integer naira (₦). All timestamps are ms epoch.

## REST

### GET /api/health
`{ ok:true, online:number, day:number, db:"sqlite"|"postgres", version:string }`

### GET /api/stats  (public — powers the landing's live counters)
`{ online:number, visits:number, governor:string|null, homes:number, homesOnline:number }`
Semantics: `online` = active WS sessions; `visits` = cumulative WS connects (documented);
`homes` = player-owned houses placed on map; `homesOnline` = of those, owners online.

### GET /api/config  (public game data for landing + client)
`{ classes, locations, jobs, food, fun, housing, spawn, bounds, avatars, colors }`
Server is the source of truth; client must render from this, not hardcode.
(`avatars`/`colors` added M2 — character pickers read them, fallback to local subsets.)

### POST /api/auth/guest
Body: `{ ageConfirm:boolean }` → `400` unless `ageConfirm===true` (18+ gate).
→ `{ token, username }` (username like `Guest-ab12`; `guest:true`).

### POST /api/auth/register
Body: `{ username, email?, password, dob:"YYYY-MM-DD", avatar?, color?, guestToken? }`
- Validates: username `^[a-zA-Z0-9_]{3,16}$`, password 8–72 chars, dob ≥ 18 years.
- If `guestToken` valid → migrates that guest row in place (progress kept), returns new token.
- First-ever user becomes admin.
→ `{ token, username, is_admin }`

### POST /api/auth/login
Body: `{ username, password }` → `{ token, username, is_admin }`.
Rate limit 10/min/IP; 5 bad passwords → 15-min lockout.

### GET /api/me  (auth)
Full character state: `{ id, username, name, class, avatar, color, money, energy,
health, happiness, hunger, housing, property, vehicle, savings, loan, cert,
locationId, day, stats:{...}, is_admin, guest }`

### POST /api/client-error  (public)
Body: `{ message, stack?, where?, url?, build? }` → `{ ok:true }`. Server logs it.

### Admin (Bearer, is_admin only) — M4
All admin routes require a valid Bearer token for a user with `is_admin=1`
who is not banned. Missing/invalid token, non-admin, or banned → `403
{ error:'Admin only.' }`. Rate limits are documented in `docs/SECURITY.md`.

#### GET /api/admin/players
Full roster (user-id order):
`{ players:[{ id, username, money, stats:{energy,health,happiness,hunger},
housing, online:boolean, is_admin:boolean, banned:boolean, last_seen:number|null }] }`
`online` = has a live WS session; `last_seen` = ms epoch of last WS connect
(`null` if never connected).

#### POST /api/admin/broadcast
Body: `{ text }` → `{ ok:true }`. `text` is trimmed, capped at 200 chars and
run through the profanity filter, then sent to every online player as
`{ t:'sys', text:'📢 …' }`. Empty → 400.

#### POST /api/admin/ban
Body: `{ username, banned:boolean }` → `{ ok:true, banned }`.
Admins can never be banned (400). Banning an online player closes their WS
with code 4403; the hub rejects their future connects with 4403 as well.
`banned:false` restores access. Unknown user → 404.

#### POST /api/admin/make-admin
Body: `{ username }` → `{ ok:true }`. Promotes the player to admin.
Unknown user → 404.

#### GET /api/admin/election
Real cycle state (M5): `{ election:{active,id,startDay,endDay,endsInDays,
candidates:[{player_id,username,votes}],voted,running,governorId},
governorId, governor:{id,username}|null }`.

#### POST /api/admin/end-election
Forces the current cycle to tally now → `{ ok:true, governorId, governor }`.
Broadcasts `{t:'gov'}`, the sys announcement, news item, opens the next
cycle, closes campaign rooms.

#### GET /api/admin/reports
Newest-first player reports (M5): `{ reports:[{id,reporter_id,reporter,
reported_id,reported,reason,status,created_at}] }`. `?limit=` 1–200 (default 50).

### GET /api/news  (public — M5)
News ticker ring, last 20: `{ news:[{type,text,ts,day}] }` (elections,
governors, cycles). Powers the landing's ticker without WS.

### GET /api/leaderboard  (public — M5)
Top 10 players by money: `{ leaders:[{username,money}] }`, descending.

## WebSocket — client → server

| Message | Fields | Notes |
|---|---|---|
| `move` | `{lat,lng}` | Server validates bounds + speed (anti-cheat); rebroadcast as `mv` |
| `chat` | `{text}` | 1.2s rate limit, profanity filter, ≤200 chars || `dm` | `{to,text}` | Private message |
| `dm_threads` / `dm_history {with}` / `dm_read` | — | DM inbox |
| `act` | `{a:"work"\|..., ...params}` | **All gameplay intents.** Server validates & mutates. See actions below. |
| `collect` | `{id}` | Pick up a street-find spawn (proximity-checked) |
| `friend_add {username}` / `friend_accept {playerId}` / `friend_decline` / `friend_remove` / `friends` | — | Social graph (M5; mutual auto-accept, 20/hr add limit) |
| `rooms` / `create_room {name,topic,icon}` / `join_room {roomId}` / `leave_room` / `room_chat {roomId,text}` / `room_read` / `room_members` / `kick_room` / `mute_room {minutes}` | — | Topic rooms (M5; 5/hr create limit) |
| `block {playerId}` / `unblock` / `blocks` | — | Block list (M5; hides their chat, rejects DMs) |
| `report {playerId,reason}` | — | Player report → admin queue (M5) |
| `profile {id}` | — | Public profile card |

### `act` actions (server-authoritative; each returns updated `you` + note)
- `work {job}` — **retired in v2 (M7):** now returns an error pointing to 1-hour shifts. Use `shift_start` instead.
- `shift_start {job}`, `shift_leave`, `shift_status` — 1-hour real-time shifts (M7). Clock in at the role's location; pay lands on completion via the 60s tick (offline completion DB-credited). Leaving mid-shift forfeits (no prorata).
- `eat {item}`, `fun {what}`, `study`, `sleep`, `rest` — v2: also restore the six needs + trigger moodlets (M8)
- `travel {locationId}` — costs time/fare where applicable (+ road-trip moodlet, M8)
- `rent {housing}` — change rental (at housing office zone); moving forfeits rent-to-own status (M10)
- `buy_property {property}`, `buy_vehicle {v}`, `buy_biz {biz}`, `buy_furniture {item}`, `place_furniture {id,placed}` — prices × governor `market_mult` (M11)
- `bank {op:"deposit"|"withdraw", amount}`, `loan {amount}`, `repay {amount}`
  - `loan {amount}` — normal rules: ₦1–₦100,000, none while a loan is
    outstanding, 10%/day interest. **Starter loan (M4):** a street_smart
    character with `starter_loan_available` claims exactly ₦10,000 with
    `amount:10000` — 0% interest (`loan_free`), one-time flag consumed.
    Any other amount follows the normal rules and leaves the flag intact.
    `/api/me` and the WS `you` snapshot expose `loan_free`.
- `run {candidate?}` — enter governor race (fee), `vote {candidate}` — one per election
- `gov_broadcast {text}` — governor only, 1/day
- `gov_policy {policy}`, `gov_appoint {username,title}`, `gov_dismiss {title}` — governor only (M11)
- `moodlet_list` — active moodlets (M8)
- `hunt_claim`, `hunt_status`, `hustle_status`, `hustle_claim {mission}`, `perk_list`, `perk_buy {perk}` (M9)
- `shop_create {type,locationId,name}`, `shop_stock {name,price,qty}`, `shop_buy {shopId,itemId,qty}`, `shop_rate {shopId,stars}`, `shop_browse`, `shop_mine`, `buy_rental`, `lapo_borrow {amount}`, `lapo_status`, `lapo_repay {amount}`, `lapo_repay_all` (M10)
- `skill_train {skill}`, `academy_lesson {course}`, `academy_quiz {course,answers}` (M12)

## WebSocket — server → client

| Message | Meaning |
|---|---|
| `init` | Full bootstrap: `you`, `players[]`, `day`, `endsIn`, `chat[]`, game data, election, governor, `spawns[]`, `friends`, `rooms`, `unreadDm`, `visits` |
| `you` | Authoritative character snapshot after any mutation: `{ t:"you", you:{...}, note? }` (+ optional `note` toast text) |
| `mv {id,lat,lng}` | Player moved |
| `join {p}` / `leave {id}` | Presence |
| `chat {...}` / `sys {text}` / `err {text}` | Messages |
| `stats {online}` | Live counter tick |
| `day {day, endsIn}` | New game day |
| `election {...}` | Election state (candidates, voted, running, endsInDays) |
| `gov {id,name}` | New governor announced |
| `spawn {s}` / `despawn {id}` | Street finds |
| `dm {...}` / `dm_sent` / `dm_threads` / `dm_history` / `dm_unread {n}` | DMs |
| `friends {friends}` / `friend_request {from}` | Social |
| `rooms {rooms}` / `room_joined` / `room_left` / `room_msg` / `room_unread` / `room_members` | Rooms |
| `blocks {blocks}` | Block list (M5) |
| `news {item}` | News ticker event (M5) |
| `mention {from,where,text}` | @mention ping |
| `snap {lat,lng}` | Anti-cheat correction (client snapped back) |
| `clock {label,…}` | Real-time Africa/Lagos clock broadcast, every 30s (M7) |
| `shift_done {job,pay,note}` | A shift completed — pay landed (M7) |
| `shift_status {shift}` / `hunt_status` / `hustle_status` / `perk_list` / `lapo {…}` / `shops {…}` / `shop_mine {…}` | v2 intent query replies (M7/M9/M10) |

## V2 endpoints (2026-10-10)

### REST — public
- `GET /api/v2/m7/clock` — `{ label, … }` current Africa/Lagos time
- `GET /api/v2/m10/shops?location=` — browse player shops
- `GET /api/v2/m10/shops/:id/items` — one shop's shelf
- `GET /api/v2/m13/billboards` — active billboards for the 3D map

### REST — auth (Bearer)
- `GET /api/v2/m8/moodlets` — my active moodlets
- `GET /api/v2/m9/hunt` — active riddle round + my claim state
- `GET /api/v2/m9/hustle` — today's 3 missions + stars
- `GET /api/v2/m9/perks` — star balance + owned perks + catalog
- `GET /api/v2/m10/shop/mine` — my shop (owner view)
- `GET /api/v2/m10/lapo` — my LAPO loan status
- `GET /api/v2/m10/tax` — this week's earnings + projected tax bill
- `GET /api/config` — now also includes `careerTracks`, `skillLabels`, `needs`, `housingBuy`, `shopTypes`, `lapo`, `tax`, `skills`, `courses`, `skillTuning`

### REST — admin (`/api/admin`, is_admin)
- `GET /api/admin/election` — full election state incl. policy + commissioners (M11)
- `POST /api/admin/billboards` / `PATCH /api/admin/billboards/:id` / `DELETE /api/admin/billboards/:id` — billboard CRUD (M13)

### `you` snapshot — new v2 fields
`fun, social, hygiene, bladder` (M8), `moodlets[]` (on decay ticks), `perk_stars`, `perks[]` (M9), `housing_owned` (M10), `shift {job,name,endsAt,secondsLeft}|null` (M7), `skills {id:{level,xp}}`, `academy {lessonsToday,certs}` (M12).

### `election` payload — new v2 fields (M11)
`policy {id,name,desc,…}|null`, `pickablePolicies[]`, `commissioners [{title,icon,holder}]`, `policyWindowOpen`.

## Error conventions
REST errors: `{ error:string }` with proper HTTP codes (400/401/403/404/409/429).
WS errors: `{ t:"err", text }` or `{ t:"sys", text }` toasts — never silent failures.

## M3 implementation notes (server, 2026-10-09)

### World data (all original content — never the reference's list)
- **68 LOCATIONS** across `mainland` (30) / `lagoon` (10) / `island` (28), each
  with `tags` that gate actions: `market`, `motor_park`, `campus`, `mall`,
  `bank`, `housing_office`, `hospital`, `office`, `tech_hub`, `beach`, `club`,
  `boat`, `stadium`, `residential`, `landmark`. New named offices the M3
  actions need: `housing_office_m`, `housing_office_i`, `kudi_row` (bank),
  `lasuth` + `victoria_hospital` (hospital), three campuses.
- **10 JOBS** across 6 paths (`market`, `transport`, `corporate`, `leisure`,
  `service`, `campus`); 3 cert-gated (`campus_tutor`, `junior_dev`,
  `bank_teller`). Balanced for 5-min days: cooldowns 30–120s, pay ₦2,500–9,000.
- **PROPERTIES** (one per player, replace = no refund): Owned Self-Contain
  ₦250k (+5 happy/day), Bungalow ₦600k (+8), 2-Bedroom Flat ₦1.2M (+10),
  Duplex ₦3M (+15).
- **BIZ** (one per player): Mama Put Spot ₦50k→₦4k/day, Car Wash Hub ₦80k→₦6k,
  Boutique ₦150k→₦10k, Lounge & Bar ₦400k→₦25k (ROI decays with scale).
- **VEHICLES**: Trek 1.0×, Keke ₦80k 1.6×, Camry ₦300k 2.2× — the multiplier
  feeds the move anti-cheat (`you.speedMult`).
- **FURN** (6) + `HOME_SLOTS=6` + `FURN_EFFECTS` hooks: bed→sleep +20 health,
  fridge→eat +15 hunger, tv→fun +10 happy, sofa→fun +8 happy, AC→sleep +10
  happy, generator→+5 happy/day. Buy into inventory (unplaced), place up to 6.
- **BANK**: savings +2%/day (floored), loan max ₦100k with 10%/day (ceiled),
  none outstanding while one is open. **STUDY_COST** ₦5,000.
- **TRAVEL_FARES**: ₦0 within region, ₦200 cross-region ("danfo fare"),
  ₦500 for any trip touching the lagoon (boat). Ledger kind `travel`.

### New `act` intents (all server-authoritative, ledger rows on money moves)
- `rent {housing}` — must be at a `housing_office` location; sets rental,
  resets `rent_misses`. `buy_property {property}` — affordability check, one
  per player (replace, no refund). `buy_biz {biz}` — one per player.
  `buy_vehicle {v}` — sets vehicle. `bank {op,amount}` / `loan {amount}` /
  `repay {amount}` — loan ≤₦100k, none outstanding; repay clamps to
  min(amount, loan, cash). `buy_furniture {item}` / `place_furniture {id,placed}`
  — owner-checked, 6-slot cap. `study` — campus location only, ₦5,000, grants
  `cert`. `collect {id}` — also as standalone WS message (see below).
- `travel {locationId}` now charges fares (above) and resets the anti-cheat
  movement baseline so legit teleports never snap.
- `eat`/`fun`/`sleep` consume placed-furniture hooks from the session's
  furniture list (bed/fridge/tv/sofa/AC); generator applies in the day tick.

### Street finds (spawns)
- Server tick every 15s: prune expired (>3 min), keep ≤80 spawns, spawn 1–2
  per online player within 0.5–3.5 map units when fewer than 4 are nearby.
  Kinds: cash (weighted 50%, ₦300–1,500), snack, energy.
- `spawn {s}` / `despawn {id}` broadcast; `init` includes `spawns[]`.
- `collect {id}` (WS message **or** `act`) is proximity-checked in **map units**
  (coords are 0–100): ≤`COLLECT_RADIUS` (4) from the player. Failed attempts
  never consume the spawn (peek-first). Effects: cash→money+ledger `spawn_cash`,
  snack→+25 hunger, energy→+25 energy.

### Day tick (M3)
- Per online player: rent (M2) → **day economy**: biz income (note),
  savings +2%, loan +10%, property happiness, generator happiness; ledger rows
  `biz_income` / `savings_interest` / `loan_interest` (`balance_after` = the
  relevant pot for the interest rows). Offline players get the identical math
  DB-credited with ledger rows. Governor salary skipped (no governor until M5).

### REST (M3)
- `GET /api/transactions` (auth): last 50 ledger rows, newest first —
  `{transactions:[{id,kind,amount,balance_after,meta,created_at}]}`,
  `meta` JSON-parsed (null when unparseable).
- `GET /api/stats` now computes **homes** = players owning a property and
  **homesOnline** = of those, currently online.
- `GET /api/config` adds `properties`, `biz`, `vehicles`, `furn`, `homeSlots`,
  `bank`, `travelFares`, `studyCost`.
- `GET /api/me` adds `biz`, `furniture[]`, `speedMult` (WS `you` too).

### Schema (M3)
- `characters.biz` (TEXT, nullable) via `ensureColumn` (PG + SQLite);
  `insertCharacter`/`saveCharacter` now persist it.
- New `furniture` table (both backends): `id`, `owner_id` (→ users.id),
  `item`, `placed`, `created_at` + `idx_furniture_owner`.

## M2 implementation notes (server, 2026-10-09)
- `POST /api/characters` (auth): one-time character creation — body
  `{name, class, avatar, color}` → `{ok:true, character}` (same shape as `/api/me`).
  - `name` validated with the same `^[a-zA-Z0-9_]{3,16}$` regex as usernames;
    `class` must be `silver_spoon`|`street_smart`; `avatar`/`color` checked against
    the server allowlists (`AVATARS`/`COLORS`) — 400 otherwise.
  - 400 `{error}` if the character was already customized (`customized` flag).
  - Class package applied: **silver_spoon** → money ₦50,000, housing `selfcon`,
    happiness +10 (capped 100); **street_smart** → money ₦5,000, housing `face-me`,
    one-time `starter_loan_available` flag set.
  - Register still auto-creates street_smart defaults (M1 behavior kept); this
    endpoint customizes the row in place.
- WS `act` intents implemented in M2 (all server-authoritative; client numbers are
  ignored — every money move writes a `transactions` ledger row with
  kind/amount/balance_after; stats clamped 0–100; money floored and never negative):
  - `work {job}` — job must exist, player must be at `job.locationId`, energy ≥
    cost, per-job server-side cooldown; pay = `job.pay` × class payMult (0.9/1.1).
  - `eat {item}` — affordability checked first; hunger/energy/happy += values.
  - `fun {what}` — must be at the fun's linked location; cost + energy checked.
  - `sleep` — 60s cooldown; energy = 100, hunger −15, health +10.
  - `rest` — +15 energy (cap 100); 30s soft anti-spam cooldown.
  - `travel {locationId}` — energy −5; sets `location_id`; broadcasts `mv`-style
    presence update with the location's coords.
  - Success → `{t:'you', you, note}`; rejection → `{t:'err', text}` (never silent).
  - `junior_dev` requires a certificate (study lands in M3).
- Needs decay: every 60s tick — hunger −3; at 0, energy −5 / happiness −5 /
  health −2 per tick; persisted and fresh `you` pushed (starving players get a warning note).
- Day rollover (5-minute game day): `chargeRent` for every online player — rent
  deducted when affordable (ledger `rent` row); otherwise `rent_misses` +1;
  3rd consecutive miss → evicted to `bridge` housing, happiness −20, misses reset.
  Then `{t:'day', day, endsIn}` is broadcast.
- Position persistence: `characters.x`/`characters.y` (REAL, NULL for pre-M2 rows
  → spawn fallback); `move` persists throttled (at most every 15s) and on
  disconnect; `init` and `you` include `x`, `y`, `locationId`.
- `GET /api/me` now also returns `customized`, `starter_loan_available`, `x`, `y`.
- `HOUSING` gains a `bridge` entry (rent ₦0, eviction fallback — not rentable).
- `run`/`vote`/`gov_broadcast`/friends/rooms intents still return
  `{t:'err', text:'Unknown action.'}` until M4/M5.

## M1 implementation notes (server, 2026-10-09)
- `move`/`mv` keep the `{lat,lng}` wire names from the table above, but values are
  **map coordinates in 0–100** (matching `GET /api/config` `bounds`), not geographic
  lat/lng. Out-of-range values are dropped silently (anti-cheat).
- `POST /api/auth/register` does not take a class choice: a character row is
  auto-created with `street_smart` defaults (name = username) for both guests and
  full accounts. Character creation / class selection is an M2 endpoint.
- `init` includes `config` (classes, locations, jobs, food, fun, housing, spawn,
  bounds), `election:{active:false}`, `governor:null`, `visits`.
- `GET /api/stats` returns `governor:null, homes:0, homesOnline:0` until M4/M5.

## M4 implementation notes (server, 2026-10-09)

### Admin API (`server/src/routes/admin.js`, mounted at `/api/admin`)
- `requireAdmin`: valid Bearer token + `is_admin=1` + not banned → 403 otherwise.
- `GET /players` — roster via `db.listRoster()` (users LEFT JOIN characters);
  `online` from `hub.online`, `last_seen` from `users.last_seen` (ms epoch,
  set on every WS connect via `db.setLastSeen`).
- `POST /broadcast` — `cleanText` (200 chars, profanity filter) → `hub.broadcast`
  as `{t:'sys', text:'📢 …'}`.
- `POST /ban` — `db.setBanned`; admins can never be banned (400); an online
  banned player gets their WS closed with code 4403; the hub's connect gate
  rejects banned tokens with 4403 as well.
- `POST /make-admin` — `db.setAdmin(id, true)`.
- `GET /election` — stub `{ active:false }` until M5.

### Starter loan gap (M3 flag → M4 intent)
- `characters.loan_free` (INTEGER, both backends via schema + `ensureColumn`;
  persisted by `insertCharacter`/`saveCharacter`; exposed in `/api/me`,
  `POST /api/characters` and the WS `you` snapshot).
- `loan {amount:10000}` with `starter_loan_available=1` and no outstanding
  loan → grants exactly ₦10,000, sets `loan_free=1`, consumes the flag,
  ledger kind `starter_loan`. Any other amount → normal rules
  (₦1–₦100k, none outstanding, 10%/day) and the flag is untouched.
- `game/sim.js` `applyDayEconomy` skips the 10%/day loan interest when
  `loan_free` is set; full `repay` clears the flag.
- Server constant: `STARTER_LOAN_AMOUNT = 10000` in `game/data.js`.

### Anti-cheat hardening
- Per-user act rate limit (hub): 30 acts / 60s sliding window → dropped with
  `{t:'err', text:'Too many actions — slow down a bit.'}`; the connection
  survives.
- Money/stats are only ever written from server-derived values: client
  params like `money:999999` on an `act` are ignored (`tests/anti_cheat.test.js`
  asserts forged values never move money).
- Negative amounts are rejected in every money intent (`bank`, `loan`,
  `repay`) before any mutation.
- Affordability checks run synchronously against the shared session
  character before the first `await`, so two concurrent double-spend
  requests cannot both succeed (covered by the double-spend race test).

### Security pass
- Headers (all responses): `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy:
  camera=(), microphone=(), geolocation=()` and `Strict-Transport-Security:
  max-age=31536000` (no-op on local HTTP, enforced on Render's TLS).
- `express.json({ limit:'32kb' })` confirmed.
- Tokens use `crypto.timingSafeEqual` on the HMAC (auth.js — confirmed).
- New generic error middleware: any 500 (JSON-parse failures, unhandled
  route errors) returns `{ error:'Something went wrong.' }` — never a stack
  trace. Server-side logging kept.
- See `docs/SECURITY.md` for the threat model, enforcement map, and known
  limitations (no `X-RateLimit-*` response headers yet — limits documented
  there; rate limits are in-memory per instance; SQLite file lives on
  Render's ephemeral disk; PG code paths are untested without a staging DB).

## M5 implementation notes (server, 2026-10-09) — realtime social + elections

### Elections (`server/src/game/elections.js`, `game/elections` helpers)
- 7-game-day cycle: `ensureElection` at boot (and a day-tick safety net) opens
  cycle `[day, day+7)`; the day tick tallies when `day >= end_day`, and
  `POST /api/admin/end-election` forces a tally any time.
- `act run` — fee ₦50,000 (server-deducted, ledger `campaign_fee`), one
  candidacy per election (DB PK backs the check; a lost race refunds), creates
  a campaign room `"<username>'s Campaign"` (📣) the candidate owns and is
  auto-joined to. Broadcasts sys + news + fresh `{t:'election'}` to everyone.
- `act vote {candidate}` — candidate must be running; one vote per voter per
  election (votes PK rejects doubles even under a race).
- Tally: most votes wins; **ties → lowest player id** (explicit JS sort —
  portable across SQLite/PG). Sets `winner_id`, persists `governor_id` in
  `meta` (restored at boot), broadcasts `{t:'gov', id, name}` + sys
  announcement + news item, opens the next cycle, deletes finished campaign
  rooms (in-memory history dropped, `{t:'rooms'}` refreshed for all).
- Governor perks: `act gov_broadcast {text}` — governor only, 24h cooldown,
  profanity-filtered; governor salary ₦25,000/day credited in the economy
  tick (online: live session + `you` note; offline: DB-credited with ledger
  `gov_salary`).
- `GET /api/admin/election` → `{ election:{active,id,startDay,endDay,
  endsInDays,candidates:[{player_id,username,votes}],voted,running,governorId},
  governorId, governor:{id,username}|null }`.
- `GET /api/stats` `governor` is now the sitting governor's username.

### Friends (`ws/social.js` `route`, db `friendships`)
- WS: `friend_add {username}` (20/hour rate limit), `friend_accept` /
  `friend_decline {playerId}`, `friend_remove {playerId}`, `friends`.
- **Mutual auto-accept:** if B already requested A, A's `friend_add` to B flips
  the row to `accepted` instead of erroring.
- `{t:'friends', friends:[{other_id,other_username,status,incoming,online}]}` —
  `incoming` = pending request addressed to you; `online` = live WS session.
  `init` includes `friends`.

### Rooms (`ws/social.js`, db `rooms` + `room_members`)
- 4 preset rooms seeded at boot (Hustle Talk 💼, Market Deals 🛒, Governance
  🗳️, Street Gist 🎲; `creator_id=0`).
- WS: `rooms`, `create_room {name,topic,icon}` (30-char name cap, 5/hour rate
  limit), `join_room {roomId}`, `leave_room`, `room_chat {roomId,text}` (must
  be member, mute-checked, shares the 1.2s chat cooldown), `room_members`,
  `room_read`, `kick_room` / `mute_room {minutes}` (owner or admin; never
  self; mute clamped 1–1440 min).
- Per-room in-memory history (last 50) sent on `join_room`; `{t:'rooms'}`
  carries per-player `joined` + `unread` (messages since `room_read`,
  excluding own); `{t:'room_msg'}` / `{t:'room_unread'}` pushed to members.

### DMs (`ws/social.js`, db `dms` + `dm_reads`)
- WS: `dm {to,text}`, `dm_threads` (partner, last text/ts, per-thread unread),
  `dm_history {with}`, `dm_read {with?}` (thread or all).
- Per-thread read watermarks in `dm_reads`; `init` carries `unreadDm`;
  `{t:'dm_unread', n}` pushed on receive and on read.
- **Block-aware:** a DM is rejected (err toast) when either side blocked the
  other.

### Safety (db `blocks`, `reports`)
- WS: `block {playerId}` / `unblock` / `blocks` (list).
- Blocked users' **city and room chat are hidden from the blocker**
  (delivery-time filter + history filter on join/init); DMs rejected both
  ways; @mention pings suppressed to blockers.
- WS: `report {playerId, reason}` → stored in `reports` + sys note to the
  reporter ("Report received — admins will review.").
- `GET /api/admin/reports` (admin) → newest-first
  `{reports:[{id,reporter_id,reporter,reported_id,reported,reason,status,created_at}]}`.

### Leaderboard + news
- `GET /api/leaderboard` (public) → `{leaders:[{username,money}]}` top 10 by
  money, descending. Kept separate from `/api/stats` so the landing's live
  counters stay cheap.
- News ticker: in-memory ring (last 20, `{type,text,ts,day}`) — election
  candidacies, governor wins, new cycles, governor broadcasts. `init` carries
  `news[]`; `{t:'news', item}` broadcast on each event; `GET /api/news`
  (public) for the landing (which has no WS in M1).

### WS init additions (M5)
`init` now also carries `election` (real per-player state), `governor`
(`{id,name}` or null), `friends`, `rooms`, `unreadDm`, `news[]`; city chat
history is block-filtered; chat entries carry `gov:true` for the governor.
Tests: `tests/m5.test.js` (20 tests) — full election cycle, double
vote/run rejection, tie-break, fee ledger, campaign room create/close,
governor perks + salary, friends mutual accept/decline/remove, room
kick/mute/rate-limit, block hides city+room chat and blocks DMs both ways,
report storage, leaderboard ordering, news feed.
