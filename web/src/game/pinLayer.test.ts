import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createPinLayer } from "./pinLayer";
import type { PinLocation } from "./stubLocations";

const pin: PinLocation = { id: "a", name: "A", emoji: "📍", blurb: "", x: 1, z: 2, zone: "mainland" };
const position = (p: PinLocation, s: THREE.Sprite) => s.position.set(p.x, 6, p.z);

describe("live map markers", () => {
  it("reuses markers and textures while updating positions and selection metadata", () => {
    const texture = vi.fn(() => new THREE.Texture());
    const layer = createPinLayer(texture);
    layer.sync([pin], position);
    const sprite = layer.sprites[0];
    const moved = { ...pin, x: 20, name: "Updated" };
    layer.sync([moved], position);
    expect(layer.sprites[0]).toBe(sprite);
    expect(sprite.userData.targetX).toBe(20);
    expect(sprite.position.x).toBe(1);
    layer.animate(0.016, 1, 300, 800, null);
    expect(sprite.position.x).toBeGreaterThan(1);
    expect(sprite.position.x).toBeLessThan(20);
    expect(sprite.userData.pin).toBe(moved);
    expect(texture).toHaveBeenCalledTimes(1);
    layer.dispose();
  });

  it("releases removed pins and replaced icons, and leaves no stale raycast targets", () => {
    const layer = createPinLayer(() => new THREE.Texture());
    layer.sync([pin], position);
    const sprite = layer.sprites[0];
    const oldTexture = vi.spyOn(sprite.material.map!, "dispose");
    const material = vi.spyOn(sprite.material, "dispose");
    layer.sync([{ ...pin, emoji: "💵" }], position);
    expect(oldTexture).toHaveBeenCalledTimes(1);
    const nextTexture = vi.spyOn(sprite.material.map!, "dispose");
    layer.sync([], position);
    expect(nextTexture).toHaveBeenCalledTimes(1);
    expect(material).toHaveBeenCalledTimes(1);
    expect(layer.sprites).toHaveLength(0);
    expect(layer.group.children).toHaveLength(0);
    expect(sprite.parent).toBeNull();
    layer.dispose();
    expect(material).toHaveBeenCalledTimes(1);
  });
});

it("keeps a marker's bob phase stable when another marker is removed", () => {
  const layer = createPinLayer(() => new THREE.Texture());
  const position = (p: PinLocation, s: THREE.Sprite) => s.position.set(p.x, 6, p.z);
  const second = { ...pin, id: 'b', x: 50 };
  layer.sync([pin, second], position);
  layer.animate(1, 2, 300, 800, null);
  const marker = layer.sprites[1]; const y = marker.position.y;
  layer.sync([second], position);
  layer.animate(0, 2, 300, 800, null);
  expect(layer.sprites[0]).toBe(marker);
  expect(marker.position.y).toBe(y);
  layer.dispose();
});
