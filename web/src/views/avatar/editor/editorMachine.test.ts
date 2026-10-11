/**
 * Èkó Life avatar studio — editor state-machine tests (Milestone 5).
 *
 * The machine is framework-free; fetch + the 3D loader are injected
 * mocks. Every test below maps to a workflow rule from the M5 brief:
 * edit→unsaved, save→saved=draft, 409→conflict without overwrite,
 * cancel→rendered=saved, failed save→draft preserved, field-level edits,
 * rapid edits→latest wins.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvatarEditorMachine } from "./editorMachine";
import {
  AppearanceConflictError,
  AppearanceValidationError,
} from "../../../avatar/persistence";
import { DEFAULT_APPEARANCE_V1 } from "../../../avatar/validation";
import type { AppearanceV1 } from "../../../avatar/schema";

function cloneApp(): AppearanceV1 {
  return JSON.parse(JSON.stringify(DEFAULT_APPEARANCE_V1)) as AppearanceV1;
}

function savedApp(): AppearanceV1 {
  const a = cloneApp();
  a.characterId = "char-1";
  a.base.skinToneId = "mahogany";
  a.hair.styleId = "afro";
  return a;
}

interface Harness {
  machine: AvatarEditorMachine;
  fetchMock: ReturnType<typeof vi.fn>;
  saveMock: ReturnType<typeof vi.fn>;
  renderInitial: ReturnType<typeof vi.fn>;
  renderEdit: ReturnType<typeof vi.fn>;
  emits: number;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeHarness(): Harness {
  const fetchMock = vi.fn(async (_id: string) => ({
    appearance: savedApp(),
    revision: 7,
  }));
  const saveMock = vi.fn(
    async (_id: string, draft: AppearanceV1, _rev: number) => ({
      appearance: JSON.parse(JSON.stringify(draft)) as AppearanceV1,
      revision: 8,
    })
  );
  const renderInitial = vi.fn();
  const renderEdit = vi.fn();
  let emits = 0;
  const machine = new AvatarEditorMachine(
    {
      fetchAppearanceFn: fetchMock,
      saveAppearanceFn: saveMock,
      renderInitial,
      renderEdit,
    },
    () => {
      emits++;
    }
  );
  return {
    machine,
    fetchMock,
    saveMock,
    renderInitial,
    renderEdit,
    get emits() {
      return emits;
    },
  };
}

describe("AvatarEditorMachine", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("open: fetch → saved=draft=rendered, status ready, initial render once", async () => {
    await h.machine.open("char-1");
    expect(h.fetchMock).toHaveBeenCalledWith("char-1");
    expect(h.machine.status).toBe("ready");
    expect(h.machine.revision).toBe(7);
    expect(h.machine.saved).toEqual(savedApp());
    expect(h.machine.draft).toEqual(savedApp());
    expect(h.machine.rendered).toEqual(savedApp());
    expect(h.machine.dirty).toBe(false);
    expect(h.renderInitial).toHaveBeenCalledTimes(1);
    expect(h.renderInitial.mock.calls[0][0]).toEqual(savedApp());
  });

  it("open failure → status error with message, nothing rendered", async () => {
    h.fetchMock.mockRejectedValueOnce(new Error("network down"));
    await h.machine.open("char-1");
    expect(h.machine.status).toBe("error");
    expect(h.machine.error).toBe("network down");
    expect(h.machine.draft).toBeNull();
    expect(h.renderInitial).not.toHaveBeenCalled();
  });

  it("rapid open() calls: only the latest fetch result is applied (stale guard)", async () => {
    const d1 = deferred<{ appearance: AppearanceV1; revision: number }>();
    const d2 = deferred<{ appearance: AppearanceV1; revision: number }>();
    h.fetchMock
      .mockReturnValueOnce(d1.promise)
      .mockReturnValueOnce(d2.promise);
    const p1 = h.machine.open("char-1");
    const p2 = h.machine.open("char-1");
    const second = savedApp();
    second.base.skinToneId = "deep_espresso";
    d2.resolve({ appearance: second, revision: 11 });
    await p2;
    // The first fetch resolves LATE — it must be dropped.
    const first = savedApp();
    first.base.skinToneId = "latte";
    d1.resolve({ appearance: first, revision: 9 });
    await p1;
    expect(h.machine.saved?.base.skinToneId).toBe("deep_espresso");
    expect(h.machine.revision).toBe(11);
    expect(h.renderInitial).toHaveBeenCalledTimes(1);
    expect(h.renderInitial.mock.calls[0][0].base.skinToneId).toBe(
      "deep_espresso"
    );
  });

  it("edit: unsaved indicator on, immediate local render, field-level", async () => {
    await h.machine.open("char-1");
    h.renderEdit.mockClear();
    const ok = h.machine.edit((d) => {
      d.hair.styleId = "hair_waves_01";
    });
    expect(ok).toBe(true);
    expect(h.machine.dirty).toBe(true);
    expect(h.machine.draft?.hair.styleId).toBe("hair_waves_01");
    // Field-level: nothing else moved.
    expect(h.machine.draft?.base.skinToneId).toBe("mahogany");
    expect(h.machine.draft?.clothing.topId).toBe("top_tee_01");
    expect(h.machine.draft?.base.facePresetId).toBe("face_default_01");
    // Immediate render, no network.
    expect(h.renderEdit).toHaveBeenCalledTimes(1);
    const [prev, next] = h.renderEdit.mock.calls[0];
    expect(prev).toEqual(savedApp());
    expect(next).toEqual(h.machine.draft);
    expect(h.saveMock).not.toHaveBeenCalled();
  });

  it("edit during loading is dropped (returns false)", () => {
    const d = deferred<{ appearance: AppearanceV1; revision: number }>();
    h.fetchMock.mockReturnValueOnce(d.promise);
    const p = h.machine.open("char-1");
    expect(h.machine.edit(() => {})).toBe(false);
    d.resolve({ appearance: savedApp(), revision: 7 });
    return p;
  });

  it("clothing change preserves skin + hair fields (field-level proof)", async () => {
    await h.machine.open("char-1");
    h.machine.edit((d) => {
      d.clothing.topId = "top_shirt_office_01";
      d.clothing.shoeId = "shoe_oxford_01";
      d.clothing.fabricId = "ankara";
      d.clothing.topColor = "#f472b6";
    });
    const draft = h.machine.draft!;
    expect(draft.clothing.topId).toBe("top_shirt_office_01");
    expect(draft.base.skinToneId).toBe("mahogany");
    expect(draft.hair.styleId).toBe("afro");
    expect(draft.hair.colorId).toBe("hair_black_01");
    expect(draft.hair.facialHairId).toBe("facialhair_none_01");
    expect(draft.morphs).toEqual(h.machine.saved!.morphs);
  });

  it("save success: saved=draft (server canonical), indicator off, revision updated", async () => {
    await h.machine.open("char-1");
    h.machine.edit((d) => {
      d.hair.styleId = "locs";
    });
    await h.machine.save();
    expect(h.saveMock).toHaveBeenCalledTimes(1);
    const [, sentDraft, expectedRev] = h.saveMock.mock.calls[0];
    expect(expectedRev).toBe(7);
    expect(sentDraft.hair.styleId).toBe("locs");
    expect(h.machine.status).toBe("ready");
    expect(h.machine.saved).toEqual(h.machine.draft);
    expect(h.machine.dirty).toBe(false);
    expect(h.machine.savedFlash).toBe(true);
    expect(h.machine.revision).toBe(8);
  });

  it("save 409: conflict UI state, draft NOT overwritten", async () => {
    await h.machine.open("char-1");
    h.machine.edit((d) => {
      d.hair.styleId = "braids";
    });
    const draftBefore = JSON.parse(JSON.stringify(h.machine.draft));
    h.saveMock.mockRejectedValueOnce(new AppearanceConflictError(9));
    await h.machine.save();
    expect(h.machine.status).toBe("conflict");
    expect(h.machine.conflictRevision).toBe(9);
    // Never silently overwritten: draft and saved are exactly as before.
    expect(h.machine.draft).toEqual(draftBefore);
    expect(h.machine.saved).toEqual(savedApp());
    expect(h.machine.dirty).toBe(true);
    expect(h.machine.savedFlash).toBe(false);
  });

  it("conflict → Load latest: draft discarded, latest rendered", async () => {
    await h.machine.open("char-1");
    h.machine.edit((d) => {
      d.hair.styleId = "braids";
    });
    h.saveMock.mockRejectedValueOnce(new AppearanceConflictError(9));
    await h.machine.save();
    const latest = savedApp();
    latest.hair.styleId = "curls";
    h.fetchMock.mockResolvedValueOnce({ appearance: latest, revision: 9 });
    h.renderEdit.mockClear();
    await h.machine.loadLatest();
    expect(h.machine.status).toBe("ready");
    expect(h.machine.conflictRevision).toBeNull();
    expect(h.machine.draft).toEqual(latest);
    expect(h.machine.saved).toEqual(latest);
    expect(h.machine.rendered).toEqual(latest);
    expect(h.machine.dirty).toBe(false);
    expect(h.machine.revision).toBe(9);
    const [, next] = h.renderEdit.mock.calls[0];
    expect(next).toEqual(latest);
  });

  it("conflict → Keep editing: draft kept, revision refetched first", async () => {
    await h.machine.open("char-1");
    h.machine.edit((d) => {
      d.hair.styleId = "braids";
    });
    const draftBefore = JSON.parse(JSON.stringify(h.machine.draft));
    h.saveMock.mockRejectedValueOnce(new AppearanceConflictError(9));
    await h.machine.save();
    const latest = savedApp();
    latest.hair.styleId = "curls";
    h.fetchMock.mockResolvedValueOnce({ appearance: latest, revision: 9 });
    await h.machine.keepEditing();
    expect(h.machine.status).toBe("ready");
    expect(h.machine.conflictRevision).toBeNull();
    // Draft untouched…
    expect(h.machine.draft).toEqual(draftBefore);
    // …but the revision is fresh, so the next save carries expectedRev=9.
    expect(h.machine.revision).toBe(9);
    await h.machine.save();
    expect(h.saveMock.mock.calls[1][2]).toBe(9);
  });

  it("save 400: field errors surfaced, draft preserved", async () => {
    await h.machine.open("char-1");
    h.machine.edit((d) => {
      d.clothing.topColor = "#f472b6";
    });
    const draftBefore = JSON.parse(JSON.stringify(h.machine.draft));
    h.saveMock.mockRejectedValueOnce(
      new AppearanceValidationError(["topColor: not in palette", "mystery: bad"])
    );
    await h.machine.save();
    expect(h.machine.status).toBe("error");
    expect(h.machine.fieldErrors).toEqual([
      "topColor: not in palette",
      "mystery: bad",
    ]);
    expect(h.machine.draft).toEqual(draftBefore);
    expect(h.machine.savedFlash).toBe(false);
  });

  it("network failure on save: draft kept, error shown, success never claimed", async () => {
    await h.machine.open("char-1");
    h.machine.edit((d) => {
      d.base.skinToneId = "deep_espresso";
    });
    const draftBefore = JSON.parse(JSON.stringify(h.machine.draft));
    h.saveMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await h.machine.save();
    expect(h.machine.status).toBe("error");
    expect(h.machine.error).toBe("fetch failed");
    expect(h.machine.draft).toEqual(draftBefore);
    expect(h.machine.dirty).toBe(true);
    expect(h.machine.savedFlash).toBe(false);
  });

  it("double save is ignored (no duplicate PUT)", async () => {
    await h.machine.open("char-1");
    const d = deferred<{ appearance: AppearanceV1; revision: number }>();
    h.saveMock.mockReturnValueOnce(d.promise);
    const p1 = h.machine.save();
    const p2 = h.machine.save();
    d.resolve({ appearance: cloneApp(), revision: 8 });
    await Promise.all([p1, p2]);
    expect(h.saveMock).toHaveBeenCalledTimes(1);
  });

  it("edit during an in-flight save: newer draft is never clobbered by the response", async () => {
    await h.machine.open("char-1");
    h.machine.edit((d) => {
      d.hair.styleId = "locs";
    });
    const d = deferred<{ appearance: AppearanceV1; revision: number }>();
    h.saveMock.mockReturnValueOnce(d.promise);
    const p = h.machine.save();
    // User keeps editing while the PUT is in flight.
    h.machine.edit((dd) => {
      dd.base.skinToneId = "deep_espresso";
    });
    const sent = JSON.parse(JSON.stringify(h.saveMock.mock.calls[0][1]));
    d.resolve({ appearance: sent, revision: 8 });
    await p;
    // saved = what the server confirmed; draft keeps the newer edit.
    expect(h.machine.saved?.hair.styleId).toBe("locs");
    expect(h.machine.draft?.base.skinToneId).toBe("deep_espresso");
    expect(h.machine.dirty).toBe(true);
    expect(h.machine.revision).toBe(8);
  });

  it("cancel: draft=saved, rendered matches saved, indicator off, no network", async () => {
    await h.machine.open("char-1");
    h.machine.edit((d) => {
      d.hair.styleId = "hair_taper_fade_01";
      d.base.skinToneId = "latte";
    });
    expect(h.machine.dirty).toBe(true);
    h.renderEdit.mockClear();
    const fetchCalls = h.fetchMock.mock.calls.length;
    h.machine.cancel();
    expect(h.machine.draft).toEqual(savedApp());
    expect(h.machine.rendered).toEqual(savedApp());
    expect(h.machine.dirty).toBe(false);
    expect(h.fetchMock.mock.calls.length).toBe(fetchCalls); // no network
    const [, next] = h.renderEdit.mock.calls[0];
    expect(next).toEqual(savedApp());
  });

  it("resetToDefault: draft = canonical default (characterId kept), still dirty until saved", async () => {
    await h.machine.open("char-1");
    h.renderEdit.mockClear();
    h.machine.resetToDefault();
    const expected = cloneApp();
    expected.characterId = "char-1";
    expect(h.machine.draft).toEqual(expected);
    expect(h.machine.dirty).toBe(true);
    expect(h.saveMock).not.toHaveBeenCalled();
    const [, next] = h.renderEdit.mock.calls[0];
    expect(next).toEqual(expected);
  });

  it("rapid edits: renderEdit called in order, latest draft wins", async () => {
    await h.machine.open("char-1");
    h.renderEdit.mockClear();
    const styles = ["lowcut", "afro", "locs", "braids", "curls"] as const;
    for (const s of styles) {
      h.machine.edit((d) => {
        d.hair.styleId = s;
      });
    }
    expect(h.renderEdit).toHaveBeenCalledTimes(styles.length);
    const last = h.renderEdit.mock.calls[styles.length - 1][1] as AppearanceV1;
    expect(last.hair.styleId).toBe("curls");
    expect(h.machine.draft?.hair.styleId).toBe("curls");
    expect(h.machine.rendered?.hair.styleId).toBe("curls");
    // The sequence is ordered: each call's next equals the following call's prev.
    for (let i = 1; i < styles.length; i++) {
      const prev = h.renderEdit.mock.calls[i][0] as AppearanceV1;
      const nextPrev = h.renderEdit.mock.calls[i - 1][1] as AppearanceV1;
      expect(prev).toEqual(nextPrev);
    }
  });

  it("clearSavedFlash / clearError reset their notices", async () => {
    await h.machine.open("char-1");
    await h.machine.save();
    expect(h.machine.savedFlash).toBe(true);
    h.machine.clearSavedFlash();
    expect(h.machine.savedFlash).toBe(false);
    h.saveMock.mockRejectedValueOnce(new Error("boom"));
    h.machine.edit((d) => {
      d.hair.styleId = "bald";
    });
    await h.machine.save();
    expect(h.machine.error).toBe("boom");
    h.machine.clearError();
    expect(h.machine.error).toBeNull();
  });
});
