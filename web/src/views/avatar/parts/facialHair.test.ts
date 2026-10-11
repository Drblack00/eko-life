import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  attachFacialHair,
  buildFacialHair,
  faceSurfaceZ,
  faceSurfaceZAt,
} from "./facialHair";
import { attachHair, buildHair, HAIR_COLOR_HEX } from "./hair";
import { buildMaterials } from "./materials";
import { buildHead } from "./head";
import { buildAvatarLook } from "../avatarModel";
import { AVATAR_MANIFEST_BY_ID } from "../../../avatar/manifest";
import { resolveAsset } from "../../../avatar/resolver";
import { validateAppearance } from "../../../avatar/validation";
import type { AvatarLook } from "../../../game/types";

const LOOK: AvatarLook = {
  body: "man",
  skin: "cocoa",
  hair: "lowcut",
  outfit: "casual",
  fabric: "plain",
  topColor: "#22d3ee",
  bottomColor: "#334155",
};

const mats = () => buildMaterials(THREE, LOOK);

/** Full triangle count over every mesh in a group (no part filter). */
function countAllTris(root: THREE.Object3D): number {
  let total = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const g = m.geometry as THREE.BufferGeometry;
      const idx = g.index;
      total += Math.round(
        (idx ? idx.count : g.attributes.position.count) / 3
      );
    }
  });
  return total;
}

/** Wrap loose parts in a group so materialColors/countAllTris accept them. */
function partsGroup(parts: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  for (const p of parts) g.add(p);
  return g;
}

/** All material colours used by a subtree, as #rrggbb strings. */
function materialColors(root: THREE.Object3D): string[] {
  const out = new Set<string>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const arr = Array.isArray(m.material) ? m.material : [m.material];
    for (const mm of arr) {
      const c = (mm as THREE.MeshStandardMaterial).color;
      if (c) out.add("#" + c.getHexString());
    }
  });
  return [...out];
}

const FACIAL_HAIR_IDS = [
  "facialhair_mustache_01",
  "facialhair_goatee_01",
  "facialhair_beard_short_01",
];

describe("buildFacialHair", () => {
  it("returns null for none and for unknown ids", () => {
    expect(buildFacialHair(THREE, "facialhair_none_01", mats())).toBeNull();
    expect(buildFacialHair(THREE, "facialhair_zzz", mats())).toBeNull();
  });

  it.each(FACIAL_HAIR_IDS)("builds %s without throwing", (id) => {
    const g = buildFacialHair(THREE, id, mats());
    expect(g).toBeInstanceOf(THREE.Group);
    expect(g!.name).toBe("facialHair");
    const meshes: THREE.Mesh[] = [];
    g!.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    expect(meshes.length).toBeGreaterThan(0);
  });

  it("stays under the per-style 600-triangle budget", () => {
    for (const id of FACIAL_HAIR_IDS) {
      const g = buildFacialHair(THREE, id, mats())!;
      const tris = countAllTris(g);
      // eslint-disable-next-line no-console
      console.log(`facial hair ${id}: ${tris} tris`);
      expect(tris).toBeLessThan(600);
    }
  });

  it("attaches to the head group (scales/moves with the head)", () => {
    const head = buildHead(THREE, { skin: "#8a5f38", mats: mats() });
    const g = buildFacialHair(THREE, "facialhair_goatee_01", mats())!;
    attachFacialHair(head, g);
    expect(g.parent).toBe(head.group);
    // Attaching null is a no-op.
    attachFacialHair(head, null);
  });

  it("colour follows mats.hairMat (tracks the hair colourId)", () => {
    const def = buildFacialHair(THREE, "facialhair_goatee_01", mats())!;
    expect(materialColors(def)).toContain("#171110");

    const brown = { ...mats() };
    brown.hairMat = new THREE.MeshStandardMaterial({ color: "#3b2417" });
    const g = buildFacialHair(THREE, "facialhair_goatee_01", brown)!;
    expect(materialColors(g)).toContain("#3b2417");
  });

  it("geometry hugs the face: no floating, every piece touches skin", () => {
    // Point-cloud oracle over the analytic lower-face surface. Every
    // vertex must lie within 20mm of the skin in 3D (no floating), and
    // every mesh must touch the skin somewhere (min distance < 10mm).
    const cloud: THREE.Vector3[] = [];
    for (let y = -0.005; y <= 0.105; y += 0.0025) {
      for (let x = -0.11; x <= 0.11; x += 0.0025) {
        cloud.push(new THREE.Vector3(x, y, faceSurfaceZAt(x, y)));
      }
    }
    const distToFace = (v: THREE.Vector3): { unsigned: number; signed: number } => {
      let d = Infinity;
      let sz = 0;
      for (const c of cloud) {
        const dd = v.distanceToSquared(c);
        if (dd < d) {
          d = dd;
          sz = c.z;
        }
      }
      const unsigned = Math.sqrt(d);
      // Sign from the z of the nearest surface point: negative = embedded
      // in the face (hidden, fine), positive = proud of the skin.
      return { unsigned, signed: v.z - sz };
    };
    for (const id of FACIAL_HAIR_IDS) {
      const g = buildFacialHair(THREE, id, mats())!;
      g.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      let globalMax = 0;
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const pos = m.geometry.attributes.position as THREE.BufferAttribute;
        let meshTouch = Infinity;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          // Facial hair lives on the face: front half, mouth/chin band.
          expect(v.z).toBeGreaterThan(0.0);
          expect(v.y).toBeGreaterThan(-0.02);
          expect(v.y).toBeLessThan(0.12);
          const d = distToFace(v);
          meshTouch = Math.min(meshTouch, Math.abs(d.signed));
          globalMax = Math.max(globalMax, d.unsigned);
        }
        // Every piece touches (or slightly embeds into) the skin.
        expect(meshTouch).toBeLessThan(0.012);
      });
      // eslint-disable-next-line no-console
      console.log(`facial hair ${id}: max vertex-to-face distance ${globalMax.toFixed(4)}`);
      expect(globalMax).toBeLessThan(0.02);
    }
  });
});

describe("faceSurfaceZ", () => {
  it("is sane: mouth surface ahead of chin surface, all finite", () => {
    const zMouth = faceSurfaceZ(0.048); // mustache zone
    const zChin = faceSurfaceZ(0.008); // chin zone
    expect(Number.isFinite(zMouth)).toBe(true);
    expect(Number.isFinite(zChin)).toBe(true);
    expect(zMouth).toBeGreaterThan(0.05);
    expect(zMouth).toBeLessThan(0.1);
    expect(zChin).toBeGreaterThan(0.02);
    expect(zChin).toBeLessThan(0.08);
    // Chin recedes slightly behind the lip line.
    expect(zChin).toBeLessThan(zMouth);
  });
});

describe("buildHair colorId", () => {
  it("leaves existing callers byte-identical (no colour → default black)", () => {
    const parts = buildHair(THREE, "lowcut", mats());
    expect(materialColors(partsGroup(parts))).not.toContain(
      "#3b2417"
    );
  });

  it("tints solid hair + strand textures for a registered colour", () => {
    const parts = buildHair(THREE, "lowcut", mats(), "hair_dark_brown_01");
    const colors = materialColors(partsGroup(parts));
    expect(colors).toContain("#3b2417");
  });

  it("unknown colour id falls back to default black without throwing", () => {
    const parts = buildHair(THREE, "waves", mats(), "hair_nope_01");
    const colors = materialColors(partsGroup(parts));
    expect(colors).not.toContain("#3b2417");
    expect(colors).toContain("#171110");
  });

  it("hair_black_01 explicitly keeps the M3 default", () => {
    const parts = buildHair(THREE, "afro", mats(), "hair_black_01");
    const colors = materialColors(partsGroup(parts));
    expect(colors).not.toContain("#3b2417");
  });
});

describe("manifest: M3b assets", () => {
  const NEW_IDS = [
    "hair_taper_fade_01",
    "hair_waves_01",
    "hair_dark_brown_01",
    "hair_brown_01",
    ...FACIAL_HAIR_IDS,
  ];

  it("registers every new id as available + procedural", () => {
    for (const id of NEW_IDS) {
      const asset = AVATAR_MANIFEST_BY_ID[id];
      expect(asset, id).toBeDefined();
      expect(asset.status).toBe("available");
      expect(asset.source).toBe("procedural");
      expect(asset.skeletonId).toBe("eko-proc-rig-v1");
    }
  });

  it("strict-resolves every new id (M4 runtime contract)", () => {
    for (const id of NEW_IDS) {
      expect(resolveAsset(id).id).toBe(id);
    }
  });

  it("facial hair carries the facialHair slot; colours carry their hex", () => {
    for (const id of FACIAL_HAIR_IDS) {
      const a = AVATAR_MANIFEST_BY_ID[id];
      expect(a.slots).toContain("facialHair");
      expect(a.fallbackAssetId).toBe("facialhair_none_01");
    }
    expect(AVATAR_MANIFEST_BY_ID["hair_dark_brown_01"].hex).toBe("#3b2417");
    expect(AVATAR_MANIFEST_BY_ID["hair_brown_01"].hex).toBe("#5b3a21");
    expect(AVATAR_MANIFEST_BY_ID["hair_black_01"].hex).toBe(
      HAIR_COLOR_HEX["hair_black_01"]
    );
    for (const id of ["hair_taper_fade_01", "hair_waves_01"]) {
      const a = AVATAR_MANIFEST_BY_ID[id];
      expect(a.slots).toContain("hair");
      expect(a.fallbackAssetId).toBe("lowcut");
    }
  });

  it("validation accepts the new ids with no policy change", () => {
    const r = validateAppearance({
      base: {
        bodyType: "masculine",
        bodyPresetId: "man",
        facePresetId: "face_default_01",
        skinToneId: "cocoa",
      },
      hair: {
        styleId: "hair_waves_01",
        colorId: "hair_dark_brown_01",
        facialHairId: "facialhair_goatee_01",
      },
      clothing: {
        topId: "top_tee_01",
        bottomId: "bottom_trouser_01",
        outerwearId: null,
        shoeId: "shoe_sneaker_01",
        fabricId: "plain",
        topColor: "#22d3ee",
        bottomColor: "#334155",
      },
    });
    expect(r.ok).toBe(true);
    expect(r.appearance!.hair.styleId).toBe("hair_waves_01");
    expect(r.appearance!.hair.colorId).toBe("hair_dark_brown_01");
    expect(r.appearance!.hair.facialHairId).toBe("facialhair_goatee_01");
  });

  it("validation still rejects unknown facial hair / colours", () => {
    const r = validateAppearance({
      hair: {
        styleId: "lowcut",
        colorId: "hair_nope_01",
        facialHairId: "facialhair_zzz",
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("hair.colorId");
    expect(r.errors.join(" ")).toContain("hair.facialHairId");
  });
});

describe("M3b triangle budget", () => {
  it("full avatar (waves + goatee) stays under 25,000 tris", () => {
    const group = buildAvatarLook(THREE, { ...LOOK, hair: "hair_waves_01" });
    // Attach the goatee to the head group like the M4 runtime will.
    let headGroup: THREE.Object3D | null = null;
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (
        m.isMesh &&
        (m.userData as { part?: string }).part === "skull" &&
        !headGroup
      ) {
        headGroup = m.parent;
      }
    });
    expect(headGroup).not.toBeNull();
    const goatee = buildFacialHair(THREE, "facialhair_goatee_01", mats())!;
    (headGroup as unknown as THREE.Group).add(goatee);
    const total = countAllTris(group);
    // eslint-disable-next-line no-console
    console.log("full avatar (waves + goatee) triangles:", total);
    expect(total).toBeLessThan(25000);
    group.userData.dispose?.();
  });

  it("bald + goatee composes (no throw, budget intact)", () => {
    const head = buildHead(THREE, { skin: "#8a5f38", mats: mats() });
    attachHair(head, buildHair(THREE, "bald", mats()));
    const goatee = buildFacialHair(THREE, "facialhair_goatee_01", mats())!;
    attachFacialHair(head, goatee);
    expect(goatee.parent).toBe(head.group);
    expect(countAllTris(head.group)).toBeLessThan(25000);
  });
});
