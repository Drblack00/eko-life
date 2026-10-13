/**
 * Applies appearance customization to a GLTF avatar instance:
 * body type, skin tone, hair style/color, beard, eyebrows.
 */

import * as THREE from "three";
import { getCachedAssets, type BodyType, type HairStyle } from "./loader";
import { clenchFists } from "./retarget";

export interface AvatarCustomization {
  body: BodyType;
  /** Hex skin tone, e.g. "#8d5524" */
  skinTone: string;
  hair: HairStyle;
  /** Hex hair color */
  hairColor: string;
  beard: boolean;
  eyebrows: boolean;
  /** Clench fists in idle (default true per user request) */
  fistsClenched: boolean;
  /** Height scale 0.92–1.08 (default 1.0) */
  height: number;
  /** Build/width scale 0.9–1.12 (default 1.0) */
  build: number;
}

export const DEFAULT_CUSTOMIZATION: AvatarCustomization = {
  body: "male",
  skinTone: "#8d5524",
  hair: "buzzed",
  hairColor: "#1a1a1a",
  beard: false,
  eyebrows: true,
  fistsClenched: true,
  height: 1.0,
  build: 1.0,
};

/** Preset skin tones. */
export const SKIN_TONES = [
  "#ffdbac",
  "#f1c27d",
  "#e0ac69",
  "#c68642",
  "#8d5524",
  "#5c3a21",
  "#3b2412",
];

/** Preset hair colors. */
export const HAIR_COLORS = [
  "#1a1a1a",
  "#3b2a1a",
  "#6b4a2a",
  "#a06a35",
  "#d9d9d9",
  "#8a8a8a",
];

/**
 * Tints all skin materials on the body.
 * The base bodies use vertex colors / base color textures; we multiply
 * a tint via material.color.
 */
export function applySkinTone(root: THREE.Object3D, hex: string): void {
  const color = new THREE.Color(hex);
  // Neutral multiplier: the base texture is mid-tone; tint relative to it
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      const mat = m as THREE.MeshStandardMaterial;
      if (!mat || !("color" in mat)) continue;
      // Heuristic: body meshes are the large skinned meshes; hair/eyes
      // are separate. We tint meshes whose material has the body texture.
      const mapName = (mat.map as THREE.Texture | null)?.image
        ? String((mat.map as any).image?.src ?? "")
        : "";
      // Body textures contain "Superhero" in the name
      if (
        mat.name.toLowerCase().includes("body") ||
        mat.name.toLowerCase().includes("skin") ||
        mapName.toLowerCase().includes("superhero")
      ) {
        mat.color.copy(color);
      }
    }
  });
}

/** Tints hair meshes. */
function tintHair(root: THREE.Object3D, hex: string): void {
  const color = new THREE.Color(hex);
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      const mat = m as THREE.MeshStandardMaterial;
      if (mat && "color" in mat) {
        // For hair color to show, remove the dark texture and use solid color
        // (the hair textures are dark and would mute the tint)
        if (mat.map) {
          mat.map = null;
          mat.needsUpdate = true;
        }
        mat.color.copy(color);
      }
    }
  });
}

/**
 * Attaches hair/beard/eyebrows to the head bone.
 * Hair glTFs are authored in head-bone space.
 */
export function attachHeadgear(
  characterRoot: THREE.Object3D,
  opts: { hair: HairStyle; hairColor: string; beard: boolean; eyebrows: boolean; body: BodyType }
): void {
  const assets = getCachedAssets();
  if (!assets) return;

  // Remove any existing headgear
  const prev = characterRoot.getObjectByName("__headgear");
  if (prev) characterRoot.remove(prev);
  const container = new THREE.Group();
  container.name = "__headgear";
  // Note: hair is rebound to the character skeleton, so container goes on
  // the character root (not the head bone) — the skeleton positions it.

  // Helper: get the hair/beard mesh and rebind it to the character's skeleton.
  // The hair GLTFs have skeletons with matching bone names; we rebind the
  // SkinnedMesh to the body character's skeleton so it follows the head.
  const getHeadgearMesh = (src: THREE.Object3D, characterRoot: THREE.Object3D): THREE.Object3D | null => {
    try {
      // Find the first SkinnedMesh or Mesh in the source
      let srcMesh: THREE.SkinnedMesh | THREE.Mesh | null = null;
      src.traverse((o) => {
        if (!srcMesh && ((o as THREE.SkinnedMesh).isSkinnedMesh || (o as THREE.Mesh).isMesh)) {
          srcMesh = o as THREE.SkinnedMesh;
        }
      });
      if (!srcMesh) return null;

      // Find the character's skeleton (from its SkinnedMesh)
      let charSkeleton: THREE.Skeleton | null = null;
      characterRoot.traverse((o) => {
        const sk = o as THREE.SkinnedMesh;
        if (!charSkeleton && sk.isSkinnedMesh && sk.skeleton) {
          charSkeleton = sk.skeleton;
        }
      });
      if (!charSkeleton) return null;

      const m = srcMesh as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        // Clone the mesh and rebind to character skeleton
        const cloned = new THREE.SkinnedMesh(m.geometry, m.material);
        cloned.name = m.name;
        // Bind to character skeleton — bone names match, so skinning works
        cloned.bind(charSkeleton as THREE.Skeleton);
        return cloned;
      } else {
        const mesh = srcMesh as THREE.Mesh;
        const cloned = new THREE.Mesh(mesh.geometry, mesh.material);
        cloned.name = mesh.name;
        return cloned;
      }
    } catch {
      return null;
    }
  };

  if (opts.hair !== "none") {
    const hairSrc = assets.hair[opts.hair];
    if (hairSrc) {
      const hair = getHeadgearMesh(hairSrc, characterRoot);
      if (hair) {
        tintHair(hair, opts.hairColor);
        container.add(hair);
      }
    }
  }
  if (opts.beard && assets.beard) {
    const beard = getHeadgearMesh(assets.beard, characterRoot);
    if (beard) {
      tintHair(beard, opts.hairColor);
      container.add(beard);
    }
  }
  const browSrc = opts.body === "female" ? assets.eyebrowsFemale : assets.eyebrows;
  if (opts.eyebrows && browSrc) {
    const brows = getHeadgearMesh(browSrc, characterRoot);
    if (brows) container.add(brows);
  }

  characterRoot.add(container);
}

/** Applies a full customization to a character instance. */
export function applyCustomization(
  root: THREE.Object3D,
  custom: Partial<AvatarCustomization> & { body: BodyType }
): void {
  const full: AvatarCustomization = { ...DEFAULT_CUSTOMIZATION, ...custom };
  applySkinTone(root, full.skinTone);
  attachHeadgear(root, {
    hair: full.hair,
    hairColor: full.hairColor,
    beard: full.beard,
    eyebrows: full.eyebrows,
    body: full.body,
  });
  // Apply the idle pose (arms at sides) using quaternions extracted from
  // the animation library's Idle_Loop. This is the approved idle stance.
  relaxArms(root);
  if (full.fistsClenched) clenchFists(root, 1.0);
  // Body proportions (height/build) for different player types.
  applyProportions(root, full.height, full.build);
}

/**
 * Applies height (Y scale) and build (X/Z width) proportions.
 * Height scales the whole figure; build widens torso/shoulders/hips.
 * Fully defensive — never throws.
 */
export function applyProportions(root: THREE.Object3D, height: number, build: number): void {
  try {
    const h = Math.max(0.92, Math.min(1.08, height || 1.0));
    const b = Math.max(0.9, Math.min(1.12, build || 1.0));
    // Height: uniform Y scale on the root (keeps feet grounded via loader offset)
    root.scale.y = h;
    // Build: widen torso bones on X/Z
    root.traverse((o) => {
      try {
        const n = (o.name || "").toLowerCase();
        const isTorso = n === "spine" || n === "spine001" || n === "spine002" ||
          n === "pelvis" || n === "clavicle_l" || n === "clavicle_r";
        if (!isTorso) return;
        const bone = o as THREE.Bone;
        if (!bone.scale) return;
        // Apply build as X/Z multiplier (preserve existing scale)
        const baseX = (bone as any).__baseScaleX ?? bone.scale.x;
        const baseZ = (bone as any).__baseScaleZ ?? bone.scale.z;
        (bone as any).__baseScaleX = baseX;
        (bone as any).__baseScaleZ = baseZ;
        bone.scale.x = baseX * b;
        bone.scale.z = baseZ * b;
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* never breaks loading */
  }
}

/**
 * Rotates arms down to a relaxed at-the-sides stance.
 * Static fallback so the avatar never shows T-pose.
 * Fully defensive — never throws.
 */
/**
 * Applies the idle pose by setting upperarm bones to the exact quaternions
 * extracted from the animation library's Idle_Loop first frame.
 * These are the professional idle pose values.
 * Fully defensive — never throws.
 */
export function relaxArms(root: THREE.Object3D): void {
  try {
    // Idle_Loop first-frame quaternions for upper arms (from anim-lib.gltf)
    // DEF-upper_arm.L: [-0.2865, 0.6735, -0.4958, 0.4674]
    // DEF-upper_arm.R: [-0.2942, -0.6807, 0.4693, 0.4795]
    const IDLE_L = new THREE.Quaternion(-0.2865, 0.6735, -0.4958, 0.4674);
    const IDLE_R = new THREE.Quaternion(-0.2942, -0.6807, 0.4693, 0.4795);

    root.updateMatrixWorld(true);
    const updatedSkeletons = new Set<THREE.Skeleton>();

    const applyIdle = (bone: THREE.Bone) => {
      try {
        if (!bone || !bone.quaternion) return;
        const n = (bone.name || "").toLowerCase();
        const isLeft = n === "upperarm_l";
        const isRight = n === "upperarm_r";
        if (!isLeft && !isRight) return;
        if ((bone as any).__idleApplied) return;

        // Set the local quaternion to the idle pose value.
        // The anim skeleton and base skeleton have similar T-pose rests,
        // so the local rotations transfer directly.
        bone.quaternion.copy(isLeft ? IDLE_L : IDLE_R);
        bone.updateMatrixWorld(true);
        (bone as any).__idleApplied = true;
      } catch {
        /* ignore */
      }
    };

    root.traverse((o) => {
      try {
        const skinned = o as THREE.SkinnedMesh;
        if (!skinned.isSkinnedMesh || !skinned.skeleton || !skinned.skeleton.bones) return;
        let modified = false;
        for (const bone of skinned.skeleton.bones) {
          const before = (bone as any).__idleApplied;
          applyIdle(bone);
          if ((bone as any).__idleApplied && !before) modified = true;
        }
        if (modified) updatedSkeletons.add(skinned.skeleton);
      } catch {
        /* ignore */
      }
    });

    for (const skel of updatedSkeletons) {
      try {
        skel.update();
      } catch {
        /* ignore */
      }
    }

    // Fallback traverse
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) applyIdle(o as THREE.Bone);
    });
  } catch {
    /* never breaks loading */
  }
}
