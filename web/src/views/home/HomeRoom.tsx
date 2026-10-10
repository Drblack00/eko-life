import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { priceOf, type GameConfig } from "../../lib/api";
import {
  furnitureItemId,
  furnitureKey,
  naira,
  type ActName,
  type FurnitureEntry,
  type You,
} from "../../game/types";
import {
  footprintCells,
  fitsInGrid,
  layoutPlaced,
  overlaps,
  useActFor,
  useLabel,
  ROOM_CATEGORIES,
  ROOM_GRID,
  type GridCell,
  type Footprint,
  type RoomCategory,
} from "./roomGrid";
import { roomSizeFor, roomCategoryFor } from "./catalogue";
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
  onTapItem,
  onTapCell,
  onTapEmpty,
  apiRef,
}: {
  placed: PlacedSceneEntry[];
  ghost: GhostState | null;
  selectedKey: string | null;
  onTapItem: (key: string) => void;
  onTapCell: (cell: GridCell) => void;
  onTapEmpty: () => void;
  apiRef: { current: RoomSceneApi | null };
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cbRef = useRef({ onTapItem, onTapCell, onTapEmpty });
  cbRef.current = { onTapItem, onTapCell, onTapEmpty };

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
      scene.background = new THREE.Color(0xf7f1e3);

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

      let spinners: THREE.Object3D[] = [];
      let ring: THREE.Mesh | null = null;
      let currentSelected: string | null = null;

      const renderOnce = () => renderer.render(scene, camera);

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
        rotateCamera() {
          quarter = (quarter + 1) % 4;
          angleTarget = Math.PI / 4 + (quarter * Math.PI) / 2;
          if (reducedMotion) {
            angle = angleTarget;
            renderOnce();
          }
        },
      };
      apiBox.current = api;
      apiRef.current = api;

      // ---- Camera: isometric-style, 90° rotate steps + zoom, no pan ----
      let quarter = 0;
      let angle = Math.PI / 4;
      let angleTarget = angle;
      let viewDist = 9.5;
      const placeCamera = () => {
        camera.position.set(
          Math.cos(angle) * viewDist,
          viewDist * 0.9,
          Math.sin(angle) * viewDist
        );
        camera.lookAt(0, 0.4, 0);
      };

      // ---- Tap (≤8px) vs pinch/wheel zoom ----
      const raycaster = new THREE.Raycaster();
      const pointerNdc = new THREE.Vector2();
      const pointers = new Map<number, { x: number; y: number; sx: number; sy: number }>();
      let pinchDist = 0;

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
        pointers.set(e.pointerId, {
          x: e.clientX,
          y: e.clientY,
          sx: e.clientX,
          sy: e.clientY,
        });
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        }
      };
      const onMove = (e: PointerEvent) => {
        const p = pointers.get(e.pointerId);
        if (!p) return;
        p.x = e.clientX;
        p.y = e.clientY;
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinchDist > 0 && d > 0) {
            viewDist = Math.min(15, Math.max(5, viewDist * (pinchDist / d)));
            placeCamera();
            renderOnce();
          }
          pinchDist = d;
        }
      };
      const onUp = (e: PointerEvent) => {
        const p = pointers.get(e.pointerId);
        pointers.delete(e.pointerId);
        if (p && pointers.size === 0) {
          const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
          if (moved <= 8) pick(e.clientX, e.clientY);
        }
        if (pointers.size < 2) pinchDist = 0;
      };
      const onCancel = (e: PointerEvent) => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchDist = 0;
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        viewDist = Math.min(15, Math.max(5, viewDist * (1 + e.deltaY * 0.001)));
        placeCamera();
        renderOnce();
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
        const tick = () => {
          if (cancelled) return;
          raf = requestAnimationFrame(tick);
          const dt = Math.min(clock.getDelta(), 0.05);
          const diff = angleTarget - angle;
          if (Math.abs(diff) > 0.0005) {
            angle += diff * Math.min(1, dt * 5);
          } else {
            angle = angleTarget;
          }
          placeCamera();
          for (const s of spinners) s.rotation.z += dt * 5;
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

  return <div ref={hostRef} className="eko-room__canvas" aria-label="3D home room" />;
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
  const [tab, setTab] = useState<RoomCategory>("sleep");
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
    setPlacing(null);
    setGhostCell(null);
  };

  const enterPlacing = (entry: FurnitureEntry) => {
    setSelectedKey(null);
    setConfirmSell(false);
    setPlacing({
      key: furnitureKey(entry),
      itemId: furnitureItemId(entry).toLowerCase(),
    });
    setGhostCell(null);
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
        <span aria-hidden="true">🏠</span> Home Room
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
            aria-label="Rotate camera 90 degrees"
          >
            ⟳ View
          </button>
          <span className="eko-room__hint">
            Tap an item • pinch or scroll to zoom
          </span>
        </div>

        <div className="eko-room__stage">
          <RoomCanvas
            placed={placed}
            ghost={ghost}
            selectedKey={selectedKey}
            onTapItem={handleTapItem}
            onTapCell={handleTapCell}
            onTapEmpty={handleTapEmpty}
            apiRef={apiRef}
          />
          {placing && (
            <div className="eko-room__placing" role="status">
              <span>
                Placing <strong>{placingName}</strong> — tap a tile to preview,
                tap it again or press ✓ to drop it.
              </span>
              <div className="eko-room__placing-btns">
                <button
                  type="button"
                  className="eko-room__btn eko-room__btn--primary"
                  onClick={commitPlace}
                  disabled={!ghostValid}
                >
                  ✓ Place
                </button>
                <button
                  type="button"
                  className="eko-room__btn"
                  onClick={() =>
                    setGhostRot((((ghostRot + 1) % 4) | 0) as 0 | 1 | 2 | 3)
                  }
                  aria-label="Rotate item 90 degrees"
                >
                  ⟳ Item
                </button>
                <button
                  type="button"
                  className="eko-room__btn"
                  onClick={cancelPlacing}
                >
                  ✕
                </button>
              </div>
              {full && (
                <span className="eko-room__warn">
                  Room is full — store something first.
                </span>
              )}
              {ghostCell && !ghostValid && !full && (
                <span className="eko-room__warn">
                  Won&apos;t fit there — try another tile.
                </span>
              )}
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
              <div className="eko-room__popup-btns">
                {selectedUse && (
                  <button
                    type="button"
                    className="eko-room__btn eko-room__btn--primary"
                    onClick={() => sendAct(selectedUse)}
                  >
                    {useLabel(selectedUse)}
                  </button>
                )}
                <button
                  type="button"
                  className="eko-room__btn"
                  onClick={rotateSelected}
                  disabled={!rotateValid}
                  aria-label="Rotate item 90 degrees"
                >
                  ⟳ Rotate
                </button>
                <button
                  type="button"
                  className="eko-room__btn"
                  onClick={storeSelected}
                >
                  📦 Store
                </button>
                <button
                  type="button"
                  className={`eko-room__btn ${
                    confirmSell ? "eko-room__btn--danger" : ""
                  }`}
                  onClick={sellSelected}
                >
                  {confirmSell ? "Tap again to sell (50% back)" : "💰 Sell"}
                </button>
              </div>
            </div>
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

      <h3 className="eko-home__subh">Buy furniture</h3>
      <div
        className="eko-room__tabs"
        role="tablist"
        aria-label="Furniture categories"
      >
        {ROOM_CATEGORIES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`eko-room__tab ${
              tab === t.id ? "eko-room__tab--active" : ""
            }`}
            onClick={() => setTab(t.id)}
          >
            <span aria-hidden="true">{t.emoji}</span> {t.label}
          </button>
        ))}
      </div>
      <div className="eko-room__cards">
        {catalog
          .filter((c) => roomCategoryFor(c) === tab)
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
              <div key={c.id} className="eko-room__card">
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
                      ? `Buy · ${naira(price)}`
                      : `Need ${naira(short)} more`}
                </button>
              </div>
            );
          })}
      </div>
      {catalog.length === 0 && (
        <p className="eko-home__note">
          The furniture catalog hasn&apos;t arrived yet.
        </p>
      )}
    </section>
  );
}
