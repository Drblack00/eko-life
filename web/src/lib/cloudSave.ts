/**
 * cloudSave.ts — client-side cloud-save sync (TASK 1).
 *
 * Syncs ancillary per-user state that was previously stuck in browser
 * localStorage (blocked-users map, walkthrough completion, char-creation
 * flag) to the server's `cloud_saves` table so it follows the account
 * across devices.
 *
 * CONFLICT RESOLUTION (server-timestamp-wins):
 *   On save, the client sends client_updated_at = the server updated_at
 *   it last saw. If the server row is NEWER than that and the payloads
 *   differ, the server answers 409 WITHOUT overwriting, and this library
 *   surfaces the server copy. On the initial load the server always
 *   wins (its payload is applied over local state).
 *
 * Guests stay local-only: both server routes answer 403 for guests, and
 * these helpers no-op (return null) when there is no bearer token.
 *
 * Theme/sound prefs intentionally remain localStorage-only (per-device),
 * and the auth token stays in localStorage (session-scoped).
 */
import { getToken } from "./auth";

export interface CloudSavePayload {
  /** blocked user ids → display name; mirrored from useGameSocket's eko:blocked:v1 */
  blocked?: Record<string, string>;
  /** mirrored from the walkthrough completion flag (Walkthrough WALKTHROUGH_KEY) */
  walkthroughDone?: boolean;
  /** mirrored from the eko_char_done:<username> flag */
  charDone?: boolean;
  v: 1;
}

export interface CloudSaveResult {
  payload: CloudSavePayload;
  updated_at: number;
}

export type SaveOutcome =
  | { status: "saved"; updated_at: number }
  | { status: "conflict"; serverPayload: CloudSavePayload; serverUpdatedAt: number };

const API_BASE = ""; // same-origin

function authHeaders(): Record<string, string> | null {
  const token = getToken();
  if (!token) return null;
  return { Authorization: `Bearer ${token}` };
}

/**
 * Load the cloud save for the signed-in account. Returns null when
 * logged out (no token) or when the account is a guest (server 403).
 */
export async function loadCloudSave(): Promise<CloudSaveResult | null> {
  const headers = authHeaders();
  if (!headers) return null;
  const res = await fetch(`${API_BASE}/api/cloud-save`, { headers });
  if (res.status === 403) return null; // guest: stays local-only
  if (!res.ok) throw new Error(`cloud-save load failed: ${res.status}`);
  const body = await res.json();
  return { payload: body.payload ?? {}, updated_at: Number(body.updated_at) || 0 };
}

/**
 * Save a payload. clientUpdatedAt should be the updated_at returned by
 * the last successful load/save (0 for never). On 409 the outcome
 * carries the server copy so the caller can adopt it.
 */
export async function saveCloudSave(
  payload: CloudSavePayload,
  clientUpdatedAt: number,
): Promise<SaveOutcome> {
  const headers = authHeaders();
  if (!headers) throw new Error("saveCloudSave: not signed in");
  const res = await fetch(`${API_BASE}/api/cloud-save`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ payload, client_updated_at: clientUpdatedAt }),
  });
  if (res.status === 409) {
    const body = await res.json();
    return {
      status: "conflict",
      serverPayload: body.server_payload ?? {},
      serverUpdatedAt: Number(body.server_updated_at) || 0,
    };
  }
  if (!res.ok) throw new Error(`cloud-save save failed: ${res.status}`);
  const body = await res.json();
  return { status: "saved", updated_at: Number(body.updated_at) || Date.now() };
}

// ---- sync wiring ----

const AUTOSAVE_MS = 60_000;

let dirty = false;
let handlers: { getLocal: () => CloudSavePayload; applyServer: (p: CloudSavePayload) => void } | null = null;
let lastServerTs = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/** Call after any major local change (block/unblock, walkthrough done, char created). */
export function markCloudSaveDirty(): void {
  dirty = true;
}

async function flushIfDirty(): Promise<void> {
  if (!dirty || !handlers || !authHeaders()) return;
  try {
    const outcome = await saveCloudSave(handlers.getLocal(), lastServerTs);
    if (outcome.status === "saved") {
      lastServerTs = outcome.updated_at;
      dirty = false;
    } else {
      // Server wins on conflict: adopt the server copy, clear dirty —
      // the local change that lost has been superseded.
      lastServerTs = outcome.serverUpdatedAt;
      dirty = false;
      handlers.applyServer(outcome.serverPayload);
    }
  } catch {
    // Network/server failure: keep dirty so the next tick retries.
  }
}

/**
 * Wire the sync loop. On call: loads the server save (server wins —
 * the payload is applied over local state via applyServer), then
 * autosaves every 60s only when dirty, plus on tab-hide and page-exit.
 * No-ops when there is no signed-in token. Returns a stop() function.
 */
export function startCloudSaveSync(
  getLocal: () => CloudSavePayload,
  applyServer: (p: CloudSavePayload) => void,
): () => void {
  stopCloudSaveSync();
  if (!authHeaders()) return () => {};
  handlers = { getLocal, applyServer };

  // Initial load: server wins on merge.
  loadCloudSave()
    .then((loaded) => {
      if (!loaded || !handlers) return;
      lastServerTs = loaded.updated_at;
      applyServer(loaded.payload);
    })
    .catch(() => { /* offline at boot — stays local until a save succeeds */ });

  timer = setInterval(() => { void flushIfDirty(); }, AUTOSAVE_MS);

  const onHidden = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") void flushIfDirty();
  };
  const onUnload = () => { void flushIfDirty(); };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onHidden);
  if (typeof window !== "undefined") window.addEventListener("beforeunload", onUnload);

  return stopCloudSaveSync;
}

export function stopCloudSaveSync(): void {
  if (timer) { clearInterval(timer); timer = null; }
  handlers = null;
  dirty = false;
  lastServerTs = 0;
}

/** Test-only: reset module state between tests. */
export function __resetCloudSaveForTests(): void {
  stopCloudSaveSync();
}
