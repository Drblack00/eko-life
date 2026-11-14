import * as THREE from "three";

export interface DayLight { day: number; warmth: number; night: number; }
/** Mutates a reusable sample; continuous across midnight and both horizons. */
export function sampleDayLight(phase: number, out: DayLight): DayLight {
  const height = Math.sin(phase * Math.PI * 2 - Math.PI / 2);
  out.day = THREE.MathUtils.smoothstep(height, -0.12, 0.32);
  out.warmth = Math.exp(-Math.pow(height / 0.22, 2));
  out.night = 1 - out.day;
  return out;
}

/** Zoom tiers blend continuously, including their initial visibility. */
export function mapLabelOpacity(distance: number, tier: number, region: boolean): number {
  return region
    ? THREE.MathUtils.lerp(0.5, 0.9, THREE.MathUtils.smoothstep(distance, 240, 360))
    : tier === 0
      ? THREE.MathUtils.lerp(1, 0.7, THREE.MathUtils.smoothstep(distance, 100, 340))
      : 1 - THREE.MathUtils.smoothstep(distance, 240, 360);
}

/** One static, tiny gradient texture. Only scalar uniforms change at runtime. */
export function createGradientSky() {
  const canvas = document.createElement("canvas");
  canvas.width = 4; canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, "#6ea8dd");
  gradient.addColorStop(0.6, "#c3d9ee");
  gradient.addColorStop(1, "#eef0e8");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 4, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  const uniforms = { gradient: { value: texture }, day: { value: 1 }, warmth: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    uniforms, depthWrite: false, depthTest: false, toneMapped: false,
    vertexShader: `varying vec2 skyUv;
      void main() { skyUv = uv; gl_Position = vec4(position.xy, 0.999, 1.0); }`,
    fragmentShader: `uniform sampler2D gradient; uniform float day; uniform float warmth;
      varying vec2 skyUv;
      void main() {
        vec3 daylight = texture2D(gradient, skyUv).rgb;
        float horizon = pow(1.0 - skyUv.y, 2.0);
        vec3 night = mix(vec3(0.006, 0.012, 0.032), vec3(0.065, 0.095, 0.15), horizon);
        vec3 sky = mix(night, daylight, day);
        sky = mix(sky, vec3(0.72, 0.36, 0.19), warmth * horizon * 0.42);
        gl_FragColor = vec4(sky, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return { mesh, texture, uniforms };
}

/** Shade the existing ground draw: masked lagoon ripples + a soft sky glint.
 * No reflection render target, extra water mesh, vertex uploads, or frame allocations. */
export function createLagoonMaterial(map: THREE.Texture, mask: THREE.Texture) {
  const uniforms = { lagoonTime: { value: 0 }, lagoonDay: { value: 1 }, lagoonWarmth: { value: 0 }, lagoonMask: { value: mask } };
  const material = new THREE.MeshStandardMaterial({ map, roughness: 0.91, metalness: 0.02 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
      uniform float lagoonTime; uniform float lagoonDay; uniform float lagoonWarmth;
      uniform sampler2D lagoonMask;`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
      float water = texture2D(lagoonMask, vMapUv).r;
      float wave = sin(vMapUv.x * 270.0 + vMapUv.y * 95.0 + lagoonTime * 0.65)
                 * sin(vMapUv.y * 310.0 - lagoonTime * 0.48);
      float reflection = pow(max(0.0, wave), 5.0);
      vec3 skyReflection = mix(vec3(0.08, 0.15, 0.24), vec3(0.42, 0.67, 0.76), lagoonDay);
      skyReflection = mix(skyReflection, vec3(0.72, 0.40, 0.22), lagoonWarmth * 0.35);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * (0.94 + wave * 0.035)
                          + skyReflection * (0.045 + reflection * 0.12), water);`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.38, water);`);
  };
  material.customProgramCacheKey = () => "eko-lagoon-v1";
  return { material, uniforms };
}
