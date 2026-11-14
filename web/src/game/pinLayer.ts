import * as THREE from "three";
import type { PinLocation } from "./stubLocations";

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
        if (!sprite) {
          sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: makeTexture(emoji), depthTest: false, transparent: true,
          }));
          sprite.scale.set(6, 6, 1);
          sprite.renderOrder = 10;
          sprite.userData.baseY = 6;
          sprite.userData.emoji = emoji;
          byId.set(pin.id, sprite);
          group.add(sprite);
        } else if (sprite.userData.emoji !== emoji) {
          sprite.material.map?.dispose();
          sprite.material.map = makeTexture(emoji);
          sprite.userData.emoji = emoji;
        }
        sprite.userData.pin = pin;
        position(pin, sprite);
        sprites.push(sprite);
      }
    },
    dispose() {
      for (const sprite of byId.values()) release(sprite);
      byId.clear();
      sprites.length = 0;
    },
  };
}
