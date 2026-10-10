import type * as THREE from "three";
import { lathe, mesh } from "./util";
import type { AvatarMaterials } from "./materials";

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

  /* ---------------- legs (skin; feet planted, static) ---------------- */
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
    legG.add(lathe(T, legProfile, mats.skinMat, 14));
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
  const torsoSkin = lathe(T, torsoSkinProfile, mats.skinMat, 18);
  torsoSkin.scale.z = 0.74;
  upper.add(torsoSkin);

  /* ---------------- arms + hands (pivot at shoulder) ---------------- */
  const armX = isMan ? 0.2 : 0.186;
  const armProfile: Array<[number, number]> = [
    [0.056, 0.03],
    [0.05, -0.08],
    [0.044, -0.18],
    [0.04, -0.25],
    [0.036, -0.33],
    [0.029, -0.42],
    [0.027, -0.45],
  ].map(([r, y]) => [r * limbScale, y] as [number, number]);

  const buildArm = (sx: number) => {
    const arm = new T.Group();
    arm.position.set(sx * armX, LY(1.3), 0);
    arm.add(lathe(T, armProfile, mats.skinMat, 12));
    // Hand: palm + separated fingers + thumb.
    const hand = new T.Group();
    hand.position.set(0, -0.46, 0.004);
    const palm = mesh(T, new T.SphereGeometry(0.048, 12, 10), mats.skinMat, 0, -0.032, 0);
    palm.scale.set(0.85 * limbScale, 1.2, 0.5);
    hand.add(palm);
    for (let i = 0; i < 4; i++) {
      const f = mesh(T,
        new T.CylinderGeometry(0.009 * limbScale, 0.008 * limbScale, 0.055, 8),
        mats.skinMat,
        (i - 1.5) * 0.0205 * limbScale,
        -0.1,
        0.008
      );
      f.rotation.x = 0.28;
      hand.add(f);
    }
    const thumb = mesh(T,
      new T.CylinderGeometry(0.0095 * limbScale, 0.008 * limbScale, 0.045, 8),
      mats.skinMat,
      -sx * 0.04 * limbScale,
      -0.032,
      0.014
    );
    thumb.rotation.z = sx * 0.6;
    thumb.rotation.x = 0.3;
    hand.add(thumb);
    arm.add(hand);

    arm.rotation.x = 0.04;
    arm.rotation.z = sx * 0.06;
    upper.add(arm);
    return arm;
  };
  const armL = buildArm(-1);
  const armR = buildArm(1);

  // Neck.
  upper.add(
    mesh(T, new T.CylinderGeometry(0.048, 0.056, 0.1, 14), mats.skinMat, 0, LY(1.35), 0)
  );

  // Head mount: empty group at the neck top; head.ts fills it.
  const headMount = new T.Group();
  headMount.position.set(0, LY(1.4), 0);
  upper.add(headMount);

  return { group, upper, legL: legs[0], legR: legs[1], armL, armR, headMount };
}
