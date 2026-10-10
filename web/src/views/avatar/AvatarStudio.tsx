import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { buildAvatarLook } from "./avatarModel";
import type { AvatarLook, AvatarLookOptions } from "../../game/types";
import "./AvatarStudio.css";

/**
 * M15 avatar studio: Three.js preview (drag-to-spin) + option sections.
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
  // Updater for the current figure's idle animation (blink, breathing, …).
  const updateRef = useRef<((t: number, dt: number) => void) | undefined>(
    undefined
  );

  /* ---------- Three.js preview ---------- */
  // Mount effect: renderer, lights, stage. Stashes the spinner group on the
  // mount node so the rebuild effect below can swap the figure.
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
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
    camera.position.set(0, 1.1, 3.2);
    camera.lookAt(0, 0.95, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(2, 3.5, 2.5);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xbfdbfe, 0.5);
    fill.position.set(-2.5, 1.5, -1.5);
    scene.add(fill);

    // Ground disc the figure stands on.
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 40),
      new THREE.MeshStandardMaterial({ color: "#1e293b", roughness: 1 })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.001;
    scene.add(disc);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.68, 40),
      new THREE.MeshBasicMaterial({ color: "#22d3ee", transparent: true, opacity: 0.55 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.002;
    scene.add(ring);

    const spinner = new THREE.Group();
    scene.add(spinner);
    (mount as unknown as { __spinner?: THREE.Group }).__spinner = spinner;

    // Drag-to-spin with damped rotation.
    let angle = 0.6;
    let target = 0.6;
    let dragging = false;
    let lastX = 0;
    let lastInteract = 0;
    const el = renderer.domElement;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastInteract = performance.now();
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      target += (e.clientX - lastX) * 0.012;
      lastX = e.clientX;
      lastInteract = performance.now();
    };
    const onUp = () => {
      dragging = false;
      lastInteract = performance.now();
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);

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
    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.1);
      updateRef.current?.(clock.elapsedTime, dt);
      // Gentle auto-spin when the user hasn't touched it recently.
      if (!reduceMotion && !dragging && performance.now() - lastInteract > 3000)
        target += 0.004;
      angle += (target - angle) * 0.12;
      spinner.rotation.y = angle;
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
      const old = spinner.children[0] as THREE.Group | undefined;
      if (old) (old.userData.dispose as (() => void) | undefined)?.();
      disc.geometry.dispose();
      (disc.material as THREE.Material).dispose();
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
        aria-label="3D preview — drag to spin"
      >
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
