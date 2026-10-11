/**
 * Èkó Life avatar studio — editor state machine (Milestone 5).
 *
 * Three states, honestly separated:
 *   saved    — last server-confirmed appearance (+ revision).
 *   draft    — the user's unsaved edits (a single canonical v1 object;
 *              every edit is field-level, so changing clothing can never
 *              reset skin/hair/face).
 *   rendered — the appearance last handed to the 3D renderer
 *              (via deps.renderInitial / deps.renderEdit).
 *
 * Rules enforced here (the React shell only renders this state):
 * - Edits are LOCAL until Save. No network on edit, no autosave, no
 *   per-slider request spam. renderEdit is synchronous and immediate.
 * - Save uses optimistic concurrency (expectedRev). 409 → conflict state:
 *   the draft is NEVER silently overwritten. The user picks "Load latest"
 *   (draft discarded) or "Keep editing" (revision refetched first, then
 *   they may re-save).
 * - 400 → field errors surfaced; network failure → draft kept, error
 *   shown, success never claimed.
 * - Cancel → draft = saved, rendered back to saved via renderEdit
 *   (no network unless the UI needs it — it doesn't; diffUpdate is local).
 * - Reset to default → draft = DEFAULT_APPEARANCE_V1 (characterId kept);
 *   still requires an explicit Save.
 *
 * Framework-free: no React, no DOM, no three.js. The constructor takes
 * injected deps so vitest can mock fetch + the loader. `emit` notifies
 * the React shell to re-render (a useState tick).
 */

import {
  AppearanceConflictError,
  AppearanceValidationError,
  fetchAppearance,
  saveAppearance,
} from "../../../avatar/persistence";
import { DEFAULT_APPEARANCE_V1 } from "../../../avatar/validation";
import type { AppearanceV1 } from "../../../avatar/schema";

export type EditorStatus =
  | "loading"
  | "ready"
  | "saving"
  | "conflict"
  | "error";

export interface EditorDeps {
  fetchAppearanceFn?: typeof fetchAppearance;
  saveAppearanceFn?: typeof saveAppearance;
  /**
   * First paint of the on-screen character. May be async (staged loader);
   * the machine does not await it — edits made while it is in flight are
   * delivered via renderEdit and the shell applies the latest draft once
   * the handle exists.
   */
  renderInitial: (app: AppearanceV1) => void;
  /**
   * Immediate local update, old → next. The shell implements this with
   * loader.diffUpdate (structural changes rebuild in place, still local).
   * Never throws across the machine boundary — the shell guards it; a
   * throw here is captured into `error` for honesty.
   */
  renderEdit: (prev: AppearanceV1 | null, next: AppearanceV1) => void;
}

export type DraftMutator = (draft: AppearanceV1) => void;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function same(a: AppearanceV1 | null, b: AppearanceV1 | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function defaultDraft(characterId: string): AppearanceV1 {
  const d = clone(DEFAULT_APPEARANCE_V1);
  d.characterId = characterId;
  return d;
}

/** Public mutable fields of the machine (what set() may patch). */
type MutableMachineState = Pick<
  AvatarEditorMachine,
  | "status"
  | "saved"
  | "draft"
  | "rendered"
  | "revision"
  | "dirty"
  | "savedFlash"
  | "conflictRevision"
  | "error"
  | "fieldErrors"
>;

export class AvatarEditorMachine {
  status: EditorStatus = "loading";
  /** Last server-confirmed appearance. */
  saved: AppearanceV1 | null = null;
  /** Unsaved edits. */
  draft: AppearanceV1 | null = null;
  /** Last appearance handed to the renderer. */
  rendered: AppearanceV1 | null = null;
  revision = 0;
  dirty = false;
  /** Transient "Saved ✓" confirmation (shell clears after a timeout). */
  savedFlash = false;
  /** 409 state: the server revision the PUT collided with. */
  conflictRevision: number | null = null;
  /** Non-field error (network, load failure, render failure). */
  error: string | null = null;
  /** 400 field errors from the server. */
  fieldErrors: string[] = [];

  private characterId = "";
  private loadToken = 0;
  private readonly deps: Required<EditorDeps>;

  constructor(deps: EditorDeps, private readonly emit: () => void) {
    this.deps = {
      fetchAppearanceFn: deps.fetchAppearanceFn ?? fetchAppearance,
      saveAppearanceFn: deps.saveAppearanceFn ?? saveAppearance,
      renderInitial: deps.renderInitial,
      renderEdit: deps.renderEdit,
    };
  }

  private set(patch: Partial<MutableMachineState>): void {
    Object.assign(this, patch);
    this.emit();
  }

  /* ------------------------------ open ------------------------------ */

  /**
   * Load the stored appearance (auto-migrated by persistence.ts) and
   * paint it. Rapid successive open() calls are stale-guarded: only the
   * latest fetch result is applied.
   */
  async open(characterId: string): Promise<void> {
    const token = ++this.loadToken;
    this.characterId = characterId;
    this.set({
      status: "loading",
      error: null,
      fieldErrors: [],
      conflictRevision: null,
      savedFlash: false,
    });
    try {
      const { appearance, revision } = await this.deps.fetchAppearanceFn(
        characterId
      );
      if (token !== this.loadToken) return; // superseded — drop silently
      const app = clone(appearance);
      this.deps.renderInitial(app);
      this.set({
        status: "ready",
        saved: clone(app),
        draft: clone(app),
        rendered: clone(app),
        revision,
        dirty: false,
      });
    } catch (e) {
      if (token !== this.loadToken) return;
      this.set({
        status: "error",
        error: errMessage(e),
      });
    }
  }

  /** Retry after a load failure. */
  retry(): Promise<void> {
    return this.open(this.characterId);
  }

  /* ------------------------------ edit ------------------------------ */

  /**
   * Apply a field-level edit to the draft and re-render immediately.
   * Synchronous, local-only — the UI never blocks on network here.
   * Returns false when no draft is loaded yet (edit dropped, not queued).
   */
  edit(mutator: DraftMutator): boolean {
    if (this.status === "loading" || !this.draft) return false;
    const prev = this.rendered;
    const next = clone(this.draft);
    mutator(next);
    // Keep the character id stable — edits never reassign ownership.
    next.characterId = this.characterId || next.characterId;
    this.draft = next;
    this.rendered = clone(next);
    this.dirty = !same(next, this.saved);
    this.savedFlash = false;
    this.error = null;
    try {
      this.deps.renderEdit(prev, next);
    } catch (e) {
      this.error = `Preview update failed: ${errMessage(e)}`;
    }
    this.emit();
    return true;
  }

  /* ------------------------------ save ------------------------------ */

  /**
   * Explicit save with optimistic concurrency. On success saved = draft
   * (server canonical), revision updated, "Saved" flashed. On 409 the
   * draft is preserved and conflict UI state is set — never overwritten.
   * On 400 the field errors are surfaced. On anything else the draft is
   * kept and the error shown; success is never claimed.
   */
  async save(): Promise<void> {
    if (
      this.status === "loading" ||
      this.status === "saving" ||
      !this.draft
    ) {
      return;
    }
    const snapshot = clone(this.draft);
    this.set({ status: "saving", error: null, fieldErrors: [] });
    try {
      const res = await this.deps.saveAppearanceFn(
        this.characterId,
        snapshot,
        this.revision
      );
      const canonical = clone(res.appearance);
      // The user may have kept editing mid-save: never clobber a newer
      // draft with the save response — only adopt it when the draft is
      // still the snapshot we sent.
      const draftUnchanged = same(this.draft, snapshot);
      this.set({
        status: "ready",
        saved: canonical,
        draft: draftUnchanged ? clone(canonical) : this.draft,
        revision: res.revision,
        dirty: draftUnchanged ? false : !same(this.draft, canonical),
        conflictRevision: null,
        savedFlash: true,
      });
    } catch (e) {
      if (e instanceof AppearanceConflictError) {
        // Draft preserved verbatim — the user decides what happens next.
        this.set({
          status: "conflict",
          conflictRevision: e.revision,
        });
      } else if (e instanceof AppearanceValidationError) {
        this.set({
          status: "error",
          fieldErrors: [...e.errors],
        });
      } else {
        this.set({
          status: "error",
          error: errMessage(e),
        });
      }
    }
  }

  /* --------------------------- conflict ----------------------------- */

  /**
   * "Load latest": discard the draft, adopt the server's current look.
   */
  async loadLatest(): Promise<void> {
    if (!this.characterId) return;
    this.set({ status: "loading", error: null });
    try {
      const { appearance, revision } = await this.deps.fetchAppearanceFn(
        this.characterId
      );
      const app = clone(appearance);
      const prev = this.rendered;
      this.rendered = clone(app);
      try {
        this.deps.renderEdit(prev, app);
      } catch (e) {
        this.error = `Preview update failed: ${errMessage(e)}`;
      }
      this.set({
        status: "ready",
        saved: clone(app),
        draft: clone(app),
        revision,
        dirty: false,
        conflictRevision: null,
        savedFlash: false,
      });
    } catch (e) {
      this.set({
        status: "error",
        error: errMessage(e),
      });
    }
  }

  /**
   * "Keep editing": dismiss the conflict, refetch the revision FIRST so
   * the next save carries a fresh expectedRev. The draft is untouched;
   * if the server moved again the next save 409s again (correct — never
   * silently overwrite).
   */
  async keepEditing(): Promise<void> {
    if (!this.characterId) return;
    this.set({ status: "loading", error: null });
    try {
      const { appearance, revision } = await this.deps.fetchAppearanceFn(
        this.characterId
      );
      const app = clone(appearance);
      this.set({
        status: "ready",
        saved: clone(app),
        revision,
        dirty: !same(this.draft, app),
        conflictRevision: null,
      });
    } catch (e) {
      this.set({
        status: "error",
        error: errMessage(e),
      });
    }
  }

  /* ---------------------------- cancel ------------------------------ */

  /**
   * Discard the draft: draft = saved, re-rendered locally via renderEdit.
   * No network.
   */
  cancel(): void {
    if (!this.saved) return;
    const prev = this.rendered;
    const back = clone(this.saved);
    this.draft = back;
    this.rendered = clone(back);
    this.dirty = false;
    this.savedFlash = false;
    this.conflictRevision = null;
    this.fieldErrors = [];
    this.error = null;
    try {
      this.deps.renderEdit(prev, back);
    } catch (e) {
      this.error = `Preview update failed: ${errMessage(e)}`;
    }
    if (this.status !== "ready") this.status = "ready";
    this.emit();
  }

  /* ------------------------- reset to default ------------------------ */

  /**
   * Draft = canonical default (characterId preserved). Still requires an
   * explicit Save — the UI confirms before calling this.
   */
  resetToDefault(): void {
    if (this.status === "loading") return;
    const prev = this.rendered;
    const d = defaultDraft(this.characterId);
    this.draft = d;
    this.rendered = clone(d);
    this.dirty = !same(d, this.saved);
    this.savedFlash = false;
    this.error = null;
    try {
      this.deps.renderEdit(prev, d);
    } catch (e) {
      this.error = `Preview update failed: ${errMessage(e)}`;
    }
    this.emit();
  }

  /* ------------------------------ misc ------------------------------- */

  clearSavedFlash(): void {
    if (this.savedFlash) this.set({ savedFlash: false });
  }

  clearError(): void {
    this.set({ error: null, fieldErrors: [] });
  }
}
