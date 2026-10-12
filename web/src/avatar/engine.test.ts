/**
 * Èkó Life Avatar Engine — M4 runtime tests (assembler + loader).
 *
 * Node environment (no DOM): canvas texture builders return null, which
 * the parts handle — geometry/material/graph behaviour is fully testable.
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  assembleAppearance,
  diffUpdateAssembled,
  MORPH_SUPPORT,
  type AssembledAvatarInternal,
} from "./assembler";
import { AvatarLoader, type AvatarHandle } from "./loader";
import { DEFAULT_APPEARANCE_V1 } from "./validation";
import { migrateAvatarLookToV1 } from "./migrate";
import type { AppearanceV1 } from "./schema";
import { buildAvatarLook } from "../views/avatar/avatarModel";
import type { AvatarLook } from "../game/types";

const LOOK: AvatarLook = {
  body: "man",
  skin: "cocoa",
  hair: "lowcut",
  outfit: "casual",
  fabric: "plain",
  topColor: "#22d3ee",
  bottomColor: "#334155",
};

function cloneApp(): AppearanceV1 {
  return JSON.parse(JSON.stringify(DEFAULT_APPEARANCE_V1)) as AppearanceV1;
}

function withSkin(app: AppearanceV1, skinToneId: string): AppearanceV1 {
  const c = JSON.parse(JSON.stringify(app)) as AppearanceV1;
  c.base.skinToneId = skinToneId as AppearanceV1["base"]["skinToneId"];
  return c;
}

/** Collect every material / geometry instance under a root. */
function collectInstances(root: THREE.Object3D) {
  const mats = new Set<THREE.Material>();
  const geos = new Set<THREE.BufferGeometry>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry) geos.add(mesh.geometry as THREE.BufferGeometry);
    const arr = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of arr) if (m) mats.add(m as THREE.Material);
  });
  return { mats, geos };
}

function findSkullMesh(root: THREE.Object3D): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!found && mesh.isMesh && (mesh as THREE.Mesh).userData.part === "skull") {
      found = mesh as THREE.Mesh;
    }
  });
  if (!found) throw new Error("skull mesh not found");
  return found;
}

function skinColorOf(root: THREE.Object3D): string {
  const skull = findSkullMesh(root);
  const m = skull.material as THREE.MeshStandardMaterial;
  return "#" + m.color.getHexString();
}

describe("assembler", () => {
  it("builds a complete avatar: group, rig, update, dispose", () => {
    const a = assembleAppearance(THREE, cloneApp());
    expect(a.group).toBeInstanceOf(THREE.Group);
    expect(a.rig.upper).toBeInstanceOf(THREE.Group);
    expect(a.rig.torso).toBeInstanceOf(THREE.Mesh);
    expect(a.rig.head).toBeInstanceOf(THREE.Group);
    expect(a.rig.eyeL).toBeInstanceOf(THREE.Group);
    expect(a.rig.eyeR).toBeInstanceOf(THREE.Group);
    // node: no window → reduced motion off → update defined
    expect(typeof a.update).toBe("function");
    a.update!(1.0, 1 / 60);
    a.update!(5.0, 1 / 60);
    expect(typeof a.group.userData.dispose).toBe("function");
    expect(a.stages.clothingObjects.length).toBeGreaterThan(0);
    expect(a.stages.hairObjects.length).toBeGreaterThan(0);
    a.dispose();
  });

  it("keeps the geometry contract: chin anchor y=1.4, feet ~0.09, faces +Z", () => {
    const a = assembleAppearance(THREE, cloneApp());
    a.group.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    a.rig.head.getWorldPosition(p);
    expect(p.y).toBeCloseTo(1.4, 2);
    const box = new THREE.Box3().setFromObject(a.group);
    expect(box.min.y).toBeGreaterThanOrEqual(0);
    expect(box.min.y).toBeLessThan(0.25);
    expect(box.max.y).toBeGreaterThan(1.5);
    expect(box.max.y).toBeLessThan(2.0);
    // faces +Z: nose tip is the max-z point of the head region
    expect(box.max.z).toBeGreaterThan(Math.abs(box.min.z) * 0.5);
    a.dispose();
  });

  it("isolates materials: two avatars share no instances; recoloring one never touches the other", () => {
    const app = cloneApp();
    const a1 = assembleAppearance(THREE, app);
    const a2 = assembleAppearance(THREE, cloneApp());
    const i1 = collectInstances(a1.group);
    const i2 = collectInstances(a2.group);
    for (const m of i1.mats) expect(i2.mats.has(m)).toBe(false);
    for (const g of i1.geos) expect(i2.geos.has(g)).toBe(false);

    expect(skinColorOf(a1.group)).toBe("#8a5f38");
    expect(skinColorOf(a2.group)).toBe("#8a5f38");
    const summary = diffUpdateAssembled(
      a1 as AssembledAvatarInternal,
      app,
      withSkin(app, "deep_espresso")
    );
    expect(summary.touched).toContain("skin");
    expect(summary.rebuilt).toBe(false);
    expect(skinColorOf(a1.group)).toBe("#3b2314");
    // The other avatar is untouched.
    expect(skinColorOf(a2.group)).toBe("#8a5f38");
    a1.dispose();
    a2.dispose();
  });

  it("reports every morph as stubbed and warns (once) on non-neutral morphs", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const v of Object.values(MORPH_SUPPORT)) expect(v).toBe("stubbed");
      const app = cloneApp();
      app.morphs.jawWidth = 0.9;
      app.morphs.noseWidth = 0.1;
      const a = assembleAppearance(THREE, app);
      const morphWarns = warn.mock.calls.filter((c) =>
        String(c[0]).includes("[avatar] M4: morphs")
      );
      expect(morphWarns).toHaveLength(1);
      expect(a.notes.some((n) => n.includes("jawWidth=0.9"))).toBe(true);
      expect(a.morphStatus.jawWidth).toBe("stubbed");
      // Neutral morphs → no warning, no note.
      warn.mockClear();
      const b = assembleAppearance(THREE, cloneApp());
      expect(
        warn.mock.calls.filter((c) => String(c[0]).includes("[avatar] M4: morphs"))
      ).toHaveLength(0);
      expect(b.notes.some((n) => n.includes("morphs ignored"))).toBe(false);
      a.dispose();
      b.dispose();
    } finally {
      warn.mockRestore();
    }
  });

  it("falls back per-slot on unknown asset ids — never throws", () => {
    const app = cloneApp();
    (app.hair as { styleId: string }).styleId = "nope_not_a_hairstyle";
    const a = assembleAppearance(THREE, app);
    // lowcut fallback: hair was still built
    expect(a.stages.hairObjects.length).toBeGreaterThan(0);
    expect(a.notes.some((n) => n.includes("nope_not_a_hairstyle"))).toBe(true);
    a.dispose();
  });

  it("diff skin change does not rebuild head geometry (object identity kept)", () => {
    const app = cloneApp();
    const a = assembleAppearance(THREE, app) as AssembledAvatarInternal;
    const skullGeoBefore = findSkullMesh(a.group).geometry;
    const headGroupBefore = a.stages.head!.group;
    const summary = diffUpdateAssembled(a, app, withSkin(app, "deep_espresso"));
    expect(summary.rebuilt).toBe(false);
    expect(summary.touched).toEqual(["skin"]);
    expect(findSkullMesh(a.group).geometry).toBe(skullGeoBefore);
    expect(a.stages.head!.group).toBe(headGroupBefore);
    expect(skinColorOf(a.group)).toBe("#3b2314");
    a.dispose();
  });

  it("diff hairstyle change swaps only the hair group", () => {
    const app = cloneApp();
    const a = assembleAppearance(THREE, app) as AssembledAvatarInternal;
    const skullGeoBefore = findSkullMesh(a.group).geometry;
    const hairBefore = [...a.stages.hairObjects];
    const next = JSON.parse(JSON.stringify(app)) as AppearanceV1;
    next.hair.styleId = "afro";
    const summary = diffUpdateAssembled(a, app, next);
    expect(summary.rebuilt).toBe(false);
    expect(summary.touched).toEqual(["hair"]);
    expect(findSkullMesh(a.group).geometry).toBe(skullGeoBefore);
    expect(a.stages.hairObjects).not.toEqual(hairBefore);
    expect(a.stages.hairObjects.length).toBeGreaterThan(0);
    for (const o of hairBefore) expect(o.parent).toBeNull();
    a.dispose();
  });

  it("diff clothing change re-dresses without touching head/body geometry", () => {
    const app = cloneApp();
    const a = assembleAppearance(THREE, app) as AssembledAvatarInternal;
    const skullGeoBefore = findSkullMesh(a.group).geometry;
    const torsoBefore = a.rig.torso;
    const next = JSON.parse(JSON.stringify(app)) as AppearanceV1;
    next.clothing.topColor = "#f472b6";
    next.clothing.fabricId = "ankara";
    const summary = diffUpdateAssembled(a, app, next);
    expect(summary.rebuilt).toBe(false);
    expect(summary.touched).toEqual(["clothing"]);
    expect(findSkullMesh(a.group).geometry).toBe(skullGeoBefore);
    // New shirt mesh re-pointed as the breathing target.
    expect(a.rig.torso).not.toBe(torsoBefore);
    expect(a.rig.torso).toBe(a.stages.torsoMesh);
    a.update!(1.0, 1 / 60); // idle loop still drives the new torso
    a.dispose();
  });

  it("diff body-preset change rebuilds (head hangs off the body subtree)", () => {
    const app = cloneApp();
    const a = assembleAppearance(THREE, app) as AssembledAvatarInternal;
    const rigBefore = a.rig;
    const next = JSON.parse(JSON.stringify(app)) as AppearanceV1;
    next.base.bodyPresetId = "man";
    next.base.bodyType = "masculine";
    const summary = diffUpdateAssembled(a, app, next);
    expect(summary.rebuilt).toBe(true);
    expect(summary.touched).toEqual(["body"]);
    // Rig object identity is stable; the idle loop keeps working.
    expect(a.rig).toBe(rigBefore);
    expect(a.rig.upper).not.toBeNull();
    a.update!(1.0, 1 / 60);
    a.dispose();
  });

  it("defect 4: feminine body + facial hair falls back to clean-shaven", () => {
    const app = cloneApp();
    app.base.bodyPresetId = "woman";
    app.base.bodyType = "feminine";
    app.hair.facialHairId = "facialhair_beard_short_01";
    const a = assembleAppearance(THREE, app) as AssembledAvatarInternal;
    // No facial-hair group built; the fallback is reported honestly.
    expect(a.stages.facialHair).toBeNull();
    expect(a.resolved.facialHair.id).toBe("facialhair_none_01");
    expect(
      a.notes.some((n) => n.includes("clean-shaven"))
    ).toBe(true);
    a.dispose();

    // Control: the same beard on a masculine body renders fine.
    const man = cloneApp();
    man.base.bodyPresetId = "man";
    man.base.bodyType = "masculine";
    man.hair.facialHairId = "facialhair_beard_short_01";
    const b = assembleAppearance(THREE, man) as AssembledAvatarInternal;
    expect(b.stages.facialHair).not.toBeNull();
    expect(b.resolved.facialHair.id).toBe("facialhair_beard_short_01");
    b.dispose();
  });

  it("defect 4: diff to a feminine body drops a kept beard via the fallback", () => {
    const man = cloneApp();
    man.base.bodyPresetId = "man";
    man.base.bodyType = "masculine";
    man.hair.facialHairId = "facialhair_goatee_01";
    const a = assembleAppearance(THREE, man) as AssembledAvatarInternal;
    expect(a.stages.facialHair).not.toBeNull();
    const woman = JSON.parse(JSON.stringify(man)) as AppearanceV1;
    woman.base.bodyPresetId = "woman";
    woman.base.bodyType = "feminine";
    const summary = diffUpdateAssembled(a, man, woman);
    expect(summary.rebuilt).toBe(true);
    expect(a.stages.facialHair).toBeNull();
    expect(a.resolved.facialHair.id).toBe("facialhair_none_01");
    a.dispose();
  });

  it("M8: accessories attach on build and swap in place on diff", () => {
    const app = cloneApp();
    app.accessories = [
      { slot: "face", assetId: "acc_glasses_01" },
      { slot: "head", assetId: "acc_cap_01" },
    ];
    const a = assembleAppearance(THREE, app) as AssembledAvatarInternal;
    expect(a.stages.accessoryObjects).toHaveLength(2);
    expect(a.resolved.accessories.map((x) => x.id).sort()).toEqual([
      "acc_cap_01",
      "acc_glasses_01",
    ]);
    // Both groups are actually in the head subtree.
    for (const o of a.stages.accessoryObjects) {
      expect(o.parent).toBe(a.stages.head.group);
    }
    // Diff: swap glasses for earrings.
    const next = JSON.parse(JSON.stringify(app)) as AppearanceV1;
    next.accessories = [
      { slot: "ears", assetId: "acc_earrings_01" },
      { slot: "head", assetId: "acc_cap_01" },
    ];
    const summary = diffUpdateAssembled(a, app, next);
    expect(summary.rebuilt).toBe(false);
    expect(summary.touched).toContain("accessories");
    expect(a.stages.accessoryObjects).toHaveLength(2);
    expect(a.resolved.accessories.map((x) => x.id).sort()).toEqual([
      "acc_cap_01",
      "acc_earrings_01",
    ]);
    // Head geometry identity kept (no head rebuild for accessories).
    a.dispose();
  });

  it("M8: eye colour diff swaps the iris texture without rebuilding", () => {
    const app = cloneApp();
    const a = assembleAppearance(THREE, app) as AssembledAvatarInternal;
    const headGroup = a.stages.head.group;
    // The iris material is found via its tag even without a DOM.
    expect(a.stages.irisMat).not.toBeNull();
    const next = JSON.parse(JSON.stringify(app)) as AppearanceV1;
    next.base.eyeColorId = "eye_green_01";
    const summary = diffUpdateAssembled(a, app, next);
    expect(summary.rebuilt).toBe(false);
    expect(summary.touched).toContain("eyeColor");
    expect(a.stages.head.group).toBe(headGroup);
    expect(a.resolved.eyeColor.id).toBe("eye_green_01");
    // Node has no canvas: the swap is honestly reported as deferred.
    expect(
      summary.notes.some((n) => n.includes("eye_green_01"))
    ).toBe(true);
    a.dispose();
  });

  it("M8: brow style diff rebuilds the head subtree and re-points the rig", () => {
    const app = cloneApp();
    const a = assembleAppearance(THREE, app) as AssembledAvatarInternal;
    const next = JSON.parse(JSON.stringify(app)) as AppearanceV1;
    next.base.browStyleId = "brow_bold_01";
    const summary = diffUpdateAssembled(a, app, next);
    expect(summary.rebuilt).toBe(false);
    expect(summary.touched).toContain("brows");
    expect(a.resolved.browStyle.id).toBe("brow_bold_01");
    // Rig eye/lid refs follow the rebuilt head (blink keeps working).
    expect(a.rig.eyeL).toBe(a.stages.head.eyeL);
    expect(a.rig.lidL).toBe(a.stages.head.upperLidL);
    a.dispose();
  });

  it("M8: new outfits (gym/agbada/owambe) assemble with the right outfit + footwear", () => {
    const cases = [
      { topId: "top_tank_01", bottomId: "bottom_short_01", outerwearId: null, shoeId: "shoe_sneaker_01", outfit: "gym" },
      { topId: "top_agbada_01", bottomId: "bottom_trouser_01", outerwearId: null, shoeId: "shoe_sandal_01", outfit: "agbada" },
      { topId: "top_dress_01", bottomId: "bottom_skirt_01", outerwearId: null, shoeId: "shoe_heel_01", outfit: "owambe" },
    ] as const;
    for (const c of cases) {
      const app = cloneApp();
      app.clothing.topId = c.topId;
      app.clothing.bottomId = c.bottomId;
      app.clothing.outerwearId = c.outerwearId;
      app.clothing.shoeId = c.shoeId;
      const a = assembleAppearance(THREE, app) as AssembledAvatarInternal;
      expect(a.resolved.outfit).toBe(c.outfit);
      expect(a.notes.filter((n) => n.includes("no exact outfit match"))).toEqual([]);
      a.dispose();
    }
  });

  it("dispose() fires dispose events on its own objects only", () => {
    const a1 = assembleAppearance(THREE, cloneApp());
    const a2 = assembleAppearance(THREE, cloneApp());
    let hits = 0;
    const cb = () => hits++;
    a2.group.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      (mesh.geometry as THREE.BufferGeometry).addEventListener("dispose", cb);
      const arr = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of arr) (m as THREE.Material).addEventListener("dispose", cb);
    });
    a1.dispose();
    // Nothing shared between characters → a2 saw zero dispose events.
    expect(hits).toBe(0);
    a2.dispose();
  });
});

describe("AvatarLoader", () => {
  async function loadApp(loader: AvatarLoader, app: AppearanceV1): Promise<AvatarHandle> {
    return loader.load(app);
  }

  it("loads an avatar asynchronously with honest staged progress", async () => {
    const loader = new AvatarLoader(THREE);
    const stages: string[] = [];
    const handle = await loader.load(cloneApp(), {
      onProgress: (stage) => stages.push(stage),
    });
    expect(handle.discarded).toBe(false);
    expect(handle.group).toBeInstanceOf(THREE.Group);
    expect(typeof handle.update).toBe("function");
    expect(stages).toEqual(["resolve", "body", "head", "finalize", "finalize"]);
    loader.disposeHandle(handle);
  });

  it("stale guard: 3 rapid loads → only the latest is delivered", async () => {
    const loader = new AvatarLoader(THREE);
    const p1 = loadApp(loader, withSkin(cloneApp(), "cocoa"));
    const p2 = loadApp(loader, withSkin(cloneApp(), "latte"));
    const p3 = loadApp(loader, withSkin(cloneApp(), "deep_espresso"));
    const [h1, h2, h3] = await Promise.all([p1, p2, p3]);
    expect(h1.discarded).toBe(true);
    expect(h2.discarded).toBe(true);
    expect(h3.discarded).toBe(false);
    expect(h3.appearance.base.skinToneId).toBe("deep_espresso");
    expect(loader.stats.buildsStarted).toBe(3);
    expect(loader.stats.buildsDiscarded).toBe(2);
    loader.disposeHandle(h3);
  });

  it("dedups concurrent identical requests into one build", async () => {
    const loader = new AvatarLoader(THREE);
    const app = cloneApp();
    const p1 = loader.load(app);
    const p2 = loader.load(app);
    expect(p1).toBe(p2);
    const h = await p1;
    expect(h.discarded).toBe(false);
    expect(loader.stats.buildsStarted).toBe(1);
    loader.disposeHandle(h);
  });

  it("falls back to the default appearance on invalid input — never rejects", async () => {
    const loader = new AvatarLoader(THREE);
    const handle = await loader.load("garbage" as unknown as AppearanceV1);
    expect(handle.discarded).toBe(false);
    expect(handle.group.children.length).toBeGreaterThan(0);
    expect(handle.appearance).toEqual(DEFAULT_APPEARANCE_V1);
    expect(handle.notes.some((n) => n.includes("DEFAULT_APPEARANCE_V1"))).toBe(true);
    loader.disposeHandle(handle);
  });

  it("swap() keeps the old character visible until the new build is ready", async () => {
    const loader = new AvatarLoader(THREE);
    const parent = new THREE.Group();
    const old = await loader.load(cloneApp());
    old.group.position.set(1, 2, 3);
    parent.add(old.group);

    let disposed = false;
    const origDispose = old.dispose.bind(old);
    old.dispose = () => {
      disposed = true;
      origDispose();
    };

    const next = await loader.swap(old, withSkin(cloneApp(), "deep_espresso"));
    expect(next.discarded).toBe(false);
    expect(parent.children).toContain(next.group);
    expect(parent.children).not.toContain(old.group);
    // Transform preserved across the swap.
    expect(next.group.position.x).toBe(1);
    expect(next.group.position.y).toBe(2);
    expect(disposed).toBe(true);
    expect(skinColorOf(next.group)).toBe("#3b2314");
    loader.disposeHandle(next);
  });

  it("diffUpdate() applies minimal updates to a live handle", async () => {
    const loader = new AvatarLoader(THREE);
    const app = cloneApp();
    const handle = await loader.load(app);
    const skullGeo = findSkullMesh(handle.group).geometry;
    const next = withSkin(app, "amber");
    const summary = loader.diffUpdate(handle, app, next);
    expect(summary.rebuilt).toBe(false);
    expect(summary.touched).toEqual(["skin"]);
    expect(findSkullMesh(handle.group).geometry).toBe(skullGeo);
    expect(handle.appearance.base.skinToneId).toBe("amber");
    loader.disposeHandle(handle);
  });

  it("diffUpdate() on an unknown handle is a safe no-op", () => {
    const loader = new AvatarLoader(THREE);
    const fake = { group: new THREE.Group() } as AvatarHandle;
    const summary = loader.diffUpdate(fake, cloneApp(), cloneApp());
    expect(summary.touched).toEqual([]);
    expect(summary.notes[0]).toMatch(/no-op/);
  });
});

describe("legacy buildAvatarLook contract", () => {
  it("new overload returns a working group + update", () => {
    const built = buildAvatarLook(LOOK);
    expect(built.group).toBeInstanceOf(THREE.Group);
    expect(typeof built.update).toBe("function");
    expect(typeof built.group.userData.dispose).toBe("function");
    built.update!(1.0, 1 / 60);
    built.update!(30.0, 1 / 60);
    (built.group.userData.dispose as () => void)();
  });

  it("legacy (THREE, look) overload returns the bare group with update stashed", () => {
    const group = buildAvatarLook(THREE, LOOK);
    expect(group).toBeInstanceOf(THREE.Group);
    expect(typeof group.userData.update).toBe("function");
    expect(typeof group.userData.dispose).toBe("function");
    (group.userData.update as (t: number, dt: number) => void)(2.5, 1 / 60);
  });

  it("renders the same figure as the assembler for a migrated look", () => {
    const viaLegacy = buildAvatarLook(LOOK);
    const viaAssembler = assembleAppearance(
      THREE,
      JSON.parse(JSON.stringify(DEFAULT_APPEARANCE_V1)) as AppearanceV1
    );
    // DEFAULT_APPEARANCE_V1 == woman/cocoa/lowcut/casual — LOOK is man.
    // Compare mesh counts for the same migrated appearance instead:
    const app = migrateAvatarLookToV1(LOOK);
    const direct = assembleAppearance(THREE, app);
    const count = (g: THREE.Group) => {
      let n = 0;
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) n++;
      });
      return n;
    };
    expect(count(viaLegacy.group)).toBe(count(direct.group));
    viaLegacy.group.userData.dispose();
    viaAssembler.dispose();
    direct.dispose();
  });
});
