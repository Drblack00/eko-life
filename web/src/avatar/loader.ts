/**
 * Èkó Life Avatar Engine — async avatar loading (Milestone 4).
 *
 * `AvatarLoader` wraps the synchronous assembler with:
 * - Staged async builds: the loader yields to the event loop between
 *   stages (resolve → body → head/hair → finalize) so the UI stays
 *   responsive. Procedural builds are fast, so progress reporting is
 *   honest about the stages rather than fake byte counts.
 * - Request-ID stale guard: rapid successive `load()` calls resolve with
 *   only the LATEST result delivered; earlier in-flight builds are
 *   disposed and their promises resolve with `discarded: true` (never
 *   applied to the scene by this loader).
 * - Dedup: concurrent `load()` calls for an identical appearance share
 *   one in-flight build.
 * - Fallbacks: invalid input → DEFAULT_APPEARANCE_V1; builder/asset
 *   failures degrade per the assembler's policy. `load()` never rejects
 *   with a broken scene — the last-resort catch builds the default
 *   appearance, and only a catastrophic failure rejects.
 * - `swap()`: keeps the old character visible until the new build is
 *   ready, then swaps (preserving the old transform) and disposes the old.
 * - `diffUpdate()`: minimal in-place updates via the assembler.
 *
 * CLIENT-ONLY: imports three.js types + the assembler. Not in `./index.ts`.
 */

import type { AppearanceV1 } from "./schema";
import {
  beginStagedAssembly,
  buildStagedBody,
  buildStagedHead,
  diffUpdateAssembled,
  disposeObjects,
  finishStagedAssembly,
  type AssembledAvatar,
  type AssembledAvatarInternal,
  type AvatarRig,
  type DiffSummary,
  type StagedAssembly,
} from "./assembler";
import {
  DEFAULT_APPEARANCE_V1,
  validateAppearance,
} from "./validation";

export type LoadStage = "resolve" | "body" | "head" | "finalize";

export interface LoadOptions {
  onProgress?: (stage: LoadStage, fraction: number) => void;
  /** Override the prefers-reduced-motion check. */
  reducedMotion?: boolean;
}

export interface AvatarHandle extends AssembledAvatar {
  /** True when a newer load() superseded this request — never applied. */
  discarded: boolean;
}

function cloneDefault(): AppearanceV1 {
  return JSON.parse(JSON.stringify(DEFAULT_APPEARANCE_V1)) as AppearanceV1;
}

const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));

export class AvatarLoader {
  private seq = 0;
  private latest = 0;
  private inflight = new Map<string, { id: number; promise: Promise<AvatarHandle> }>();
  private internals = new WeakMap<AvatarHandle, AssembledAvatarInternal>();

  /** Diagnostics (tests): builds started vs discarded by the stale guard. */
  readonly stats = { buildsStarted: 0, buildsDiscarded: 0 };

  constructor(
    private readonly T: typeof import("three"),
    private readonly opts: { reducedMotion?: boolean } = {}
  ) {}

  /**
   * Load (build) an avatar for `appearance`. Invalid input falls back to
   * DEFAULT_APPEARANCE_V1 with a note — never rejects with a broken scene.
   */
  load(appearance: unknown, opts: LoadOptions = {}): Promise<AvatarHandle> {
    const validated = validateAppearance(appearance);
    const app = validated.ok && validated.appearance ? validated.appearance : cloneDefault();
    const notes: string[] = validated.ok
      ? []
      : [
          `invalid appearance (${validated.errors.join("; ")}); ` +
            `using DEFAULT_APPEARANCE_V1`,
        ];

    // Dedup: concurrent identical requests share one in-flight build.
    // The key is the canonical validated appearance (fixed key order).
    const key = JSON.stringify(app);
    const existing = this.inflight.get(key);
    if (existing) return existing.promise;

    const id = ++this.seq;
    this.latest = id;
    this.stats.buildsStarted++;
    const promise = this.buildStaged(id, app, notes, opts).finally(() => {
      const cur = this.inflight.get(key);
      if (cur && cur.id === id) this.inflight.delete(key);
    });
    this.inflight.set(key, { id, promise });
    return promise;
  }

  private async buildStaged(
    id: number,
    app: AppearanceV1,
    notes: string[],
    opts: LoadOptions
  ): Promise<AvatarHandle> {
    const T = this.T;
    const onProgress = opts.onProgress;
    const stale = () => id !== this.latest;

    const discardedHandle = (reason: string): AvatarHandle => {
      this.stats.buildsDiscarded++;
      const group = new T.Group();
      const handle: AvatarHandle = {
        group,
        rig: {
          upper: new T.Group(),
          torso: new T.Mesh(),
          head: new T.Group(),
          armL: new T.Group(),
          armR: new T.Group(),
          eyeL: new T.Group(),
          eyeR: new T.Group(),
          lidL: new T.Group(),
          lidR: new T.Group(),
          legL: new T.Group(),
          legR: new T.Group(),
          baseArmLX: 0,
          baseArmRX: 0,
          baseArmLZ: 0,
          baseArmRZ: 0,
          baseLegLX: 0,
          baseLegRX: 0,
          baseUpperY: 0,
        } satisfies AvatarRig,
        appearance: app,
        notes: [...notes, reason],
        morphStatus: {} as AvatarHandle["morphStatus"],
        update: undefined,
        discarded: true,
        dispose() {},
      };
      return handle;
    };

    // Stage: resolve — asset resolution + materials (synchronous).
    onProgress?.("resolve", 0);
    await yieldToUI();
    if (stale()) {
      return discardedHandle("discarded: superseded by a newer load() before resolve");
    }

    let staged: StagedAssembly;
    try {
      staged = beginStagedAssembly(T, app, notes);
    } catch (err) {
      // Last resort: the default appearance is self-consistent; if even
      // that fails, the error propagates (callers keep their old figure).
      notes.push(
        `resolve failed (${err instanceof Error ? err.message : String(err)}); ` +
          `retrying with DEFAULT_APPEARANCE_V1`
      );
      staged = beginStagedAssembly(T, cloneDefault(), notes);
    }

    // Stage: body — skin body + garments.
    onProgress?.("body", 0.3);
    await yieldToUI();
    if (stale()) {
      return discardedHandle("discarded: superseded by a newer load() before body");
    }
    try {
      buildStagedBody(staged);
    } catch (err) {
      notes.push(
        `body stage failed (${err instanceof Error ? err.message : String(err)}); ` +
          `retrying with DEFAULT_APPEARANCE_V1`
      );
      disposeObjects([staged.group]);
      staged = beginStagedAssembly(T, cloneDefault(), notes);
      buildStagedBody(staged);
    }

    // Stage: head/hair — head, hair, facial hair.
    onProgress?.("head", 0.65);
    await yieldToUI();
    if (stale()) {
      disposeObjects([staged.group]);
      return discardedHandle("discarded: superseded by a newer load() after body");
    }
    buildStagedHead(staged);

    // Stage: finalize — rig, idle update, disposal wiring.
    onProgress?.("finalize", 0.9);
    await yieldToUI();
    if (stale()) {
      disposeObjects([staged.group]);
      return discardedHandle("discarded: superseded by a newer load() before finalize");
    }
    const assembled: AssembledAvatarInternal = finishStagedAssembly(staged, {
      reducedMotion: opts.reducedMotion ?? this.opts.reducedMotion,
    });

    const handle: AvatarHandle = {
      ...assembled,
      notes: [...assembled.notes, ...notes],
      discarded: false,
    };
    this.internals.set(handle, assembled);
    onProgress?.("finalize", 1);
    return handle;
  }

  /**
   * Build a new avatar for `appearance` while `old` stays visible; swap
   * them (preserving the old transform) once ready, then dispose the old.
   * If this swap is superseded by a newer load, the old handle is left
   * untouched and the discarded handle is returned.
   */
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
      this.internals.delete(old);
    }
    return built;
  }

  /**
   * Minimal in-place update of a live handle from oldAppearance to
   * newAppearance. Returns what was touched. Invalid new appearances
   * rebuild to the default rather than breaking the scene.
   */
  diffUpdate(
    handle: AvatarHandle,
    oldAppearance: AppearanceV1,
    newAppearance: unknown
  ): DiffSummary {
    const internal = this.internals.get(handle);
    if (!internal || handle.discarded) {
      return {
        rebuilt: false,
        touched: [],
        notes: ["diffUpdate: unknown or discarded handle — no-op"],
      };
    }
    const validated = validateAppearance(newAppearance);
    const newApp =
      validated.ok && validated.appearance ? validated.appearance : cloneDefault();
    const summary = diffUpdateAssembled(internal, oldAppearance, newApp);
    if (!validated.ok) {
      summary.notes.unshift(
        `new appearance invalid (${validated.errors.join("; ")}); rebuilt to default`
      );
    }
    handle.appearance = internal.appearance;
    handle.notes = internal.notes;
    return summary;
  }

  /** Dispose a handle built by this loader and forget its internals. */
  disposeHandle(handle: AvatarHandle): void {
    try {
      handle.dispose();
    } finally {
      this.internals.delete(handle);
    }
  }
}
