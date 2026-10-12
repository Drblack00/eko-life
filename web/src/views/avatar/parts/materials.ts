import type * as THREE from "three";
import type { AvatarLook } from "../../../game/types";

/**
 * Avatar materials. FROZEN module — workstreams add enhanced materials
 * locally inside their own part files rather than editing this file.
 */

/** Full 18-tone skin map (mirrors the server allowlist ids). */
export const SKIN_HEX: Record<string, string> = {
  onyx: "#291709",
  deep_espresso: "#3b2314",
  dark_cocoa: "#4a2c17",
  truffle: "#553521",
  burnt_caramel: "#5d3a1f",
  mahogany: "#6f4426",
  walnut: "#7d5330",
  sienna: "#835c36",
  cocoa: "#8a5f38",
  coffee: "#9a6f45",
  caramel: "#a37a4e",
  latte: "#ab8054",
  honey: "#bc9066",
  sand: "#cda077",
  butterscotch: "#d4a878",
  amber: "#dcb07e",
  cream: "#e8cfa3",
  ivory: "#f2e0bd",
};

export const HAIR_HEX = "#171110";
export const IRIS_HEX = "#3a2415";

export function skinHex(skin: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(skin)) return skin;
  return SKIN_HEX[skin] ?? "#8a5f38";
}

export function shade(hex: string, amt: number): string {
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
export function fabricTexture(
  T: typeof import("three"),
  fabric: string,
  baseHex: string
): THREE.CanvasTexture | null {
  if (fabric === "plain") return null;
  if (typeof document === "undefined") return null;
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
    for (let x = 0; x < size; x += 16) {
      ctx.fillStyle = (x / 16) % 2 === 0 ? accent : deep;
      ctx.fillRect(x, 0, 8, size);
    }
  } else if (fabric === "adire") {
    for (let y = 8; y < size; y += 24) {
      for (let x = 8; x < size; x += 24) {
        ctx.fillStyle = (x + y) % 48 === 0 ? accent : deep;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
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
  const tex = new T.CanvasTexture(canvas);
  tex.wrapS = T.RepeatWrapping;
  tex.wrapT = T.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}

export interface AvatarMaterials {
  skinMat: THREE.Material;
  skinDarkMat: THREE.Material;
  lipMat: THREE.Material;
  bottomMat: THREE.Material;
  shoeMat: THREE.Material;
  soleMat: THREE.Material;
  hairMat: THREE.Material;
  accentMat: THREE.Material;
  whiteMat: THREE.Material;
  irisMat: THREE.Material;
  pupilMat: THREE.Material;
  shirtMat: THREE.Material;
  vestMat: THREE.Material;
  stripeMat: THREE.Material;
}

/** Assemble the base material set for a look. */
export function buildMaterials(
  T: typeof import("three"),
  look: AvatarLook
): AvatarMaterials {
  const skin = skinHex(look.skin);
  const torsoTex = fabricTexture(T, look.fabric, look.topColor);
  return {
    skinMat: new T.MeshStandardMaterial({
      color: skin,
      roughness: 0.52,
      metalness: 0.02,
    }),
    skinDarkMat: new T.MeshStandardMaterial({
      color: shade(skin, -26),
      roughness: 0.6,
    }),
    lipMat: new T.MeshStandardMaterial({
      color: shade(skin, -42),
      roughness: 0.55,
    }),
    bottomMat: new T.MeshStandardMaterial({
      color: look.bottomColor,
      roughness: 0.85,
    }),
    shoeMat: new T.MeshStandardMaterial({
      color: look.outfit === "sitework" ? "#5b3a1e" : "#241a12",
      roughness: 0.75,
    }),
    soleMat: new T.MeshStandardMaterial({ color: "#d6cfc4", roughness: 0.9 }),
    hairMat: new T.MeshStandardMaterial({ color: HAIR_HEX, roughness: 0.9 }),
    accentMat: new T.MeshStandardMaterial({
      color: look.topColor,
      roughness: 0.7,
    }),
    whiteMat: new T.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.3 }),
    irisMat: new T.MeshStandardMaterial({ color: IRIS_HEX, roughness: 0.25 }),
    pupilMat: new T.MeshStandardMaterial({ color: "#0d0b09", roughness: 0.2 }),
    shirtMat: new T.MeshStandardMaterial({
      color: look.topColor,
      roughness: 0.85,
      map: torsoTex ?? undefined,
    }),
    vestMat: new T.MeshStandardMaterial({ color: "#eab308", roughness: 0.7 }),
    stripeMat: new T.MeshStandardMaterial({
      color: "#e5e7eb",
      roughness: 0.4,
      emissive: "#555555",
      emissiveIntensity: 0.35,
    }),
  };
}
