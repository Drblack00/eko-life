import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { mergeStaticMeshes } from "./mergeStaticMeshes";

it("batches static bridge geometry while retaining positions, material and shadow behavior", () => {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  const first = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material);
  const second = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material);
  first.position.x = -4; second.position.x = 4;
  first.castShadow = second.castShadow = true;
  const release = vi.spyOn(first.geometry, "dispose");
  group.add(first, second);
  mergeStaticMeshes(group);
  expect(group.children).toHaveLength(1);
  const merged = group.children[0] as THREE.Mesh;
  expect(merged.material).toBe(material);
  expect(merged.castShadow).toBe(true);
  merged.geometry.computeBoundingBox();
  expect(merged.geometry.boundingBox!.min.x).toBe(-5);
  expect(merged.geometry.boundingBox!.max.x).toBe(5);
  expect(release).toHaveBeenCalledOnce();
  merged.geometry.dispose(); material.dispose();
});
it("keeps different shadow settings in separate batches", () => {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  const first = new THREE.Mesh(new THREE.BoxGeometry(), material);
  const second = new THREE.Mesh(new THREE.BoxGeometry(), material);
  first.receiveShadow = true;
  group.add(first, second);
  mergeStaticMeshes(group);
  expect(group.children).toEqual([first, second]);
  first.geometry.dispose(); second.geometry.dispose(); material.dispose();
});
