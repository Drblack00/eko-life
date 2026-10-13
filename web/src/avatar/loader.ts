/**
 * Èkó Life Avatar Engine — GLTF avatar loading.
 *
 * `AvatarLoader` builds avatars from the CC0 GLTF base characters
 * (Universal Base Characters) with retargeted animations
 * (Universal Animation Library, 46 clips).
 *
 * Interface preserved for AvatarEditor compatibility:
 * - load(appearance) → Promise<AvatarHandle>
 * - swap(), diffUpdate(), disposeHandle()
 */

import * as THREE from "three";
import type { AppearanceV1 } from "./schema";
import { DEFAULT_APPEARANCE_V1, validateAppearance } from "./validation";
import {
  loadAvatarAssets,
  getCachedAssets,
  cloneBody,
  type BodyType,
} from "./gltf/loader";
import { applyCustomization, SKIN_TONES } from "./gltf/customizer";
import { AvatarAnimator } from "./gltf/animator";

export type LoadStage = "resolve" | "body" | "head" | "finalize";

export interface LoadOptions {
  onProgress?: (stage: LoadStage, fraction: number) => void;
  reducedMotion?: boolean;
}

export interface AvatarHandle {
  group: THREE.Group;
  update?: (t: number, dt: number) => void;
  dispose: () => void;
  appearance: AppearanceV1;
  notes: string[];
  discarded: boolean;
  playAnim?: (name: string) => void;
}

function cloneDefault(): AppearanceV1 {
  return JSON.parse(JSON.stringify(DEFAULT_APPEARANCE_V1)) as AppearanceV1;
}

const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));

/** Maps AppearanceV1 skin tone id to hex. */
function skinToHex(app: AppearanceV1): string {
  const id = app.base?.skinToneId ?? "";
  // Try to find hex from catalog, fall back to mid-brown
  if (/^#[0-9a-f]{6}$/i.test(id)) return id;
  const lower = String(id).toLowerCase();
  if (lower.includes("light") || lower.includes("fair")) return SKIN_TONES[0];
  if (lower.includes("medium")) return SKIN_TONES[3];
  if (lower.includes("dark") || lower.includes("deep")) return SKIN_TONES[5];
  return "#8d5524";
}

/** Maps AppearanceV1 hair style id to GLTF hair style. */
function hairToStyle(app: AppearanceV1): "buns" | "long" | "buzzed" | "parted" | "buzzedFemale" | "none" {
  const id = String(app.hair?.styleId ?? "").toLowerCase();
  const body: BodyType = app.base?.bodyType === "feminine" ? "female" : "male";
  if (id.includes("bun")) return "buns";
  if (id.includes("long")) return "long";
  if (id.includes("buzz")) return body === "female" ? "buzzedFemale" : "buzzed";
  if (id.includes("part")) return "parted";
  if (id.includes("bald") || id.includes("none")) return "none";
  return body === "female" ? "long" : "buzzed";
}

/** Maps AppearanceV1 hair color id to hex. */
function hairColorToHex(app: AppearanceV1): string {
  const id = String(app.hair?.colorId ?? "").toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(id)) return id;
  if (id.includes("black") || id.includes("dark")) return "#1a1a1a";
  if (id.includes("brown")) return "#3b2a1a";
  if (id.includes("blonde") || id.includes("gold")) return "#a06a35";
  if (id.includes("grey") || id.includes("gray") || id.includes("white")) return "#d9d9d9";
  return "#1a1a1a";
}

export class AvatarLoader {
  private seq = 0;
  private latest = 0;
  private inflight = new Map<string, { id: number; promise: Promise<AvatarHandle> }>();

  readonly stats = { buildsStarted: 0, buildsDiscarded: 0 };

  constructor(private readonly T: typeof import("three")) {}

  load(appearance: unknown, opts: LoadOptions = {}): Promise<AvatarHandle> {
    const validated = validateAppearance(appearance);
    const app = validated.ok && validated.appearance ? validated.appearance : cloneDefault();
    const notes: string[] = validated.ok ? [] : [`invalid appearance; using default`];

    const key = JSON.stringify(app);
    const existing = this.inflight.get(key);
    if (existing) return existing.promise;

    const id = ++this.seq;
    this.latest = id;
    this.stats.buildsStarted++;
    const promise = this.build(id, app, notes, opts).finally(() => {
      const cur = this.inflight.get(key);
      if (cur && cur.id === id) this.inflight.delete(key);
    });
    this.inflight.set(key, { id, promise });
    return promise;
  }

  private async build(
    id: number,
    app: AppearanceV1,
    notes: string[],
    opts: LoadOptions
  ): Promise<AvatarHandle> {
    const T = this.T;
    const onProgress = opts.onProgress;
    const stale = () => id !== this.latest;

    const discarded = (): AvatarHandle => {
      this.stats.buildsDiscarded++;
      return {
        group: new T.Group(),
        dispose: () => {},
        appearance: app,
        notes: [...notes, "discarded: superseded"],
        discarded: true,
      };
    };

    onProgress?.("resolve", 0);
    // Ensure GLTF assets are loaded
    try {
      await loadAvatarAssets();
    } catch {
      notes.push("avatar assets failed to load");
    }
    await yieldToUI();
    if (stale()) return discarded();

    const assets = getCachedAssets();
    const group = new T.Group();
    group.name = "GltfAvatar";

    if (!assets) {
      notes.push("assets unavailable — empty figure");
      return { group, dispose: () => {}, appearance: app, notes, discarded: false };
    }

    onProgress?.("body", 0.3);
    const body: BodyType = app.base?.bodyType === "feminine" ? "female" : "male";
    const bodyModel = cloneBody(body);
    if (!bodyModel) {
      notes.push("body clone failed");
      return { group, dispose: () => {}, appearance: app, notes, discarded: false };
    }

    // Ground the model
    const box = new THREE.Box3().setFromObject(bodyModel);
    const height = box.max.y - box.min.y;
    bodyModel.scale.setScalar(1.7 / height);
    const box2 = new THREE.Box3().setFromObject(bodyModel);
    bodyModel.position.y -= box2.min.y;

    await yieldToUI();
    if (stale()) return discarded();

    onProgress?.("head", 0.65);
    // Apply customization
    const hasBeard = String(app.hair?.facialHairId ?? "").toLowerCase().includes("beard");
    applyCustomization(bodyModel, {
      body,
      skinTone: skinToHex(app),
      hair: hairToStyle(app),
      hairColor: hairColorToHex(app),
      beard: hasBeard,
      eyebrows: true,
      fistsClenched: true,
    });

    await yieldToUI();
    if (stale()) return discarded();

    onProgress?.("finalize", 0.9);
    // Animator for on-demand animations (walk, dance, etc.).
    // Default pose is the static relaxed stance from applyCustomization
    // (arms at sides, fists clenched) — no auto-play, so a broken clip
    // can never fight the static pose back to T-pose.
    const animator = new AvatarAnimator(bodyModel);

    group.add(bodyModel);

    let lastT = performance.now() / 1000;
    const update = (t: number, dt: number) => {
      const now = t || performance.now() / 1000;
      const delta = dt || Math.min(0.05, now - lastT);
      lastT = now;
      animator.update(delta);
    };

    const playAnim = (name: string) => animator.play(name);

    const dispose = () => {
      animator.dispose();
      bodyModel.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    };

    onProgress?.("finalize", 1);
    return {
      group,
      update,
      dispose,
      appearance: app,
      notes,
      discarded: false,
      playAnim,
    };
  }

  async swap(
    old: AvatarHandle | null,
    appearance: unknown,
    opts: LoadOptions = {}
  ): Promise<AvatarHandle> {
    const built = await this.load(appearance, opts);
    if (built.discarded) return built;
    if (old && !old.discarded) {
      built.group.position.copy(old.group.position);
      built.group.rotation.copy(old.group.rotation);
      built.group.scale.copy(old.group.scale);
      const parent = old.group.parent;
      if (parent) {
        parent.add(built.group);
        parent.remove(old.group);
      }
      old.dispose();
    }
    return built;
  }

  diffUpdate(
    _handle: AvatarHandle,
    _oldAppearance: AppearanceV1,
    _newAppearance: unknown
  ): { rebuilt: boolean; touched: string[]; notes: string[] } {
    // GLTF: simplest correct behavior is rebuild via swap.
    // Return "rebuilt" so callers use swap().
    return {
      rebuilt: true,
      touched: ["all"],
      notes: ["gltf loader: diffUpdate triggers rebuild"],
    };
  }

  disposeHandle(handle: AvatarHandle): void {
    try {
      handle.dispose();
    } catch {
      /* noop */
    }
  }
}
