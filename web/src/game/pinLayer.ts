import * as THREE from "three";
import type { PinLocation } from "./stubLocations";

/** Constant screen footprint, bounded near the camera so markers never dominate. */
export function pinWorldSize(distance: number, viewportHeight: number): number {
  return THREE.MathUtils.clamp(distance * 0.9326 * 23 / Math.max(1, viewportHeight), 1.8, 18);
}

/** Retain GPU resources for unchanged markers; release removed/replaced icons. */
export function createPinLayer(makeTexture: (emoji: string) => THREE.Texture) {
  const group = new THREE.Group();
  const sprites: THREE.Sprite[] = [];
  const byId = new Map<string, THREE.Sprite>();
  const release = (sprite: THREE.Sprite) => {
    group.remove(sprite);
    sprite.material.map?.dispose();
    sprite.material.dispose();
  };
  return {
    group,
    sprites,
    sync(pins: PinLocation[], position: (pin: PinLocation, sprite: THREE.Sprite) => void) {
      const ids = new Set(pins.map((pin) => pin.id));
      for (const [id, sprite] of byId) {
        if (!ids.has(id)) { release(sprite); byId.delete(id); }
      }
      sprites.length = 0;
      for (const pin of pins) {
        let sprite = byId.get(pin.id);
        const emoji = pin.emoji || "📍";
        const fresh = !sprite;
        if (!sprite) {
          sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: makeTexture(emoji), depthTest: false, transparent: true,
          }));
          sprite.scale.set(6, 6, 1);
          sprite.renderOrder = 10;
          sprite.userData.baseY = 6;
          sprite.userData.emoji = emoji;
          sprite.userData.arrival = 0;
          let phase = 0;
          for (let j = 0; j < pin.id.length; j++) phase = (phase * 31 + pin.id.charCodeAt(j)) | 0;
          sprite.userData.phase = (phase % 1000) * 0.01;
          sprite.material.opacity = 0;
          byId.set(pin.id, sprite);
          group.add(sprite);
        } else if (sprite.userData.emoji !== emoji) {
          sprite.material.map?.dispose();
          sprite.material.map = makeTexture(emoji);
          sprite.userData.emoji = emoji;
        }
        sprite.userData.pin = pin;
        const x = sprite.position.x;
        const z = sprite.position.z;
        position(pin, sprite);
        sprite.userData.targetX = sprite.position.x;
        sprite.userData.targetZ = sprite.position.z;
        if (!fresh) { sprite.position.x = x; sprite.position.z = z; }
        sprites.push(sprite);
      }
    },
    animate(dt: number, time: number, distance: number, height: number, hovered: THREE.Sprite | null, reducedMotion = false) {
      const follow = reducedMotion ? 1 : 1 - Math.exp(-dt * 12);
      const size = pinWorldSize(distance, height);
      for (let i = 0; i < sprites.length; i++) {
        const sprite = sprites[i];
        const data = sprite.userData;
        data.arrival = reducedMotion ? 1 : Math.min(1, data.arrival + dt / 0.48);
        const progress = data.arrival as number;
        // Critically damped arrival with a small settle, plus the existing bob.
        const drop = reducedMotion || progress === 1 ? 0 : 7 * Math.exp(-progress * 8) * Math.cos(progress * 7);
        sprite.position.x += (data.targetX - sprite.position.x) * follow;
        sprite.position.z += (data.targetZ - sprite.position.z) * follow;
        sprite.position.y = data.baseY + drop + (reducedMotion ? 0 : Math.sin(time * 1.8 + data.phase) * 0.32);
        sprite.material.opacity = Math.min(1, progress * 3);
        const target = size * (sprite === hovered ? 1.12 : 1);
        const scale = sprite.scale.x + (target - sprite.scale.x) * follow;
        sprite.scale.set(scale, scale, 1);
      }
    },
    dispose() {
      for (const sprite of byId.values()) release(sprite);
      byId.clear();
      sprites.length = 0;
    },
  };
}
