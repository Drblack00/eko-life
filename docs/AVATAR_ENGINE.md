# Èkó Life Avatar Engine — Architecture & Operations (2026-10-11)

Production-oriented 3D avatar system: 100% original procedural Three.js humans
(no external models), canonical versioned appearance data, manifest-driven assembly,
versioned persistence with optimistic concurrency.

## 1. Architecture overview

```
web/src/avatar/                 ← engine home (new)
  schema.ts                     canonical AppearanceV1 (schemaVersion: 1)
  validation.ts                 validateAppearance() + DEFAULT_APPEARANCE_V1
  manifest.ts                   AvatarAsset registry (procedural = available)
  resolver.ts                   resolveAsset / fallbacks / compatibility / safety
  migrate.ts                    legacy AvatarLook → v1 (total, never throws)
  persistence.ts                REST client: fetch/save, 409 conflict, drafts
  assembler.ts                  manifest-driven character assembly + diffing
  loader.ts                     AvatarLoader: async, stale-guard, dedup, swap
  animation (in assembler.ts)   createAnimationController: idle/walk/wave
  index.ts                      barrel for the pure data layer (no three/DOM)
web/src/views/avatar/
  avatarModel.ts                thin compat layer (legacy buildAvatarLook → v1)
  AvatarStudio.tsx              legacy studio OR new editor (characterId?)
  editor/                       M5: saved/draft/rendered editor (AvatarEditor)
  AvatarEditButton.tsx          entry point (passes characterId through)
  parts/                        procedural builders: body, head, hair,
                                facialHair, clothing, materials, textures
server/src/game/appearance.js   server validator + persistAppearance + catalog
server/src/routes/api.js        GET/PUT /api/characters/:id/appearance,
                                GET /api/avatar/catalog
server/src/db.js                characters.appearance_rev (PG + SQLite)
```

## 2. Canonical appearance (v1)

`AppearanceV1 { schemaVersion:1, characterId, base:{bodyType, bodyPresetId,
facePresetId, skinToneId}, morphs{9 keys 0..1}, hair:{styleId,colorId,facialHairId},
clothing:{topId,bottomId,outerwearId|null,shoeId,fabricId,topColor,bottomColor},
accessories[] }`. Existing ids kept verbatim (stability protects saves).
Validation: reject unknown ids/morphs/out-of-range; safe defaults; never
renderer objects or URLs. Legacy flat looks migrate via `migrateAvatarLookToV1`.

## 3. Asset manifest

`AvatarAsset {id, kind, source:"procedural"|"licensed-glb", status:"available"|
"pending", version, skeletonId, materialProfile, compatibleBodyTypes,
supportedMorphs, slots, fallbackAssetId, license}`. ~50 procedural assets are
`available` (`eko-proc-rig-v1` = Group pivots, honestly documented as NOT a
skinned skeleton). Four `pending` licensed-GLB slots document the integration
path. The resolver rejects arbitrary paths/URLs — only manifest ids load.

**Licensed-GLB integration guide (when assets exist):** format glTF 2.0 `.glb`;
skeleton Mixamo-compatible or a documented `eko` skeleton (retarget map required);
PBR channels (baseColor, normal, roughness, metallic≈0 for skin/cloth);
license recorded per asset; add manifest entries with `source:"licensed-glb"`,
`status:"available"`, content hash; extend `assembler.ts` with a GLB branch
behind the same `AvatarAsset` interface. Never hot-link unvetted URLs.

## 4. Runtime

`AvatarLoader.load()` is staged/async with `onProgress`, request-ID stale-guard
(rapid changes → latest wins), dedup of identical in-flight builds, fallback to
defaults on failure, and `swap()` that keeps the old character visible until the
new build is ready. `diffUpdate()` does minimal updates (skin recolor in place,
hair/facial-hair group swaps, re-dress, body rebuild only when needed).
Materials are per-character clones — zero cross-character leaks (tested).
`dispose()` frees per-character resources; nothing is shared cross-character
today (no global geometry cache — documented; adding one requires exclusion
registration).

## 5. Animation

`createAnimationController(rig, root)`: states idle/walk/wave with eased
blending. Idle: breathing, arm sway, head drift, weight shift, eye saccades,
lid-hinge blink. Walk auto-engages from root translation (tap-to-walk and
ambient wandering get a walk cycle with no room-code changes): hip-pendulum
swing, arm counter-swing, lean, stride-synced bob. Wave: 2.4s cancellable
gesture via `userData.setAnimState("wave")`. No morph targets exist, so no
lip-sync/facial expressions (documented, not faked). Legs are single rigid
segments (no knees) — walk is stylized, honestly. Reduced-motion → static.

## 6. Editor

Three states: saved (server-confirmed) / draft (local edits) / rendered
(on-screen). Edits render immediately via diff; Save uses `expectedRev`;
409 → conflict dialog (Load latest / Keep editing — never silent overwrite);
400 → field errors; failure → draft kept, success never claimed. Categories
shipped: Body, Skin, Hair (9 styles + 3 colors + 4 facial-hair), Clothing
(5 outfits + 4 fabrics + colors; shoes are outfit-implied, captioned).
**Omitted honestly:** Face (all 9 morphs stubbed, one face preset — a slider
would move nothing) and Accessories (zero assets in manifest). Changing
clothing never resets face/skin/hair (field-level draft, tested).

## 7. Persistence API

- `GET /api/characters/:id/appearance` → `{appearance, revision}` (404 if not
  yours; appearance may be legacy — client migrates on read).
- `PUT /api/characters/:id/appearance` `{appearance, expectedRev}` →
  200 `{appearance, revision}`; 400 validation; **409** `{error:
  "revision_conflict", revision}`; 403 cross-user.
- `GET /api/avatar/catalog` → schemaVersion + all id lists (mirrors manifest).
- Legacy WS `save_avatar` still works (migrates to v1 server-side, bumps rev).
- Ownership always from session (`req.userId` / `conn.user`); client user ids
  never trusted. Writes are revision-conditional (lost races → 409).

## 8. Schema migrations

`migrate.ts` (client) + `legacyLookToV1` (server): total functions, never
throw, field-level fallback to defaults. v1→v2 will add a `migrateV1ToV2`
here; never rewrite stored JSON in place before migration succeeds.

## 9. Mobile performance

Max measured avatar: **24,412 tris** (budget ≤25k). No per-frame allocations
in the animation hot loop. Procedural = zero download, low memory. Room caps
pixel ratio (existing). No LOD needed at these counts.

## 10. Environment & deploy

No new env vars. Same pipeline: GitHub push → Render manual "Deploy latest
commit" → verify `/api/health`. DB migration is automatic via `ensureColumn`
(`appearance_rev`). **Rollback:** all changes are additive; dropping the new
`web/src/avatar/*` modules reverts to the legacy studio path (AvatarStudio
falls back when `characterId` is absent). Stored `avatar_look` JSON remains
readable by old code (v1 is a superset JSON shape; legacy readers ignore
unknown fields — but downgrading the client loses v1-only selections on next
save; treat rollback as forward-fix preferred).

## 11. Known limitations (honest)

1. No skeleton/skinning — rigid pivots; limbs can't bend at elbows/knees.
2. No morph targets — face static; 9 schema morphs validated-but-stubbed;
   no lip-sync, no expressions.
3. 100% procedural — stylized-realistic, NOT photoreal (the reference photo
   was art direction only, never ingested).
4. Accessories catalog is empty; Face category omitted (nothing real to drive).
5. Server validator (`appearance.js`) manually mirrors `web/src/avatar/*` —
   keep in sync; future: shared package.
6. `migrate.ts` decomposes `hoodie` → `bottom_trouser_01` but the renderer
   adds cargo pockets for hoodie — slot doesn't fully describe the render.
7. Loader progress is staged markers, not byte counts (procedural builds).
8. Multi-worker production races: PG conditional write verified by post-write
   rev read; a true single-statement guarantee needs a transaction wrapper.
9. Wave gesture has no in-game trigger yet (API ready: `userData.setAnimState`).
