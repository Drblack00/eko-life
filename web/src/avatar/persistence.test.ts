import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppearanceValidationError,
  clearDraft,
  fetchAppearance,
  loadDraft,
  saveAppearance,
  storeDraft,
} from "./persistence";
import { DEFAULT_APPEARANCE_V1 } from "./validation";
import type { AppearanceV1 } from "./schema";

// --- localStorage polyfill (vitest runs in node env) ---
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
  setItem: (k: string, v: string) => {
    mem.set(k, String(v));
  },
  removeItem: (k: string) => {
    mem.delete(k);
  },
});

// --- fetch mock ---
type MockRes = { status: number; body: unknown };
function mockFetchOnce(res: MockRes) {
  const f = vi.fn(async () =>
    new Response(JSON.stringify(res.body), { status: res.status })
  );
  vi.stubGlobal("fetch", f);
  return f;
}

const LEGACY_LOOK = {
  body: "man",
  skin: "deep_espresso",
  hair: "afro",
  outfit: "sitework",
  fabric: "ankara",
  topColor: "#22D3EE",
  bottomColor: "#334155",
};

const V1: AppearanceV1 = {
  ...JSON.parse(JSON.stringify(DEFAULT_APPEARANCE_V1)),
  characterId: "7",
  base: {
    bodyType: "masculine",
    bodyPresetId: "man",
    facePresetId: "face_default_01",
    skinToneId: "mahogany",
  },
  morphs: {
    jawWidth: 0.7,
    cheekboneHeight: 0.5,
    noseWidth: 0.5,
    noseLength: 0.5,
    lipFullness: 0.5,
    browProminence: 0.5,
    chinLength: 0.5,
    eyeSpacing: 0.5,
    foreheadSlope: 0.5,
  },
  hair: { styleId: "locs", colorId: "hair_black_01", facialHairId: "facialhair_none_01" },
  clothing: {
    topId: "top_tee_01",
    bottomId: "bottom_cargo_01",
    outerwearId: "outer_hivis_vest_01",
    shoeId: "shoe_boot_01",
    fabricId: "ankara",
    topColor: "#f472b6",
    bottomColor: "#111827",
  },
  accessories: [],
};

describe("fetchAppearance", () => {
  beforeEach(() => mem.clear());

  it("migrates a legacy flat payload to v1 on read", async () => {
    mockFetchOnce({
      status: 200,
      body: { appearance: LEGACY_LOOK, revision: 0 },
    });
    const { appearance, revision } = await fetchAppearance("7");
    expect(revision).toBe(0);
    expect(appearance.schemaVersion).toBe(1);
    expect(appearance.characterId).toBe("7");
    expect(appearance.base.bodyType).toBe("masculine");
    expect(appearance.base.skinToneId).toBe("deep_espresso");
    expect(appearance.hair.styleId).toBe("afro");
    expect(appearance.clothing.bottomId).toBe("bottom_cargo_01"); // sitework
    expect(appearance.clothing.topColor).toBe("#22d3ee"); // normalized
  });

  it("validates (does not flatten-migrate) a v1 payload", async () => {
    mockFetchOnce({ status: 200, body: { appearance: V1, revision: 3 } });
    const { appearance, revision } = await fetchAppearance("7");
    expect(revision).toBe(3);
    // Values survive — a legacy-style migrate would have flattened these to defaults.
    expect(appearance.base.skinToneId).toBe("mahogany");
    expect(appearance.hair.styleId).toBe("locs");
    expect(appearance.morphs.jawWidth).toBe(0.7);
  });

  it("migrates null payloads to defaults", async () => {
    mockFetchOnce({ status: 200, body: { appearance: null, revision: 0 } });
    const { appearance } = await fetchAppearance("7");
    expect(appearance.base.bodyPresetId).toBe("woman"); // M2 default
  });
});

describe("saveAppearance", () => {
  it("returns the canonical appearance + new revision on 200", async () => {
    mockFetchOnce({ status: 200, body: { appearance: V1, revision: 4 } });
    const r = await saveAppearance("7", V1, 3);
    expect(r.revision).toBe(4);
    expect(r.appearance.hair.styleId).toBe("locs");
  });

  it("throws AppearanceConflictError carrying the server revision on 409", async () => {
    mockFetchOnce({
      status: 409,
      body: { error: "revision_conflict", revision: 5 },
    });
    await expect(saveAppearance("7", V1, 3)).rejects.toMatchObject({
      name: "AppearanceConflictError",
      revision: 5,
    });
  });

  it("throws AppearanceValidationError on 400", async () => {
    mockFetchOnce({
      status: 400,
      body: {
        error: "hair.styleId: unknown hairstyle 'mohawk'",
        errors: ["hair.styleId: unknown hairstyle 'mohawk'"],
      },
    });
    const p = saveAppearance("7", V1, 3);
    await expect(p).rejects.toBeInstanceOf(AppearanceValidationError);
    await expect(p).rejects.toMatchObject({
      errors: ["hair.styleId: unknown hairstyle 'mohawk'"],
    });
  });
});

describe("draft recovery (localStorage)", () => {
  beforeEach(() => mem.clear());

  it("round-trips a draft and clears it", () => {
    expect(loadDraft("7")).toBeNull();
    storeDraft("7", V1);
    const loaded = loadDraft("7");
    expect(loaded).not.toBeNull();
    expect(loaded!.hair.styleId).toBe("locs");
    expect(loaded!.characterId).toBe("7");
    clearDraft("7");
    expect(loadDraft("7")).toBeNull();
  });

  it("rejects garbage drafts (never source of truth)", () => {
    mem.set("eko-avatar-draft:7", "{not valid json");
    expect(loadDraft("7")).toBeNull();
    mem.set("eko-avatar-draft:7", JSON.stringify({ base: { bodyType: "alien" } }));
    expect(loadDraft("7")).toBeNull();
  });

  it("drafts are keyed per character", () => {
    storeDraft("7", V1);
    expect(loadDraft("8")).toBeNull();
    clearDraft("7");
  });
});
