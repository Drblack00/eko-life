import type * as THREE from "three";
import { mesh, mulberry32 } from "./util";
import { shade, type AvatarMaterials } from "./materials";
import {
  buildIrisImageWithPalette,
  buildSkinMaterial,
  EYE_COLOR_PALETTE,
  hashSeed,
  paintSkullRoughnessTexture,
  toCanvasTexture,
} from "./faceTextures";

/**
 * Head & face — M20 ultra-realistic rebuild.
 *
 * buildHead returns the head group plus the two eye groups (the idle loop
 * blinks by scaling eyeL/eyeR scale.y — keep every eye part inside them).
 *
 * Head-local coords: skull centre at (0, HC, 0), faces +Z. Skull radius
 * HEAD_R (0.105) — the hair worker positions hair relative to this,
 * so the centre and facing must not move.
 *
 * All geometry is original procedural code. Skin uses a local
 * MeshPhysicalMaterial (subtle clearcoat + sheen) with a procedural pore
 * overlay that multiplies the tone (never greys dark skin). Irises are
 * procedural canvas textures, unique per skin tone and deterministic.
 */

export const HEAD_R = 0.105;
const HC = 0.105; // skull centre height (head-local)

/**
 * Head-to-body ratio (cuteness pass, fix round 2). The whole head group —
 * skull, face AND hair (applied in avatarModel after attachHair) — is
 * scaled by this about the neck-top origin, so the chin anchor stays at
 * figure y=1.4 while the head reads slightly larger and friendlier.
 * The studio camera anchors (parts/studio.ts) are measured against this.
 */
export const HEAD_GROUP_SCALE = 1.08;

export interface HeadCtx {
  /** Skin hex (resolved). */
  skin: string;
  mats: AvatarMaterials;
  /** M8: eye-colour asset id (selects the IRIS_PALETTES entry). */
  eyeColorId?: string;
  /** M8: brow style asset id (parameterizes the brow builder). */
  browStyleId?: string;
}

/**
 * M8 brow style parameters — each style tweaks the strand-card brow
 * builder (count, thickness, arc, length, tint).
 */
export interface BrowStyleParams {
  strands: number;
  /** Strand card [width, length] multiplier vs natural. */
  widthK: number;
  lengthK: number;
  /** Vertical arc lift added to the brow line. */
  arcLift: number;
  /** Colour offset applied to the hair-dark base (negative = darker). */
  tintK: number;
}

export const BROW_STYLES: Record<string, BrowStyleParams> = {
  brow_natural_01: { strands: 16, widthK: 1, lengthK: 1, arcLift: 0, tintK: 0 },
  brow_bold_01: { strands: 20, widthK: 1.35, lengthK: 1.1, arcLift: 0.001, tintK: -18 },
  brow_arched_01: { strands: 14, widthK: 0.8, lengthK: 0.95, arcLift: 0.005, tintK: 0 },
  brow_trimmed_01: { strands: 12, widthK: 0.85, lengthK: 0.72, arcLift: 0, tintK: 8 },
};

export interface BuiltHead {
  group: THREE.Group;
  eyeL: THREE.Group;
  eyeR: THREE.Group;
  /**
   * M7: upper-lid pivots, one per eye, hinged near the TOP of the eye
   * opening (like a real eyelid). The lid shell, lash line, lashes and
   * crease live inside these groups (nothing moved in eye-local space —
   * the inner offset group keeps the net transform identity), so rotating
   * a lid pivot about X performs a real lid-based blink instead of the
   * old whole-eye Y-scale squash. The lower lid stays static.
   */
  upperLidL: THREE.Group;
  upperLidR: THREE.Group;
}

/* ------------------------------------------------------------------ */
/* Pure sculpt helpers (exported for unit tests).                       */
/* ------------------------------------------------------------------ */

/** Smoothstep 0..1. */
export function sstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Jaw-taper factor 0..1 for normalized skull height ny (-1..1). */
export function jawTaperK(ny: number): number {
  if (ny >= 0.18) return 0;
  return Math.min(1, (0.18 - ny) / 1.18);
}

/** Cheekbone fullness bump for normalized skull height ny. */
export function cheekBoost(ny: number): number {
  return Math.exp(-Math.pow((ny - 0.03) / 0.15, 2));
}

/** Distance from point (px,py) to segment (x0,y0)-(x1,y1). */
export function distToSeg(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x0 + t * dx - px;
  const cy = y0 + t * dy - py;
  return Math.sqrt(cx * cx + cy * cy);
}

/**
 * Sculpted skull: sphere with jawline taper + masseter fullness,
 * cheekbone lift, temple narrowing, brow ridge, carved eye sockets,
 * nasolabial-fold depressions, chin with cleft, forehead slope and a
 * slightly fuller occiput. Skull-local coords, centre at origin, radius r.
 *
 * Cuteness pass (fix round 2): softer, rounder shaping — gentler jaw
 * taper, slimmer masseter, softer brow ridge, fuller-but-smooth cheeks,
 * shallower folds. Head proportions grow separately via the head-group
 * scale in avatarModel (HEAD_GROUP_SCALE).
 *
 * M3 visual-fidelity pass: keeps the friendly direction but restores
 * anatomical believability — a defined (not angular) jawline tapering to
 * the chin, a readable jaw angle, a stronger brow ridge, and clearer
 * cheekbone structure.
 */
export function sculptSkull(T: typeof import("three"), r: number): THREE.BufferGeometry {
  const geo = new T.SphereGeometry(r, 30, 22);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new T.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const ny = v.y / r; // -1..1
    const front = sstep(0.12, 0.55, v.z / r); // 0 at back → 1 at face
    const side = Math.min(1, Math.abs(v.x) / r);

    // Jawline: defined taper toward the chin (readable jawline, still
    // rounded — not a hard angle), plus a hint of the jaw angle where
    // the masseter sits.
    const k = jawTaperK(ny);
    if (k > 0) {
      const p = Math.pow(k, 1.3);
      v.x *= 1 - 0.3 * p;
      v.z *= 1 - 0.18 * p;
      const mass = Math.exp(-Math.pow((ny + 0.38) / 0.13, 2)) * side;
      v.x *= 1 + 0.035 * mass;
      // Jaw angle: slight outward read at the back of the jaw.
      const angle = Math.exp(-Math.pow((ny + 0.42) / 0.09, 2)) * side * front;
      v.x *= 1 + 0.022 * angle;
    }
    // Cheekbones: lateral fullness with a touch more structure.
    const ch = cheekBoost(ny) * front * side;
    v.x *= 1 + 0.052 * ch;
    v.z += 0.0032 * ch;
    // Temples: gentle narrowing.
    v.x *= 1 - 0.028 * Math.exp(-Math.pow((ny - 0.34) / 0.12, 2));
    // Brow ridge: present enough to seat deep-set eyes, still open.
    v.z += 0.0038 * Math.exp(-Math.pow((ny - 0.3) / 0.1, 2)) * front;
    // Eye sockets: shallow hollows so the eyes sit *in* the face.
    for (const ex of [-0.0415, 0.0415]) {
      const dx = v.x - ex;
      const dy = v.y - 0.01;
      const s = Math.exp(-(dx * dx + dy * dy) / (0.03 * 0.03)) * front;
      v.z -= 0.0055 * s;
    }
    // Nasolabial folds: curved depressions from the nose wings to the
    // mouth corners.
    for (const sx of [-1, 1]) {
      const d = distToSeg(v.x, v.y, sx * 0.016, -0.027, sx * 0.042, -0.069);
      v.z -= 0.0016 * Math.exp(-Math.pow(d / 0.011, 2)) * front;
    }
    // Chin: forward + down, tapering from the jawline, subtle cleft.
    if (ny < -0.6) {
      const c = (-0.6 - ny) / 0.4;
      v.z += 0.0105 * c * front;
      v.y -= 0.0035 * c;
      v.x *= 1 - 0.05 * c * front; // taper into the chin
      if (Math.abs(v.x) < 0.009 && front > 0.5) v.z -= 0.0012 * c * front;
    }
    // Forehead slopes gently back.
    if (ny > 0.45 && v.z > 0) {
      v.z -= 0.005 * Math.pow((ny - 0.45) / 0.55, 2) * (v.z / r);
    }
    // Occiput slightly fuller.
    if (v.z < 0) v.z *= 1.035;

    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Push a vertex-field shaping function over a geometry, then recompute normals. */
function shapeGeo(
  T: typeof import("three"),
  geo: THREE.BufferGeometry,
  fn: (v: THREE.Vector3) => void
): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new T.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    fn(v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------------------ */
/* buildHead                                                           */
/* ------------------------------------------------------------------ */

export function buildHead(T: typeof import("three"), ctx: HeadCtx): BuiltHead {
  const { skin, eyeColorId, browStyleId } = ctx;
  const head = new T.Group();

  /* ---------------- local enhanced materials ---------------- */
  // Zone-varying roughness (T-zone sheen, matte cheeks) is painted from
  // the sculpted skull's own vertices, so the sheen lands on the real
  // forehead/nose bridge of this exact head.
  const skullGeo = sculptSkull(T, HEAD_R);
  const roughTex = paintSkullRoughnessTexture(T, skullGeo, HEAD_R);
  const skinPhys = buildSkinMaterial(T, skin, {
    roughnessMap: roughTex,
    roughness: 0.58,
    sssGlow: 0.055,
  });
  // Nose: its own skin material WITHOUT the skull's zone roughness map —
  // the nose meshes carry sphere UVs, so sampling the skull-painted map
  // would land on arbitrary gloss zones (bleached nose on light skins).
  // The nose bridge keeps a natural T-zone sheen via a plain 0.48.
  const noseSkin = buildSkinMaterial(T, skin, {
    roughness: 0.48,
    sssGlow: 0.07,
  });
  // Double-sided variant for open shells (eyelids, ear bowls).
  const skinPhysDS = skinPhys.clone();
  skinPhysDS.side = T.DoubleSide;
  const skinDarkPhys = new T.MeshPhysicalMaterial({
    color: shade(skin, -26),
    roughness: 0.6,
    clearcoat: 0.12,
  });
  const lipPhys = new T.MeshPhysicalMaterial({
    color: shade(skin, -38),
    roughness: 0.42,
    clearcoat: 0.4,
    clearcoatRoughness: 0.35,
  });
  const lipEdgeMat = new T.MeshStandardMaterial({
    color: shade(skin, -58),
    roughness: 0.5,
  });
  const mouthDarkMat = new T.MeshStandardMaterial({
    color: "#150b06",
    roughness: 0.95,
  });
  const nostrilMat = new T.MeshStandardMaterial({
    color: "#1d1108",
    roughness: 0.9,
  });
  const scleraMat = new T.MeshPhysicalMaterial({
    color: "#f6f2ea",
    roughness: 0.22,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
  });
  const corneaMat = new T.MeshPhysicalMaterial({
    color: "#ffffff",
    transparent: true,
    opacity: 0.13,
    roughness: 0.05,
    clearcoat: 1,
    depthWrite: false,
  });
  const pupilMat = new T.MeshStandardMaterial({ color: "#0d0b09", roughness: 0.25 });
  const catchMat = new T.MeshBasicMaterial({ color: "#ffffff" });
  const lashMat = new T.MeshStandardMaterial({ color: "#14100c", roughness: 0.85 });
  const hairDarkMat = new T.MeshStandardMaterial({ color: "#171110", roughness: 0.9 });

  /** Local mesh helper — tags meshes so we can count head triangles. */
  const hm = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    part: string,
    x = 0,
    y = 0,
    z = 0
  ): THREE.Mesh => {
    const m = mesh(T, geo, mat, x, y, z);
    m.userData.ws1 = true;
    m.userData.part = part;
    return m;
  };

  /* ---------------- skull ---------------- */
  head.add(hm(skullGeo, skinPhys, "skull", 0, HC, 0));
  // Ears read slightly translucent in life — a touch more SSS glow there.
  const earSkin = buildSkinMaterial(T, skin, {
    roughness: 0.62,
    sssGlow: 0.1,
  });

  /* ---------------- ears: helix / antihelix / concha / tragus / lobe ----------------
   * Seated at eye-to-nose level: the ear top ≈ the eye line (0.115), the
   * lobe ≈ halfway to the nose base — matching the reference anatomy.   */
  for (const sx of [-1, 1]) {
    const ear = new T.Group();
    ear.position.set(sx * 0.1035, 0.106, -0.005);
    ear.rotation.y = (sx * Math.PI) / 2; // local +z → outward, +x → back of head
    const add = (m: THREE.Mesh) => {
      ear.add(m);
      return m;
    };
    // Helix: outer rim curling from top-back around to the lobe.
    const helix = hm(new T.TorusGeometry(0.023, 0.0062, 8, 14, 3.9), earSkin, "ear");
    helix.rotation.z = 0.4;
    helix.position.set(0, 0.004, 0);
    add(helix);
    // Antihelix: inner ridge.
    const anti = hm(new T.TorusGeometry(0.013, 0.004, 6, 10, 2.6), earSkin, "ear");
    anti.rotation.z = 0.9;
    anti.position.set(0.003, 0.003, 0.0035);
    add(anti);
    // Concha mound + darker bowl.
    const concha = hm(new T.SphereGeometry(0.0105, 10, 8), skinPhysDS, "ear", -0.002, -0.001, 0.001);
    concha.scale.set(0.8, 1, 0.45);
    add(concha);
    const bowl = hm(new T.SphereGeometry(0.0068, 8, 6), skinDarkPhys, "ear", -0.0035, -0.001, 0.0032);
    bowl.scale.set(0.8, 1, 0.4);
    add(bowl);
    // Tragus: small bump toward the face.
    const tragus = hm(new T.ConeGeometry(0.0042, 0.009, 8), earSkin, "ear", -0.0075, -0.004, 0.004);
    tragus.rotation.x = Math.PI / 2 - 0.35;
    tragus.rotation.z = 0.3;
    add(tragus);
    // Lobe.
    const lobe = hm(new T.SphereGeometry(0.0085, 8, 6), earSkin, "ear", -0.001, -0.021, 0.001);
    lobe.scale.set(0.85, 1.15, 0.6);
    add(lobe);
    head.add(ear);
  }

  /* ---------------- nose: bridge / tip / alae / nostrils / columella ---------------- */
  {
    const nose = new T.Group();
    const add = (m: THREE.Mesh) => nose.add(m);
    // Dorsum: a wide, low ellipsoid hugging the face — the bridge reads via
    // soft shading, not a hard ridge. Top buried in the brow so the nose
    // grows out of the face.
    const dorsumGeo = shapeGeo(T, new T.SphereGeometry(0.02, 14, 10), (v) => {
      const t = v.y / 0.02; // -1 bottom … +1 top
      if (t > 0.2) v.x *= 1 - 0.12 * (t - 0.2); // gentle taper toward the brow
    });
    const dorsum = hm(dorsumGeo, noseSkin, "nose", 0, 0.098, 0.096);
    dorsum.scale.set(0.82, 1.6, 0.5);
    dorsum.rotation.x = -0.1;
    add(dorsum);
    // Tip: soft bulb overlapping the dorsum bottom (no junction gap) —
    // broad enough to read naturally, still friendly.
    const tipGeo = shapeGeo(T, new T.SphereGeometry(0.0165, 14, 10), (v) => {
      if (v.y < -0.004) v.y *= 0.82;
    });
    const tip = hm(tipGeo, noseSkin, "nose", 0, 0.0695, 0.1025);
    tip.scale.set(1.04, 0.76, 0.84);
    tip.rotation.x = 0.15;
    add(tip);
    for (const sx of [-1, 1]) {
      // Nostril wings (alae): broader, clearly flaring past the tip —
      // the defining read of the reference nose.
      const ala = hm(new T.SphereGeometry(0.011, 12, 10), noseSkin, "nose", sx * 0.0195, 0.06, 0.0985);
      ala.scale.set(1.0, 0.62, 1.0);
      ala.rotation.y = sx * 0.5;
      ala.rotation.x = 0.2;
      add(ala);
      // Nostril openings: dark, angled down-forward.
      const nos = hm(new T.SphereGeometry(0.007, 10, 8), nostrilMat, "nose", sx * 0.0115, 0.0535, 0.103);
      nos.scale.set(0.72, 0.5, 0.6);
      nos.rotation.x = 0.55;
      nos.rotation.z = sx * 0.3;
      add(nos);
    }
    // Columella between the nostrils.
    const col = hm(new T.CylinderGeometry(0.0032, 0.0042, 0.013, 8), noseSkin, "nose", 0, 0.058, 0.105);
    col.rotation.x = 0.4;
    add(col);
    head.add(nose);
  }

  /* ---------------- mouth: cavity / lips / vermilion border ---------------- */
  {
    const mouth = new T.Group();
    const add = (m: THREE.Mesh) => mouth.add(m);
    // Dark inner mouth so the mouth reads at close-up.
    const cavity = hm(new T.SphereGeometry(0.023, 14, 10), mouthDarkMat, "mouth", 0, 0.0308, 0.0605);
    cavity.scale.set(1.32, 0.4, 0.45);
    add(cavity);
    // Upper lip with cupid's bow — full, with clear upper/lower definition.
    const upperGeo = shapeGeo(T, new T.SphereGeometry(0.0195, 14, 10), (v) => {
      if (v.y > 0.006 && Math.abs(v.x) < 0.007) {
        v.y -= 0.0035 * (1 - Math.abs(v.x) / 0.007); // cupid's bow notch
      }
    });
    const upper = hm(upperGeo, lipPhys, "mouth", 0, 0.0402, 0.0645);
    upper.scale.set(1.72, 0.52, 0.5);
    add(upper);
    // Lower lip, fuller in the centre.
    const lowerGeo = shapeGeo(T, new T.SphereGeometry(0.0205, 14, 10), (v) => {
      v.z += 0.0025 * Math.exp(-Math.pow(v.x / 0.011, 2));
    });
    const lower = hm(lowerGeo, lipPhys, "mouth", 0, 0.0232, 0.063);
    lower.scale.set(1.62, 0.68, 0.5);
    add(lower);
    // Philtrum hint: two faint vertical ridges from the nose base to the
    // cupid's bow, framing the philtral groove.
    for (const sx of [-1, 1]) {
      const ridgeCurve = new T.QuadraticBezierCurve3(
        new T.Vector3(sx * 0.0038, 0.056, 0.0865),
        new T.Vector3(sx * 0.0042, 0.052, 0.0795),
        new T.Vector3(sx * 0.0045, 0.0475, 0.07)
      );
      add(hm(new T.TubeGeometry(ridgeCurve, 6, 0.0011, 5), skinPhys, "mouth"));
    }
    // Vermilion border: darker lip-line arcs, upper and lower.
    const borderU = hm(new T.TorusGeometry(0.0235, 0.0026, 5, 18, Math.PI), lipEdgeMat, "mouth", 0, 0.0318, 0.0665);
    borderU.scale.set(1.32, 0.55, 1);
    add(borderU);
    const borderL = hm(new T.TorusGeometry(0.0225, 0.0026, 5, 18, Math.PI), lipEdgeMat, "mouth", 0, 0.0305, 0.0655);
    borderL.rotation.z = Math.PI;
    borderL.scale.set(1.28, 0.5, 1);
    add(borderL);
    // Mouth corners: lifted a touch for a gentle, friendly default.
    for (const sx of [-1, 1]) {
      add(hm(new T.SphereGeometry(0.0028, 6, 5), mouthDarkMat, "mouth", sx * 0.0295, 0.0326, 0.0625));
    }
    head.add(mouth);
  }

  /* ---------------- nasolabial fold accents (subtle geometry) ---------------- */
  for (const sx of [-1, 1]) {
    const curve = new T.QuadraticBezierCurve3(
      new T.Vector3(sx * 0.0165, 0.078, 0.08),
      new T.Vector3(sx * 0.031, 0.057, 0.0765),
      new T.Vector3(sx * 0.04, 0.036, 0.069)
    );
    head.add(hm(new T.TubeGeometry(curve, 12, 0.0011, 6), skinDarkPhys, "fold"));
  }

  /* ---------------- eyes (the centrepiece) ---------------- */
  // One iris texture per build (both eyes share it — same person, same eyes),
  // unique per skin tone, deterministic per seed. M8: the palette comes
  // from the eye-colour choice (default deep brown).
  const eyeId = eyeColorId ?? "eye_brown_01";
  const irisTex = toCanvasTexture(
    T,
    buildIrisImageWithPalette(
      128,
      hashSeed(skin + ":iris:" + eyeId),
      EYE_COLOR_PALETTE[eyeId] ?? 0
    )
  );
  const irisMat = new T.MeshStandardMaterial({
    map: irisTex ?? undefined,
    color: irisTex ? "#ffffff" : "#3a2415",
    roughness: 0.3,
  });
  // Tag for the assembler's findIrisMaterial (works with or without a DOM —
  // the texture-sniffing fallback can't see the iris in Node, where canvas
  // textures return null).
  irisMat.userData.irisMaterial = true;

  const buildEye = (sx: number, irisMat: THREE.Material): { eye: THREE.Group; upperLid: THREE.Group } => {
    const eye = new T.Group();
    eye.position.set(sx * 0.0415, 0.115, 0.0875);
    const add = (m: THREE.Mesh) => eye.add(m);
    // M7: the upper lid is its own pivot group. It hinges near the TOP of
    // the eye opening (like a real eyelid), not at the eyeball centre —
    // rotating about the ball centre dragged the lid's top edge back and
    // exposed a white sclera crescent above it (seen in m7 screenshots).
    // The children keep their eye-local coords inside an inner offset
    // group, so nothing moves in eye-local space (identity net transform).
    const LID_HINGE_Y = 0.022;
    const upperLid = new T.Group();
    upperLid.position.set(0, LID_HINGE_Y, 0);
    eye.add(upperLid);
    const lidInner = new T.Group();
    lidInner.position.set(0, -LID_HINGE_Y, 0);
    upperLid.add(lidInner);
    const addLid = (m: THREE.Mesh) => lidInner.add(m);

    // Soft orbital shading behind the eyeball.
    add(hm(new T.CircleGeometry(0.0305, 20), skinDarkPhys, "eye", 0, 0, -0.002));
    // Eyeball: larger and rounder than the old almond cut (cuteness pass).
    const sclera = hm(new T.SphereGeometry(0.0272, 14, 10), scleraMat, "eye", 0, 0, 0.001);
    sclera.scale.set(1.0, 0.92, 0.6);
    add(sclera);
    // Iris + pupil on the front of the ball.
    add(hm(new T.CircleGeometry(0.0132, 24), irisMat, "eye", 0, 0, 0.0178));
    add(hm(new T.CircleGeometry(0.0064, 16), pupilMat, "eye", 0, 0, 0.0184));
    // Cornea bulge: clear wet dome over the iris.
    const cornea = hm(
      new T.SphereGeometry(0.0148, 12, 8, 0, Math.PI * 2, 0, 1.05),
      corneaMat,
      "eye",
      0,
      0.0005,
      0.0095
    );
    add(cornea);
    // Catchlights: crisp main + faint secondary.
    const cl1 = hm(new T.PlaneGeometry(0.0046, 0.0064), catchMat, "eye", 0.0047, 0.0056, 0.023);
    cl1.rotation.z = -0.4;
    add(cl1);
    add(hm(new T.PlaneGeometry(0.0026, 0.0026), catchMat, "eye", -0.0056, -0.0047, 0.022));
    // Upper eyelid: draped shell hugging the top of the ball. The rim of
    // the cap lands just above the iris centre so the eye reads open.
    const lidGeo = new T.SphereGeometry(0.0315, 14, 6, 0, Math.PI * 2, 0, 1.42);
    const lid = hm(lidGeo, skinPhysDS, "eye", 0, 0.003, 0.002);
    lid.rotation.x = 0.12;
    lid.scale.set(1.02, 0.6, 0.7);
    addLid(lid);
    // Lid-rim curve (front arc of the lid edge) — lash line, lashes and
    // crease all follow it so they sit exactly on the lid.
    const rimCurve = (yBase: number, yDip: number, rx: number, rz: number, zOff: number, half: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) {
        const phi = -half + (i / 12) * half * 2;
        pts.push(
          new T.Vector3(
            rx * Math.sin(phi),
            yBase - yDip * Math.abs(Math.sin(phi)),
            zOff + rz * Math.cos(phi)
          )
        );
      }
      return new T.CatmullRomCurve3(pts);
    };
    // Lash line: dark tube along the lid rim.
    const LASH_Y = 0.005;
    addLid(hm(new T.TubeGeometry(rimCurve(LASH_Y, 0.0022, 0.0295, 0.022, 0.002, 1.05), 16, 0.0023, 5), lashMat, "eye"));
    // Individual lashes: short tapered cones along the rim, flicking down-forward.
    const lashRand = mulberry32(hashSeed(skin) + (sx > 0 ? 11 : 77));
    const lashDir = new T.Vector3();
    const lashUp = new T.Vector3(0, 1, 0);
    for (let i = 0; i < 9; i++) {
      const phi = -1.0 + (i / 8) * 2.0 + (lashRand() - 0.5) * 0.12;
      const px = 0.0295 * Math.sin(phi);
      const py = LASH_Y - 0.0022 * Math.abs(Math.sin(phi));
      const pz = 0.002 + 0.022 * Math.cos(phi);
      const lash = hm(new T.ConeGeometry(0.0012, 0.0082, 5), lashMat, "eye", px, py + 0.001, pz + 0.001);
      lashDir.set(Math.sin(phi) * 0.45, -0.62, Math.cos(phi) * 0.64).normalize();
      lash.quaternion.setFromUnitVectors(lashUp, lashDir);
      lash.rotateX((lashRand() - 0.5) * 0.2);
      lash.scale.y = 0.8 + lashRand() * 0.5;
      addLid(lash);
    }
    // Lower lid: slim arc under the eye.
    add(hm(new T.TubeGeometry(rimCurve(-0.0085, -0.0032, 0.027, 0.018, 0.0015, 1.1), 14, 0.0027, 5), skinPhys, "eye"));
    // Lower-lid shell: a shallow cup under the ball so the eye reads
    // seated in real lids (upper shell + lower shell), not floating.
    const lowLid = hm(
      new T.SphereGeometry(0.0315, 12, 6, 0, Math.PI * 2, 1.8, 0.85),
      skinPhysDS,
      "eye",
      0,
      -0.002,
      0.002
    );
    lowLid.scale.set(1.0, 0.78, 0.7);
    add(lowLid);
    // Eyelid crease above.
    addLid(hm(new T.TubeGeometry(rimCurve(0.0195, 0.0032, 0.033, 0.0175, -0.002, 1.05), 14, 0.0019, 5), skinDarkPhys, "eye"));

    head.add(eye);
    return { eye, upperLid };
  };
  const eyeL = buildEye(-1, irisMat);
  const eyeR = buildEye(1, irisMat);

  /* ---------------- eyebrows: individual strand cards ---------------- */
  // Strands sit just proud of the skull surface (computed from the sphere —
  // the sculpt terms are negligible on the forehead) and below the hairline.
  // M8: parameterized by browStyleId (see BROW_STYLES above).
  buildBrows(T, head, hm, { skin, hairDarkMat, browStyleId });

  return {
    group: head,
    eyeL: eyeL.eye,
    eyeR: eyeR.eye,
    upperLidL: eyeL.upperLid,
    upperLidR: eyeR.upperLid,
  };
}

/**
 * M8: procedural eyebrows. `hm` is buildHead's local mesh helper (tags
 * meshes for triangle counting). Pure geometry — material isolation is
 * the caller's (buildHead allocates hairDarkMat fresh per build).
 */
export function buildBrows(
  T: typeof import("three"),
  head: THREE.Group,
  hm: (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    part: string,
    x?: number,
    y?: number,
    z?: number
  ) => THREE.Mesh,
  ctx: { skin: string; hairDarkMat: THREE.Material; browStyleId?: string }
): void {
  const style =
    BROW_STYLES[ctx.browStyleId ?? "brow_natural_01"] ??
    BROW_STYLES.brow_natural_01;
  // tintK shifts the strand colour (bold = darker, trimmed = softer).
  const browMat =
    style.tintK !== 0
      ? new T.MeshStandardMaterial({
          color: shade("#171110", style.tintK),
          roughness: 0.9,
        })
      : ctx.hairDarkMat;
  const strandGeo = new T.PlaneGeometry(
    0.0038 * style.widthK,
    0.009 * style.lengthK
  );
  for (const sx of [-1, 1]) {
    const browRand = mulberry32(hashSeed(ctx.skin) + (sx > 0 ? 101 : 202));
    for (let i = 0; i < style.strands; i++) {
      const t = style.strands > 1 ? i / (style.strands - 1) : 0.5;
      const bx = sx * (0.02 + 0.046 * t);
      const by =
        0.1485 +
        0.004 * Math.sin(Math.PI * Math.pow(t, 0.85)) -
        0.0015 * t +
        style.arcLift * Math.sin(Math.PI * t);
      const yl = by - HC; // skull-local y
      const surfZ = Math.sqrt(
        Math.max(1e-6, HEAD_R * HEAD_R - bx * bx - yl * yl)
      );
      const bz = surfZ + 0.0028;
      const strand = hm(strandGeo, browMat, "brow", bx, by, bz);
      strand.rotation.order = "ZYX";
      // Strands lie along the brow: inner hairs sweep up-out, outer down-out.
      strand.rotation.z = -sx * (1.12 + 0.38 * t) + (browRand() - 0.5) * 0.22;
      strand.rotation.x = -0.3 + (browRand() - 0.5) * 0.15;
      strand.rotation.y = sx * 0.15;
      strand.scale.y = 0.85 + 0.3 * Math.sin(Math.PI * t) + browRand() * 0.15;
      head.add(strand);
    }
  }
}
