import * as THREE from "three";
import type { AvatarLook } from "../../game/types";

/**
 * M16 avatar model — original procedural humanoid (~1.6 units tall, head
 * ~1/7.5 of height) with idle life: blinking eyes, breathing chest, gentle
 * arm sway, head bob + occasional slow turn, and side-to-side weight shift.
 *
 * Two call shapes (overloads):
 *   buildAvatarLook(look)            → { group, update? }   (new contract)
 *   buildAvatarLook(THREE, look)     → THREE.Group          (legacy; HomeRoom)
 * The legacy shape returns the bare group (with the updater stashed on
 * `group.userData.update` when animation is enabled) so existing callers
 * keep working untouched.
 *
 * Conventions: legs use look.bottomColor, torso uses look.topColor (with a
 * canvas-generated fabric pattern unless fabric === "plain"), arms and head
 * use the skin tone, hair is always dark (#1a1210). The group is rooted at
 * y=0 and group.userData.dispose() releases every geometry / material /
 * texture it created.
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
  const tex = new T.CanvasTexture(canvas);
  tex.wrapS = T.RepeatWrapping;
  tex.wrapT = T.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}

/**
 * Hair parts positioned relative to the head group (head centre at local
 * y≈0.107, radius ≈0.107). Seven ids: lowcut, bald, curls, afro, locs,
 * braids, classic. Unknown id → lowcut (never a bare broken head).
 */
function buildHair(
  T: typeof import("three"),
  hair: string,
  mat: THREE.Material
): THREE.Object3D[] {
  const parts: THREE.Object3D[] = [];
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    parts.push(m);
    return m;
  };
  switch (hair) {
    case "bald":
      break;
    case "lowcut": {
      const cap = add(new T.SphereGeometry(0.112, 20, 14), 0, 0.15, -0.006);
      cap.scale.set(1, 0.62, 1);
      break;
    }
    case "classic": {
      const cap = add(new T.BoxGeometry(0.2, 0.075, 0.2), 0, 0.205, -0.008);
      cap.rotation.y = Math.PI / 8;
      break;
    }
    case "afro": {
      add(new T.SphereGeometry(0.158, 20, 16), 0, 0.215, -0.008);
      break;
    }
    case "curls": {
      for (let i = 0; i < 14; i++) {
        const t = (i / 14) * Math.PI * 2;
        const x = Math.cos(t) * 0.115;
        const z = Math.sin(t) * 0.105 - 0.005;
        const y = 0.195 + 0.02 * Math.cos(i * 1.7);
        add(new T.SphereGeometry(0.037, 10, 8), x, y, z);
      }
      add(new T.SphereGeometry(0.08, 12, 10), 0, 0.2, -0.01);
      break;
    }
    case "locs": {
      for (let i = 0; i < 9; i++) {
        const t = (i / 9) * Math.PI * 2;
        const x = Math.cos(t) * 0.115;
        const z = Math.sin(t) * 0.115;
        const loc = add(new T.CylinderGeometry(0.019, 0.016, 0.3, 8), x, 0.02, z);
        loc.rotation.z = Math.cos(t) * 0.1;
        loc.rotation.x = -Math.sin(t) * 0.1;
      }
      const cap = add(new T.SphereGeometry(0.112, 20, 14), 0, 0.15, -0.006);
      cap.scale.set(1, 0.62, 1);
      break;
    }
    case "braids": {
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 5; col++) {
          const x = (col - 2) * 0.042;
          const z = 0.055 - row * 0.038;
          const y = 0.185 - row * 0.008 - Math.abs(col - 2) * 0.008;
          const braid = add(new T.CylinderGeometry(0.0135, 0.0135, 0.085, 6), x, y, z);
          braid.rotation.x = Math.PI / 2 - 0.3;
        }
      }
      // Short drape down the back.
      for (let i = 0; i < 5; i++) {
        const x = (i - 2) * 0.045;
        const drape = add(new T.CylinderGeometry(0.014, 0.012, 0.16, 6), x, 0.08, -0.105);
        drape.rotation.x = 0.12;
      }
      break;
    }
    default: {
      const cap = add(new T.SphereGeometry(0.112, 20, 14), 0, 0.15, -0.006);
      cap.scale.set(1, 0.62, 1);
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
  // Legacy shape: bare group, with the updater stashed for callers that
  // want to drive the idle loop themselves.
  if (built.update) built.group.userData.update = built.update;
  return built.group;
}

/** Joints the idle loop animates. */
interface Rig {
  upper: THREE.Group;
  chest: THREE.Mesh;
  shoulders: THREE.Group;
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

function buildInternal(
  T: typeof import("three"),
  look: AvatarLook
): AvatarBuild {
  const group = new T.Group();
  const skin = skinHex(look.skin);
  const isMan = look.body === "man";
  const isNative = look.outfit === "native";
  const longSleeves = look.outfit === "native" || look.outfit === "smart";
  const slim = isMan ? 1 : 0.94;

  const skinMat = new T.MeshStandardMaterial({ color: skin, roughness: 0.7 });
  const skinDarkMat = new T.MeshStandardMaterial({
    color: shade(skin, -22),
    roughness: 0.8,
  });
  const bottomMat = new T.MeshStandardMaterial({
    color: look.bottomColor,
    roughness: 0.85,
  });
  const shoeMat = new T.MeshStandardMaterial({ color: "#241a12", roughness: 0.9 });
  const hairMat = new T.MeshStandardMaterial({ color: HAIR_HEX, roughness: 0.95 });
  const whiteMat = new T.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.35 });
  const pupilMat = new T.MeshStandardMaterial({ color: "#14100c", roughness: 0.25 });
  const mouthMat = new T.MeshStandardMaterial({ color: "#3f2a1e", roughness: 0.9 });

  const torsoTex = fabricTexture(T, look.fabric, look.topColor);
  const torsoMat = new T.MeshStandardMaterial({
    color: look.topColor,
    roughness: 0.85,
    map: torsoTex ?? undefined,
  });
  const sleeveMat = longSleeves ? torsoMat : skinMat;

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

  /* ---------------- legs (static; feet planted) ---------------- */
  for (const sx of [-1, 1]) {
    const leg = new T.Group();
    leg.position.set(sx * 0.105, 0.83, 0);
    // Thigh: hip 0.83 → knee 0.45. Shin: knee 0.45 → ankle 0.07.
    leg.add(mesh(new T.CylinderGeometry(0.088 * slim, 0.068 * slim, 0.38, 12), bottomMat, 0, -0.19, 0));
    leg.add(mesh(new T.CylinderGeometry(0.062 * slim, 0.045 * slim, 0.38, 12), skinMat, 0, -0.57, 0));
    // Shoe.
    leg.add(mesh(new T.BoxGeometry(0.115, 0.07, 0.235), shoeMat, 0, -0.795, 0.05));
    group.add(leg);
  }

  /* ---------------- upper body (weight-shift pivot at hips) ---------------- */
  const upper = new T.Group();
  upper.position.set(0, 0.86, 0);
  group.add(upper);

  // Pelvis (bottomColor).
  upper.add(
    mesh(
      new T.BoxGeometry(isMan ? 0.28 : 0.32, isMan ? 0.13 : 0.14, isMan ? 0.19 : 0.21),
      bottomMat,
      0,
      0,
      0
    )
  );

  // Torso: tapered cylinder, flattened in z. Native = long tunic.
  const torsoH = isNative ? 0.72 : 0.4;
  const torsoCY = isNative ? 0.1 : 0.26; // abs 0.96 / 1.12 centre
  const chest = mesh(
    new T.CylinderGeometry(
      isMan ? 0.185 : 0.175,
      isMan ? 0.155 : 0.14,
      torsoH,
      20
    ),
    torsoMat,
    0,
    torsoCY,
    0
  );
  chest.scale.z = 0.66;
  upper.add(chest);

  // Shoulders: bar + caps at the shoulder line (abs y≈1.29).
  const shoulders = new T.Group();
  shoulders.position.set(0, 0.43, 0);
  const barLen = isMan ? 0.38 : 0.34;
  const bar = mesh(new T.CylinderGeometry(0.072, 0.072, barLen, 12), torsoMat);
  bar.rotation.z = Math.PI / 2;
  shoulders.add(bar);
  for (const sx of [-1, 1]) {
    shoulders.add(mesh(new T.SphereGeometry(0.072, 12, 10), sleeveMat, (sx * barLen) / 2, 0, 0));
  }
  upper.add(shoulders);

  // Arms: pivot at the shoulder joint, tapered upper + forearm, simple hand.
  const armX = isMan ? 0.215 : 0.205;
  const buildArm = (sx: number) => {
    const arm = new T.Group();
    arm.position.set(sx * armX, 0.4, 0); // abs y≈1.26
    arm.add(mesh(new T.CylinderGeometry(0.055 * slim, 0.045 * slim, 0.3, 12), sleeveMat, 0, -0.15, 0));
    arm.add(mesh(new T.CylinderGeometry(0.045 * slim, 0.034 * slim, 0.28, 12), sleeveMat, 0, -0.44, 0));
    const hand = mesh(new T.SphereGeometry(0.052, 12, 10), skinMat, 0, -0.615, 0.005);
    hand.scale.set(0.85, 1.3, 0.95);
    arm.add(hand);
    arm.rotation.x = 0.03;
    arm.rotation.z = sx * 0.08;
    upper.add(arm);
    return arm;
  };
  const armL = buildArm(-1);
  const armR = buildArm(1);

  // Neck: defined, skin.
  upper.add(mesh(new T.CylinderGeometry(0.055, 0.062, 0.1, 12), skinMat, 0, 0.51, 0));

  /* ---------------- head (pivot at neck base for bob/turn) ---------------- */
  const head = new T.Group();
  head.position.set(0, 0.54, 0); // abs y≈1.40
  upper.add(head);

  const skull = mesh(new T.SphereGeometry(0.1067, 24, 18), skinMat, 0, 0.107, 0);
  skull.scale.set(0.94, 1.05, 0.98);
  head.add(skull);
  // Ears.
  for (const sx of [-1, 1]) {
    head.add(mesh(new T.SphereGeometry(0.022, 10, 8), skinMat, sx * 0.1, 0.1, 0));
  }
  // Nose hint.
  head.add(mesh(new T.SphereGeometry(0.013, 8, 8), skinDarkMat, 0, 0.088, 0.102));

  // Eyes: white sclera + dark pupil, grouped so a blink can squash Y.
  const buildEye = (sx: number) => {
    const eye = new T.Group();
    eye.position.set(sx * 0.042, 0.118, 0.088);
    const sclera = mesh(new T.SphereGeometry(0.027, 14, 12), whiteMat);
    sclera.scale.set(1, 1, 0.55);
    eye.add(sclera);
    eye.add(mesh(new T.SphereGeometry(0.0125, 10, 8), pupilMat, 0, 0.001, 0.016));
    head.add(eye);
    return eye;
  };
  const eyeL = buildEye(-1);
  const eyeR = buildEye(1);

  // Subtle eyebrows.
  for (const sx of [-1, 1]) {
    const brow = mesh(new T.BoxGeometry(0.038, 0.009, 0.01), hairMat, sx * 0.043, 0.158, 0.092);
    brow.rotation.z = -sx * 0.1;
    head.add(brow);
  }

  // Smile: torus arc.
  const smile = mesh(
    new T.TorusGeometry(0.034, 0.0065, 8, 14, Math.PI),
    mouthMat,
    0,
    0.052,
    0.094
  );
  smile.rotation.z = Math.PI;
  head.add(smile);

  // Hair.
  for (const part of buildHair(T, look.hair, hairMat)) head.add(part);

  // Street outfit: small hood bump behind the neck.
  if (look.outfit === "street") {
    const hood = mesh(new T.SphereGeometry(0.1, 12, 10), torsoMat, 0, 0.48, -0.14);
    hood.scale.set(1, 0.8, 0.7);
    upper.add(hood);
  }

  const rig: Rig = {
    upper,
    chest,
    shoulders,
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
    // Blink state: a blink every 3–6 s, 0.16 s close-open cycle.
    let nextBlink = 1.2 + Math.random() * 2.5;
    let blinkStart = -1;
    const BLINK_DUR = 0.16;
    const setEyeOpen = (v: number) => {
      rig.eyeL.scale.y = v;
      rig.eyeR.scale.y = v;
    };

    update = (t: number) => {
      // Blink.
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
      // Breathing: chest ±2% on x/z, shoulders ride a touch.
      const br = Math.sin((TAU * t) / 4.2);
      rig.chest.scale.x = 1 + 0.02 * br;
      rig.chest.scale.z = 0.66 * (1 + 0.02 * br);
      rig.chest.scale.y = 1 + 0.006 * br;
      rig.shoulders.position.y = 0.43 + 0.004 * br;

      // Gentle arm sway (opposite phases), tiny outward drift.
      rig.armL.rotation.x = rig.baseArmLX + 0.045 * Math.sin((TAU * t) / 4.6);
      rig.armR.rotation.x = rig.baseArmRX + 0.045 * Math.sin((TAU * t) / 4.6 + Math.PI);
      rig.armL.rotation.z = rig.baseArmLZ + 0.02 * Math.sin((TAU * t) / 6.8);
      rig.armR.rotation.z = rig.baseArmRZ + 0.02 * Math.sin((TAU * t) / 6.8 + 1.4);

      // Head: slight bob + occasional slow turn (amplitude-modulated).
      rig.head.rotation.x = 0.035 * Math.sin((TAU * t) / 5.7 + 0.8);
      rig.head.rotation.y =
        0.16 * Math.sin((TAU * t) / 19 + 1.2) * (0.6 + 0.4 * Math.sin((TAU * t) / 7.3));
      rig.head.rotation.z = 0.02 * Math.sin((TAU * t) / 11);

      // Weight shift side to side.
      const ws = Math.sin((TAU * t) / 8.2);
      rig.upper.rotation.z = 0.022 * ws;
      rig.upper.position.x = 0.018 * Math.sin((TAU * t) / 8.2 + 0.3);
      rig.upper.rotation.y = 0.012 * Math.sin((TAU * t) / 13);
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
