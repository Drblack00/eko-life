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
  getCachedAssets,
} from "./gltf/loader";
import { SKIN_TONES } from "./gltf/customizer";

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

/** Unused — GLTF hair styles removed. */

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
    // GLTF disabled — using lightweight cartoon avatar instead.
    // (loadAvatarAssets removed — was causing hangs/glitches)
    await yieldToUI();
    if (stale()) return discarded();

    const assets = getCachedAssets();
    const group = new T.Group();
    group.name = "CartoonAvatar";

    if (!assets) {
      notes.push("assets unavailable — empty figure");
      return { group, dispose: () => {}, appearance: app, notes, discarded: false };
    }

    onProgress?.("body", 0.3);
    // Build lightweight cartoon avatar (no GLTF)
    const skinColor = skinToHex(app);
    const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(skinColor), roughness: 0.7 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });
    const hairMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(hairColorToHex(app)), roughness: 0.8 });
    
    const addMesh = (geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, material);
      m.position.set(x, y, z);
      m.castShadow = true;
      group.add(m);
      return m;
    };
    
    // Body (capsule)
    addMesh(new THREE.CapsuleGeometry(0.24, 0.32, 6, 14), skinMat, 0, 0.78, 0);
    // Head (big sphere)
    addMesh(new THREE.SphereGeometry(0.24, 20, 16), skinMat, 0, 1.35, 0);
    // Hair cap
    addMesh(new THREE.SphereGeometry(0.245, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2.1), hairMat, 0, 1.37, 0);
    // Eyes
    for (const sx of [-0.09, 0.09]) {
      addMesh(new THREE.SphereGeometry(0.045, 12, 10), whiteMat, sx, 1.38, 0.2);
      addMesh(new THREE.SphereGeometry(0.02, 10, 8), blackMat, sx, 1.38, 0.24);
    }
    // Smile
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.015, 8, 16, Math.PI), blackMat);
    smile.position.set(0, 1.28, 0.21);
    smile.rotation.x = Math.PI;
    smile.rotation.z = Math.PI;
    group.add(smile);
    // Arms
    for (const sx of [-0.34, 0.34]) {
      addMesh(new THREE.CapsuleGeometry(0.08, 0.28, 4, 10), skinMat, sx, 0.78, 0);
    }
    // Legs
    for (const sx of [-0.13, 0.13]) {
      addMesh(new THREE.CapsuleGeometry(0.09, 0.3, 4, 10), skinMat, sx, 0.25, 0);
    }

    await yieldToUI();
    if (stale()) return discarded();

    onProgress?.("head", 0.65);
    // Customization already applied via materials above

    await yieldToUI();
    if (stale()) return discarded();

    onProgress?.("finalize", 0.9);
    // No animator needed for static cartoon avatar
    
    const dispose = () => {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material as THREE.Material | THREE.Material[];
          if (Array.isArray(m)) m.forEach(x => x.dispose());
          else m?.dispose();
        }
      });
    };

    onProgress?.("finalize", 1);
    return {
      group,
      update: () => {},
      dispose,
      appearance: app,
      notes,
      discarded: false,
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
