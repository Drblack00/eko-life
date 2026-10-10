/**
 * Unit tests for AvatarStudio camera helpers (M20 workstream 3).
 * Pure math — no DOM, no Three.js.
 */
import { describe, expect, it } from "vitest";
import {
  BODY_PRESET,
  DEFAULT_FRAMING,
  FACE_PRESET,
  ZOOM_MAX,
  ZOOM_MIN,
  cameraPositionFor,
  clampZoom,
  easeInOutCubic,
  matchesPreset,
  targetYForDistance,
} from "./studio";

describe("clampZoom", () => {
  it("clamps below the minimum to ZOOM_MIN", () => {
    expect(clampZoom(0.2)).toBe(ZOOM_MIN);
    expect(clampZoom(-5)).toBe(ZOOM_MIN);
  });
  it("clamps above the maximum to ZOOM_MAX", () => {
    expect(clampZoom(99)).toBe(ZOOM_MAX);
  });
  it("passes in-range values through untouched", () => {
    expect(clampZoom(2.4)).toBe(2.4);
  });
  it("falls back to the default framing for non-finite input", () => {
    expect(clampZoom(NaN)).toBe(DEFAULT_FRAMING.distance);
    expect(clampZoom(Infinity)).toBe(DEFAULT_FRAMING.distance);
  });
});

describe("targetYForDistance", () => {
  it("points at the head at minimum zoom", () => {
    expect(targetYForDistance(ZOOM_MIN)).toBeCloseTo(FACE_PRESET.targetY, 6);
  });
  it("points at the body center at maximum zoom", () => {
    expect(targetYForDistance(ZOOM_MAX)).toBeCloseTo(BODY_PRESET.targetY, 6);
  });
  it("drifts monotonically downward as the camera pulls back", () => {
    const ys = [1.2, 1.8, 2.6, 3.4, 4.2].map(targetYForDistance);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThan(ys[i - 1]);
  });
  it("stays within the preset extremes for clamped out-of-range input", () => {
    const y = targetYForDistance(0.01);
    expect(y).toBeGreaterThanOrEqual(BODY_PRESET.targetY);
    expect(y).toBeLessThanOrEqual(FACE_PRESET.targetY);
  });
});

describe("matchesPreset", () => {
  it("matches an identical framing", () => {
    expect(matchesPreset({ ...FACE_PRESET }, FACE_PRESET)).toBe(true);
    expect(matchesPreset({ ...BODY_PRESET }, BODY_PRESET)).toBe(true);
  });
  it("rejects the other preset", () => {
    expect(matchesPreset(FACE_PRESET, BODY_PRESET)).toBe(false);
  });
  it("rejects a mid-zoom framing", () => {
    expect(matchesPreset({ distance: 2.2, targetY: 1.2 }, FACE_PRESET)).toBe(false);
    expect(matchesPreset({ distance: 2.2, targetY: 1.2 }, BODY_PRESET)).toBe(false);
  });
  it("matches the Face preset at full pinch-in (ZOOM_MIN)", () => {
    expect(
      matchesPreset(
        { distance: ZOOM_MIN, targetY: targetYForDistance(ZOOM_MIN) },
        FACE_PRESET
      )
    ).toBe(true);
  });
});

describe("easeInOutCubic", () => {
  it("maps 0->0 and 1->1", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
  });
  it("passes through 0.5 at the midpoint", () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6);
  });
  it("clamps out-of-range input", () => {
    expect(easeInOutCubic(-2)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });
});

describe("cameraPositionFor", () => {
  it("places the camera on the center axis at the framing distance", () => {
    const p = cameraPositionFor(FACE_PRESET);
    expect(p.x).toBe(0);
    expect(p.z).toBe(FACE_PRESET.distance);
  });
  it("raises the camera slightly above the look-at point", () => {
    const p = cameraPositionFor(BODY_PRESET);
    expect(p.y).toBeGreaterThan(BODY_PRESET.targetY);
  });
});
