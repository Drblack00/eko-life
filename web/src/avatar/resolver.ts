/**
 * Èkó Life Avatar Engine — asset resolution (Milestone 2).
 *
 * BEHAVIOR POLICY (documented choice):
 * - `resolveAsset(id)` is STRICT: it THROWS on unknown ids and on assets
 *   whose status is not "available" (e.g. the "pending" licensed-GLB
 *   entries). Strictness is deliberate — silently substituting a wrong body
 *   or hairstyle would corrupt a player's avatar without anyone noticing.
 * - `resolveAssetOrFallback(id)` is LENIENT: it walks the asset's
 *   `fallbackAssetId` chain (cycle-guarded) and returns the first available
 *   asset. Use it in render paths that must never crash.
 * - `isSafeAssetRef(v)` is the ONLY gate for accepting an asset reference
 *   from untrusted input: it returns true only for exact manifest ids.
 *   Filesystem paths (`../../etc/passwd`) and URLs
 *   (`https://evil.com/x.glb`) are rejected — the engine never loads assets
 *   from paths or the network in M2.
 *
 * Pure: no DOM, no three.js imports. Importable from client and server.
 */

import { AVATAR_MANIFEST_BY_ID, type AvatarAsset } from "./manifest";
import type { AppearanceV1 } from "./schema";

export type AssetErrorCode =
  | "UNKNOWN_ASSET"
  | "ASSET_UNAVAILABLE"
  | "INCOMPATIBLE_ASSET"
  | "NO_FALLBACK";

export class AvatarAssetError extends Error {
  readonly code: AssetErrorCode;
  constructor(message: string, code: AssetErrorCode) {
    super(message);
    this.name = "AvatarAssetError";
    this.code = code;
  }
}

/**
 * Strict resolution. Throws AvatarAssetError when:
 * - the id is not in the manifest (UNKNOWN_ASSET), or
 * - the asset exists but is not "available" — e.g. "pending" licensed-GLB
 *   entries (ASSET_UNAVAILABLE).
 */
export function resolveAsset(id: string): AvatarAsset {
  const asset = AVATAR_MANIFEST_BY_ID[id];
  if (!asset) {
    throw new AvatarAssetError(
      `Unknown avatar asset id "${id}". Only manifest ids are accepted — no filesystem paths, no URLs.`,
      "UNKNOWN_ASSET"
    );
  }
  if (asset.status !== "available") {
    throw new AvatarAssetError(
      `Avatar asset "${id}" has status "${asset.status}" and is not available.` +
        (asset.integration ? ` Integration requirements: ${asset.integration}` : ""),
      "ASSET_UNAVAILABLE"
    );
  }
  return asset;
}

/**
 * Lenient resolution: returns the asset for `id`, or walks its
 * `fallbackAssetId` chain until an available asset is found. Cycle-guarded.
 * Throws NO_FALLBACK if no available asset exists in the chain.
 */
export function resolveAssetOrFallback(id: string): AvatarAsset {
  const seen = new Set<string>();
  let current: string | null = id;
  while (current !== null) {
    if (seen.has(current)) {
      throw new AvatarAssetError(
        `Fallback chain for "${id}" contains a cycle.`,
        "NO_FALLBACK"
      );
    }
    seen.add(current);
    const asset: AvatarAsset | undefined = AVATAR_MANIFEST_BY_ID[current];
    if (!asset) {
      throw new AvatarAssetError(
        `Unknown avatar asset id "${id}" and no fallback resolves it.`,
        "UNKNOWN_ASSET"
      );
    }
    if (asset.status === "available") return asset;
    current = asset.fallbackAssetId;
  }
  throw new AvatarAssetError(
    `Avatar asset "${id}" is "${AVATAR_MANIFEST_BY_ID[id]?.status}" with no available fallback.`,
    "NO_FALLBACK"
  );
}

/**
 * Compatibility gate: the asset must support the appearance's bodyType.
 * Throws INCOMPATIBLE_ASSET otherwise (e.g. a masculine-only body preset
 * on a feminine appearance).
 */
export function assertCompatible(
  asset: AvatarAsset,
  appearance: AppearanceV1
): void {
  if (!asset.compatibleBodyTypes.includes(appearance.base.bodyType)) {
    throw new AvatarAssetError(
      `Asset "${asset.id}" is not compatible with bodyType "${appearance.base.bodyType}".`,
      "INCOMPATIBLE_ASSET"
    );
  }
}

/**
 * The ONLY safe gate for asset references from untrusted input.
 * Returns true only for exact manifest ids (any status — callers that need
 * wearability should additionally check `status === "available"`).
 * Rejects: non-strings, empty strings, filesystem paths, URLs, and any
 * string that is not a manifest id.
 */
export function isSafeAssetRef(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Object.prototype.hasOwnProperty.call(AVATAR_MANIFEST_BY_ID, value)
  );
}
