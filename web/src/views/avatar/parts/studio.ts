/**
 * AvatarStudio presentation helpers (M20 workstream 3).
 *
 * Pure, framework-free camera math for the studio preview:
 * camera presets, zoom clamping, look-at drift, size-responsive preset
 * framing (Bug 2: the studio now lives in a smaller embedded card, so the
 * Face/Full-body anchors are derived from the measured container instead of
 * being hardcoded for one card size), and the touch directional-lock
 * decision. The React component (AvatarStudio.tsx) consumes these; unit
 * tests live in studio.test.ts.
 *
 * Figure-space anchors below are measured from the avatar build (per-
 * hairstyle Box3 measurements: feet minY 0.0950, chin at 1.4 — the head
 * group scales about the neck-top origin so the chin anchor does not
 * move — tallest hair (afro) top at 1.8358 with HEAD_GROUP_SCALE=1.08)
 * and are camera-use only — the avatarLook geometry contract is
 * untouched.
 */

export interface CameraFraming {
  /** Distance from the camera to the look-at point. */
  distance: number;
  /** Height of the look-at point on the figure. */
  targetY: number;
}

/** Figure-space height of the chin (head group origin). */
export const FIGURE_CHIN_Y = 1.4;
/** Figure-space top of the tallest hairstyle (afro, measured 1.8358). */
export const FIGURE_HAIR_TOP_Y = 1.84;
/** Figure-space height of the feet. */
export const FIGURE_FEET_Y = 0.09;

/** Vertical field of view of the studio camera, in degrees. */
export const STUDIO_FOV_DEG = 34;

/** Half-width the Face framing must keep clear (afro + margin). */
export const FACE_HALF_WIDTH = 0.3;
/** Half-width the Full-body framing must keep clear (shoulders/arms + margin). */
export const BODY_HALF_WIDTH = 0.5;

/** Framing margin above/below the required figure span (figure units). */
export const FRAMING_MARGIN_Y = 0.12;

/**
 * Approx. UI chrome overlaid on the preview: the Face/Full-body pills sit
 * ~12px from the top and are 36px tall. The hair top is kept this far below
 * the frame top so the pills never cover it. (The "Pinch or scroll to zoom"
 * hint is transient, translucent and pointer-events:none, so no bottom
 * reserve is needed.)
 */
export const PREVIEW_TOP_UI_PX = 60;

/** Preset selector shared by the framing helpers and the component. */
export type StudioPresetKind = "face" | "body";

/** Closest allowed camera distance — near enough to inspect the face. */
export const ZOOM_MIN = 1.15;
/** Farthest allowed camera distance — full figure plus headroom. */
export const ZOOM_MAX = 4.6;

/**
 * "Face" framing: close-up on the head for detail inspection.
 * Fits chin (≈1.40) through the tallest hairstyle top (afro ≈1.80):
 * at d=1.15 the frame spans ≈[1.24, 1.95] on the figure plane, so the
 * whole head is visible with margin — never clipped.
 */
export const FACE_PRESET: CameraFraming = { distance: 1.15, targetY: 1.6 };
/**
 * "Full body" framing: the whole figure, grounded, with headroom.
 * Fits feet (≈0.09) through the afro top (≈1.80): at d=3.4 the frame
 * spans ≈[-0.09, 2.00] on the figure plane — full figure plus ≈0.2 of
 * headroom in portrait and landscape alike.
 */
export const BODY_PRESET: CameraFraming = { distance: 3.4, targetY: 0.98 };

/** Default framing when the studio first mounts (full body, head included). */
export const DEFAULT_FRAMING: CameraFraming = { distance: 3.4, targetY: 0.98 };

/** Clamp a requested camera distance into the zoom range. */
export function clampZoom(distance: number): number {
  if (!Number.isFinite(distance)) return DEFAULT_FRAMING.distance;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, distance));
}

/**
 * Look-at drift between two target heights with the shared smoothstep:
 * as the camera moves in, the framing drifts toward `faceY`; as it pulls
 * back, toward `bodyY`.
 */
export function driftTargetY(
  distance: number,
  faceY: number,
  bodyY: number
): number {
  const d = clampZoom(distance);
  const t = (d - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN);
  const eased = t * t * (3 - 2 * t); // smoothstep
  return faceY + (bodyY - faceY) * eased;
}

/**
 * Look-at height that follows the zoom level: as the camera moves in, the
 * framing drifts up toward the head so a pinch-zoom naturally lands on the
 * face; as it pulls back, it settles on the figure's center of mass.
 */
export function targetYForDistance(distance: number): number {
  return driftTargetY(distance, FACE_PRESET.targetY, BODY_PRESET.targetY);
}

/**
 * Required clear half-width at an arbitrary zoom distance: drifts from the
 * Face requirement (head + hair) to the Full-body requirement
 * (shoulders/arms) with the same smoothstep as the look-at drift.
 */
export function halfWidthForDistance(distance: number): number {
  const d = clampZoom(distance);
  const t = (d - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN);
  const eased = t * t * (3 - 2 * t); // smoothstep
  return FACE_HALF_WIDTH + (BODY_HALF_WIDTH - FACE_HALF_WIDTH) * eased;
}

/**
 * Size-responsive preset framing (Bug 2 fix). Derives distance/targetY from
 * the MEASURED preview container (width/height in CSS px) so the required
 * figure span always fits, whatever card the studio is embedded in:
 * - Face: chin → tallest-hair-top, with margin.
 * - Full body: feet → tallest-hair-top, with margin.
 * The span is centered in the frame's usable band, i.e. below the overlaid
 * preset pills (top UI zone), so tall hairstyles (afro/locs/braids) are
 * never covered by the pills or clipped by the frame top. Narrow containers
 * additionally dolly out so the head/hair never clips sideways.
 * The result is clamped to the zoom range.
 */
export function framingForContainer(
  kind: StudioPresetKind,
  width: number,
  height: number
): CameraFraming {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const aspect = w / h;
  const tanH = Math.tan((STUDIO_FOV_DEG * Math.PI) / 360);
  const loY =
    (kind === "face" ? FIGURE_CHIN_Y : FIGURE_FEET_Y) - FRAMING_MARGIN_Y;
  const hiY = FIGURE_HAIR_TOP_Y + FRAMING_MARGIN_Y;
  // Fraction of the frame height covered by the overlaid pills.
  const topFrac = Math.min(0.3, PREVIEW_TOP_UI_PX / h);
  const usable = Math.max(0.2, 1 - topFrac);
  let halfH = (hiY - loY) / (2 * usable);
  // Center the span in the usable band: hair top lands `topFrac` of the
  // frame height below the frame top — clear of the pills by construction.
  let targetY = (loY + hiY) / 2 + halfH * topFrac;
  let distance = halfH / tanH;
  // Horizontal fit for narrow containers: dolly out until the needed
  // half-width fits inside the frame.
  const needHW = kind === "face" ? FACE_HALF_WIDTH : BODY_HALF_WIDTH;
  if (tanH * distance * aspect < needHW) {
    distance = needHW / (tanH * aspect);
    halfH = tanH * distance;
    targetY = (loY + hiY) / 2 + halfH * topFrac;
  }
  return { distance: clampZoom(distance), targetY };
}

/**
 * Render-time aspect compensation for free zoom: if the container is too
 * narrow for the required half-width at `distance`, dolly out just enough
 * that the head/hair keep their sideways clearance. Never dollies in — the
 * canonical framing (presets, zoom state, pill matching) is untouched; this
 * only widens the rendered frame when the aspect demands it.
 */
export function compensateDistance(distance: number, aspect: number): number {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const d = clampZoom(distance);
  const tanH = Math.tan((STUDIO_FOV_DEG * Math.PI) / 360);
  const needD = halfWidthForDistance(d) / (tanH * a);
  return Math.min(ZOOM_MAX, Math.max(d, needD));
}

/** Pixels of touch travel before a drag commits to spin vs. sheet scroll. */
export const SPIN_LOCK_PX = 10;

/**
 * Directional-lock decision for a touch drag that starts on the preview
 * (Bug 2 gesture fix). Returns null while the gesture is still ambiguous
 * (keep waiting), true when horizontal-dominant (spin the figure), false
 * when vertical-dominant (hands off — the sheet scrolls natively via
 * touch-action: pan-y). Ties fall to scroll: the sheet always wins
 * ambiguous gestures, so a vertical swipe never gets trapped spinning.
 */
export function decideSpinLock(dx: number, dy: number): boolean | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SPIN_LOCK_PX) return null;
  return Math.abs(dx) > Math.abs(dy);
}

/** True when a framing matches a preset closely enough to light its button. */
export function matchesPreset(f: CameraFraming, p: CameraFraming): boolean {
  return (
    Math.abs(f.distance - p.distance) < 0.2 &&
    Math.abs(f.targetY - p.targetY) < 0.2
  );
}

/** Cubic ease-in-out for preset camera transitions (0..1 -> 0..1). */
export function easeInOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/**
 * Camera world position for a framing. The camera stays on the studio's
 * center axis (the figure spins, not the camera) with a slight downward
 * tilt that flatters both face and full-body shots.
 */
export function cameraPositionFor(
  f: CameraFraming
): { x: number; y: number; z: number } {
  return { x: 0, y: f.targetY + f.distance * 0.07, z: f.distance };
}
