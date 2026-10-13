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
 * Face (eye colour, brow style — both honored) / Body / Skin / Hair /
 * Extras (procedural accessories) / Outfit. Face morph sliders stay
 * omitted (all 9 morphs are stubbed in the assembler).
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useToast } from "../../../components";
import { AvatarLoader, type AvatarHandle } from "../../../avatar/loader";
import { fetchAppearance } from "../../../avatar/persistence";
import { repairAppearanceV1 } from "../../../avatar/migrate";
import { boutiqueApi } from "../../../lib/api";
import { getToken } from "../../../lib/auth";
import { naira } from "../../../game/types";
import {
  BODY_PRESET_TO_TYPE,
  type AppearanceV1,
  type BodyPresetId,
} from "../../../avatar/schema";
import { AvatarEditorMachine, type DraftMutator } from "./editorMachine";
import { StudioPreview, type StudioPreviewApi } from "./StudioPreview";
import { PillRow, SwatchRow } from "./controls";
import {
  ACCESSORY_SLOT_OPTIONS,
  BODY_OPTIONS,
  BOTTOM_COLOR_OPTIONS,
  BROW_STYLE_OPTIONS,
  EDITOR_CATEGORIES,
  EYE_COLOR_OPTIONS,
  FABRIC_OPTIONS,
  facialHairOptionsForBody,
  HAIR_COLOR_OPTIONS,
  HAIR_STYLE_OPTIONS,
  OUTFIT_ROWS,
  SKIN_TONE_OPTIONS,
  TOP_COLOR_OPTIONS,
  accessoryIdForSlot,
  applyOutfitRow,
  outfitRowForClothing,
  setAccessorySlot,
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
  const [tab, setTab] = useState<EditorCategory>("face");
  const [confirmResetDefault, setConfirmResetDefault] = useState(false);
  // Defect 5: body/face switches trigger a full in-place rebuild
  // (rebuildInto — the head hangs off the body subtree, so a group swap
  // can't cover it). It blocks the main thread for seconds, so the shell
  // shows a spinner + disables the option controls while it runs.
  const [rebuilding, setRebuilding] = useState(false);
  const machineRef = useRef<AvatarEditorMachine | null>(null);
  const loaderRef = useRef<AvatarLoader | null>(null);
  const apiRef = useRef<StudioPreviewApi | null>(null);
  const handleRef = useRef<AvatarHandle | null>(null);
  const pendingRef = useRef<AppearanceV1 | null>(null);
  const loadTokenRef = useRef(0);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  // Serial render queue: structural rebuilds are deferred past two frames
  // so the spinner paints before the blocking work starts; edits that
  // land mid-rebuild coalesce to the latest draft.
  const renderQueueRef = useRef<AppearanceV1[]>([]);
  const renderBusyRef = useRef(false);
  const mountedRef = useRef(true);
  const { toast } = useToast();

  /* Phase 6: boutique wardrobe — premium outfit cards render locked
   * until owned. Fetched once on mount; a failed fetch just leaves
   * every premium card locked (never unlocked by default). */
  const [ownedBoutique, setOwnedBoutique] = useState<Set<string> | null>(null);
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    boutiqueApi
      .catalog(token)
      .then((res) => {
        if (cancelled) return;
        setOwnedBoutique(
          new Set(res.items.filter((i) => i.owned).map((i) => i.id))
        );
      })
      .catch(() => {
        if (!cancelled) setOwnedBoutique(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* Machine + loader lifecycle. */
  useEffect(() => {
    mountedRef.current = true;
    const loader = new AvatarLoader(THREE);
    loaderRef.current = loader;

    /** Structural switch (body/face preset, body type, or brow style —
     * the brow rebuilds the head subtree, which blocks like a body
     * rebuild) — mirrors the assembler's diffUpdateAssembled rebuild
     * conditions. */
    const isStructuralChange = (
      oldApp: AppearanceV1 | null,
      next: AppearanceV1
    ): boolean =>
      !oldApp ||
      oldApp.base.bodyPresetId !== next.base.bodyPresetId ||
      oldApp.base.facePresetId !== next.base.facePresetId ||
      oldApp.base.bodyType !== next.base.bodyType ||
      oldApp.base.browStyleId !== next.base.browStyleId;

    const pumpRenderQueue = () => {
      if (renderBusyRef.current) return;
      const next = renderQueueRef.current.shift();
      if (!next) return;
      const h = handleRef.current;
      const l = loaderRef.current;
      if (!h || h.discarded || !l) {
        // Initial build still in flight — stash; renderInitial's
        // completion handler applies the latest stashed draft.
        pendingRef.current = next;
        return;
      }
      renderBusyRef.current = true;
      const structural = isStructuralChange(h.appearance, next);
      const run = () => {
        const hh = handleRef.current;
        const ll = loaderRef.current;
        try {
          if (hh && !hh.discarded && ll) ll.diffUpdate(hh, hh.appearance, next);
        } finally {
          renderBusyRef.current = false;
          if (mountedRef.current) setRebuilding(false);
          // Drain edits that landed mid-rebuild (diffed from the fresh
          // handle appearance, so coalescing is exact).
          pumpRenderQueue();
        }
      };
      if (structural) {
        if (mountedRef.current) setRebuilding(true);
        // Let the spinner PAINT before the blocking rebuild starts.
        // rAF callbacks run before their frame's paint, so the work must
        // be deferred to a task after the paint: rAF (DOM flushed) →
        // rAF → setTimeout(0) (fires after the frame, paint included).
        // Without this the indicator's DOM updates but never reaches the
        // screen before the main thread blocks.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setTimeout(run, 0))
        );
      } else {
        run();
      }
    };
    const queueRender = (next: AppearanceV1) => {
      // Coalesce: only the latest draft matters; every run diffs from the
      // handle's current appearance.
      renderQueueRef.current = [next];
      pumpRenderQueue();
    };

    const machine = new AvatarEditorMachine(
      {
        // Defect 4: repair pre-compat-rule saves on load (feminine body
        // + facial hair → clean-shaven) before anything renders.
        fetchAppearanceFn: async (id: string) => {
          const res = await fetchAppearance(id);
          return {
            appearance: repairAppearanceV1(res.appearance),
            revision: res.revision,
          };
        },
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
              // apply the latest draft now (diffUpdate from what loaded),
              // through the render queue so structural ones get the
              // rebuild indicator like any other edit.
              const pending = pendingRef.current;
              pendingRef.current = null;
              if (
                pending &&
                JSON.stringify(pending) !== JSON.stringify(h.appearance)
              ) {
                queueRender(pending);
              }
            })
            .catch(() => {
              /* loader never rejects with a broken scene; last-resort
                 catch keeps the studio usable without the figure. */
            });
        },
        renderEdit: (_prev, next) => {
          queueRender(next);
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
      mountedRef.current = false;
      loadTokenRef.current++;
      renderQueueRef.current = [];
      renderBusyRef.current = false;
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

  // Save-confirmation toast (success AND failure): the machine records an
  // explicit outcome for every save attempt, so a failed save can never
  // claim success. Toasted exactly once, then cleared.
  const saveOutcomeAt = machine?.saveOutcome?.at;
  useEffect(() => {
    const outcome = machine?.saveOutcome;
    if (!outcome) return;
    toast(outcome.message, outcome.ok ? "success" : "error");
    machine.clearSaveOutcome();
  }, [machine, saveOutcomeAt, toast]);

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
        rebuilding={rebuilding}
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

          <div
            key={tab}
            role="tabpanel"
            aria-label={`${tab} options`}
            className="eko-studio__tabpanel"
          >
            {tab === "face" && (
              <>
                <SwatchRow
                  disabled={rebuilding}
                  label="Eye colour"
                  colors={EYE_COLOR_OPTIONS}
                  value={draft.base.eyeColorId}
                  onPick={(id) =>
                    edit((d) => {
                      d.base.eyeColorId = id as AppearanceV1["base"]["eyeColorId"];
                    })
                  }
                />
                <PillRow
                  disabled={rebuilding}
                  label="Eyebrows"
                  items={BROW_STYLE_OPTIONS}
                  value={draft.base.browStyleId}
                  onPick={(id) =>
                    edit((d) => {
                      d.base.browStyleId = id as AppearanceV1["base"]["browStyleId"];
                    })
                  }
                />
              </>
            )}

            {tab === "accessories" && (
              <>
                {ACCESSORY_SLOT_OPTIONS.map((slot) => (
                  <PillRow
                    key={slot.slot}
                    disabled={rebuilding}
                    label={slot.name}
                    items={slot.options}
                    value={accessoryIdForSlot(draft.accessories, slot.slot)}
                    onPick={(id) =>
                      edit((d) => {
                        const next = setAccessorySlot(d, slot.slot, id);
                        d.accessories = next.accessories;
                      })
                    }
                  />
                ))}
                <p className="eko-studio__caption">
                  Extras sit on your 3D figure — shades, a snapback, or hoops.
                  Mix and match; each slot holds one.
                </p>
              </>
            )}

            {tab === "body" && (
              <PillRow
                disabled={rebuilding}
                label="Body"
                items={BODY_OPTIONS}
                value={draft.base.bodyPresetId}
                onPick={(id) =>
                  edit((d) => {
                    const preset = id as BodyPresetId;
                    d.base.bodyPresetId = preset;
                    d.base.bodyType = BODY_PRESET_TO_TYPE[preset];
                    // Defect 4: facial hair is masculine-only — switching to
                    // the Woman body clears it so the draft can never hold
                    // (or save) the invalid combo.
                    if (
                      d.base.bodyType === "feminine" &&
                      d.hair.facialHairId !== "facialhair_none_01"
                    ) {
                      d.hair.facialHairId = "facialhair_none_01";
                    }
                  })
                }
              />
            )}

            {tab === "skin" && (
              <SwatchRow
                disabled={rebuilding}
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
                disabled={rebuilding}
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
                disabled={rebuilding}
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
                disabled={rebuilding}
                  label="Facial hair"
                  items={facialHairOptionsForBody(draft.base.bodyType)}
                  value={draft.hair.facialHairId}
                  onPick={(id) =>
                    edit((d) => {
                      d.hair.facialHairId =
                        id as AppearanceV1["hair"]["facialHairId"];
                    })
                  }
                />
                {draft.base.bodyType === "feminine" && (
                  <p className="eko-studio__caption">
                    Facial hair styles are only available on the Man body.
                  </p>
                )}
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
                    {OUTFIT_ROWS.map((row) => {
                      const premium = row.premium ?? null;
                      const locked =
                        premium !== null &&
                        !(ownedBoutique?.has(premium.itemId) ?? false);
                      return (
                        <button
                          key={row.outfitId}
                          type="button"
                          role="radio"
                          aria-checked={activeRow?.outfitId === row.outfitId}
                          disabled={rebuilding || locked}
                          className={`eko-studio__outfit glass${activeRow?.outfitId === row.outfitId ? " eko-studio__outfit--active" : ""}${locked ? " eko-studio__outfit--locked" : ""}`}
                          title={
                            locked && premium
                              ? `Boutique exclusive · ${naira(premium.price)}`
                              : undefined
                          }
                          onClick={() =>
                            edit((d) =>
                              Object.assign(d, applyOutfitRow(d, row))
                            )
                          }
                        >
                          <span className="eko-studio__outfitname">
                            {locked ? `🔒 ${row.name}` : row.name}
                          </span>
                          <span className="eko-studio__outfitcaption">
                            {locked && premium
                              ? `Boutique · ${naira(premium.price)}`
                              : row.caption}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="eko-studio__caption">
                    Shoes are matched to the outfit — Casual, Hoodie, Chill
                    and Gym come with sneakers, Office with oxfords, Site work
                    with boots, Agbada with sandals, Owambe with heels.
                    {!activeRow &&
                      " This combination has no exact outfit match, so it renders as Casual."}
                  </p>
                </div>
                <PillRow
                disabled={rebuilding}
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
                disabled={rebuilding}
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
                disabled={rebuilding}
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
          disabled={!machine || !machine.dirty || saving || loading || rebuilding}
          title="Discard unsaved changes and go back to your saved look"
        >
          Cancel
        </button>
        <button
          type="button"
          className="eko-studio__reset"
          onClick={() => setConfirmResetDefault(true)}
          disabled={!machine || saving || loading || rebuilding}
          title="Start over from the default look (you still need to save)"
        >
          Default
        </button>
        <button
          type="button"
          className="eko-studio__save glass"
          disabled={!machine || !machine.dirty || saving || loading || rebuilding}
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
