/**
 * Èkó Life avatar — M8 accessory builder tests.
 *
 * Node environment (no DOM): geometry/material/graph behaviour is fully
 * testable; no canvas textures are involved.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  ACCESSORY_IDS,
  ACCESSORY_SLOTS,
  attachAccessories,
  buildAccessory,
} from "./accessories";

describe("accessories", () => {
  it("builds all 3 accessories as non-empty groups", () => {
    for (const id of ACCESSORY_IDS) {
      const g = buildAccessory(THREE, id);
      expect(g).not.toBeNull();
      expect(g!.isGroup).toBe(true);
      // Real geometry inside — not an empty placeholder.
      let meshes = 0;
      g!.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes++;
      });
      expect(meshes).toBeGreaterThan(2);
    }
  });

  it("returns null for unknown ids (never throws)", () => {
    expect(buildAccessory(THREE, "acc_monocle_99")).toBeNull();
    expect(buildAccessory(THREE, "")).toBeNull();
    expect(buildAccessory(THREE, "../../../etc/passwd")).toBeNull();
  });

  it("slot mapping matches the manifest contract", () => {
    expect(ACCESSORY_SLOTS).toEqual({
      acc_glasses_01: "face",
      acc_cap_01: "head",
      acc_earrings_01: "ears",
    });
  });

  it("attachAccessories adds groups to the head group", () => {
    const head = { group: new THREE.Group() };
    const g = buildAccessory(THREE, "acc_glasses_01")!;
    attachAccessories(head, [g]);
    expect(head.group.children).toContain(g);
  });

  it("allocates fresh materials per call (per-character isolation)", () => {
    const a = buildAccessory(THREE, "acc_earrings_01")!;
    const b = buildAccessory(THREE, "acc_earrings_01")!;
    const matsA = new Set<THREE.Material>();
    const matsB = new Set<THREE.Material>();
    a.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) matsA.add(m.material as THREE.Material);
    });
    b.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) matsB.add(m.material as THREE.Material);
    });
    for (const m of matsA) expect(matsB.has(m)).toBe(false);
  });
});
