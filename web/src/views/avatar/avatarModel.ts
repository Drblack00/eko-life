import type * as THREE from "three";
import type { AvatarLook } from "../../game/types";

/**
 * M15 avatar studio — original low-poly humanoid (~1.6 units tall).
 * buildAvatarLook(THREE, look) returns a THREE.Group whose userData.dispose()
 * releases every geometry / material / texture it created.
 *
 * Conventions: legs use look.bottomColor, torso uses look.topColor (with a
 * canvas-generated fabric pattern unless fabric === "plain"), arms and head
 * use the skin tone, hair is always dark (#1a1210).
 */

const HAIR_HEX = "#1a1210";

/** Known skin ids → hex (look.skin may also be a raw #hex, tolerated). */
const SKIN_HEX: Record<string, string> = {
  deep: "#4a2c1a",
  rich: "#6f4527",
  warm: "#96613a",
  golden: "#bd8452",
  light: "#e0b184",
};

function skinHex(skin: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(skin)) return skin;
  return SKIN_HEX[skin] ?? "#6f4527";
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const cl = (v: number) => Math.max(0, Math.min(255, v + amt));
  const r = cl((n >> 16) & 255);
  const g = cl((n >> 8) & 255);
  const b = cl(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * Canvas-generated fabric pattern. ankara = diamonds, adire = dots,
 * asoke = stripes; all in complementary shades of the base colour.
 * plain → null (solid material).
 */
function fabricTexture(
  THREE: typeof import("three"),
  fabric: string,
  baseHex: string
): THREE.CanvasTexture | null {
  if (fabric === "plain") return null;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, size, size);
  const accent = shade(baseHex, 48);
  const deep = shade(baseHex, -48);

  if (fabric === "asoke") {
    // Vertical stripes.
    for (let x = 0; x < size; x += 16) {
      ctx.fillStyle = (x / 16) % 2 === 0 ? accent : deep;
      ctx.fillRect(x, 0, 8, size);
    }
  } else if (fabric === "adire") {
    // Dot grid (indigo-style circles).
    for (let y = 8; y < size; y += 24) {
      for (let x = 8; x < size; x += 24) {
        ctx.fillStyle = (x + y) % 48 === 0 ? accent : deep;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    // ankara — diamond lattice.
    ctx.fillStyle = deep;
    for (let y = 0; y <= size; y += 32) {
      for (let x = 0; x <= size; x += 32) {
        const ox = (y / 32) % 2 === 0 ? 0 : 16;
        ctx.save();
        ctx.translate(x + ox, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-7, -7, 14, 14);
        ctx.restore();
      }
    }
    ctx.fillStyle = accent;
    for (let y = 16; y < size; y += 32) {
      for (let x = 16; x < size; x += 32) {
        const ox = (y / 32) % 2 === 0 ? 0 : 16;
        ctx.save();
        ctx.translate(x + ox, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-4, -4, 8, 8);
        ctx.restore();
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildHair(
  THREE: typeof import("three"),
  hair: string,
  mat: THREE.Material
): THREE.Object3D[] {
  const parts: THREE.Object3D[] = [];
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parts.push(m);
    return m;
  };
  switch (hair) {
    case "bald":
      break;
    case "lowcut": {
      // Flattened sphere cap hugging the head.
      const cap = add(new THREE.SphereGeometry(0.163, 20, 14), 0, 1.56, 0);
      cap.scale.set(1, 0.62, 1);
      break;
    }
    case "classic": {
      // Rounded box cap.
      const cap = add(new THREE.BoxGeometry(0.3, 0.11, 0.3), 0, 1.63, 0);
      cap.rotation.y = Math.PI / 8;
      break;
    }
    case "afro": {
      add(new THREE.SphereGeometry(0.235, 20, 16), 0, 1.63, 0);
      break;
    }
    case "curls": {
      // Cluster of small spheres over the crown.
      const r = 0.17;
      for (let i = 0; i < 16; i++) {
        const t = (i / 16) * Math.PI * 2;
        const rr = r * (0.75 + 0.25 * Math.sin(i * 2.7));
        const x = Math.cos(t) * rr;
        const z = Math.sin(t) * rr;
        const y = 1.6 + 0.09 * Math.cos(i * 1.3) + 0.06;
        add(new THREE.SphereGeometry(0.052, 10, 8), x, y, z);
      }
      add(new THREE.SphereGeometry(0.12, 12, 10), 0, 1.66, 0);
      break;
    }
    case "locs": {
      // Hanging cylinders around the head.
      for (let i = 0; i < 9; i++) {
        const t = (i / 9) * Math.PI * 2;
        const x = Math.cos(t) * 0.17;
        const z = Math.sin(t) * 0.17;
        const loc = add(new THREE.CylinderGeometry(0.028, 0.024, 0.4, 8), x, 1.38, z);
        loc.rotation.z = Math.cos(t) * 0.12;
        loc.rotation.x = -Math.sin(t) * 0.12;
      }
      const cap = add(new THREE.SphereGeometry(0.163, 20, 14), 0, 1.56, 0);
      cap.scale.set(1, 0.6, 1);
      break;
    }
    case "braids": {
      // Rows of small cylinders swept back.
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 5; col++) {
          const x = (col - 2) * 0.062;
          const z = 0.08 - row * 0.055;
          const y = 1.62 - row * 0.012 - Math.abs(col - 2) * 0.012;
          const braid = add(
            new THREE.CylinderGeometry(0.02, 0.02, 0.13, 6),
            x,
            y,
            z
          );
          braid.rotation.x = Math.PI / 2 - 0.35;
        }
      }
      break;
    }
    default: {
      // Unknown id → low cut (never render a bare broken head).
      const cap = add(new THREE.SphereGeometry(0.163, 20, 14), 0, 1.56, 0);
      cap.scale.set(1, 0.62, 1);
      break;
    }
  }
  return parts;
}

/**
 * Build an original low-poly humanoid (~1.6 units) from an AvatarLook.
 * Pass the three module explicitly so the builder stays tree-shakeable and
 * testable without importing three at module scope.
 */
export function buildAvatarLook(
  THREE: typeof import("three"),
  look: AvatarLook
): THREE.Group {
  const group = new THREE.Group();
  const skin = skinHex(look.skin);
  const isMan = look.body === "man";
  const isNative = look.outfit === "native";
  const longSleeves = look.outfit === "native" || look.outfit === "smart";

  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.75 });
  const bottomMat = new THREE.MeshStandardMaterial({
    color: look.bottomColor,
    roughness: 0.85,
  });
  const shoeMat = new THREE.MeshStandardMaterial({ color: "#241a12", roughness: 0.9 });
  const hairMat = new THREE.MeshStandardMaterial({ color: HAIR_HEX, roughness: 0.95 });

  // Torso: topColor, fabric pattern unless plain. Native = long tunic.
  const torsoW = isMan ? 0.43 : 0.39;
  const torsoH = isNative ? 0.74 : 0.56;
  const torsoY = isNative ? 0.97 : 1.045;
  const torsoTex = fabricTexture(THREE, look.fabric, look.topColor);
  const torsoMat = new THREE.MeshStandardMaterial({
    color: look.topColor,
    roughness: 0.85,
    map: torsoTex ?? undefined,
  });
  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(torsoW, torsoH, 0.24),
    torsoMat
  );
  torso.position.y = torsoY;
  group.add(torso);

  // Hips hint for the woman body.
  if (!isMan) {
    const hips = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.14, 0.25),
      bottomMat
    );
    hips.position.y = 0.73;
    group.add(hips);
  }

  // Legs (bottomColor) + shoes.
  const legTop = 0.68;
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.6, 0.17), bottomMat);
    leg.position.set(sx * 0.105, legTop - 0.3, 0);
    group.add(leg);
    const shoe = new THREE.Mesh(
      new THREE.BoxGeometry(0.17, 0.08, 0.26),
      shoeMat
    );
    shoe.position.set(sx * 0.105, 0.04, 0.03);
    group.add(shoe);
  }

  // Arms: skin for short sleeves, topColor for long sleeves.
  const armMat = longSleeves ? torsoMat : skinMat;
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.048, 0.54, 10),
      armMat
    );
    arm.position.set(sx * (torsoW / 2 + 0.07), 1.03, 0);
    arm.rotation.z = sx * -0.06;
    group.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), skinMat);
    hand.position.set(sx * (torsoW / 2 + 0.086), 0.74, 0);
    group.add(hand);
  }

  // Neck + head (skin).
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10),
    skinMat
  );
  neck.position.y = 1.36;
  group.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 24, 18), skinMat);
  head.position.y = 1.52;
  group.add(head);

  // Simple face: two eyes + smile (dark, subtle).
  const faceMat = new THREE.MeshStandardMaterial({ color: "#1a1210", roughness: 1 });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 8), faceMat);
    eye.position.set(sx * 0.058, 1.545, 0.14);
    group.add(eye);
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 8, 16, Math.PI), faceMat);
  smile.position.set(0, 1.49, 0.138);
  smile.rotation.z = Math.PI;
  group.add(smile);

  // Hair.
  for (const part of buildHair(THREE, look.hair, hairMat)) group.add(part);

  // Street outfit gets a small hood bump behind the neck.
  if (look.outfit === "street") {
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), torsoMat);
    hood.position.set(0, 1.34, -0.14);
    hood.scale.set(1, 0.8, 0.7);
    group.add(hood);
  }

  // Disposal handle: releases every geometry / material / texture created.
  const disposables = new Set<{ dispose(): void }>();
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      if (mesh.geometry) disposables.add(mesh.geometry);
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m) continue;
        const mm = m as THREE.MeshStandardMaterial;
        if (mm.map) disposables.add(mm.map);
        disposables.add(mm);
      }
    }
  });
  group.userData.dispose = () => {
    for (const d of disposables) d.dispose();
    disposables.clear();
  };

  return group;
}
