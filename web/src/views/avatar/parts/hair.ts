import type * as THREE from "three";
import { mulberry32 } from "./util";
import { HAIR_HEX, shade, type AvatarMaterials } from "./materials";
import type { BuiltHead } from "./head";
import {
  canvasTexture,
  paintFrizz,
  paintScalpSheen,
  paintStrandFlow,
  paintStubble,
  paintWaves,
} from "./strandTextures";

/**
 * Nine HD hairstyles, positioned relative to the head group.
 * Skull centre at local (0, HC, 0) where HC = 0.105, radius ≈ 0.105.
 * Canonical ids: lowcut/bald/curls/afro/locs/braids/classic (stable —
 * never rename). New M3 ids: hair_taper_fade_01, hair_waves_01.
 * Unknown id → lowcut (never a bare broken head).
 *
 * All geometry is original procedural code. Detail comes from layered
 * shells + canvas-painted strand textures (strandTextures.ts), never
 * from flat blobs. The face (+Z, eyes ≈ y 0.115, brows ≈ y 0.152) is
 * kept clear: no hair crosses the brow line in front.
 */

const TAU = Math.PI * 2;

/** Smooth low-frequency lumpiness for the afro mass. */
export function afroNoise(
  T: typeof import("three"),
  geo: THREE.BufferGeometry,
  seed: number,
  amp: number
): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new T.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const len = v.length();
    if (len < 1e-6) continue;
    const theta = Math.atan2(v.z, v.x);
    const phi = Math.acos(Math.max(-1, Math.min(1, v.y / len)));
    const n =
      Math.sin(5 * theta + 1.7 * seed) * Math.sin(4 * phi + 0.6 * seed) +
      0.5 * Math.sin(9 * theta + 3 * phi + seed);
    const s = 1 + amp * n;
    pos.setXYZ(i, v.x * s, v.y * s, v.z * s);
  }
  geo.computeVertexNormals();
}

/** Skull centre height (head-local) — shared with head.ts. */
export const HAIR_HC = 0.105;

/* ------------------------------------------------------------------ */
/* Hair colour (Milestone 3b): colorId → tint threaded through the      */
/* style builders. When no colour is requested the builders use their  */
/* original M3 literal colours byte-for-byte (default black = HAIR_HEX).*/
/* ------------------------------------------------------------------ */

/** Registered hair-colour hexes (mirror the manifest texture entries). */
export const HAIR_COLOR_HEX: Record<string, string> = {
  hair_black_01: HAIR_HEX,
  hair_dark_brown_01: "#3b2417",
  hair_brown_01: "#5b3a21",
};

export interface HairTint {
  base: string;
  dark: string;
  light: string;
}

/** Resolve a colorId to its hex (unknown/undefined → HAIR_HEX). */
export function hairColorHex(colorId?: string): string {
  return (colorId && HAIR_COLOR_HEX[colorId]) || HAIR_HEX;
}

/** Tint for a hair colour id (unknown/undefined → default black). */
export function hairTint(colorId?: string): HairTint {
  const base = hairColorHex(colorId);
  return { base, dark: shade(base, -22), light: shade(base, 44) };
}

/**
 * Face guard: pull mass vertices out of the face zone (front of the head,
 * brow to chin) back to just off the skin, so displaced volumes frame the
 * face instead of covering it. Expects head-local coordinates.
 */
export function guardFace(
  T: typeof import("three"),
  geo: THREE.BufferGeometry,
  margin = 0.008
): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new T.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (v.z > 0 && v.y < 0.19 && v.y > 0.02) {
      const maxR = headRadiusAt(v.y) + margin;
      const hr = Math.hypot(v.x, v.z);
      if (hr > maxR && hr > 1e-6) {
        const s = maxR / hr;
        pos.setXYZ(i, v.x * s, v.y, v.z * s);
      }
    }
  }
  geo.computeVertexNormals();
}

/**
 * Clump displacement: push shell vertices outward around seeded centres so
 * the surface reads as picked clumps integrated in the mass (not separate
 * blobs). Operates radially from the geometry origin.
 */
export function clumpDisplace(
  T: typeof import("three"),
  geo: THREE.BufferGeometry,
  seed: number,
  clumps: number,
  clumpR: number,
  amp: number
): void {
  const centres: THREE.Vector3[] = [];
  for (let i = 0; i < clumps; i++) {
    // Seed shifts the spiral start so different shells don't align.
    const [x, y, z] = fibDir((i + seed) % clumps, clumps, Math.PI * 0.62);
    centres.push(new T.Vector3(x, y, z));
  }
  const cosR = Math.cos(clumpR);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new T.Vector3();
  const d = new T.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const len = v.length();
    if (len < 1e-6) continue;
    d.copy(v).normalize();
    let bump = 0;
    for (const c of centres) {
      const cosd = d.dot(c);
      if (cosd > cosR) {
        const s = (cosd - cosR) / (1 - cosR);
        bump += s * s * (3 - 2 * s);
      }
    }
    if (bump > 0) {
      const s = 1 + Math.min(amp * bump, 0.35);
      pos.setXYZ(i, v.x * s, v.y * s, v.z * s);
    }
  }
  geo.computeVertexNormals();
}

/** Approximate skull radius. */
const SKULL_R = 0.105;

/* ------------------------------------------------------------------ */
/* Pure layout helpers (unit-testable, no three.js runtime needed).     */
/* ------------------------------------------------------------------ */

/**
 * Golden-angle spiral point on the upper hemisphere, uniform over the
 * cap area out to maxPolar. Returns a unit direction vector.
 */
export function fibDir(
  i: number,
  n: number,
  maxPolar: number
): [number, number, number] {
  const ga = Math.PI * (3 - Math.sqrt(5));
  const t = (i + 0.5) / n;
  const polar = Math.acos(1 - t * (1 - Math.cos(maxPolar)));
  const az = i * ga;
  return [
    Math.sin(polar) * Math.cos(az),
    Math.cos(polar),
    Math.sin(polar) * Math.sin(az),
  ];
}

/**
 * Approximate head radius at a head-local height, mirroring the jaw
 * taper in head.ts sculptSkull. Used to drape hanging hair just off the
 * skin so strands never clip through the face.
 */
export function headRadiusAt(y: number): number {
  const ny = (y - HAIR_HC) / SKULL_R;
  if (Math.abs(ny) >= 1) return 0.02;
  let r = SKULL_R * Math.sqrt(Math.max(0.02, 1 - ny * ny));
  if (ny < 0.15) {
    const k = Math.min(1, (0.15 - ny) / 1.15);
    r *= 1 - 0.3 * Math.pow(k, 1.4);
  }
  return r;
}

export interface LocSpec {
  root: [number, number, number];
  tip: [number, number, number];
  len: number;
}

/**
 * Deterministic loc layout: three rings (short front frame, medium
 * sides, long back), draped down the head. The front wedge (|angle| <
 * 0.42 rad) is left rootless so nothing hangs over the eyes.
 */
export function planLocs(): LocSpec[] {
  const rand = mulberry32(4242);
  const specs: LocSpec[] = [];
  const rings = [
    { n: 7, polar: 0.3 * Math.PI, lenMin: 0.15, lenMax: 0.22 },
    { n: 8, polar: 0.37 * Math.PI, lenMin: 0.26, lenMax: 0.34 },
    { n: 7, polar: 0.46 * Math.PI, lenMin: 0.34, lenMax: 0.44 },
  ];
  for (const ring of rings) {
    for (let k = 0; k < ring.n; k++) {
      let a = (k / ring.n) * TAU + rand() * 0.3;
      // Keep the forehead wedge clear.
      const wrapped = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(wrapped) < 0.42) {
        a = wrapped >= 0 ? 0.45 + rand() * 0.2 : -0.45 - rand() * 0.2;
      }
      const R = 0.108;
      const sp = Math.sin(ring.polar);
      const root: [number, number, number] = [
        R * sp * Math.sin(a),
        HAIR_HC + R * Math.cos(ring.polar),
        R * sp * Math.cos(a),
      ];
      const len = ring.lenMin + rand() * (ring.lenMax - ring.lenMin);
      const rl = Math.hypot(root[0], root[2]) || 1;
      const dx = root[0] / rl;
      const dz = root[2] / rl;
      const tipY = root[1] - len;
      const clearance = tipY < 0.005 ? 0.08 : 0.024;
      const rad = Math.max(headRadiusAt(tipY) + clearance, 0.055);
      const tip: [number, number, number] = [dx * rad, tipY, dz * rad];
      specs.push({ root, tip, len });
    }
  }
  return specs;
}

/**
 * Cornrow control points: 9 rows running front-hairline → over crown →
 * nape, each in its own lateral plane (x = const) so rows stay parallel
 * instead of converging. Spaced 0.021 apart so scalp shows between rows.
 * Points are [x, y, z] head-local.
 */
export function cornrowPaths(
  rows = 9,
  R0 = 0.117
): Array<Array<[number, number, number]>> {
  const paths: Array<Array<[number, number, number]>> = [];
  for (let i = 0; i < rows; i++) {
    const xb = (i - (rows - 1) / 2) * 0.021;
    const rc = Math.sqrt(Math.max(R0 * R0 - xb * xb, 0.001));
    const pts: Array<[number, number, number]> = [];
    const K = 10;
    for (let k = 0; k <= K; k++) {
      const t = k / K;
      const phi = ((35 + t * (200 - 35)) * Math.PI) / 180; // +Z front → top → -Z nape
      // Shrink the radius past the crown so the row hugs the tapering nape.
      const shrink = 0.01 * ((phi - (100 * Math.PI) / 180) / ((100 * Math.PI) / 180));
      const R = phi <= (100 * Math.PI) / 180 ? rc : rc - Math.max(0, shrink);
      const y = HAIR_HC + R * Math.sin(phi);
      const z = R * Math.cos(phi);
      pts.push([xb, y, z]);
    }
    paths.push(pts);
  }
  return paths;
}

/**
 * Back-of-head drape for hanging braids: follows the skull down past the
 * nape, then hangs just off the back of the torso (never inside it).
 */
export function napeDrapeZ(y: number): number {
  const surface = headRadiusAt(y) * 1.04 + 0.018;
  if (y >= 0.05) return -surface;
  // Anchor the hand-off at the y=0.05 value so the descent stays monotonic.
  const anchor = headRadiusAt(0.05) * 1.04 + 0.018;
  const t = Math.min(1, (0.05 - y) / 0.12);
  return -(anchor * (1 - t) + 0.135 * t);
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                   */
/* ------------------------------------------------------------------ */

/** Partial sphere cap centred on the skull. polarFrac = fraction of π. */
function capGeo(
  T: typeof import("three"),
  r: number,
  polarFrac: number,
  w: number,
  h: number
): THREE.BufferGeometry {
  return new T.SphereGeometry(r, w, h, 0, TAU, 0, Math.PI * polarFrac);
}

function placeCap(
  T: typeof import("three"),
  geo: THREE.BufferGeometry,
  mat: THREE.Material
): THREE.Mesh {
  const m = new T.Mesh(geo, mat);
  m.position.set(0, HAIR_HC, 0);
  return m;
}

/** Taper a tube geometry along its curve: radius ×(1 − taper·u). */
export function taperTube(
  T: typeof import("three"),
  geo: THREE.BufferGeometry,
  curve: THREE.Curve<THREE.Vector3>,
  taper: number
): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const c = new T.Vector3();
  const v = new T.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i);
    curve.getPoint(u, c);
    v.fromBufferAttribute(pos, i);
    const s = 1 - taper * u;
    pos.setXYZ(i, c.x + (v.x - c.x) * s, c.y + (v.y - c.y) * s, c.z + (v.z - c.z) * s);
  }
  geo.computeVertexNormals();
}

/** Helix curve for one coil (curls). */
function helixCurve(
  T: typeof import("three"),
  origin: THREE.Vector3,
  normal: THREE.Vector3,
  coilR: number,
  coilH: number,
  turns: number,
  phase: number
): THREE.CatmullRomCurve3 {
  const n = normal.clone().normalize();
  const ref = Math.abs(n.y) > 0.9 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 1, 0);
  const u = new T.Vector3().crossVectors(n, ref).normalize();
  const v = new T.Vector3().crossVectors(n, u).normalize();
  const pts: THREE.Vector3[] = [];
  // ~7 samples per turn keeps the helix smooth instead of polygonal.
  const K = Math.max(14, Math.round(turns * 7));
  for (let k = 0; k <= K; k++) {
    const t = k / K;
    const a = phase + t * turns * TAU;
    const rr = coilR * (1 - t * 0.3);
    pts.push(
      new T.Vector3(
        origin.x + n.x * t * coilH + (u.x * Math.cos(a) + v.x * Math.sin(a)) * rr,
        origin.y + n.y * t * coilH + (u.y * Math.cos(a) + v.y * Math.sin(a)) * rr,
        origin.z + n.z * t * coilH + (u.z * Math.cos(a) + v.z * Math.sin(a)) * rr
      )
    );
  }
  return new T.CatmullRomCurve3(pts);
}

/** Strand material with a painted texture, or the plain hair material. */
function strandMat(
  T: typeof import("three"),
  mats: AvatarMaterials,
  map: THREE.Texture | null,
  rough = 0.85
): THREE.Material {
  if (!map) return mats.hairMat;
  return new T.MeshStandardMaterial({
    color: "#ffffff",
    map,
    roughness: rough,
    metalness: 0.02,
  });
}

/* ------------------------------------------------------------------ */
/* The seven styles                                                   */
/* ------------------------------------------------------------------ */

/**
 * Clean lineup: a crisp hairline tube hugging the fade-shell rim across
 * the forehead, with sharp temple corners bridging down to the sideburns.
 * This is the barber-lineup read from the reference — geometry, not just
 * texture, so it holds a hard edge at every angle.
 */
function buildLineup(
  T: typeof import("three"),
  mats: AvatarMaterials
): THREE.Object3D[] {
  const parts: THREE.Object3D[] = [];
  const R = 0.0948;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 20; i++) {
    const a = -1.05 + (i / 20) * 2.1;
    // Corners drop a touch at the temples for the sharp lineup shape.
    const drop = 0.005 * Math.pow(Math.abs(a) / 1.05, 3);
    pts.push(
      new T.Vector3(
        R * Math.sin(a),
        0.1575 - drop,
        R * Math.cos(a) * 0.99 + 0.002
      )
    );
  }
  const curve = new T.CatmullRomCurve3(pts);
  parts.push(new T.Mesh(new T.TubeGeometry(curve, 24, 0.0042, 6, false), mats.hairMat));
  // Temple corners: short vertical blades under the tube ends.
  for (const sx of [-1, 1]) {
    const corner = new T.Mesh(
      new T.BoxGeometry(0.007, 0.02, 0.006),
      mats.hairMat
    );
    corner.position.set(sx * 0.0835, 0.1465, 0.0465);
    corner.rotation.y = sx * -0.5;
    corner.rotation.z = sx * 0.1;
    parts.push(corner);
  }
  return parts;
}

function buildLowcut(
  T: typeof import("three"),
  mats: AvatarMaterials,
  tint?: HairTint
): THREE.Object3D[] {
  const parts: THREE.Object3D[] = [];
  const r = 0.1068; // hug the scalp — the hairline edge must not float
  const p = 0.34;
  // Solid under-cap backing the fade shell: radius sits BETWEEN the skull
  // (0.105) and the fade shell (r) — the old r-0.002 was buried inside the
  // skull and never visible. Runs just past the fade shell's rim; the
  // lineup tube hides its edge, so no skin window opens at glancing angles.
  parts.push(placeCap(T, capGeo(T, r - 0.0006, p * 1.0, 20, 12), mats.hairMat));
  // Fade shell: stubble speckle field with a longer, smoother falloff so
  // the fade reads barbered; the lineup tube (below) draws the hard edge.
  const fadeTex = canvasTexture(
    T,
    128,
    (c) =>
      paintStubble(c, 128, {
        seed: 11,
        dots: 1400,
        hair: tint?.base ?? HAIR_HEX,
        fadeBottom: true,
        fadeStart: 0.88,
      }),
    { repeat: [3, 1] }
  );
  const fadeMat = fadeTex
    ? new T.MeshStandardMaterial({
        color: "#ffffff",
        map: fadeTex,
        transparent: false,
        alphaTest: 0.38,
        roughness: 0.92,
      })
    : mats.hairMat;
  parts.push(placeCap(T, capGeo(T, r, p, 28, 16), fadeMat));
  // Sideburns: slim tapered strips hugging the head in front of the ears.
  for (const sx of [-1, 1]) {
    const sb = new T.Mesh(new T.BoxGeometry(0.01, 0.028, 0.008), mats.hairMat);
    sb.position.set(sx * 0.094, 0.118, 0.014);
    sb.rotation.y = sx * 0.35;
    parts.push(sb);
  }
  // Crisp barber lineup across the forehead.
  parts.push(...buildLineup(T, mats));
  return parts;
}

/**
 * Taper fade (new id: hair_taper_fade_01): low-cut top with length, faded
 * down the sides and nape, finished with a sharp lineup. Built from the
 * same procedural vocabulary as lowcut — no new asset pipeline.
 */
function buildTaperFade(
  T: typeof import("three"),
  mats: AvatarMaterials,
  tint?: HairTint
): THREE.Object3D[] {
  const parts: THREE.Object3D[] = [];
  // Top: slightly raised cap with a combed-strand read.
  const flowTex = canvasTexture(
    T,
    128,
    (c) =>
      paintStrandFlow(c, 128, {
        seed: 71,
        strands: 70,
        angle: 0.15,
        dark: tint?.dark ?? "#0b0705",
        light: tint?.light ?? "#3d2f24",
        alpha: [0.35, 0.7],
        lineScale: 0.8,
      }),
    { repeat: [3, 2] }
  );
  parts.push(
    placeCap(T, capGeo(T, 0.1082, 0.3, 28, 16), strandMat(T, mats, flowTex, 0.8))
  );
  // Sides/nape: aggressive fade — dense at top, gone well before the rim.
  const fadeTex = canvasTexture(
    T,
    128,
    (c) =>
      paintStubble(c, 128, {
        seed: 73,
        dots: 1500,
        hair: tint?.base ?? HAIR_HEX,
        fadeBottom: true,
        fadeStart: 0.7,
      }),
    { repeat: [3, 1] }
  );
  const fadeMat = fadeTex
    ? new T.MeshStandardMaterial({
        color: "#ffffff",
        map: fadeTex,
        transparent: false,
        alphaTest: 0.38,
        roughness: 0.92,
      })
    : mats.hairMat;
  parts.push(placeCap(T, capGeo(T, 0.1068, 0.4, 28, 16), fadeMat));
  // Skin-tight under-cap so no scalp shows through the fade.
  parts.push(placeCap(T, capGeo(T, 0.1062, 0.34, 20, 12), mats.hairMat));
  for (const sx of [-1, 1]) {
    const sb = new T.Mesh(new T.BoxGeometry(0.008, 0.024, 0.007), mats.hairMat);
    sb.position.set(sx * 0.094, 0.118, 0.014);
    sb.rotation.y = sx * 0.35;
    parts.push(sb);
  }
  parts.push(...buildLineup(T, mats));
  return parts;
}

/**
 * Waves (new id: hair_waves_01): low cut with a 360-wave ripple pattern
 * and a soft sheen, finished with a lineup.
 */
function buildWaves(
  T: typeof import("three"),
  mats: AvatarMaterials,
  tint?: HairTint
): THREE.Object3D[] {
  const parts: THREE.Object3D[] = [];
  parts.push(placeCap(T, capGeo(T, 0.1062, 0.3, 20, 12), mats.hairMat));
  const waveTex = canvasTexture(
    T,
    128,
    (c) =>
      paintWaves(c, 128, {
        seed: 79,
        rings: 9,
        base: tint?.base ?? "#171110",
        dark: tint?.dark ?? "#0a0605",
        light: tint?.light ?? "#4a3a2c",
      }),
    { repeat: [2, 1] }
  );
  const waveMat = waveTex
    ? new T.MeshStandardMaterial({
        color: "#ffffff",
        map: waveTex,
        transparent: false,
        alphaTest: 0.3,
        roughness: 0.55,
        metalness: 0.05,
      })
    : mats.hairMat;
  parts.push(placeCap(T, capGeo(T, 0.1072, 0.32, 32, 18), waveMat));
  for (const sx of [-1, 1]) {
    const sb = new T.Mesh(new T.BoxGeometry(0.01, 0.028, 0.008), mats.hairMat);
    sb.position.set(sx * 0.094, 0.118, 0.014);
    sb.rotation.y = sx * 0.35;
    parts.push(sb);
  }
  parts.push(...buildLineup(T, mats));
  return parts;
}

function buildBald(
  T: typeof import("three"),
  mats: AvatarMaterials
): THREE.Object3D[] {
  const parts: THREE.Object3D[] = [];
  const skinHex =
    "#" + (mats.skinMat as THREE.MeshStandardMaterial).color.getHexString();
  const sheenTex = canvasTexture(T, 128, (c) =>
    paintScalpSheen(c, 128, { seed: 21, skin: skinHex })
  );
  const scalpMat = sheenTex
    ? new T.MeshStandardMaterial({
        color: "#ffffff",
        map: sheenTex,
        roughness: 0.32,
        metalness: 0.05,
      })
    : mats.skinMat;
  // Scalp shell: sheen + stubble speckle, not pure skin.
  parts.push(placeCap(T, capGeo(T, 0.1068, 0.52, 24, 16), scalpMat));
  // Polished crown highlight.
  const crown = new T.Mesh(
    new T.SphereGeometry(0.032, 16, 12),
    new T.MeshStandardMaterial({
      color: shade(skinHex, 26),
      roughness: 0.18,
      metalness: 0.06,
    })
  );
  crown.scale.set(1, 0.3, 1);
  crown.position.set(0, 0.2085, 0.004);
  parts.push(crown);
  return parts;
}

function buildCurls(
  T: typeof import("three"),
  mats: AvatarMaterials,
  tint?: HairTint
): THREE.Object3D[] {
  const parts: THREE.Object3D[] = [];
  const rand = mulberry32(1234);
  // Curly mass: tighter clumps than the afro, coil-detail texture.
  const coilTex = canvasTexture(
    T,
    128,
    (c) =>
      paintStrandFlow(c, 128, {
        seed: 37,
        strands: 90,
        twist: true,
        angle: 0.7,
        dark: tint?.dark ?? "#0b0705",
        light: tint?.light ?? "#3a2c20",
        alpha: [0.35, 0.65],
        lineScale: 0.7,
      }),
    { repeat: [4, 3] }
  );
  const massMat = coilTex
    ? new T.MeshStandardMaterial({
        color: "#ffffff",
        map: coilTex,
        bumpMap: coilTex,
        bumpScale: 0.5,
        roughness: 0.92,
      })
    : mats.hairMat;
  const mass = new T.Mesh(new T.SphereGeometry(0.126, 20, 16), massMat);
  afroNoise(T, mass.geometry, 21, 0.05);
  clumpDisplace(T, mass.geometry, 9, 34, 0.3, 0.2);
  mass.geometry.translate(0, 0.212, -0.012);
  guardFace(T, mass.geometry, 0.01);
  parts.push(mass);
  // Defined ringlets on the surface — never over the face.
  const ringTex = canvasTexture(
    T,
    128,
    (c) =>
      paintStrandFlow(c, 128, {
        seed: 39,
        strands: 60,
        twist: true,
        angle: 0.4,
        dark: tint?.dark ?? "#0b0705",
        light: tint?.light ?? "#3a2c20",
        alpha: [0.3, 0.6],
        lineScale: 0.6,
      }),
    { repeat: [1, 2] }
  );
  const ringMat = strandMat(T, mats, ringTex, 0.85);
  const N = 20;
  for (let i = 0; i < N; i++) {
    const [dx, dy, dz] = fibDir(i, N, Math.PI * 0.52);
    const y = 0.212 + dy * 0.126;
    const z = -0.012 + dz * 0.126;
    if (z > 0.05 && y < 0.185) continue; // face zone
    const n = new T.Vector3(
      dx + (rand() - 0.5) * 0.3,
      dy + rand() * 0.15,
      dz + (rand() - 0.5) * 0.3
    );
    const origin = new T.Vector3(dx * 0.124, y - 0.004, z);
    const coilR = 0.011 + rand() * 0.005;
    const tubeR = 0.005 + rand() * 0.002;
    const curve = helixCurve(
      T,
      origin,
      n,
      coilR,
      0.02 + rand() * 0.01,
      2.5,
      rand() * TAU
    );
    parts.push(
      new T.Mesh(new T.TubeGeometry(curve, 12, tubeR, 4, false), ringMat)
    );
  }
  return parts;
}

function buildAfro(
  T: typeof import("three"),
  mats: AvatarMaterials,
  tint?: HairTint
): THREE.Object3D[] {
  const parts: THREE.Object3D[] = [];
  const frizzTex = canvasTexture(
    T,
    128,
    (c) =>
      paintFrizz(c, 128, {
        seed: 31,
        strokes: 850,
        base: tint?.base ?? HAIR_HEX,
        dark: tint?.dark ?? "#000000",
        light: tint?.light ?? "#554130",
      }),
    { repeat: [4, 3] }
  );
  const outerMat = frizzTex
    ? new T.MeshStandardMaterial({
        color: "#ffffff",
        map: frizzTex,
        bumpMap: frizzTex,
        bumpScale: 0.7,
        roughness: 0.95,
      })
    : mats.hairMat;
  // Inner dark mass + larger picked-out shell.
  const inner = new T.Mesh(new T.SphereGeometry(0.132, 16, 12), mats.hairMat);
  afroNoise(T, inner.geometry, 7, 0.06);
  inner.position.set(0, 0.222, -0.033);
  parts.push(inner);
  const outer = new T.Mesh(new T.SphereGeometry(0.146, 24, 18), outerMat);
  afroNoise(T, outer.geometry, 13, 0.055);
  clumpDisplace(T, outer.geometry, 5, 42, 0.34, 0.16);
  outer.geometry.translate(0, 0.226, -0.035);
  guardFace(T, outer.geometry, 0.01);
  parts.push(outer);
  return parts;
}

function buildLocs(
  T: typeof import("three"),
  mats: AvatarMaterials,
  tint?: HairTint
): THREE.Object3D[] {
  const parts: THREE.Object3D[] = [];
  // Root bed with fuzz texture (new growth).
  const rootTex = canvasTexture(
    T,
    128,
    (c) => paintFrizz(c, 128, { seed: 41, strokes: 600 }),
    { repeat: [3, 2] }
  );
  parts.push(
    placeCap(T, capGeo(T, 0.1095, 0.4, 24, 14), strandMat(T, mats, rootTex, 0.9))
  );
  const twistTex = canvasTexture(
    T,
    128,
    (c) =>
      paintStrandFlow(c, 128, {
        seed: 43,
        strands: 130,
        twist: true,
        angle: 0.35,
        dark: tint?.dark ?? "#0b0705",
        light: tint?.light ?? "#33261c",
        alpha: [0.3, 0.6],
        lineScale: 0.6,
      }),
    { repeat: [1, 2] }
  );
  const locMat = strandMat(T, mats, twistTex, 0.82);
  for (const spec of planLocs()) {
    const { root, tip } = spec;
    const rootV = new T.Vector3(root[0], root[1], root[2]);
    const tipV = new T.Vector3(tip[0], tip[1], tip[2]);
    // Drape: sample the head surface so the loc hugs the skull, then falls.
    const pts: THREE.Vector3[] = [];
    const K = 6;
    for (let k = 0; k <= K; k++) {
      const t = k / K;
      const y = rootV.y + (tipV.y - rootV.y) * t;
      if (t === 0) {
        pts.push(rootV.clone());
        continue;
      }
      if (t === 1) {
        pts.push(tipV.clone());
        continue;
      }
      const rl = Math.hypot(rootV.x, rootV.z) || 1;
      const dx = rootV.x / rl;
      const dz = rootV.z / rl;
      const clearance = y < 0.005 ? 0.08 : 0.03;
      const rad = Math.max(headRadiusAt(y) + clearance, 0.055);
      pts.push(new T.Vector3(dx * rad, y, dz * rad));
    }
    const curve = new T.CatmullRomCurve3(pts);
    const geo = new T.TubeGeometry(curve, 10, 0.017, 5, false);
    taperTube(T, geo, curve, 0.5);
    parts.push(new T.Mesh(geo, locMat));
    // New-growth root bulb (smooth — no faceted rocks).
    const bulb = new T.Mesh(new T.SphereGeometry(0.02, 7, 5), locMat);
    bulb.position.copy(rootV);
    bulb.scale.set(1, 0.8, 1);
    parts.push(bulb);
    // Rounded tip.
    const tipM = new T.Mesh(new T.IcosahedronGeometry(0.0105, 0), locMat);
    tipM.position.copy(tipV);
    parts.push(tipM);
  }
  return parts;
}

function buildBraids(
  T: typeof import("three"),
  mats: AvatarMaterials,
  tint?: HairTint
): THREE.Object3D[] {
  const parts: THREE.Object3D[] = [];
  const rand = mulberry32(1234);
  // Scalp bed (slightly darkened skin so the parts read crisply).
  parts.push(
    placeCap(T, capGeo(T, 0.1075, 0.44, 24, 14), mats.skinDarkMat)
  );
  const twistTex = canvasTexture(
    T,
    128,
    (c) =>
      paintStrandFlow(c, 128, {
        seed: 53,
        strands: 140,
        twist: true,
        angle: 0.9,
        dark: tint?.dark ?? "#0b0705",
        light: tint?.light ?? "#3a2c20",
        alpha: [0.3, 0.6],
        lineScale: 0.6,
      }),
    { repeat: [1, 3] }
  );
  const braidMat = strandMat(T, mats, twistTex, 0.8);
  // Cornrows: front hairline → over crown → nape, scalp showing between rows.
  // Each row starts with a buried root point so the open tube end emerges
  // from the scalp instead of hovering.
  for (const path of cornrowPaths(9, 0.111)) {
    const v3path = path.map(([x, y, z]) => new T.Vector3(x, y, z));
    const p0 = v3path[0];
    const root = new T.Vector3(
      (p0.x - 0) * 0.9,
      HAIR_HC + (p0.y - HAIR_HC) * 0.9,
      p0.z * 0.9
    );
    const curve = new T.CatmullRomCurve3([root, ...v3path]);
    parts.push(
      new T.Mesh(new T.TubeGeometry(curve, 16, 0.0075, 7, false), braidMat)
    );
  }
  // Hanging braids down the back, draped off the skull, with beads.
  // Roots continue the outer cornrows' endpoints.
  const rowEnds = cornrowPaths(9, 0.111).map((p) => p[p.length - 1]);
  for (let i = 0; i < 8; i++) {
    const end = rowEnds[i];
    const rx = end[0];
    const ry = end[1];
    const rz = end[2];
    const len = 0.14 + rand() * 0.08;
    const pts: THREE.Vector3[] = [];
    const K = 6;
    for (let k = 0; k <= K; k++) {
      const t = k / K;
      const y = ry - t * len;
      if (k === 0) {
        pts.push(new T.Vector3(rx, ry, rz));
        continue;
      }
      pts.push(new T.Vector3(rx * (1 - t * 0.15), y, napeDrapeZ(y)));
    }
    const curve = new T.CatmullRomCurve3(pts);
    const geo = new T.TubeGeometry(curve, 10, 0.006, 6, false);
    taperTube(T, geo, curve, 0.5);
    parts.push(new T.Mesh(geo, braidMat));
    const tip = pts[K];
    const bead = new T.Mesh(
      new T.IcosahedronGeometry(0.013, 0),
      mats.accentMat
    );
    bead.position.set(tip.x, tip.y - 0.014, tip.z);
    parts.push(bead);
  }
  return parts;
}

function buildClassic(
  T: typeof import("three"),
  mats: AvatarMaterials,
  tint?: HairTint
): THREE.Object3D[] {
  const parts: THREE.Object3D[] = [];
  // Base cap with strand-flow texture.
  const flowTex = canvasTexture(
    T,
    128,
    (c) =>
      paintStrandFlow(c, 128, {
        seed: 61,
        strands: 60,
        angle: -0.55,
        light: tint?.light ?? "#4e3d2f",
      }),
    { repeat: [3, 2] }
  );
  const flowMat = strandMat(T, mats, flowTex, 0.78);
  parts.push(placeCap(T, capGeo(T, 0.1095, 0.3, 28, 16), flowMat));
  // Layered side-swept lobes (flow direction → +X).
  const lobes: Array<[number, number, number, number, number]> = [
    // x, y, z, rotZ, scaleX
    [0.032, 0.186, 0.008, -0.14, 1.5],
    [0.055, 0.196, -0.012, -0.22, 1.35],
    [0.008, 0.19, 0.032, -0.08, 1.3],
  ];
  for (const [x, y, z, rz, sx] of lobes) {
    const lobe = new T.Mesh(
      new T.SphereGeometry(0.075, 18, 12, 0, TAU, 0, Math.PI * 0.5),
      flowMat
    );
    lobe.scale.set(sx, 0.55, 1.05);
    lobe.rotation.z = rz;
    lobe.position.set(x, y, z);
    parts.push(lobe);
  }
  // Quiff lift at the front.
  const quiff = new T.Mesh(new T.SphereGeometry(0.03, 14, 10), flowMat);
  quiff.scale.set(1.25, 0.75, 1);
  quiff.rotation.z = -0.2;
  quiff.position.set(0.028, 0.2, 0.06);
  parts.push(quiff);
  // Tapered sides + nape so the silhouette isn't a bowl cut.
  for (const sx of [-1, 1]) {
    const side = new T.Mesh(new T.SphereGeometry(0.032, 12, 10), flowMat);
    side.scale.set(0.7, 1.1, 0.9);
    side.position.set(sx * 0.096, 0.125, -0.012);
    parts.push(side);
  }
  const nape = new T.Mesh(new T.SphereGeometry(0.036, 12, 10), flowMat);
  nape.scale.set(1.1, 0.9, 0.7);
  nape.position.set(0, 0.1, -0.096);
  parts.push(nape);
  return parts;
}

/**
 * Build a hairstyle. `colorId` (optional, M3b) tints the hair: when it is a
 * registered colour other than hair_black_01, the solid hair material is
 * re-created in that colour and the strand/frizz/wave painters get the
 * derived tint. Omitted or default black → the original M3 output,
 * byte-for-byte (existing callers unaffected).
 */
export function buildHair(
  T: typeof import("three"),
  hair: string,
  mats: AvatarMaterials,
  colorId?: string
): THREE.Object3D[] {
  const custom =
    !!colorId && colorId !== "hair_black_01" && !!HAIR_COLOR_HEX[colorId];
  const useMats = custom
    ? {
        ...mats,
        hairMat: new T.MeshStandardMaterial({
          color: HAIR_COLOR_HEX[colorId as string],
          roughness: 0.9,
          metalness: 0.02,
        }),
      }
    : mats;
  const tint = custom ? hairTint(colorId) : undefined;
  switch (hair) {
    case "bald":
      return buildBald(T, useMats);
    case "lowcut":
      return buildLowcut(T, useMats, tint);
    case "curls":
      return buildCurls(T, useMats, tint);
    case "afro":
      return buildAfro(T, useMats, tint);
    case "locs":
      return buildLocs(T, useMats, tint);
    case "braids":
      return buildBraids(T, useMats, tint);
    case "classic":
      return buildClassic(T, useMats, tint);
    case "hair_taper_fade_01":
      return buildTaperFade(T, useMats, tint);
    case "hair_waves_01":
      return buildWaves(T, useMats, tint);
    default:
      // Unknown id → lowcut. Never a bare head.
      return buildLowcut(T, useMats, tint);
  }
}

/** Attach built hair parts into a BuiltHead's group. */
export function attachHair(
  head: BuiltHead,
  parts: THREE.Object3D[]
): void {
  for (const part of parts) head.group.add(part);
}
