import type * as THREE from "three";
import { mulberry32 } from "./util";
import { shade } from "./materials";

/**
 * Procedural canvas textures for hair (workstream 2: hair & clothing).
 * 100% original code — everything is painted at runtime, no image assets.
 *
 * Painters draw onto a minimal PaintCtx so they stay unit-testable with a
 * fake recording context. canvasTexture() binds a painter to three.js;
 * it returns null outside a DOM (node tests, SSR) and callers must fall
 * back to the plain material in that case.
 */

export interface PaintGradient {
  addColorStop(offset: number, color: string): void;
}

export interface PaintCtx {
  fillStyle: string | PaintGradient;
  strokeStyle: string | PaintGradient;
  lineWidth: number;
  globalAlpha: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  arc(
    x: number,
    y: number,
    r: number,
    a0: number,
    a1: number,
    ccw?: boolean
  ): void;
  fill(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(a: number): void;
  createLinearGradient(
    x0: number,
    y0: number,
    x1: number,
    y1: number
  ): PaintGradient;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number
  ): PaintGradient;
}

const TAU = Math.PI * 2;

export interface StubbleOpts {
  seed: number;
  dots?: number;
  hair?: string;
  /** Fade the speckle alpha toward the canvas bottom (lowcut fade). */
  fadeBottom?: boolean;
  /** Canvas-y fraction where the fade starts (default 0.7). */
  fadeStart?: number;
}

/**
 * Stubble speckle field. On a sphere cap the canvas bottom edge maps to
 * the cap rim, so fadeBottom gives a barber-style fade into the hairline.
 */
export function paintStubble(
  ctx: PaintCtx,
  size: number,
  opts: StubbleOpts
): void {
  const {
    seed,
    hair = "#171110",
    fadeBottom = false,
    fadeStart = 0.7,
  } = opts;
  const dots = opts.dots ?? 900;
  const rand = mulberry32(seed);
  for (let i = 0; i < dots; i++) {
    const x = rand() * size;
    const y = rand() * size;
    let a = 0.5 + rand() * 0.5;
    if (fadeBottom) {
      const f = y / size; // 0 top → 1 bottom (cap rim)
      if (f > fadeStart)
        a *= Math.max(0, 1 - (f - fadeStart) / (1 - fadeStart));
    }
    if (a <= 0.03) continue;
    ctx.globalAlpha = a;
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.arc(x, y, 0.6 + rand() * 1.2, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export interface FlowOpts {
  seed: number;
  strands?: number;
  /** Flow direction in radians (canvas space). */
  angle?: number;
  /** Chevron zig-zag strokes (loc/braid twist) vs smooth flow lines. */
  twist?: boolean;
  base?: string;
  dark?: string;
  light?: string;
  /** Stroke alpha range [min, max]. */
  alpha?: [number, number];
  /** Multiplier for stroke width (fine twist detail < 1). */
  lineScale?: number;
}

/** Directional strand streaks: twist chevrons for locs/braids, flow lines for classic. */
export function paintStrandFlow(
  ctx: PaintCtx,
  size: number,
  opts: FlowOpts
): void {
  const {
    seed,
    angle = 0.45,
    twist = false,
    base = "#171110",
    dark = "#0b0705",
    light = "#4a3a2e",
    alpha = [0.45, 0.95],
    lineScale = 1,
  } = opts;
  const strands = opts.strands ?? 46;
  const rand = mulberry32(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(angle);
  for (let s = 0; s < strands; s++) {
    const sx = (rand() - 0.5) * size * 1.4;
    ctx.strokeStyle = rand() < 0.55 ? dark : light;
    ctx.lineWidth = (1 + rand() * 1.8) * lineScale;
    ctx.globalAlpha = alpha[0] + rand() * (alpha[1] - alpha[0]);
    ctx.beginPath();
    if (twist) {
      const phase = rand() * TAU;
      const segs = 7;
      for (let k = 0; k <= segs; k++) {
        const yy = -size * 0.75 + (k / segs) * size * 1.5;
        const xx = sx + Math.sin(phase + k * 1.35) * size * 0.045;
        if (k === 0) ctx.moveTo(xx, yy);
        else ctx.lineTo(xx, yy);
      }
    } else {
      const drift = (rand() - 0.5) * size * 0.22;
      ctx.moveTo(sx, -size * 0.75);
      ctx.lineTo(sx + drift * 0.5, 0);
      ctx.lineTo(sx + drift, size * 0.75);
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

export interface FrizzOpts {
  seed: number;
  strokes?: number;
  base?: string;
  dark?: string;
  light?: string;
}

/** Dense short multidirectional strokes — picked-out afro / root fuzz detail. */
export function paintFrizz(ctx: PaintCtx, size: number, opts: FrizzOpts): void {
  const {
    seed,
    base = "#171110",
    dark = "#0a0605",
    light = "#54402f",
  } = opts;
  const strokes = opts.strokes ?? 700;
  const rand = mulberry32(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.lineWidth = 1;
  for (let i = 0; i < strokes; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const a = rand() * TAU;
    const len = 2 + rand() * 5;
    ctx.strokeStyle = rand() < 0.5 ? dark : light;
    ctx.globalAlpha = 0.3 + rand() * 0.45;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export interface SheenOpts {
  seed: number;
  skin: string;
  stubble?: string;
}

/**
 * Bald scalp: skin base, polished crown highlight, sparse dark stubble
 * speckles so it never reads as plain skin geometry.
 */
export function paintScalpSheen(
  ctx: PaintCtx,
  size: number,
  opts: SheenOpts
): void {
  const { seed, skin, stubble = "#241a12" } = opts;
  const rand = mulberry32(seed);
  ctx.fillStyle = skin;
  ctx.fillRect(0, 0, size, size);
  // Crown highlight (canvas top-centre maps near the skull top).
  const g = ctx.createRadialGradient(
    size * 0.5,
    size * 0.34,
    2,
    size * 0.5,
    size * 0.34,
    size * 0.42
  );
  g.addColorStop(0, shade(skin, 34));
  g.addColorStop(1, skin);
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 1;
  // Sparse stubble.
  for (let i = 0; i < 260; i++) {
    ctx.globalAlpha = 0.18 + rand() * 0.3;
    ctx.fillStyle = stubble;
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, 0.5 + rand() * 0.8, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export interface CanvasTextureOpts {
  repeat?: [number, number];
  rotation?: number;
  srgb?: boolean;
}

/** Bind a painter to a three.js CanvasTexture. Null when no DOM is present. */
export function canvasTexture(
  T: typeof import("three"),
  size: number,
  paint: (ctx: PaintCtx) => void,
  opts: CanvasTextureOpts = {}
): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const raw = canvas.getContext("2d");
  if (!raw) return null;
  paint(raw as unknown as PaintCtx);
  const tex = new T.CanvasTexture(canvas);
  tex.wrapS = T.RepeatWrapping;
  tex.wrapT = T.RepeatWrapping;
  const [rx, ry] = opts.repeat ?? [1, 1];
  tex.repeat.set(rx, ry);
  if (opts.rotation) {
    tex.center.set(0.5, 0.5);
    tex.rotation = opts.rotation;
  }
  if (opts.srgb !== false) tex.colorSpace = T.SRGBColorSpace;
  return tex;
}
