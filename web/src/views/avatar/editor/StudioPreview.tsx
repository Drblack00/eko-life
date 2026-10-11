/**
 * Avatar studio — 3D preview shell (Milestone 5).
 *
 * Extracted VERBATIM from the legacy AvatarStudio mount effect (M20):
 * renderer, 3-point studio lighting, spotlight pool + accent ring, camera
 * rig (drag-to-spin with the touch directional lock, pinch/wheel zoom,
 * Face / Full-body presets with size-responsive framing, reduced-motion
 * support, safe-area-friendly overlay UI). studio.ts camera math is
 * untouched — this file only calls it.
 *
 * The figure itself is owned by the parent via the imperative api:
 * setFigure() swaps the character (old one disposed), so both the legacy
 * studio (buildAvatarLook) and the rebuilt editor (AvatarLoader) share
 * one rig instead of duplicating ~300 lines of Three.js setup.
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  BODY_PRESET,
  DEFAULT_FRAMING,
  FACE_PRESET,
  STUDIO_FOV_DEG,
  clampZoom,
  compensateDistance,
  decideSpinLock,
  driftTargetY,
  easeInOutCubic,
  framingForContainer,
  matchesPreset,
  cameraPositionFor,
  type CameraFraming,
  type StudioPresetKind,
} from "../parts/studio";

export interface StudioFigure {
  group: THREE.Group;
  update?: (t: number, dt: number) => void;
  /** Optional disposal; defaults to group.userData.dispose when present. */
  dispose?: () => void;
}

export interface StudioPreviewApi {
  /** Replace the on-screen figure (old removed + disposed). */
  setFigure: (fig: StudioFigure | null) => void;
  goPreset: (p: StudioPresetKind) => void;
  /** Return the camera to the default full-body framing. */
  resetView: () => void;
}

/** Radial spotlight pool texture for the floor disc (canvas-generated). */
function makeSpotTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    grad.addColorStop(0, "rgba(150,182,224,0.9)");
    grad.addColorStop(0.55, "rgba(96,128,178,0.35)");
    grad.addColorStop(1, "rgba(70,95,140,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function disposeFigure(fig: StudioFigure): void {
  try {
    if (fig.dispose) fig.dispose();
    else
      (
        fig.group.userData.dispose as (() => void) | undefined
      )?.();
  } catch {
    /* disposal must never break the render loop */
  }
}

export function StudioPreview({
  onApi,
}: {
  onApi: (api: StudioPreviewApi | null) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const onApiRef = useRef(onApi);
  onApiRef.current = onApi;
  const [glFailed, setGlFailed] = useState(false);
  const [activePreset, setActivePreset] = useState<"face" | "body" | null>(null);
  const [zoomHint, setZoomHint] = useState(true);
  // Current figure's idle animation (blink, breathing, …).
  const updateRef = useRef<((t: number, dt: number) => void) | undefined>(
    undefined
  );
  const figureRef = useRef<StudioFigure | null>(null);
  // Camera rig state (refs: mutated by the rAF loop and input handlers).
  const camRef = useRef<CameraFraming>({ ...DEFAULT_FRAMING });
  const camTargetRef = useRef<CameraFraming>({ ...DEFAULT_FRAMING });
  const transitionRef = useRef<{
    start: CameraFraming;
    end: CameraFraming;
    t0: number;
    dur: number;
  } | null>(null);
  const reduceMotionRef = useRef(false);
  // goPreset / zoom handlers need to reach into the mount effect's rig.
  const rigRef = useRef<{
    applyZoom: (distance: number) => void;
    goPreset: (p: StudioPresetKind) => void;
  } | null>(null);

  // Size-responsive preset anchors, re-derived from the measured preview
  // container on every resize (Bug 2: the studio now lives in a smaller
  // embedded card — framing must not be hardcoded for one card size).
  const framingsRef = useRef<{ face: CameraFraming; body: CameraFraming }>({
    face: { ...FACE_PRESET },
    body: { ...BODY_PRESET },
  });
  // Live container aspect for render-time horizontal compensation.
  const aspectRef = useRef(1);
  // True until the first measured framing lands (snaps the opening frame).
  const firstFrameRef = useRef(true);

  const goPreset = (p: StudioPresetKind) => rigRef.current?.goPreset(p);

  /* ---------- Three.js preview ---------- */
  // Mount effect: renderer, studio lighting, stage, camera rig, input.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setGlFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(STUDIO_FOV_DEG, 1, 0.1, 50);

    /* Studio 3-point lighting. */
    scene.add(new THREE.HemisphereLight(0xffffff, 0x1e293b, 0.85));
    // Key: warm, casts the soft shadow.
    const keyLight = new THREE.DirectionalLight(0xfff1dc, 2.3);
    keyLight.position.set(1.6, 2.6, 2.2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -1.3;
    keyLight.shadow.camera.right = 1.3;
    keyLight.shadow.camera.top = 2.4;
    keyLight.shadow.camera.bottom = -0.3;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 9;
    keyLight.shadow.bias = -0.0004;
    scene.add(keyLight);
    // Fill: cool, lifts the shadow side.
    const fill = new THREE.DirectionalLight(0xbfd9ff, 0.75);
    fill.position.set(-2.2, 1.4, 1.6);
    scene.add(fill);
    // Rim: separation from the backdrop.
    const rim = new THREE.DirectionalLight(0xdceaff, 1.25);
    rim.position.set(-0.8, 2.2, -2.6);
    scene.add(rim);

    // Spotlight pool the figure stands on + brand accent ring.
    const spotTex = makeSpotTexture();
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.85, 48),
      new THREE.MeshStandardMaterial({
        map: spotTex,
        transparent: true,
        roughness: 0.9,
        metalness: 0,
      })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.001;
    disc.receiveShadow = true;
    scene.add(disc);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 0.9, 48),
      new THREE.MeshBasicMaterial({ color: "#22d3ee", transparent: true, opacity: 0.5 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.002;
    scene.add(ring);

    const spinner = new THREE.Group();
    scene.add(spinner);

    const setFigure = (fig: StudioFigure | null) => {
      const old = figureRef.current;
      figureRef.current = fig;
      if (old) {
        spinner.remove(old.group);
        disposeFigure(old);
      }
      if (fig) {
        fig.group.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = true;
        });
        spinner.add(fig.group);
        updateRef.current = fig.update;
      } else {
        updateRef.current = undefined;
      }
    };

    /* Camera rig: spin the figure; zoom + presets move the camera. */
    const cam = camRef.current;
    const camTarget = camTargetRef.current;
    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    reduceMotionRef.current = reduceMotion;

    const syncPresetButton = () => {
      const { face, body } = framingsRef.current;
      if (matchesPreset(camTarget, face)) setActivePreset("face");
      else if (matchesPreset(camTarget, body)) setActivePreset("body");
      else setActivePreset(null);
    };

    // Derive the Face/Full-body anchors from the measured container so the
    // full head + tallest hairstyle always fits (Bug 2). First call snaps
    // the opening frame; later calls re-anchor a preset the user is sitting
    // on (e.g. after rotation) and let the damped follow glide to it.
    const applyFraming = () => {
      const w = Math.max(1, mount.clientWidth);
      const h = Math.max(1, mount.clientHeight);
      aspectRef.current = w / h;
      const prev = framingsRef.current;
      const next = {
        face: framingForContainer("face", w, h),
        body: framingForContainer("body", w, h),
      };
      framingsRef.current = next;
      if (firstFrameRef.current) {
        firstFrameRef.current = false;
        cam.distance = next.body.distance;
        cam.targetY = next.body.targetY;
        camTarget.distance = next.body.distance;
        camTarget.targetY = next.body.targetY;
        syncPresetButton();
        return;
      }
      if (matchesPreset(camTarget, prev.face)) {
        camTarget.distance = next.face.distance;
        camTarget.targetY = next.face.targetY;
      } else if (matchesPreset(camTarget, prev.body)) {
        camTarget.distance = next.body.distance;
        camTarget.targetY = next.body.targetY;
      }
      syncPresetButton();
    };

    rigRef.current = {
      applyZoom: (distance: number) => {
        transitionRef.current = null;
        const d = clampZoom(distance);
        const { face, body } = framingsRef.current;
        camTarget.distance = d;
        camTarget.targetY = driftTargetY(d, face.targetY, body.targetY);
        setZoomHint(false);
        syncPresetButton();
      },
      goPreset: (p: StudioPresetKind) => {
        const preset = framingsRef.current[p];
        camTarget.distance = preset.distance;
        camTarget.targetY = preset.targetY;
        if (reduceMotion) {
          // No animation when reduced motion is requested — jump to frame.
          transitionRef.current = null;
          cam.distance = preset.distance;
          cam.targetY = preset.targetY;
        } else {
          transitionRef.current = {
            start: { ...cam },
            end: { ...preset },
            t0: performance.now(),
            dur: 650,
          };
        }
        setZoomHint(false);
        setActivePreset(p);
      },
    };

    onApiRef.current({
      setFigure,
      goPreset: (p) => rigRef.current?.goPreset(p),
      resetView: () => rigRef.current?.goPreset("body"),
    });

    /* Input: single-pointer drag spins; two-pointer pinch + wheel zoom.
       Bug 2 gesture fix: the preview is touch-action: pan-y, so a vertical
       swipe scrolls the sheet natively. Touch drags additionally go through
       a directional lock — only horizontal-dominant drags spin the figure;
       vertical-dominant ones are left alone so the sheet's scroll is never
       trapped (no more snap-back). Mouse/pen keep the legacy behavior. */
    let angle = 0.6;
    let target = 0.6;
    let dragging = false;
    let lastX = 0;
    let lastInteract = 0;
    const pointers = new Map<number, { x: number; y: number; type: string }>();
    let pinchStart: { pinch: number; dist: number } | null = null;
    // Touch directional lock: null = undecided, true = spin, false = scroll.
    let spinLock: boolean | null = null;
    let startX = 0;
    let startY = 0;
    const el = renderer.domElement;

    const pinchDist = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    const onDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      lastInteract = performance.now();
      if (pointers.size === 2) {
        // Second finger down: switch from spin to pinch.
        dragging = false;
        spinLock = null;
        pinchStart = { pinch: pinchDist(), dist: camTarget.distance };
      } else if (pointers.size === 1) {
        startX = e.clientX;
        startY = e.clientY;
        lastX = e.clientX;
        spinLock = null;
        if (e.pointerType === "touch") {
          // Wait for the directional lock before spinning; capturing the
          // pointer early can steal the browser's vertical pan on some
          // platforms. A vertical swipe is left to the sheet's scroll.
          dragging = false;
        } else {
          dragging = true;
          try {
            el.setPointerCapture(e.pointerId);
          } catch {
            /* noop */
          }
        }
      }
    };
    const onMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      lastInteract = performance.now();
      if (pointers.size === 2 && pinchStart && pinchStart.pinch > 0) {
        const ratio = pinchStart.pinch / Math.max(1, pinchDist());
        rigRef.current?.applyZoom(pinchStart.dist * ratio);
      } else if (pointers.size === 1) {
        if (e.pointerType === "touch" && spinLock === null) {
          const lock = decideSpinLock(e.clientX - startX, e.clientY - startY);
          if (lock !== null) {
            spinLock = lock;
            if (lock) {
              dragging = true;
              try {
                el.setPointerCapture(e.pointerId);
              } catch {
                /* noop */
              }
            }
            // lock === false: vertical-dominant — hands off. The sheet
            // scrolls natively; the browser pointercancels this gesture.
          }
        }
        if (dragging) {
          target += (e.clientX - lastX) * 0.012;
          lastX = e.clientX;
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      lastInteract = performance.now();
      spinLock = null;
      if (pointers.size === 0) {
        dragging = false;
        pinchStart = null;
      } else if (pointers.size === 1) {
        // Back to one finger: re-arm from the remaining pointer (touch
        // re-locks by direction; mouse/pen resume spinning immediately).
        pinchStart = null;
        const [rest] = [...pointers.values()];
        startX = rest.x;
        startY = rest.y;
        lastX = rest.x;
        dragging = rest.type !== "touch";
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      lastInteract = performance.now();
      const next =
        camTarget.distance * (e.deltaY > 0 ? 1.12 : 1 / 1.12);
      rigRef.current?.applyZoom(next);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // Re-derive the preset anchors from the live container size so the
      // head keeps fitting after rotations / card resizes.
      applyFraming();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let raf = 0;
    const clock = new THREE.Clock();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(clock.getDelta(), 0.1);
      updateRef.current?.(clock.elapsedTime, dt);
      // Gentle auto-spin when the user hasn't touched it recently.
      if (!reduceMotion && !dragging && now - lastInteract > 3000)
        target += 0.004;
      angle += (target - angle) * 0.12;
      spinner.rotation.y = angle;

      // Camera: eased preset transitions, otherwise damped follow.
      const tr = transitionRef.current;
      if (tr) {
        const k = tr.dur <= 0 ? 1 : Math.min(1, (now - tr.t0) / tr.dur);
        const ez = easeInOutCubic(k);
        cam.distance = tr.start.distance + (tr.end.distance - tr.start.distance) * ez;
        cam.targetY = tr.start.targetY + (tr.end.targetY - tr.start.targetY) * ez;
        if (k >= 1) transitionRef.current = null;
      } else {
        const a = 1 - Math.exp(-dt * 10);
        cam.distance += (camTarget.distance - cam.distance) * a;
        cam.targetY += (camTarget.targetY - cam.targetY) * a;
      }
      // Narrow containers dolly out just enough to keep the head/hair
      // clear sideways; the canonical framing (zoom state, pill matching)
      // is untouched — this only widens the rendered frame when needed.
      const renderDist = compensateDistance(cam.distance, aspectRef.current);
      const pos = cameraPositionFor({ distance: renderDist, targetY: cam.targetY });
      camera.position.set(pos.x, pos.y, pos.z);
      camera.lookAt(0, cam.targetY, 0);

      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      // Re-arm the opening-frame snap so a StrictMode-style remount (or any
      // re-run of this effect) re-derives framing from the live container.
      firstFrameRef.current = true;
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      rigRef.current = null;
      onApiRef.current(null);
      const fig = figureRef.current;
      figureRef.current = null;
      if (fig) disposeFigure(fig);
      disc.geometry.dispose();
      (disc.material as THREE.Material).dispose();
      spotTex.dispose();
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
      renderer.dispose();
      if (el.parentNode === mount) mount.removeChild(el);
    };
  }, []);

  return (
      <div
        ref={mountRef}
        className="eko-studio__preview"
        aria-label="3D preview — drag to spin, pinch or scroll to zoom"
      >
        <div className="eko-studio__framing" role="group" aria-label="Camera framing">
          <button
            type="button"
            className={`eko-studio__framebtn glass${activePreset === "face" ? " eko-studio__framebtn--active" : ""}`}
            onClick={() => goPreset("face")}
            aria-pressed={activePreset === "face"}
          >
            Face
          </button>
          <button
            type="button"
            className={`eko-studio__framebtn glass${activePreset === "body" ? " eko-studio__framebtn--active" : ""}`}
            onClick={() => goPreset("body")}
            aria-pressed={activePreset === "body"}
          >
            Full body
          </button>
          <button
            type="button"
            className="eko-studio__framebtn eko-studio__framebtn--ghost glass"
            onClick={() => rigRef.current?.goPreset("body")}
            title="Reset the camera to the default full-body view"
          >
            Reset view
          </button>
        </div>
        {zoomHint && (
          <div className="eko-studio__zoomhint glass" aria-hidden="true">
            Pinch or scroll to zoom
          </div>
        )}
        {glFailed && (
          <p className="eko-studio__nogl">
            3D preview isn't available on this device — your picks below still work.
          </p>
        )}
      </div>
  );
}
