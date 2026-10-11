/**
 * Unit tests for AvatarStudio camera helpers (M20 workstream 3).
 * Pure math — no DOM, no Three.js.
 */
import { describe, expect, it } from "vitest";
import {
  BODY_HALF_WIDTH,
  BODY_PRESET,
  DEFAULT_FRAMING,
  FACE_HALF_WIDTH,
  FACE_PRESET,
  FIGURE_CHIN_Y,
  FIGURE_FEET_Y,
  FIGURE_HAIR_TOP_Y,
  FRAMING_MARGIN_Y,
  PREVIEW_TOP_UI_PX,
  SPIN_LOCK_PX,
  STUDIO_FOV_DEG,
  ZOOM_MAX,
  ZOOM_MIN,
  cameraPositionFor,
  clampZoom,
  compensateDistance,
  decideSpinLock,
  driftTargetY,
  easeInOutCubic,
  framingForContainer,
  halfWidthForDistance,
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

const TAN_H = Math.tan((STUDIO_FOV_DEG * Math.PI) / 360);
/** Vertical frame half-extent for a framing. */
const halfH = (f: { distance: number }) => TAN_H * f.distance;

describe("framingForContainer", () => {
  it("keeps the tallest hair top clear of the overlaid pills (Face, embedded card)", () => {
    // Actual embedded card geometry: ~328px wide in the phone sheet.
    const f = framingForContainer("face", 328, 340);
    const top = f.targetY + halfH(f);
    const hairTop = FIGURE_HAIR_TOP_Y + FRAMING_MARGIN_Y;
    // Hair top sits at least PREVIEW_TOP_UI_PX below the frame top.
    const pxFromTop = ((top - hairTop) / (2 * halfH(f))) * 340;
    expect(pxFromTop).toBeGreaterThanOrEqual(PREVIEW_TOP_UI_PX - 1e-9);
  });

  it("keeps the chin visible with margin (Face)", () => {
    const f = framingForContainer("face", 328, 340);
    expect(f.targetY - halfH(f)).toBeLessThanOrEqual(
      FIGURE_CHIN_Y - FRAMING_MARGIN_Y
    );
  });

  it("keeps feet and hair top in frame with pills clearance (Full body)", () => {
    const f = framingForContainer("body", 328, 340);
    expect(f.targetY - halfH(f)).toBeLessThanOrEqual(
      FIGURE_FEET_Y - FRAMING_MARGIN_Y
    );
    const top = f.targetY + halfH(f);
    const hairTop = FIGURE_HAIR_TOP_Y + FRAMING_MARGIN_Y;
    const pxFromTop = ((top - hairTop) / (2 * halfH(f))) * 340;
    expect(pxFromTop).toBeGreaterThanOrEqual(PREVIEW_TOP_UI_PX - 1e-9);
  });

  it("dollies out for narrow containers so the head keeps sideways clearance", () => {
    const wide = framingForContainer("face", 328, 340);
    const narrow = framingForContainer("face", 150, 340);
    expect(narrow.distance).toBeGreaterThan(wide.distance);
    // Horizontal half-extent still covers the afro + margin.
    expect(TAN_H * narrow.distance * (150 / 340)).toBeGreaterThanOrEqual(
      FACE_HALF_WIDTH
    );
  });

  it("converges near the classic presets for tall, reasonably-wide cards", () => {
    const face = framingForContainer("face", 700, 800);
    const body = framingForContainer("body", 700, 800);
    expect(face.distance).toBeGreaterThan(1.0);
    expect(face.distance).toBeLessThan(1.4);
    expect(body.distance).toBeGreaterThan(3.2);
    expect(body.distance).toBeLessThan(3.8);
  });

  it("stays inside the zoom range for extreme containers", () => {
    for (const [w, h] of [
      [100, 120],
      [800, 200],
      [200, 900],
    ] as Array<[number, number]>) {
      for (const kind of ["face", "body"] as const) {
        const f = framingForContainer(kind, w, h);
        expect(f.distance).toBeGreaterThanOrEqual(ZOOM_MIN);
        expect(f.distance).toBeLessThanOrEqual(ZOOM_MAX);
        expect(Number.isFinite(f.targetY)).toBe(true);
      }
    }
  });
});

describe("fix round 2 anchors (head scale-up)", () => {
  it("anchors the tallest-hair constant at the measured afro top", () => {
    // Per-hairstyle Box3 with HEAD_GROUP_SCALE=1.08: afro maxY 1.8358,
    // chin still at 1.4 (head group scales about the neck-top origin).
    expect(FIGURE_HAIR_TOP_Y).toBeGreaterThanOrEqual(1.8358);
    expect(FIGURE_HAIR_TOP_Y).toBeLessThanOrEqual(1.86);
    expect(FIGURE_CHIN_Y).toBeCloseTo(1.4, 5);
  });

  it("keeps chin and afro top inside the frame on the phone card (Face)", () => {
    const f = framingForContainer("face", 358, 340);
    const top = f.targetY + TAN_H * f.distance;
    const bottom = f.targetY - TAN_H * f.distance;
    expect(bottom).toBeLessThanOrEqual(FIGURE_CHIN_Y - FRAMING_MARGIN_Y);
    expect(top).toBeGreaterThanOrEqual(FIGURE_HAIR_TOP_Y + FRAMING_MARGIN_Y);
    // Not pushed low like the pre-fix evidence: the headroom above the
    // hair top stays close to the reserved pill zone, not a big dark gap.
    const pxAbove =
      ((top - (FIGURE_HAIR_TOP_Y + FRAMING_MARGIN_Y)) / (2 * TAN_H * f.distance)) * 340;
    expect(pxAbove).toBeLessThan(PREVIEW_TOP_UI_PX + 24);
  });

  it("keeps feet and afro top inside the frame on the phone card (Full body)", () => {
    const f = framingForContainer("body", 358, 340);
    const top = f.targetY + TAN_H * f.distance;
    const bottom = f.targetY - TAN_H * f.distance;
    expect(bottom).toBeLessThanOrEqual(FIGURE_FEET_Y - FRAMING_MARGIN_Y);
    expect(top).toBeGreaterThanOrEqual(FIGURE_HAIR_TOP_Y + FRAMING_MARGIN_Y);
  });
});

describe("compensateDistance", () => {
  it("leaves the distance alone for wide aspects", () => {
    expect(compensateDistance(1.15, 1.5)).toBe(1.15);
    expect(compensateDistance(3.4, 1.2)).toBe(3.4);
  });

  it("dollies out for narrow aspects until the half-width fits", () => {
    const d = compensateDistance(1.15, 0.4);
    expect(d).toBeGreaterThan(1.15);
    expect(TAN_H * d * 0.4).toBeGreaterThanOrEqual(
      halfWidthForDistance(1.15)
    );
  });

  it("never dollies in and never exceeds ZOOM_MAX", () => {
    expect(compensateDistance(2.0, 3)).toBe(2.0);
    expect(compensateDistance(1.15, 0.05)).toBeLessThanOrEqual(ZOOM_MAX);
  });
});

describe("halfWidthForDistance", () => {
  it("spans the face/body requirements at the zoom extremes", () => {
    expect(halfWidthForDistance(ZOOM_MIN)).toBeCloseTo(FACE_HALF_WIDTH, 6);
    expect(halfWidthForDistance(ZOOM_MAX)).toBeCloseTo(BODY_HALF_WIDTH, 6);
  });

  it("grows monotonically as the camera pulls back", () => {
    const ws = [1.2, 2.0, 3.0, 4.0].map(halfWidthForDistance);
    for (let i = 1; i < ws.length; i++) expect(ws[i]).toBeGreaterThan(ws[i - 1]);
  });
});

describe("driftTargetY", () => {
  it("hits the given endpoints", () => {
    expect(driftTargetY(ZOOM_MIN, 1.6, 1.0)).toBeCloseTo(1.6, 6);
    expect(driftTargetY(ZOOM_MAX, 1.6, 1.0)).toBeCloseTo(1.0, 6);
  });

  it("matches targetYForDistance with the classic presets", () => {
    for (const d of [1.15, 1.8, 2.6, 3.4, 4.6]) {
      expect(driftTargetY(d, FACE_PRESET.targetY, BODY_PRESET.targetY)).toBeCloseTo(
        targetYForDistance(d),
        9
      );
    }
  });
});

describe("decideSpinLock", () => {
  it("stays undecided below the travel threshold", () => {
    expect(decideSpinLock(0, 0)).toBeNull();
    expect(decideSpinLock(SPIN_LOCK_PX - 1, 0)).toBeNull();
    expect(decideSpinLock(3, 4)).toBeNull();
  });

  it("locks to spin for horizontal-dominant drags", () => {
    expect(decideSpinLock(40, 5)).toBe(true);
    expect(decideSpinLock(-30, 10)).toBe(true);
  });

  it("locks to scroll for vertical-dominant drags, ties included", () => {
    expect(decideSpinLock(5, 40)).toBe(false);
    expect(decideSpinLock(10, -30)).toBe(false);
    // Ambiguous diagonals fall to scroll — the sheet always wins.
    expect(decideSpinLock(25, 25)).toBe(false);
  });
});
