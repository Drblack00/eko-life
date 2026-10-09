import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PinLocation } from "./stubLocations";
import "./CityMap.css";

/**
 * Original procedural toy-Lagos: green Mainland (left), blue lagoon (center),
 * green Island (right). Instanced low-poly buildings, emoji pins, boats,
 * region labels. Drag to pan, wheel/pinch to zoom.
 */

const WORLD = { x: 90, z: 90 };
const LAGOON_HALF = 13;

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

export function CityMap({
  pins,
  onPinSelect,
}: {
  pins: PinLocation[];
  onPinSelect: (pin: PinLocation) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const pinsRef = useRef(pins);
  const selectRef = useRef(onPinSelect);
  /** Assigned by the mount effect; lets the pin layer refresh when `pins` changes. */
  const rebuildRef = useRef<((list: PinLocation[]) => void) | null>(null);
  pinsRef.current = pins;
  selectRef.current = onPinSelect;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xbfdbfe);
    scene.fog = new THREE.Fog(0xbfdbfe, 220, 420);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(42, 1, 1, 800);
    camera.position.set(0, 96, 104);
    camera.lookAt(0, 0, 6);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = false;
    controls.enableDamping = !reducedMotion;
    controls.dampingFactor = 0.08;
    controls.minDistance = 55;
    controls.maxDistance = 230;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    controls.screenSpacePanning = false;

    // Lights
    scene.add(new THREE.HemisphereLight(0xe0f2fe, 0x86a860, 0.9));
    const sun = new THREE.DirectionalLight(0xfff7e6, 1.6);
    sun.position.set(-60, 120, 40);
    scene.add(sun);

    // Seabed / base
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(WORLD.x * 2 + 20, 2, WORLD.z * 2 + 20),
      new THREE.MeshStandardMaterial({ color: 0xc2b280, roughness: 1 })
    );
    base.position.y = -2;
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
      color: 0x0ea5e9,
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
      color: 0x4ade80,
      roughness: 1,
    });
    const landMat2 = new THREE.MeshStandardMaterial({
      color: 0x38c173,
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

    // Buildings — instanced white low-poly boxes on both masses
    const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
    const buildingMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
    });
    const COUNT = 150;
    const buildings = new THREE.InstancedMesh(buildingGeo, buildingMat, COUNT);
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    let placed = 0;
    let guard = 0;
    while (placed < COUNT && guard++ < 4000) {
      const side = rand() < 0.5 ? -1 : 1;
      const x =
        side * (LAGOON_HALF + 6 + rand() * (WORLD.x - LAGOON_HALF - 12));
      const z = (rand() - 0.5) * (WORLD.z * 2 - 16);
      // keep clear of pin spots
      if (pinsRef.current.some((p) => Math.hypot(p.x - x, p.z - z) < 7))
        continue;
      const w = 3 + rand() * 5;
      const d = 3 + rand() * 5;
      const h = 2 + rand() * (rand() < 0.12 ? 16 : 7);
      dummy.position.set(x, 2 + h / 2, z);
      dummy.scale.set(w, h, d);
      dummy.rotation.y = (rand() - 0.5) * 0.3;
      dummy.updateMatrix();
      buildings.setMatrixAt(placed, dummy.matrix);
      col.setHSL(0.12, 0.08, 0.88 + rand() * 0.1);
      if (rand() < 0.08) col.setHSL(0.11, 0.75, 0.55); // danfo-yellow accents
      buildings.setColorAt(placed, col);
      placed++;
    }
    buildings.instanceMatrix.needsUpdate = true;
    if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;
    scene.add(buildings);

    // Palm trees — instanced cones
    const treeGeo = new THREE.ConeGeometry(1.6, 5, 6);
    const treeMat = new THREE.MeshStandardMaterial({
      color: 0x16a34a,
      roughness: 1,
    });
    const TREES = 70;
    const trees = new THREE.InstancedMesh(treeGeo, treeMat, TREES);
    let tp = 0;
    guard = 0;
    while (tp < TREES && guard++ < 2000) {
      const side = rand() < 0.5 ? -1 : 1;
      const x =
        side * (LAGOON_HALF + 4 + rand() * (WORLD.x - LAGOON_HALF - 10));
      const z = (rand() - 0.5) * (WORLD.z * 2 - 12);
      if (pinsRef.current.some((p) => Math.hypot(p.x - x, p.z - z) < 6))
        continue;
      const s = 0.7 + rand() * 0.9;
      dummy.position.set(x, 3 + 2.2 * s, z);
      dummy.scale.setScalar(s);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      trees.setMatrixAt(tp, dummy.matrix);
      tp++;
    }
    trees.instanceMatrix.needsUpdate = true;
    scene.add(trees);

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

    // Boats drifting on the lagoon
    const boats: THREE.Mesh[] = [];
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.8,
    });
    const sailMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 3; i++) {
      const boat = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1, 1.4), hullMat);
      const sail = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, 2.2),
        sailMat
      );
      sail.position.set(0, 1.8, 0);
      boat.add(hull, sail);
      boat.position.set(
        (rand() - 0.5) * (LAGOON_HALF * 1.4),
        1.1,
        -60 + i * 55
      );
      scene.add(boat);
      boats.push(boat as unknown as THREE.Mesh);
    }

    // Pins
    const pinGroup = new THREE.Group();
    scene.add(pinGroup);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hovered: THREE.Sprite | null = null;
    const pinSprites: THREE.Sprite[] = [];

    const buildPins = (list: PinLocation[]) => {
      for (const c of [...pinGroup.children]) {
        const s = c as THREE.Sprite;
        s.material.map?.dispose();
        s.material.dispose();
      }
      pinGroup.clear();
      pinSprites.length = 0;
      hovered = null;
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
      }
    };
    buildPins(pinsRef.current);
    rebuildRef.current = buildPins;

    // Resize
    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

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
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      setPointer(e);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(pinSprites, false)[0];
      const next = (hit?.object as THREE.Sprite) ?? null;
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
      const hit = raycaster.intersectObjects(pinSprites, false)[0];
      if (hit) {
        const pin = (hit.object as THREE.Sprite).userData.pin as PinLocation;
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
    const render = () => renderer.render(scene, camera);
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      if (!reducedMotion) {
        // Water shimmer
        const pos = waterGeo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const bx = waterBase[i * 3];
          const bz = waterBase[i * 3 + 2];
          pos.setY(i, 0.35 * Math.sin(bx * 0.35 + t * 1.6) + 0.25 * Math.cos(bz * 0.18 + t * 1.1));
        }
        pos.needsUpdate = true;
        // Pin bobbing
        for (const s of pinSprites) {
          s.position.y = 10 + Math.sin(t * 2 + s.userData.phase) * 0.7;
        }
        // Boats drift
        boats.forEach((b, i) => {
          b.position.z += Math.sin(t * 0.3 + i * 2) * 0.008;
          b.rotation.z = Math.sin(t * 1.2 + i) * 0.06;
        });
        controls.update();
      }
      render();
    };
    animate();

    if (reducedMotion) {
      const onChange = () => render();
      controls.addEventListener("change", onChange);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      rebuildRef.current = null;
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      controls.dispose();
      renderer.dispose();
      host.removeChild(el);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh the pin layer when the parent hands a new pin list (e.g. the
  // player's own marker after travelling). Runs after the mount effect.
  useEffect(() => {
    rebuildRef.current?.(pins);
  }, [pins]);

  return (
    <div className="eko-citymap" ref={hostRef} role="img" aria-label="3D toy city of Lagos with clickable location pins">
      <div ref={tooltipRef} className="eko-citymap__tooltip" hidden />
    </div>
  );
}
