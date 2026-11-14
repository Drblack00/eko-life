import { expect, it } from "vitest";
import { mapLabelOpacity, sampleDayLight } from "./mapLighting";
import { createPinLayer, pinWorldSize } from "./pinLayer";
import type { PinLocation } from "./stubLocations";
import * as THREE from "three";

it("cross-fades continuously through dawn, dusk and midnight using a reusable sample", () => {
  const state = { day: 0, warmth: 0, night: 0 };
  for (const phase of [0, 0.25, 0.5, 0.75, 1]) {
    expect(sampleDayLight(phase, state)).toBe(state);
    const before = { ...sampleDayLight(phase - 0.00001, state) };
    const after = sampleDayLight(phase + 0.00001, state);
    expect(Math.abs(before.day - after.day)).toBeLessThan(0.001);
    expect(Math.abs(before.warmth - after.warmth)).toBeLessThan(0.001);
    expect(after.day + after.night).toBeCloseTo(1);
  }
  expect(sampleDayLight(0.5, state).day).toBe(1);
  expect(sampleDayLight(0, state).night).toBe(1);
});
it("keeps pin screen size stable through zoom and scales with high-DPI CSS bounds", () => {
  expect(pinWorldSize(400, 800) / pinWorldSize(200, 800)).toBeCloseTo(2);
  expect(pinWorldSize(400, 800)).toBe(pinWorldSize(200, 400));
  expect(pinWorldSize(1, 800)).toBeGreaterThan(0);
  expect(pinWorldSize(10000, 1)).toBeLessThanOrEqual(18);
});
it("preserves marker resources during motion and settles immediately for reduced motion", () => {
  const layer = createPinLayer(() => new THREE.Texture());
  const pin = { id: 'a', name: 'A', emoji: '📍', blurb: '', x: 0, z: 0, zone: 'mainland' as const };
  const position = (p: PinLocation, s: THREE.Sprite) => s.position.set(p.x, 6, p.z);
  layer.sync([pin], position);
  const marker = layer.sprites[0];
  layer.animate(0.01, 0, 300, 800, null);
  expect(marker.position.y).toBeGreaterThan(6);
  expect(marker.material.opacity).toBeGreaterThan(0);
  layer.sync([{ ...pin, x: 20 }], position);
  expect(marker.position.x).toBe(0);
  layer.animate(0.1, 0, 300, 800, null, true);
  expect(marker.position.x).toBe(20);
  expect(marker.position.y).toBe(6);
  expect(marker.material.opacity).toBe(1);
  layer.dispose();
});

it("initializes distant detail labels hidden and cross-fades them through zoom boundaries", () => {
  expect(mapLabelOpacity(380, 1, false)).toBe(0);
  expect(mapLabelOpacity(150, 1, false)).toBe(1);
  for (const boundary of [100, 150, 240, 300, 320, 340, 360]) {
    for (const region of [true, false]) {
      expect(Math.abs(mapLabelOpacity(boundary - 0.01, 1, region) - mapLabelOpacity(boundary + 0.01, 1, region))).toBeLessThan(0.001);
    }
  }
});
