import type * as THREE from "three";
import { mulberry32 } from "./util";

/**
 * Procedural canvas texture generators for the M20 head rebuild.
 *
 * Everything here is 100% original procedural code — no external assets.
 * All generators are pure functions returning raw RGBA pixel buffers
 * (no DOM), so they are deterministic and unit-testable in node.
 * head.ts uploads the buffers to CanvasTexture at build time
 * (guarded by `typeof document` for SSR/test safety).
 */

export interface PixelImage {
  width: number;
  height: number;
  /** RGBA, row-major. */
  data: Uint8ClampedArray;
}

/** FNV-1a 32-bit hash → stable numeric seed from any string. */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function makeImage(size: number): PixelImage {
  return { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) };
}

function setPx(img: PixelImage, x: number, y: number, r: number, g: number, b: number, a = 255): void {
  const i = (y * img.width + x) * 4;
  img.data[i] = r;
  img.data[i + 1] = g;
  img.data[i + 2] = b;
  img.data[i + 3] = a;
}

/**
 * Subtle pore / tonal-variation overlay for skin.
 *
 * Values stay near white (mean ≈ 248, min ≈ 224) so the buffer acts as a
 * *multiplier* over the skin-tone material colour: pores and blotches only
 * ever darken slightly, never grey-out or ash dark skin tones.
 */
export function buildSkinPoreImage(size: number, seed: number): PixelImage {
  const img = makeImage(size);
  const rand = mulberry32(seed);
  // Low-frequency tonal blotch field (few broad sine modes, deterministic).
  // Kept very subtle: the overlay must read as skin, not mottling.
  const modes: Array<[number, number, number, number]> = [];
  for (let m = 0; m < 5; m++) {
    modes.push([1 + Math.floor(rand() * 4), 1 + Math.floor(rand() * 4), rand() * Math.PI * 2, 0.6 + rand() * 1.0]);
  }
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let blotch = 0;
      for (const [fu, fv, ph, amp] of modes) {
        blotch += Math.sin((u * fu + v * fv) * Math.PI * 2 + ph) * amp;
      }
      const grain = (rand() - 0.5) * 7; // fine per-pixel grain
      const val = Math.max(224, Math.min(255, 250 + blotch + grain));
      setPx(img, x, y, val, val, val);
    }
  }
  // Sparse darker pores.
  const pores = Math.floor((size * size) / 110);
  for (let p = 0; p < pores; p++) {
    const x = Math.floor(rand() * size);
    const y = Math.floor(rand() * size);
    const d = 226 + Math.floor(rand() * 12);
    setPx(img, x, y, d, d, d);
    if (x + 1 < size) setPx(img, x + 1, y, d + 8, d + 8, d + 8);
  }
  return img;
}

/** Iris colour families (base, mid, dark). Picked deterministically by seed. */
const IRIS_PALETTES: Array<[number, number, number][]> = [
  // deep brown
  [[74, 44, 18], [96, 62, 28], [52, 30, 12]],
  // warm hazel
  [[110, 74, 32], [138, 100, 48], [80, 52, 22]],
  // amber
  [[140, 98, 40], [168, 124, 58], [104, 70, 26]],
  // dark green
  [[74, 88, 40], [98, 112, 54], [52, 64, 28]],
  // espresso
  [[58, 34, 16], [78, 48, 24], [40, 22, 10]],
];

/** M8: eye-colour asset id → IRIS_PALETTES index. */
export const EYE_COLOR_PALETTE: Record<string, number> = {
  eye_brown_01: 0,
  eye_hazel_01: 1,
  eye_amber_01: 2,
  eye_green_01: 3,
};

/**
 * Procedural iris: radial fiber striations, limbal ring, collarette,
 * darker pupil core. Unique per seed (one seed per skin tone per build),
 * deterministic for a given seed.
 *
 * The disc is drawn centred in the square buffer; corners are near-black
 * (unused by CircleGeometry UVs).
 */
export function buildIrisImage(size: number, seed: number): PixelImage {
  const rand = mulberry32(seed);
  return buildIrisImageWithPalette(
    size,
    seed,
    Math.floor(rand() * IRIS_PALETTES.length)
  );
}

/**
 * M8: iris with an EXPLICIT palette (eye-colour choice). The seed still
 * drives the per-fiber randomness, so the same eye colour keeps its
 * unique fiber pattern across rebuilds.
 */
export function buildIrisImageWithPalette(
  size: number,
  seed: number,
  paletteIndex: number
): PixelImage {
  const img = makeImage(size);
  const rand = mulberry32(seed);
  const palette =
    IRIS_PALETTES[
      Math.max(0, Math.min(IRIS_PALETTES.length - 1, paletteIndex | 0))
    ];
  const [base, mid, dark] = palette;

  // Per-angle fiber brightness table (720 samples around the disc).
  const FIBERS = 720;
  const fiber: number[] = new Array(FIBERS);
  for (let i = 0; i < FIBERS; i++) fiber[i] = 0.55 + rand() * 0.45;
  // Smooth the table a little so neighbouring fibers blend.
  for (let pass = 0; pass < 2; pass++) {
    const prev = fiber.slice();
    for (let i = 0; i < FIBERS; i++) {
      fiber[i] = (prev[i] + prev[(i + 1) % FIBERS] + prev[(i + FIBERS - 1) % FIBERS]) / 3;
    }
  }
  const radialPhase: number[] = new Array(FIBERS);
  for (let i = 0; i < FIBERS; i++) radialPhase[i] = rand() * Math.PI * 2;

  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - half) / half;
      const dy = (y + 0.5 - half) / half;
      const rr = Math.sqrt(dx * dx + dy * dy);
      let r: number; let g: number; let b: number;
      if (rr > 1) {
        r = 12; g = 8; b = 6;
      } else if (rr < 0.24) {
        // Pupil core (mostly hidden behind the pupil mesh).
        r = 14; g = 10; b = 8;
      } else {
        let ang = Math.atan2(dy, dx);
        if (ang < 0) ang += Math.PI * 2;
        const fi = Math.floor((ang / (Math.PI * 2)) * FIBERS) % FIBERS;
        const f = fiber[fi];
        // Radial striation shimmer along each fiber.
        const shim = 0.82 + 0.18 * Math.sin(rr * 26 + radialPhase[fi]);
        const t = (rr - 0.24) / 0.76; // 0 at pupil edge → 1 at rim
        // Blend dark → base → mid toward the rim, then limbal darkening.
        let cr: number; let cg: number; let cb: number;
        if (t < 0.3) {
          const k = t / 0.3;
          cr = dark[0] + (base[0] - dark[0]) * k;
          cg = dark[1] + (base[1] - dark[1]) * k;
          cb = dark[2] + (base[2] - dark[2]) * k;
        } else {
          const k = (t - 0.3) / 0.7;
          cr = base[0] + (mid[0] - base[0]) * k;
          cg = base[1] + (mid[1] - base[1]) * k;
          cb = base[2] + (mid[2] - base[2]) * k;
        }
        const bright = (0.55 + 0.65 * f) * shim;
        // Collarette: slightly raised lighter ring around the pupil.
        const col = Math.exp(-Math.pow((rr - 0.34) / 0.07, 2)) * 14;
        // Limbal ring: dark rim, kicking in before the edge.
        const limb = Math.max(0, (rr - 0.82) / 0.18);
        const limbDark = 1 - 0.85 * Math.pow(limb, 1.5);
        r = (cr * bright + col) * limbDark;
        g = (cg * bright + col) * limbDark;
        b = (cb * bright + col * 0.8) * limbDark;
      }
      setPx(img, x, y, r, g, b);
    }
  }
  return img;
}

/**
 * Target roughness for a point on the sculpted skull (skull-local coords,
 * radius r): natural sheen on the forehead and nose bridge (T-zone),
 * matte on the cheeks — never a uniform plastic gloss.
 * Pure (unit-testable): returns 0.3..0.8.
 */
export function skinRoughnessAt(
  x: number,
  y: number,
  z: number,
  r: number
): number {
  const ny = y / r;
  const front = Math.max(0, Math.min(1, (z / r - 0.15) / 0.45));
  const fore = Math.max(0, Math.min(1, (ny - 0.42) / 0.33)) * front;
  const bridge =
    Math.exp(-Math.pow((ny - 0.1) / 0.2, 2)) *
    front *
    (1 - Math.min(1, Math.abs(x) / (0.4 * r)));
  const cheek =
    Math.exp(-Math.pow((ny - 0.02) / 0.22, 2)) *
    Math.min(1, Math.abs(x) / r);
  const rough = 0.6 - 0.24 * fore - 0.2 * bridge + 0.14 * cheek;
  return Math.max(0.3, Math.min(0.8, rough));
}

/**
 * Paint a roughness map for the sculpted skull: splat per-vertex
 * skinRoughnessAt() values through the geometry's own UVs into a coarse
 * grid, then bilinear-upsample to the canvas. Deterministic.
 * Returns null outside a DOM.
 */
export function paintSkullRoughnessTexture(
  T: typeof import("three"),
  geo: THREE.BufferGeometry,
  r: number
): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const GW = 96;
  const GH = 48;
  const sum = new Float32Array(GW * GH);
  const wgt = new Float32Array(GW * GH);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const vx = new T.Vector3();
  for (let i = 0; i < pos.count; i++) {
    vx.fromBufferAttribute(pos, i);
    const u = Math.min(0.9999, Math.max(0, uv.getX(i)));
    const v = Math.min(0.9999, Math.max(0, uv.getY(i)));
    const rough = skinRoughnessAt(vx.x, vx.y, vx.z, r);
    const gx = u * (GW - 1);
    const gy = (1 - v) * (GH - 1);
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
        const gi = (y0 + dy) * GW + (x0 + dx);
        sum[gi] += rough * w;
        wgt[gi] += w;
      }
    }
  }
  const CW = 192;
  const CH = 96;
  const canvas = document.createElement("canvas");
  canvas.width = CW;
  canvas.height = CH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const id = ctx.createImageData(CW, CH);
  for (let y = 0; y < CH; y++) {
    const gy = (y / (CH - 1)) * (GH - 1);
    const y0 = Math.min(GH - 2, Math.floor(gy));
    const fy = gy - y0;
    for (let x = 0; x < CW; x++) {
      const gx = (x / (CW - 1)) * (GW - 1);
      const x0 = Math.min(GW - 2, Math.floor(gx));
      const fx = gx - x0;
      let acc = 0;
      let wsum = 0;
      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = 0; dx <= 1; dx++) {
          const gi = (y0 + dy) * GW + (x0 + dx);
          const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
          acc += sum[gi] * w;
          wsum += wgt[gi] * w;
        }
      }
      const rough = wsum > 1e-6 ? acc / wsum : 0.6;
      const byte = Math.round(rough * 255);
      const o = (y * CW + x) * 4;
      id.data[o] = byte;
      id.data[o + 1] = byte;
      id.data[o + 2] = byte;
      id.data[o + 3] = 255;
    }
  }
  ctx.putImageData(id, 0, 0);
  const tex = new T.CanvasTexture(canvas);
  // Roughness data must stay linear (no sRGB decode).
  tex.wrapS = T.ClampToEdgeWrapping;
  tex.wrapT = T.ClampToEdgeWrapping;
  return tex;
}

export interface SkinMaterialOpts {
  /** Base roughness (used where no roughness map applies). */
  roughness?: number;
  /** Optional zone-painted roughness map (face). Linear data. */
  roughnessMap?: THREE.Texture | null;
  /**
   * Cheap SSS approximation: warm skin-tinted emissive lift so shadowed
   * areas (ears, nose wings) glow faintly instead of going dead.
   * Keep ≤ 0.12 or it flattens the shading.
   */
  sssGlow?: number;
}

/**
 * Shared PBR skin material for face + body so tone stays consistent
 * across every skin part. Pore multiplier map (never greys dark skin),
 * subtle pore bump, zone-varying roughness on the face, sheen + a faint
 * clearcoat for the natural T-zone sheen — not plastic.
 */
export function buildSkinMaterial(
  T: typeof import("three"),
  skin: string,
  opts: SkinMaterialOpts = {}
): THREE.MeshPhysicalMaterial {
  const seed = hashSeed(skin);
  const poreTex = toCanvasTexture(T, buildSkinPoreImage(256, seed));
  const bumpTex = toCanvasTexture(T, buildSkinPoreImage(256, seed), false);
  const mat = new T.MeshPhysicalMaterial({
    color: skin,
    map: poreTex ?? undefined,
    bumpMap: bumpTex ?? undefined,
    bumpScale: 0.12,
    roughnessMap: opts.roughnessMap ?? undefined,
    roughness: opts.roughness ?? 0.58,
    metalness: 0,
    clearcoat: 0.1,
    clearcoatRoughness: 0.7,
    sheen: 0.22,
    sheenRoughness: 0.65,
    sheenColor: new T.Color(skin),
  });
  if (opts.sssGlow) {
    mat.emissive = new T.Color(skin);
    mat.emissiveIntensity = opts.sssGlow;
  }
  return mat;
}

/**
 * Upload a PixelImage to a THREE.CanvasTexture. Returns null outside a DOM
 * (node tests / SSR) so pure logic stays importable everywhere.
 */
export function toCanvasTexture(
  T: typeof import("three"),
  img: PixelImage,
  srgb = true
): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const id = ctx.createImageData(img.width, img.height);
  id.data.set(img.data);
  ctx.putImageData(id, 0, 0);
  const tex = new T.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
