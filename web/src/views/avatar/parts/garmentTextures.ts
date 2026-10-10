import type * as THREE from "three";
import { mulberry32 } from "./util";
import { shade } from "./materials";
import { canvasTexture, type PaintCtx } from "./strandTextures";

/**
 * Procedural canvas textures for garments (workstream 2: hair & clothing).
 * 100% original runtime-painted textures — no image assets.
 * Re-exports canvasTexture for convenience.
 */

export { canvasTexture };

export interface RibKnitOpts {
  seed?: number;
  /** Base fabric colour — ribs are painted as shaded variants of it. */
  base: string;
  ribs?: number;
}

/**
 * Ribbed knit (collars, cuffs, waistbands): vertical ribs in lighter /
 * darker variants of the base colour. Used as a colour map so the knit
 * reads at avatar scale; pair with the same canvas as a bump map.
 */
export function paintRibKnit(
  ctx: PaintCtx,
  size: number,
  opts: RibKnitOpts
): void {
  const { base } = opts;
  const ribs = opts.ribs ?? 14;
  const rand = mulberry32(opts.seed ?? 5);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const w = size / ribs;
  for (let i = 0; i < ribs; i++) {
    const x = i * w;
    ctx.fillStyle = shade(base, -34);
    ctx.fillRect(x, 0, w * 0.3, size);
    ctx.fillStyle = shade(base, 30);
    ctx.fillRect(x + w * 0.38, 0, w * 0.3, size);
    // Occasional knit slub for hand-made feel.
    if (rand() < 0.3) {
      ctx.fillStyle = shade(base, -52);
      ctx.fillRect(x + w * 0.1, rand() * size, w * 0.5, 1.5);
    }
  }
}

export interface WeaveOpts {
  seed?: number;
}

/** Subtle woven cross-hatch — grayscale, intended as a bump map. */
export function paintWeave(ctx: PaintCtx, size: number, opts: WeaveOpts = {}): void {
  const rand = mulberry32(opts.seed ?? 9);
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, size, size);
  const cell = 4;
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const over = ((x + y) / cell) % 2 === 0;
      const v = 128 + (over ? 22 : -22) + Math.floor((rand() - 0.5) * 18);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, y, cell, cell);
    }
  }
}

export interface StitchOpts {
  seed?: number;
  color?: string;
  dash?: number;
  gap?: number;
}

/**
 * Thread stitch dashes on a transparent field — fly stitching, placket
 * edges, pocket outlines. Apply to a thin plane with transparent:true.
 */
export function paintStitches(
  ctx: PaintCtx,
  size: number,
  opts: StitchOpts = {}
): void {
  const { color = "#d8d2c4", dash = 7, gap = 5 } = opts;
  const rand = mulberry32(opts.seed ?? 13);
  ctx.fillStyle = color;
  const y = size / 2;
  for (let x = 2; x < size - dash; x += dash + gap) {
    const wob = (rand() - 0.5) * 1.4;
    ctx.save();
    ctx.translate(x, y + wob);
    ctx.rotate((rand() - 0.5) * 0.12);
    ctx.fillRect(0, -1.1, dash, 2.2);
    ctx.restore();
  }
}

export interface TreadOpts {
  seed?: number;
}

/** Chevron sole tread — grayscale, intended as a bump map. */
export function paintTread(ctx: PaintCtx, size: number, opts: TreadOpts = {}): void {
  const rand = mulberry32(opts.seed ?? 17);
  ctx.fillStyle = "#7a7a7a";
  ctx.fillRect(0, 0, size, size);
  const rows = 6;
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    const y = r * rh;
    const flip = r % 2 === 0 ? 1 : -1;
    for (let x = 0; x < size; x += 16) {
      const v = 150 + Math.floor((rand() - 0.5) * 24);
      ctx.strokeStyle = `rgb(${v},${v},${v})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x, y + rh * 0.15);
      ctx.lineTo(x + 8, y + rh * (flip > 0 ? 0.85 : 0.15));
      ctx.lineTo(x + 16, y + rh * 0.15);
      ctx.stroke();
    }
  }
}

/** Convenience: rib-knit colour+bump texture pair for a garment colour. */
export function ribKnitTextures(
  T: typeof import("three"),
  base: string
): { map: THREE.CanvasTexture | null; bump: THREE.CanvasTexture | null } {
  const paint = (ctx: PaintCtx) => paintRibKnit(ctx, 128, { base, seed: 5 });
  const map = canvasTexture(T, 128, paint, { repeat: [6, 1] });
  const bump = canvasTexture(T, 128, paint, {
    repeat: [6, 1],
    srgb: false,
  });
  return { map, bump };
}

/** Convenience: woven bump texture (colour-neutral). */
export function weaveTexture(
  T: typeof import("three")
): THREE.CanvasTexture | null {
  return canvasTexture(T, 128, (ctx) => paintWeave(ctx, 128), {
    repeat: [4, 4],
    srgb: false,
  });
}

/** Convenience: stitch strip texture (transparent background). */
export function stitchTexture(
  T: typeof import("three"),
  color = "#d8d2c4"
): THREE.CanvasTexture | null {
  return canvasTexture(T, 128, (ctx) => paintStitches(ctx, 128, { color }), {
    repeat: [3, 1],
  });
}

/** Convenience: sole tread bump texture. */
export function treadTexture(
  T: typeof import("three")
): THREE.CanvasTexture | null {
  return canvasTexture(T, 128, (ctx) => paintTread(ctx, 128), {
    repeat: [2, 4],
    srgb: false,
  });
}
