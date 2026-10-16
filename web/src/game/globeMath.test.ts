/**
 * Unit tests for game/globeMath.ts — pure math, no WebGL.
 */
import { describe, expect, it } from "vitest";
import {
  CITY_LATLON,
  LOCKED_COUNTRIES,
  clamp,
  easeIO,
  greatCirclePoints,
  latLonToVec3,
  smooth,
  zoomStage,
} from "./globeMath";

describe("latLonToVec3", () => {
  it("maps equator/prime-meridian to (r, 0, 0)", () => {
    const [x, y, z] = latLonToVec3(0, 0, 100);
    expect(x).toBeCloseTo(100, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it("maps the north pole to (0, r, 0)", () => {
    const [x, y, z] = latLonToVec3(90, 0, 100);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(100, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it("lands Nigeria near the expected spot", () => {
    const [x, y, z] = latLonToVec3(9.08, 8.68, 100);
    expect(Math.hypot(x, y, z)).toBeCloseTo(100, 6);
    expect(y).toBeGreaterThan(0); // northern hemisphere
    expect(x).toBeGreaterThan(0);
    expect(z).toBeLessThan(0); // lon>0 → -z by convention
  });
});

describe("smooth / easeIO / clamp", () => {
  it("smooth clamps outside the edge range", () => {
    expect(smooth(0.2, 0.8, 0)).toBe(0);
    expect(smooth(0.2, 0.8, 1)).toBe(1);
    expect(smooth(0.2, 0.8, 0.5)).toBeCloseTo(0.5, 6);
  });

  it("easeIO hits 0 and 1 and is symmetric", () => {
    expect(easeIO(0)).toBe(0);
    expect(easeIO(1)).toBe(1);
    expect(easeIO(0.25)).toBeCloseTo(1 - easeIO(0.75), 6);
  });

  it("clamp bounds values", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-2, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});

describe("greatCirclePoints", () => {
  it("starts and ends at the two cities on the globe", () => {
    const [la1, lo1] = [CITY_LATLON.lagos[0], CITY_LATLON.lagos[1]];
    const [la2, lo2] = [CITY_LATLON.abuja[0], CITY_LATLON.abuja[1]];
    const pts = greatCirclePoints(la1, lo1, la2, lo2, 100);
    expect(pts).toHaveLength(73);
    const [sx, sy, sz] = pts[0];
    const [ex, ey, ez] = pts[pts.length - 1];
    const [ax, ay, az] = latLonToVec3(la1, lo1, 100);
    const [bx, by, bz] = latLonToVec3(la2, lo2, 100);
    // endpoints sit just above the surface (R + 1.2)
    expect(Math.hypot(sx - ax, sy - ay, sz - az)).toBeLessThan(2);
    expect(Math.hypot(ex - bx, ey - by, ez - bz)).toBeLessThan(2);
  });

  it("lifts the midpoint above the surface", () => {
    const pts = greatCirclePoints(6.5, 3.4, 9.0, 7.5, 100);
    const mid = pts[Math.floor(pts.length / 2)];
    expect(Math.hypot(mid[0], mid[1], mid[2])).toBeGreaterThan(102);
  });
});

describe("zoomStage", () => {
  it("walks through the 5 stages in order", () => {
    expect(zoomStage(0)).toBe(0);
    expect(zoomStage(0.3)).toBe(1);
    expect(zoomStage(0.5)).toBe(2);
    expect(zoomStage(0.7)).toBe(3);
    expect(zoomStage(1)).toBe(4);
  });
});

describe("data tables", () => {
  it("has 4 playable cities with sane lat/lon", () => {
    for (const id of ["lagos", "benin", "ph", "abuja"]) {
      const [lat, lon] = CITY_LATLON[id];
      expect(lat).toBeGreaterThan(0);
      expect(lat).toBeLessThan(15);
      expect(lon).toBeGreaterThan(0);
      expect(lon).toBeLessThan(15);
    }
  });

  it("lists 5 locked countries", () => {
    expect(LOCKED_COUNTRIES).toHaveLength(5);
    for (const c of LOCKED_COUNTRIES) {
      expect(c.flag.length).toBeGreaterThan(0);
      expect(c.name.length).toBeGreaterThan(0);
    }
  });
});
