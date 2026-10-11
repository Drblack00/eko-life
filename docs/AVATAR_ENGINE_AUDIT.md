# AVATAR ENGINE — AUDIT (Milestone 1, 2026-10-11)

## Stack
- **Frontend:** React 19.1 + TypeScript 5.8, Vite 6, vitest 5, PWA (`web/`). No React Three Fiber — raw Three.js.
- **Backend:** Express 4.21 + `ws` 8.18, Node ≥22 (`server/`). Session auth (`authMiddleware`, `SESSION_SECRET`).
- **DB:** Supabase Postgres in production (`DATABASE_URL`, session pooler); `node:sqlite` locally. Dual-schema in `server/src/db.js` (PG_SCHEMA + SQLite), `ensureColumn` migrations.
- **3D renderer:** Three.js 0.180, plain WebGLRenderer (check studio/room for exact flags). No post-processing pipeline.

## How the avatar is generated
100% **procedural** — no GLB/glTF/FBX, no external avatar service, no downloaded assets.
Code: `web/src/views/avatar/` — `avatarModel.ts` (orchestrator + idle loop), `parts/`:
`body.ts` (legs/torso/arms/hands/neck), `head.ts` (skull/ears/nose/lips/eyes/brows),
`hair.ts` (7 hairstyles), `clothing.ts` (5 outfits), `materials.ts` (MeshStandardMaterial set),
`faceTextures.ts`, `garmentTextures.ts`, `strandTextures.ts` (canvas-generated textures),
`studio.ts` (camera math), `util.ts`. Triangle budget ~17–21k (M20).

## Skeleton / materials / morphs / animation — what actually exists
- **No real skeleton.** Joints are `THREE.Group` pivots: `upper`, `headMount`, `armL`, `armR`,
  `eyeL`, `eyeR`. **No `SkinnedMesh`, no skinning weights, no bone hierarchy.**
- **No morph targets / blendshapes.** Face is static geometry; expressions impossible.
- **Materials:** `MeshStandardMaterial` with canvas-generated color maps. No authored normal/
  roughness maps, no subsurface scattering. Skin reads flat/plastic under some lights.
- **Animation:** one procedural idle loop in `avatarModel.ts` (`update(t)`): blink (eye Y-scale),
  breathing (torso scale ±1.6%), arm micro-sway, head bob/slow turn, weight shift.
  No walk cycle (room tap-to-walk glides), no gestures, no sitting/sleeping poses,
  no facial animation, no eye saccades. Reduced-motion → static pose.

## Customization controls (today)
Body: woman/man. Skin: 12 tones. Hair: 7 styles (lowcut, bald, curls, afro, locs, braids, classic).
Outfits: 5 (casual, hoodie, office, chill, sitework). Fabrics: 4 (plain, ankara, adire, aso-oke).
Top/bottom colors from fixed palettes. **Missing:** facial hair, hair color, shoes, accessories,
face-shape/morph controls, body-build/height variation.

## How appearance is stored
- DB: `characters.avatar_look` **TEXT** (JSON), added via `ensureColumn` (no formal migration file).
- Server validation: `sanitizeAvatar()` in `server/src/game/data.js` — allowlists
  (`AVATAR_BODIES/SKINS/HAIRS/OUTFITS/FABRICS`, `AVATAR_TOP_COLORS/BOTTOM_COLORS`); rejects
  unknown ids. Served to client via `/api/config` → `avatarLook` option lists.
- Writes: (1) `POST /api/characters` at creation; (2) **WS intent `save_avatar`**
  (`server/src/game/actions.js`) — validates, `JSON.stringify`s into `avatar_look`, commits.
  **No revision / optimistic concurrency — last write wins.** No
  `GET/PUT /api/characters/:id/appearance` REST endpoints. No `GET /api/avatar/catalog`.
- Client type: `AvatarLook` in `web/src/game/types.ts`
  `{body, skin, hair, outfit, fabric, topColor, bottomColor}` — flat, unversioned.
- Ownership: derived from session (`conn.user` / `req.userId`); client user IDs not trusted. Good.

## Asset hosting / caching
None needed — everything is generated at runtime in the browser. No CDN, no asset URLs,
no cache headers, no versioning. Canvas textures are rebuilt per avatar build (some
memoization may exist — verify in M4).

## Mobile / perf limits
Procedural = low memory, no downloads; ~21k tris is iPhone-safe. Room caps pixel ratio.
No LOD, no texture compression, no frustum culling concerns (single character).
Risk for M3: keep triangle budget ≤ ~25k and avoid per-frame allocations.

## Render / deploy constraints
Free-tier web service (`ekolife`), Supabase Postgres external. Env vars: `SESSION_SECRET`
(generated), `DATABASE_URL` (manual, sync:false). Cold starts on free tier. Build:
`npm run install:all && npm run build:web`; start `npm start`. Deploys are manual
(GitHub push → Render "Deploy latest commit"). Repo is source of truth; live matches
repo after each manual deploy (verified via /api/health each round).

## Env vars
Local: none required (SQLite fallback). Production: `DATABASE_URL`, `SESSION_SECRET`.

## Actual causes of "primitive, stiff, lifeless"
1. **No skeleton/skinning** — rigid group pivots; limbs can't bend naturally; no joint deformation.
2. **No morph targets** — face frozen; no smile/talk/blink-shape; eyes scale instead of lids.
3. **Procedural geometry fidelity ceiling** — heads trend spherical, limbs cylindrical,
   hands mitten-like; M20 improved this but the user still reads it as "somehow"/toy-like.
4. **Flat materials** — single roughness, no micro-variation, no SSS; skin looks plastic.
5. **Thin animation** — idle-only loop; no walk cycle, gestures, poses, or facial motion.
6. **Missing variety** — no facial hair, hair color, shoes, accessories, body morphs.

## What this means for the rebuild
There are **no licensed external human models** in this environment and none may be
fabricated. The honest path: (a) canonical versioned data model + manifest + resolver
treating procedural parts as real `available` assets; (b) push procedural fidelity as far
as it can go with better anatomy/materials (art direction: reference photo of a young
Nigerian man — turquoise hoodie, cargo pants, sneakers, low cut with lineup, light
mustache/goatee; reference only, never ingested); (c) procedural animation upgrades
(blink shapes via lid morphs are impossible without morphs — implement lid meshes or
vertex-level animation honestly); (d) versioned persistence with revisions; (e) documented
`pending` slots + integration guide for future licensed GLB assets.
