/**
 * Client unit tests — game/mapPins.ts `toPin` mapper (+ mapToWorld helpers).
 * Pure coordinate math only; no DOM / no Three.js.
 */
import { describe, expect, it } from "vitest";
import { declutterPins, mapToWorld, mapXYToWorld, toPin } from "./mapPins";

describe("toPin — server shape {region,icon,x:0..100,y:0..100}", () => {
  it("maps server 0..100 coords into world space (-86..86)", () => {
    const pin = toPin(
      { id: "l1", name: "Sunrise Market", region: "mainland", icon: "🧺", x: 0, y: 0 },
      0,
      10
    );
    expect(pin.x).toBeCloseTo(-86, 6);
    expect(pin.z).toBeCloseTo(-86, 6);
    expect(pin.zone).toBe("mainland");
    expect(pin.emoji).toBe("🧺");
    expect(pin.name).toBe("Sunrise Market");
  });

  it("maps the opposite corner and the midpoint", () => {
    const corner = toPin({ id: "a", name: "A", x: 100, y: 100 }, 0, 1);
    expect(corner.x).toBeCloseTo(86, 6);
    expect(corner.z).toBeCloseTo(86, 6);
    const mid = toPin({ id: "b", name: "B", x: 50, y: 50 }, 0, 1);
    expect(mid.x).toBeCloseTo(0, 6);
    expect(mid.z).toBeCloseTo(0, 6);
  });

  it("clamps out-of-range server coords to ±86", () => {
    const pin = toPin({ id: "a", name: "A", x: -40, y: 220 }, 0, 1);
    expect(pin.x).toBe(-86);
    expect(pin.z).toBe(86);
  });

  it("prefers the explicit zone field, falls back to region", () => {
    const z = toPin(
      { id: "a", name: "A", zone: "island", region: "mainland", x: 10, y: 10 },
      0,
      1
    );
    expect(z.zone).toBe("island");
    const r = toPin({ id: "a", name: "A", region: "lagoon", x: 10, y: 10 }, 0, 1);
    expect(r.zone).toBe("lagoon");
  });
});

describe("toPin — fallback shapes", () => {
  it("uses raw x/z world coords directly when present (clamped)", () => {
    const pin = toPin({ id: "a", name: "A", x: 42.5, z: -17.25 }, 0, 1);
    expect(pin.x).toBeCloseTo(42.5, 6);
    expect(pin.z).toBeCloseTo(-17.25, 6);
    const over = toPin({ id: "b", name: "B", x: 999, z: -999 }, 0, 1);
    expect(over.x).toBe(86);
    expect(over.z).toBe(-86);
  });

  it("spreads lat/lng across the map and stays out of the lagoon channel", () => {
    const pin = toPin({ id: "a", name: "A", lat: 6.45, lng: 3.39 }, 0, 1);
    expect(pin.x).toBeGreaterThanOrEqual(-86);
    expect(pin.x).toBeLessThanOrEqual(86);
    expect(pin.z).toBeGreaterThanOrEqual(-86);
    expect(pin.z).toBeLessThanOrEqual(86);
    expect(Math.abs(pin.x)).toBeGreaterThanOrEqual(20);
  });

  it("deterministically scatters coord-less pins to a region mass by index", () => {
    const a = toPin({ id: "a", name: "A", region: "island" }, 3, 24);
    const b = toPin({ id: "a", name: "A", region: "island" }, 3, 24);
    expect(a.x).toBe(b.x);
    expect(a.z).toBe(b.z);
    expect(a.x).toBeGreaterThan(0); // island mass → positive x
    expect(a.zone).toBe("island");

    const mainland = toPin({ id: "c", name: "C", region: "mainland" }, 5, 24);
    expect(mainland.x).toBeLessThan(0);

    const other = toPin({ id: "d", name: "D" }, 7, 24);
    expect(other.x).toBeGreaterThanOrEqual(-86);
    expect(other.z).toBeGreaterThanOrEqual(-86);
  });
});

describe("toPin — defensive identity fields", () => {
  it("defaults id, name, emoji and blurb when missing", () => {
    const pin = toPin({} as never, 4, 10);
    expect(pin.id).toBe("loc-4");
    expect(pin.name).toBe("Mystery spot");
    expect(pin.emoji).toBe("📍");
    expect(pin.blurb).toContain("Create a character");
  });

  it("prefers emoji over icon and blurb over desc", () => {
    const pin = toPin(
      { id: "a", name: "A", emoji: "🏖️", icon: "🌊", blurb: "beach", desc: "old" } as never,
      0,
      1
    );
    expect(pin.emoji).toBe("🏖️");
    expect(pin.blurb).toBe("beach");
  });
});

describe("mapToWorld / mapXYToWorld", () => {
  it("mapToWorld converts {lat,lng} map coords like the server shape", () => {
    const w = mapToWorld(0, 100);
    expect(w.x).toBeCloseTo(86, 6);
    expect(w.z).toBeCloseTo(-86, 6);
  });

  it("mapXYToWorld converts {x,y} map coords and clamps", () => {
    const w = mapXYToWorld(50, 50);
    expect(w.x).toBeCloseTo(0, 6);
    expect(w.z).toBeCloseTo(0, 6);
    const o = mapXYToWorld(-10, 120);
    expect(o.x).toBe(-86);
    expect(o.z).toBe(86);
  });
});

describe("declutterPins", () => {
  const mk = (x: number, z: number, id: string) => ({
    id, name: id, emoji: "📍", blurb: "", x, z, zone: "mainland" as const,
  });

  it("separates exactly-stacked pins", () => {
    const out = declutterPins([mk(0, 0, "a"), mk(0, 0, "b"), mk(0, 0, "c")]);
    expect(out).toHaveLength(3);
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++)
        expect(Math.hypot(out[i].x - out[j].x, out[i].z - out[j].z)).toBeGreaterThanOrEqual(6.9);
  });

  it("leaves already-spread pins untouched", () => {
    const pins = [mk(-80, -80, "a"), mk(80, 80, "b"), mk(0, 0, "c")];
    const out = declutterPins(pins);
    expect(out[0].x).toBeCloseTo(-80, 6);
    expect(out[2].z).toBeCloseTo(0, 6);
  });

  it("keeps every pin inside the map bounds", () => {
    const pins = Array.from({ length: 20 }, (_, i) => mk(84, 84, `p${i}`));
    const out = declutterPins(pins);
    for (const p of out) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(84);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(84);
    }
  });

  it("is deterministic", () => {
    const pins = [mk(10, 10, "a"), mk(11, 10, "b"), mk(10, 11, "c")];
    const a = declutterPins(pins);
    const b = declutterPins(pins);
    expect(a).toEqual(b);
  });
});
