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
}

export const DEFAULT_CUSTOMIZATION: AvatarCustomization = {
  body: "male",
  skinTone: "#8d5524",
  hair: "buzzed",
  hairColor: "#1a1a1a",
  beard: false,
  eyebrows: true,
  fistsClenched: true,
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
      if (mat && "color" in mat) mat.color.copy(color);
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

  const head = characterRoot.getObjectByName("Head");
  if (!head) return;

  // Remove any existing headgear
  const prev = head.getObjectByName("__headgear");
  if (prev) head.remove(prev);
  const container = new THREE.Group();
  container.name = "__headgear";

  if (opts.hair !== "none") {
    const hairSrc = assets.hair[opts.hair];
    if (hairSrc) {
      const hair = hairSrc.clone(true);
      tintHair(hair, opts.hairColor);
      container.add(hair);
    }
  }
  if (opts.beard && assets.beard) {
    const beard = assets.beard.clone(true);
    tintHair(beard, opts.hairColor);
    container.add(beard);
  }
  const browSrc = opts.body === "female" ? assets.eyebrowsFemale : assets.eyebrows;
  if (opts.eyebrows && browSrc) {
    container.add(browSrc.clone(true));
  }

  head.add(container);
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
  // Relax arms to sides (static idle pose) — matches approved stance.
  // Done before animation so Idle_Loop (if it plays) starts from here.
  relaxArms(root);
  if (full.fistsClenched) clenchFists(root, 1.0);
}

/**
 * Rotates arms down to a relaxed at-the-sides stance.
 * Static fallback so the avatar never shows T-pose.
 */
export function relaxArms(root: THREE.Object3D): void {
  const D = Math.PI / 180;
  // Strategy 1: via SkinnedMesh skeletons (most reliable)
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
      const skinned = o as THREE.SkinnedMesh;
      for (const bone of skinned.skeleton.bones) {
        const n = (bone.name || "").toLowerCase();
        if (n.includes("upperarm") || n.includes("upper_arm")) {
          // More precise: check if it's left (contains _l or .l, not _r or .r)
          const isLeft = /[_.]l($|[^a-z])/.test(n);
          const d = isLeft ? 1 : -1;
          bone.quaternion.premultiply(
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, d), 76 * D)
          );
          bone.quaternion.premultiply(
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), d * 8 * D)
          );
          // Mark as modified
          (bone as any).__relaxed = true;
        }
      }
    }
  });
  // Strategy 2: traverse fallback for non-skinned setups
  root.traverse((o) => {
    if ((o as any).__relaxed) return;
    const n = (o.name || "").toLowerCase();
    if (n.includes("upperarm") || n.includes("upper_arm")) {
      const q = (o as THREE.Bone).quaternion;
      if (!q) return;
      const isLeft = /[_.]l($|[^a-z])/.test(n);
      const d = isLeft ? 1 : -1;
      q.premultiply(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, d), 76 * D)
      );
    }
  });
}
