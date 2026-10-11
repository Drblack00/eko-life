import * as THREE from "three";
import type { AvatarLook } from "../../game/types";
import { migrateAvatarLookToV1 } from "../../avatar/migrate";
import {
  assembleAppearance,
  type AssembledAvatar,
} from "../../avatar/assembler";

/**
 * Realistic procedural avatar (~1.6 units tall, root at y=0, faces +Z).
 * All geometry is original, generated at build time — no external assets.
 *
 * Milestone 4: this module is now a thin compatibility layer over the
 * canonical avatar engine in `../../avatar/`:
 *   - legacy AvatarLook → v1 via `migrateAvatarLookToV1` (M2)
 *   - assembly (body → clothing → head → hair → facial hair, rig, idle
 *     update, disposal) via `assembleAppearance` (M4, `avatar/assembler.ts`)
 *
 * The public contract is unchanged:
 *   buildAvatarLook(look)        → { group, update? }   (new contract)
 *   buildAvatarLook(THREE, look) → THREE.Group          (legacy)
 * The legacy shape returns the bare group (updater stashed on
 * `group.userData.update` when animation is enabled).
 *
 * Conventions (preserved): trousers use look.bottomColor, shirts use
 * look.topColor (canvas fabric pattern unless fabric === "plain"), skin
 * parts use the skin tone, hair is dark. group.userData.dispose()
 * releases everything.
 *
 * Geometry contract (unchanged — studio.ts camera anchors depend on it):
 * figure ~1.6 units, faces +Z, chin anchor at y=1.4, feet ~0.09.
 */

/** Result of the new single-argument buildAvatarLook(look) call. */
export interface AvatarBuild {
  group: THREE.Group;
  /**
   * Advances blink timers and idle animation. Safe to call every frame.
   * Omitted when the user prefers reduced motion (static neutral pose).
   */
  update?: (t: number, dt: number) => void;
}

export function buildAvatarLook(look: AvatarLook): AvatarBuild;
export function buildAvatarLook(
  threeNs: typeof import("three"),
  look: AvatarLook
): THREE.Group;
export function buildAvatarLook(
  a: AvatarLook | typeof import("three"),
  b?: AvatarLook
): AvatarBuild | THREE.Group {
  const legacy = b !== undefined;
  const T = (legacy ? a : THREE) as typeof import("three");
  const look = (legacy ? b : a) as AvatarLook;
  const built = buildInternal(T, look);
  if (!legacy) return built;
  if (built.update) built.group.userData.update = built.update;
  return built.group;
}

function buildInternal(T: typeof import("three"), look: AvatarLook): AvatarBuild {
  // Legacy flat look → canonical v1 (never throws, never invalid).
  const appearance = migrateAvatarLookToV1(look ?? {});
  let assembled: AssembledAvatar;
  try {
    assembled = assembleAppearance(T, appearance);
  } catch {
    // Should not happen (the assembler degrades to defaults internally),
    // but the room must never go blank: retry once with clean defaults,
    // then let HomeRoom's capsule fallback take over if that also fails.
    assembled = assembleAppearance(T, migrateAvatarLookToV1(null));
  }
  const { group } = assembled;
  return assembled.update ? { group, update: assembled.update } : { group };
}
