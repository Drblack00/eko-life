# V2 integration notes (coordinator working file — NOT user-facing)

## M9 — Daily retention ✅ landed (18/18 tests; full suite: 10 pre-existing failures all in m10 WIP)

### COLUMNS (add via ensureColumn, both dialects; extend harden/saveCharacter/insertCharacter/youSnapshot)
```
characters.perk_stars INTEGER DEFAULT 0
characters.perks TEXT DEFAULT '[]'
```
harden: `c.perk_stars = Math.max(0, Math.floor(Number(c.perk_stars)||0));` coerce perks to JSON string array (fallback '[]').
youSnapshot: `perk_stars: Number||0, perks: <parsed array>`.

### Wiring — actions.js (before `err('Unknown action.')`)
```js
import { INTENTS as M9_INTENTS } from './v2/m9.js';
...
  // ---------- M9: daily retention ----------
  if (M9_INTENTS[a]) {
    await M9_INTENTS[a]({ conn, send, broadcast, youSnapshot, err, commit, now, getDay }, msg);
    return;
  }
```

### Wiring — app.js
- Import `onTickMinute as m9Tick, bootM9` from './game/v2/m9.js'; 60s interval calling m9Tick({broadcast, pushNews}); in/near hub.bootGame(): `await bootM9({broadcast})`. Needs hub.pushNews exposed (m9 tolerates absence).
- REST: mount M9_REST with requireAuth: GET /api/v2/m9/hunt, /hustle, /perks.

### Cross-milestone contracts delivered by M9
- M8 decay: `import { activePerkEffects, decayMultiplier } from './v2/m9.js'` — multiplicative stacking.
- M7 shifts: `workPayMultiplier(c)` at payout.
- Discount: `discountMultiplier(c)` for buy intents.
- M12 XP: `xpBoostMultiplier(c)`.

### MOUNT
New "Daily" tab (🗺️) → `import { DailyTab } from './v2/m9'` props {you, send, api}.

### Files created
- server/src/game/v2/m9.js, server/tests/m9.test.js
- web/src/views/v2/m9/DailyTab.tsx, DailyTab.css, index.ts

---

## M13 — Map billboards ✅ landed (11/11 tests)

### REST wiring (coordinator mounts)
- `routes/api.js`: `import { handleListBillboards } from './game/v2/m13.js'; router.get('/v2/m13/billboards', handleListBillboards);` (public)
- `routes/admin.js` inside createAdminRouter (behind requireAdmin):
```js
import { handleAdminCreateBillboard, handleAdminUpdateBillboard, handleAdminDeleteBillboard } from '../game/v2/m13.js';
router.post('/billboards', handleAdminCreateBillboard);
router.patch('/billboards/:id', handleAdminUpdateBillboard);
router.delete('/billboards/:id', handleAdminDeleteBillboard);
```
- Boot: call `ensureSchema()` from m13.js once after initDb() (seeds 6 billboards if empty).

### MOUNT (Admin.tsx)
After the broadcast `<Card>...</Card>`, before `<div className="eko-admin__toolbar">`:
```tsx
import { BillboardsManager } from "./v2/m13/BillboardsAdmin";
<BillboardsManager token={token} />
```

### Files created/edited
- server/src/game/v2/m13.js, server/tests/m13.test.js (new)
- web/src/game/billboardCanvas.ts (new), web/src/views/v2/m13/BillboardsAdmin.tsx, m13.css (new)
- web/src/game/CityMap.tsx (EDITED by M13 — billboard meshes; no one else may touch)

---

## M11 — Governance ✅ landed (13/13; m5.test.js 20/20 unmodified)

### elections.js — EDITED by M11 (owned; no one else may touch)
Added: POLICIES (6, incl. non-pickable default Steady Hustle), COMMISSIONER_TITLES (6), commissioners table (lazy self-ensuring schema), applyPolicy/resetPolicyMultipliers/ensurePolicyDefault/getPolicyMultipliers/getPolicyState, list/appoint/dismiss/isCommissioner, electionExtras merged into playerElectionState, fullElectionState(), tally resets 5 mult keys + gov_policy* metas.

### Meta keys written (contracts for M7/M8/M10)
`wage_mult`, `tax_mult`, `event_mult`, `market_mult`, `decay_mult` (REAL, default 1) + `gov_policy`, `gov_policy_picked`, `gov_policy_set_at`, `gov_policy_won_at`.
- M7: shift pay × wage_mult (import getPolicyMultipliers from elections.js)
- M10: income tax × tax_mult
- M8: event probability × event_mult; all need decay × decay_mult
- market_mult: multiply buy prices in buy_property/buy_vehicle/buy_biz/buy_furniture

### Wiring — actions.js (merge with M9 block before `err('Unknown action.')`)
```js
import { INTENTS as M11_INTENTS } from './v2/m11.js';
if (M11_INTENTS[a]) {
  await M11_INTENTS[a]({ conn, send, broadcast, youSnapshot, err, commit, now, getDay,
    getGovernorId: ctx.getGovernorId, pushNews: ctx.pushNews, pushElectionAll: ctx.pushElectionAll }, msg);
  return;
}
```

### Wiring — admin.js
GET /api/admin/election: use fullElectionState instead of electionState.

### Wiring — hub.js + ws/social.js (chat badges)
Add `comm: await isCommissioner(id)` to chat entries (import from elections.js).

### Client types (types.ts, useGameSocket.ts)
ActName += gov_policy|gov_appoint|gov_dismiss; ElectionState += policy?, commissioners?; normalizeElection passes them through.

### MOUNT (election/ElectionSheet.tsx, after governor section)
```tsx
import { PolicyBanner, PolicyPicker, Commissioners } from "../v2/m11/GovExtras";
<PolicyBanner sock={sock} />
<PolicyPicker sock={sock} you={you} />
<Commissioners sock={sock} you={you} />
```

### Notes
- No min-account-age rule exists in current code (verified by M11) — note in docs.
- Commissioners persist across terms by design (dismissal only).
- Files: server/src/game/v2/m11.js, server/tests/m11.test.js, web/src/views/v2/m11/ (GovExtras.tsx, m11.css, index.ts); edited elections.js.

---

## M12 — Skills + academy ✅ landed (19/19)

### COLUMNS (ensureColumn both dialects; persist in insert/saveCharacter)
```
characters.skills TEXT       -- JSON {id:{xp,level}}
characters.skills_used TEXT  -- JSON {id:lastUsedTs ms}
```

### INTENTS wiring (actions.js, before unknown-action fallback)
```js
import { INTENTS as M12_INTENTS, ensureSchema as m12Schema } from './v2/m12.js';
// boot: await m12Schema();
if (M12_INTENTS[a]) { await M12_INTENTS[a]({ conn, send, broadcast, youSnapshot, err, commit, now, getDay }, msg); return; }
```
Intents: `skills`, `train {skill}`, `academy_courses`, `academy_lesson {course}`, `academy_quiz {course, answers}`.

### YOU SNAPSHOT (hub.js commit)
```js
import { m12YouSnapshot } from './game/v2/m12.js';
const m12 = await m12YouSnapshot(conn);
const out = { t:'you', you: { ...youSnapshot(conn), skills: m12.skills, academy: m12.academy } };
```

### CONFIG_DATA
Merge `skills`, `skillTuning`, `trainGates`, `academyCourses` (answers stripped) into GET /api/config.

### For M7 gates
```js
import { skillLevel, getAcademyCerts } from './v2/m12.js';
skillLevel(char, skillId, certCourseIds=[]) → max(0, base + certBonus(max 1) − rust)
```
Legacy `study`/`cert` untouched. Rust: pure timestamp math (<7d→0, 7–27d→1, ≥27d→2).

### MOUNT
- Tab "Skills" 💪 → web/src/views/v2/m12/SkillsPanel.tsx {you, send, api}
- Tab "Academy" 🎓 → web/src/views/v2/m12/AcademyView.tsx {you, send, api}

### Files
server/src/game/v2/m12.js, server/tests/m12.test.js, web/src/views/v2/m12/ (SkillsPanel.tsx, AcademyView.tsx, index.tsx, m12.css)

---

## M8 — Needs + moodlets ✅ landed (29/29)

### COLUMNS (ensureColumn both dialects; extend saveCharacter/insertCharacter/DEFAULT_CHARACTER)
```
characters.fun INTEGER NOT NULL DEFAULT 100
characters.social INTEGER NOT NULL DEFAULT 100
characters.hygiene INTEGER NOT NULL DEFAULT 100
characters.bladder INTEGER NOT NULL DEFAULT 100
```

### sim.js — REPLACE decayTick block with re-export
```js
export { decayTick } from './v2/m8.js';
```
New signature: `decayTick(char, mods)` mods={moodlets, perks}; returns {starving, desperate, grimy, lonely, bored}.

### actions.js
- harden(): add fun/social/hygiene/bladder clamps after hunger line.
- Import `triggerMoodlet` from './v2/m8.js' + M8_FOOD_FUN / M8_EAT_MOODLET / M8_FUN_MOODLET consts.
- MODIFY INTENT blocks (exact replacements in report): `eat`, `fun`, `sleep`, `rest`.
- Moodlet hook inserts: work (payday_groove), travel (far_from_home when fare>0), loan (loan_dread both branches), bank deposit ≥₦5000 (savings_smug).
- INTENTS wiring: `if (m8.INTENTS[a]) {...}` before unknown-action fallback (intents: moodlets, wash, toilet).

### hub.js
- Import listActiveMoodlets, onTickMinute from v2/m8.js.
- youSnapshot: add fun/social/hygiene/bladder after hunger.
- decayTickAll: replace loop body per spec (mods + cascade notes + onTickMinute with broadcast/pushNews). NOTE: fill `perks` slot with M9's activePerkEffects(conn.character) — import from v2/m9.js.

### routes/api.js
- Mount m8.REST_SPEC (GET /api/v2/m8/moodlets, auth).
- characterBody: add 4 need fields after hunger.

### data.js
- DEFAULT_CHARACTER: add fun/social/hygiene/bladder: 100 after hunger.

### CONFIG_DATA
Merge m8.CONFIG_DATA (needs catalog) into GET /api/config.

### TEST UPDATES — server/tests/sim.test.js
Per M8 report §TEST UPDATES (decay expectations with 6 needs; act.test.js needs NO changes).

### MOUNT — Game.tsx
New "Needs" tab (💚) → `./v2/m8/NeedsPanel` {you, sock}. Extend You interface + ActName (wash|toilet|moodlets) in types.ts.

### Notes
- M9 DailyTab.tsx has a TS error (toast misuse) — fix during integration.
- City events: ~1.5%/min base × event_mult; NEPA Took Light / Hold-Up / Owambe Weekend.
- Files: server/src/game/v2/m8.js, server/tests/m8.test.js, web/src/views/v2/m8/NeedsPanel.tsx + .css.

---

## M7 — Clock + shifts ✅ landed (27/27)

### COLUMNS (ensureColumn both dialects; extend harden/saveCharacter)
```
characters.shift_job TEXT
characters.shift_started_at BIGINT
characters.shift_ends_at BIGINT
```
harden: normalize the three (null-safe). saveCharacter: add 3 cols (exact replacement in report; PG $24–$26).

### youSnapshot (hub.js, after `furniture:` line)
```js
shift: c.shift_job && Number(c.shift_ends_at) > Date.now()
  ? { job: c.shift_job, endsAt: Number(c.shift_ends_at) } : null,
```

### INTENTS wiring (actions.js, BEFORE the `// ---------- work ----------` block)
```js
import { INTENTS as M7_INTENTS } from './v2/m7.js';
if (M7_INTENTS[a]) {
  await M7_INTENTS[a]({ conn, send, broadcast, youSnapshot, err, commit, now, getDay }, msg);
  return;
}
```
Intents: shift_start / shift_leave (FORFEIT, no prorata — documented) / shift_status.

### MODIFY INTENT `work` — replace whole block with error pointing to shifts:
```js
if (a === 'work') {
  err('Work is now 1-hour shifts — clock in from the Jobs tab. Pay lands when your shift completes.');
  return;
}
```

### REST (api.js)
`router.get('/v2/m7/clock', m7.REST_SPEC[0].handler)` → {ts, label:"Sat · 3:16 AM"}.

### CONFIG_DATA
Merge `careerTracks` + `skillLabels` into GET /api/config and WS init config.

### Hub/app wiring (app.js)
- 60s interval: m7.onTickMinute({broadcast, sendTo, getDay, now, refreshYou}) — refreshYou: expose hub.pushYou(userId) that re-reads character + sends {t:'you', you: youSnapshot(conn)}.
- 30s interval: broadcast {t:'clock', ...m7.lagosNow()}.
- clearInterval both in close().

### TEST UPDATES — server/tests/act.test.js
Per M7 report §TEST UPDATES (replace 6 work tests with shift tests; add m7 import + ensureSchema + tickCtx/expireShift helpers; update full-flow tail; fuzz needs no change).

### MOUNT — Game.tsx
- Tab "Jobs" 💼 → web/src/views/v2/m7/JobsTab {you (with shift field), send, careerTracks?, skillLabels?, locationName?}
- HUD top bar: web/src/views/v2/m7/Clock {label?} (polls REST if no label).

### Notes
- 24 tracks; 10 legacy job ids kept as entry roles; 14 new mid-tier with skill gates (skill ids = M12 contract).
- Payout: floor(pay × classMult × wage_mult × (1+perkPct/100)); ledger `shift_pay`; offline completion DB-driven.
- Files: server/src/game/v2/m7.js, server/tests/m7.test.js, web/src/views/v2/m7/ (Clock.tsx, JobsTab.tsx, m7.css, index.ts).

---

## M10 — Economy depth ✅ landed (24/24; full suite 249/249 at completion)

### COLUMNS (ensureColumn both dialects; saveCharacter; harden; youSnapshot/characterBody)
```
characters.housing_owned INTEGER NOT NULL DEFAULT 0
```
harden: `c.housing_owned = Number(c.housing_owned) ? 1 : 0;`
youSnapshot/characterBody: `housing_owned: !!Number(c.housing_owned)`.

### MODIFY — settleDayRent (actions.js), after `const c = conn.character;`
```js
if (Number(c.housing_owned) === 1) {
  await saveCharacter(c);
  send(conn, { t: 'you', you: youSnapshot(conn) });
  return { ok: true, owned: true };
}
```

### MODIFY — `rent` intent: after `c.housing = h.id;` add
```js
c.housing_owned = 0; // M10: moving forfeits rent-to-own status
```

### INTENTS wiring (actions.js, needs err/commit scope; pushTo via hub.pushYou)
```js
import * as m10 from './v2/m10.js';
if (m10.INTENTS[a]) {
  const api = { conn, send, broadcast, youSnapshot, err, commit, now, getDay,
    pushTo: async (userId) => pushYou(userId) };
  await m10.INTENTS[a](api, msg);
  for (const uid of m10.takePendingOwnerRefresh()) { await api.pushTo(uid); }
  return;
}
```
Intents: shop_create, shop_stock, shop_buy, shop_rate, shop_browse, shop_mine, buy_rental, lapo_borrow, lapo_status, lapo_repay, lapo_repay_all (+ WS replies t:'shops'/'shop_mine'/'lapo').

### Day tick (hub.js dayRollover)
- Boot: `await m10.ensureSchema()`.
- Per-conn loop after settleDayEconomy: `await m10.settleOnlinePlayer(ctx, conn)`.
- After settleOfflineEconomy: `await m10.settleOfflinePlayers(ctx, (id) => online.has(Number(id)))`.

### REST (api.js, authMiddleware where auth:true)
GET /api/v2/m10/shops?location= (public), GET /api/v2/m10/shops/:id/items (public), GET /api/v2/m10/shop/mine, /lapo, /tax (auth).

### CONFIG_DATA
Merge `housingBuy`, `shopTypes`, `lapo`, `tax` into GET /api/config.

### Client types
ActName += 11 M10 intent names.

### MOUNT — Game.tsx
Main tab "Market 💰" → web/src/views/v2/m10/EconomyTab {token, sock, you}. (Optionally HousingPanel inside existing housing UI.)

### Notes
- SHOP_CREATE_FEE ₦20k; LAPO ₦50k–500k, 4 weekly debits, 5% flat; TAX: first ₦1M free, 20% to ₦10M, 30% above; EARNING_KINDS list in module.
- Existing loan/rent tests unbroken; loan semantics untouched.
- Files: server/src/game/v2/m10.js, server/tests/m10.test.js, web/src/views/v2/m10/ (EconomyTab, MarketView, MyShopView, HousingPanel, LapoPanel, TaxCard, m10Api, index, m10.css).
