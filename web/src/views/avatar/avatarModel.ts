import * as THREE from "three";
import type { AvatarLook } from "../../game/types";

/**
 * Realistic procedural avatar (~1.6 units tall, root at y=0, faces +Z).
 * All geometry is original, generated at build time — no external assets.
 *
 * Head: vertex-sculpted skull (jawline taper, cheekbones, chin), sculpted
 * nose (bridge + tip), lips, eyes set into the face (sclera + iris + pupil
 * + upper eyelid fold), natural eyebrows, detailed ears.
 * Body: ~7.5 heads tall, gender-differentiated lathe-built torso and limbs
 * with defined joints; hands with separated fingers; proper shoes.
 * Garments are separate meshes per outfit (casual/hoodie/office/chill/
 * sitework read differently); 7 fuller hairstyles; canvas fabric patterns
 * on garments with proper UVs.
 *
 * Two call shapes (overloads):
 *   buildAvatarLook(look)            → { group, update? }   (new contract)
 *   buildAvatarLook(THREE, look)     → THREE.Group          (legacy)
 * The legacy shape returns the bare group (updater stashed on
 * `group.userData.update` when animation is enabled).
 *
 * Conventions: trousers use look.bottomColor, shirts use look.topColor
 * (canvas fabric pattern unless fabric === "plain"), skin parts use the
 * skin tone, hair is dark. group.userData.dispose() releases everything.
 */

const HAIR_HEX = "#171110";
const IRIS_HEX = "#3a2415";

/** Full 12-tone skin map (mirrors the server allowlist ids). */
const SKIN_HEX: Record<string, string> = {
  deep_espresso: "#3b2314",
  dark_cocoa: "#4a2c17",
  burnt_caramel: "#5d3a1f",
  mahogany: "#6f4426",
  walnut: "#7d5330",
  cocoa: "#8a5f38",
  coffee: "#9a6f45",
  latte: "#ab8054",
  honey: "#bc9066",
  sand: "#cda077",
  amber: "#dcb07e",
  cream: "#e8cfa3",
};

function skinHex(skin: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(skin)) return skin;
  return SKIN_HEX[skin] ?? "#8a5f38";
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const cl = (v: number) => Math.max(0, Math.min(255, v + amt));
  const r = cl((n >> 16) & 255);
  const g = cl((n >> 8) & 255);
  const b = cl(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Deterministic PRNG so hair volumes are stable across rebuilds. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Canvas-generated fabric pattern. ankara = diamonds, adire = dots,
 * asoke = stripes; all in complementary shades of the base colour.
 * plain → null (solid material).
 */
function fabricTexture(
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

/** Lathe mesh from [radius, height] profile points (smooth normals). */
function lathe(
  T: typeof import("three"),
  pts: Array<[number, number]>,
  mat: THREE.Material,
  segments = 20
): THREE.Mesh {
  const v2 = pts.map(([x, y]) => new T.Vector2(Math.max(0.0001, x), y));
  const geo = new T.LatheGeometry(v2, segments);
  return new T.Mesh(geo, mat);
}

/**
 * Sculpted skull: sphere with jawline taper, cheekbone fullness and a
 * defined chin. Head-local coords, centre at origin, radius r.
 */
function sculptSkull(T: typeof import("three"), r: number): THREE.BufferGeometry {
  const geo = new T.SphereGeometry(r, 24, 18);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new T.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ny = v.y / r; // -1..1
    // Jaw taper: narrow x/z through the lower face.
    if (ny < 0.15) {
      const k = Math.min(1, (0.15 - ny) / 1.15);
      const s = 1 - 0.3 * Math.pow(k, 1.4);
      v.x *= s;
      v.z *= 1 - 0.2 * Math.pow(k, 1.4);
    }
    // Cheekbones: subtle widening just below the eyes.
    const cheek = Math.exp(-Math.pow((ny - 0.02) / 0.16, 2));
    v.x *= 1 + 0.045 * cheek;
    // Chin: pull slightly forward and down.
    if (ny < -0.55) {
      const c = (-0.55 - ny) / 0.45;
      v.z += 0.011 * c * r * 10 * 0.1;
      v.y -= 0.006 * c;
    }
    // Back of head: slightly fuller.
    if (v.z < 0) v.z *= 1.04;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Smooth low-frequency lumpiness for the afro mass. */
function afroNoise(
  T: typeof import("three"),
  geo: THREE.BufferGeometry,
  seed: number,
  amp: number
): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new T.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const len = v.length();
    if (len < 1e-6) continue;
    const theta = Math.atan2(v.z, v.x);
    const phi = Math.acos(Math.max(-1, Math.min(1, v.y / len)));
    const n =
      Math.sin(5 * theta + 1.7 * seed) * Math.sin(4 * phi + 0.6 * seed) +
      0.5 * Math.sin(9 * theta + 3 * phi + seed);
    const s = 1 + amp * n;
    pos.setXYZ(i, v.x * s, v.y * s, v.z * s);
  }
  geo.computeVertexNormals();
}

/**
 * Hair — fuller, natural volumes. All parts positioned relative to the
 * head group; skull centre at local (0, 0.105, 0), radius ≈ 0.105.
 * Seven ids: lowcut, bald, curls, afro, locs, braids, classic.
 * Unknown id → lowcut (never a bare broken head).
 */
function buildHair(
  T: typeof import("three"),
  hair: string,
  mat: THREE.Material,
  accentMat: THREE.Material
): THREE.Object3D[] {
  const parts: THREE.Object3D[] = [];
  const add = (m: THREE.Object3D, x = 0, y = 0, z = 0) => {
    m.position.set(x, y, z);
    parts.push(m);
    return m;
  };
  const sph = (r: number, w = 14, h = 12) => new T.Mesh(new T.SphereGeometry(r, w, h), mat);
  const rand = mulberry32(1234);

  switch (hair) {
    case "bald":
      break;

    case "lowcut": {
      // Tight cap following the skull — a true partial sphere so the face
      // stays clear. Hairline sits just above the brows.
      const cap = new T.Mesh(
        new T.SphereGeometry(0.1095, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.32),
        mat
      );
      add(cap, 0, 0.105, 0);
      break;
    }

    case "classic": {
      // Neat side-parted shape: cap + offset sweep + quiff.
      const cap = new T.Mesh(
        new T.SphereGeometry(0.11, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.34),
        mat
      );
      add(cap, 0, 0.105, 0);
      const sweep = sph(0.055, 16, 12);
      sweep.scale.set(1.5, 0.55, 1.1);
      sweep.rotation.z = -0.18;
      add(sweep, 0.045, 0.19, 0.03);
      const quiff = sph(0.032, 12, 10);
      quiff.scale.set(1.2, 0.8, 1);
      add(quiff, 0.03, 0.205, 0.075);
      break;
    }

    case "afro": {
      // High rounded mass — sits on top, face stays clear.
      const mass = new T.Mesh(new T.SphereGeometry(0.145, 24, 18), mat);
      afroNoise(T, mass.geometry, 7, 0.055);
      add(mass, 0, 0.22, -0.02);
      // Clumps for texture on the upper hemisphere.
      for (let i = 0; i < 18; i++) {
        const t = rand() * Math.PI * 2;
        const p = rand() * Math.PI * 0.55;
        const rr = 0.14;
        const x = rr * Math.sin(p) * Math.cos(t);
        const y = 0.22 + rr * Math.cos(p);
        const z = -0.02 + rr * Math.sin(p) * Math.sin(t);
        add(sph(0.024 + rand() * 0.014, 8, 6), x, y, z);
      }
      break;
    }

    case "curls": {
      // Base cap + clustered coils of varying size.
      const cap = new T.Mesh(
        new T.SphereGeometry(0.112, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.36),
        mat
      );
      add(cap, 0, 0.105, 0);
      for (let i = 0; i < 32; i++) {
        const t = rand() * Math.PI * 2;
        const el = rand() * 1.1;
        const rr = 0.1 + rand() * 0.045;
        const x = rr * Math.cos(t) * Math.cos(el * 0.5);
        const y = 0.17 + rr * Math.sin(el * 0.7) + rand() * 0.03;
        const z = -0.005 + rr * Math.sin(t) * Math.cos(el * 0.5);
        if (y < 0.14) continue;
        add(sph(0.018 + rand() * 0.016, 8, 6), x, y, z);
      }
      break;
    }

    case "locs": {
      const cap = new T.Mesh(
        new T.SphereGeometry(0.11, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.34),
        mat
      );
      add(cap, 0, 0.105, 0);
      // Hanging tapered strands — longer at the back, a few over shoulders.
      for (let i = 0; i < 16; i++) {
        const t = (i / 16) * Math.PI * 2 + rand() * 0.2;
        const len = 0.3 + rand() * 0.14;
        const strand = new T.Mesh(
          new T.CylinderGeometry(0.02, 0.011, len, 8),
          mat
        );
        const x = Math.cos(t) * 0.105;
        const z = Math.sin(t) * 0.105 - 0.005;
        const back = Math.sin(t) < 0 ? 1 : 0.55;
        add(strand, x * 1.05, 0.14 - (len / 2) * 0.92, z * 1.05 - 0.01);
        strand.rotation.x = -Math.sin(t) * 0.16 * back - 0.04;
        strand.rotation.z = Math.cos(t) * 0.16 * back;
        // Rounded tip.
        add(sph(0.011, 8, 6), 0, 0, 0).position.set(
          strand.position.x + Math.sin(strand.rotation.z) * -len * 0.5,
          strand.position.y - len * 0.5,
          strand.position.z
        );
      }
      break;
    }

    case "braids": {
      // Cornrows: curved tubes from the front hairline sweeping back.
      for (let row = 0; row < 6; row++) {
        const x0 = (row - 2.5) * 0.036;
        const curve = new T.CatmullRomCurve3([
          new T.Vector3(x0, 0.185, 0.075),
          new T.Vector3(x0 * 1.15, 0.215, 0.01),
          new T.Vector3(x0 * 1.2, 0.2, -0.06),
          new T.Vector3(x0 * 1.1, 0.15, -0.1),
        ]);
        add(new T.Mesh(new T.TubeGeometry(curve, 8, 0.0125, 6, false), mat));
      }
      // Hanging braids down the back with beads.
      for (let i = 0; i < 10; i++) {
        const x = (i - 4.5) * 0.032;
        const len = 0.2 + rand() * 0.1;
        const braid = new T.Mesh(new T.CylinderGeometry(0.012, 0.009, len, 6), mat);
        add(braid, x, 0.1 - len / 2, -0.115);
        braid.rotation.x = 0.1;
        const bead = new T.Mesh(new T.SphereGeometry(0.014, 8, 6), accentMat);
        add(bead, x, 0.1 - len - 0.012, -0.115 - len * 0.1);
      }
      break;
    }

    default: {
      const cap = new T.Mesh(
        new T.SphereGeometry(0.1095, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.32),
        mat
      );
      add(cap, 0, 0.105, 0);
      break;
    }
  }
  return parts;
}

/** Result of the new single-argument buildAvatarLook(look) call. */
export interface AvatarBuild {
  group: THREE.Group;
  /**
   * Advances blink timers and idle animation. Safe to call every frame.
   * Omitted when the user prefers reduced motion (static neutral pose).
   */
  update?: (t: number, dt: number) => void;
}

export function buildAvatarLook(look: AvatarLook): AvatarBuild;
export function buildAvatarLook(
  threeNs: typeof import("three"),
  look: AvatarLook
): THREE.Group;
export function buildAvatarLook(
  a: AvatarLook | typeof import("three"),
  b?: AvatarLook
): AvatarBuild | THREE.Group {
  const legacy = b !== undefined;
  const T = (legacy ? a : THREE) as typeof import("three");
  const look = (legacy ? b : a) as AvatarLook;
  const built = buildInternal(T, look);
  if (!legacy) return built;
  if (built.update) built.group.userData.update = built.update;
  return built.group;
}

/** Joints the idle loop animates. */
interface Rig {
  upper: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  eyeL: THREE.Group;
  eyeR: THREE.Group;
  baseArmLX: number;
  baseArmRX: number;
  baseArmLZ: number;
  baseArmRZ: number;
}

function buildInternal(T: typeof import("three"), look: AvatarLook): AvatarBuild {
  const group = new T.Group();
  const skin = skinHex(look.skin);
  const isMan = look.body === "man";
  const outfit = [
    "casual",
    "hoodie",
    "office",
    "chill",
    "sitework",
  ].includes(look.outfit)
    ? look.outfit
    : "casual";
  const longSleeves = outfit === "hoodie" || outfit === "office";
  const shorts = outfit === "chill";
  const limbScale = isMan ? 1 : 0.9;

  /* ---------------- materials ---------------- */
  const skinMat = new T.MeshStandardMaterial({
    color: skin,
    roughness: 0.52,
    metalness: 0.02,
  });
  const skinDarkMat = new T.MeshStandardMaterial({
    color: shade(skin, -26),
    roughness: 0.6,
  });
  const lipMat = new T.MeshStandardMaterial({
    color: shade(skin, -42),
    roughness: 0.55,
  });
  const bottomMat = new T.MeshStandardMaterial({
    color: look.bottomColor,
    roughness: 0.85,
  });
  const shoeMat = new T.MeshStandardMaterial({
    color: outfit === "sitework" ? "#5b3a1e" : "#241a12",
    roughness: 0.75,
  });
  const soleMat = new T.MeshStandardMaterial({ color: "#d6cfc4", roughness: 0.9 });
  const hairMat = new T.MeshStandardMaterial({ color: HAIR_HEX, roughness: 0.9 });
  const accentMat = new T.MeshStandardMaterial({
    color: look.topColor,
    roughness: 0.7,
  });
  const whiteMat = new T.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.3 });
  const irisMat = new T.MeshStandardMaterial({ color: IRIS_HEX, roughness: 0.25 });
  const pupilMat = new T.MeshStandardMaterial({ color: "#0d0b09", roughness: 0.2 });

  const torsoTex = fabricTexture(T, look.fabric, look.topColor);
  const shirtMat = new T.MeshStandardMaterial({
    color: look.topColor,
    roughness: 0.85,
    map: torsoTex ?? undefined,
  });
  const vestMat = new T.MeshStandardMaterial({ color: "#eab308", roughness: 0.7 });
  const stripeMat = new T.MeshStandardMaterial({
    color: "#e5e7eb",
    roughness: 0.4,
    emissive: "#555555",
    emissiveIntensity: 0.35,
  });

  const mesh = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x = 0,
    y = 0,
    z = 0
  ) => {
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  };

  /* ---------------- legs + shoes (static, feet planted) ---------------- */
  const HIP_Y = 0.84;
  const legX = 0.098;
  const legProfile: Array<[number, number]> = [
    [0.078, 0.03],
    [0.084, -0.06],
    [0.072, -0.18],
    [0.06, -0.30],
    [0.062, -0.37],
    [0.052, -0.43],
    [0.056, -0.53],
    [0.044, -0.63],
    [0.034, -0.71],
    [0.031, -0.74],
  ].map(([r, y]) => [r * (isMan ? 1 : 0.92), y] as [number, number]);

  for (const sx of [-1, 1]) {
    const legG = new T.Group();
    legG.position.set(sx * legX, HIP_Y, 0);
    legG.add(lathe(T, legProfile, skinMat, 14));

    // Shoe.
    const shoe = new T.Group();
    shoe.position.set(0, 0, 0.02);
    const body = mesh(new T.SphereGeometry(0.075, 14, 12), shoeMat, 0, -0.7, 0.02);
    body.scale.set(0.72, 0.55, 1.6);
    shoe.add(body);
    shoe.add(mesh(new T.BoxGeometry(0.105, 0.028, 0.25), soleMat, 0, -0.726, 0.03));
    const toe = mesh(new T.SphereGeometry(0.05, 12, 10), shoeMat, 0, -0.7, 0.13);
    toe.scale.set(0.85, 0.65, 1);
    shoe.add(toe);
    const collarH = outfit === "sitework" ? 0.16 : 0.07;
    shoe.add(
      mesh(
        new T.CylinderGeometry(0.045, 0.05, collarH, 12),
        shoeMat,
        0,
        -0.74 + collarH / 2 + 0.02,
        -0.01
      )
    );
    legG.add(shoe);

    // Trousers / shorts (garment shells over the leg).
    if (shorts) {
      const sh = mesh(
        new T.CylinderGeometry(0.098, 0.088, 0.3, 14),
        bottomMat,
        0,
        -0.13,
        0
      );
      sh.scale.z = 0.92;
      legG.add(sh);
    } else {
      const tr = mesh(
        new T.CylinderGeometry(0.075, 0.052, 0.68, 14),
        bottomMat,
        0,
        -0.4,
        0
      );
      tr.scale.z = 0.94;
      legG.add(tr);
      // Cuff at the ankle.
      legG.add(
        mesh(new T.CylinderGeometry(0.054, 0.054, 0.05, 14), bottomMat, 0, -0.72, 0)
      );
    }
    group.add(legG);
  }

  /* ---------------- upper body (weight-shift pivot at the hips) ---------------- */
  const upper = new T.Group();
  upper.position.set(0, HIP_Y, 0);
  group.add(upper);
  const LY = (absY: number) => absY - HIP_Y; // abs → upper-local

  // Hip shell (trousers top).
  const hipShell = mesh(
    new T.SphereGeometry(0.158, 16, 12),
    bottomMat,
    0,
    LY(0.9),
    0
  );
  hipShell.scale.set(isMan ? 1.02 : 1.1, 0.78, 0.82);
  upper.add(hipShell);

  // Skin torso underneath (visible at neck/arms).
  const torsoSkinProfile: Array<[number, number]> = (
    isMan
      ? [
          [0.148, 0.86],
          [0.152, 0.98],
          [0.162, 1.1],
          [0.152, 1.2],
          [0.118, 1.29],
          [0.058, 1.33],
        ]
      : [
          [0.15, 0.86],
          [0.142, 0.96],
          [0.156, 1.06],
          [0.16, 1.12],
          [0.142, 1.2],
          [0.11, 1.29],
          [0.054, 1.33],
        ]
  ).map(([r, y]) => [r, LY(y)] as [number, number]);
  const torsoSkin = lathe(T, torsoSkinProfile, skinMat, 18);
  torsoSkin.scale.z = 0.74;
  upper.add(torsoSkin);

  // Shirt (garment shell over the torso).
  const shirtProfile: Array<[number, number]> = (isMan
    ? [
        [0.17, 0.78],
        [0.162, 0.94],
        [0.168, 1.06],
        [0.178, 1.16],
        [0.164, 1.25],
        [0.122, 1.31],
        [0.066, 1.345],
      ]
    : [
        [0.174, 0.78],
        [0.156, 0.94],
        [0.164, 1.04],
        [0.172, 1.12],
        [0.154, 1.22],
        [0.114, 1.3],
        [0.06, 1.34],
      ]
  ).map(([r, y]) => [r * (outfit === "chill" ? 1.1 : 1), LY(y)] as [number, number]);
  const shirt = lathe(T, shirtProfile, shirtMat, 18);
  shirt.scale.z = 0.74;
  upper.add(shirt);

  // Shirt hem band.
  const hem = mesh(
    new T.CylinderGeometry(0.171, 0.175, 0.035, 22),
    shirtMat,
    0,
    LY(0.795),
    0
  );
  hem.scale.z = 0.74;
  upper.add(hem);

  /* ----- outfit extras ----- */
  if (outfit === "hoodie") {
    // Draped hood behind the neck.
    const hood = mesh(
      new T.TorusGeometry(0.088, 0.042, 10, 22, Math.PI * 1.25),
      shirtMat,
      0,
      LY(1.345),
      -0.055
    );
    hood.rotation.x = Math.PI / 2 - 0.35;
    hood.rotation.z = Math.PI * 0.875;
    upper.add(hood);
    // Kangaroo pocket.
    const pocket = mesh(
      new T.SphereGeometry(0.085, 14, 12),
      shirtMat,
      0,
      LY(0.98),
      0.115
    );
    pocket.scale.set(1.05, 0.72, 0.45);
    upper.add(pocket);
    // Drawstrings.
    for (const sx of [-1, 1]) {
      const ds = mesh(
        new T.CylinderGeometry(0.006, 0.006, 0.11, 6),
        accentMat,
        sx * 0.035,
        LY(1.24),
        0.128
      );
      ds.rotation.x = 0.1;
      upper.add(ds);
      upper.add(mesh(new T.SphereGeometry(0.009, 8, 6), accentMat, sx * 0.035, LY(1.182), 0.134));
    }
  }
  if (outfit === "office") {
    // Collar flaps + tie.
    for (const sx of [-1, 1]) {
      const flap = mesh(
        new T.BoxGeometry(0.055, 0.014, 0.045),
        shirtMat,
        sx * 0.042,
        LY(1.35),
        0.062
      );
      flap.rotation.y = sx * 0.35;
      flap.rotation.z = sx * -0.12;
      upper.add(flap);
    }
    const tie = mesh(
      new T.ConeGeometry(0.026, 0.24, 4),
      new T.MeshStandardMaterial({ color: shade(look.topColor, -70), roughness: 0.8 }),
      0,
      LY(1.2),
      0.132
    );
    tie.rotation.x = Math.PI;
    tie.rotation.y = Math.PI / 4;
    tie.scale.z = 0.45;
    upper.add(tie);
    upper.add(
      mesh(new T.SphereGeometry(0.02, 10, 8), tie.material, 0, LY(1.315), 0.1)
    );
  }
  if (outfit === "sitework") {
    // Hi-vis vest shell (sleeveless) + reflective stripes.
    const vestProfile: Array<[number, number]> = [
      [0.182, 0.88],
      [0.178, 1.0],
      [0.188, 1.12],
      [0.178, 1.22],
      [0.13, 1.3],
      [0.075, 1.335],
    ].map(([r, y]) => [r, LY(y)] as [number, number]);
    const vest = lathe(T, vestProfile, vestMat, 18);
    vest.scale.z = 0.74;
    upper.add(vest);
    for (const sy of [1.02, 1.14]) {
      const stripe = mesh(new T.CylinderGeometry(0.186, 0.186, 0.028, 22), stripeMat, 0, LY(sy), 0);
      stripe.scale.z = 0.74;
      upper.add(stripe);
    }
  }

  /* ---------------- arms + hands (pivot at shoulder) ---------------- */
  const armX = isMan ? 0.2 : 0.186;
  const armProfile: Array<[number, number]> = [
    [0.056, 0.03],
    [0.05, -0.08],
    [0.044, -0.18],
    [0.04, -0.25],
    [0.036, -0.33],
    [0.029, -0.42],
    [0.027, -0.45],
  ].map(([r, y]) => [r * limbScale, y] as [number, number]);

  const buildArm = (sx: number) => {
    const arm = new T.Group();
    arm.position.set(sx * armX, LY(1.3), 0);
    arm.add(lathe(T, armProfile, skinMat, 12));
    // Shoulder cap (shirt) — flattened so it blends, not a ball.
    const shoulderCap = mesh(
      new T.SphereGeometry(0.058 * limbScale, 14, 12),
      shirtMat,
      0,
      0.01,
      0
    );
    shoulderCap.scale.set(1, 0.72, 1);
    arm.add(shoulderCap);
    // Sleeves.
    if (longSleeves) {
      const sl = lathe(
        T,
        [
          [0.068, 0.05],
          [0.06, -0.08],
          [0.052, -0.2],
          [0.046, -0.3],
          [0.04, -0.38],
          [0.038, -0.41],
        ].map(([r, y]) => [r * limbScale, y] as [number, number]),
        shirtMat,
        12
      );
      arm.add(sl);
      const cuff = mesh(new T.TorusGeometry(0.04 * limbScale, 0.011, 8, 16), shirtMat, 0, -0.41, 0);
      cuff.rotation.x = Math.PI / 2;
      arm.add(cuff);
    } else {
      const sl = lathe(
        T,
        [
          [0.068, 0.05],
          [0.062, -0.06],
          [0.058, -0.13],
          [0.056, -0.16],
        ].map(([r, y]) => [r * limbScale, y] as [number, number]),
        shirtMat,
        12
      );
      arm.add(sl);
    }
    // Hand: palm + separated fingers + thumb.
    const hand = new T.Group();
    hand.position.set(0, -0.46, 0.004);
    const palm = mesh(new T.SphereGeometry(0.048, 12, 10), skinMat, 0, -0.032, 0);
    palm.scale.set(0.85 * limbScale, 1.2, 0.5);
    hand.add(palm);
    for (let i = 0; i < 4; i++) {
      const f = mesh(
        new T.CylinderGeometry(0.009 * limbScale, 0.008 * limbScale, 0.055, 8),
        skinMat,
        (i - 1.5) * 0.0205 * limbScale,
        -0.1,
        0.008
      );
      f.rotation.x = 0.28;
      hand.add(f);
    }
    const thumb = mesh(
      new T.CylinderGeometry(0.0095 * limbScale, 0.008 * limbScale, 0.045, 8),
      skinMat,
      -sx * 0.04 * limbScale,
      -0.032,
      0.014
    );
    thumb.rotation.z = sx * 0.6;
    thumb.rotation.x = 0.3;
    hand.add(thumb);
    arm.add(hand);

    arm.rotation.x = 0.04;
    arm.rotation.z = sx * 0.06;
    upper.add(arm);
    return arm;
  };
  const armL = buildArm(-1);
  const armR = buildArm(1);

  // Neck.
  upper.add(
    mesh(new T.CylinderGeometry(0.048, 0.056, 0.1, 14), skinMat, 0, LY(1.35), 0)
  );

  /* ---------------- head (pivot at neck top) ---------------- */
  const head = new T.Group();
  head.position.set(0, LY(1.4), 0);
  upper.add(head);
  const HC = 0.105; // skull centre height (head-local)

  head.add(mesh(sculptSkull(T, 0.105), skinMat, 0, HC, 0));

  // Ears with inner detail.
  for (const sx of [-1, 1]) {
    const outer = mesh(
      new T.TorusGeometry(0.023, 0.0085, 8, 18, 4.4),
      skinMat,
      sx * 0.102,
      0.1,
      0
    );
    outer.rotation.y = sx * (Math.PI / 2);
    outer.rotation.z = 0.6;
    head.add(outer);
    head.add(
      mesh(new T.SphereGeometry(0.008, 8, 6), skinDarkMat, sx * 0.1, 0.1, 0.008)
    );
  }

  // Nose: bridge + tip + nostrils.
  const bridge = mesh(
    new T.CylinderGeometry(0.011, 0.014, 0.045, 8),
    skinMat,
    0,
    0.098,
    0.098
  );
  bridge.rotation.x = 0.15;
  head.add(bridge);
  const noseTip = mesh(new T.SphereGeometry(0.016, 10, 8), skinMat, 0, 0.072, 0.1);
  noseTip.scale.set(1, 0.8, 0.9);
  head.add(noseTip);
  for (const sx of [-1, 1]) {
    head.add(
      mesh(new T.SphereGeometry(0.0042, 6, 6), skinDarkMat, sx * 0.011, 0.062, 0.098)
    );
  }

  // Lips: upper + lower, slightly darker and proud of the face.
  const upperLip = mesh(new T.SphereGeometry(0.02, 12, 10), lipMat, 0, 0.042, 0.068);
  upperLip.scale.set(1.6, 0.45, 0.6);
  head.add(upperLip);
  const lowerLip = mesh(new T.SphereGeometry(0.022, 12, 10), lipMat, 0, 0.028, 0.06);
  lowerLip.scale.set(1.5, 0.55, 0.65);
  head.add(lowerLip);

  // Eyes set into the face: socket shading, sclera, iris, pupil, lid fold.
  const buildEye = (sx: number) => {
    const eye = new T.Group();
    eye.position.set(sx * 0.041, 0.115, 0.088);
    const socket = mesh(
      new T.CircleGeometry(0.03, 16),
      new T.MeshStandardMaterial({ color: shade(skin, -18), roughness: 0.7 }),
      0,
      0,
      -0.0015
    );
    eye.add(socket);
    const sclera = mesh(new T.SphereGeometry(0.026, 16, 12), whiteMat);
    sclera.scale.set(1, 0.78, 0.5);
    eye.add(sclera);
    eye.add(mesh(new T.CircleGeometry(0.013, 16), irisMat, 0, 0.001, 0.0135));
    eye.add(mesh(new T.CircleGeometry(0.0068, 12), pupilMat, 0, 0.001, 0.0142));
    // Upper eyelid fold.
    const fold = mesh(
      new T.TorusGeometry(0.028, 0.0038, 8, 18, 2.4),
      skinDarkMat,
      0,
      0.011,
      0.01
    );
    fold.rotation.z = Math.PI / 2 - 1.2;
    fold.rotation.x = -0.15;
    eye.add(fold);
    head.add(eye);
    return eye;
  };
  const eyeL = buildEye(-1);
  const eyeR = buildEye(1);

  // Eyebrows: tapered, angled naturally.
  for (const sx of [-1, 1]) {
    const brow = mesh(
      new T.BoxGeometry(0.044, 0.011, 0.013),
      hairMat,
      sx * 0.044,
      0.152,
      0.09
    );
    brow.rotation.z = -sx * 0.09;
    brow.rotation.y = sx * 0.25;
    brow.scale.x = 1;
    head.add(brow);
  }

  // Hair.
  for (const part of buildHair(T, look.hair, hairMat, accentMat)) head.add(part);

  const rig: Rig = {
    upper,
    torso: shirt,
    head,
    armL,
    armR,
    eyeL,
    eyeR,
    baseArmLX: armL.rotation.x,
    baseArmRX: armR.rotation.x,
    baseArmLZ: armL.rotation.z,
    baseArmRZ: armR.rotation.z,
  };

  /* ---------------- reduced motion → static neutral pose ---------------- */
  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let update: ((t: number, dt: number) => void) | undefined;
  if (!reduced) {
    let nextBlink = 1.2 + Math.random() * 2.5;
    let blinkStart = -1;
    const BLINK_DUR = 0.16;
    const setEyeOpen = (v: number) => {
      rig.eyeL.scale.y = v;
      rig.eyeR.scale.y = v;
    };

    update = (t: number) => {
      if (blinkStart < 0 && t >= nextBlink) {
        blinkStart = t;
        nextBlink = t + 3 + Math.random() * 3;
      }
      if (blinkStart >= 0) {
        const p = (t - blinkStart) / BLINK_DUR;
        if (p >= 1) {
          blinkStart = -1;
          setEyeOpen(1);
        } else {
          const k = p < 0.5 ? p * 2 : (1 - p) * 2;
          setEyeOpen(1 - 0.92 * k);
        }
      }

      const TAU = Math.PI * 2;
      // Breathing: torso shell ±1.6%, shoulders ride gently.
      const br = Math.sin((TAU * t) / 4.4);
      rig.torso.scale.x = 1 + 0.016 * br;
      rig.torso.scale.z = 0.74 * (1 + 0.016 * br);
      // Natural arm hang: micro-sway, opposite phases, slight elbow drift.
      rig.armL.rotation.x = rig.baseArmLX + 0.038 * Math.sin((TAU * t) / 4.9);
      rig.armR.rotation.x = rig.baseArmRX + 0.038 * Math.sin((TAU * t) / 4.9 + Math.PI);
      rig.armL.rotation.z = rig.baseArmLZ + 0.018 * Math.sin((TAU * t) / 7.1);
      rig.armR.rotation.z = rig.baseArmRZ + 0.018 * Math.sin((TAU * t) / 7.1 + 1.4);
      // Head: subtle bob + occasional slow turn, slight tilt.
      rig.head.rotation.x = 0.03 * Math.sin((TAU * t) / 5.9 + 0.8);
      rig.head.rotation.y =
        0.15 * Math.sin((TAU * t) / 21 + 1.2) * (0.6 + 0.4 * Math.sin((TAU * t) / 7.7));
      rig.head.rotation.z = 0.018 * Math.sin((TAU * t) / 11.5);
      // Weight shift.
      const ws = Math.sin((TAU * t) / 8.6);
      rig.upper.rotation.z = 0.02 * ws;
      rig.upper.position.x = 0.016 * Math.sin((TAU * t) / 8.6 + 0.3);
      rig.upper.rotation.y = 0.01 * Math.sin((TAU * t) / 13.5);
    };
  }

  /* ---------------- disposal ---------------- */
  const disposables = new Set<{ dispose(): void }>();
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      if (m.geometry) disposables.add(m.geometry);
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mm of mats) {
        if (!mm) continue;
        const sm = mm as THREE.MeshStandardMaterial;
        if (sm.map) disposables.add(sm.map);
        disposables.add(sm);
      }
    }
  });
  group.userData.dispose = () => {
    for (const d of disposables) d.dispose();
    disposables.clear();
  };

  return update ? { group, update } : { group };
}
