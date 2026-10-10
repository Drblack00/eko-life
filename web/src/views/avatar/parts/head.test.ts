/**
 * M20 head rebuild — unit tests. Pure logic only (node env, no DOM):
 * texture-generator determinism, sculpt math, and the buildHead contract
 * (groups, skull placement, blink scaling, triangle budget).
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  buildIrisImage,
  buildSkinPoreImage,
  hashSeed,
} from "./faceTextures";
import {
  buildHead,
  cheekBoost,
  distToSeg,
  HEAD_R,
  jawTaperK,
  sstep,
} from "./head";
import { buildMaterials } from "./materials";
import type { AvatarLook } from "../../../game/types";

describe("hashSeed", () => {
  it("is deterministic and spreads different inputs", () => {
    expect(hashSeed("cocoa")).toBe(hashSeed("cocoa"));
    expect(hashSeed("cocoa")).not.toBe(hashSeed("cream"));
    expect(hashSeed("#8a5f38")).toBeGreaterThanOrEqual(0);
  });
});

describe("buildSkinPoreImage", () => {
  it("is deterministic per seed and unique per seed", () => {
    const a = buildSkinPoreImage(32, 7);
    const b = buildSkinPoreImage(32, 7);
    const c = buildSkinPoreImage(32, 8);
    expect(a.data).toEqual(b.data);
    expect(a.data).not.toEqual(c.data);
  });
  it("stays near-white so dark skin never looks ashy", () => {
    const img = buildSkinPoreImage(64, 1234);
    let min = 255;
    let sum = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      const v = img.data[i];
      if (v < min) min = v;
      sum += v;
      expect(img.data[i + 1]).toBe(v); // grayscale
      expect(img.data[i + 2]).toBe(v);
      expect(img.data[i + 3]).toBe(255);
    }
    const mean = sum / (img.data.length / 4);
    expect(min).toBeGreaterThanOrEqual(224);
    expect(mean).toBeGreaterThan(244);
  });
});

describe("buildIrisImage", () => {
  it("is deterministic per seed and unique per seed", () => {
    const a = buildIrisImage(32, 42);
    const b = buildIrisImage(32, 42);
    const c = buildIrisImage(32, 43);
    expect(a.data).toEqual(b.data);
    expect(a.data).not.toEqual(c.data);
  });
  it("has a dark pupil core and a darker limbal rim than the mid iris", () => {
    const size = 96;
    const img = buildIrisImage(size, 99);
    const px = (x: number, y: number) => {
      const i = (y * size + x) * 4;
      return (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
    };
    const c = size / 2;
    const core = px(Math.floor(c), Math.floor(c));
    expect(core).toBeLessThan(40); // pupil core near-black
    // Average brightness over full rings: limbal band vs mid-iris band.
    let midSum = 0;
    let midN = 0;
    let rimSum = 0;
    let rimN = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5 - c) / c;
        const dy = (y + 0.5 - c) / c;
        const rr = Math.sqrt(dx * dx + dy * dy);
        if (rr >= 0.45 && rr < 0.6) {
          midSum += px(x, y);
          midN++;
        } else if (rr >= 0.92 && rr < 0.98) {
          rimSum += px(x, y);
          rimN++;
        }
      }
    }
    const midAvg = midSum / midN;
    const rimAvg = rimSum / rimN;
    expect(midAvg).toBeGreaterThan(25); // iris body carries real colour
    expect(rimAvg).toBeLessThan(midAvg * 0.9); // limbal ring darkens the rim
  });
});

describe("sculpt math", () => {
  it("sstep clamps and smooths", () => {
    expect(sstep(0, 1, -1)).toBe(0);
    expect(sstep(0, 1, 2)).toBe(1);
    expect(sstep(0, 1, 0.5)).toBeCloseTo(0.5, 5);
  });
  it("jawTaperK is 0 above the jaw and ramps to 1 at the chin", () => {
    expect(jawTaperK(0.5)).toBe(0);
    expect(jawTaperK(0.18)).toBe(0);
    expect(jawTaperK(-1)).toBe(1);
    const mid = jawTaperK(-0.4);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
  it("cheekBoost peaks just below the eyes", () => {
    expect(cheekBoost(0.03)).toBeGreaterThan(cheekBoost(0.5));
    expect(cheekBoost(0.03)).toBeGreaterThan(cheekBoost(-0.5));
    expect(cheekBoost(0.03)).toBeCloseTo(1, 5);
  });
  it("distToSeg measures point-segment distance", () => {
    expect(distToSeg(0, 0, -1, 0, 1, 0)).toBeCloseTo(0, 5);
    expect(distToSeg(0, 3, -1, 0, 1, 0)).toBeCloseTo(3, 5);
    expect(distToSeg(5, 0, -1, 0, 1, 0)).toBeCloseTo(4, 5); // clamped to endpoint
  });
});

const LOOK: AvatarLook = {
  body: "woman",
  skin: "cocoa",
  hair: "lowcut",
  outfit: "casual",
  fabric: "plain",
  topColor: "#ffffff",
  bottomColor: "#111111",
};

function countTris(group: THREE.Group): { total: number; parts: Record<string, number> } {
  let total = 0;
  const parts: Record<string, number> = {};
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && (m.userData as { ws1?: boolean }).ws1) {
      const g = m.geometry as THREE.BufferGeometry;
      const idx = g.index;
      const t = Math.round((idx ? idx.count : g.attributes.position.count) / 3);
      total += t;
      const p = (m.userData as { part?: string }).part ?? "?";
      parts[p] = (parts[p] ?? 0) + t;
    }
  });
  return { total, parts };
}

describe("buildHead", () => {
  const mats = buildMaterials(THREE, LOOK);
  const built = buildHead(THREE, { skin: "#8a5f38", mats });

  it("returns a group plus two eye Groups (blink contract)", () => {
    expect(built.group).toBeInstanceOf(THREE.Group);
    expect(built.eyeL).toBeInstanceOf(THREE.Group);
    expect(built.eyeR).toBeInstanceOf(THREE.Group);
    // The idle loop blinks by scaling scale.y — must stay functional.
    built.eyeL.scale.y = 0.08;
    built.eyeR.scale.y = 0.08;
    expect(built.eyeL.scale.y).toBeCloseTo(0.08, 5);
    built.eyeL.scale.y = 1;
    built.eyeR.scale.y = 1;
  });

  it("places the skull at the frozen centre with the frozen radius", () => {
    expect(HEAD_R).toBeCloseTo(0.105, 5);
    const skull = built.group.children.find(
      (c) => (c.userData as { part?: string }).part === "skull"
    ) as THREE.Mesh;
    expect(skull).toBeDefined();
    expect(skull.position.y).toBeCloseTo(0.105, 5); // HC — hair worker depends on this
    skull.geometry.computeBoundingSphere();
    expect(skull.geometry.boundingSphere?.radius).toBeCloseTo(HEAD_R, 1);
  });

  it("keeps eyes symmetric about the face centre, facing +Z", () => {
    expect(built.eyeL.position.x).toBeCloseTo(-built.eyeR.position.x, 6);
    expect(built.eyeL.position.y).toBeCloseTo(built.eyeR.position.y, 6);
    expect(built.eyeL.position.z).toBeGreaterThan(0);
  });

  it("stays inside the 6–9k head triangle budget", () => {
    const { total, parts } = countTris(built.group);
    // eslint-disable-next-line no-console
    console.log("head triangles:", total, JSON.stringify(parts));
    expect(total).toBeGreaterThanOrEqual(6000);
    expect(total).toBeLessThanOrEqual(9000);
  });
});
