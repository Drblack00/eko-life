/**
 * GLTF avatar asset loader with caching.
 * Loads CC0 base characters, hair, and animation library once, clones on demand.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";

const AVATAR_BASE = "/avatars";

export type BodyType = "male" | "female";
export type HairStyle =
  | "none"
  | "buns"
  | "long"
  | "buzzed"
  | "parted"
  | "buzzedFemale";

const HAIR_FILES: Record<Exclude<HairStyle, "none">, string> = {
  buns: "Hair_Buns.gltf",
  long: "Hair_Long.gltf",
  buzzed: "Hair_Buzzed.gltf",
  parted: "Hair_SimpleParted.gltf",
  buzzedFemale: "Hair_BuzzedFemale.gltf",
};

interface AvatarAssets {
  bodies: Record<BodyType, THREE.Group>;
  hair: Record<Exclude<HairStyle, "none">, THREE.Group>;
  beard: THREE.Group | null;
  eyebrows: THREE.Group | null;
  eyebrowsFemale: THREE.Group | null;
  animClips: THREE.AnimationClip[];
  animRest: Map<string, THREE.Quaternion>;
}

let cache: AvatarAssets | null = null;
let loadPromise: Promise<AvatarAssets> | null = null;

const loader = new GLTFLoader();

function loadGLTF(url: string): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(gltf.scene),
      undefined,
      (err) => reject(err)
    );
  });
}

function loadClips(url: string): Promise<{ clips: THREE.AnimationClip[]; rest: Map<string, THREE.Quaternion> }> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const rest = new Map<string, THREE.Quaternion>();
        gltf.scene.traverse((o) => {
          if (o instanceof THREE.Bone) rest.set(o.name, o.quaternion.clone());
        });
        resolve({ clips: gltf.animations, rest });
      },
      undefined,
      (err) => reject(err)
    );
  });
}

/** Loads all avatar assets. Safe to call multiple times — caches after first load. */
export function loadAvatarAssets(): Promise<AvatarAssets> {
  if (cache) return Promise.resolve(cache);
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const [male, female, animData] = await Promise.all([
      loadGLTF(`${AVATAR_BASE}/bodies/male.gltf`),
      loadGLTF(`${AVATAR_BASE}/bodies/female.gltf`),
      loadClips(`${AVATAR_BASE}/animations/anim-lib.gltf`),
    ]);

    const hairEntries = await Promise.all(
      (Object.keys(HAIR_FILES) as (keyof typeof HAIR_FILES)[]).map(async (key) => {
        const group = await loadGLTF(`${AVATAR_BASE}/hair/${HAIR_FILES[key]}`);
        return [key, group] as const;
      })
    );

    const [beard, eyebrows, eyebrowsFemale] = await Promise.all([
      loadGLTF(`${AVATAR_BASE}/hair/Hair_Beard.gltf`).catch(() => null),
      loadGLTF(`${AVATAR_BASE}/hair/Eyebrows_Regular.gltf`).catch(() => null),
      loadGLTF(`${AVATAR_BASE}/hair/Eyebrows_Female.gltf`).catch(() => null),
    ]);

    cache = {
      bodies: { male, female },
      hair: Object.fromEntries(hairEntries) as AvatarAssets["hair"],
      beard,
      eyebrows,
      eyebrowsFemale,
      animClips: animData.clips,
      animRest: animData.rest,
    };
    return cache;
  })();

  return loadPromise;
}

/** Returns cached assets, or null if not loaded yet. */
export function getCachedAssets(): AvatarAssets | null {
  return cache;
}

/** Deep-clones a body model for independent use. Uses SkeletonUtils.clone so the
 *  skinned mesh binds to the cloned bones (plain .clone() leaves the mesh
 *  bound to the original skeleton, so bone rotations would have no effect). */
export function cloneBody(type: BodyType): THREE.Group | null {
  const assets = getCachedAssets();
  if (!assets) return null;
  return skeletonClone(assets.bodies[type]) as THREE.Group;
}
