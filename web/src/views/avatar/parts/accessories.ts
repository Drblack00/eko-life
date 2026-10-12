import type * as THREE from "three";
import { mesh } from "./util";

/**
 * Èkó Life Avatar Engine — procedural accessories (M8).
 *
 * 100% original procedural geometry: no external models, no textures.
 * Every material is allocated fresh per call (per-character isolation —
 * the same rule as parts/hair.ts and parts/facialHair.ts): recoloring
 * one avatar can never touch another.
 *
 * Coordinates are head-local (same frame as parts/head.ts):
 * - eyes at (±0.0415, 0.115, 0.0875), skull radius 0.105, centre y 0.105
 * - ear lobes at (±0.1035, 0.085, -0.005)
 *
 * buildAccessory(T, assetId, mats) returns a THREE.Group (or null for
 * unknown ids / none). The assembler attaches the group into the head
 * subtree and owns disposal, exactly like facial hair.
 */

export type AccessoryAssetId =
  | "acc_glasses_01"
  | "acc_cap_01"
  | "acc_earrings_01";

export const ACCESSORY_IDS: readonly AccessoryAssetId[] = [
  "acc_glasses_01",
  "acc_cap_01",
  "acc_earrings_01",
];

/** Slot each accessory occupies (mirrors the manifest slots field). */
export const ACCESSORY_SLOTS: Record<AccessoryAssetId, string> = {
  acc_glasses_01: "face",
  acc_cap_01: "head",
  acc_earrings_01: "ears",
};

/** Shades: dark tinted lenses, thin frame, bridge + temples. */
function buildGlasses(T: typeof import("three")): THREE.Group {
  const group = new T.Group();
  group.name = "accessory:glasses";
  const lensMat = new T.MeshPhysicalMaterial({
    color: "#0e1418",
    roughness: 0.08,
    metalness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    transparent: true,
    opacity: 0.92,
  });
  const frameMat = new T.MeshStandardMaterial({
    color: "#1c1c1e",
    roughness: 0.45,
    metalness: 0.55,
  });
  for (const sx of [-1, 1]) {
    // Lens: a wide, slightly tilted rounded disc.
    const lens = mesh(
      T,
      new T.CylinderGeometry(0.028, 0.028, 0.004, 24),
      lensMat,
      sx * 0.0415,
      0.115,
      0.0985
    );
    lens.rotation.x = Math.PI / 2 - 0.12;
    lens.scale.set(1.18, 1, 0.92);
    group.add(lens);
    // Frame rim around the lens.
    const rim = mesh(
      T,
      new T.TorusGeometry(0.028, 0.0028, 8, 28),
      frameMat,
      sx * 0.0415,
      0.115,
      0.0985
    );
    rim.rotation.x = -0.12;
    rim.scale.set(1.18, 0.92, 1);
    group.add(rim);
    // Temple arm: thin bar from the outer rim back toward the ear.
    const temple = mesh(
      T,
      new T.BoxGeometry(0.0035, 0.0035, 0.075),
      frameMat,
      sx * 0.076,
      0.118,
      0.062
    );
    temple.rotation.y = sx * 0.18;
    group.add(temple);
  }
  // Bridge over the nose.
  const bridge = mesh(
    T,
    new T.TorusGeometry(0.012, 0.0026, 8, 16, Math.PI),
    frameMat,
    0,
    0.116,
    0.0995
  );
  bridge.rotation.z = 0; // arc opening downward
  group.add(bridge);
  return group;
}

/** Snapback cap: crown, forward brim, top button, back strap. */
function buildCap(T: typeof import("three")): THREE.Group {
  const group = new T.Group();
  group.name = "accessory:cap";
  const crownMat = new T.MeshStandardMaterial({
    color: "#1f2937",
    roughness: 0.85,
    metalness: 0,
  });
  const accentMat = new T.MeshStandardMaterial({
    color: "#22d3ee",
    roughness: 0.6,
    metalness: 0.05,
  });
  // Crown: hemisphere sitting high on the skull (above the hairline).
  const crown = mesh(
    T,
    new T.SphereGeometry(0.118, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.52),
    crownMat,
    0,
    0.118,
    -0.008
  );
  crown.scale.set(1, 0.82, 1.04);
  group.add(crown);
  // Front panels seam hint: two thin arcs.
  for (const a of [0.5, -0.5]) {
    const seam = mesh(
      T,
      new T.TorusGeometry(0.115, 0.0016, 6, 24, 0.9),
      accentMat,
      0,
      0.118,
      -0.008
    );
    seam.rotation.z = Math.PI / 2 + a * 0.5;
    seam.rotation.y = Math.PI / 2;
    seam.scale.set(1, 0.82, 1.04);
    group.add(seam);
  }
  // Brim: flattened half-disc jutting forward.
  const brimGeo = new T.CircleGeometry(0.075, 24, Math.PI, Math.PI);
  const brim = mesh(T, brimGeo, crownMat, 0, 0.148, 0.1);
  brim.rotation.x = -Math.PI / 2 + 0.18;
  brim.scale.set(1.15, 0.72, 1);
  const brimEdge = mesh(
    T,
    new T.TorusGeometry(0.075, 0.0022, 6, 24, Math.PI),
    accentMat,
    0,
    0.148,
    0.1
  );
  brimEdge.rotation.x = -Math.PI / 2 + 0.18;
  brimEdge.rotation.z = Math.PI;
  brimEdge.scale.set(1.15, 0.72, 1);
  group.add(brim, brimEdge);
  // Top button.
  group.add(mesh(T, new T.SphereGeometry(0.008, 10, 8), accentMat, 0, 0.222, -0.008));
  // Back strap with a snap gap.
  const strap = mesh(
    T,
    new T.TorusGeometry(0.104, 0.007, 8, 24, 1.1),
    crownMat,
    0,
    0.1,
    -0.008
  );
  strap.rotation.x = Math.PI / 2;
  strap.rotation.z = Math.PI - 0.55;
  group.add(strap);
  return group;
}

/** Hoop earrings: gold hoops hanging at the ear lobes. */
function buildEarrings(T: typeof import("three")): THREE.Group {
  const group = new T.Group();
  group.name = "accessory:earrings";
  const goldMat = new T.MeshStandardMaterial({
    color: "#d4a24e",
    roughness: 0.28,
    metalness: 0.9,
  });
  for (const sx of [-1, 1]) {
    // Stud through the lobe.
    group.add(
      mesh(
        T,
        new T.SphereGeometry(0.004, 8, 6),
        goldMat,
        sx * 0.1035,
        0.085,
        -0.005
      )
    );
    // Hoop hanging below the lobe, facing outward.
    const hoop = mesh(
      T,
      new T.TorusGeometry(0.0115, 0.0026, 8, 24),
      goldMat,
      sx * 0.106,
      0.0705,
      -0.005
    );
    hoop.rotation.y = Math.PI / 2;
    group.add(hoop);
  }
  return group;
}

/**
 * Build one accessory by manifest asset id. Returns null for unknown
 * ids (the assembler treats null as "nothing to attach" — never throws
 * on bad ids).
 */
export function buildAccessory(
  T: typeof import("three"),
  assetId: string
): THREE.Group | null {
  switch (assetId as AccessoryAssetId) {
    case "acc_glasses_01":
      return buildGlasses(T);
    case "acc_cap_01":
      return buildCap(T);
    case "acc_earrings_01":
      return buildEarrings(T);
    default:
      return null;
  }
}

/** Attach built accessory groups into a head group (mirrors attachHair). */
export function attachAccessories(
  head: { group: THREE.Group },
  groups: THREE.Object3D[]
): void {
  for (const g of groups) head.group.add(g);
}
