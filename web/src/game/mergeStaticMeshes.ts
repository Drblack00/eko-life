import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Bake a static group's local mesh transforms into batches with identical materials/shadows. */
export function mergeStaticMeshes(group: THREE.Group) {
  const buckets = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.Material>[]>();
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh) || child instanceof THREE.InstancedMesh || Array.isArray(child.material)) continue;
    const key = `${child.material.uuid}:${child.castShadow}:${child.receiveShadow}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(child);
    buckets.set(key, bucket);
  }
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const parts = meshes.map((mesh) => {
      mesh.updateMatrix();
      return mesh.geometry.clone().applyMatrix4(mesh.matrix);
    });
    const geometry = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!geometry) continue;
    const first = meshes[0];
    const merged = new THREE.Mesh(geometry, first.material);
    merged.castShadow = first.castShadow;
    merged.receiveShadow = first.receiveShadow;
    // Removing static children is safe: this helper is only used for bridge segments.
    const originals = new Set<THREE.BufferGeometry>();
    for (const mesh of meshes) { group.remove(mesh); originals.add(mesh.geometry); }
    for (const original of originals) original.dispose();
    geometry.computeBoundingSphere();
    group.add(merged);
  }
}
