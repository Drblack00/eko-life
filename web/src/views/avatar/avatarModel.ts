import * as THREE from "three";
import type { AvatarLook } from "../../game/types";
import { buildMaterials, skinHex } from "./parts/materials";
import { buildBody } from "./parts/body";
import { dressBody, type OutfitId } from "./parts/clothing";
import { buildHead } from "./parts/head";
import { attachHair, buildHair } from "./parts/hair";

/**
 * Realistic procedural avatar (~1.6 units tall, root at y=0, faces +Z).
 * All geometry is original, generated at build time — no external assets.
 *
 * Module layout (parts/):
 *   materials.ts — skin map, fabric canvas textures, base material set
 *   util.ts      — mulberry32, lathe, mesh helpers
 *   body.ts      — skin body: legs, torso, arms, hands, neck (+headMount)
 *   clothing.ts  — all 5 outfits as separate garment meshes
 *   head.ts      — skull, ears, nose, lips, eyes, brows
 *   hair.ts      — 7 hairstyles
 *
 * This file keeps the public contract: buildAvatarLook overloads,
 * the idle animation rig, reduced-motion support, and disposal.
 *
 * Two call shapes (overloads):
 *   buildAvatarLook(look)            → { group, update? }   (new contract)
 *   buildAvatarLook(THREE, look)     → THREE.Group          (legacy)
 * The legacy shape returns the bare group (updater stashed on
 * `group.userData.update` when animation is enabled).
 *
 * Conventions: trousers use look.bottomColor, shirts use look.topColor
 * (canvas fabric pattern unless fabric === "plain"), skin parts use the
 * skin tone, hair is dark. group.userData.dispose() releases everything.
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

/** Joints the idle loop animates. */
interface Rig {
  upper: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  eyeL: THREE.Group;
  eyeR: THREE.Group;
  baseArmLX: number;
  baseArmRX: number;
  baseArmLZ: number;
  baseArmRZ: number;
}

const OUTFITS: OutfitId[] = ["casual", "hoodie", "office", "chill", "sitework"];

function buildInternal(T: typeof import("three"), look: AvatarLook): AvatarBuild {
  const group = new T.Group();
  const skin = skinHex(look.skin);
  const isMan = look.body === "man";
  const outfit: OutfitId = (OUTFITS as string[]).includes(look.outfit)
    ? (look.outfit as OutfitId)
    : "casual";
  const limbScale = isMan ? 1 : 0.9;

  /* ---------------- materials ---------------- */
  const mats = buildMaterials(T, look);

  /* ---------------- body → garments → head → hair ---------------- */
  const body = buildBody(T, mats, { isMan, limbScale });
  group.add(body.group);

  const { torsoMesh } = dressBody(T, mats, body, {
    outfit,
    isMan,
    limbScale,
    topColor: look.topColor,
  });

  const head = buildHead(T, { skin, mats });
  body.headMount.add(head.group);
  attachHair(head, buildHair(T, look.hair, mats));

  const rig: Rig = {
    upper: body.upper,
    torso: torsoMesh,
    head: body.headMount,
    armL: body.armL,
    armR: body.armR,
    eyeL: head.eyeL,
    eyeR: head.eyeR,
    baseArmLX: body.armL.rotation.x,
    baseArmRX: body.armR.rotation.x,
    baseArmLZ: body.armL.rotation.z,
    baseArmRZ: body.armR.rotation.z,
  };

  /* ---------------- reduced motion → static neutral pose ---------------- */
  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let update: ((t: number, dt: number) => void) | undefined;
  if (!reduced) {
    let nextBlink = 1.2 + Math.random() * 2.5;
    let blinkStart = -1;
    const BLINK_DUR = 0.16;
    const setEyeOpen = (v: number) => {
      rig.eyeL.scale.y = v;
      rig.eyeR.scale.y = v;
    };

    update = (t: number) => {
      if (blinkStart < 0 && t >= nextBlink) {
        blinkStart = t;
        nextBlink = t + 3 + Math.random() * 3;
      }
      if (blinkStart >= 0) {
        const p = (t - blinkStart) / BLINK_DUR;
        if (p >= 1) {
          blinkStart = -1;
          setEyeOpen(1);
        } else {
          const k = p < 0.5 ? p * 2 : (1 - p) * 2;
          setEyeOpen(1 - 0.92 * k);
        }
      }

      const TAU = Math.PI * 2;
      // Breathing: torso shell ±1.6%, shoulders ride gently.
      const br = Math.sin((TAU * t) / 4.4);
      rig.torso.scale.x = 1 + 0.016 * br;
      rig.torso.scale.z = 0.74 * (1 + 0.016 * br);
      // Natural arm hang: micro-sway, opposite phases, slight elbow drift.
      rig.armL.rotation.x = rig.baseArmLX + 0.038 * Math.sin((TAU * t) / 4.9);
      rig.armR.rotation.x = rig.baseArmRX + 0.038 * Math.sin((TAU * t) / 4.9 + Math.PI);
      rig.armL.rotation.z = rig.baseArmLZ + 0.018 * Math.sin((TAU * t) / 7.1);
      rig.armR.rotation.z = rig.baseArmRZ + 0.018 * Math.sin((TAU * t) / 7.1 + 1.4);
      // Head: subtle bob + occasional slow turn, slight tilt.
      rig.head.rotation.x = 0.03 * Math.sin((TAU * t) / 5.9 + 0.8);
      rig.head.rotation.y =
        0.15 * Math.sin((TAU * t) / 21 + 1.2) * (0.6 + 0.4 * Math.sin((TAU * t) / 7.7));
      rig.head.rotation.z = 0.018 * Math.sin((TAU * t) / 11.5);
      // Weight shift.
      const ws = Math.sin((TAU * t) / 8.6);
      rig.upper.rotation.z = 0.02 * ws;
      rig.upper.position.x = 0.016 * Math.sin((TAU * t) / 8.6 + 0.3);
      rig.upper.rotation.y = 0.01 * Math.sin((TAU * t) / 13.5);
    };
  }

  /* ---------------- disposal ---------------- */
  const disposables = new Set<{ dispose(): void }>();
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      if (m.geometry) disposables.add(m.geometry);
      const matsArr = Array.isArray(m.material) ? m.material : [m.material];
      for (const mm of matsArr) {
        if (!mm) continue;
        const sm = mm as THREE.MeshStandardMaterial;
        if (sm.map) disposables.add(sm.map);
        disposables.add(sm);
      }
    }
  });
  group.userData.dispose = () => {
    for (const d of disposables) d.dispose();
    disposables.clear();
  };

  return update ? { group, update } : { group };
}
