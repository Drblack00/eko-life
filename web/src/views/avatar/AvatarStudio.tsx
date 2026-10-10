import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { buildAvatarLook } from "./avatarModel";
import type { AvatarLook, AvatarLookOptions } from "../../game/types";
import {
  BODY_PRESET,
  DEFAULT_FRAMING,
  FACE_PRESET,
  clampZoom,
  easeInOutCubic,
  matchesPreset,
  targetYForDistance,
  cameraPositionFor,
  type CameraFraming,
} from "./parts/studio";
import "./AvatarStudio.css";

/**
 * M20 avatar studio (workstream 3): studio-grade Three.js preview —
 * 3-point lighting, soft shadows, drag-to-spin, pinch/wheel zoom, and
 * Face / Full-body camera presets — above the option sections.
 * Staged save — nothing leaves the client until onSave(current) is called.
 */

interface StudioProps {
  initial: AvatarLook;
  options: AvatarLookOptions;
  onSave: (look: AvatarLook) => void;
  saving?: boolean;
  compact?: boolean;
}

const key = (l: AvatarLook) => JSON.stringify(l);

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

export function AvatarStudio({ initial, options, onSave, saving, compact }: StudioProps) {
  const [look, setLook] = useState<AvatarLook>(initial);
  // Re-base when the parent hands us a new initial (e.g. after a save).
  const [baseKey, setBaseKey] = useState(key(initial));
  const ik = key(initial);
  if (ik !== baseKey) {
    setBaseKey(ik);
    setLook(initial);
  }
  const dirty = key(look) !== baseKey;

  const mountRef = useRef<HTMLDivElement>(null);
  const [glFailed, setGlFailed] = useState(false);
  const [activePreset, setActivePreset] = useState<"face" | "body" | null>(null);
  const [zoomHint, setZoomHint] = useState(true);
  // Updater for the current figure's idle animation (blink, breathing, …).
  const updateRef = useRef<((t: number, dt: number) => void) | undefined>(
    undefined
  );
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
    goPreset: (p: "face" | "body") => void;
  } | null>(null);

  const goPreset = (p: "face" | "body") => rigRef.current?.goPreset(p);

  /* ---------- Three.js preview ---------- */
  // Mount effect: renderer, studio lighting, stage, camera rig, input.
  // Stashes the spinner group on the mount node so the rebuild effect below
  // can swap the figure.
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
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);

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
    (mount as unknown as { __spinner?: THREE.Group }).__spinner = spinner;

    /* Camera rig: spin the figure; zoom + presets move the camera. */
    const cam = camRef.current;
    const camTarget = camTargetRef.current;
    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    reduceMotionRef.current = reduceMotion;

    const syncPresetButton = () => {
      if (matchesPreset(camTarget, FACE_PRESET)) setActivePreset("face");
      else if (matchesPreset(camTarget, BODY_PRESET)) setActivePreset("body");
      else setActivePreset(null);
    };

    rigRef.current = {
      applyZoom: (distance: number) => {
        transitionRef.current = null;
        const d = clampZoom(distance);
        camTarget.distance = d;
        camTarget.targetY = targetYForDistance(d);
        setZoomHint(false);
        syncPresetButton();
      },
      goPreset: (p: "face" | "body") => {
        const preset = p === "face" ? FACE_PRESET : BODY_PRESET;
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

    /* Input: single-pointer drag spins; two-pointer pinch + wheel zoom. */
    let angle = 0.6;
    let target = 0.6;
    let dragging = false;
    let lastX = 0;
    let lastInteract = 0;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchStart: { pinch: number; dist: number } | null = null;
    const el = renderer.domElement;

    const pinchDist = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    const onDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      lastInteract = performance.now();
      if (pointers.size === 2) {
        // Second finger down: switch from spin to pinch.
        dragging = false;
        pinchStart = { pinch: pinchDist(), dist: camTarget.distance };
      } else if (pointers.size === 1) {
        dragging = true;
        lastX = e.clientX;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* noop */
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
      } else if (pointers.size === 1 && dragging) {
        target += (e.clientX - lastX) * 0.012;
        lastX = e.clientX;
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      lastInteract = performance.now();
      if (pointers.size === 0) {
        dragging = false;
        pinchStart = null;
      } else if (pointers.size === 1) {
        // Back to one finger: resume spin from the remaining pointer.
        pinchStart = null;
        const [rest] = [...pointers.values()];
        dragging = true;
        lastX = rest.x;
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
      const pos = cameraPositionFor(cam);
      camera.position.set(pos.x, pos.y, pos.z);
      camera.lookAt(0, cam.targetY, 0);

      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      rigRef.current = null;
      const old = spinner.children[0] as THREE.Group | undefined;
      if (old) (old.userData.dispose as (() => void) | undefined)?.();
      disc.geometry.dispose();
      (disc.material as THREE.Material).dispose();
      spotTex.dispose();
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
      renderer.dispose();
      if (el.parentNode === mount) mount.removeChild(el);
      delete (mount as unknown as { __spinner?: THREE.Group }).__spinner;
    };
  }, []);

  // Rebuild the figure whenever the look changes (cheap: a few dozen meshes).
  useEffect(() => {
    const mount = mountRef.current;
    const spinner = (mount as unknown as { __spinner?: THREE.Group } | null)?.__spinner;
    if (!spinner) return;
    const built = buildAvatarLook(look);
    built.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    const next = built.group;
    updateRef.current = built.update;
    const old = spinner.children[0] as THREE.Group | undefined;
    spinner.add(next);
    if (old) {
      spinner.remove(old);
      (old.userData.dispose as (() => void) | undefined)?.();
    }
  }, [look]);

  const pick = <K extends keyof AvatarLook>(field: K, value: AvatarLook[K]) =>
    setLook((prev) => (prev[field] === value ? prev : { ...prev, [field]: value }));

  return (
    <div className={`eko-studio${compact ? " eko-studio--compact" : ""}`}>
      <div
        ref={mountRef}
        className="eko-studio__preview"
        aria-label="3D preview — drag to spin, pinch or scroll to zoom"
      >
        <div className="eko-studio__framing" role="group" aria-label="Camera framing">
          <button
            type="button"
            className={`eko-studio__framebtn${activePreset === "face" ? " eko-studio__framebtn--active" : ""}`}
            onClick={() => goPreset("face")}
            aria-pressed={activePreset === "face"}
          >
            Face
          </button>
          <button
            type="button"
            className={`eko-studio__framebtn${activePreset === "body" ? " eko-studio__framebtn--active" : ""}`}
            onClick={() => goPreset("body")}
            aria-pressed={activePreset === "body"}
          >
            Full body
          </button>
        </div>
        {zoomHint && (
          <div className="eko-studio__zoomhint" aria-hidden="true">
            Pinch or scroll to zoom
          </div>
        )}
        {glFailed && (
          <p className="eko-studio__nogl">
            3D preview isn't available on this device — your picks below still work.
          </p>
        )}
      </div>

      <PillRow
        label="Body"
        items={options.bodies}
        value={look.body}
        onPick={(id) => pick("body", id as AvatarLook["body"])}
      />
      <PillRow
        label="Hairstyle"
        items={options.hairs}
        value={look.hair}
        onPick={(id) => pick("hair", id)}
      />
      <PillRow
        label="Outfit"
        items={options.outfits}
        value={look.outfit}
        onPick={(id) => pick("outfit", id)}
      />
      <PillRow
        label="Fabric"
        items={options.fabrics}
        value={look.fabric}
        onPick={(id) => pick("fabric", id)}
      />

      <SwatchRow
        label="Skin tone"
        colors={options.skins.map((s) => ({ id: s.id, hex: s.hex, name: s.name }))}
        value={look.skin}
        onPick={(id) => pick("skin", id)}
      />
      <SwatchRow
        label="Top colour"
        colors={options.topColors.map((c) => ({ id: c, hex: c, name: c }))}
        value={look.topColor}
        onPick={(id) => pick("topColor", id)}
      />
      <SwatchRow
        label="Bottom colour"
        colors={options.bottomColors.map((c) => ({ id: c, hex: c, name: c }))}
        value={look.bottomColor}
        onPick={(id) => pick("bottomColor", id)}
      />

      <div className="eko-studio__footer">
        <button
          type="button"
          className="eko-studio__reset"
          onClick={() => setLook(JSON.parse(baseKey) as AvatarLook)}
          disabled={!dirty || saving}
        >
          Reset
        </button>
        <button
          type="button"
          className="eko-studio__save"
          disabled={!dirty || saving}
          onClick={() => onSave(look)}
        >
          {saving ? "Saving…" : dirty ? "Save look" : "No changes yet"}
        </button>
      </div>
    </div>
  );
}

function PillRow({
  label,
  items,
  value,
  onPick,
}: {
  label: string;
  items: { id: string; name: string }[];
  value: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="eko-studio__row">
      <span className="eko-studio__label">{label}</span>
      <div className="eko-studio__pills" role="radiogroup" aria-label={label}>
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            role="radio"
            aria-checked={value === it.id}
            className={`eko-studio__pill${value === it.id ? " eko-studio__pill--active" : ""}`}
            onClick={() => onPick(it.id)}
          >
            {it.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function SwatchRow({
  label,
  colors,
  value,
  onPick,
}: {
  label: string;
  colors: { id: string; hex: string; name: string }[];
  value: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="eko-studio__row">
      <span className="eko-studio__label">{label}</span>
      <div className="eko-studio__swatches" role="radiogroup" aria-label={label}>
        {colors.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={value.toLowerCase() === c.id.toLowerCase()}
            aria-label={c.name}
            title={c.name}
            className={`eko-studio__swatch${value.toLowerCase() === c.id.toLowerCase() ? " eko-studio__swatch--active" : ""}`}
            style={{ backgroundColor: c.hex }}
            onClick={() => onPick(c.id)}
          />
        ))}
      </div>
    </div>
  );
}
