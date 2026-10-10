/**
 * Client unit tests — views/home/cameraRig.ts M16 orbit camera math.
 * Pure logic only; no DOM / no Three.js.
 */
import { describe, expect, it } from "vitest";
import {
  CAM_MAX_DIST,
  CAM_MAX_POLAR,
  CAM_MIN_DIST,
  CAM_MIN_POLAR,
  CAM_PAN_CLAMP,
  DEFAULT_CAMERA,
  cameraPosition,
  clampPan,
  clampPolar,
  isDoubleTap,
  isTap,
  panBasis,
  panDelta,
  snapAzimuth90,
  zoomDist,
} from "./cameraRig";

const DEG = (180 / Math.PI);

describe("DEFAULT_CAMERA", () => {
  it("keeps the M14/M15 default framing: 45° corner view, ~48° polar, dist 9.5", () => {
    expect(DEFAULT_CAMERA.azimuth).toBeCloseTo(Math.PI / 4, 6);
    expect(DEFAULT_CAMERA.polar * DEG).toBeGreaterThanOrEqual(25);
    expect(DEFAULT_CAMERA.polar * DEG).toBeLessThanOrEqual(70);
    expect(DEFAULT_CAMERA.polar * DEG).toBeCloseTo(48, 0);
    expect(DEFAULT_CAMERA.dist).toBe(9.5);
    expect([DEFAULT_CAMERA.tx, DEFAULT_CAMERA.ty, DEFAULT_CAMERA.tz]).toEqual([
      0, 0.4, 0,
    ]);
  });

  it("cameraPosition preserves the old isometric placement (y = dist*0.9 above target, radius = dist)", () => {
    const p = cameraPosition(DEFAULT_CAMERA);
    const horiz = Math.hypot(p.x - DEFAULT_CAMERA.tx, p.z - DEFAULT_CAMERA.tz);
    expect(horiz).toBeCloseTo(DEFAULT_CAMERA.dist, 6);
    expect(p.y - DEFAULT_CAMERA.ty).toBeCloseTo(DEFAULT_CAMERA.dist * 0.9, 6);
  });
});

describe("snapAzimuth90", () => {
  it("snaps to the nearest 90° step on the π/4 base", () => {
    expect(snapAzimuth90(Math.PI / 4 + 1.0)).toBeCloseTo(Math.PI / 4 + Math.PI / 2, 6);
    expect(snapAzimuth90(Math.PI / 4 + 0.4)).toBeCloseTo(Math.PI / 4, 6);
    expect(snapAzimuth90(Math.PI / 4 - 0.4)).toBeCloseTo(Math.PI / 4, 6);
    expect(snapAzimuth90(0)).toBeCloseTo(Math.PI / 4, 6);
  });

  it("advances one step when already on a snap (repeated 'Turn the room' presses keep turning)", () => {
    expect(snapAzimuth90(Math.PI / 4)).toBeCloseTo(Math.PI / 4 + Math.PI / 2, 6);
  });

  it("handles negative / wrapped azimuths", () => {
    const s = snapAzimuth90(-3 * Math.PI);
    expect(Math.abs(s - Math.round((s - Math.PI / 4) / (Math.PI / 2)) * (Math.PI / 2) - Math.PI / 4)).toBeLessThan(0.03);
  });
});

describe("clampPolar / zoomDist", () => {
  it("clamps polar to 25°–70°", () => {
    expect(clampPolar(0)).toBe(CAM_MIN_POLAR);
    expect(clampPolar(2)).toBe(CAM_MAX_POLAR);
    expect(clampPolar(1)).toBe(1);
  });

  it("keeps the M14 zoom range 5–15", () => {
    expect(zoomDist(9.5, 2)).toBe(CAM_MAX_DIST);
    expect(zoomDist(9.5, 0.1)).toBe(CAM_MIN_DIST);
    expect(zoomDist(9.5, 1)).toBe(9.5);
    expect(zoomDist(9.5, NaN)).toBe(9.5);
    expect(zoomDist(9.5, -1)).toBe(9.5);
  });
});

describe("two-finger pan", () => {
  it("panBasis(0): screen-right is world -z, toward-camera is world +x", () => {
    const { right, toCam } = panBasis(0);
    expect(right.x).toBeCloseTo(0, 6);
    expect(right.z).toBeCloseTo(-1, 6);
    expect(toCam.x).toBeCloseTo(1, 6);
    expect(toCam.z).toBeCloseTo(0, 6);
  });

  it("content follows the fingers: drag right → target moves +z (camera at +x)", () => {
    const { right, toCam } = panBasis(0);
    const d = panDelta(right, toCam, 100, 0, 9.5);
    expect(d.x).toBeCloseTo(0, 6);
    expect(d.z).toBeCloseTo(100 * 0.0018 * 9.5, 6);
  });

  it("drag down moves the target toward the camera", () => {
    const { right, toCam } = panBasis(0);
    const d = panDelta(right, toCam, 0, 100, 9.5);
    expect(d.x).toBeCloseTo(-(100 * 0.0018 * 9.5), 6);
    expect(d.z).toBeCloseTo(0, 6);
  });

  it("clamps the pan target to ±2.5 units around room center", () => {
    expect(clampPan(9)).toBe(CAM_PAN_CLAMP);
    expect(clampPan(-9)).toBe(-CAM_PAN_CLAMP);
    expect(clampPan(1.2)).toBe(1.2);
  });
});

describe("tap / double-tap", () => {
  it("tap = ≤10px and <300ms", () => {
    expect(isTap(10, 299)).toBe(true);
    expect(isTap(11, 100)).toBe(false);
    expect(isTap(5, 300)).toBe(false);
    expect(isTap(0, 0)).toBe(true);
  });

  it("double-tap = two taps within 350ms and 24px", () => {
    const first = { t: 1000, x: 50, y: 60 };
    expect(isDoubleTap(first, { t: 1200, x: 55, y: 62 })).toBe(true);
    expect(isDoubleTap(first, { t: 1500, x: 55, y: 62 })).toBe(false);
    expect(isDoubleTap(first, { t: 1200, x: 200, y: 62 })).toBe(false);
    expect(isDoubleTap(null, { t: 1200, x: 55, y: 62 })).toBe(false);
  });
});
