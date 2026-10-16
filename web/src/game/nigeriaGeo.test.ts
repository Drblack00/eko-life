import { describe, expect, it } from "vitest";
import {
  CITY_KM,
  PLAYABLE_CITIES,
  cityTravelFare,
  findRoad,
  project,
  roadKey,
} from "./nigeriaGeo";

describe("cityTravelFare (must match server/src/game/cities.js exactly)", () => {
  it("lagos → benin", () => {
    expect(cityTravelFare("lagos", "benin", "bus")).toBe(2000);
    expect(cityTravelFare("lagos", "benin", "flight")).toBe(7600);
  });
  it("lagos → ph", () => {
    expect(cityTravelFare("lagos", "ph", "bus")).toBe(3250);
    expect(cityTravelFare("lagos", "ph", "flight")).toBe(11300);
  });
  it("lagos → abuja", () => {
    expect(cityTravelFare("lagos", "abuja", "bus")).toBe(3800);
    expect(cityTravelFare("lagos", "abuja", "flight")).toBe(13000);
  });
  it("is symmetric", () => {
    expect(cityTravelFare("benin", "lagos", "bus")).toBe(2000);
    expect(cityTravelFare("ph", "abuja", "flight")).toBe(
      cityTravelFare("abuja", "ph", "flight")
    );
  });
  it("same city → 0", () => {
    expect(cityTravelFare("lagos", "lagos", "bus")).toBe(0);
    expect(cityTravelFare("ph", "ph", "flight")).toBe(0);
  });
  it("covers every playable pair", () => {
    for (const a of PLAYABLE_CITIES) {
      for (const b of PLAYABLE_CITIES) {
        if (a === b) continue;
        expect(cityTravelFare(a, b, "bus")).toBeGreaterThan(0);
      }
    }
    expect(Object.keys(CITY_KM)).toHaveLength(6);
  });
});

describe("project", () => {
  it("maps lon/lat bounds to scene bounds", () => {
    const [x0] = project(2.6, 6);
    const [x1] = project(14.8, 6);
    expect(x0).toBeCloseTo(-110, 5);
    expect(x1).toBeCloseTo(110, 5);
    const [, z0] = project(6, 13.8);
    const [, z1] = project(6, 4.2);
    expect(z0).toBeCloseTo(-80, 5); // north = -z
    expect(z1).toBeCloseTo(80, 5);
  });
  it("places lagos south-west of abuja", () => {
    const [lx, lz] = project(3.3792, 6.5244);
    const [ax, az] = project(7.4951, 9.0579);
    expect(lx).toBeLessThan(ax);
    expect(lz).toBeGreaterThan(az); // lagos is further south (+z)
  });
});

describe("roadKey / findRoad", () => {
  const roads = {
    "lagos|benin": { km: 316.2, hours: 3.8, coords: [] as Array<[number, number]> },
  };
  it("finds routes regardless of direction", () => {
    expect(roadKey("lagos", "benin")).toBe("lagos|benin");
    expect(findRoad(roads, "lagos", "benin")).not.toBeNull();
    expect(findRoad(roads, "benin", "lagos")).not.toBeNull();
    expect(findRoad(roads, "lagos", "ph")).toBeNull();
  });
});
