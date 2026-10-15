import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { PinLocation } from "./stubLocations";
import {
  drawBillboardCreative,
  type BillboardCreative,
} from "./billboardCanvas";
import {
  districtLabelsForCity,
  DISTRICT_WORLD_H,
  PIN_LABEL_ZOOM_DIST,
  PIN_PILL_DY,
  PIN_PILL_WORLD_H,
  pillTextSize,
  pillWorldScale,
  resolvePillColors,
  type PillColors,
} from "./CityMap.labels";
import "./CityMap.css";

/**
 * Original procedural toy-Lagos: green Mainland (left), blue lagoon (center),
 * green Island (right). Instanced houses with pyramid roofs, mid-rise blocks
 * and glass towers, roads with dashes, bridges over the lagoon, landmarks
 * (stadium, hospital, school, market), sailboats, palms + leafy trees, emoji
 * pins, region labels. One finger pans, pinch zooms, two fingers tilt and
 * turn, tap a pin to select it.
 */

const WORLD = { x: 90, z: 90 };
const LAGOON_HALF = 13;
const ROAD_X = 36; // avenue center on each land mass (|x|)

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeEmojiTexture(emoji: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.beginPath();
  g.arc(64, 64, 56, 0, Math.PI * 2);
  g.fillStyle = "rgba(255,255,255,0.96)";
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = "rgba(2,132,199,0.9)";
  g.stroke();
  g.font = "72px 'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(emoji, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeLabelTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 96;
  const g = c.getContext("2d")!;
  g.font = "800 56px 'Baloo 2', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 10;
  g.strokeStyle = "rgba(255,255,255,0.85)";
  g.strokeText(text, 256, 48);
  g.fillStyle = "rgba(12,74,110,0.9)";
  g.fillText(text, 256, 48);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Read one CSS custom property from <html> (the app's theme tokens). */
function readThemeVar(name: string): string | null {
  try {
    return (
      getComputedStyle(document.documentElement).getPropertyValue(name) ||
      null
    );
  } catch {
    return null;
  }
}

/**
 * Rounded pill/chip texture for a place name. Colors come from the app's
 * theme tokens (--surface/--text/--ring, day or night) so the chip stays
 * legible in both themes; the canvas is sized to the text.
 */
function makePillTexture(text: string, colors: PillColors): THREE.CanvasTexture {
  const font = "700 52px 'Baloo 2','Comic Sans MS',system-ui,sans-serif";
  const measurer = document.createElement("canvas").getContext("2d")!;
  const { w, h } = pillTextSize(text, (t, f) => {
    measurer.font = f;
    return measurer.measureText(t).width;
  });
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  // Pill body
  const pad = 6;
  const x0 = pad;
  const y0 = pad;
  const w0 = w - pad * 2;
  const h0 = h - pad * 2;
  const r = h0 / 2;
  g.beginPath();
  g.moveTo(x0 + r, y0);
  g.arcTo(x0 + w0, y0, x0 + w0, y0 + h0, r);
  g.arcTo(x0 + w0, y0 + h0, x0, y0 + h0, r);
  g.arcTo(x0, y0 + h0, x0, y0, r);
  g.arcTo(x0, y0, x0 + w0, y0, r);
  g.closePath();
  g.fillStyle = colors.bg;
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = colors.ring;
  g.stroke();
  // Label text
  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = colors.fg;
  g.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Red/white striped awning texture for market stalls (original canvas art). */
function makeStripeTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f8fafc";
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#dc2626";
  for (let x = 0; x < 128; x += 32) g.fillRect(x, 0, 16, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Billboard record from GET /api/v2/m13/billboards (map coords 0–100). */
export interface BillboardSpec extends BillboardCreative {
  id: number;
  x: number;
  y: number;
  scale: number;
  active?: boolean;
}

function clampBillboardScale(s: unknown): number {
  const n = Number(s);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0.5, Math.min(3, n));
}

/**
 * Fetch active billboards for the map. Any failure → []: billboards are
 * decorative, so the city renders fine without them.
 */
async function fetchBillboards(): Promise<BillboardSpec[]> {
  try {
    const res = await fetch("/api/v2/m13/billboards");
    if (!res.ok) return [];
    const body = (await res.json()) as { billboards?: unknown };
    const list = Array.isArray(body?.billboards) ? body.billboards : [];
    return (list as Array<Partial<BillboardSpec>>)
      .filter(
        (b) =>
          !!b &&
          typeof b.headline === "string" &&
          Number.isFinite(Number(b.x)) &&
          Number.isFinite(Number(b.y))
      )
      .slice(0, 24)
      .map((b, i) => ({
        id: Number(b.id) || i,
        headline: String(b.headline),
        subtext: b.subtext ?? "",
        bg: b.bg ?? "#0f172a",
        fg: b.fg ?? "#ffffff",
        accent: b.accent ?? "#22d3ee",
        x: Number(b.x),
        y: Number(b.y),
        scale: clampBillboardScale(b.scale),
        active: b.active !== false,
      }));
  } catch {
    return [];
  }
}

/** 512×256 runtime texture for one billboard creative (no external images). */
function makeBillboardTexture(b: BillboardCreative): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  drawBillboardCreative(g, b, 512, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Fill a geometry with a solid vertex color (for merged landmark meshes). */
function paint(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Scale then translate a geometry (for merged landmark meshes). */
function xg(
  geo: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  sx = 1,
  sy = 1,
  sz = 1
): THREE.BufferGeometry {
  geo.scale(sx, sy, sz);
  geo.translate(x, y, z);
  return geo;
}

export function CityMap({
  pins,
  onPinSelect,
  cityId,
}: {
  pins: PinLocation[];
  onPinSelect: (pin: PinLocation) => void;
  /** Home City V1: district label pack id (default 'lagos'). */
  cityId?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const pinsRef = useRef(pins);
  const selectRef = useRef(onPinSelect);
  /** Assigned by the mount effect; lets the pin layer refresh when `pins` changes. */
  const rebuildRef = useRef<((list: PinLocation[]) => void) | null>(null);
  /** Home City V1: rebuilds district labels for the current cityId. */
  const districtRebuildRef = useRef<(() => void) | null>(null);
  const cityRef = useRef(cityId);
  pinsRef.current = pins;
  cityRef.current = cityId;
  selectRef.current = onPinSelect;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Non-null alias: TS narrowing of `host` does not survive into the
    // nested buildScene() below, so keep a definitely-assigned reference.
    const hostEl: HTMLDivElement = host;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let cancelled = false;
    const cleanups: Array<() => void> = [];
    const onCleanup = (fn: () => void) => {
      cleanups.push(fn);
    };

    // M13 billboards load async; the scene builds once they resolve. A
    // failed fetch just means no billboards — the city still renders.
    void (async () => {
      const billboards = await fetchBillboards();
      if (cancelled) return;
      buildScene(billboards);
    })();

    function buildScene(billboards: BillboardSpec[]) {
    const scene = new THREE.Scene();
    // Realistic sky: vertical gradient.
    {
      const sc = document.createElement("canvas");
      sc.width = 4; sc.height = 256;
      const sx = sc.getContext("2d")!;
      const grad = sx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, "#7fb2e5");
      grad.addColorStop(0.55, "#bcd6ef");
      grad.addColorStop(0.8, "#e8eef2");
      grad.addColorStop(1, "#f5f0e6");
      sx.fillStyle = grad;
      sx.fillRect(0, 0, 4, 256);
      const skyTex = new THREE.CanvasTexture(sc);
      skyTex.colorSpace = THREE.SRGBColorSpace;
      scene.background = skyTex;
    }
    scene.fog = new THREE.Fog(0xd4dee8, 130, 280);
    scene.fog = new THREE.Fog(0xbfdbfe, 220, 420);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      // No WebGL on this device/browser — show a friendly note instead of a
      // blank box, with a retry in case it was transient.
      const note = document.createElement("div");
      note.className = "eko-citymap__nogl";
      note.innerHTML =
        '<p>🗺️ The 3D city needs WebGL, which this browser blocked.</p>' +
        '<button type="button">Try again</button>';
      note.querySelector("button")?.addEventListener("click", () => {
        note.remove();
        buildScene(billboards);
      });
      hostEl.appendChild(note);
      onCleanup(() => {
        if (note.parentNode === hostEl) hostEl.removeChild(note);
      });
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    hostEl.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(42, 1, 1, 800);
    camera.position.set(0, 96, 104);
    camera.lookAt(0, 0, 6);

    const controls = new OrbitControls(camera, renderer.domElement);
    // Pan with one finger (mouse: left-drag), tilt + turn with two fingers
    // (mouse: right-drag), zoom with pinch or wheel.
    controls.enableRotate = true;
    controls.enablePan = true;
    controls.enableDamping = !reducedMotion;
    controls.dampingFactor = 0.08;
    controls.minDistance = 55;
    controls.maxDistance = 230;
    // Tilt range: allow near-top-down views, never dip below the horizon.
    controls.minPolarAngle = Math.PI * 0.12;
    controls.maxPolarAngle = Math.PI * 0.46;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    controls.screenSpacePanning = false;

    // Lights
    scene.add(new THREE.HemisphereLight(0xe0f2fe, 0x86a860, 0.9));
    const sun = new THREE.DirectionalLight(0xfff7e6, 1.6);
    sun.position.set(-60, 120, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -110;
    sun.shadow.camera.right = 110;
    sun.shadow.camera.top = 110;
    sun.shadow.camera.bottom = -110;
    sun.shadow.camera.far = 400;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    // Seabed / base
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(WORLD.x * 2 + 20, 2, WORLD.z * 2 + 20),
      new THREE.MeshStandardMaterial({ color: 0xc2b280, roughness: 1 })
    );
    base.position.y = -2;
    base.receiveShadow = true;
    scene.add(base);

    // Lagoon water (animated vertices)
    const waterGeo = new THREE.PlaneGeometry(
      LAGOON_HALF * 2 + 2,
      WORLD.z * 2,
      10,
      60
    );
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x00b4d8,
      roughness: 0.35,
      metalness: 0.15,
      transparent: true,
      opacity: 0.94,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.y = 0.4;
    scene.add(water);
    const waterBase = waterGeo.attributes.position.array.slice();

    const landMat = new THREE.MeshStandardMaterial({
      color: 0x22c55e,
      roughness: 1,
    });
    const landMat2 = new THREE.MeshStandardMaterial({
      color: 0x16a34a,
      roughness: 1,
    });

    // Mainland (left) + Island (right)
    for (const [side, mat] of [
      [-1, landMat],
      [1, landMat2],
    ] as const) {
      const w = WORLD.x - LAGOON_HALF;
      const land = new THREE.Mesh(new THREE.BoxGeometry(w, 4, WORLD.z * 2), mat);
      land.position.set(side * (LAGOON_HALF + w / 2), 1, 0);
      scene.add(land);
      // Sandy shore strip at the water edge
      const shore = new THREE.Mesh(
        new THREE.BoxGeometry(4, 4.4, WORLD.z * 2),
        new THREE.MeshStandardMaterial({ color: 0xf5e6c4, roughness: 1 })
      );
      shore.position.set(side * (LAGOON_HALF + 2), 1, 0);
      scene.add(shore);
    }

    const rand = mulberry32(20261009);

    // M13: billboard footprints (map coords → world) so buildings keep clear.
    const boardSpots = billboards.map((b) => {
      const s = clampBillboardScale(b.scale);
      return {
        x: (Number(b.x) / 100) * 172 - 86,
        z: (Number(b.y) / 100) * 172 - 86,
        r: 9 * s,
      };
    });

    // Landmark footprints (world coords) — buildings/trees/roads keep clear.
    const landmarkSpots = [
      { x: -55, z: 0, r: 16 }, // stadium
      { x: 52, z: 8, r: 8 }, // hospital
      { x: -58, z: -44, r: 6 }, // school
      { x: 28, z: 41, r: 13 }, // market row
      { x: -30, z: -60, r: 10 }, // church
      { x: 55, z: -50, r: 10 }, // mosque
      { x: -20, z: 55, r: 15 }, // danfo park
    ];

    /** True when a spot of radius `pad` is free of pins, billboards, roads, landmarks. */
    function spotClear(x: number, z: number, pad: number): boolean {
      if (pinsRef.current.some((p) => Math.hypot(p.x - x, p.z - z) < pad + 7))
        return false;
      if (boardSpots.some((sp) => Math.hypot(sp.x - x, sp.z - z) < pad + sp.r))
        return false;
      if (Math.abs(Math.abs(x) - ROAD_X) < pad + 4) return false;
      if (
        landmarkSpots.some((sp) => Math.hypot(sp.x - x, sp.z - z) < pad + sp.r)
      )
        return false;
      return true;
    }
    function scatterX(side: number): number {
      return side * (LAGOON_HALF + 6 + rand() * (WORLD.x - LAGOON_HALF - 12));
    }
    function scatterZ(margin: number): number {
      return (rand() - 0.5) * (WORLD.z * 2 - margin);
    }

    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    function finalizeInstances(mesh: THREE.InstancedMesh, placed: number) {
      mesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      scene.add(mesh);
    }

    // ---- Buildings: warm houses with pyramid roofs ----
    const HOUSE_N = 140;
    const houseGeo = new THREE.BoxGeometry(1, 1, 1);
    const houseMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
    const houses = new THREE.InstancedMesh(houseGeo, houseMat, HOUSE_N);
    const roofGeo = new THREE.ConeGeometry(1, 1, 4);
    roofGeo.rotateY(Math.PI / 4); // square pyramid, edges axis-aligned
    const roofMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
    const roofs = new THREE.InstancedMesh(roofGeo, roofMat, HOUSE_N);
    const housePalette = [0xf2d492, 0xf4a259, 0xfdf0d5, 0xe9c46a, 0xf6bd60];
    const roofPalette = [0xff6b6b, 0x4ecdc4, 0xffd93d, 0xa78bfa];
    let hp = 0;
    let guard = 0;
    while (hp < HOUSE_N && guard++ < 6000) {
      const side = rand() < 0.5 ? -1 : 1;
      const x = scatterX(side);
      const z = scatterZ(16);
      if (!spotClear(x, z, 3.5)) continue;
      const w = 3.5 + rand() * 2.5;
      const d = 3.5 + rand() * 2.5;
      const h = 2.5 + rand() * 2;
      const rot = (rand() - 0.5) * 0.3;
      dummy.position.set(x, 3 + h / 2, z);
      dummy.scale.set(w, h, d);
      dummy.rotation.set(0, rot, 0);
      dummy.updateMatrix();
      houses.setMatrixAt(hp, dummy.matrix);
      col.setHex(housePalette[(rand() * housePalette.length) | 0]);
      houses.setColorAt(hp, col);
      const rh = 1.4 + rand() * 1;
      dummy.position.set(x, 3 + h + rh / 2 - 0.05, z);
      dummy.scale.set(w * 0.84, rh, d * 0.84);
      dummy.updateMatrix();
      roofs.setMatrixAt(hp, dummy.matrix);
      col.setHex(roofPalette[(rand() * roofPalette.length) | 0]);
      roofs.setColorAt(hp, col);
      hp++;
    }
    dummy.rotation.set(0, 0, 0);
    finalizeInstances(houses, hp);
    finalizeInstances(roofs, hp);
    houses.castShadow = true;
    roofs.castShadow = true;

    // ---- Mid-rise blocks (pale, subtle variation) ----
    const MID_N = 95;
    const mids = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.9 }),
      MID_N
    );
    const midPalette = [0xffffff, 0xe0f2fe, 0xfff7e6, 0xfce4ec, 0xe8f5e9, 0xfff3e0];
    let mp = 0;
    guard = 0;
    while (mp < MID_N && guard++ < 6000) {
      const side = rand() < 0.5 ? -1 : 1;
      const x = scatterX(side);
      const z = scatterZ(18);
      if (!spotClear(x, z, 5)) continue;
      const w = 5 + rand() * 4;
      const d = 5 + rand() * 4;
      const h = 5 + rand() * 5;
      dummy.position.set(x, 3 + h / 2, z);
      dummy.scale.set(w, h, d);
      dummy.rotation.set(0, (rand() - 0.5) * 0.25, 0);
      dummy.updateMatrix();
      mids.setMatrixAt(mp, dummy.matrix);
      col.setHex(midPalette[(rand() * midPalette.length) | 0]);
      if (rand() < 0.07) col.setHex(0xf5b301); // danfo-yellow accent
      mids.setColorAt(mp, col);
      mp++;
    }
    dummy.rotation.set(0, 0, 0);
    finalizeInstances(mids, mp);
    mids.castShadow = true;

    // ---- Glass towers (island skyline + a mainland cluster) ----
    const TOWER_N = 14;
    const towers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({
        metalness: 0.35,
        roughness: 0.35,
      }),
      TOWER_N
    );
    const towerPalette = [0x38bdf8, 0x4ecdc4, 0xffd93d, 0xff6b6b, 0xa78bfa];
    // Window strips wrapping each tower (dark glass bands per floor).
    const winStrips = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x14324a, roughness: 0.25, metalness: 0.5 }),
      TOWER_N * 6
    );
    let wsp = 0;
    let twp = 0;
    guard = 0;
    while (twp < TOWER_N && guard++ < 2000) {
      // 70% island skyline, 30% mainland cluster (Ikeja).
      const x = rand() < 0.7 ? scatterX(1) : scatterX(-1);
      const z = scatterZ(24);
      if (!spotClear(x, z, 5.5)) continue;
      const w = 6 + rand() * 3;
      const d = 6 + rand() * 3;
      const h = 13 + rand() * 6;
      dummy.position.set(x, 3 + h / 2, z);
      dummy.scale.set(w, h, d);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      towers.setMatrixAt(twp, dummy.matrix);
      col.setHex(towerPalette[(rand() * towerPalette.length) | 0]);
      towers.setColorAt(twp, col);
      // 6 window bands up the tower faces.
      for (let f = 0; f < 6 && wsp < TOWER_N * 6; f++) {
        const fy = 3 + 2 + (f * (h - 3)) / 6;
        dummy.position.set(x, fy, z);
        dummy.scale.set(w * 1.02, 0.9, d * 1.02);
        dummy.updateMatrix();
        winStrips.setMatrixAt(wsp++, dummy.matrix);
      }
      twp++;
    }
    finalizeInstances(towers, twp);
    finalizeInstances(winStrips, wsp);
    towers.castShadow = true;

    // ---- Roads: gray avenues with dashed center lines ----
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x6b7280,
      roughness: 1,
    });
    const roadGeo = new THREE.BoxGeometry(7, 0.6, WORLD.z * 2 - 24);
    for (const side of [-1, 1] as const) {
      const road = new THREE.Mesh(roadGeo, roadMat);
      road.position.set(side * ROAD_X, 3.05, 0);
      scene.add(road);
    }
    const dashGeo = new THREE.BoxGeometry(0.5, 0.14, 2.6);
    const dashMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.9,
    });
    const dashPositions: Array<[number, number]> = [];
    for (const side of [-1, 1] as const)
      for (let z = -77; z <= 77; z += 7) dashPositions.push([side * ROAD_X, z]);
    const dashes = new THREE.InstancedMesh(dashGeo, dashMat, dashPositions.length);
    dashPositions.forEach(([x, z], i) => {
      dummy.position.set(x, 3.42, z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      dashes.setMatrixAt(i, dummy.matrix);
    });
    finalizeInstances(dashes, dashPositions.length);

    // ---- Street life: danfo buses + cars cruising the avenues ----
    // Two instanced meshes (bodies + window bands) share per-frame matrices.
    const VEH_N = 26;
    const vehs = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.25 }),
      VEH_N
    );
    const vehWins = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.3, metalness: 0.4 }),
      VEH_N
    );
    const vehPalette = [0xef4444, 0x3b82f6, 0xf8fafc, 0x1f2937, 0x22c55e, 0x0ea5e9];
    const vehData: Array<{
      x: number;
      z: number;
      speed: number;
      dir: 1 | -1;
      len: number;
      h: number;
      danfo: boolean;
    }> = [];
    for (let i = 0; i < VEH_N; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const danfo = rand() < 0.45;
      const dir = (rand() < 0.5 ? 1 : -1) as 1 | -1;
      // Two lanes per avenue, offset from the center line.
      vehData.push({
        x: side * ROAD_X + (dir === 1 ? 1.7 : -1.7),
        z: (rand() - 0.5) * 150,
        speed: (danfo ? 7 : 11) + rand() * 4,
        dir,
        len: danfo ? 7.5 : 4.2,
        h: danfo ? 2.7 : 1.8,
        danfo,
      });
      col.setHex(danfo ? 0xf5b301 : vehPalette[(rand() * vehPalette.length) | 0]);
      vehs.setColorAt(i, col);
    }
    scene.add(vehs);
    scene.add(vehWins);

    // ---- Streetlights along both avenues ----
    const LIGHT_N = 24;
    const poles = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.12, 0.17, 7, 6),
      new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7 }),
      LIGHT_N
    );
    const lamps = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.45, 8, 8),
      new THREE.MeshStandardMaterial({
        color: 0xfef9c3,
        emissive: 0xfde047,
        emissiveIntensity: 0.55,
        roughness: 0.4,
      }),
      LIGHT_N
    );
    let lip = 0;
    for (const side of [-1, 1] as const) {
      for (let z = -77; z <= 77 && lip < LIGHT_N; z += 14) {
        const x = side * (ROAD_X + 4.8);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.position.set(x, 3 + 3.5, z);
        dummy.updateMatrix();
        poles.setMatrixAt(lip, dummy.matrix);
        dummy.position.set(x - side * 1.1, 3 + 6.9, z);
        dummy.updateMatrix();
        lamps.setMatrixAt(lip, dummy.matrix);
        lip++;
      }
    }
    finalizeInstances(poles, lip);
    finalizeInstances(lamps, lip);

    // ---- Bridges over the lagoon (merged deck + rails + pillars) ----
    const bridgeMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
    });
    function buildBridge(z: number) {
      const parts: THREE.BufferGeometry[] = [
        paint(xg(new THREE.BoxGeometry(40, 1.4, 8), 0, 5.2, 0), 0x6b7280),
        paint(xg(new THREE.BoxGeometry(40, 0.9, 0.35), 0, 6.35, 3.8), 0xf8fafc),
        paint(xg(new THREE.BoxGeometry(40, 0.9, 0.35), 0, 6.35, -3.8), 0xf8fafc),
      ];
      for (const px of [-15, -7, 7, 15])
        parts.push(
          paint(xg(new THREE.CylinderGeometry(1.1, 1.4, 5.2, 8), px, 2.2, 0), 0x94a3b8)
        );
      const geo = mergeGeometries(parts, false)!;
      const mesh = new THREE.Mesh(geo, bridgeMat);
      mesh.position.z = z;
      scene.add(mesh);
    }
    buildBridge(-40);
    buildBridge(40);

    // ---- Landmarks (each merged to a single draw call) ----
    const landmarkMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
    });

    // Stadium: white oval ring + green pitch
    {
      const ring = new THREE.TorusGeometry(9, 2, 8, 28);
      ring.rotateX(-Math.PI / 2);
      const parts = [
        paint(xg(ring, -55, 5, 0, 1.3, 1, 1), 0xf1f5f9),
        paint(
          xg(
            new THREE.CircleGeometry(8.2, 24).rotateX(-Math.PI / 2),
            -55,
            3.12,
            0,
            1.28,
            1,
            1
          ),
          0x22c55e
        ),
      ];
      scene.add(new THREE.Mesh(mergeGeometries(parts, false)!, landmarkMat));
    }
    // Hospital: white block + red cross sign
    {
      const parts = [
        paint(xg(new THREE.BoxGeometry(9, 7, 8), 52, 6.5, 8), 0xffffff),
        paint(xg(new THREE.BoxGeometry(9.6, 0.5, 8.6), 52, 10.25, 8), 0xcbd5e1),
        paint(xg(new THREE.BoxGeometry(2.4, 0.8, 0.25), 52, 7.5, 3.9), 0xef4444),
        paint(xg(new THREE.BoxGeometry(0.8, 2.4, 0.25), 52, 7.5, 3.9), 0xef4444),
      ];
      scene.add(new THREE.Mesh(mergeGeometries(parts, false)!, landmarkMat));
    }
    // School: sand block + pyramid roof + flag pole
    {
      const roof = new THREE.ConeGeometry(1, 1, 4);
      roof.rotateY(Math.PI / 4);
      const parts = [
        paint(xg(new THREE.BoxGeometry(10, 4.5, 7), -58, 5.25, -44), 0xf5d78e),
        paint(xg(roof, -58, 8.7, -44, 8.4, 2.4, 6.4), 0xb4502e),
        paint(
          xg(new THREE.CylinderGeometry(0.1, 0.1, 6, 6), -50.5, 6, -44),
          0x9ca3af
        ),
        paint(xg(new THREE.BoxGeometry(1.7, 1, 0.08), -49.5, 8.4, -44), 0x16a34a),
      ];
      scene.add(new THREE.Mesh(mergeGeometries(parts, false)!, landmarkMat));
    }
    // Market: 4 stalls — instanced counters + posts + striped awnings
    {
      const stallZ = [32, 38, 44, 50];
      const counters = new THREE.InstancedMesh(
        new THREE.BoxGeometry(3, 1.1, 1.8),
        new THREE.MeshStandardMaterial({ roughness: 0.95 }),
        stallZ.length
      );
      const posts = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.1, 0.1, 2.6, 6),
        new THREE.MeshStandardMaterial({ roughness: 0.95 }),
        stallZ.length * 4
      );
      const awnings = new THREE.InstancedMesh(
        new THREE.BoxGeometry(3.8, 0.22, 2.8),
        new THREE.MeshStandardMaterial({ map: makeStripeTexture(), roughness: 0.9 }),
        stallZ.length
      );
      stallZ.forEach((z, i) => {
        dummy.rotation.set(0, 0, 0);
        dummy.position.set(28, 3.55, z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        counters.setMatrixAt(i, dummy.matrix);
        col.setHex(0xb07a45).offsetHSL(0, 0, (rand() - 0.5) * 0.06);
        counters.setColorAt(i, col);
        dummy.position.set(28, 5.9, z);
        dummy.rotation.set(-0.12, 0, 0);
        dummy.updateMatrix();
        awnings.setMatrixAt(i, dummy.matrix);
        for (let k = 0; k < 4; k++) {
          dummy.rotation.set(0, 0, 0);
          dummy.position.set(28 + (k < 2 ? -1.6 : 1.6), 4.3, z + (k % 2 ? -1.1 : 1.1));
          dummy.updateMatrix();
          posts.setMatrixAt(i * 4 + k, dummy.matrix);
          col.setHex(0x7c4a2d);
          posts.setColorAt(i * 4 + k, col);
        }
      });
      dummy.rotation.set(0, 0, 0);
      finalizeInstances(counters, stallZ.length);
      finalizeInstances(posts, stallZ.length * 4);
      finalizeInstances(awnings, stallZ.length);
    }
    // Church: white nave + pitched roof + steeple with a gold cross
    {
      const roof = new THREE.ConeGeometry(1, 1, 4);
      roof.rotateY(Math.PI / 4);
      const parts = [
        paint(xg(new THREE.BoxGeometry(8, 5, 12), -30, 5.5, -60), 0xffffff),
        paint(xg(roof, -30, 9.4, -60, 6.6, 2.8, 9.6), 0xb4502e),
        paint(xg(new THREE.BoxGeometry(3, 9, 3), -30, 7.5, -52.5), 0xf8fafc),
        paint(xg(new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4), -30, 13.6, -52.5, 2.7, 2.4, 2.7), 0x8f4a2f),
        paint(xg(new THREE.BoxGeometry(0.28, 1.7, 0.28), -30, 15.6, -52.5), 0xfbbf24),
        paint(xg(new THREE.BoxGeometry(1, 0.28, 0.28), -30, 15.7, -52.5), 0xfbbf24),
      ];
      scene.add(new THREE.Mesh(mergeGeometries(parts, false)!, landmarkMat));
    }
    // Mosque: sand prayer hall + green dome + minaret
    {
      const dome = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      const parts = [
        paint(xg(new THREE.BoxGeometry(10, 5, 10), 55, 5.5, -50), 0xf5e6c4),
        paint(xg(dome, 55, 8, -50, 4.4, 3.6, 4.4), 0x16a34a),
        paint(xg(new THREE.CylinderGeometry(0.9, 1.1, 14, 8), 62.5, 10, -50), 0xf5e6c4),
        paint(xg(new THREE.ConeGeometry(1, 1, 8), 62.5, 18.4, -50, 1.5, 2, 1.5), 0x16a34a),
      ];
      scene.add(new THREE.Mesh(mergeGeometries(parts, false)!, landmarkMat));
    }
    // Danfo park: paved lot with 5 parked yellow danfos
    {
      const parts: THREE.BufferGeometry[] = [
        paint(xg(new THREE.BoxGeometry(28, 0.5, 15), -20, 3.2, 55), 0x9ca3af),
      ];
      for (let i = 0; i < 5; i++) {
        const dx = -30 + i * 5.2;
        parts.push(paint(xg(new THREE.BoxGeometry(4.2, 2.6, 2.4), dx, 4.8, 55), 0xf5b301));
        parts.push(paint(xg(new THREE.BoxGeometry(4.25, 0.9, 2.45), dx, 5.7, 55), 0x1f2937));
      }
      scene.add(new THREE.Mesh(mergeGeometries(parts, false)!, landmarkMat));
    }

    // Palm trees — instanced cones (existing look)
    const treeGeo = new THREE.ConeGeometry(1.6, 5, 6);
    const treeMat = new THREE.MeshStandardMaterial({
      color: 0x16a34a,
      roughness: 1,
    });
    const TREES = 110;
    const trees = new THREE.InstancedMesh(treeGeo, treeMat, TREES);
    let tp = 0;
    guard = 0;
    while (tp < TREES && guard++ < 3000) {
      const side = rand() < 0.5 ? -1 : 1;
      const x = scatterX(side);
      const z = scatterZ(12);
      if (!spotClear(x, z, 1.5)) continue;
      const s = 0.7 + rand() * 0.9;
      dummy.position.set(x, 3 + 2.2 * s, z);
      dummy.scale.setScalar(s);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      trees.setMatrixAt(tp, dummy.matrix);
      tp++;
    }
    finalizeInstances(trees, tp);

    // Leafy trees — instanced trunks + icosahedron canopies
    const LEAFY = 85;
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 2.6, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ roughness: 1 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, LEAFY);
    const canopyGeo = new THREE.IcosahedronGeometry(2.4, 0);
    const canopyMat = new THREE.MeshStandardMaterial({ roughness: 1 });
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, LEAFY);
    const leafPalette = [0x16a34a, 0x22c55e, 0x15803d, 0x4ade80];
    let lp = 0;
    guard = 0;
    while (lp < LEAFY && guard++ < 3000) {
      const side = rand() < 0.5 ? -1 : 1;
      const x = scatterX(side);
      const z = scatterZ(12);
      if (!spotClear(x, z, 1.5)) continue;
      const s = 0.75 + rand() * 0.8;
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(x, 3 + 1.3 * s, z);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      trunks.setMatrixAt(lp, dummy.matrix);
      col.setHex(0x8b5a2b);
      trunks.setColorAt(lp, col);
      dummy.position.set(x, 3 + (2.6 + 1.2) * s, z);
      dummy.scale.set(s, s * 0.9, s);
      dummy.rotation.set(0, rand() * Math.PI, 0);
      dummy.updateMatrix();
      canopies.setMatrixAt(lp, dummy.matrix);
      col.setHex(leafPalette[(rand() * leafPalette.length) | 0]);
      canopies.setColorAt(lp, col);
      lp++;
    }
    dummy.rotation.set(0, 0, 0);
    finalizeInstances(trunks, lp);
    finalizeInstances(canopies, lp);

    // Region labels
    const labelData: Array<[string, number, number]> = [
      ["MAINLAND", -(LAGOON_HALF + 40), -80],
      ["LAGOON", 0, 84],
      ["ISLAND", LAGOON_HALF + 40, -80],
    ];
    for (const [text, x, z] of labelData) {
      const tex = makeLabelTexture(text);
      const spr = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
      );
      spr.scale.set(30, 5.6, 1);
      spr.position.set(x, 9, z);
      scene.add(spr);
    }
    // Landmark labels
    const landmarkLabels: Array<[string, number, number, number]> = [
      ["STADIUM", -55, 13.5, 0],
      ["HOSPITAL", 52, 14.5, 8],
      ["SCHOOL", -58, 13, -44],
      ["MARKET", 28, 11.5, 41],
      ["CHURCH", -30, 14.5, -60],
      ["MOSQUE", 55, 14.5, -50],
      ["DANFO PARK", -20, 11.5, 55],
    ];
    for (const [text, x, y, z] of landmarkLabels) {
      const tex = makeLabelTexture(text);
      const spr = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
      );
      spr.scale.set(19, 3.6, 1);
      spr.position.set(x, y, z);
      scene.add(spr);
    }

    // Real Lagos district labels — pill chips with the popular place names at
    // real-world relative positions (island side east, mainland side west).
    // Theme-aware: rebuilt whenever data-theme flips so the chips keep their
    // contrast in both day and night themes.
    const districtGroup = new THREE.Group();
    scene.add(districtGroup);
    const buildDistrictLabels = () => {
      for (const c of [...districtGroup.children]) {
        const s = c as THREE.Sprite;
        s.material.map?.dispose();
        s.material.dispose();
      }
      districtGroup.clear();
      const colors = resolvePillColors(readThemeVar);
      for (const d of districtLabelsForCity(cityRef.current)) {
        const tex = makePillTexture(d.name, colors);
        const spr = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
        );
        const sc = pillWorldScale(
          tex.image.width,
          tex.image.height,
          DISTRICT_WORLD_H[d.size]
        );
        spr.scale.set(sc.x, sc.y, 1);
        spr.position.set(d.x, 10.5, d.z);
        spr.userData.district = d.name;
        districtGroup.add(spr);
      }
    };
    buildDistrictLabels();
    districtRebuildRef.current = buildDistrictLabels;

    // Sailboats on the lagoon — merged hull + mast + triangular sail each
    const boats: THREE.Mesh[] = [];
    const boatMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
      side: THREE.DoubleSide,
    });
    const sailShape = new THREE.Shape();
    sailShape.moveTo(0, 0);
    sailShape.lineTo(0, 2.6);
    sailShape.lineTo(1.8, 0.4);
    sailShape.closePath();
    const hullPalette = [0xef4444, 0x3b82f6, 0x22c55e, 0xf59e0b, 0xf8fafc, 0xf97316];
    const boatZ = [-68, -52, -34, -16, 2, 18, 34, 50, 64, 76];
    boatZ.forEach((z0, i) => {
      const parts = [
        paint(xg(new THREE.BoxGeometry(3.6, 1.1, 1.6), 0, 0.55, 0), hullPalette[i]),
        paint(xg(new THREE.CylinderGeometry(0.09, 0.12, 3.2, 6), 0.3, 2.7, 0), 0x8b5a2b),
        paint(xg(new THREE.ShapeGeometry(sailShape), 0.3, 1.6, 0), 0xfff7e6),
      ];
      const boat = new THREE.Mesh(mergeGeometries(parts, false)!, boatMat);
      boat.position.set((rand() - 0.5) * 16, 0.7, z0);
      boat.userData.z0 = z0;
      boat.userData.phase = rand() * Math.PI * 2;
      scene.add(boat);
      boats.push(boat);
    });

    // Pins + their name pills.
    // The emoji pin sprites keep the existing tap behavior (raycast targets).
    // Each pin also gets a pill chip with its name, floating just below the
    // icon. Pills are label-on-zoom: hidden at the default framing to avoid
    // clutter, revealed when the user pinches in past PIN_LABEL_ZOOM_DIST.
    // The district pills above stay visible at every zoom — they are the
    // always-on place names.
    const pinGroup = new THREE.Group();
    scene.add(pinGroup);
    const labelGroup = new THREE.Group();
    scene.add(labelGroup);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hovered: THREE.Sprite | null = null;
    const pinSprites: THREE.Sprite[] = [];
    const pinLabels: THREE.Sprite[] = [];
    let labelsShown =
      camera.position.distanceTo(controls.target) < PIN_LABEL_ZOOM_DIST;
    const syncLabelVisibility = () => {
      const show =
        camera.position.distanceTo(controls.target) < PIN_LABEL_ZOOM_DIST;
      if (show === labelsShown) return;
      labelsShown = show;
      for (const l of pinLabels) l.visible = show;
    };

    const buildPins = (list: PinLocation[]) => {
      for (const c of [...pinGroup.children]) {
        const s = c as THREE.Sprite;
        s.material.map?.dispose();
        s.material.dispose();
      }
      pinGroup.clear();
      for (const c of [...labelGroup.children]) {
        const s = c as THREE.Sprite;
        s.material.map?.dispose();
        s.material.dispose();
      }
      labelGroup.clear();
      pinSprites.length = 0;
      pinLabels.length = 0;
      hovered = null;
      const colors = resolvePillColors(readThemeVar);
      for (const pin of list) {
        const spr = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: makeEmojiTexture(pin.emoji || "📍"),
            transparent: true,
            depthWrite: false,
          })
        );
        spr.scale.set(6.4, 6.4, 1);
        spr.position.set(pin.x, 10, pin.z);
        spr.userData.pin = pin;
        spr.userData.phase = rand() * Math.PI * 2;
        pinGroup.add(spr);
        pinSprites.push(spr);
        // Name pill beneath the icon (presentational only — travel costs and
        // pin behavior are untouched).
        const tex = makePillTexture(pin.name, colors);
        const pill = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
        );
        const sc = pillWorldScale(tex.image.width, tex.image.height, PIN_PILL_WORLD_H);
        pill.scale.set(sc.x, sc.y, 1);
        pill.position.set(pin.x, 10 - PIN_PILL_DY, pin.z);
        pill.userData.pin = pin;
        pill.visible = labelsShown;
        labelGroup.add(pill);
        pinLabels.push(pill);
      }
    };
    buildPins(pinsRef.current);
    rebuildRef.current = buildPins;

    // Theme flips (day ↔ night) re-skin the theme-aware labels with fresh
    // token colors. Pin icons are theme-independent, rebuilt for simplicity.
    const themeObs = new MutationObserver(() => {
      buildDistrictLabels();
      buildPins(pinsRef.current);
    });
    themeObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    onCleanup(() => themeObs.disconnect());

    // ---- M13 billboards: two posts + a runtime-textured panel (static) ----
    // Geometry is shared across billboards; each panel gets its own
    // 512×256 CanvasTexture. No animation — safe for reduced-motion.
    const bbGroup = new THREE.Group();
    scene.add(bbGroup);
    const bbPostGeo = new THREE.CylinderGeometry(0.45, 0.6, 1, 8);
    const bbPostMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.8,
    });
    const bbPanelGeo = new THREE.PlaneGeometry(1, 1);
    const bbTextures: THREE.CanvasTexture[] = [];
    const bbMaterials: THREE.MeshStandardMaterial[] = [];
    for (const b of billboards) {
      const s = clampBillboardScale(b.scale);
      const wx = (Number(b.x) / 100) * 172 - 86;
      const wz = (Number(b.y) / 100) * 172 - 86;
      if (!Number.isFinite(wx) || !Number.isFinite(wz)) continue;
      const panelW = 13 * s;
      const panelH = 6.5 * s;
      const panelY = 15 * s;
      const postH = Math.max(1, panelY - panelH / 2);
      const grp = new THREE.Group();
      for (const off of [-4.4 * s, 4.4 * s]) {
        const post = new THREE.Mesh(bbPostGeo, bbPostMat);
        post.scale.set(1, postH, 1);
        post.position.set(off, postH / 2, 0);
        grp.add(post);
      }
      const tex = makeBillboardTexture(b);
      bbTextures.push(tex);
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.65,
        side: THREE.DoubleSide,
      });
      bbMaterials.push(mat);
      const panel = new THREE.Mesh(bbPanelGeo, mat);
      panel.scale.set(panelW, panelH, 1);
      panel.position.set(0, panelY, 0);
      grp.add(panel);
      grp.position.set(wx, 0, wz);
      bbGroup.add(grp);
    }
    onCleanup(() => {
      scene.remove(bbGroup);
      bbPostGeo.dispose();
      bbPostMat.dispose();
      bbPanelGeo.dispose();
      for (const t of bbTextures) t.dispose();
      for (const m of bbMaterials) m.dispose();
    });

    // Resize
    const resize = () => {
      const w = hostEl.clientWidth || 1;
      const h = hostEl.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(hostEl);

    // Tooltip + hover/click
    const tooltip = tooltipRef.current;
    const setPointer = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    };
    const projectPin = (spr: THREE.Sprite, e: PointerEvent) => {
      if (!tooltip) return;
      const r = renderer.domElement.getBoundingClientRect();
      tooltip.style.left = `${e.clientX - r.left}px`;
      tooltip.style.top = `${e.clientY - r.top - 18}px`;
      tooltip.style.transform = "translate(-50%, -100%)";
      tooltip.textContent = (spr.userData.pin as PinLocation).name;
      tooltip.hidden = false;
    };
    /**
     * Hit-test pin icons first, then their (visible) name pills. Both carry
     * userData.pin, so tapping a pill selects the pin exactly like tapping
     * the icon. Pills are never raycast while hidden (label-on-zoom), and the
     * 8px tap-vs-drag disambiguation in onUp is unchanged.
     */
    const pickPin = (): THREE.Sprite | null => {
      const hitPin = raycaster.intersectObjects(pinSprites, false)[0];
      if (hitPin) return hitPin.object as THREE.Sprite;
      if (labelsShown) {
        const hitPill = raycaster.intersectObjects(
          pinLabels.filter((l) => l.visible),
          false
        )[0];
        if (hitPill) return hitPill.object as THREE.Sprite;
      }
      return null;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      setPointer(e);
      raycaster.setFromCamera(pointer, camera);
      const next = pickPin();
      if (next !== hovered) {
        hovered = next;
        renderer.domElement.style.cursor = hovered ? "pointer" : "";
        if (!hovered && tooltip) tooltip.hidden = true;
      }
      if (hovered) projectPin(hovered, e);
    };

    // Tap detection (works alongside OrbitControls pan/zoom)
    let downX = 0;
    let downY = 0;
    const onDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) return;
      setPointer(e);
      raycaster.setFromCamera(pointer, camera);
      const hit = pickPin();
      if (hit) {
        const pin = (hit as THREE.Sprite).userData.pin as PinLocation;
        selectRef.current(pin);
      }
    };

    const el = renderer.domElement;
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);

    // Animation
    const clock = new THREE.Clock();
    let raf = 0;
    let lastT = 0;
    const render = () => renderer.render(scene, camera);
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const dt = Math.min(Math.max(t - lastT, 0), 0.05);
      lastT = t;
      if (!reducedMotion) {
        // Water shimmer
        const pos = waterGeo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const bx = waterBase[i * 3];
          const bz = waterBase[i * 3 + 2];
          pos.setY(i, 0.35 * Math.sin(bx * 0.35 + t * 1.6) + 0.25 * Math.cos(bz * 0.18 + t * 1.1));
        }
        pos.needsUpdate = true;
        // Pin bobbing — name pills ride along just below their icons
        for (let i = 0; i < pinSprites.length; i++) {
          const s = pinSprites[i];
          s.position.y = 10 + Math.sin(t * 2 + s.userData.phase) * 0.7;
          const lbl = pinLabels[i];
          if (lbl) lbl.position.y = s.position.y - PIN_PILL_DY;
        }
        syncLabelVisibility();
        // Sailboats drift and bob
        boats.forEach((b, i) => {
          const ph = b.userData.phase as number;
          b.position.z = (b.userData.z0 as number) + Math.sin(t * 0.25 + ph) * 2.2;
          b.position.y = 0.7 + Math.sin(t * 1.3 + ph) * 0.15;
          b.rotation.z = Math.sin(t * 1.1 + i) * 0.05;
          b.rotation.y = Math.sin(t * 0.2 + ph) * 0.3;
        });
        // Danfos + cars cruise the avenues (wrap around at the map edges)
        for (let i = 0; i < vehData.length; i++) {
          const v = vehData[i];
          v.z += v.speed * v.dir * dt;
          if (v.z > 86) v.z = -86;
          else if (v.z < -86) v.z = 86;
          dummy.rotation.set(0, 0, 0);
          dummy.position.set(v.x, 3.35 + v.h / 2, v.z);
          dummy.scale.set(2.6, v.h, v.len);
          dummy.updateMatrix();
          vehs.setMatrixAt(i, dummy.matrix);
          dummy.position.set(v.x, 3.35 + v.h * 0.7, v.z);
          dummy.scale.set(2.62, v.h * 0.32, v.len * 0.62);
          dummy.updateMatrix();
          vehWins.setMatrixAt(i, dummy.matrix);
        }
        vehs.instanceMatrix.needsUpdate = true;
        vehWins.instanceMatrix.needsUpdate = true;
        controls.update();
      }
      render();
    };
    animate();

    if (reducedMotion) {
      const onChange = () => {
        syncLabelVisibility();
        render();
      };
      controls.addEventListener("change", onChange);
    }

      onCleanup(() => cancelAnimationFrame(raf));
      onCleanup(() => ro.disconnect());
      onCleanup(() => {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointerup", onUp);
      });
      onCleanup(() => controls.dispose());
      onCleanup(() => {
        renderer.dispose();
        if (el.parentNode === hostEl) hostEl.removeChild(el);
      });
    }

    return () => {
      cancelled = true;
      rebuildRef.current = null;
      districtRebuildRef.current = null;
      for (const fn of cleanups.splice(0)) {
        try {
          fn();
        } catch {
          /* teardown errors are not user-visible */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh the pin layer when the parent hands a new pin list (e.g. the
  // player's own marker after travelling). Runs after the mount effect.
  useEffect(() => {
    rebuildRef.current?.(pins);
  }, [pins]);

  // Home City V1: swap the district-label pack when the player's city changes.
  useEffect(() => {
    districtRebuildRef.current?.();
  }, [cityId]);

  return (
    <div className="eko-citymap" ref={hostRef} role="img" aria-label="3D toy city of Lagos with clickable location pins">
      <div ref={tooltipRef} className="eko-citymap__tooltip" hidden />
    </div>
  );
}
