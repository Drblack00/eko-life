import type * as THREE from "three";
import { jawTaperK, sstep } from "./head";
import { HAIR_HC, headRadiusAt, taperTube } from "./hair";
import { shade, type AvatarMaterials } from "./materials";
import { canvasTexture, paintStubble } from "./strandTextures";

/**
 * Procedural facial hair (Milestone 3b), positioned relative to the head
 * group — the same head-local space the hair builders use (skull centre
 * at (0, HAIR_HC, 0), face toward +Z).
 *
 * Mouth/chin landmarks (head-local, from parts/head.ts):
 *   philtrum ridges  y 0.0475–0.056, z 0.070–0.0865
 *   upper lip        y 0.0402, z 0.0645 (front ≈ 0.074)
 *   mouth corners    (±0.0295, 0.0326, 0.0625)
 *   lower lip        y 0.0232, z 0.063 (front ≈ 0.073)
 *   chin             y ≈ 0.008–0.018, surface z ≈ faceSurfaceZ(y)
 *
 * All geometry is original procedural code. Styles are deliberately
 * short and subtle (the reference read: light mustache + chin goatee).
 * Every shell sits a few millimetres proud of the analytic face surface
 * (faceSurfaceZ) so nothing floats and nothing clips through the skin.
 *
 * Colour: facial hair follows `mats.hairMat`'s actual colour at build
 * time, so it tracks the hair colourId the M4 runtime threads through
 * buildHair (default HAIR_HEX #171110).
 *
 * Triangle budget: every style < 600 tris (mustache ≈ 160, goatee ≈ 380,
 * short boxed beard ≈ 560).
 */

const SKULL_R = 0.105;

/**
 * Face-surface Z on the midline at head-local height y. Mirrors the
 * front-center terms of sculptSkull in head.ts: sphere radius, jaw
 * z-taper (0.18 factor), chin forward push, brow push. Keep in sync
 * with head.ts if the sculpt changes.
 */
export function faceSurfaceZ(y: number): number {
  const nyRaw = (y - HAIR_HC) / SKULL_R;
  // Clamp instead of bailing: keeps the surface continuous just below
  // the chin (the goatee tuft reaches y ≈ -0.003).
  const ny = Math.max(-0.999, Math.min(0.999, nyRaw));
  let z = SKULL_R * Math.sqrt(Math.max(0.02, 1 - ny * ny));
  const k = jawTaperK(ny);
  if (k > 0) z *= 1 - 0.18 * Math.pow(k, 1.3);
  const front = sstep(0.12, 0.55, z / SKULL_R);
  if (ny < -0.6) z += 0.0105 * ((-0.6 - ny) / 0.4) * front;
  z += 0.0038 * Math.exp(-Math.pow((ny - 0.3) / 0.1, 2)) * front;
  return z;
}

/**
 * Face-surface Z at a lateral offset x (ellipsoid cross-section of the
 * midline surface), for seating the beard's jaw bands on the cheeks.
 */
export function faceSurfaceZAt(x: number, y: number): number {
  const zc = faceSurfaceZ(y);
  const rx = Math.max(0.02, headRadiusAt(y));
  const t = Math.min(0.95, Math.abs(x) / rx);
  return zc * Math.sqrt(Math.max(0.05, 1 - t * t));
}

export interface FacialHairTint {
  base: string;
  dark: string;
  light: string;
}

/** Tint derived from the hair material's actual colour (follows colorId). */
export function facialHairTint(mats: AvatarMaterials): FacialHairTint {
  const base =
    "#" + (mats.hairMat as THREE.MeshStandardMaterial).color.getHexString();
  return { base, dark: shade(base, -22), light: shade(base, 40) };
}

interface FacialHairMats {
  /** Solid short-hair material (thin tubes). */
  solid: THREE.Material;
  /** Stubble-textured material (patches — the "short" read). */
  textured: THREE.Material;
  tint: FacialHairTint;
}

function buildFHMats(
  T: typeof import("three"),
  mats: AvatarMaterials
): FacialHairMats {
  const tint = facialHairTint(mats);
  const solid = new T.MeshStandardMaterial({
    color: tint.base,
    roughness: 0.92,
    metalness: 0.02,
  });
  // Short-hair read: an opaque hair-colour base (so the patch reads as
  // continuous beard, not sparse speckle) with darker + lighter stubble
  // grain on top. alphaTest is then a no-op safety net.
  const stubbleTex = canvasTexture(
    T,
    128,
    (c) => {
      c.globalAlpha = 1;
      c.fillStyle = tint.base;
      c.fillRect(0, 0, 128, 128);
      paintStubble(c, 128, { seed: 91, dots: 1500, hair: tint.dark });
      paintStubble(c, 128, { seed: 92, dots: 500, hair: tint.light });
    },
    { repeat: [2, 1] }
  );
  const textured = stubbleTex
    ? new T.MeshStandardMaterial({
        color: "#ffffff",
        map: stubbleTex,
        transparent: false,
        alphaTest: 0.35,
        roughness: 0.95,
        metalness: 0.02,
      })
    : solid;
  return { solid, textured, tint };
}

/* ------------------------------------------------------------------ */
/* Styles                                                             */
/* ------------------------------------------------------------------ */

/**
 * Light mustache: two tapered tubes arcing from the philtrum out to the
 * mouth corners, riding the philtrum skin just above the upper lip (the
 * lip's vermilion stays readable below the hair).
 */
function buildMustache(
  T: typeof import("three"),
  fhm: FacialHairMats
): THREE.Object3D[] {
  const parts: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const pts = [
      new T.Vector3(0, 0.0505, faceSurfaceZ(0.0505) + 0.0042),
      new T.Vector3(sx * 0.016, 0.0475, faceSurfaceZ(0.0475) + 0.004),
      new T.Vector3(sx * 0.0305, 0.0405, faceSurfaceZ(0.0405) + 0.0036),
    ];
    const curve = new T.CatmullRomCurve3(pts);
    const geo = new T.TubeGeometry(curve, 10, 0.0048, 4, false);
    taperTube(T, geo, curve, 0.55); // thin toward the mouth corners
    parts.push(new T.Mesh(geo, fhm.solid));
  }
  return parts;
}

/** Chin tuft + soul patch (used by the goatee and the boxed beard). */
function buildChinTuft(
  T: typeof import("three"),
  fhm: FacialHairMats
): THREE.Object3D[] {
  const parts: THREE.Object3D[] = [];
  // Soul patch: small tuft peeking below the lower lip's bottom edge.
  const soul = new T.Mesh(new T.SphereGeometry(0.006, 8, 6), fhm.textured);
  soul.scale.set(1.0, 1.1, 0.5);
  soul.position.set(0, 0.015, faceSurfaceZ(0.015) + 0.004);
  parts.push(soul);
  // Chin tuft: short flattened pad on the chin pad. Bottom kept at or
  // above y=0.008 — any lower and the pole pokes past the chin tip and
  // reads as speckle against the background.
  const tuft = new T.Mesh(new T.SphereGeometry(0.01, 10, 8), fhm.textured);
  tuft.scale.set(1.3, 1.0, 0.45);
  tuft.position.set(0, 0.018, faceSurfaceZ(0.018) + 0.001);
  parts.push(tuft);
  return parts;
}

/**
 * Mustache + chin goatee (the reference look): mustache tubes, soul
 * patch and a short chin tuft. No cheek/jaw coverage.
 */
function buildGoatee(
  T: typeof import("three"),
  fhm: FacialHairMats
): THREE.Object3D[] {
  return [...buildMustache(T, fhm), ...buildChinTuft(T, fhm)];
}

/**
 * Face-surface radius at angle θ (θ=0 → +Z face front, θ=π/2 → +X side)
 * and head-local height y. The surface model is the ellipsoid
 * z = zc·sqrt(1−(x/rx)²), which in polar form (x = r·sinθ, z = r·cosθ)
 * solves in closed form: r = zc / sqrt(cos²θ + (zc/rx)²·sin²θ).
 */
export function surfaceRadiusAt(theta: number, y: number): number {
  const zc = faceSurfaceZ(y);
  const rx = Math.max(0.02, headRadiusAt(y));
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  const k = zc / rx;
  return zc / Math.sqrt(c * c + k * k * s * s);
}

/**
 * Jaw shell: a curved patch following the cheek→jaw surface (a
 * surface-of-revolution strip solved against the analytic face, so it
 * hugs by construction — no rigid corners kicking off the skin). The
 * crisp top edge gives the boxed-beard read; the stubble texture gives
 * the short-hair read.
 */
function buildJawShell(
  T: typeof import("three"),
  sx: 1 | -1,
  fhm: FacialHairMats
): THREE.Mesh {
  const yTop = 0.095;
  const yBot = 0.028;
  const tA = 0.3;
  const tB = 1.35;
  const NY = 5;
  const NT = 7;
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= NY; i++) {
    const y = yBot + ((yTop - yBot) * i) / NY;
    for (let j = 0; j <= NT; j++) {
      const th = tA + ((tB - tA) * j) / NT;
      const r = surfaceRadiusAt(th, y);
      const s = Math.sin(th);
      const c = Math.cos(th);
      // 2.5mm proud of the skin along the (radial) surface normal.
      const off = 0.0025;
      positions.push(sx * (r + off) * s, y, (r + off) * c);
      uvs.push((j / NT) * 2, i / NY);
    }
  }
  for (let i = 0; i < NY; i++) {
    for (let j = 0; j < NT; j++) {
      const a = i * (NT + 1) + j;
      const b = a + 1;
      const d = a + NT + 1;
      const e = d + 1;
      index.push(a, d, b, b, d, e);
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const mat = (fhm.textured as THREE.MeshStandardMaterial).clone();
  mat.side = T.DoubleSide;
  return new T.Mesh(geo, mat);
}

/**
 * Short boxed beard: mustache + chin tuft/soul patch + one curved jaw
 * shell per side. The shells' crisp top edges read as the boxed shape;
 * the stubble texture reads as short hair. (A flat chin block was tried
 * and dropped: its corners floated off the narrow, curving chin.)
 */
function buildBeardShort(
  T: typeof import("three"),
  fhm: FacialHairMats
): THREE.Object3D[] {
  const parts: THREE.Object3D[] = [...buildGoatee(T, fhm)];
  for (const sx of [-1, 1] as const) parts.push(buildJawShell(T, sx, fhm));
  return parts;
}

/* ------------------------------------------------------------------ */
/* Public contract (M4 runtime workstream depends on this signature)    */
/* ------------------------------------------------------------------ */

export type FacialHairStyleId =
  | "facialhair_none_01"
  | "facialhair_mustache_01"
  | "facialhair_goatee_01"
  | "facialhair_beard_short_01";

/**
 * Build facial hair for a head group. Returns null when there is nothing
 * to build ("facialhair_none_01" or an unknown id) — the caller attaches
 * a non-null result to the head group (same as attachHair), so it scales
 * and moves with the head. Colour follows mats.hairMat (the hair
 * colourId), so bald + goatee composes fine.
 */
export function buildFacialHair(
  T: typeof import("three"),
  styleId: string,
  mats: AvatarMaterials
): THREE.Group | null {
  const fhm = buildFHMats(T, mats);
  let parts: THREE.Object3D[];
  switch (styleId as FacialHairStyleId) {
    case "facialhair_mustache_01":
      parts = buildMustache(T, fhm);
      break;
    case "facialhair_goatee_01":
      parts = buildGoatee(T, fhm);
      break;
    case "facialhair_beard_short_01":
      parts = buildBeardShort(T, fhm);
      break;
    case "facialhair_none_01":
    default:
      return null;
  }
  const group = new T.Group();
  group.name = "facialHair";
  for (const p of parts) group.add(p);
  return group;
}

/** Attach built facial hair into a head group (mirrors attachHair). */
export function attachFacialHair(
  head: { group: THREE.Group },
  group: THREE.Group | null
): void {
  if (group) head.group.add(group);
}
