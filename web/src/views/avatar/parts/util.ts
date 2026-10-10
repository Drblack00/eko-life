import type * as THREE from "three";

/**
 * Shared low-level builders for avatar parts. All functions take the
 * three.js namespace explicitly so parts stay testable without a DOM.
 */

/** Deterministic PRNG so hair volumes are stable across rebuilds. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lathe mesh from [radius, height] profile points (smooth normals). */
export function lathe(
  T: typeof import("three"),
  pts: Array<[number, number]>,
  mat: THREE.Material,
  segments = 20
): THREE.Mesh {
  const v2 = pts.map(([x, y]) => new T.Vector2(Math.max(0.0001, x), y));
  const geo = new T.LatheGeometry(v2, segments);
  return new T.Mesh(geo, mat);
}

/** Mesh positioned at (x, y, z). */
export function mesh(
  T: typeof import("three"),
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0
): THREE.Mesh {
  const m = new T.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}
