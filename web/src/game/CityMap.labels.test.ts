/**
 * Client unit tests — game/CityMap.labels.ts.
 * Pure data/geometry/color helpers only; no DOM / no Three.js.
 */
import { describe, expect, it } from "vitest";
import {
  DISTRICT_LABELS,
  PILL_CANVAS_H,
  PIN_LABEL_ZOOM_DIST,
  pillTextSize,
  pillWorldScale,
  resolvePillColors,
} from "./CityMap.labels";

const EXPECTED_NAMES = [
  "Lekki",
  "Victoria Island",
  "Ikoyi",
  "Ikeja",
  "Yaba",
  "Surulere",
  "Apapa",
  "Oshodi",
  "Maryland",
  "Agege",
  "Ikorodu",
];

const byName = (name: string) =>
  DISTRICT_LABELS.find((d) => d.name === name) ?? null;

describe("DISTRICT_LABELS — place coverage", () => {
  it("names every popular Lagos place the map should show", () => {
    expect(DISTRICT_LABELS.map((d) => d.name).sort()).toEqual(
      [...EXPECTED_NAMES].sort()
    );
  });

  it("has unique, non-empty names", () => {
    const names = DISTRICT_LABELS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n.trim().length).toBeGreaterThan(0);
  });

  it("keeps every label inside world bounds and clear of the lagoon channel", () => {
    for (const d of DISTRICT_LABELS) {
      expect(Math.abs(d.x)).toBeLessThanOrEqual(86);
      expect(Math.abs(d.z)).toBeLessThanOrEqual(86);
      // Lagoon channel is |x| < 13; district labels sit on land.
      expect(Math.abs(d.x)).toBeGreaterThan(13);
    }
  });

  it("puts island places on the island side, mainland places on the mainland side", () => {
    const island = DISTRICT_LABELS.filter((d) => d.zone === "island");
    const mainland = DISTRICT_LABELS.filter((d) => d.zone === "mainland");
    expect(island.map((d) => d.name).sort()).toEqual([
      "Ikoyi",
      "Lekki",
      "Victoria Island",
    ]);
    expect(mainland).toHaveLength(8);
    for (const d of island) expect(d.x).toBeGreaterThan(0);
    for (const d of mainland) expect(d.x).toBeLessThan(0);
  });

  it("respects real-world relative positions (-z = north, +x = east)", () => {
    const lekki = byName("Lekki")!;
    const ikoyi = byName("Ikoyi")!;
    const vi = byName("Victoria Island")!;
    const ikeja = byName("Ikeja")!;
    const oshodi = byName("Oshodi")!;
    const agege = byName("Agege")!;
    const apapa = byName("Apapa")!;
    const ikorodu = byName("Ikorodu")!;
    const yaba = byName("Yaba")!;
    const surulere = byName("Surulere")!;

    expect(lekki.x).toBeGreaterThan(ikoyi.x); // Lekki east of Ikoyi
    expect(vi.x).toBeGreaterThan(ikoyi.x); // Victoria Island east of Ikoyi
    expect(vi.x).toBeLessThan(lekki.x); // Victoria Island west of Lekki
    expect(ikoyi.z).toBeLessThan(lekki.z); // Ikoyi north of Lekki
    expect(ikeja.z).toBeLessThan(oshodi.z); // Ikeja north of Oshodi
    expect(agege.z).toBeLessThan(apapa.z); // Agege north of Apapa
    expect(ikorodu.x).toBeGreaterThan(agege.x); // Ikorodu east of Agege
    expect(apapa.x).toBeLessThan(yaba.x); // Apapa west of Yaba
    expect(surulere.z).toBeLessThan(apapa.z); // Surulere north of Apapa
  });
});

describe("resolvePillColors — theme tokens", () => {
  it("reads the app's theme tokens", () => {
    const vars: Record<string, string> = {
      "--surface": "#12293d",
      "--text": "#f2f7fb",
      "--ring": "#0ea5e9",
    };
    expect(resolvePillColors((n) => vars[n] ?? null)).toEqual({
      bg: "#12293d",
      fg: "#f2f7fb",
      ring: "#0ea5e9",
    });
  });

  it("trims token values", () => {
    expect(
      resolvePillColors(() => "  #ffffff  ").bg
    ).toBe("#ffffff");
  });

  it("falls back safely when tokens are missing or blank", () => {
    const missing = resolvePillColors(() => null);
    expect(missing).toEqual({
      bg: "#ffffff",
      fg: "#1c1814",
      ring: "#0ea5e9",
    });
    const blank = resolvePillColors(() => "   ");
    expect(blank.bg).toBe("#ffffff");
    expect(blank.fg).toBe("#1c1814");
    expect(blank.ring).toBe("#0ea5e9");
  });
});

describe("pill geometry helpers", () => {
  it("pillTextSize grows with the text and keeps a minimum width", () => {
    const fakeMeasure = (t: string) => t.length * 30;
    const short = pillTextSize("Yaba", fakeMeasure);
    const long = pillTextSize("Victoria Island", fakeMeasure);
    expect(long.w).toBeGreaterThan(short.w);
    expect(short.h).toBe(PILL_CANVAS_H);
    expect(long.h).toBe(PILL_CANVAS_H);
    expect(short.w).toBeGreaterThanOrEqual(160);
  });

  it("pillWorldScale preserves the canvas aspect ratio", () => {
    const s = pillWorldScale(560, 112, 4);
    expect(s.y).toBe(4);
    expect(s.x).toBeCloseTo(20, 6);
  });

  it("PIN_LABEL_ZOOM_DIST sits between the close-zoom band and the default framing", () => {
    // OrbitControls: minDistance 55, default camera ≈ 141 units out.
    expect(PIN_LABEL_ZOOM_DIST).toBeGreaterThan(80);
    expect(PIN_LABEL_ZOOM_DIST).toBeLessThan(141);
  });
});
