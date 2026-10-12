import type * as THREE from "three";
import { lathe, mesh } from "./util";
import { shade, type AvatarMaterials } from "./materials";
import { HIP_Y, type BuiltBody } from "./body";
import {
  ribKnitTextures,
  weaveTexture,
  stitchTexture,
  treadTexture,
} from "./garmentTextures";

/**
 * Detailed garments for the 5 outfits (workstream 2: hair & clothing).
 * 100% original procedural code — geometry + runtime-painted canvas
 * textures (garmentTextures.ts), no external assets.
 *
 * Dresses a BuiltBody in place; returns animation-relevant handles.
 * torsoMesh MUST stay the single shirt mesh — the idle loop breathes by
 * scaling it ±1.6% on x/z (see avatarModel.ts).
 */

export type OutfitId =
  | "casual"
  | "hoodie"
  | "office"
  | "chill"
  | "sitework"
  | "gym"
  | "agbada"
  | "owambe";

export interface GarmentCtx {
  outfit: OutfitId;
  isMan: boolean;
  limbScale: number;
  topColor: string;
}

export interface DressedBody {
  /** Shirt mesh — the breathing animation target. */
  torsoMesh: THREE.Mesh;
}

/* ------------------------------------------------------------------ */
/* Pure proportion helpers (unit-testable).                            */
/* ------------------------------------------------------------------ */

/** Shirt lathe profile [radius, absY]; looseness scales the radii. */
export function shirtProfile(
  isMan: boolean,
  looseness = 1
): Array<[number, number]> {
  const base: Array<[number, number]> = isMan
    ? [
        [0.17, 0.78],
        [0.162, 0.94],
        [0.168, 1.06],
        [0.178, 1.16],
        [0.164, 1.25],
        [0.122, 1.31],
        [0.066, 1.345],
      ]
    : [
        [0.174, 0.78],
        [0.156, 0.94],
        [0.164, 1.04],
        [0.172, 1.12],
        [0.154, 1.22],
        [0.114, 1.3],
        [0.06, 1.34],
      ];
  return base.map(([r, y]) => [r * looseness, y]);
}

/** Trouser leg shell profile [radius, legLocalY] (hip 0 → ankle -0.74).
 *  Points run in ASCENDING y — LatheGeometry needs that order for
 *  outward-facing normals. */
export function trouserProfile(shorts: boolean): Array<[number, number]> {
  const pts: Array<[number, number]> = shorts
    ? [
        [0.098, 0.02],
        [0.093, -0.13],
        [0.088, -0.28],
      ]
    : [
        [0.078, 0.02],
        [0.072, -0.18],
        [0.06, -0.34],
        [0.054, -0.5],
        [0.05, -0.66],
        [0.052, -0.72],
      ];
  return pts.reverse();
}

/** Evenly spaced Y positions for placket buttons. */
export function buttonYs(
  count: number,
  topY: number,
  bottomY: number
): number[] {
  const ys: number[] = [];
  for (let i = 0; i < count; i++) {
    ys.push(topY - (i / Math.max(1, count - 1)) * (topY - bottomY));
  }
  return ys;
}

/** Y positions for boot lace rows. */
export function laceRowYs(
  rows: number,
  topY: number,
  spacing: number
): number[] {
  const ys: number[] = [];
  for (let i = 0; i < rows; i++) ys.push(topY - i * spacing);
  return ys;
}

/* ------------------------------------------------------------------ */
/* Per-call material set                                              */
/* ------------------------------------------------------------------ */

interface GarmentMats {
  /** Ribbed knit tinted topColor (collars, cuffs, waistbands). */
  rib: THREE.Material;
  /** Ribbed knit tinted bottomColor. */
  ribBottom: THREE.Material;
  /** Shirt fabric + woven bump relief (keeps ankara/adire/asooke map). */
  weave: THREE.Material;
  /** Darkened shirt for fold shadows. */
  fold: THREE.Material;
  /** Darkened trouser for fold shadows on legwear. */
  foldBottom: THREE.Material;
  /** Thread stitch strips (transparent). */
  stitch: THREE.Material;
  /** Sole rubber + tread bump. */
  sole: THREE.Material;
}

function std(mat: THREE.Material) {
  return mat as THREE.MeshStandardMaterial;
}

function buildGarmentMats(
  T: typeof import("three"),
  mats: AvatarMaterials,
  topColor: string
): GarmentMats {
  const ribTop = ribKnitTextures(T, topColor);
  const bottomHex = "#" + std(mats.bottomMat).color.getHexString();
  const ribBottom = ribKnitTextures(T, bottomHex);
  const weaveTex = weaveTexture(T);
  const stitchTex = stitchTexture(T);
  const treadTex = treadTexture(T);
  const shirtStd = std(mats.shirtMat);
  const rib = new T.MeshStandardMaterial({
    color: "#ffffff",
    map: ribTop.map ?? undefined,
    bumpMap: ribTop.bump ?? undefined,
    bumpScale: 0.6,
    roughness: 0.92,
  });
  const ribB = new T.MeshStandardMaterial({
    color: "#ffffff",
    map: ribBottom.map ?? undefined,
    bumpMap: ribBottom.bump ?? undefined,
    bumpScale: 0.6,
    roughness: 0.92,
  });
  const weave = new T.MeshStandardMaterial({
    color: shirtStd.color.clone(),
    map: shirtStd.map ?? undefined,
    bumpMap: weaveTex ?? undefined,
    bumpScale: 0.3,
    roughness: shirtStd.roughness,
  });
  const fold = new T.MeshStandardMaterial({
    color: new T.Color(shirtStd.color).multiplyScalar(0.82),
    map: shirtStd.map ?? undefined,
    roughness: 0.9,
  });
  const bottomStd = std(mats.bottomMat);
  const foldBottom = new T.MeshStandardMaterial({
    color: new T.Color(bottomStd.color).multiplyScalar(0.78),
    roughness: 0.9,
  });
  const stitch = new T.MeshStandardMaterial({
    color: "#ffffff",
    map: stitchTex ?? undefined,
    transparent: true,
    roughness: 0.8,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const soleStd = std(mats.soleMat);
  const sole = new T.MeshStandardMaterial({
    color: soleStd.color.clone(),
    bumpMap: treadTex ?? undefined,
    bumpScale: 0.5,
    roughness: 0.95,
  });
  return { rib, ribBottom: ribB, weave, fold, foldBottom, stitch, sole };
}

/* ------------------------------------------------------------------ */
/* Small part builders                                                */
/* ------------------------------------------------------------------ */

/** Short arc of fabric — fold/wrinkle detail at joints. */
function foldArc(
  T: typeof import("three"),
  mat: THREE.Material,
  R: number,
  tube: number,
  x: number,
  y: number,
  z: number,
  rotX = 0,
  rotZ = 0
): THREE.Mesh {
  const m = new T.Mesh(
    new T.TorusGeometry(R, tube, 6, 12, Math.PI * 0.85),
    mat
  );
  m.position.set(x, y, z);
  m.rotation.x = rotX;
  m.rotation.z = rotZ;
  return m;
}

/** Transparent stitch strip (fly, pocket welts, kangaroo opening). */
function stitchStrip(
  T: typeof import("three"),
  gm: GarmentMats,
  w: number,
  h: number,
  x: number,
  y: number,
  z: number
): THREE.Mesh {
  const m = new T.Mesh(new T.PlaneGeometry(w, h), gm.stitch);
  m.position.set(x, y, z);
  return m;
}

/* ------------------------------------------------------------------ */
/* Footwear: sneakers / office oxfords / sitework boots               */
/* ------------------------------------------------------------------ */

/** M8: leather sandals — flat sole, thong + ankle straps. */
function buildSandal(
  T: typeof import("three"),
  _mats: AvatarMaterials,
  gm: GarmentMats
): THREE.Group {
  const g = new T.Group();
  const leather = new T.MeshStandardMaterial({
    color: "#5b3a21",
    roughness: 0.7,
    metalness: 0.05,
  });
  // Flat sole.
  g.add(
    mesh(T, new T.BoxGeometry(0.105, 0.022, 0.27), gm.sole, 0, -0.734, 0.035)
  );
  // Footbed.
  g.add(
    mesh(T, new T.BoxGeometry(0.095, 0.012, 0.25), leather, 0, -0.717, 0.035)
  );
  // Thong: toe post + two straps to the sides.
  g.add(
    mesh(T, new T.CylinderGeometry(0.006, 0.006, 0.05, 6), leather, 0, -0.69, 0.13)
  );
  for (const sx of [-1, 1]) {
    const strap = mesh(
      T,
      new T.BoxGeometry(0.055, 0.008, 0.014),
      leather,
      sx * 0.028,
      -0.678,
      0.115
    );
    strap.rotation.z = sx * 0.5;
    strap.rotation.y = sx * -0.25;
    g.add(strap);
    // Ankle strap.
    const ankle = mesh(
      T,
      new T.TorusGeometry(0.048, 0.006, 6, 18, Math.PI * 1.2),
      leather,
      0,
      -0.66,
      -0.02
    );
    ankle.rotation.x = Math.PI / 2;
    ankle.rotation.z = Math.PI * 0.9 + (sx > 0 ? 0 : Math.PI);
    if (sx < 0) g.add(ankle);
  }
  return g;
}

/** M8: block heels — raised heel, platform sole, ankle strap. */
function buildHeel(
  T: typeof import("three"),
  _mats: AvatarMaterials,
  gm: GarmentMats
): THREE.Group {
  const g = new T.Group();
  const upperMat = new T.MeshStandardMaterial({
    color: "#7c2d12",
    roughness: 0.5,
    metalness: 0.08,
  });
  // Platform sole sloping up to the heel.
  const sole = mesh(
    T,
    new T.BoxGeometry(0.095, 0.02, 0.24),
    gm.sole,
    0,
    -0.72,
    0.03
  );
  sole.rotation.x = 0.1;
  g.add(sole);
  // Block heel.
  g.add(
    mesh(T, new T.BoxGeometry(0.055, 0.09, 0.06), upperMat, 0, -0.70, -0.075)
  );
  // Toe strap.
  const toe = mesh(
    T,
    new T.BoxGeometry(0.085, 0.014, 0.05),
    upperMat,
    0,
    -0.685,
    0.1
  );
  toe.rotation.x = 0.1;
  g.add(toe);
  // Ankle strap.
  const strap = mesh(
    T,
    new T.TorusGeometry(0.047, 0.006, 6, 18, Math.PI * 1.3),
    upperMat,
    0,
    -0.63,
    -0.015
  );
  strap.rotation.x = Math.PI / 2;
  strap.rotation.z = Math.PI * 0.85;
  g.add(strap);
  // Foot upper (the foot itself is bare skin — a slim vamp covers the toes).
  const vamp = mesh(
    T,
    new T.SphereGeometry(0.048, 12, 10),
    upperMat,
    0,
    -0.69,
    0.055
  );
  vamp.scale.set(0.9, 0.45, 1.3);
  g.add(vamp);
  return g;
}

function buildFootwear(
  T: typeof import("three"),
  mats: AvatarMaterials,
  gm: GarmentMats,
  kind: "sneaker" | "oxford" | "boot" | "sandal" | "heel",
  twoTone?: string
): THREE.Group {
  // M8: open footwear gets its own builders (no closed upper).
  if (kind === "sandal") return buildSandal(T, mats, gm);
  if (kind === "heel") return buildHeel(T, mats, gm);
  const g = new T.Group();
  const isBoot = kind === "boot";
  const isOxford = kind === "oxford";
  // Two-tone fashion sneaker (hoodie outfit): colour-blocked upper in the
  // outfit's top colour with white panels, laces and sole.
  const accent = twoTone && !isBoot && !isOxford
    ? new T.MeshStandardMaterial({ color: twoTone, roughness: 0.65 })
    : null;
  const panelWhite = accent
    ? new T.MeshStandardMaterial({ color: "#eef1f4", roughness: 0.55 })
    : null;
  const upperMat = accent ?? mats.shoeMat;
  const toeMat = panelWhite ?? mats.shoeMat;
  const laceMat = panelWhite ?? (isOxford ? mats.shoeMat : mats.accentMat);
  const soleMat = panelWhite ?? gm.sole;

  // Sole with tread.
  const soleW = isBoot ? 0.115 : 0.105;
  const soleH = isBoot ? 0.045 : 0.03;
  g.add(
    mesh(
      T,
      new T.BoxGeometry(soleW, soleH, isBoot ? 0.27 : 0.26),
      soleMat,
      0,
      -0.745 + soleH / 2,
      0.035
    )
  );
  if (accent) {
    // Turquoise midsole stripe between the white sole and the upper.
    g.add(
      mesh(
        T,
        new T.BoxGeometry(soleW + 0.004, 0.009, 0.264),
        accent,
        0,
        -0.745 + soleH + 0.0045,
        0.035
      )
    );
  }
  // Heel block.
  g.add(
    mesh(
      T,
      new T.BoxGeometry(soleW * 0.92, isBoot ? 0.05 : 0.032, 0.09),
      gm.sole,
      0,
      -0.745 + (isBoot ? 0.055 : 0.036),
      -0.075
    )
  );
  // Upper body.
  const upper = mesh(
    T,
    new T.SphereGeometry(0.075, 14, 12),
    upperMat,
    0,
    -0.7,
    0.02
  );
  upper.scale.set(isOxford ? 0.68 : 0.72, isOxford ? 0.5 : 0.55, isOxford ? 1.55 : 1.6);
  g.add(upper);
  // Toe cap.
  const toe = mesh(
    T,
    new T.SphereGeometry(0.05, 12, 10),
    toeMat,
    0,
    -0.702,
    0.125
  );
  toe.scale.set(0.85, 0.62, 1);
  g.add(toe);
  if (panelWhite) {
    // Side panel overlays (paneling read on the two-tone sneaker).
    for (const sx of [-1, 1]) {
      const panel = mesh(
        T,
        new T.BoxGeometry(0.014, 0.052, 0.15),
        panelWhite,
        sx * 0.05,
        -0.7,
        0.03
      );
      panel.rotation.y = sx * -0.12;
      panel.rotation.z = sx * 0.06;
      g.add(panel);
      // Heel counter.
      const heel = mesh(
        T,
        new T.BoxGeometry(0.07, 0.055, 0.02),
        panelWhite,
        0,
        -0.7,
        -0.088
      );
      g.add(heel);
    }
  }

  if (isBoot) {
    // Shaft up the calf.
    g.add(
      mesh(
        T,
        new T.CylinderGeometry(0.052, 0.06, 0.17, 14),
        mats.shoeMat,
        0,
        -0.635,
        -0.008
      )
    );
    // Padded collar rim.
    const rim = mesh(
      T,
      new T.TorusGeometry(0.054, 0.012, 8, 16),
      mats.shoeMat,
      0,
      -0.55,
      -0.008
    );
    rim.rotation.x = Math.PI / 2;
    g.add(rim);
    // Lace rows up the front.
    for (const ly of laceRowYs(5, -0.62, 0.032)) {
      const lace = mesh(
        T,
        new T.CylinderGeometry(0.0042, 0.0042, 0.075, 6),
        mats.accentMat,
        0,
        ly,
        0.052 + (ly + 0.7) * 0.12
      );
      lace.rotation.z = Math.PI / 2;
      lace.rotation.y = 0.12;
      g.add(lace);
    }
    // Tongue.
    g.add(
      mesh(T, new T.BoxGeometry(0.055, 0.14, 0.018), mats.shoeMat, 0, -0.63, 0.045)
    );
  } else {
    // Ankle collar.
    g.add(
      mesh(
        T,
        new T.CylinderGeometry(0.045, 0.052, isOxford ? 0.05 : 0.07, 12),
        upperMat,
        0,
        -0.72 + (isOxford ? 0.045 : 0.055),
        -0.01
      )
    );
    // Tongue + lace crosses.
    g.add(
      mesh(T, new T.BoxGeometry(0.05, 0.09, 0.016), toeMat, 0, -0.66, 0.055)
    );
    const rows = isOxford ? 3 : 4;
    for (let i = 0; i < rows; i++) {
      const lace = mesh(
        T,
        new T.CylinderGeometry(0.0038, 0.0038, 0.062, 6),
        laceMat,
        0,
        -0.635 - i * 0.026,
        0.062 + i * 0.004
      );
      lace.rotation.z = Math.PI / 2 + (i % 2 === 0 ? 0.18 : -0.18);
      g.add(lace);
    }
  }
  g.position.set(0, 0, 0.02);
  return g;
}

/* ------------------------------------------------------------------ */
/* Legwear                                                            */
/* ------------------------------------------------------------------ */

function dressLegs(
  T: typeof import("three"),
  mats: AvatarMaterials,
  gm: GarmentMats,
  body: BuiltBody,
  ctx: GarmentCtx
): void {
  const { outfit, limbScale, topColor } = ctx;
  const shorts = outfit === "chill" || outfit === "gym";
  const cargo = outfit === "sitework" || outfit === "hoodie";
  const office = outfit === "office";
  const skirt = outfit === "owambe";
  const footwearKind =
    outfit === "sitework"
      ? "boot"
      : office
        ? "oxford"
        : outfit === "agbada"
          ? "sandal"
          : outfit === "owambe"
            ? "heel"
            : "sneaker";
  const bottomStd = std(mats.bottomMat);
  const creaseMat = new T.MeshStandardMaterial({
    color: "#" + bottomStd.color.clone().offsetHSL(0, 0, 0.08).getHexString(),
    roughness: 0.85,
  });

  for (const legG of [body.legL, body.legR]) {
    legG.add(
      buildFootwear(
        T,
        mats,
        gm,
        footwearKind,
        outfit === "hoodie" ? topColor : undefined
      )
    );

    // Leg shell — skipped for the skirt outfit (bare legs under the skirt).
    if (!skirt) {
      const prof = trouserProfile(shorts).map(
        ([r, y]) => [r * limbScale, y] as [number, number]
      );
      const shell = lathe(T, prof, mats.bottomMat, 14);
      shell.scale.z = 0.94;
      legG.add(shell);
    }

    if (skirt) {
      // Bare legs — nothing else on the leg (the skirt hangs from the hips).
    } else if (shorts) {
      // Shorts hem band.
      const hem = mesh(
        T,
        new T.CylinderGeometry(0.09 * limbScale, 0.09 * limbScale, 0.035, 14),
        gm.ribBottom,
        0,
        -0.285,
        0
      );
      hem.scale.z = 0.94;
      legG.add(hem);
    } else {
      // Ankle cuff.
      legG.add(
        mesh(
          T,
          new T.CylinderGeometry(0.054 * limbScale, 0.054 * limbScale, 0.05, 14),
          gm.ribBottom,
          0,
          -0.715,
          0
        )
      );
      // Knee fold wrinkles (trouser-toned): arcs hugging the leg front.
      legG.add(foldArc(T, gm.foldBottom, 0.056, 0.0045, 0, -0.44, 0, Math.PI / 2 - 0.12, 0));
      legG.add(foldArc(T, gm.foldBottom, 0.054, 0.0045, 0, -0.5, 0, Math.PI / 2 - 0.12, 0));
      if (office) {
        // Pressed front crease.
        legG.add(
          mesh(
            T,
            new T.BoxGeometry(0.009, 0.58, 0.005),
            creaseMat,
            0,
            -0.38,
            0.068 * limbScale
          )
        );
      }
      if (cargo) {
        // Cargo thigh pocket + flap + button.
        const sx = legG.position.x > 0 ? 1 : -1;
        legG.add(
          mesh(
            T,
            new T.BoxGeometry(0.095, 0.11, 0.045),
            mats.bottomMat,
            sx * 0.055,
            -0.32,
            0.045
          )
        );
        legG.add(
          mesh(
            T,
            new T.BoxGeometry(0.1, 0.035, 0.05),
            mats.bottomMat,
            sx * 0.055,
            -0.262,
            0.045
          )
        );
        legG.add(
          mesh(
            T,
            new T.CylinderGeometry(0.009, 0.009, 0.008, 8),
            mats.accentMat,
            sx * 0.055,
            -0.28,
            0.072
          )
        );
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Hips                                                               */
/* ------------------------------------------------------------------ */

function dressHips(
  T: typeof import("three"),
  mats: AvatarMaterials,
  gm: GarmentMats,
  body: BuiltBody,
  ctx: GarmentCtx
): void {
  const { outfit, isMan } = ctx;
  const LY = (absY: number) => absY - HIP_Y;
  const shorts = outfit === "chill" || outfit === "gym";

  // M8: wrapper skirt (owambe) replaces the whole hip assembly.
  if (outfit === "owambe") {
    dressSkirt(T, mats, gm, body, ctx);
    return;
  }

  // Hip shell (trousers top). Kept compact and tucked behind the
  // shirt/waistband so its edge never peeks out below the hem.
  const hipShell = mesh(
    T,
    new T.SphereGeometry(0.15, 18, 14),
    mats.bottomMat,
    0,
    LY(0.93),
    0
  );
  hipShell.scale.set(isMan ? 1.0 : 1.06, 0.6, 0.78);
  body.upper.add(hipShell);

  if (shorts) {
    // Drawstring waistband.
    const wb = mesh(
      T,
      new T.TorusGeometry(0.155, 0.02, 10, 24),
      gm.ribBottom,
      0,
      LY(0.945),
      0
    );
    wb.rotation.x = Math.PI / 2;
    wb.scale.set(1.02, 0.82, 1);
    body.upper.add(wb);
    for (const sx of [-1, 1]) {
      const ds = mesh(
        T,
        new T.CylinderGeometry(0.005, 0.005, 0.09, 6),
        mats.accentMat,
        sx * 0.03,
        LY(0.9),
        0.128
      );
      ds.rotation.x = 0.12;
      body.upper.add(ds);
      body.upper.add(
        mesh(
          T,
          new T.CylinderGeometry(0.007, 0.007, 0.02, 6),
          mats.accentMat,
          sx * 0.03,
          LY(0.852),
          0.134
        )
      );
    }
    // Side pocket slits.
    for (const sx of [-1, 1]) {
      body.upper.add(
        stitchStrip(T, gm, 0.012, 0.07, sx * 0.148, LY(0.88), 0.055)
      );
    }
    return;
  }

  // Waistband + belt loops (all long-trouser outfits).
  const wb = mesh(
    T,
    new T.CylinderGeometry(0.16, 0.164, 0.055, 20),
    gm.ribBottom,
    0,
    LY(0.945),
    0
  );
  wb.scale.z = 0.82;
  body.upper.add(wb);
  if (outfit === "office" || outfit === "casual") {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      body.upper.add(
        mesh(
          T,
          new T.BoxGeometry(0.018, 0.06, 0.012),
          mats.bottomMat,
          Math.sin(a) * 0.158,
          LY(0.945),
          Math.cos(a) * 0.132
        )
      );
    }
  }
  // Fly: flap + stitching.
  body.upper.add(
    mesh(T, new T.BoxGeometry(0.035, 0.11, 0.012), mats.bottomMat, 0.018, LY(0.875), 0.128)
  );
  const fly = stitchStrip(T, gm, 0.014, 0.1, 0.036, LY(0.875), 0.135);
  body.upper.add(fly);
  // Front pocket welts + stitching.
  for (const sx of [-1, 1]) {
    const welt = mesh(
      T,
      new T.BoxGeometry(0.075, 0.014, 0.01),
      mats.bottomMat,
      sx * 0.095,
      LY(0.915),
      0.115
    );
    welt.rotation.z = sx * -0.35;
    body.upper.add(welt);
    const st = stitchStrip(T, gm, 0.07, 0.012, sx * 0.095, LY(0.908), 0.121);
    st.rotation.z = sx * -0.35;
    body.upper.add(st);
  }
}

/* ------------------------------------------------------------------ */
/* Shirts                                                             */
/* ------------------------------------------------------------------ */

/** M8: wrapper skirt — flared lathe from waist to knee + tie sash. */
function dressSkirt(
  T: typeof import("three"),
  _mats: AvatarMaterials,
  gm: GarmentMats,
  body: BuiltBody,
  ctx: GarmentCtx
): void {
  const { limbScale } = ctx;
  const LY = (absY: number) => absY - HIP_Y;
  // Flared skirt: waist radius → knee flare, in ascending y for lathe normals.
  const prof: Array<[number, number]> = [
    [0.205 * limbScale, LY(0.42)],
    [0.185 * limbScale, LY(0.55)],
    [0.168 * limbScale, LY(0.7)],
    [0.158 * limbScale, LY(0.82)],
    [0.155 * limbScale, LY(0.9)],
    [0.158 * limbScale, LY(0.95)],
  ];
  const skirt = lathe(T, prof, gm.weave, 22);
  skirt.scale.z = 0.86;
  body.upper.add(skirt);
  // Waistband + tie sash at the side.
  const wb = mesh(
    T,
    new T.CylinderGeometry(0.158 * limbScale, 0.162 * limbScale, 0.05, 20),
    gm.ribBottom,
    0,
    LY(0.93),
    0
  );
  wb.scale.z = 0.86;
  body.upper.add(wb);
  const sash = mesh(
    T,
    new T.BoxGeometry(0.03, 0.09, 0.02),
    gm.ribBottom,
    0.15 * limbScale,
    LY(0.86),
    0.1
  );
  sash.rotation.z = 0.5;
  body.upper.add(sash);
  // Hem pleat folds.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    body.upper.add(
      foldArc(
        T,
        gm.foldBottom,
        0.2 * limbScale,
        0.006,
        Math.sin(a) * 0.19 * limbScale,
        LY(0.5),
        Math.cos(a) * 0.165 * limbScale,
        0.5,
        a
      )
    );
  }
}

function buildShirt(
  T: typeof import("three"),
  gm: GarmentMats,
  ctx: GarmentCtx
): THREE.Mesh {
  const { outfit, isMan } = ctx;
  const LY = (absY: number) => absY - HIP_Y;
  // M8: gym/agbada/owambe get their own silhouettes.
  let looseness =
    outfit === "chill" ? 1.12 : outfit === "hoodie" ? 1.06 : 1;
  let profile = shirtProfile(isMan, looseness);
  if (outfit === "gym") {
    // Tank: narrow shoulders, cropped at the waist.
    profile = profile.map(([r, y]) =>
      y > 1.2 ? [r * 0.78, y] : [r, y]
    );
    profile = profile.filter(([, y]) => y >= 0.82);
    profile.unshift([0.168, 0.82]);
  } else if (outfit === "agbada") {
    // Flowing grand boubou: very loose, falls past the hips.
    looseness = 1.42;
    profile = shirtProfile(isMan, looseness);
    profile.unshift([0.21, 0.64], [0.2, 0.7]);
  } else if (outfit === "owambe") {
    // Fitted dress bodice: close cut, flares slightly into the skirt.
    profile = shirtProfile(isMan, 0.96).map(([r, y]) =>
      y < 0.95 ? [r * 1.12, y] : [r, y]
    );
    profile = profile.filter(([, y]) => y >= 0.9);
    profile.unshift([0.175, 0.9]);
  }
  const pts = profile.map(([r, y]) => [r, LY(y)] as [number, number]);
  const shirt = lathe(T, pts, gm.weave, 20);
  shirt.scale.z = 0.74;
  return shirt;
}

/** Ribbed crew collar + hem band + waist fold wrinkles. */
function dressTeeTrim(
  T: typeof import("three"),
  gm: GarmentMats,
  upper: THREE.Group,
  looseness: number
): void {
  const LY = (absY: number) => absY - HIP_Y;
  const collar = mesh(
    T,
    new T.TorusGeometry(0.062 * looseness, 0.013, 10, 24),
    gm.rib,
    0,
    LY(1.338),
    0.004
  );
  collar.rotation.x = Math.PI / 2;
  collar.scale.set(1, 0.82, 1);
  upper.add(collar);
  // Hem band, double-layered so the hem reads as folded fabric with
  // real thickness (outer rib + darker inner band peeking below).
  const hem = mesh(
    T,
    new T.CylinderGeometry(0.171 * looseness, 0.175 * looseness, 0.04, 22),
    gm.rib,
    0,
    LY(0.8),
    0
  );
  hem.scale.z = 0.74;
  upper.add(hem);
  const hemInner = mesh(
    T,
    new T.CylinderGeometry(0.169 * looseness, 0.171 * looseness, 0.022, 22),
    gm.fold,
    0,
    LY(0.782),
    0
  );
  hemInner.scale.z = 0.74;
  upper.add(hemInner);
  // Waist fold wrinkles: small arcs hugging the shirt.
  upper.add(foldArc(T, gm.fold, 0.035, 0.005, -0.09, LY(0.88), 0.1, 0.4, 1.1));
  upper.add(foldArc(T, gm.fold, 0.032, 0.005, 0.09, LY(0.87), 0.1, 0.4, -1.1 + Math.PI));
  upper.add(foldArc(T, gm.fold, 0.03, 0.005, 0, LY(0.9), -0.11, -0.5, 0.2));
}

/** M8: tank trim — wide scoop collar + armhole binding, no hem band. */
function dressTankTrim(
  T: typeof import("three"),
  gm: GarmentMats,
  upper: THREE.Group,
  _topColor: string
): void {
  const LY = (absY: number) => absY - HIP_Y;
  // Scoop neckline.
  const collar = mesh(
    T,
    new T.TorusGeometry(0.075, 0.011, 10, 24),
    gm.rib,
    0,
    LY(1.315),
    0.012
  );
  collar.rotation.x = Math.PI / 2 - 0.25;
  collar.scale.set(1, 0.8, 1);
  upper.add(collar);
  // Armhole binding rings.
  for (const sx of [-1, 1]) {
    const bind = mesh(
      T,
      new T.TorusGeometry(0.052, 0.009, 8, 18),
      gm.rib,
      sx * 0.128,
      LY(1.24),
      0
    );
    bind.rotation.y = Math.PI / 2;
    bind.rotation.z = 0.35;
    upper.add(bind);
  }
  // Athletic side stripe.
  for (const sx of [-1, 1]) {
    upper.add(stitchStrip(T, gm, 0.02, 0.34, sx * 0.155, LY(1.05), 0.045));
  }
}

/** M8: agbada trim — embroidered V neckline + front placket stitching. */
function dressAgbadaTrim(
  T: typeof import("three"),
  gm: GarmentMats,
  upper: THREE.Group,
  _topColor: string
): void {
  const LY = (absY: number) => absY - HIP_Y;
  const embMat = new T.MeshStandardMaterial({
    color: "#e8cfa3",
    roughness: 0.55,
    metalness: 0.25,
  });
  // Embroidered V at the neckline.
  for (const sx of [-1, 1]) {
    const v = mesh(T, new T.BoxGeometry(0.018, 0.11, 0.008), embMat, sx * 0.032, LY(1.27), 0.115);
    v.rotation.z = sx * -0.42;
    v.rotation.x = -0.12;
    upper.add(v);
    // Second parallel row.
    const v2 = mesh(T, new T.BoxGeometry(0.012, 0.09, 0.006), embMat, sx * 0.052, LY(1.265), 0.108);
    v2.rotation.z = sx * -0.42;
    v2.rotation.x = -0.12;
    upper.add(v2);
  }
  // Collar band.
  const collar = mesh(
    T,
    new T.TorusGeometry(0.085, 0.014, 10, 24),
    gm.rib,
    0,
    LY(1.335),
    0.004
  );
  collar.rotation.x = Math.PI / 2;
  collar.scale.set(1, 0.82, 1);
  upper.add(collar);
  // Front placket stitching down the chest.
  upper.add(stitchStrip(T, gm, 0.016, 0.42, 0, LY(1.05), 0.155));
  // Flowing hem folds.
  upper.add(foldArc(T, gm.fold, 0.05, 0.006, -0.12, LY(0.78), 0.1, 0.4, 1.1));
  upper.add(foldArc(T, gm.fold, 0.05, 0.006, 0.12, LY(0.78), 0.1, 0.4, -1.1 + Math.PI));
  upper.add(foldArc(T, gm.fold, 0.045, 0.006, 0, LY(0.76), -0.12, -0.5, 0.2));
}

/** M8: dress trim — sweetheart neckline + waist seam into the skirt. */
function dressDressTrim(
  T: typeof import("three"),
  gm: GarmentMats,
  upper: THREE.Group,
  _topColor: string
): void {
  const LY = (absY: number) => absY - HIP_Y;
  // Sweetheart neckline binding.
  for (const sx of [-1, 1]) {
    const cup = mesh(
      T,
      new T.TorusGeometry(0.055, 0.009, 8, 18, Math.PI * 0.8),
      gm.rib,
      sx * 0.058,
      LY(1.28),
      0.055
    );
    cup.rotation.x = Math.PI / 2 - 0.35;
    cup.rotation.z = Math.PI * 1.1 + (sx > 0 ? 0.35 : -0.35);
    upper.add(cup);
  }
  // Waist seam where the bodice meets the skirt.
  const seam = mesh(
    T,
    new T.TorusGeometry(0.163, 0.008, 8, 24),
    gm.rib,
    0,
    LY(0.93),
    0
  );
  seam.rotation.x = Math.PI / 2;
  seam.scale.set(1, 0.86, 1);
  upper.add(seam);
}

/* ------------------------------------------------------------------ */
/* Outfit extras                                                      */
/* ------------------------------------------------------------------ */

function dressHoodieExtras(
  T: typeof import("three"),
  mats: AvatarMaterials,
  gm: GarmentMats,
  upper: THREE.Group
): void {
  const LY = (absY: number) => absY - HIP_Y;
  // Draped hood: open cowl behind the neck (opening faces forward).
  // Profile in ascending y for outward lathe normals.
  const hoodPts = [
    new T.Vector2(0.104, -0.075),
    new T.Vector2(0.11, -0.035),
    new T.Vector2(0.09, 0.008),
    new T.Vector2(0.058, 0.032),
  ];
  const hoodGeo = new T.LatheGeometry(hoodPts, 20, 0.6, Math.PI * 2 - 1.2);
  const hood = new T.Mesh(hoodGeo, gm.weave);
  hood.position.set(0, LY(1.375), -0.055);
  hood.rotation.x = 0.42;
  upper.add(hood);
  // Visible lining inside the hood.
  const lining = new T.Mesh(
    new T.LatheGeometry(hoodPts, 20, 0.6, Math.PI * 2 - 1.2),
    mats.accentMat
  );
  lining.scale.set(0.93, 0.93, 0.93);
  lining.position.set(0, LY(1.375), -0.055);
  lining.rotation.x = 0.42;
  upper.add(lining);
  // Hood roll: the bunched hood reads as a collar ring around the neck
  // from the front (reference), draping into the back cowl.
  const roll = mesh(
    T,
    new T.TorusGeometry(0.088, 0.023, 8, 18),
    gm.weave,
    0,
    LY(1.352),
    -0.012
  );
  roll.rotation.x = Math.PI / 2 - 0.28;
  roll.scale.set(1, 0.9, 1);
  upper.add(roll);

  // Kangaroo pocket: sloped, with angled side openings + top stitch.
  const pocket = mesh(
    T,
    new T.SphereGeometry(0.082, 16, 12),
    gm.weave,
    0,
    LY(1.06),
    0.112
  );
  pocket.scale.set(1.08, 0.66, 0.44);
  upper.add(pocket);
  upper.add(stitchStrip(T, gm, 0.11, 0.012, 0, LY(1.118), 0.142));
  for (const sx of [-1, 1]) {
    // Slanted side openings.
    const slit = stitchStrip(T, gm, 0.075, 0.011, sx * 0.082, LY(1.085), 0.132);
    slit.rotation.z = sx * 0.5;
    upper.add(slit);
    // Pocket fold shadow at the opening.
    upper.add(
      foldArc(T, gm.fold, 0.028, 0.004, sx * 0.075, LY(1.075), 0.128, 0.5, sx * 0.9)
    );
  }

  // Drawstring eyelets: dark rings the cords emerge from.
  const eyeletMat = new T.MeshStandardMaterial({
    color: "#20242a",
    roughness: 0.5,
    metalness: 0.4,
  });
  for (const sx of [-1, 1]) {
    const eye = mesh(
      T,
      new T.TorusGeometry(0.0085, 0.0032, 6, 12),
      eyeletMat,
      sx * 0.036,
      LY(1.305),
      0.1295
    );
    eye.rotation.x = 0.15;
    upper.add(eye);
  }
  // Drawstrings: cords on a gentle S-curve with metal aglets.
  for (const sx of [-1, 1]) {
    const curve = new T.CatmullRomCurve3([
      new T.Vector3(sx * 0.036, LY(1.302), 0.132),
      new T.Vector3(sx * 0.039, LY(1.262), 0.137),
      new T.Vector3(sx * 0.035, LY(1.222), 0.134),
    ]);
    upper.add(
      new T.Mesh(new T.TubeGeometry(curve, 8, 0.0052, 6, false), mats.accentMat)
    );
    const tip = curve.getPoint(1);
    const aglet = mesh(
      T,
      new T.CapsuleGeometry(0.0068, 0.016, 3, 8),
      mats.whiteMat,
      tip.x,
      tip.y - 0.012,
      tip.z
    );
    aglet.rotation.x = 0.08;
    upper.add(aglet);
  }

  // Waist fabric folds: soft arcs hugging the hoodie body.
  upper.add(foldArc(T, gm.fold, 0.04, 0.0055, -0.1, LY(0.92), 0.105, 0.45, 1.05));
  upper.add(foldArc(T, gm.fold, 0.038, 0.0055, 0.1, LY(0.905), 0.105, 0.45, -1.05 + Math.PI));
  upper.add(foldArc(T, gm.fold, 0.034, 0.005, 0.01, LY(0.945), -0.115, -0.5, 0.25));
}

function dressOfficeExtras(
  T: typeof import("three"),
  mats: AvatarMaterials,
  gm: GarmentMats,
  upper: THREE.Group,
  topColor: string
): void {
  const LY = (absY: number) => absY - HIP_Y;
  // Collar band + point collar flaps.
  const band = mesh(
    T,
    new T.TorusGeometry(0.06, 0.011, 8, 20),
    gm.weave,
    0,
    LY(1.35),
    0
  );
  band.rotation.x = Math.PI / 2;
  upper.add(band);
  for (const sx of [-1, 1]) {
    const flap = mesh(
      T,
      new T.BoxGeometry(0.058, 0.012, 0.052),
      gm.weave,
      sx * 0.044,
      LY(1.342),
      0.058
    );
    flap.rotation.y = sx * 0.42;
    flap.rotation.z = sx * -0.14;
    upper.add(flap);
  }
  // Button placket + buttons.
  upper.add(
    mesh(T, new T.BoxGeometry(0.034, 0.32, 0.01), gm.weave, 0, LY(1.16), 0.121)
  );
  for (const by of buttonYs(4, LY(1.28), LY(1.04))) {
    const btn = mesh(
      T,
      new T.CylinderGeometry(0.0085, 0.0085, 0.007, 10),
      mats.whiteMat,
      0,
      by,
      0.128
    );
    btn.rotation.x = Math.PI / 2;
    upper.add(btn);
  }
  // Tie: knot + dimple + blade.
  const tieMat = new T.MeshStandardMaterial({
    color: shade(topColor, -70),
    roughness: 0.75,
  });
  const knot = mesh(
    T,
    new T.BoxGeometry(0.032, 0.04, 0.024),
    tieMat,
    0,
    LY(1.318),
    0.128
  );
  knot.rotation.x = 0.18;
  upper.add(knot);
  const dimple = mesh(
    T,
    new T.BoxGeometry(0.012, 0.022, 0.008),
    new T.MeshStandardMaterial({ color: shade(topColor, -110), roughness: 0.8 }),
    0,
    LY(1.292),
    0.14
  );
  upper.add(dimple);
  const tieShape = new T.Shape();
  tieShape.moveTo(-0.011, 0);
  tieShape.lineTo(-0.027, -0.17);
  tieShape.lineTo(-0.014, -0.25);
  tieShape.lineTo(0.014, -0.25);
  tieShape.lineTo(0.027, -0.17);
  tieShape.lineTo(0.011, 0);
  tieShape.closePath();
  const blade = new T.Mesh(
    new T.ExtrudeGeometry(tieShape, { depth: 0.008, bevelEnabled: false }),
    tieMat
  );
  blade.position.set(0, LY(1.3), 0.133);
  blade.rotation.x = 0.05;
  upper.add(blade);
}

function dressSiteworkExtras(
  T: typeof import("three"),
  mats: AvatarMaterials,
  upper: THREE.Group
): void {
  const LY = (absY: number) => absY - HIP_Y;
  // Hi-vis vest: open-front shell over the tee.
  const vestProfile: Array<[number, number]> = [
    [0.184, 0.88],
    [0.18, 1.0],
    [0.19, 1.12],
    [0.18, 1.22],
    [0.132, 1.3],
    [0.078, 1.335],
  ].map(([r, y]) => [r, LY(y)] as [number, number]);
  const pts = vestProfile.map(
    ([r, y]) => new T.Vector2(Math.max(0.0001, r), y)
  );
  const vest = new T.Mesh(
    new T.LatheGeometry(pts, 20, 0.55, Math.PI * 2 - 1.1),
    mats.vestMat
  );
  vest.scale.z = 0.74;
  upper.add(vest);
  // Reflective horizontal stripes (match the vest opening).
  for (const sy of [1.0, 1.13]) {
    const stripe = new T.Mesh(
      new T.CylinderGeometry(0.187, 0.187, 0.03, 20, 1, true, 0.55, Math.PI * 2 - 1.1),
      mats.stripeMat
    );
    stripe.position.set(0, LY(sy), 0);
    stripe.scale.z = 0.74;
    upper.add(stripe);
  }
  // Reflective shoulder strips.
  for (const sx of [-1, 1]) {
    const sh = mesh(
      T,
      new T.BoxGeometry(0.045, 0.012, 0.16),
      mats.stripeMat,
      sx * 0.115,
      LY(1.29),
      0.01
    );
    sh.rotation.y = sx * 0.18;
    upper.add(sh);
  }
  // Front zip.
  for (const sx of [-1, 1]) {
    upper.add(
      mesh(
        T,
        new T.BoxGeometry(0.012, 0.44, 0.008),
        mats.shoeMat,
        sx * 0.062,
        LY(1.1),
        0.128
      )
    );
  }
}

/* ------------------------------------------------------------------ */
/* Sleeves                                                            */
/* ------------------------------------------------------------------ */

function dressSleeves(
  T: typeof import("three"),
  mats: AvatarMaterials,
  gm: GarmentMats,
  body: BuiltBody,
  ctx: GarmentCtx
): void {
  const { outfit, limbScale } = ctx;
  // M8: the gym tank is sleeveless — bare shoulders, no caps.
  if (outfit === "gym") return;
  const longSleeves = outfit === "hoodie" || outfit === "office";
  const wideSleeves = outfit === "agbada";
  for (const [arm, sx] of [[body.armL, -1], [body.armR, 1]] as const) {
    // Shoulder cap — an ellipsoid stretched toward the torso that bridges
    // into the sleeve, swallowing the sleeve's top edge so no seam shows.
    // Agbada caps are bigger to feed the wide flowing sleeve.
    const shoulderCap = mesh(
      T,
      new T.SphereGeometry(0.064 * limbScale * (wideSleeves ? 1.5 : 1), 16, 12),
      gm.weave,
      -sx * 0.012 * limbScale,
      0.028,
      0
    );
    shoulderCap.scale.set(1.3, 0.62, 0.9);
    arm.add(shoulderCap);

    if (wideSleeves) {
      // Flowing agbada sleeve: wide bell from shoulder to wrist.
      const sl = lathe(
        T,
        [
          [0.075, -0.42],
          [0.082, -0.36],
          [0.095, -0.26],
          [0.105, -0.16],
          [0.11, -0.06],
          [0.105, 0.03],
        ].map(([r, y]) => [r * limbScale, y] as [number, number]),
        gm.weave,
        14
      );
      arm.add(sl);
      // Embroidered cuff ring.
      const cuff = mesh(
        T,
        new T.TorusGeometry(0.078 * limbScale, 0.011, 8, 18),
        gm.rib,
        0,
        -0.42,
        0
      );
      cuff.rotation.x = Math.PI / 2;
      arm.add(cuff);
      arm.add(foldArc(T, gm.fold, 0.07, 0.005, 0, -0.3, 0.05, 0.6, 0.3));
    } else if (longSleeves) {
      const sl = lathe(
        T,
        [
          [0.038, -0.41],
          [0.04, -0.38],
          [0.046, -0.3],
          [0.052, -0.2],
          [0.06, -0.08],
          [0.07, 0.0],
          [0.072, 0.03],
        ].map(([r, y]) => [r * limbScale, y] as [number, number]),
        gm.weave,
        12
      );
      arm.add(sl);
      // Ribbed cuff (+ cuff button for office). Hoodie cuffs are chunkier.
      const cuff = mesh(
        T,
        new T.TorusGeometry(0.04 * limbScale, outfit === "hoodie" ? 0.017 : 0.012, 8, 16),
        gm.rib,
        0,
        -0.41,
        0
      );
      cuff.rotation.x = Math.PI / 2;
      arm.add(cuff);
      if (outfit === "office") {
        const btn = mesh(
          T,
          new T.CylinderGeometry(0.007, 0.007, 0.006, 8),
          mats.whiteMat,
          0.032 * limbScale,
          -0.41,
          0.026
        );
        btn.rotation.x = Math.PI / 2;
        arm.add(btn);
      }
      // Elbow fold wrinkles.
      arm.add(foldArc(T, gm.fold, 0.032, 0.004, 0, -0.24, 0.04, 0.6, 0.3));
      arm.add(foldArc(T, gm.fold, 0.03, 0.004, 0, -0.29, 0.038, 0.6, -0.6));
    } else {
      const sl = lathe(
        T,
        [
          [0.056, -0.16],
          [0.058, -0.13],
          [0.062, -0.06],
          [0.07, 0.0],
          [0.072, 0.03],
        ].map(([r, y]) => [r * limbScale, y] as [number, number]),
        gm.weave,
        12
      );
      arm.add(sl);
      // Sleeve hem.
      const hem = mesh(
        T,
        new T.TorusGeometry(0.057 * limbScale, 0.009, 8, 16),
        gm.rib,
        0,
        -0.16,
        0
      );
      hem.rotation.x = Math.PI / 2;
      arm.add(hem);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Main entry                                                         */
/* ------------------------------------------------------------------ */

export function dressBody(
  T: typeof import("three"),
  mats: AvatarMaterials,
  body: BuiltBody,
  ctx: GarmentCtx
): DressedBody {
  const { outfit, topColor } = ctx;
  const gm = buildGarmentMats(T, mats, topColor);
  const looseness =
    outfit === "chill"
      ? 1.12
      : outfit === "hoodie"
        ? 1.06
        : outfit === "agbada"
          ? 1.42
          : 1;

  dressLegs(T, mats, gm, body, ctx);
  dressHips(T, mats, gm, body, ctx);

  // Shirt — the single torsoMesh the idle loop breathes.
  const shirt = buildShirt(T, gm, ctx);
  body.upper.add(shirt);

  if (outfit === "office") {
    dressOfficeExtras(T, mats, gm, body.upper, topColor);
    // Office shirt: no ribbed hem band (tucked look) — waist folds only.
    body.upper.add(foldArc(T, gm.fold, 0.035, 0.005, -0.09, 0.04, 0.1, 0.4, 1.1));
    body.upper.add(foldArc(T, gm.fold, 0.032, 0.005, 0.09, 0.03, 0.1, 0.4, -1.1 + Math.PI));
  } else if (outfit === "gym") {
    dressTankTrim(T, gm, body.upper, topColor);
  } else if (outfit === "agbada") {
    dressAgbadaTrim(T, gm, body.upper, topColor);
  } else if (outfit === "owambe") {
    dressDressTrim(T, gm, body.upper, topColor);
  } else {
    dressTeeTrim(T, gm, body.upper, looseness);
  }
  if (outfit === "hoodie") dressHoodieExtras(T, mats, gm, body.upper);
  if (outfit === "sitework") dressSiteworkExtras(T, mats, body.upper);

  dressSleeves(T, mats, gm, body, ctx);

  return { torsoMesh: shirt };
}
