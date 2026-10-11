import type * as THREE from "three";
import { lathe, mesh } from "./util";
import type { AvatarMaterials } from "./materials";
import { buildSkinMaterial } from "./faceTextures";

/**
 * The unclothed skin body: legs, torso, arms, hands, neck.
 * Garments (shoes, legwear, shirt, sleeves, outfit extras) are added by
 * clothing.ts via dressBody(). Head geometry is added by head.ts into
 * headMount; hair by hair.ts.
 */

export const HIP_Y = 0.84;

export interface BodyCtx {
  isMan: boolean;
  limbScale: number;
}

export interface BuiltBody {
  /** Whole body: leg groups + upper group. */
  group: THREE.Group;
  /** Pivot at the hips (weight-shift animation target). */
  upper: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  /** Empty group at the neck top — head.ts fills this. */
  headMount: THREE.Group;
}

export function buildBody(
  T: typeof import("three"),
  mats: AvatarMaterials,
  ctx: BodyCtx
): BuiltBody {
  const { isMan, limbScale } = ctx;
  const group = new T.Group();
  const LY = (absY: number) => absY - HIP_Y; // abs → upper-local

  // Shared PBR skin (same tone/material family as the face in head.ts,
  // so neck, hands and legs never drift from the face tone).
  const skinHex =
    "#" + (mats.skinMat as THREE.MeshStandardMaterial).color.getHexString();
  const skin = buildSkinMaterial(T, skinHex, { roughness: 0.6, sssGlow: 0.04 });

  /* ---------------- legs (skin; relaxed neutral stance) ---------------- */
  const legX = 0.098;
  const legProfile: Array<[number, number]> = [
    [0.078, 0.03],
    [0.084, -0.06],
    [0.072, -0.18],
    [0.06, -0.3],
    [0.062, -0.37],
    [0.052, -0.43],
    [0.056, -0.53],
    [0.044, -0.63],
    [0.034, -0.71],
    [0.031, -0.74],
  ].map(([r, y]) => [r * (isMan ? 1 : 0.92), y] as [number, number]);

  const legs: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const legG = new T.Group();
    legG.position.set(sx * legX, HIP_Y, 0);
    legG.add(lathe(T, legProfile, skin, 14));
    // Weight-shifted neutral stance: one foot slightly forward, the other
    // back — relaxed, not parade-ground. Clothing rides on the same group.
    legG.position.z = sx < 0 ? 0.02 : -0.02;
    group.add(legG);
    legs.push(legG);
  }

  /* ---------------- upper body (weight-shift pivot at the hips) ---------------- */
  const upper = new T.Group();
  upper.position.set(0, HIP_Y, 0);
  group.add(upper);

  // Skin torso underneath (visible at neck/arms).
  const torsoSkinProfile: Array<[number, number]> = (
    isMan
      ? [
          [0.148, 0.86],
          [0.152, 0.98],
          [0.162, 1.1],
          [0.152, 1.2],
          [0.118, 1.29],
          [0.058, 1.33],
        ]
      : [
          [0.15, 0.86],
          [0.142, 0.96],
          [0.156, 1.06],
          [0.16, 1.12],
          [0.142, 1.2],
          [0.11, 1.29],
          [0.054, 1.33],
        ]
  ).map(([r, y]) => [r, LY(y)] as [number, number]);
  const torsoSkin = lathe(T, torsoSkinProfile, skin, 18);
  torsoSkin.scale.z = 0.74;
  upper.add(torsoSkin);

  /* ---------------- arms + hands (pivot at shoulder) ---------------- */
  const armX = isMan ? 0.205 : 0.188;
  const armProfile: Array<[number, number]> = [
    [0.058, 0.03],
    [0.052, -0.08],
    [0.046, -0.18],
    [0.042, -0.25],
    [0.037, -0.33],
    [0.03, -0.42],
    [0.028, -0.45],
  ].map(([r, y]) => [r * limbScale, y] as [number, number]);

  /** One finger: proximal + distal segments with a natural slight curl. */
  const buildFinger = (i: number, hand: THREE.Group): void => {
    const fx = (i - 1.5) * 0.0205 * limbScale;
    const curl = 0.32 + i * 0.04; // index straighter, pinky curls more
    const prox = mesh(
      T,
      new T.CylinderGeometry(0.0092 * limbScale, 0.0084 * limbScale, 0.042, 7),
      skin,
      fx,
      -0.095,
      0.008
    );
    prox.rotation.x = curl * 0.55;
    hand.add(prox);
    // Knuckle hint.
    const knuckle = mesh(
      T,
      new T.SphereGeometry(0.0095 * limbScale, 6, 5),
      skin,
      fx,
      -0.115,
      0.008 + Math.sin(curl * 0.55) * 0.021
    );
    hand.add(knuckle);
    const dist = mesh(
      T,
      new T.CylinderGeometry(0.0082 * limbScale, 0.0068 * limbScale, 0.036, 7),
      skin,
      fx,
      -0.115 - Math.cos(curl * 0.55) * 0.018,
      0.008 + Math.sin(curl * 0.55) * 0.021 + Math.sin(curl) * 0.018
    );
    dist.rotation.x = curl;
    hand.add(dist);
  };

  const buildArm = (sx: number) => {
    const arm = new T.Group();
    arm.position.set(sx * armX, LY(1.3), 0);
    arm.add(lathe(T, armProfile, skin, 12));
    // Hand: palm + segmented fingers + two-segment thumb.
    const hand = new T.Group();
    hand.position.set(0, -0.46, 0.004);
    const palm = mesh(T, new T.SphereGeometry(0.048, 12, 10), skin, 0, -0.032, 0);
    palm.scale.set(0.85 * limbScale, 1.2, 0.5);
    hand.add(palm);
    // Thenar (thumb-base) mound so the palm isn't a flat disc.
    const thenar = mesh(T, new T.SphereGeometry(0.02, 8, 6), skin, -sx * 0.028 * limbScale, -0.045, 0.012);
    thenar.scale.set(0.9, 1.3, 0.6);
    hand.add(thenar);
    for (let i = 0; i < 4; i++) buildFinger(i, hand);
    const thumbBase = mesh(
      T,
      new T.CylinderGeometry(0.0098 * limbScale, 0.0088 * limbScale, 0.034, 7),
      skin,
      -sx * 0.042 * limbScale,
      -0.035,
      0.016
    );
    thumbBase.rotation.z = sx * 0.65;
    thumbBase.rotation.x = 0.35;
    hand.add(thumbBase);
    const thumbTip = mesh(
      T,
      new T.CylinderGeometry(0.0086 * limbScale, 0.0072 * limbScale, 0.03, 7),
      skin,
      -sx * 0.055 * limbScale,
      -0.045,
      0.028
    );
    thumbTip.rotation.z = sx * 0.45;
    thumbTip.rotation.x = 0.55;
    hand.add(thumbTip);
    arm.add(hand);

    // Relaxed asymmetric hang (the idle loop adds micro-sway on top).
    arm.rotation.x = sx < 0 ? 0.055 : 0.03;
    arm.rotation.z = sx * (sx < 0 ? 0.075 : 0.05);
    upper.add(arm);
    return arm;
  };
  const armL = buildArm(-1);
  const armR = buildArm(1);

  // Neck: shorter than before, widening into the trapezius so the head
  // grows out of the shoulders instead of perching on a stalk.
  upper.add(
    mesh(T, new T.CylinderGeometry(0.05, 0.058, 0.085, 14), skin, 0, LY(1.345), 0)
  );
  // Trapezius slope: neck → shoulders.
  const traps = mesh(T, new T.SphereGeometry(0.082, 14, 10), skin, 0, LY(1.295), -0.008);
  traps.scale.set(isMan ? 1.95 : 1.7, 0.52, 0.95);
  upper.add(traps);

  // Head mount: empty group at the neck top; head.ts fills it.
  const headMount = new T.Group();
  headMount.position.set(0, LY(1.4), 0);
  upper.add(headMount);

  return { group, upper, legL: legs[0], legR: legs[1], armL, armR, headMount };
}
