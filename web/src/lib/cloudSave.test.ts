// @vitest-environment node
// Cloud-save client tests: load/save wiring, server-wins merge on
// initial load, and dirty-gated autosave behavior (fetch mocked).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  loadCloudSave,
  saveCloudSave,
  startCloudSaveSync,
  markCloudSaveDirty,
  __resetCloudSaveForTests,
  type CloudSavePayload,
} from "./cloudSave";

const TOKEN_KEY = "eko_token";

function json(status: number, body: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
  });
  vi.stubGlobal("fetch", vi.fn());
  __resetCloudSaveForTests();
});

afterEach(() => {
  __resetCloudSaveForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function signIn() {
  localStorage.setItem(TOKEN_KEY, "test-token");
}

function fetchCalls() {
  return vi.mocked(fetch).mock.calls;
}

describe("loadCloudSave", () => {
  it("returns null when logged out (no token)", async () => {
    expect(await loadCloudSave()).toBeNull();
    expect(fetchCalls()).toHaveLength(0);
  });

  it("GETs with the bearer token and returns payload + updated_at", async () => {
    signIn();
    const payload: CloudSavePayload = { v: 1, walkthroughDone: true };
    vi.mocked(fetch).mockResolvedValue(await json(200, { ok: true, payload, updated_at: 123 }));
    const got = await loadCloudSave();
    expect(got).toEqual({ payload, updated_at: 123 });
    const [url, opts] = fetchCalls()[0]!;
    expect(url).toBe("/api/cloud-save");
    expect((opts!.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
  });

  it("returns null on guest 403 (guests stay local-only)", async () => {
    signIn();
    vi.mocked(fetch).mockResolvedValue(await json(403, { error: "guests stay local-only" }));
    expect(await loadCloudSave()).toBeNull();
  });
});

describe("saveCloudSave", () => {
  it("PUTs payload + client_updated_at and reports saved", async () => {
    signIn();
    const payload: CloudSavePayload = { v: 1, charDone: true };
    vi.mocked(fetch).mockResolvedValue(await json(200, { ok: true, updated_at: 777 }));
    const out = await saveCloudSave(payload, 123);
    expect(out).toEqual({ status: "saved", updated_at: 777 });
    const [url, opts] = fetchCalls()[0]!;
    expect(url).toBe("/api/cloud-save");
    expect(opts!.method).toBe("PUT");
    const body = JSON.parse(opts!.body as string);
    expect(body).toEqual({ payload, client_updated_at: 123 });
  });

  it("reports conflict with the server copy on 409", async () => {
    signIn();
    const serverPayload: CloudSavePayload = { v: 1, walkthroughDone: true };
    vi.mocked(fetch).mockResolvedValue(
      await json(409, { error: "conflict", server_payload: serverPayload, server_updated_at: 999 }),
    );
    const out = await saveCloudSave({ v: 1, walkthroughDone: false }, 0);
    expect(out).toEqual({ status: "conflict", serverPayload, serverUpdatedAt: 999 });
  });
});

describe("startCloudSaveSync", () => {
  it("no-ops when logged out", async () => {
    const stop = startCloudSaveSync(
      () => ({ v: 1 }),
      () => {},
    );
    expect(typeof stop).toBe("function");
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchCalls()).toHaveLength(0);
  });

  it("server wins on initial load: applyServer receives the server payload", async () => {
    signIn();
    const serverPayload: CloudSavePayload = { v: 1, walkthroughDone: true, blocked: { "9": "x" } };
    vi.mocked(fetch).mockResolvedValue(await json(200, { ok: true, payload: serverPayload, updated_at: 42 }));
    const applyServer = vi.fn();
    const getLocal = vi.fn(() => ({ v: 1 as const, walkthroughDone: false }));
    const stop = startCloudSaveSync(getLocal, applyServer);
    await vi.waitFor(() => expect(applyServer).toHaveBeenCalledWith(serverPayload));
    stop();
  });

  it("autosaves only when dirty; skips clean ticks", async () => {
    vi.useFakeTimers();
    signIn();
    vi.mocked(fetch).mockResolvedValue(await json(200, { ok: true, payload: { v: 1 }, updated_at: 1 }));
    const getLocal = vi.fn(() => ({ v: 1 as const, walkthroughDone: true }));
    const stop = startCloudSaveSync(getLocal, () => {});
    await vi.advanceTimersByTimeAsync(0); // settle the initial load

    // clean tick: no PUT
    vi.mocked(fetch).mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchCalls().filter(([, o]) => o?.method === "PUT")).toHaveLength(0);

    // dirty tick: PUT goes out
    markCloudSaveDirty();
    await vi.advanceTimersByTimeAsync(60_000);
    const puts = fetchCalls().filter(([, o]) => o?.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(getLocal).toHaveBeenCalled();
    stop();
  });

  it("on 409 during autosave the server copy is applied and dirty clears", async () => {
    vi.useFakeTimers();
    signIn();
    const serverPayload: CloudSavePayload = { v: 1, charDone: true };
    vi.mocked(fetch).mockImplementation(
      ((_url: string, opts?: RequestInit) =>
        opts?.method === "PUT"
          ? json(409, { error: "conflict", server_payload: serverPayload, server_updated_at: 500 })
          : json(200, { ok: true, payload: { v: 1 }, updated_at: 1 })) as typeof fetch,
    );
    const applyServer = vi.fn();
    startCloudSaveSync(() => ({ v: 1 as const }), applyServer);
    await vi.advanceTimersByTimeAsync(0);
    markCloudSaveDirty();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(applyServer).toHaveBeenCalledWith(serverPayload);
    // dirty cleared: next tick does nothing more
    vi.mocked(fetch).mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchCalls()).toHaveLength(0);
  });
});
