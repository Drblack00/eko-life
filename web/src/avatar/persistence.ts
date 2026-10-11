/**
 * Èkó Life Avatar Engine — versioned appearance persistence client (Milestone 6).
 *
 * Same-origin REST client for the server's revision-guarded appearance
 * endpoints (see server/src/game/appearance.js):
 *   GET /api/characters/:id/appearance → { appearance, revision }
 *   PUT /api/characters/:id/appearance { appearance, expectedRev }
 *     → 200 { appearance, revision }
 *     → 400 validation errors / 409 revision conflict / 403-404 ownership
 *
 * The server returns the stored JSON verbatim: legacy flat looks
 * ({body,skin,hair,outfit,fabric,topColor,bottomColor}) are migrated
 * client-side with the M2 `migrateAvatarLookToV1`; v1 payloads are run
 * through `validateAppearance` (which fills defaults + normalizes).
 *
 * Drafts in localStorage are RECOVERY ONLY — the server revision is the
 * source of truth. No UI in this module; the M5 editor consumes it.
 * Do not import the WebSocket path here (AvatarStudio's WS save_avatar
 * keeps working unchanged).
 */

import { getToken } from "../lib/auth";
import { migrateAvatarLookToV1 } from "./migrate";
import { validateAppearance } from "./validation";
import type { AppearanceV1 } from "./schema";

/* ------------------------------------------------------------------ */
/* Error types                                                         */
/* ------------------------------------------------------------------ */

/** Thrown on PUT 409. Carries the server's current revision. */
export class AppearanceConflictError extends Error {
  readonly revision: number;
  constructor(revision: number) {
    super(
      `Appearance revision conflict — server is at revision ${revision}. Reload and re-apply your changes.`
    );
    this.name = "AppearanceConflictError";
    this.revision = revision;
  }
}

/** Thrown on PUT 400. Carries the server's validation error list. */
export class AppearanceValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.length > 0 ? errors[0] : "Invalid appearance.");
    this.name = "AppearanceValidationError";
    this.errors = errors;
  }
}

export interface AppearanceFetchResult {
  appearance: AppearanceV1;
  revision: number;
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

async function request(
  path: string,
  init?: RequestInit
): Promise<{ status: number; body: unknown }> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { headers, ...init });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Coerce a stored payload to canonical v1. Legacy flat payloads (and
 * null/garbage) migrate via migrateAvatarLookToV1; v1 payloads validate
 * via validateAppearance — never migrate a v1 (its fields live under
 * base/morphs/hair/clothing, not the legacy flat keys).
 */
function coerceToV1(payload: unknown, characterId: string): AppearanceV1 {
  // Legacy shapes keep `hair` as a bare string; v1 shapes use section
  // objects (base/morphs/hair/clothing). Never run the legacy migrate on
  // a v1 payload — it would flatten its fields to defaults.
  if (isRecord(payload)) {
    const p = payload as Record<string, unknown>;
    const looksV1 =
      p.schemaVersion === 1 ||
      isRecord(p.base) ||
      isRecord(p.hair) ||
      isRecord(p.clothing) ||
      isRecord(p.morphs) ||
      Array.isArray(p.accessories);
    if (looksV1) {
      const v = validateAppearance({ ...(payload as object), characterId });
      if (v.ok && v.appearance) return v.appearance;
    }
  }
  return migrateAvatarLookToV1(payload, characterId);
}

/**
 * Load the stored appearance for a character (with revision).
 * Legacy flat JSON is migrated to v1 on read.
 */
export async function fetchAppearance(
  characterId: string
): Promise<AppearanceFetchResult> {
  const { status, body } = await request(
    `/api/characters/${encodeURIComponent(characterId)}/appearance`
  );
  if (status === 404) throw new Error("Character not found.");
  if (status !== 200) {
    throw new Error(
      body && isRecord(body) && typeof body.error === "string"
        ? body.error
        : `Failed to load appearance (${status}).`
    );
  }
  const rec = isRecord(body) ? body : {};
  const revision =
    typeof rec.revision === "number" && Number.isFinite(rec.revision)
      ? rec.revision
      : 0;
  return {
    appearance: coerceToV1(rec.appearance, characterId),
    revision,
  };
}

/**
 * Save a v1 appearance draft with optimistic concurrency.
 * Throws AppearanceConflictError (409) carrying the server revision,
 * AppearanceValidationError (400) carrying the error list.
 */
export async function saveAppearance(
  characterId: string,
  draftV1: AppearanceV1,
  expectedRev: number
): Promise<AppearanceFetchResult> {
  const { status, body } = await request(
    `/api/characters/${encodeURIComponent(characterId)}/appearance`,
    {
      method: "PUT",
      body: JSON.stringify({ appearance: draftV1, expectedRev }),
    }
  );
  const rec = isRecord(body) ? body : {};
  if (status === 409) {
    const revision =
      typeof rec.revision === "number" && Number.isFinite(rec.revision)
        ? rec.revision
        : 0;
    throw new AppearanceConflictError(revision);
  }
  if (status === 400) {
    const errors =
      Array.isArray(rec.errors) && rec.errors.every((e) => typeof e === "string")
        ? (rec.errors as string[])
        : [typeof rec.error === "string" ? rec.error : "Invalid appearance."];
    throw new AppearanceValidationError(errors);
  }
  if (status !== 200) {
    throw new Error(
      typeof rec.error === "string"
        ? rec.error
        : `Failed to save appearance (${status}).`
    );
  }
  const revision =
    typeof rec.revision === "number" && Number.isFinite(rec.revision)
      ? rec.revision
      : 0;
  return {
    appearance: coerceToV1(rec.appearance, String(characterId)),
    revision,
  };
}

/* ------------------------------------------------------------------ */
/* Draft recovery (localStorage) — recovery only, never source of      */
/* truth. Drafts are validated on load so garbage never reaches the    */
/* editor.                                                             */
/* ------------------------------------------------------------------ */

function draftKey(characterId: string): string {
  return `eko-avatar-draft:${characterId}`;
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function storeDraft(characterId: string, draft: AppearanceV1): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(draftKey(characterId), JSON.stringify(draft));
  } catch {
    /* private-mode browsers: draft just won't persist */
  }
}

export function loadDraft(characterId: string): AppearanceV1 | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(draftKey(characterId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const v = validateAppearance(parsed);
    return v.ok && v.appearance ? v.appearance : null;
  } catch {
    return null;
  }
}

export function clearDraft(characterId: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(draftKey(characterId));
  } catch {
    /* ignore */
  }
}
