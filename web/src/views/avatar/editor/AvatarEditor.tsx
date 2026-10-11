/**
 * Èkó Life avatar studio — rebuilt editor (Milestone 5).
 *
 * Three honest states: saved (server-confirmed) / draft (unsaved edits) /
 * rendered (on-screen character, via AvatarLoader.diffUpdate — immediate,
 * local, never blocked on network).
 *
 * Workflow: open → fetchAppearance (auto-migrated) → loader.load() →
 * rendered = saved = draft. Edits update the draft + the preview instantly.
 * Save → PUT with expectedRev: 200 → saved = draft; 409 → conflict dialog
 * ("Your look was changed elsewhere", Load latest / Keep editing — the
 * draft is never silently overwritten); 400 → field errors; network
 * failure → draft kept, error shown, success never claimed. Cancel →
 * draft = saved, re-rendered locally. Reset to default → confirm dialog →
 * draft = DEFAULT_APPEARANCE_V1 (still needs an explicit Save).
 *
 * Categories (honesty rule — every control drives a real parameter):
 * Body / Skin / Hair / Clothing. Face is omitted (all 9 morphs are stubbed
 * in the assembler; only face_default_01 exists) and Accessories is omitted
 * (zero available accessory assets in the manifest) — see catalog.ts.
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { AvatarLoader, type AvatarHandle } from "../../../avatar/loader";
import {
  BODY_PRESET_TO_TYPE,
  type AppearanceV1,
  type BodyPresetId,
} from "../../../avatar/schema";
import { AvatarEditorMachine, type DraftMutator } from "./editorMachine";
import { StudioPreview, type StudioPreviewApi } from "./StudioPreview";
import { PillRow, SwatchRow } from "./controls";
import {
  BODY_OPTIONS,
  BOTTOM_COLOR_OPTIONS,
  EDITOR_CATEGORIES,
  FABRIC_OPTIONS,
  FACIAL_HAIR_OPTIONS,
  HAIR_COLOR_OPTIONS,
  HAIR_STYLE_OPTIONS,
  OUTFIT_ROWS,
  SKIN_TONE_OPTIONS,
  TOP_COLOR_OPTIONS,
  applyOutfitRow,
  outfitRowForClothing,
  type EditorCategory,
  type OutfitRow,
} from "./catalog";

export function AvatarEditor({
  characterId,
  compact,
  onSaved,
}: {
  characterId: string;
  compact?: boolean;
  onSaved?: (appearance: AppearanceV1) => void;
}) {
  const [, setTick] = useState(0);
  const [tab, setTab] = useState<EditorCategory>("body");
  const [confirmResetDefault, setConfirmResetDefault] = useState(false);
  const machineRef = useRef<AvatarEditorMachine | null>(null);
  const loaderRef = useRef<AvatarLoader | null>(null);
  const apiRef = useRef<StudioPreviewApi | null>(null);
  const handleRef = useRef<AvatarHandle | null>(null);
  const pendingRef = useRef<AppearanceV1 | null>(null);
  const loadTokenRef = useRef(0);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  /* Machine + loader lifecycle. */
  useEffect(() => {
    const loader = new AvatarLoader(THREE, {});
    loaderRef.current = loader;
    const machine = new AvatarEditorMachine(
      {
        renderInitial: (app) => {
          const token = ++loadTokenRef.current;
          void loader
            .load(app)
            .then((h) => {
              if (h.discarded || token !== loadTokenRef.current) {
                loader.disposeHandle(h);
                return;
              }
              apiRef.current?.setFigure({
                group: h.group,
                update: h.update,
                dispose: () => loader.disposeHandle(h),
              });
              handleRef.current = h;
              // Edits that landed while the staged build was in flight:
              // apply the latest draft now (diffUpdate from what loaded).
              const pending = pendingRef.current;
              pendingRef.current = null;
              if (
                pending &&
                JSON.stringify(pending) !== JSON.stringify(h.appearance)
              ) {
                loader.diffUpdate(h, h.appearance, pending);
              }
            })
            .catch(() => {
              /* loader never rejects with a broken scene; last-resort
                 catch keeps the studio usable without the figure. */
            });
        },
        renderEdit: (_prev, next) => {
          const h = handleRef.current;
          if (!h || h.discarded) {
            // Initial build still in flight — stash; renderInitial's
            // completion handler applies the latest stashed draft.
            pendingRef.current = next;
            return;
          }
          loader.diffUpdate(h, h.appearance, next);
        },
      },
      () => setTick((t) => t + 1)
    );
    machineRef.current = machine;
    void machine.open(characterId);
    // DEV-only hook for the screenshot harness (never in production).
    if (import.meta.env.DEV) {
      (window as unknown as { __avatarEditor?: unknown }).__avatarEditor = {
        machine,
        previewApi: () => apiRef.current,
      };
    }
    return () => {
      loadTokenRef.current++;
      const h = handleRef.current;
      handleRef.current = null;
      if (h) loader.disposeHandle(h);
      machineRef.current = null;
      loaderRef.current = null;
      if (import.meta.env.DEV) {
        delete (window as unknown as { __avatarEditor?: unknown })
          .__avatarEditor;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  const machine = machineRef.current;

  // "Saved ✓" confirmation clears itself after a few seconds.
  useEffect(() => {
    if (!machine?.savedFlash) return;
    const t = setTimeout(() => machine.clearSavedFlash(), 2600);
    return () => clearTimeout(t);
  }, [machine, machine?.savedFlash]);

  // Parent notification on confirmed save (savedFlash flips true once).
  useEffect(() => {
    if (machine?.savedFlash && machine.saved) {
      onSavedRef.current?.(machine.saved);
    }
  }, [machine, machine?.savedFlash]);

  const edit = (mut: DraftMutator) => machine?.edit(mut);
  const saving = machine?.status === "saving";
  const loading = !machine || machine.status === "loading";
  const draft = machine?.draft ?? null;
  const activeRow: OutfitRow | null = draft
    ? outfitRowForClothing(draft.clothing)
    : null;

  const doSave = () => void machine?.save();
  const doCancel = () => machine?.cancel();

  return (
    <div className={`eko-studio${compact ? " eko-studio--compact" : ""}`}>
      <StudioPreview
        onApi={(api) => {
          apiRef.current = api;
        }}
      />

      {/* Status regions */}
      {loading && (
        <div className="eko-studio__loading" role="status">
          <span className="eko-studio__spinner" aria-hidden="true" />
          Loading your look…
        </div>
      )}
      {machine?.error && (
        <div className="eko-studio__error" role="alert">
          <span>{machine.error}</span>
          <button
            type="button"
            className="eko-studio__errorbtn"
            onClick={() => void machine.retry()}
          >
            Retry
          </button>
          <button
            type="button"
            className="eko-studio__errorbtn"
            onClick={() => machine.clearError()}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}
      {machine && machine.fieldErrors.length > 0 && (
        <div className="eko-studio__error" role="alert">
          <div>
            <strong>Couldn't save — fix these:</strong>
            <ul>
              {machine.fieldErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            className="eko-studio__errorbtn"
            onClick={() => machine.clearError()}
            aria-label="Dismiss errors"
          >
            ✕
          </button>
        </div>
      )}

      {/* Category tabs */}
      {draft && (
        <>
          <div
            className="eko-studio__tabs"
            role="tablist"
            aria-label="Appearance categories"
          >
            {EDITOR_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={tab === c.id}
                className={`eko-studio__tab glass${tab === c.id ? " eko-studio__tab--active" : ""}`}
                onClick={() => setTab(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>

          <div role="tabpanel" aria-label={`${tab} options`}>
            {tab === "body" && (
              <PillRow
                label="Body"
                items={BODY_OPTIONS}
                value={draft.base.bodyPresetId}
                onPick={(id) =>
                  edit((d) => {
                    const preset = id as BodyPresetId;
                    d.base.bodyPresetId = preset;
                    d.base.bodyType = BODY_PRESET_TO_TYPE[preset];
                  })
                }
              />
            )}

            {tab === "skin" && (
              <SwatchRow
                label="Skin tone"
                colors={SKIN_TONE_OPTIONS}
                value={draft.base.skinToneId}
                onPick={(id) =>
                  edit((d) => {
                    d.base.skinToneId = id as AppearanceV1["base"]["skinToneId"];
                  })
                }
              />
            )}

            {tab === "hair" && (
              <>
                <PillRow
                  label="Hairstyle"
                  items={HAIR_STYLE_OPTIONS}
                  value={draft.hair.styleId}
                  onPick={(id) =>
                    edit((d) => {
                      d.hair.styleId = id as AppearanceV1["hair"]["styleId"];
                    })
                  }
                />
                <SwatchRow
                  label="Hair colour"
                  colors={HAIR_COLOR_OPTIONS}
                  value={draft.hair.colorId}
                  onPick={(id) =>
                    edit((d) => {
                      d.hair.colorId = id as AppearanceV1["hair"]["colorId"];
                    })
                  }
                />
                <PillRow
                  label="Facial hair"
                  items={FACIAL_HAIR_OPTIONS}
                  value={draft.hair.facialHairId}
                  onPick={(id) =>
                    edit((d) => {
                      d.hair.facialHairId =
                        id as AppearanceV1["hair"]["facialHairId"];
                    })
                  }
                />
              </>
            )}

            {tab === "clothing" && (
              <>
                <div className="eko-studio__row glass">
                  <span className="eko-studio__label">Outfit</span>
                  <div
                    className="eko-studio__outfits"
                    role="radiogroup"
                    aria-label="Outfit"
                  >
                    {OUTFIT_ROWS.map((row) => (
                      <button
                        key={row.outfitId}
                        type="button"
                        role="radio"
                        aria-checked={activeRow?.outfitId === row.outfitId}
                        className={`eko-studio__outfit glass${activeRow?.outfitId === row.outfitId ? " eko-studio__outfit--active" : ""}`}
                        onClick={() => edit((d) => Object.assign(d, applyOutfitRow(d, row)))}
                      >
                        <span className="eko-studio__outfitname">
                          {row.name}
                        </span>
                        <span className="eko-studio__outfitcaption">
                          {row.caption}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="eko-studio__caption">
                    Shoes are matched to the outfit — Casual, Hoodie and Chill
                    come with sneakers, Office with oxfords, Site work with
                    boots.
                    {!activeRow &&
                      " This combination has no exact outfit match, so it renders as Casual."}
                  </p>
                </div>
                <PillRow
                  label="Fabric"
                  items={FABRIC_OPTIONS}
                  value={draft.clothing.fabricId}
                  onPick={(id) =>
                    edit((d) => {
                      d.clothing.fabricId =
                        id as AppearanceV1["clothing"]["fabricId"];
                    })
                  }
                />
                <SwatchRow
                  label="Top colour"
                  colors={TOP_COLOR_OPTIONS}
                  value={draft.clothing.topColor}
                  onPick={(id) =>
                    edit((d) => {
                      d.clothing.topColor = id;
                    })
                  }
                />
                <SwatchRow
                  label="Bottom colour"
                  colors={BOTTOM_COLOR_OPTIONS}
                  value={draft.clothing.bottomColor}
                  onPick={(id) =>
                    edit((d) => {
                      d.clothing.bottomColor = id;
                    })
                  }
                />
              </>
            )}
          </div>
        </>
      )}

      {/* Footer: unsaved indicator + actions */}
      <div className="eko-studio__statusline" aria-live="polite">
        {machine?.dirty && !loading && (
          <span className="eko-studio__unsaved">
            <span className="eko-studio__dot" aria-hidden="true" />
            Unsaved changes
          </span>
        )}
        {machine?.savedFlash && (
          <span className="eko-studio__savedflash">Saved ✓</span>
        )}
      </div>
      <div className="eko-studio__footer">
        <button
          type="button"
          className="eko-studio__reset"
          onClick={doCancel}
          disabled={!machine || !machine.dirty || saving || loading}
          title="Discard unsaved changes and go back to your saved look"
        >
          Cancel
        </button>
        <button
          type="button"
          className="eko-studio__reset"
          onClick={() => setConfirmResetDefault(true)}
          disabled={!machine || saving || loading}
          title="Start over from the default look (you still need to save)"
        >
          Default
        </button>
        <button
          type="button"
          className="eko-studio__save glass"
          disabled={!machine || !machine.dirty || saving || loading}
          onClick={doSave}
        >
          {saving ? "Saving…" : "Save look"}
        </button>
      </div>

      {/* Conflict dialog: "Your look was changed elsewhere" */}
      {machine?.status === "conflict" && (
        <div className="eko-studio__dialogwrap">
          <div
            className="eko-studio__dialog glass"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="eko-conflict-title"
            aria-describedby="eko-conflict-desc"
          >
            <h3 id="eko-conflict-title">Your look was changed elsewhere</h3>
            <p id="eko-conflict-desc">
              Someone (or another device) saved a different look after you
              opened the studio. Your unsaved changes are safe — pick what to
              do next.
            </p>
            <div className="eko-studio__dialogbtns">
              <button
                type="button"
                className="eko-studio__dialogbtn"
                onClick={() => void machine.loadLatest()}
              >
                Load latest
                <span className="eko-studio__dialogsub">
                  Discard my changes, use the newest look
                </span>
              </button>
              <button
                type="button"
                className="eko-studio__dialogbtn eko-studio__dialogbtn--primary"
                onClick={() => void machine.keepEditing()}
              >
                Keep editing
                <span className="eko-studio__dialogsub">
                  Keep my changes — I'll review and save again
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset-to-default confirm */}
      {confirmResetDefault && (
        <div className="eko-studio__dialogwrap">
          <div
            className="eko-studio__dialog glass"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="eko-reset-title"
            aria-describedby="eko-reset-desc"
          >
            <h3 id="eko-reset-title">Reset to the default look?</h3>
            <p id="eko-reset-desc">
              Your current edits will be replaced with the default look.
              Nothing is saved until you press Save look.
            </p>
            <div className="eko-studio__dialogbtns">
              <button
                type="button"
                className="eko-studio__dialogbtn"
                onClick={() => setConfirmResetDefault(false)}
              >
                Keep my look
              </button>
              <button
                type="button"
                className="eko-studio__dialogbtn eko-studio__dialogbtn--primary"
                onClick={() => {
                  setConfirmResetDefault(false);
                  machine?.resetToDefault();
                }}
              >
                Reset to default
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
