/**
 * AvatarStudio presentation helpers (M20 workstream 3).
 *
 * Pure, framework-free camera math for the studio preview:
 * camera presets, zoom clamping, and look-at drift. The React component
 * (AvatarStudio.tsx) consumes these; unit tests live in studio.test.ts.
 */

export interface CameraFraming {
  /** Distance from the camera to the look-at point. */
  distance: number;
  /** Height of the look-at point on the figure. */
  targetY: number;
}

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
 * Look-at height that follows the zoom level: as the camera moves in, the
 * framing drifts up toward the head so a pinch-zoom naturally lands on the
 * face; as it pulls back, it settles on the figure's center of mass.
 */
export function targetYForDistance(distance: number): number {
  const d = clampZoom(distance);
  const t = (d - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN);
  const eased = t * t * (3 - 2 * t); // smoothstep
  return FACE_PRESET.targetY + (BODY_PRESET.targetY - FACE_PRESET.targetY) * eased;
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
