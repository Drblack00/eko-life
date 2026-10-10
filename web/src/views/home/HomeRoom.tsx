import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import { priceOf, type GameConfig } from "../../lib/api";
import {
  AVATAR_LOOK_FALLBACK_OPTIONS,
  furnitureItemId,
  furnitureKey,
  naira,
  sanitizeAvatarLook,
  type ActName,
  type AvatarLook,
  type FurnitureEntry,
  type You,
} from "../../game/types";
import { buildAvatarLook } from "../avatar/avatarModel";
import {
  footprintCells,
  fitsInGrid,
  layoutPlaced,
  overlaps,
  useActFor,
  ROOM_GRID,
  type GridCell,
  type Footprint,
} from "./roomGrid";
import {
  roomSizeFor,
  buyTabFor,
  visibleBuyTabs,
  normalizeStyleEntry,
  validHex,
  itemActionsFor,
  isDailyEffect,
  type BuyTabId,
  type HomeStyleEntry,
} from "./catalogue";
import {
  DEFAULT_CAMERA,
  ORBIT_SPEED,
  cameraPosition,
  clampPan,
  clampPolar,
  isDoubleTap,
  isTap,
  panBasis,
  panDelta,
  snapAzimuth90,
  zoomDist,
  type CameraRigState,
} from "./cameraRig";
import {
  nearestSnap,
  nextSnap,
  sheetHeights,
  type SheetSnap,
} from "./buySheet";
import "./HomeRoom.css";

/* ============ Procedural models (original, primitives only) ============ */

type Mat = THREE.MeshStandardMaterial;

interface Palette {
  wood: Mat;
  woodDark: Mat;
  fabric: Mat;
  fabricLight: Mat;
  white: Mat;
  black: Mat;
  gray: Mat;
  grayDark: Mat;
  mirror: Mat;
  screen: Mat;
  blue: Mat;
  blueDark: Mat;
  red: Mat;
  redDark: Mat;
  yellow: Mat;
  teal: Mat;
  purple: Mat;
  purpleDark: Mat;
  orange: Mat;
  green: Mat;
}

function makePalette(): Palette {
  const std = (
    color: number,
    extra: Partial<THREE.MeshStandardMaterialParameters> = {}
  ) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.85,
      metalness: 0.05,
      ...extra,
    });
  return {
    wood: std(0x9a6b3f),
    woodDark: std(0x6b4423),
    fabric: std(0xd97b4f),
    fabricLight: std(0xe8a87c),
    white: std(0xf8fafc),
    black: std(0x1f2937, { roughness: 0.6 }),
    gray: std(0x9ca3af),
    grayDark: std(0x4b5563),
    mirror: std(0xcfd8e3, { roughness: 0.15, metalness: 0.85 }),
    screen: std(0x3b82f6, {
      emissive: 0x3b82f6,
      emissiveIntensity: 0.55,
      roughness: 0.4,
    }),
    blue: std(0x2563eb),
    blueDark: std(0x1e40af),
    red: std(0xdc2626),
    redDark: std(0x991b1b),
    yellow: std(0xeab308),
    teal: std(0x0d9488),
    purple: std(0x8b5cf6),
    purpleDark: std(0x6d28d9),
    orange: std(0xea7c28),
    green: std(0x22c55e),
  };
}

function bx(
  w: number,
  h: number,
  d: number,
  mat: Mat,
  x = 0,
  y = 0,
  z = 0
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cy(
  rt: number,
  rb: number,
  h: number,
  mat: Mat,
  x = 0,
  y = 0,
  z = 0,
  seg = 14
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildBed(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.add(bx(2, 0.3, 2, p.woodDark, 0, 0.22, 0));
  g.add(bx(1.86, 0.24, 1.86, p.white, 0, 0.5, 0));
  g.add(bx(1.86, 0.09, 1.0, p.teal, 0, 0.66, 0.4));
  g.add(bx(0.55, 0.12, 0.35, p.white, -0.45, 0.66, -0.6));
  g.add(bx(0.55, 0.12, 0.35, p.white, 0.45, 0.66, -0.6));
  g.add(bx(2, 0.8, 0.1, p.wood, 0, 0.55, -0.95));
  return g;
}

function buildFridge(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.add(bx(0.9, 1.8, 0.85, p.white, 0, 0.9, 0));
  g.add(bx(0.92, 0.03, 0.87, p.grayDark, 0, 1.25, 0));
  g.add(bx(0.06, 0.45, 0.07, p.grayDark, 0.32, 1.0, 0.46));
  return g;
}

function buildTv(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.add(bx(0.7, 0.45, 0.35, p.woodDark, 0, 0.225, 0));
  g.add(bx(0.95, 0.55, 0.07, p.black, 0, 0.95, 0));
  g.add(bx(0.85, 0.45, 0.02, p.screen, 0, 0.95, 0.045));
  return g;
}

function buildSofa(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.add(bx(2, 0.38, 0.95, p.orange, 0, 0.28, 0));
  g.add(bx(2, 0.62, 0.22, p.orange, 0, 0.66, -0.365));
  g.add(bx(0.22, 0.5, 0.95, p.orange, -0.89, 0.5, 0));
  g.add(bx(0.22, 0.5, 0.95, p.orange, 0.89, 0.5, 0));
  g.add(bx(0.78, 0.12, 0.66, p.fabricLight, -0.44, 0.53, 0.05));
  g.add(bx(0.78, 0.12, 0.66, p.fabricLight, 0.44, 0.53, 0.05));
  return g;
}

function buildGen(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.add(bx(0.75, 0.5, 0.55, p.yellow, 0, 0.38, 0));
  g.add(bx(0.79, 0.08, 0.59, p.grayDark, 0, 0.67, 0));
  g.add(bx(0.06, 0.7, 0.65, p.grayDark, -0.42, 0.35, 0));
  g.add(bx(0.06, 0.7, 0.65, p.grayDark, 0.42, 0.35, 0));
  g.add(cy(0.05, 0.05, 0.2, p.black, 0.2, 0.8, 0.1));
  g.add(bx(0.12, 0.08, 0.12, p.black, -0.2, 0.74, -0.1));
  return g;
}

function buildAc(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.add(bx(0.08, 1.3, 0.08, p.grayDark, -0.35, 0.65, 0));
  g.add(bx(0.08, 1.3, 0.08, p.grayDark, 0.35, 0.65, 0));
  g.add(bx(0.9, 0.42, 0.32, p.white, 0, 1.5, 0));
  g.add(bx(0.7, 0.05, 0.02, p.grayDark, 0, 1.38, 0.17));
  g.add(bx(0.15, 0.08, 0.02, p.screen, 0.25, 1.55, 0.17));
  return g;
}

function buildMattress(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.add(bx(1.9, 0.16, 0.95, p.white, 0, 0.1, 0));
  g.add(bx(1.9, 0.06, 0.5, p.blue, 0, 0.21, 0.2));
  g.add(bx(0.5, 0.1, 0.32, p.white, -0.55, 0.23, -0.28));
  return g;
}

function buildCooler(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.add(bx(0.7, 0.5, 0.5, p.blue, 0, 0.28, 0));
  g.add(bx(0.74, 0.12, 0.54, p.blueDark, 0, 0.59, 0));
  g.add(bx(0.1, 0.14, 0.04, p.grayDark, 0, 0.55, 0.28));
  return g;
}

function buildStove(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.add(bx(0.85, 0.78, 0.85, p.grayDark, 0, 0.39, 0));
  g.add(bx(0.85, 0.05, 0.85, p.black, 0, 0.8, 0));
  for (const sx of [-0.2, 0.2])
    for (const sz of [-0.2, 0.2]) g.add(cy(0.09, 0.09, 0.03, p.black, sx, 0.84, sz));
  for (const kx of [-0.15, 0, 0.15]) g.add(bx(0.06, 0.06, 0.04, p.red, kx, 0.55, 0.44));
  g.add(bx(0.6, 0.4, 0.03, p.gray, 0, 0.35, 0.435));
  return g;
}

function buildDiningTable(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.add(bx(2, 0.07, 1, p.wood, 0, 0.74, 0));
  for (const sx of [-0.9, 0.9])
    for (const sz of [-0.42, 0.42]) g.add(cy(0.045, 0.045, 0.72, p.woodDark, sx, 0.36, sz));
  g.add(cy(0.13, 0.13, 0.02, p.white, -0.4, 0.79, 0));
  g.add(cy(0.13, 0.13, 0.02, p.white, 0.4, 0.79, 0));
  return g;
}

function buildDrum(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.add(cy(0.34, 0.34, 0.85, p.blue, 0, 0.45, 0));
  g.add(cy(0.36, 0.36, 0.06, p.blueDark, 0, 0.9, 0));
  g.add(cy(0.355, 0.355, 0.05, p.grayDark, 0, 0.6, 0));
  g.add(bx(0.08, 0.1, 0.1, p.grayDark, 0, 0.25, 0.36));
  return g;
}

function buildMirror(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.add(bx(0.66, 0.07, 0.3, p.woodDark, 0, 0.035, 0));
  g.add(bx(0.07, 1.15, 0.07, p.woodDark, 0, 0.64, 0));
  g.add(bx(0.68, 1.05, 0.06, p.wood, 0, 1.4, 0));
  g.add(bx(0.58, 0.95, 0.02, p.mirror, 0, 1.4, 0.035));
  return g;
}

function buildPlasticChair(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.add(bx(0.5, 0.07, 0.48, p.red, 0, 0.45, 0));
  g.add(bx(0.5, 0.5, 0.07, p.red, 0, 0.76, -0.205));
  for (const sx of [-0.2, 0.2])
    for (const sz of [-0.19, 0.19]) g.add(cy(0.03, 0.035, 0.45, p.redDark, sx, 0.225, sz));
  return g;
}

function buildFan(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.add(cy(0.24, 0.28, 0.07, p.gray, 0, 0.035, 0));
  g.add(cy(0.035, 0.035, 1.15, p.grayDark, 0, 0.64, 0));
  const head = new THREE.Group();
  head.position.set(0, 1.3, 0);
  const motor = cy(0.09, 0.09, 0.16, p.grayDark, 0, 0, 0);
  motor.rotation.x = Math.PI / 2;
  head.add(motor);
  const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.02, 8, 20), p.gray);
  ringMesh.castShadow = true;
  head.add(ringMesh);
  const blades = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const blade = bx(0.3, 0.09, 0.01, p.white);
    blade.position.set(Math.cos((i * 2 * Math.PI) / 3) * 0.11, Math.sin((i * 2 * Math.PI) / 3) * 0.11, 0);
    blade.rotation.z = (i * 2 * Math.PI) / 3 + 0.5;
    blades.add(blade);
  }
  head.add(blades);
  g.add(head);
  g.userData.spin = [blades];
  return g;
}

function buildBeanbag(p: Palette): THREE.Group {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 14), p.purple);
  ball.scale.y = 0.8;
  ball.position.set(0, 0.34, 0);
  ball.castShadow = true;
  ball.receiveShadow = true;
  g.add(ball);
  const btn = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), p.purpleDark);
  btn.position.set(0, 0.66, 0);
  g.add(btn);
  return g;
}

function buildBookshelf(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.add(bx(0.08, 1.5, 0.5, p.woodDark, -0.96, 0.75, 0));
  g.add(bx(0.08, 1.5, 0.5, p.woodDark, 0.96, 0.75, 0));
  g.add(bx(2, 1.5, 0.05, p.wood, 0, 0.75, -0.225));
  for (const sy of [0.03, 0.5, 0.95, 1.4]) g.add(bx(1.84, 0.06, 0.44, p.wood, 0, sy, 0));
  const rnd = mulberry32(42);
  const colors = [p.red, p.blue, p.teal, p.yellow, p.purple, p.orange, p.green];
  for (const sy of [0.53, 0.98]) {
    let bxPos = -0.8;
    while (bxPos < 0.75) {
      const wBook = 0.08 + rnd() * 0.05;
      const hBook = 0.3 + rnd() * 0.08;
      g.add(bx(wBook, hBook, 0.3, colors[Math.floor(rnd() * colors.length)], bxPos + wBook / 2, sy + hBook / 2, 0));
      bxPos += wBook + 0.015;
    }
  }
  return g;
}

function buildGeneric(p: Palette): THREE.Group {
  const g = new THREE.Group();
  g.add(bx(0.7, 0.7, 0.7, p.wood, 0, 0.35, 0));
  g.add(bx(0.74, 0.08, 0.74, p.woodDark, 0, 0.74, 0));
  return g;
}

/** One builder per catalog item id (16); unknown ids get a crate. */
export function buildModel(id: string, p: Palette): THREE.Group {
  switch (String(id ?? "").toLowerCase()) {
    case "bed":
      return buildBed(p);
    case "fridge":
      return buildFridge(p);
    case "tv":
      return buildTv(p);
    case "sofa":
      return buildSofa(p);
    case "gen":
      return buildGen(p);
    case "ac":
      return buildAc(p);
    case "mattress":
      return buildMattress(p);
    case "cooler":
      return buildCooler(p);
    case "stove":
      return buildStove(p);
    case "dining_table":
      return buildDiningTable(p);
    case "drum":
      return buildDrum(p);
    case "mirror":
      return buildMirror(p);
    case "plastic_chair":
      return buildPlasticChair(p);
    case "fan":
      return buildFan(p);
    case "beanbag":
      return buildBeanbag(p);
    case "bookshelf":
      return buildBookshelf(p);
    default:
      return buildGeneric(p);
  }
}

/* ============ M15: avatar look + home style ============ */

/**
 * home_wall/home_floor are not yet on the You type — read them through a
 * local extension interface so tsc stays green before the server worker
 * lands them. (avatar_look, config.walls/floors, and the avatar module are
 * all in place now.)
 */
interface HomeExtras {
  home_wall?: unknown;
  home_floor?: unknown;
}

/** Resolve a look's skin to a hex for the fallback capsule figure. */
function capsuleSkinHex(look: AvatarLook): string {
  return (
    validHex(look.skin) ??
    validHex(
      AVATAR_LOOK_FALLBACK_OPTIONS.skins.find((s) => s.id === look.skin)?.hex
    ) ??
    "#8d5a3b"
  );
}

/**
 * Fallback player figure (simple capsule person). Only used if the real
 * buildAvatarLook ever throws on bad look data — the room keeps rendering.
 */
function buildCapsuleAvatar(T: typeof THREE, look: AvatarLook): THREE.Group {
  const g = new T.Group();
  const mat = (color: string) =>
    new T.MeshStandardMaterial({
      color: new T.Color(validHex(color) ?? "#888888"),
      roughness: 0.85,
      metalness: 0.02,
    });
  const skin = mat(capsuleSkinHex(look));
  const top = mat(look.topColor);
  const bottom = mat(look.bottomColor);
  const dark = mat("#2b2118");
  const add = (m: THREE.Mesh, x: number, y: number, z: number) => {
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  // Legs + shoes.
  for (const sx of [-0.11, 0.11]) {
    add(new T.Mesh(new T.BoxGeometry(0.16, 0.42, 0.18), bottom), sx, 0.21, 0);
    add(new T.Mesh(new T.BoxGeometry(0.17, 0.08, 0.26), dark), sx, 0.04, 0.03);
  }
  // Torso capsule + arms.
  add(new T.Mesh(new T.CapsuleGeometry(0.21, 0.34, 6, 14), top), 0, 0.78, 0);
  for (const sx of [-0.3, 0.3])
    add(new T.Mesh(new T.CapsuleGeometry(0.07, 0.3, 4, 10), top), sx, 0.78, 0);
  // Head + hair cap.
  add(new T.Mesh(new T.SphereGeometry(0.17, 18, 14), skin), 0, 1.32, 0);
  add(
    new T.Mesh(
      new T.SphereGeometry(0.175, 18, 14, 0, Math.PI * 2, 0, Math.PI / 2.2),
      dark
    ),
    0,
    1.34,
    0
  );
  return g;
}

/** Dispose a group including its own materials (avatar figures). */
function disposeGroupDeep(g: THREE.Group): void {
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      (mesh.geometry as THREE.BufferGeometry | undefined)?.dispose();
      const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose();
    }
  });
}

const DEFAULT_WALL_HEX = "#f3e5cd"; // warm cream
const DEFAULT_FLOOR_HEX = "#b5854f"; // wood tile

/* ============ 3D room canvas ============ */

export interface PlacedSceneEntry {
  key: string;
  itemId: string;
  size: Footprint;
  x: number;
  z: number;
  rot: number;
}

export interface GhostState {
  itemId: string;
  cell: GridCell | null;
  valid: boolean;
  rot: number;
  size: Footprint;
}

export interface RoomSceneApi {
  setPlaced(entries: PlacedSceneEntry[]): void;
  setGhost(g: GhostState | null): void;
  setSelected(key: string | null): void;
  setStyle(wall: string, floor: string): void;
  setAvatar(look: AvatarLook, cell: GridCell | null): void;
  rotateCamera(): void;
}

const HALF = ROOM_GRID / 2; // floor spans -3..3

/** World center of a grid anchor cell's footprint. */
function footprintCenter(size: Footprint, rot: number, x: number, z: number): [number, number] {
  const swapped = ((Math.floor(rot) % 2) + 2) % 2 === 1;
  const wEff = swapped ? size[1] : size[0];
  const dEff = swapped ? size[0] : size[1];
  return [x + wEff / 2 - HALF, z + dEff / 2 - HALF];
}

function disposeGroup(g: THREE.Group): void {
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const geo = mesh.geometry as THREE.BufferGeometry | undefined;
      if (geo) geo.dispose();
    }
  });
}

function RoomCanvas({
  placed,
  ghost,
  selectedKey,
  wallHex,
  floorHex,
  avatarLook,
  avatarCell,
  onTapItem,
  onTapCell,
  onTapEmpty,
  apiRef,
}: {
  placed: PlacedSceneEntry[];
  ghost: GhostState | null;
  selectedKey: string | null;
  wallHex: string;
  floorHex: string;
  avatarLook: AvatarLook;
  avatarCell: GridCell | null;
  onTapItem: (key: string) => void;
  onTapCell: (cell: GridCell) => void;
  onTapEmpty: () => void;
  apiRef: { current: RoomSceneApi | null };
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cbRef = useRef({ onTapItem, onTapCell, onTapEmpty });
  cbRef.current = { onTapItem, onTapCell, onTapEmpty };
  // Latest style/avatar values for the imperative scene (buildScene runs once).
  const styleRef = useRef({ wallHex, floorHex });
  styleRef.current = { wallHex, floorHex };
  const avatarRef = useRef({ look: avatarLook, cell: avatarCell });
  avatarRef.current = { look: avatarLook, cell: avatarCell };

  // Scene API lives for the mount lifetime; prop updates flow through it.
  const apiBox = useRef<RoomSceneApi | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const hostEl: HTMLDivElement = host;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let cancelled = false;
    const cleanups: Array<() => void> = [];
    const onCleanup = (fn: () => void) => {
      cleanups.push(fn);
    };

    function buildScene() {
      if (cancelled) return;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0f1a2e);

      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true });
      } catch {
        // No WebGL on this device/browser — friendly note + retry.
        const note = document.createElement("div");
        note.className = "eko-room__nogl";
        note.innerHTML =
          "<p>🏠 The 3D room needs WebGL, which this browser blocked.</p>" +
          "<button type=\"button\">Try again</button>";
        note.querySelector("button")?.addEventListener("click", () => {
          note.remove();
          buildScene();
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
      hostEl.appendChild(renderer.domElement);
      const el = renderer.domElement;
      el.style.touchAction = "none";
      el.style.display = "block";
      el.style.width = "100%";
      el.style.height = "100%";

      // Warm lighting: hemisphere + one soft directional with shadows.
      scene.add(new THREE.HemisphereLight(0xfff4e0, 0xd8c3a5, 0.95));
      const sun = new THREE.DirectionalLight(0xfff1d6, 1.7);
      sun.position.set(6, 10, 4);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.left = -6;
      sun.shadow.camera.right = 6;
      sun.shadow.camera.top = 6;
      sun.shadow.camera.bottom = -6;
      sun.shadow.camera.far = 30;
      scene.add(sun);

      // Wood floor: 6×6 cells, subtle grid lines.
      const floorMat = new THREE.MeshStandardMaterial({
        color: 0xb5854f,
        roughness: 0.9,
      });
      const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 6), floorMat);
      floorMesh.position.y = -0.1;
      floorMesh.receiveShadow = true;
      scene.add(floorMesh);
      const grid = new THREE.GridHelper(6, 6, 0x8a6238, 0x9a6f42);
      grid.position.y = 0.012;
      (grid.material as THREE.Material).transparent = true;
      (grid.material as THREE.Material).opacity = 0.35;
      scene.add(grid);
      // Rug for warmth.
      const rug = new THREE.Mesh(
        new THREE.CircleGeometry(1.25, 28),
        new THREE.MeshStandardMaterial({ color: 0xc96f4a, roughness: 1 })
      );
      rug.rotation.x = -Math.PI / 2;
      rug.position.y = 0.006;
      rug.receiveShadow = true;
      scene.add(rug);

      // Two walls: back + left, warm plaster.
      const wallMat = new THREE.MeshStandardMaterial({
        color: 0xf3e5cd,
        roughness: 1,
      });
      const wallH = 3;
      const backWall = new THREE.Mesh(new THREE.BoxGeometry(6.4, wallH, 0.2), wallMat);
      backWall.position.set(0, wallH / 2, -HALF - 0.1);
      backWall.receiveShadow = true;
      scene.add(backWall);
      const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.2, wallH, 6.4), wallMat);
      leftWall.position.set(-HALF - 0.1, wallH / 2, 0);
      leftWall.receiveShadow = true;
      scene.add(leftWall);

      const palette = makePalette();
      const ghostGreen = new THREE.MeshStandardMaterial({
        color: 0x22c55e,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      });
      const ghostRed = new THREE.MeshStandardMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      });
      const ghostPlane = new THREE.MeshStandardMaterial({
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      });

      const itemLayer = new THREE.Group();
      const ghostLayer = new THREE.Group();
      scene.add(itemLayer);
      scene.add(ghostLayer);

      // M15: the player's avatar figure, standing on a free tile near the door.
      const avatarLayer = new THREE.Group();
      scene.add(avatarLayer);
      let avatarGroup: THREE.Group | null = null;

      function placeAvatar(look: AvatarLook, cell: GridCell | null) {
        if (avatarGroup) {
          avatarLayer.remove(avatarGroup);
          disposeGroupDeep(avatarGroup);
          avatarGroup = null;
        }
        if (!cell) {
          renderOnce();
          return;
        }
        let g: THREE.Group;
        try {
          g = buildAvatarLook(THREE, look);
        } catch {
          // Bad look data must never blank the room — capsule fallback.
          g = buildCapsuleAvatar(THREE, look);
        }
        g.position.set(cell[0] - HALF + 0.5, 0, cell[1] - HALF + 0.5);
        g.rotation.y = Math.PI / 4;
        avatarGroup = g;
        avatarLayer.add(g);
        renderOnce();
      }

      let spinners: THREE.Object3D[] = [];
      let ring: THREE.Mesh | null = null;
      let currentSelected: string | null = null;

      const renderOnce = () => renderer.render(scene, camera);

      // ---- M16: orbit camera rig {azimuth, polar, dist, target} ----
      // Gesture language matches CityMap: 1-finger drag orbits (horizontal =
      // azimuth, vertical = polar clamped 25°–70°), pinch/wheel zooms, 2-finger
      // drag pans the look target, double-tap resets to the default view.
      // cam is the rendered state; camT is the damped target it chases.
      const cam: CameraRigState = { ...DEFAULT_CAMERA };
      const camT: CameraRigState = { ...DEFAULT_CAMERA };
      // Inertial orbit velocities (rad/s), sampled during 1-finger drags.
      let velA = 0;
      let velP = 0;

      const placeCamera = () => {
        const p = cameraPosition(cam);
        camera.position.set(p.x, p.y, p.z);
        camera.lookAt(cam.tx, cam.ty, cam.tz);
      };

      /** Jump the rendered state to the targets (reduced-motion path). */
      const snapRigNow = () => {
        cam.azimuth = camT.azimuth;
        cam.polar = camT.polar;
        cam.dist = camT.dist;
        cam.tx = camT.tx;
        cam.ty = camT.ty;
        cam.tz = camT.tz;
        velA = 0;
        velP = 0;
        placeCamera();
      };

      const resetCamera = () => {
        camT.azimuth = DEFAULT_CAMERA.azimuth;
        camT.polar = DEFAULT_CAMERA.polar;
        camT.dist = DEFAULT_CAMERA.dist;
        camT.tx = DEFAULT_CAMERA.tx;
        camT.ty = DEFAULT_CAMERA.ty;
        camT.tz = DEFAULT_CAMERA.tz;
        if (reducedMotion) {
          snapRigNow();
          renderOnce();
        } else {
          velA = 0;
          velP = 0;
        }
      };

      function clearLayer(layer: THREE.Group) {
        for (const child of [...layer.children]) {
          layer.remove(child);
          if (child instanceof THREE.Group) disposeGroup(child);
        }
      }

      const api: RoomSceneApi = {
        setPlaced(entries: PlacedSceneEntry[]) {
          clearLayer(itemLayer);
          spinners = [];
          for (const e of entries) {
            const g = buildModel(e.itemId, palette);
            const [wx, wz] = footprintCenter(e.size, e.rot, e.x, e.z);
            g.position.set(wx, 0, wz);
            g.rotation.y = (e.rot * Math.PI) / 2;
            g.userData.entryKey = e.key;
            const spin = g.userData.spin as THREE.Object3D[] | undefined;
            if (spin) spinners.push(...spin);
            itemLayer.add(g);
          }
          api.setSelected(currentSelected);
          renderOnce();
        },
        setGhost(gState: GhostState | null) {
          clearLayer(ghostLayer);
          if (gState && gState.cell) {
            const size = gState.size;
            const g = buildModel(gState.itemId, palette);
            const mat = gState.valid ? ghostGreen : ghostRed;
            g.traverse((o) => {
              const mesh = o as THREE.Mesh;
              if (mesh.isMesh) {
                mesh.material = mat;
                mesh.castShadow = false;
              }
            });
            const [wx, wz] = footprintCenter(size, gState.rot, gState.cell[0], gState.cell[1]);
            g.position.set(wx, 0.02, wz);
            g.rotation.y = (gState.rot * Math.PI) / 2;
            ghostLayer.add(g);
            // Footprint highlight plane.
            const swapped = ((Math.floor(gState.rot) % 2) + 2) % 2 === 1;
            const wEff = swapped ? size[1] : size[0];
            const dEff = swapped ? size[0] : size[1];
            const plane = new THREE.Mesh(
              new THREE.PlaneGeometry(wEff, dEff),
              ghostPlane.clone()
            );
            (plane.material as THREE.MeshStandardMaterial).color.set(
              gState.valid ? 0x22c55e : 0xef4444
            );
            plane.rotation.x = -Math.PI / 2;
            plane.position.set(wx, 0.02, wz);
            ghostLayer.add(plane);
          }
          renderOnce();
        },
        setSelected(key: string | null) {
          currentSelected = key;
          if (ring) {
            scene.remove(ring);
            ring.geometry.dispose();
            ring = null;
          }
          if (key != null) {
            const target = itemLayer.children.find(
              (c) => c.userData.entryKey === key
            );
            if (target) {
              const bb = new THREE.Box3().setFromObject(target);
              const size = new THREE.Vector3();
              bb.getSize(size);
              const center = new THREE.Vector3();
              bb.getCenter(center);
              const r = Math.max(size.x, size.z) / 2 + 0.25;
              ring = new THREE.Mesh(
                new THREE.RingGeometry(r - 0.07, r, 40),
                new THREE.MeshBasicMaterial({
                  color: 0xf59e0b,
                  transparent: true,
                  opacity: 0.9,
                  side: THREE.DoubleSide,
                })
              );
              ring.rotation.x = -Math.PI / 2;
              ring.position.set(center.x, 0.03, center.z);
              scene.add(ring);
            }
          }
          renderOnce();
        },
        setStyle(wall: string, floor: string) {
          wallMat.color.set(validHex(wall) ?? DEFAULT_WALL_HEX);
          floorMat.color.set(validHex(floor) ?? DEFAULT_FLOOR_HEX);
          renderOnce();
        },
        setAvatar(look: AvatarLook, cell: GridCell | null) {
          placeAvatar(look, cell);
        },
        rotateCamera() {
          // "Turn the room": snap the azimuth to the nearest 90° view.
          camT.azimuth = snapAzimuth90(camT.azimuth);
          if (reducedMotion) {
            snapRigNow();
            renderOnce();
          }
        },
      };
      apiBox.current = api;
      apiRef.current = api;

      // M15: apply initial wall/floor style, then place the avatar figure.
      api.setStyle(styleRef.current.wallHex, styleRef.current.floorHex);
      placeAvatar(avatarRef.current.look, avatarRef.current.cell);

      // ---- M16 gestures: tap / orbit / pinch-zoom / 2-finger pan ----
      // The pointer cache distinguishes 1-finger vs 2-finger touches;
      // taps (≤10px, <300ms) still select, and drags never move the ghost.
      const raycaster = new THREE.Raycaster();
      const pointerNdc = new THREE.Vector2();
      interface RoomPtr {
        x: number;
        y: number;
        sx: number;
        sy: number;
        t: number;
        lt: number;
      }
      const pointers = new Map<number, RoomPtr>();
      let gestureMulti = false; // a second finger joined this gesture
      let pinchPrev = 0;
      let midPrev: { x: number; y: number } | null = null;
      let lastTap: { t: number; x: number; y: number } | null = null;

      function pick(clientX: number, clientY: number) {
        const rect = el.getBoundingClientRect();
        pointerNdc.set(
          ((clientX - rect.left) / rect.width) * 2 - 1,
          -((clientY - rect.top) / rect.height) * 2 + 1
        );
        raycaster.setFromCamera(pointerNdc, camera);
        const hits = raycaster.intersectObjects(itemLayer.children, true);
        if (hits.length > 0) {
          let o: THREE.Object3D | null = hits[0].object;
          while (o && o.userData.entryKey == null) o = o.parent;
          if (o) {
            cbRef.current.onTapItem(String(o.userData.entryKey));
            return;
          }
        }
        const fh = raycaster.intersectObject(floorMesh, false);
        if (fh.length > 0) {
          const pt = fh[0].point;
          const cx = Math.floor(pt.x + HALF);
          const cz = Math.floor(pt.z + HALF);
          if (cx >= 0 && cx < ROOM_GRID && cz >= 0 && cz < ROOM_GRID) {
            cbRef.current.onTapCell([cx, cz]);
            return;
          }
        }
        cbRef.current.onTapEmpty();
      }

      const onDown = (e: PointerEvent) => {
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* noop */
        }
        const now = performance.now();
        pointers.set(e.pointerId, {
          x: e.clientX,
          y: e.clientY,
          sx: e.clientX,
          sy: e.clientY,
          t: now,
          lt: now,
        });
        // Any new touch cancels orbit inertia.
        velA = 0;
        velP = 0;
        if (pointers.size >= 2) {
          gestureMulti = true;
          const pts = [...pointers.values()];
          pinchPrev = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          midPrev = {
            x: (pts[0].x + pts[1].x) / 2,
            y: (pts[0].y + pts[1].y) / 2,
          };
        } else {
          gestureMulti = false;
        }
      };
      const onMove = (e: PointerEvent) => {
        const p = pointers.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        p.x = e.clientX;
        p.y = e.clientY;
        if (pointers.size === 1 && !gestureMulti) {
          // 1-finger drag: horizontal → azimuth, vertical → polar (25°–70°).
          const now = performance.now();
          const dt = Math.max(1, now - p.lt) / 1000;
          p.lt = now;
          camT.azimuth += dx * ORBIT_SPEED;
          camT.polar = clampPolar(camT.polar + dy * ORBIT_SPEED);
          // Sample angular velocity for an inertial fling on release.
          const w = 0.35;
          velA = velA * (1 - w) + ((dx * ORBIT_SPEED) / dt) * w;
          velP = velP * (1 - w) + ((dy * ORBIT_SPEED) / dt) * w;
          if (reducedMotion) {
            cam.azimuth = camT.azimuth;
            cam.polar = camT.polar;
            velA = 0;
            velP = 0;
            placeCamera();
            renderOnce();
          }
        } else if (pointers.size === 2) {
          const pts = [...pointers.values()];
          // Pinch: zoom, keeping the M14 min/max distances (5–15).
          const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          if (pinchPrev > 0 && d > 0) {
            camT.dist = zoomDist(camT.dist, pinchPrev / d);
          }
          pinchPrev = d;
          // 2-finger drag: pan the look target, clamped ±2.5 around center.
          const mid = {
            x: (pts[0].x + pts[1].x) / 2,
            y: (pts[0].y + pts[1].y) / 2,
          };
          if (midPrev) {
            const mdx = mid.x - midPrev.x;
            const mdy = mid.y - midPrev.y;
            if (mdx !== 0 || mdy !== 0) {
              const { right, toCam } = panBasis(camT.azimuth);
              const pd = panDelta(right, toCam, mdx, mdy, camT.dist);
              camT.tx = clampPan(camT.tx + pd.x);
              camT.tz = clampPan(camT.tz + pd.z);
            }
          }
          midPrev = mid;
          if (reducedMotion) {
            cam.dist = camT.dist;
            cam.tx = camT.tx;
            cam.tz = camT.tz;
            placeCamera();
            renderOnce();
          }
        }
      };
      const onUp = (e: PointerEvent) => {
        const p = pointers.get(e.pointerId);
        const wasMulti = gestureMulti;
        pointers.delete(e.pointerId);
        if (pointers.size === 0) {
          gestureMulti = false;
          pinchPrev = 0;
          midPrev = null;
          if (p && !wasMulti) {
            const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
            const dur = performance.now() - p.t;
            if (isTap(moved, dur)) {
              // Tap selects (ghost tap-to-place keeps working); a double-tap
              // also resets the camera to the default view.
              velA = 0;
              velP = 0;
              const tap = { t: performance.now(), x: e.clientX, y: e.clientY };
              const dbl = isDoubleTap(lastTap, tap);
              lastTap = tap;
              pick(e.clientX, e.clientY);
              if (dbl) resetCamera();
            }
            // Drags keep their sampled velocities → inertial fling in tick.
          } else {
            velA = 0;
            velP = 0;
          }
        } else if (pointers.size < 2) {
          pinchPrev = 0;
          midPrev = null;
        }
      };
      const onCancel = (e: PointerEvent) => {
        pointers.delete(e.pointerId);
        velA = 0;
        velP = 0;
        if (pointers.size === 0) gestureMulti = false;
        if (pointers.size < 2) {
          pinchPrev = 0;
          midPrev = null;
        }
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        camT.dist = zoomDist(camT.dist, 1 + e.deltaY * 0.001);
        if (reducedMotion) {
          cam.dist = camT.dist;
          placeCamera();
          renderOnce();
        }
      };
      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onCancel);
      el.addEventListener("wheel", onWheel, { passive: false });
      onCleanup(() => {
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onCancel);
        el.removeEventListener("wheel", onWheel);
      });

      // Resize to host.
      const resize = () => {
        const w = hostEl.clientWidth || 1;
        const h = hostEl.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderOnce();
      };
      const ro = new ResizeObserver(resize);
      ro.observe(hostEl);
      resize();
      onCleanup(() => ro.disconnect());

      // Animation loop (skipped for reduced-motion: static scene).
      placeCamera();
      let raf = 0;
      if (!reducedMotion) {
        const clock = new THREE.Clock();
        let elapsed = 0;
        const tick = () => {
          if (cancelled) return;
          raf = requestAnimationFrame(tick);
          const dt = Math.min(clock.getDelta(), 0.05);
          elapsed += dt;
          // Damped orbit: the rendered rig chases its targets (CityMap-style).
          const k = 1 - Math.exp(-dt * 6);
          cam.azimuth += (camT.azimuth - cam.azimuth) * k;
          cam.polar += (camT.polar - cam.polar) * k;
          cam.dist += (camT.dist - cam.dist) * k;
          cam.tx += (camT.tx - cam.tx) * k;
          cam.tz += (camT.tz - cam.tz) * k;
          // Inertial fling after a 1-finger drag release (no inertia when
          // fingers are down, and never under reduced motion).
          if (pointers.size === 0 && (velA !== 0 || velP !== 0)) {
            camT.azimuth += velA * dt;
            camT.polar = clampPolar(camT.polar + velP * dt);
            const decay = Math.exp(-dt * 3.5);
            velA *= decay;
            velP *= decay;
            if (Math.abs(velA) < 0.02) velA = 0;
            if (Math.abs(velP) < 0.02) velP = 0;
          }
          placeCamera();
          for (const s of spinners) s.rotation.z += dt * 5;
          // M16: drive the avatar's idle life (blink, breathing, sway) via the
          // update hook stashed on group.userData by buildAvatarLook. The
          // capsule fallback has no hook — guarded.
          const avatarUpdate = avatarGroup?.userData?.update as
            | ((t: number, dt: number) => void)
            | undefined;
          if (typeof avatarUpdate === "function") avatarUpdate(elapsed, dt);
          renderer.render(scene, camera);
        };
        tick();
        onCleanup(() => cancelAnimationFrame(raf));
      } else {
        renderOnce();
      }

      onCleanup(() => {
        clearLayer(itemLayer);
        clearLayer(ghostLayer);
        if (avatarGroup) {
          avatarLayer.remove(avatarGroup);
          disposeGroupDeep(avatarGroup);
          avatarGroup = null;
        }
        if (ring) {
          scene.remove(ring);
          ring.geometry.dispose();
          (ring.material as THREE.Material).dispose();
          ring = null;
        }
        floorMesh.geometry.dispose();
        (floorMesh.material as THREE.Material).dispose();
        (grid.material as THREE.Material).dispose();
        grid.geometry.dispose();
        rug.geometry.dispose();
        (rug.material as THREE.Material).dispose();
        backWall.geometry.dispose();
        leftWall.geometry.dispose();
        (wallMat as THREE.Material).dispose();
        ghostGreen.dispose();
        ghostRed.dispose();
        ghostPlane.dispose();
        for (const m of Object.values(palette)) m.dispose();
        renderer.dispose();
        if (el.parentNode === hostEl) hostEl.removeChild(el);
      });
    }

    buildScene();

    return () => {
      cancelled = true;
      apiBox.current = null;
      apiRef.current = null;
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

  useEffect(() => {
    apiBox.current?.setPlaced(placed);
  }, [placed]);
  useEffect(() => {
    apiBox.current?.setGhost(ghost);
  }, [ghost]);
  useEffect(() => {
    apiBox.current?.setSelected(selectedKey);
  }, [selectedKey]);
  useEffect(() => {
    apiBox.current?.setStyle(wallHex, floorHex);
  }, [wallHex, floorHex]);
  useEffect(() => {
    apiBox.current?.setAvatar(avatarLook, avatarCell);
  }, [avatarLook, avatarCell]);

  return <div ref={hostRef} className="eko-room__canvas" aria-label="3D home room" />;
}

/* ============ Design swatch (wall/floor) ============ */

function StyleSwatch({
  style,
  currentId,
  previewing,
  onTap,
}: {
  style: HomeStyleEntry;
  currentId: string | null;
  previewing: boolean;
  onTap: () => void;
}) {
  const isCurrent = style.id === currentId;
  const owned = isCurrent || style.price <= 0;
  return (
    <button
      type="button"
      className={`eko-room__swatch${
        isCurrent ? " eko-room__swatch--current" : ""
      }${previewing ? " eko-room__swatch--preview" : ""}`}
      onClick={onTap}
      disabled={isCurrent}
      aria-label={
        isCurrent
          ? `${style.name} (current style)`
          : `${style.name}, ${naira(style.price)}`
      }
      title={style.desc ?? style.name}
    >
      <span
        className="eko-room__swatch-color"
        style={{ backgroundColor: style.hex }}
        aria-hidden="true"
      />
      <span className="eko-room__swatch-name">{style.name}</span>
      <span className="eko-room__swatch-sub">
        {isCurrent ? "Current" : owned ? "Owned" : naira(style.price)}
      </span>
    </button>
  );
}

/* ============ Home room section (room + buy mode) ============ */

export function HomeRoomSection({
  you,
  config,
  sendAct,
}: {
  you: You;
  config: GameConfig;
  sendAct: (a: ActName, params?: Record<string, unknown>) => void;
}) {
  const owned: FurnitureEntry[] = useMemo(
    () => (Array.isArray(you.furniture) ? you.furniture : []),
    [you.furniture]
  );
  const catalog = config.furniture ?? [];
  const catalogById = useMemo(() => {
    const m = new Map<string, (typeof catalog)[number]>();
    for (const c of catalog) {
      if (c && c.id) m.set(String(c.id).toLowerCase(), c);
    }
    return m;
  }, [catalog]);

  /* ---------- M15: home styles (walls/floors) + avatar look ---------- */

  // home_wall/home_floor are not yet on the You type — read defensively.
  const youX = you as You & HomeExtras;
  const wallStyles = useMemo(
    () =>
      (config.walls ?? [])
        .map(normalizeStyleEntry)
        .filter((s): s is HomeStyleEntry => s !== null),
    [config]
  );
  const floorStyles = useMemo(
    () =>
      (config.floors ?? [])
        .map(normalizeStyleEntry)
        .filter((s): s is HomeStyleEntry => s !== null),
    [config]
  );

  const ownedWallId =
    typeof youX.home_wall === "string" && youX.home_wall ? youX.home_wall : null;
  const ownedFloorId =
    typeof youX.home_floor === "string" && youX.home_floor
      ? youX.home_floor
      : null;

  // Free live preview of a not-yet-bought style.
  const [preview, setPreview] = useState<{
    kind: "wall" | "floor";
    id: string;
  } | null>(null);

  const styleHexOf = (kind: "wall" | "floor", id: string | null): string | null =>
    id ? (kind === "wall" ? wallStyles : floorStyles).find((s) => s.id === id)?.hex ?? null : null;

  const ownedWallHex = validHex(styleHexOf("wall", ownedWallId)) ?? DEFAULT_WALL_HEX;
  const ownedFloorHex = validHex(styleHexOf("floor", ownedFloorId)) ?? DEFAULT_FLOOR_HEX;
  const wallHex =
    preview?.kind === "wall"
      ? validHex(styleHexOf("wall", preview.id)) ?? ownedWallHex
      : ownedWallHex;
  const floorHex =
    preview?.kind === "floor"
      ? validHex(styleHexOf("floor", preview.id)) ?? ownedFloorHex
      : ownedFloorHex;

  const previewStyle: HomeStyleEntry | null = preview
    ? (preview.kind === "wall" ? wallStyles : floorStyles).find(
        (s) => s.id === preview.id
      ) ?? null
    : null;

  const tapStyle = (kind: "wall" | "floor", s: HomeStyleEntry) => {
    const currentId = kind === "wall" ? ownedWallId : ownedFloorId;
    if (s.id === currentId) return; // tapping current = no-op
    setPreview({ kind, id: s.id });
  };

  const buyPreview = () => {
    if (!preview) return;
    sendAct("buy_home_style", { kind: preview.kind, id: preview.id });
  };

  // Server confirmation clears the preview; a stuck preview auto-clears.
  useEffect(() => {
    if (!preview) return;
    const cur = preview.kind === "wall" ? ownedWallId : ownedFloorId;
    if (cur === preview.id) setPreview(null);
  }, [preview, ownedWallId, ownedFloorId]);
  useEffect(() => {
    if (!preview) return;
    const t = window.setTimeout(() => setPreview(null), 15000);
    return () => window.clearTimeout(t);
  }, [preview]);

  const avatarLook = useMemo(
    () =>
      sanitizeAvatarLook(
        you.avatar_look,
        config.avatarLook ?? AVATAR_LOOK_FALLBACK_OPTIONS
      ),
    [you.avatar_look, config]
  );

  const maxPlaced = typeof config.homeSlots === "number" ? config.homeSlots : 6;

  // Placed instances with resolved grid coords (auto-layout for legacy ones).
  const placed: PlacedSceneEntry[] = useMemo(() => {
    const raw = owned
      .filter((f) => f.placed)
      .map((f) => {
        const itemId = furnitureItemId(f).toLowerCase();
        const size = roomSizeFor(catalogById.get(itemId) ?? { id: itemId });
        const rotRaw = typeof f.rot === "number" ? f.rot : 0;
        const rot = ((((Math.floor(rotRaw) % 4) + 4) % 4) | 0) as 0 | 1 | 2 | 3;
        return {
          key: furnitureKey(f),
          itemId,
          size,
          rot,
          x: typeof f.x === "number" ? f.x : null,
          z: typeof f.z === "number" ? f.z : null,
        };
      });
    return layoutPlaced(raw);
  }, [owned, catalogById]);

  const placedCount = placed.length;
  const full = placedCount >= maxPlaced;
  const unplaced = useMemo(() => owned.filter((f) => !f.placed), [owned]);

  const [placing, setPlacing] = useState<{ key: string; itemId: string } | null>(null);
  const [ghostCell, setGhostCell] = useState<GridCell | null>(null);
  const [ghostRot, setGhostRot] = useState<0 | 1 | 2 | 3>(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // M16: the Buy catalogue lives in a bottom sheet over the room stage.
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>("collapsed");
  const [sheetHidden, setSheetHidden] = useState(false);
  const prevSnapRef = useRef<SheetSnap>("collapsed");
  const sheetSnapRef = useRef(sheetSnap);
  sheetSnapRef.current = sheetSnap;
  const sheetHiddenRef = useRef(sheetHidden);
  sheetHiddenRef.current = sheetHidden;
  const stageRef = useRef<HTMLDivElement>(null);
  const [dragH, setDragH] = useState<number | null>(null);
  const sheetDragRef = useRef<{
    startY: number;
    lastY: number;
    startH: number;
    moved: boolean;
  } | null>(null);
  const justDraggedRef = useRef(false);
  // Buy-mode v2 tabs: design first (when styles exist), then non-empty item tabs.
  const tabs = useMemo(
    () => visibleBuyTabs(catalog, wallStyles.length + floorStyles.length > 0),
    [catalog, wallStyles, floorStyles]
  );
  const [tab, setTab] = useState<BuyTabId>("design");
  const activeTab: BuyTabId = tabs.some((t) => t.id === tab)
    ? tab
    : tabs[0]?.id ?? "sleep";
  const [pendingBuy, setPendingBuy] = useState<{
    itemId: string;
    count: number;
  } | null>(null);
  const [confirmSell, setConfirmSell] = useState(false);
  const apiRef = useRef<RoomSceneApi | null>(null);

  const takenCells = (excludeKey?: string): GridCell[] =>
    placed
      .filter((p) => p.key !== excludeKey)
      .flatMap((p) => footprintCells(p.size, p.rot, p.x, p.z));

  /** M16: first grid cell where a footprint fits without overlapping placed
   *  items or the avatar — used to drop the placement ghost immediately. */
  const firstFreeCellFor = (
    size: Footprint,
    rot: number,
    excludeKey?: string
  ): GridCell | null => {
    const taken = takenCells(excludeKey);
    if (avatarCell) taken.push(avatarCell);
    for (let z = 0; z < ROOM_GRID; z++)
      for (let x = 0; x < ROOM_GRID; x++) {
        const cells = footprintCells(size, rot, x, z);
        if (fitsInGrid(cells) && !overlaps(cells, taken)) return [x, z];
      }
    return null;
  };

  // Free tile near the "door" (front row, biased to front-center) for the avatar.
  const avatarCell: GridCell | null = useMemo(() => {
    const taken = takenCells();
    const cells: GridCell[] = [];
    for (let z = 0; z < ROOM_GRID; z++)
      for (let x = 0; x < ROOM_GRID; x++) cells.push([x, z]);
    cells.sort(
      (a, b) =>
        Math.abs(a[1] - (ROOM_GRID - 1)) * 2 +
        Math.abs(a[0] - 2.5) -
        (Math.abs(b[1] - (ROOM_GRID - 1)) * 2 + Math.abs(b[0] - 2.5))
    );
    for (const c of cells) {
      if (!overlaps([c], taken)) return c;
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed]);

  // M16: compact placing toolbar — tap a tile to move the ghost (the M15
  // d-pad was dropped; it couldn't fit the ≤64px toolbar).
  const rotateGhost = () =>
    setGhostRot((((ghostRot + 1) % 4) | 0) as 0 | 1 | 2 | 3);

  /* ---------- M16: bottom-sheet handle drag / tap ---------- */

  const stageH = () => stageRef.current?.clientHeight || 340;

  const onSheetHandleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    const heights = sheetHeights(stageH());
    sheetDragRef.current = {
      startY: e.clientY,
      lastY: e.clientY,
      startH: heights[sheetSnapRef.current],
      moved: false,
    };
  };

  const onSheetHandleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = sheetDragRef.current;
    if (!d) return;
    d.lastY = e.clientY;
    if (Math.abs(d.startY - e.clientY) > 6) d.moved = true;
    const heights = sheetHeights(stageH());
    setDragH(
      Math.min(
        heights.full,
        Math.max(heights.collapsed, d.startH + (d.startY - e.clientY))
      )
    );
  };

  const onSheetHandleUp = () => {
    const d = sheetDragRef.current;
    sheetDragRef.current = null;
    if (!d) return;
    // A real drag swallows the click that follows it.
    justDraggedRef.current = d.moved;
    if (d.moved) {
      const heights = sheetHeights(stageH());
      const h = Math.min(
        heights.full,
        Math.max(heights.collapsed, d.startH + (d.startY - d.lastY))
      );
      setSheetSnap(nearestSnap(h, heights));
    }
    setDragH(null);
  };

  // Tap the handle cycles collapsed → half → full → collapsed.
  const onSheetHandleTap = () => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    setSheetSnap(nextSnap(sheetSnapRef.current));
  };

  const placingSize: Footprint = useMemo(
    () =>
      placing
        ? roomSizeFor(catalogById.get(placing.itemId) ?? { id: placing.itemId })
        : [1, 1],
    [placing, catalogById]
  );

  const ghostValid =
    !!placing &&
    !!ghostCell &&
    !full &&
    fitsInGrid(footprintCells(placingSize, ghostRot, ghostCell[0], ghostCell[1])) &&
    !overlaps(
      footprintCells(placingSize, ghostRot, ghostCell[0], ghostCell[1]),
      takenCells()
    );

  const ghost: GhostState | null = useMemo(
    () =>
      placing
        ? {
            itemId: placing.itemId,
            cell: ghostCell,
            valid: ghostValid,
            rot: ghostRot,
            size: placingSize,
          }
        : null,
    [placing, ghostCell, ghostValid, ghostRot, placingSize]
  );

  const placingName = placing
    ? catalogById.get(placing.itemId)?.name ?? placing.itemId
    : "";

  /* ---------- placing flow ---------- */

  const cancelPlacing = () => {
    // Exiting placement restores the sheet snap from before it auto-collapsed.
    if (placing && !sheetHiddenRef.current) setSheetSnap(prevSnapRef.current);
    setPlacing(null);
    setGhostCell(null);
  };

  const enterPlacing = (entry: FurnitureEntry) => {
    setSelectedKey(null);
    setConfirmSell(false);
    // Placement gets the full room: auto-collapse the buy sheet.
    prevSnapRef.current = sheetSnapRef.current;
    setSheetSnap("collapsed");
    const itemId = furnitureItemId(entry).toLowerCase();
    const key = furnitureKey(entry);
    setPlacing({ key, itemId });
    // M16: drop the ghost on the first free tile immediately so the player
    // sees it right away (falls back to tap-a-tile when the room is full).
    const size = roomSizeFor(catalogById.get(itemId) ?? { id: itemId });
    setGhostCell(firstFreeCellFor(size, 0, key));
    setGhostRot(0);
  };

  const commitPlace = () => {
    if (!placing || !ghostCell || !ghostValid) return;
    sendAct("place_furniture", {
      id: placing.key,
      placed: true,
      x: ghostCell[0],
      z: ghostCell[1],
      rot: ghostRot,
    });
    cancelPlacing();
  };

  const handleTapCell = (cell: GridCell) => {
    if (!placing) {
      setSelectedKey(null);
      return;
    }
    if (ghostCell && ghostCell[0] === cell[0] && ghostCell[1] === cell[1]) {
      commitPlace();
    } else {
      setGhostCell(cell);
    }
  };

  const handleTapItem = (key: string) => {
    cancelPlacing();
    setConfirmSell(false);
    setSelectedKey(key);
  };

  const handleTapEmpty = () => {
    setSelectedKey(null);
    setConfirmSell(false);
  };

  /* ---------- buy flow: auto-enter placing for the new instance ---------- */

  const unplacedCountOf = (itemId: string) =>
    unplaced.filter((f) => furnitureItemId(f).toLowerCase() === itemId).length;

  const startBuy = (itemIdRaw: string) => {
    const itemId = String(itemIdRaw).toLowerCase();
    sendAct("buy_furniture", { item: itemIdRaw });
    setPendingBuy({ itemId, count: unplacedCountOf(itemId) });
  };

  useEffect(() => {
    if (!pendingBuy) return;
    const matches = unplaced.filter(
      (f) => furnitureItemId(f).toLowerCase() === pendingBuy.itemId
    );
    if (matches.length > pendingBuy.count) {
      const newest = [...matches].sort((a, b) => {
        const an = Number(furnitureKey(a));
        const bn = Number(furnitureKey(b));
        if (Number.isFinite(an) && Number.isFinite(bn)) return bn - an;
        return 0;
      })[0];
      setPendingBuy(null);
      enterPlacing(newest);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [you.furniture, pendingBuy, unplaced]);

  // A failed buy (e.g. insufficient funds) never adds an instance — release
  // the pending state so the button doesn't stick on "Placing…".
  useEffect(() => {
    if (!pendingBuy) return;
    const t = window.setTimeout(() => setPendingBuy(null), 10000);
    return () => window.clearTimeout(t);
  }, [pendingBuy]);

  /* ---------- selected-item popup actions ---------- */

  const selected = selectedKey
    ? placed.find((p) => p.key === selectedKey) ?? null
    : null;
  const selectedOwned = selectedKey
    ? owned.find((f) => furnitureKey(f) === selectedKey) ?? null
    : null;
  const selectedCat = selected ? catalogById.get(selected.itemId) : undefined;
  const selectedName =
    selectedCat?.name ?? selectedOwned?.name ?? selected?.itemId ?? "Furniture";
  const selectedUse = selected ? useActFor(selected.itemId) : null;
  const selectedDesc =
    selectedCat?.desc ??
    selectedCat?.effect ??
    selectedOwned?.effect ??
    "Decor — it makes the place feel like home.";
  // M15: action rows derived from the item's effect code (e.g. "sleep_health").
  const selectedEffectCode = selectedCat?.effect ?? selectedOwned?.effect;
  const selectedActions = itemActionsFor(
    { effect: selectedEffectCode },
    selectedUse
  );
  const showDailyNote = isDailyEffect({
    effect: selectedEffectCode,
    desc: selectedDesc,
  });

  const rotateValid = (() => {
    if (!selected) return false;
    const next = (selected.rot + 1) % 4;
    const cells = footprintCells(selected.size, next, selected.x, selected.z);
    return fitsInGrid(cells) && !overlaps(cells, takenCells(selected.key));
  })();

  const rotateSelected = () => {
    if (!selected || !rotateValid) return;
    const next = ((selected.rot + 1) % 4) as 0 | 1 | 2 | 3;
    sendAct("place_furniture", {
      id: selected.key,
      placed: true,
      x: selected.x,
      z: selected.z,
      rot: next,
    });
  };

  const storeSelected = () => {
    if (!selected) return;
    sendAct("place_furniture", { id: selected.key, placed: false });
    setSelectedKey(null);
  };

  const sellSelected = () => {
    if (!selected) return;
    if (!confirmSell) {
      setConfirmSell(true);
      return;
    }
    sendAct("sell_furniture", { id: selected.key });
    setSelectedKey(null);
    setConfirmSell(false);
  };

  /* ---------- render ---------- */

  return (
    <section className="eko-home__section" id="home-room" aria-label="Home Room">
      <h2 className="eko-home__h">
        <span aria-hidden="true">🏠</span> My Home
      </h2>
      <p className="eko-home__note">
        Placed furniture boosts your daily vibes. {placedCount}/{maxPlaced}{" "}
        slots used.
      </p>

      <div className="eko-room__wrap">
        <div className="eko-room__toolbar">
          <button
            type="button"
            className="eko-room__btn"
            onClick={() => apiRef.current?.rotateCamera()}
            aria-label="Turn the room: snap the view to the nearest 90 degrees"
          >
            ⟳ Turn room
          </button>
          <span className="eko-room__hint">
            Drag to orbit • pinch to zoom • double-tap to reset
          </span>
        </div>

        <div className="eko-room__stage" ref={stageRef}>
          <RoomCanvas
            placed={placed}
            ghost={ghost}
            selectedKey={selectedKey}
            wallHex={wallHex}
            floorHex={floorHex}
            avatarLook={avatarLook}
            avatarCell={avatarCell}
            onTapItem={handleTapItem}
            onTapCell={handleTapCell}
            onTapEmpty={handleTapEmpty}
            apiRef={apiRef}
          />
          {preview && previewStyle && (
            <div className="eko-room__trybar" role="status">
              <span className="eko-room__trybar-text">
                Trying on <strong>{previewStyle.name}</strong> — nothing paid
                yet
              </span>
              <button
                type="button"
                className="eko-room__btn eko-room__btn--primary"
                onClick={buyPreview}
              >
                Buy · {naira(previewStyle.price)}
              </button>
              <button
                type="button"
                className="eko-room__btn"
                onClick={() => setPreview(null)}
              >
                Cancel
              </button>
            </div>
          )}
          {placing && (
            <div
              className="eko-room__placing eko-room__placing--compact"
              role="status"
            >
              {(full || (ghostCell && !ghostValid)) && (
                <span className="eko-room__placing-warn">
                  {full
                    ? "Room is full — store something first."
                    : "Won't fit there — try another tile."}
                </span>
              )}
              <div className="eko-room__placing-bar">
                <span
                  className="eko-room__placing-name"
                  title="Tap a tile to move the ghost, tap it again to drop it."
                >
                  Placing <strong>{placingName}</strong>
                </span>
                <button
                  type="button"
                  className="eko-room__btn eko-room__placing-btn"
                  onClick={rotateGhost}
                  aria-label="Rotate item 90 degrees"
                >
                  ⟳
                </button>
                <button
                  type="button"
                  className="eko-room__btn eko-room__btn--primary eko-room__placing-btn"
                  onClick={commitPlace}
                  disabled={!ghostValid}
                >
                  ✓ Place
                </button>
                <button
                  type="button"
                  className="eko-room__btn eko-room__placing-btn"
                  onClick={cancelPlacing}
                  aria-label="Cancel placing"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
          {selected && (
            <div
              className="eko-room__popup"
              role="dialog"
              aria-label={`${selectedName} options`}
            >
              <div className="eko-room__popup-head">
                <span aria-hidden="true">
                  {selectedCat?.icon ?? selectedOwned?.icon ?? "🪑"}
                </span>
                <strong>{selectedName}</strong>
                <button
                  type="button"
                  className="eko-room__x"
                  onClick={() => {
                    setSelectedKey(null);
                    setConfirmSell(false);
                  }}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <p className="eko-room__popup-desc">{selectedDesc}</p>
              {selectedActions.length > 0 && (
                <div
                  className="eko-room__actions"
                  role="group"
                  aria-label={`${selectedName} actions`}
                >
                  {selectedActions.map((r) => (
                    <button
                      key={r.act}
                      type="button"
                      className="eko-room__action"
                      onClick={() => sendAct(r.act)}
                    >
                      <span>{r.title}</span>
                      <span className="eko-room__action-hint">{r.hint}</span>
                    </button>
                  ))}
                </div>
              )}
              {showDailyNote && (
                <p className="eko-room__daily-note">
                  ✨ Works automatically every day — no tap needed.
                </p>
              )}
              <div className="eko-room__popup-btns">
                <button
                  type="button"
                  className="eko-room__btn"
                  onClick={rotateSelected}
                  disabled={!rotateValid}
                  aria-label="Rotate item 90 degrees"
                >
                  ⟳ Rotate item
                </button>
                <button
                  type="button"
                  className="eko-room__btn"
                  onClick={storeSelected}
                >
                  📦 Store item
                </button>
                <button
                  type="button"
                  className={`eko-room__btn ${
                    confirmSell ? "eko-room__btn--danger" : ""
                  }`}
                  onClick={sellSelected}
                >
                  {confirmSell ? "Tap again to sell (50% back)" : "💰 Sell item"}
                </button>
              </div>
            </div>
          )}
          {/* M16: Buy catalogue as a bottom sheet over the room stage. */}
          {!placing && !sheetHidden && (
            <div
              className={`eko-room__sheet eko-room__sheet--${sheetSnap}${
                dragH != null ? " eko-room__sheet--dragging" : ""
              }`}
              style={{ height: dragH ?? sheetHeights(stageH())[sheetSnap] }}
            >
              <div
                className="eko-room__sheet-handle"
                role="button"
                tabIndex={0}
                aria-label={`Buy sheet, ${sheetSnap}. Drag the handle or tap to resize.`}
                onPointerDown={onSheetHandleDown}
                onPointerMove={onSheetHandleMove}
                onPointerUp={onSheetHandleUp}
                onPointerCancel={onSheetHandleUp}
                onClick={onSheetHandleTap}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSheetHandleTap();
                  }
                }}
              >
                <span className="eko-room__sheet-grip" aria-hidden="true" />
                <span className="eko-room__sheet-title">Buy 🛋️</span>
                <span className="eko-room__sheet-balance">{naira(you.money)}</span>
                {sheetSnap !== "collapsed" && (
                  <button
                    type="button"
                    className="eko-room__sheet-hide"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSheetHidden(true);
                    }}
                    aria-label="Hide the buy sheet"
                  >
                    Hide ✕
                  </button>
                )}
              </div>
              <div className="eko-room__sheet-body">
                <div
                  className="eko-room__tabs"
                  role="tablist"
                  aria-label="Buy mode categories"
                >
                  {tabs.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === t.id}
                      className={`eko-room__tab ${
                        activeTab === t.id ? "eko-room__tab--active" : ""
                      }`}
                      onClick={() => setTab(t.id)}
                    >
                      <span aria-hidden="true">{t.emoji}</span> {t.label}
                    </button>
                  ))}
                </div>
                {activeTab === "design" ? (
                  <div className="eko-room__design">
                    {wallStyles.length > 0 && (
                      <>
                        <h4 className="eko-room__group-h">🎨 Paint it your way</h4>
                        <div className="eko-room__swatches" aria-label="Wall paints">
                          {wallStyles.map((s) => (
                            <StyleSwatch
                              key={s.id}
                              style={s}
                              currentId={ownedWallId}
                              previewing={
                                preview?.kind === "wall" && preview.id === s.id
                              }
                              onTap={() => tapStyle("wall", s)}
                            />
                          ))}
                        </div>
                      </>
                    )}
                    {floorStyles.length > 0 && (
                      <>
                        <h4 className="eko-room__group-h">🟫 Pick your floor</h4>
                        <div className="eko-room__swatches" aria-label="Floor styles">
                          {floorStyles.map((s) => (
                            <StyleSwatch
                              key={s.id}
                              style={s}
                              currentId={ownedFloorId}
                              previewing={
                                preview?.kind === "floor" && preview.id === s.id
                              }
                              onTap={() => tapStyle("floor", s)}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="eko-room__cards">
                    {catalog
                      .filter((c) => buyTabFor(c) === activeTab)
                      .map((c) => {
                        const price = priceOf(c);
                        const ok = you.money >= price;
                        const short = Math.max(0, price - you.money);
                        const size = roomSizeFor(c);
                        const ownedCount = owned.filter(
                          (f) =>
                            furnitureItemId(f).toLowerCase() ===
                            String(c.id).toLowerCase()
                        ).length;
                        const isPending =
                          pendingBuy?.itemId === String(c.id).toLowerCase();
                        return (
                          <div
                            key={c.id}
                            className={`eko-room__card${
                              ok ? "" : " eko-room__card--poor"
                            }`}
                          >
                            <div className="eko-room__card-top">
                              <span
                                className="eko-room__card-icon"
                                aria-hidden="true"
                              >
                                {c.icon ?? "🪑"}
                              </span>
                              <div className="eko-room__card-meta">
                                <strong>
                                  {c.name}
                                  {ownedCount > 0 && ` ×${ownedCount}`}
                                </strong>
                                <span className="eko-room__card-sub">
                                  {size[0]}×{size[1]} ·{" "}
                                  {c.desc ?? c.effect ?? "Decor."}
                                </span>
                              </div>
                            </div>
                            <div className="eko-room__card-foot">
                              <span className="eko-room__price">{naira(price)}</span>
                              <button
                                type="button"
                                className="eko-room__buy"
                                disabled={!ok || !!pendingBuy}
                                onClick={() => startBuy(c.id)}
                                aria-label={
                                  ok
                                    ? `Buy ${c.name} for ${naira(price)}`
                                    : `Cannot afford ${c.name}: need ${naira(short)} more`
                                }
                              >
                                {isPending
                                  ? "Placing…"
                                  : ok
                                    ? "Buy"
                                    : `Need ${naira(short)} more`}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
                {catalog.length === 0 && (
                  <p className="eko-home__note">
                    The furniture catalog hasn&apos;t arrived yet.
                  </p>
                )}
              </div>
            </div>
          )}
          {!placing && sheetHidden && (
            <button
              type="button"
              className="eko-room__sheet-fab"
              onClick={() => setSheetHidden(false)}
              aria-label="Show the buy sheet"
            >
              Buy 🛋️
            </button>
          )}
        </div>

        {unplaced.length > 0 && (
          <div className="eko-room__inventory">
            <span className="eko-room__inv-label">In storage:</span>
            {unplaced.map((f) => {
              const id = furnitureItemId(f).toLowerCase();
              const c = catalogById.get(id);
              return (
                <button
                  key={furnitureKey(f)}
                  type="button"
                  className="eko-room__inv-item"
                  onClick={() => enterPlacing(f)}
                  disabled={full}
                  aria-label={`Place ${c?.name ?? f.name ?? "furniture"}`}
                >
                  <span aria-hidden="true">{c?.icon ?? f.icon ?? "🪑"}</span>
                  <span>{c?.name ?? f.name ?? "Furniture"}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
