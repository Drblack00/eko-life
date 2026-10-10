/**
 * M16 — orbit camera rig math for the 3D home room.
 *
 * Pure logic (no DOM / no Three.js) matching the CityMap gesture language:
 * damped/inertial orbiting, pinch/wheel zoom, two-finger pan, double-tap
 * reset. RoomCanvas wires these helpers to pointer events.
 */

export interface CameraRigState {
  /** Radians, unbounded (wraps naturally through sin/cos). */
  azimuth: number;
  /** Radians from +Y; clamped to 25°–70°. */
  polar: number;
  /** Orbit radius; clamped to 5–15 (keeps the M14/M15 zoom feel). */
  dist: number;
  /** Look target. Pan clamps x/z to ±2.5 around room center. */
  tx: number;
  ty: number;
  tz: number;
}

export const CAM_MIN_DIST = 5;
export const CAM_MAX_DIST = 15;
export const CAM_MIN_POLAR = (25 * Math.PI) / 180;
export const CAM_MAX_POLAR = (70 * Math.PI) / 180;
export const CAM_PAN_CLAMP = 2.5;
export const ORBIT_SPEED = 0.005; // radians of orbit per px of drag
export const PAN_SPEED = 0.0018; // world units per px of pan, scaled by dist
export const TAP_MAX_PX = 10;
export const TAP_MAX_MS = 300;
export const DOUBLE_TAP_MAX_MS = 350;
export const DOUBLE_TAP_MAX_PX = 24;

export const DEFAULT_CAMERA: CameraRigState = {
  azimuth: Math.PI / 4,
  // M14 framing: camera height = dist * 0.9 with horizontal radius = dist,
  // i.e. polar = atan2(1, 0.9) ≈ 48°, looking at (0, 0.4, 0).
  polar: Math.atan2(1, 0.9),
  dist: 9.5,
  tx: 0,
  ty: 0.4,
  tz: 0,
};

/**
 * Camera world position from rig state.
 * Mirrors RoomCanvas.placeCamera — keep the two in sync.
 */
export function cameraPosition(s: CameraRigState): {
  x: number;
  y: number;
  z: number;
} {
  const h = s.dist / Math.tan(s.polar);
  return {
    x: s.tx + Math.cos(s.azimuth) * s.dist,
    y: s.ty + h,
    z: s.tz + Math.sin(s.azimuth) * s.dist,
  };
}

/**
 * Snap azimuth to the nearest 90° step on the π/4 base (the classic
 * corner-on room views). Pressing "Turn the room" while already on a snap
 * advances one step so repeated presses keep turning.
 */
export function snapAzimuth90(azimuth: number): number {
  const step = Math.PI / 2;
  const base = Math.PI / 4;
  let snapped = base + Math.round((azimuth - base) / step) * step;
  if (Math.abs(snapped - azimuth) < 0.02) snapped += step;
  return snapped;
}

export function clampPolar(polar: number): number {
  return Math.min(CAM_MAX_POLAR, Math.max(CAM_MIN_POLAR, polar));
}

export function zoomDist(dist: number, factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return dist;
  return Math.min(CAM_MAX_DIST, Math.max(CAM_MIN_DIST, dist * factor));
}

export interface GroundVec {
  x: number;
  z: number;
}

/**
 * Ground-plane basis for two-finger panning at a given azimuth:
 * right = screen-right on the ground, toCam = ground direction from the
 * look target toward the camera.
 */
export function panBasis(azimuth: number): { right: GroundVec; toCam: GroundVec } {
  return {
    right: { x: Math.sin(azimuth), z: -Math.cos(azimuth) },
    toCam: { x: Math.cos(azimuth), z: Math.sin(azimuth) },
  };
}

export function clampPan(v: number): number {
  return Math.min(CAM_PAN_CLAMP, Math.max(-CAM_PAN_CLAMP, v));
}

/**
 * World-space look-target delta for a two-finger midpoint drag.
 * Content follows the fingers: dragging right/down shifts the world with
 * the fingers, so the target moves the opposite way.
 */
export function panDelta(
  right: GroundVec,
  toCam: GroundVec,
  dx: number,
  dy: number,
  dist: number
): GroundVec {
  const s = dist * PAN_SPEED;
  return {
    x: -(dx * right.x + dy * toCam.x) * s,
    z: -(dx * right.z + dy * toCam.z) * s,
  };
}

/** Tap = ≤10px movement AND <300ms press. */
export function isTap(movedPx: number, durationMs: number): boolean {
  return movedPx <= TAP_MAX_PX && durationMs < TAP_MAX_MS;
}

/** Two qualifying taps close in time and space = double-tap. */
export function isDoubleTap(
  prev: { t: number; x: number; y: number } | null,
  now: { t: number; x: number; y: number }
): boolean {
  if (!prev) return false;
  return (
    now.t - prev.t < DOUBLE_TAP_MAX_MS &&
    Math.hypot(now.x - prev.x, now.y - prev.y) <= DOUBLE_TAP_MAX_PX
  );
}
