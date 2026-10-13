/**
 * Bone retargeting: animation library (DEF-* bones) → base character bones.
 * CC0 Universal Base Characters + Universal Animation Library.
 *
 * The anim library uses Blender-style names (DEF-hips, DEF-spine.001, etc.)
 * The base characters use Godot-style names (pelvis, spine_01, etc.)
 * THREE.js strips dots from names on load (DEF-spine.001 → DEF-spine001).
 */

import * as THREE from "three";

/** Anim bone name (as THREE.js sees it, dots stripped) → base character bone name. */
export const BONE_MAP: Record<string, string> = {
  "DEF-hips": "pelvis",
  "DEF-spine.001": "spine_01",
  "DEF-spine.002": "spine_02",
  "DEF-spine.003": "spine_03",
  "DEF-neck": "neck_01",
  "DEF-head": "Head",
  "DEF-shoulder.L": "clavicle_l",
  "DEF-shoulder.R": "clavicle_r",
  "DEF-upper_arm.L": "upperarm_l",
  "DEF-upper_arm.R": "upperarm_r",
  "DEF-forearm.L": "lowerarm_l",
  "DEF-forearm.R": "lowerarm_r",
  "DEF-hand.L": "hand_l",
  "DEF-hand.R": "hand_r",
  "DEF-thigh.L": "thigh_l",
  "DEF-thigh.R": "thigh_r",
  "DEF-shin.L": "calf_l",
  "DEF-shin.R": "calf_r",
  "DEF-foot.L": "foot_l",
  "DEF-foot.R": "foot_r",
};

/** Finger bones for fist clenching (base character names). */
const FINGER_PATTERNS = [
  /^(index|middle|ring|pinky)_0[123]_/,
  /^thumb_0[123]_/,
];

/**
 * Retargets an animation clip from the anim library skeleton to the base
 * character skeleton. Returns a new clip with remapped tracks.
 *
 * Strategy: for each track targeting an anim bone, compute the delta from
 * the anim rest pose and apply it to the base bone's rest pose.
 */
export function retargetClip(
  sourceClip: THREE.AnimationClip,
  animRest: Map<string, THREE.Quaternion>,
  baseRest: Map<string, THREE.Quaternion>,
  baseRoot: THREE.Object3D
): THREE.AnimationClip | null {
  const tracks: THREE.KeyframeTrack[] = [];

  for (const track of sourceClip.tracks) {
    // Track names look like "DEF-hips.quaternion" or "DEF-hips.position"
    const dotIdx = track.name.lastIndexOf(".");
    if (dotIdx < 0) continue;
    const boneName = track.name.slice(0, dotIdx);
    const prop = track.name.slice(dotIdx + 1);

    const baseBoneName = BONE_MAP[boneName];
    if (!baseBoneName) continue;

    const animRestQ = animRest.get(boneName);
    const baseRestQ = baseRest.get(baseBoneName);
    if (!animRestQ || !baseRestQ) continue;

    // Verify the base bone exists
    const baseBone = baseRoot.getObjectByName(baseBoneName);
    if (!baseBone) continue;

    if ((prop === "quaternion" || prop === "rotation") && track instanceof THREE.QuaternionKeyframeTrack) {
      // Retarget: baseQ = delta * baseRest, where delta = animQ * inverse(animRest)
      const values = (track.values as Float32Array).slice();
      const animQ = new THREE.Quaternion();
      const delta = new THREE.Quaternion();
      const invRest = animRestQ.clone().invert();

      for (let i = 0; i < values.length; i += 4) {
        animQ.set(values[i], values[i + 1], values[i + 2], values[i + 3]);
        delta.copy(animQ).multiply(invRest);
        const out = delta.multiply(baseRestQ.clone());
        // Convert to local: we baked world delta, need local
        // Since we computed delta in local space of anim bone, and base
        // bones have similar hierarchy, apply directly
        values[i] = out.x;
        values[i + 1] = out.y;
        values[i + 2] = out.z;
        values[i + 3] = out.w;
      }

      tracks.push(
        new THREE.QuaternionKeyframeTrack(
          `${baseBoneName}.quaternion`,
          track.times.slice(),
          values
        )
      );
    } else if (prop === "position" && track instanceof THREE.VectorKeyframeTrack) {
      // Position tracks: only retarget root motion, scale to base proportions
      // For now, copy root position directly (hips)
      if (boneName === "DEF-hips") {
        tracks.push(
          new THREE.VectorKeyframeTrack(
            `${baseBoneName}.position`,
            track.times.slice(),
            (track.values as Float32Array).slice()
          )
        );
      }
    }
  }

  if (tracks.length === 0) return null;
  return new THREE.AnimationClip(sourceClip.name, sourceClip.duration, tracks);
}

/**
 * Applies a static clenched-fist pose to the character's hands.
 * Call after retargeting or as a pose overlay.
 */
export function clenchFists(root: THREE.Object3D, amount = 1.0): void {
  try {
    const curl = (95 * Math.PI) / 180 * amount;
    const thumbCurl = (70 * Math.PI) / 180 * amount;
    root.traverse((o) => {
      try {
        if (!(o instanceof THREE.Bone)) return;
        const n = o.name;
        if (/^(index|middle|ring|pinky)_0[123]_/.test(n)) {
          o.rotateX(curl * 0.85);
        } else if (/^thumb_0[123]_/.test(n)) {
          o.rotateX(thumbCurl * 0.7);
        }
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* never breaks loading */
  }
}

/** Collects rest-pose quaternions for all bones in a model. */
export function collectRestPose(root: THREE.Object3D): Map<string, THREE.Quaternion> {
  const map = new Map<string, THREE.Quaternion>();
  root.traverse((o) => {
    if (o instanceof THREE.Bone) {
      map.set(o.name, o.quaternion.clone());
    }
  });
  return map;
}

export { FINGER_PATTERNS };
