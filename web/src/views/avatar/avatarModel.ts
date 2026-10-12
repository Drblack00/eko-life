import * as THREE from "three";
import type { AvatarLook } from "../../game/types";
import { getCachedAssets, cloneBody, loadAvatarAssets } from "../../avatar/gltf/loader";
import { applyCustomization } from "../../avatar/gltf/customizer";
import { AvatarAnimator } from "../../avatar/gltf/animator";
import { SKIN_TONES } from "../../avatar/gltf/customizer";

/**
 * GLTF-based avatar (CC0 Universal Base Characters + Animation Library).
 * Replaces the procedural avatar engine.
 *
 * - Male/female base bodies from the CC0 pack
 * - 46 retargeted animations (Idle_Loop by default, fists clenched)
 * - Skin tone, hair style/color, beard, eyebrows customization
 *
 * Assets preload during boot; buildAvatarLook clones from cache synchronously.
 * If assets aren't ready yet, triggers load and returns a placeholder group
 * that populates when loading completes.
 *
 * Public contract (unchanged):
 *   buildAvatarLook(look)        → { group, update? }
 *   buildAvatarLook(THREE, look) → THREE.Group (legacy)
 */

/** Result of the new single-argument buildAvatarLook(look) call. */
export interface AvatarBuild {
  group: THREE.Group;
  /**
   * Advances animation. Safe to call every frame.
   */
  update?: (t: number, dt: number) => void;
  /** Plays a named animation (e.g. "Walk_Loop", "Dance_Loop"). */
  playAnim?: (name: string) => void;
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
  const look = (legacy ? b : a) as AvatarLook;
  const built = buildInternal(look);
  if (!legacy) return built;
  if (built.update) built.group.userData.update = built.update;
  if (built.playAnim) built.group.userData.playAnim = built.playAnim;
  return built.group;
}

/** Maps legacy skin ids/names to hex. Falls back to mid-brown. */
function resolveSkinHex(skin: string | undefined): string {
  if (!skin) return "#8d5524";
  if (/^#[0-9a-f]{6}$/i.test(skin)) return skin;
  // Legacy named tones — map to closest hex
  const lower = skin.toLowerCase();
  if (lower.includes("light") || lower.includes("fair")) return SKIN_TONES[0];
  if (lower.includes("medium")) return SKIN_TONES[3];
  if (lower.includes("dark") || lower.includes("deep")) return SKIN_TONES[5];
  return "#8d5524";
}

/** Maps legacy hair ids to new hair styles. */
function resolveHairStyle(hair: string | undefined, body: "male" | "female"): string {
  if (!hair) return body === "female" ? "long" : "buzzed";
  const lower = hair.toLowerCase();
  if (lower.includes("bun")) return "buns";
  if (lower.includes("long")) return "long";
  if (lower.includes("buzz")) return body === "female" ? "buzzedFemale" : "buzzed";
  if (lower.includes("part")) return "parted";
  if (lower.includes("bald") || lower.includes("none")) return "none";
  return body === "female" ? "long" : "buzzed";
}

function buildInternal(look: AvatarLook): AvatarBuild {
  const group = new THREE.Group();
  group.name = "GltfAvatar";

  const body: "male" | "female" = look?.body === "woman" ? "female" : "male";
  const skinTone = resolveSkinHex(look?.skin);
  const hair = resolveHairStyle(look?.hair, body) as "buns" | "long" | "buzzed" | "parted" | "buzzedFemale" | "none";

  const assets = getCachedAssets();

  if (!assets) {
    // Assets not loaded yet — trigger load and populate async.
    // Return a placeholder group that fills in when ready.
    loadAvatarAssets()
      .then(() => {
        const built = buildInternal(look);
        group.add(built.group);
        if (built.update) group.userData.update = built.update;
        if (built.playAnim) group.userData.playAnim = built.playAnim;
        group.userData.dispose = () => {
          built.group.traverse((o) => {
            if (o instanceof THREE.Mesh) {
              o.geometry.dispose();
            }
          });
        };
      })
      .catch(() => {
        /* placeholder stays empty rather than breaking the scene */
      });

    const placeholder: AvatarBuild = {
      group,
      update: () => {
        const u = group.userData.update as ((t: number, dt: number) => void) | undefined;
        if (u) u(performance.now() / 1000, 0.016);
      },
    };
    return placeholder;
  }

  // Clone body from cache
  const bodyModel = cloneBody(body);
  if (!bodyModel) {
    return { group };
  }

  // Normalize scale/position: base characters are ~1.7 units, root at y=0
  const box = new THREE.Box3().setFromObject(bodyModel);
  const height = box.max.y - box.min.y;
  const targetHeight = 1.7;
  const scale = targetHeight / height;
  bodyModel.scale.setScalar(scale);
  // Recompute after scale and ground it
  const box2 = new THREE.Box3().setFromObject(bodyModel);
  bodyModel.position.y -= box2.min.y;

  // Apply customization
  applyCustomization(bodyModel, {
    body,
    skinTone,
    hair,
    hairColor: "#1a1a1a",
    beard: false,
    eyebrows: true,
    fistsClenched: true,
  });

  // Set up animator with idle
  const animator = new AvatarAnimator(bodyModel);
  animator.play("Idle_Loop");

  group.add(bodyModel);

  let lastT = performance.now() / 1000;
  const update = (t: number, dt: number) => {
    const now = t || performance.now() / 1000;
    const delta = dt || Math.min(0.05, now - lastT);
    lastT = now;
    animator.update(delta);
  };

  const playAnim = (name: string) => {
    animator.play(name);
  };

  group.userData.dispose = () => {
    animator.dispose();
    bodyModel.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  };

  return { group, update, playAnim };
}
