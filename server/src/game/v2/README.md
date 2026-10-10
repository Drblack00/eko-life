# V2 milestone integration contract (READ FIRST — binding)

You are implementing ONE v2 milestone as a subagent. Seven milestones
(M7–M13) are being built in parallel by different agents in this same repo.
To avoid merge conflicts, follow this contract exactly.

## Golden rule

**You may CREATE new files. You may EDIT only the files explicitly listed
as yours below. For everything else, deliver an INTEGRATION SPEC** (exact
code + anchor location) in your final report — the coordinator applies it.

### Files you OWN (create freely, no conflicts)
- `server/src/game/v2/<m>.js` — your milestone module (m7 … m13).
  You may also create a folder `server/src/game/v2/<m>/` if one file is
  too small — but prefer one file.
- `server/tests/m<7-13>.test.js` — your tests (node:test, see below).
- `web/src/views/v2/<m>/` — your React components + CSS (self-contained).
- EXCEPTIONS (safe: no other milestone touches these):
  - M11 may edit `server/src/game/elections.js` directly.
  - M13 may edit `web/src/game/CityMap.tsx` directly.

### Files you MUST NOT edit (deliver integration specs instead)
`server/src/db.js`, `server/src/game/actions.js`, `server/src/game/data.js`,
`server/src/game/sim.js`, `server/src/ws/hub.js`, `server/src/app.js`,
`server/src/routes/api.js`, `server/src/routes/admin.js`,
`web/src/views/Game.tsx`, `web/src/views/Admin.tsx`,
`web/src/lib/api.ts`, `server/src/game/elections.js` (M11 only),
`web/src/game/CityMap.tsx` (M13 only).

## Your module's required exports (`server/src/game/v2/<m>.js`)

```js
// 1. Storage — your own tables. Use the exported db helpers:
//    import { dbRun, dbGet, dbAll } from '../../db.js';
//    Dialect rule: pass BOTH variants. SQLite: `?` placeholders.
//    Postgres: `$1, $2, ...` placeholders.
export const SCHEMA_SQLITE = `CREATE TABLE IF NOT EXISTS ...`;
export const SCHEMA_PG = `CREATE TABLE IF NOT EXISTS ...`;
export async function ensureSchema() {
  // dbRun(SCHEMA_SQLITE, SCHEMA_PG) — plus any ALTER TABLE for safety
}
// + your data-access helpers (getX/saveX/...)

// 2. Pure logic — no DB, no I/O, easily unit-tested.
//    Example: export function calcPayout(...) {...}

// 3. INTENTS — WS `act` handlers, server-authoritative.
//    The coordinator wires these into actions.js's handleAct.
//    api = { conn, send, broadcast, youSnapshot, err, commit, now, getDay }
//      conn: { user, character, cds, pos, furniture }
//      err(text) → sends {t:'err'} toast (use for ALL rejections)
//      commit({kind, amount, meta, note}) → harden+ledger+save+push `you`
//        kind/amount: ledger row for money moves ONLY (amount = signed int)
//    Pattern: validate everything from server state → mutate conn.character
//    → await commit({...}). NEVER trust client-sent numbers.
export const INTENTS = {
  my_action: async (api, msg) => { /* ... */ },
};

// 4. (optional) Tick hooks — coordinator wires into hub/app intervals.
//    ctx = { broadcast, sendTo, db, getDay, now }
export async function onTickMinute(ctx) { /* e.g. complete shifts */ }
export async function onDayRollover(ctx) { /* per-game-day logic */ }

// 5. (optional) DATA — additions for GET /api/config (coordinator merges).
export const CONFIG_DATA = { careerTracks: [...] };

// 6. (optional) REST_SPEC — endpoints the coordinator mounts.
//    [{ method:'GET', path:'/api/v2/<m>/...', auth:true/false, admin:false,
//       handler: async (req,res)=>{...}, response:'{...}' }]
```

### Character columns
If you need new `characters` columns, DO NOT alter db.js yourself.
List them in your report as:
`COLUMNS: characters.shift_job TEXT / BIGINT ...`
The coordinator adds them via `ensureColumn` (both dialects) and extends
`harden()` + `youSnapshot()` from your spec.

### Existing `act` intents you must change
Some milestones rework existing intents (work, eat, rent, ...). Do NOT
edit actions.js. Deliver:
```
MODIFY INTENT `work`: replace the whole `if (a === 'work') {...}` block with:
<exact replacement code, using conn/c/err/commit/cdLeft/now as in actions.js>
```
plus `TEST UPDATES: server/tests/<file> — <exact changes>`.

## Client components (`web/src/views/v2/<m>/`)

- Self-contained: own folder, own CSS. Use existing primitives from
  `web/src/components` (Button, Card, Sheet, Toast, StatBar, Dialog) and
  hooks (`useGameSocket`, `useApi`). Mobile-first, touch targets ≥44px,
  safe-area insets, `prefers-reduced-motion` respected.
- Do NOT import from other v2 milestone folders.
- Do NOT edit `Game.tsx` — report:
  `MOUNT: tab label/icon suggestion + component path + props it needs
   (it receives {you, send, api} — document any extra needs).`
- Text must be ORIGINAL (never copy reference text). All art
  canvas/SVG-generated, no external assets.

## Tests (`server/tests/m<7-13>.test.js`)

- Follow the existing pattern: `process.env.SESSION_SECRET='test'`,
  `process.env.EKO_DB_PATH=':memory:'`, `createApp()` from
  `../src/app.js`, seed users via `db.createUser` + `signToken`
  (see `server/tests/act.test.js` header).
- Call your own `ensureSchema()` in `test.before`.
- Test: pure logic, storage round-trips, INTENTS via direct invocation
  with a fake api (`{conn:{user,character,cds:{},pos:{lat,lng},furniture:[]},
  err:(t)=>{...}, commit: async (o)=>{...real saveCharacter...}}`),
  economy invariants (money never negative, ledger rows on money moves),
  anti-cheat (forged client values ignored).
- Run: `cd server && npm test -- tests/m<7-13>.test.js` for your file,
  then the FULL suite `npm test` once — it must stay green. If your
  milestone intentionally changes existing behavior, update the old
  tests (deliver as TEST UPDATES spec if the file isn't yours).
- Client: no new unit tests required; coordinator does visual smoke.

## Non-negotiables
- ORIGINAL code, art, and text only. Feature concepts + numeric values
  from docs/REFERENCE_ANALYSIS.md are fine to use; expression must be ours.
- Server-authoritative economy: every money/stat mutation validated
  server-side; ledger row (`addTransaction`) on EVERY money move.
- No real-money features. No network calls to external services.
- Africa/Lagos timezone for any wall-clock logic
  (`new Date().toLocaleString('en-NG',{timeZone:'Africa/Lagos'})`).
- Keep it mobile-first and bundle-sane. No new npm dependencies
  without flagging in your report (prefer zero).
- Do NOT deploy, touch the live service, or use the live browser.
  Local verification only (SQLite).

## Final report format (your last message — the ONLY thing the coordinator sees)
1. What was built (per requirement, with design decisions).
2. Test results (your file: X/X; full suite: green/red + notes).
3. Files CREATED (exact paths).
4. INTEGRATION SPECs: COLUMNS / MODIFY INTENT / TEST UPDATES /
   REST_SPEC / CONFIG_DATA / MOUNT / hub or app wiring needed.
5. Cut/deferred + why. Anything you need from the coordinator.
