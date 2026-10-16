/**
 * Travel globe — Google-Earth-style 3D Earth with a seamless dive down to
 * Nigeria. Ported from the approved mockup
 * (~/workspace/eko-life-mockups/travel-globe.html).
 *
 * Single scene, single camera journey: the Nigeria detail group lives ON the
 * globe surface at Nigeria's real position and LOD-resolves as the camera
 * dives (space → globe → Nigeria → state → city). No crossfades, no blur.
 * Runs on low-end phones: instanced meshes, pixelRatio ≤ 2, RAF paused when hidden.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { project, type NigeriaGeo } from "./nigeriaGeo";
import { buildDeepLayer, buildNigeriaDetail } from "./nigeriaDetail";
import { EARTH_TEXTURE_DATA_URL } from "./earthTexture";
import {
  CITY_DISPLAY,
  CITY_LATLON,
  GLOBE_R,
  JOURNEY_STAGES,
  LOCKED_COUNTRIES,
  NIGERIA_LAT,
  NIGERIA_LON,
  cityPanOffset,
  clamp,
  easeIO,
  greatCirclePoints,
  latLonToVec3,
  smooth,
  zoomStage,
  type LockedCountry,
} from "./globeMath";

interface GlobeMapProps {
  currentCityId: string;
  selectedCityId: string | null;
  onSelectCity: (id: string) => void;
  geo: NigeriaGeo;
}

/* ---------------- canvas texture helpers ---------------- */

function textSprite(
  text: string,
  opts: { size?: number; bold?: boolean; color?: string; glow?: string; scaleDiv?: number } = {}
): THREE.Sprite {
  const { size = 24, bold = false, color = "rgba(255,255,255,0.75)", glow, scaleDiv = 24 } = opts;
  const c = document.createElement("canvas");
  let g = c.getContext("2d")!;
  g.font = `${bold ? "800" : "600"} ${size}px system-ui, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + 18;
  c.width = w;
  c.height = size + 20;
  g = c.getContext("2d")!;
  g.font = `${bold ? "800" : "600"} ${size}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  if (glow) {
    g.shadowColor = glow;
    g.shadowBlur = 12;
  }
  g.fillStyle = color;
  g.fillText(text, w / 2, (size + 20) / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  sp.scale.set(w / scaleDiv, (size + 20) / scaleDiv, 1);
  return sp;
}

function glowSprite(r: number, g: number, b: number, size: number): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d")!;
  const gr = x.createRadialGradient(64, 64, 2, 64, 64, 62);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.25, `rgba(${r},${g},${b},0.85)`);
  gr.addColorStop(0.6, `rgba(${r},${g},${b},0.22)`);
  gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = gr;
  x.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  sp.scale.set(size, size, 1);
  return sp;
}

function makeGoldTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#a8760a";
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 420; i++) {
    const r = ((150 + Math.random() * 90) | 0).toString();
    const gg = ((95 + Math.random() * 70) | 0).toString();
    g.fillStyle = `rgba(${r},${gg},18,${(0.22 + Math.random() * 0.45).toFixed(2)})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 3 + Math.random() * 11, 2 + Math.random() * 7);
  }
  g.strokeStyle = "rgba(60,38,4,0.5)";
  g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    g.beginPath();
    g.moveTo(i * 32, 0);
    g.lineTo(i * 32, 128);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSolarTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0a1430";
  g.fillRect(0, 0, 512, 128);
  const cols = 12,
    rows = 3,
    cw = 512 / cols,
    rh = 128 / rows;
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const x = i * cw,
        y = j * rh;
      const gr = g.createLinearGradient(x, y, x + cw, y + rh);
      gr.addColorStop(0, "#182c60");
      gr.addColorStop(0.45, "#22397e");
      gr.addColorStop(1, "#101f4c");
      g.fillStyle = gr;
      g.fillRect(x + 2, y + 2, cw - 4, rh - 4);
      g.strokeStyle = "rgba(160,190,240,0.55)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x + cw / 2, y + 3);
      g.lineTo(x + cw / 2, y + rh - 3);
      g.stroke();
    }
  g.strokeStyle = "#97a1b3";
  g.lineWidth = 7;
  g.strokeRect(0, 0, 512, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

interface Sat {
  sat: THREE.Group;
  beacon: THREE.Mesh;
  beaconMat: THREE.MeshBasicMaterial;
  radius: number;
  speed: number;
  angle: number;
  phase: number;
}

function makeSat(
  parent: THREE.Group,
  goldTex: THREE.Texture,
  solarTex: THREE.Texture,
  radius: number,
  incl: number,
  speed: number,
  phase: number,
  disposables: Array<{ dispose: () => void }>
): Sat {
  const track = <T extends { dispose: () => void }>(d: T): T => {
    disposables.push(d);
    return d;
  };
  const orbit = new THREE.Group();
  orbit.rotation.x = incl;
  orbit.rotation.z = incl * 0.4;
  const pathPts: THREE.Vector3[] = [];
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2;
    pathPts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  orbit.add(
    new THREE.LineLoop(
      track(new THREE.BufferGeometry().setFromPoints(pathPts)),
      track(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 }))
    )
  );
  const sat = new THREE.Group();
  const metal = (c: number, r: number) =>
    new THREE.MeshStandardMaterial({ color: c, metalness: 0.8, roughness: r });
  sat.add(
    new THREE.Mesh(
      track(new THREE.BoxGeometry(3.0, 2.0, 2.0)),
      track(new THREE.MeshStandardMaterial({ map: goldTex, metalness: 0.85, roughness: 0.38 }))
    )
  );
  const deck = new THREE.Mesh(track(new THREE.BoxGeometry(2.1, 0.55, 1.5)), track(metal(0x2b3038, 0.5)));
  deck.position.y = 1.28;
  sat.add(deck);
  const wingMat = track(
    new THREE.MeshStandardMaterial({ map: solarTex, metalness: 0.35, roughness: 0.55, side: THREE.DoubleSide })
  );
  for (const s of [-1, 1]) {
    const yoke = new THREE.Mesh(track(new THREE.CylinderGeometry(0.11, 0.11, 1.7, 8)), track(metal(0x9aa2ae, 0.4)));
    yoke.rotation.z = Math.PI / 2;
    yoke.position.x = s * 2.25;
    sat.add(yoke);
    const wing = new THREE.Mesh(track(new THREE.PlaneGeometry(7.2, 2.9)), wingMat);
    wing.position.x = s * 5.6;
    wing.rotation.z = s * -0.055;
    sat.add(wing);
  }
  const arm = new THREE.Mesh(track(new THREE.CylinderGeometry(0.09, 0.09, 1.3, 8)), track(metal(0x8b939e, 0.45)));
  arm.rotation.x = Math.PI / 2;
  arm.position.set(0.65, -0.35, 1.5);
  sat.add(arm);
  const dish = new THREE.Mesh(
    track(new THREE.SphereGeometry(1.2, 22, 10, 0, Math.PI * 2, 0, 0.62)),
    track(new THREE.MeshStandardMaterial({ color: 0xeef1f4, metalness: 0.15, roughness: 0.5, side: THREE.DoubleSide }))
  );
  dish.position.set(0.65, -0.35, 2.15);
  dish.rotation.x = -Math.PI / 2 + 0.3;
  sat.add(dish);
  const whip = new THREE.Mesh(track(new THREE.CylinderGeometry(0.035, 0.05, 2.6, 6)), track(metal(0xb9c0c9, 0.35)));
  whip.position.set(-0.8, 2.5, -0.4);
  sat.add(whip);
  const beaconMat = track(new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true }));
  const beacon = new THREE.Mesh(track(new THREE.SphereGeometry(0.26, 10, 10)), beaconMat);
  beacon.position.set(-1.15, 1.1, 1.02);
  sat.add(beacon);
  sat.scale.setScalar(1.25);
  orbit.add(sat);
  parent.add(orbit);
  return { sat, beacon, beaconMat, radius, speed, angle: phase, phase };
}

/* ---------------- component ---------------- */

export function GlobeMap({ currentCityId, selectedCityId, onSelectCity, geo }: GlobeMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelectCity);
  onSelectRef.current = onSelectCity;

  const [stage, setStage] = useState(0);
  const [flying, setFlying] = useState(false);
  const [locked, setLocked] = useState<LockedCountry | null>(null);
  const [diveId, setDiveId] = useState<string | null>(null);

  const apiRef = useRef<{
    setSelection: (from: string, to: string | null) => void;
    resetView: () => void;
    flyTo: (cityId?: string) => void;
  } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      container.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#93a4bd;font-size:13px;padding:24px;text-align:center">3D globe needs WebGL — pick your destination below.</div>';
      return;
    }
    const disposables: Array<{ dispose: () => void }> = [];
    const track = <T extends { dispose: () => void }>(d: T): T => {
      disposables.push(d);
      return d;
    };

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020409);
    const camera = new THREE.PerspectiveCamera(50, 1, 1, 6000);

    const size = () => {
      const w = container.clientWidth || 320;
      const h = container.clientHeight || 400;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(container);

    scene.add(new THREE.AmbientLight(0xbfd4ff, 0.85));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
    sun.position.set(-220, 160, 120);
    scene.add(sun);

    const R = GLOBE_R;
    const globeGroup = new THREE.Group();
    scene.add(globeGroup);
    const spinGroup = new THREE.Group();
    globeGroup.add(spinGroup);

    // ---- starfield ----
    {
      const n = 900;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const r = 1500 + Math.random() * 900;
        const t = Math.random() * Math.PI * 2;
        const p = Math.acos(2 * Math.random() - 1);
        pos[i * 3] = r * Math.sin(p) * Math.cos(t);
        pos[i * 3 + 1] = r * Math.cos(p);
        pos[i * 3 + 2] = r * Math.sin(p) * Math.sin(t);
      }
      const g = track(new THREE.BufferGeometry());
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      scene.add(
        new THREE.Points(
          g,
          track(
            new THREE.PointsMaterial({
              color: 0xaac4e8,
              size: 2.4,
              sizeAttenuation: false,
              transparent: true,
              opacity: 0.85,
            })
          )
        )
      );
    }

    // ---- Earth (bundled texture, embedded as base64) ----
    const texLoader = new THREE.TextureLoader();
    const earthTex = texLoader.load(EARTH_TEXTURE_DATA_URL);
    earthTex.colorSpace = THREE.SRGBColorSpace;
    earthTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    spinGroup.add(
      new THREE.Mesh(
        track(new THREE.SphereGeometry(R, 64, 64)),
        track(
          new THREE.MeshPhongMaterial({ map: earthTex, specular: 0x1c2a3a, shininess: 26 })
        )
      )
    );

    // ---- atmosphere fresnel shell ----
    const atmMat = new THREE.ShaderMaterial({
      uniforms: { glowColor: { value: new THREE.Color(0x5eb4ff) }, uFade: { value: 1 } },
      vertexShader:
        "varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader:
        "varying vec3 vN; uniform vec3 glowColor; uniform float uFade;\n" +
        "void main(){ float d = dot(vN, vec3(0.0, 0.0, 1.0));" +
        " float rim = pow(clamp(0.70 - d, 0.0, 1.0), 3.2);" +
        " vec3 col = mix(glowColor * 0.55, vec3(0.72, 0.90, 1.0), pow(clamp(0.34 - d, 0.0, 1.0), 2.0));" +
        " gl_FragColor = vec4(col, 1.0) * rim * uFade; }",
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    globeGroup.add(new THREE.Mesh(track(new THREE.SphereGeometry(R * 1.18, 64, 64)), atmMat));

    // ---- satellites ----
    const goldTex = track(makeGoldTexture());
    const solarTex = track(makeSolarTexture());
    const sats: Sat[] = [
      makeSat(globeGroup, goldTex, solarTex, 133, 0.35, 0.2, 5.22, disposables),
      makeSat(globeGroup, goldTex, solarTex, 154, 0.95, 0.14, 4.361, disposables),
      makeSat(globeGroup, goldTex, solarTex, 178, 1.3, 0.09, 5.45, disposables),
    ];

    // ---- Nigeria surface frame ----
    const NIG = new THREE.Vector3(...latLonToVec3(NIGERIA_LAT, NIGERIA_LON, 1));
    const surfPt = NIG.clone().multiplyScalar(R);
    const surfLifted = surfPt.clone().addScaledVector(NIG, 0.28);
    const eastV = new THREE.Vector3(
      -Math.sin((NIGERIA_LON * Math.PI) / 180),
      0,
      -Math.cos((NIGERIA_LON * Math.PI) / 180)
    ).normalize();
    const southV = new THREE.Vector3().crossVectors(eastV, NIG).normalize();

    // ---- Nigeria pulsing ring + label on the globe ----
    const nigPos = new THREE.Vector3(...latLonToVec3(NIGERIA_LAT, NIGERIA_LON, R * 1.015));
    const ringN = new THREE.Mesh(
      track(new THREE.RingGeometry(4.2, 5.2, 48)),
      track(
        new THREE.MeshBasicMaterial({
          color: 0xf5a623,
          transparent: true,
          opacity: 0.95,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      )
    );
    ringN.position.copy(nigPos);
    ringN.lookAt(nigPos.clone().multiplyScalar(2));
    spinGroup.add(ringN);
    const nigLabel = textSprite("🇳🇬 Nigeria", {
      size: 22,
      bold: true,
      color: "#ffe9c4",
      glow: "#f5a623",
      scaleDiv: 30,
    });
    nigLabel.position.copy(new THREE.Vector3(...latLonToVec3(NIGERIA_LAT, NIGERIA_LON, R * 1.09)));
    spinGroup.add(nigLabel);

    // ---- locked countries ----
    const lockTargets: THREE.Sprite[] = [];
    for (const c of LOCKED_COUNTRIES) {
      const sp = textSprite(`🔒 ${c.name}`, {
        size: 18,
        color: "rgba(255,220,170,0.85)",
        scaleDiv: 30,
      });
      sp.position.copy(new THREE.Vector3(...latLonToVec3(c.lat, c.lon, R * 1.04)));
      sp.userData.country = c;
      spinGroup.add(sp);
      lockTargets.push(sp);
    }

    // ---- playable city markers on the globe ----
    const globeCityTargets: THREE.Object3D[] = [];
    const globeCityFade: THREE.Material[] = [];
    for (const [id, [clat, clon]] of Object.entries(CITY_LATLON)) {
      const dot = glowSprite(245, 166, 35, 4.6);
      dot.position.copy(new THREE.Vector3(...latLonToVec3(clat, clon, R * 1.025)));
      dot.userData.cityId = id;
      spinGroup.add(dot);
      globeCityTargets.push(dot);
      globeCityFade.push(dot.material as THREE.Material);
      const lab = textSprite(CITY_DISPLAY[id] ?? id, {
        size: 20,
        bold: true,
        color: "#ffe9c4",
        glow: "#f5a623",
        scaleDiv: 34,
      });
      lab.position.copy(new THREE.Vector3(...latLonToVec3(clat, clon, R * 1.085)));
      lab.userData.cityId = id;
      spinGroup.add(lab);
      globeCityTargets.push(lab);
      globeCityFade.push(lab.material as THREE.Material);
    }

    // ---- Nigeria detail, reparented onto the globe surface ----
    const detail = buildNigeriaDetail(geo, currentCityId);
    const DETAIL_SCALE = 0.06;
    const detailInner = new THREE.Group();
    detailInner.position.set(0.4, 0, 1.3); // recenter flat coords on (lon 8.68, lat 9.08)
    detailInner.add(...detail.group.children);
    const nigeriaDetail = new THREE.Group();
    nigeriaDetail.add(detailInner);
    nigeriaDetail.scale.setScalar(DETAIL_SCALE);
    nigeriaDetail.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(eastV, NIG, southV)
    );
    nigeriaDetail.position.copy(surfLifted);
    nigeriaDetail.visible = false;
    spinGroup.add(nigeriaDetail);

    // ---- deepest LOD layer (inside the detail transform) ----
    const deep = buildDeepLayer(geo);
    deep.group.visible = false;
    detailInner.add(deep.group);

    // ---- route arc (globe space) ----
    let arcGroup: THREE.Group | null = null;
    let arcCurve: THREE.CatmullRomCurve3 | null = null;
    let arcDot: THREE.Sprite | null = null;
    let arcT = 0;
    const clearArc = () => {
      if (arcGroup) {
        spinGroup.remove(arcGroup);
        arcGroup.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
          const mat = (o as THREE.Sprite).material as THREE.Material | undefined;
          if (mat && !(globeCityFade as THREE.Material[]).includes(mat)) mat.dispose();
        });
        arcGroup = null;
      }
      arcCurve = null;
      arcDot = null;
      setDiveId(null);
    };
    const drawArcTo = (destId: string) => {
      clearArc();
      const from = CITY_LATLON[currentCityId];
      const to = CITY_LATLON[destId];
      if (!from || !to || destId === currentCityId) return;
      const pts = greatCirclePoints(from[0], from[1], to[0], to[1], R).map(
        ([x, y, z]) => new THREE.Vector3(x, y, z)
      );
      arcCurve = new THREE.CatmullRomCurve3(pts);
      arcGroup = new THREE.Group();
      const cA = new THREE.Color(0xe8930c);
      const cB = new THREE.Color(0xffdf8a);
      const cc = new THREE.Color();
      const paintGrad = (tg: THREE.BufferGeometry) => {
        const count = tg.attributes.position.count;
        const cols = new Float32Array(count * 3);
        const uv = tg.attributes.uv;
        for (let i = 0; i < count; i++) {
          const t = uv.getX(i);
          cc.copy(cA).lerp(cB, t * t);
          cols[i * 3] = cc.r;
          cols[i * 3 + 1] = cc.g;
          cols[i * 3 + 2] = cc.b;
        }
        tg.setAttribute("color", new THREE.BufferAttribute(cols, 3));
      };
      const haloGeo = track(new THREE.TubeGeometry(arcCurve, 72, 1.0, 6, false));
      paintGrad(haloGeo);
      arcGroup.add(
        new THREE.Mesh(
          haloGeo,
          track(
            new THREE.MeshBasicMaterial({
              vertexColors: true,
              transparent: true,
              opacity: 0.45,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            })
          )
        )
      );
      const coreGeo = track(new THREE.TubeGeometry(arcCurve, 72, 0.42, 6, false));
      paintGrad(coreGeo);
      arcGroup.add(
        new THREE.Mesh(
          coreGeo,
          track(
            new THREE.MeshBasicMaterial({
              vertexColors: true,
              transparent: true,
              opacity: 1.0,
              depthWrite: false,
            })
          )
        )
      );
      arcDot = glowSprite(255, 233, 196, 4.2);
      arcGroup.add(arcDot);
      spinGroup.add(arcGroup);
      setDiveId(destId);
    };

    // ---- camera journey state ----
    let zoomT = 0;
    let tT = 0;
    let spinY = 0;
    let lastInteract = 0;
    let panX = 0;
    let panZ = 0;
    let flyAnim: {
      from: number;
      fromPX: number;
      fromPZ: number;
      toPX: number;
      toPZ: number;
      t0: number;
      dur: number;
    } | null = null;
    const camDir0 = NIG.clone().add(new THREE.Vector3(0.15, 0.12, 0.18)).normalize();
    const camDirEnd = NIG.clone().addScaledVector(southV, 0.22).normalize();
    const v1 = new THREE.Vector3();
    const lt = new THREE.Vector3();

    const cancelFly = () => {
      if (flyAnim) {
        flyAnim = null;
        setFlying(false);
      }
    };
    const flyTo = (cityId?: string) => {
      const [px, pz] = cityPanOffset(project, cityId ?? "lagos");
      flyAnim = { from: zoomT, fromPX: panX, fromPZ: panZ, toPX: px, toPZ: pz, t0: performance.now(), dur: 6000 };
      lastInteract = performance.now();
      setFlying(true);
      setDiveId(null);
    };

    const placeCamera = () => {
      const T = zoomT;
      v1.copy(camDir0).lerp(NIG, easeIO(smooth(0.12, 0.88, T)));
      v1.lerp(camDirEnd, smooth(0.9, 1.0, T)).normalize();
      const D = 300 * Math.pow(3 / 300, easeIO(T));
      const pk = smooth(0.7, 0.92, T);
      lt.copy(surfLifted).multiplyScalar(smooth(0.3, 0.8, T));
      lt.addScaledVector(eastV, panX * pk).addScaledVector(southV, panZ * pk);
      camera.position.copy(surfLifted).addScaledVector(v1, D);
      const ak = smooth(0.85, 0.97, T);
      camera.position.addScaledVector(eastV, panX * pk * ak).addScaledVector(southV, panZ * pk * ak);
      camera.lookAt(lt);
      atmMat.uniforms.uFade.value = smooth(105, 145, camera.position.length());
    };

    // ---- input: drag / pinch / wheel / tap ----
    const cvs = renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const pointerNDC = new THREE.Vector2();
    const activePtrs = new Map<number, [number, number]>();
    let lastPinch = 0;
    let downAt = 0;
    let downX = 0;
    let downY = 0;
    let prevStage = -1;

    const markInteract = () => {
      lastInteract = performance.now();
      cancelFly();
    };

    const pick = (cx: number, cy: number): void => {
      const rect = cvs.getBoundingClientRect();
      pointerNDC.set(
        ((cx - rect.left) / rect.width) * 2 - 1,
        -((cy - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(pointerNDC, camera);
      if (zoomT < 0.5) {
        const lockHits = raycaster.intersectObjects(lockTargets, false);
        if (lockHits.length > 0) {
          setLocked(lockHits[0].object.userData.country as LockedCountry);
          return;
        }
        const cityHits = raycaster.intersectObjects(globeCityTargets, false);
        if (cityHits.length > 0) {
          const id = cityHits[0].object.userData.cityId as string;
          if (id && id !== currentCityId) onSelectRef.current(id);
          return;
        }
        setLocked(null);
        return;
      }
      const hits = raycaster.intersectObjects(detail.cityHitMeshes, false);
      if (hits.length > 0) {
        const id = hits[0].object.userData.cityId as string;
        if (id && id !== currentCityId) onSelectRef.current(id);
      }
    };

    cvs.addEventListener("pointerdown", (e) => {
      try {
        cvs.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      markInteract();
      activePtrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (activePtrs.size === 1) {
        downAt = performance.now();
        downX = e.clientX;
        downY = e.clientY;
      }
      if (activePtrs.size === 2) {
        const p = [...activePtrs.values()];
        lastPinch = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
      }
    });
    cvs.addEventListener("pointermove", (e) => {
      if (!activePtrs.has(e.pointerId)) return;
      const prev = activePtrs.get(e.pointerId)!;
      const dx = e.clientX - prev[0];
      const dy = e.clientY - prev[1];
      activePtrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (activePtrs.size === 1) {
        if (zoomT < 0.5) {
          spinY += dx * 0.005;
        } else {
          panX = clamp(panX + dx * 0.015, -6, 6);
          panZ = clamp(panZ + dy * 0.015, -6, 6);
        }
      } else if (activePtrs.size === 2) {
        const p = [...activePtrs.values()];
        const d = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
        if (lastPinch > 0 && d > 0) tT = clamp((tT * lastPinch) / d, 0, 1);
        lastPinch = d;
      }
    });
    const ptrUp = (e: PointerEvent) => {
      const wasSingle = activePtrs.size === 1;
      activePtrs.delete(e.pointerId);
      lastPinch = 0;
      if (
        wasSingle &&
        performance.now() - downAt < 450 &&
        Math.hypot(e.clientX - downX, e.clientY - downY) < 10
      ) {
        pick(e.clientX, e.clientY);
      }
    };
    cvs.addEventListener("pointerup", ptrUp);
    cvs.addEventListener("pointercancel", ptrUp);
    cvs.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        markInteract();
        tT = clamp(tT + e.deltaY * 0.0009, 0, 1);
      },
      { passive: false }
    );
    cvs.addEventListener("contextmenu", (e) => e.preventDefault());

    // ---- animate ----
    const clock = new THREE.Clock();
    let raf = 0;
    let running = true;
    const animate = () => {
      if (!running) return;
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const now = performance.now();

      if (flyAnim) {
        const e = easeIO((now - flyAnim.t0) / flyAnim.dur);
        tT = flyAnim.from + (1 - flyAnim.from) * e;
        panX = flyAnim.fromPX + (flyAnim.toPX - flyAnim.fromPX) * e;
        panZ = flyAnim.fromPZ + (flyAnim.toPZ - flyAnim.fromPZ) * e;
        if (e >= 1) cancelFly();
      }
      zoomT += (tT - zoomT) * Math.min(1, dt * 3.2);
      if (Math.abs(tT - zoomT) < 0.0006) zoomT = tT;

      // idle auto-rotate; ease back to face Nigeria on dive
      if (zoomT < 0.4 && now - lastInteract > 2500) spinY += dt * 0.06;
      if (zoomT > 0.12) {
        const tgt = Math.round(spinY / (Math.PI * 2)) * Math.PI * 2;
        spinY += (tgt - spinY) * Math.min(1, dt * 2.5);
      }
      spinGroup.rotation.y = spinY;
      placeCamera();

      // LOD fades
      const dk = smooth(0.4, 0.58, zoomT);
      for (const o of detail.detailMats) o.m.opacity = o.base * dk;
      nigeriaDetail.visible = dk > 0.01;
      const deepK = smooth(0.82, 0.93, zoomT);
      deep.group.visible = deepK > 0.01;
      for (const o of deep.deepMats) o.m.opacity = o.base * dk * deepK;
      for (const l of detail.labelSprites) {
        const mat = l.material as THREE.SpriteMaterial;
        mat.opacity *= 1 - deepK;
      }
      detail.update(now, dt, dk, deepK);
      deep.update(now, dt);

      // globe chrome fades on dive
      const rk = 1 - smooth(0.3, 0.48, zoomT);
      (ringN.material as THREE.MeshBasicMaterial).opacity = 0.95 * rk;
      ringN.visible = rk > 0.01;
      (nigLabel.material as THREE.SpriteMaterial).opacity = rk;
      nigLabel.visible = rk > 0.01;
      const rs = 1 + Math.sin(now * 0.004) * 0.12;
      ringN.scale.set(rs, rs, 1);
      const gk = 1 - smooth(0.3, 0.48, zoomT);
      for (const m of globeCityFade) m.opacity = gk;
      for (const s of lockTargets) {
        (s.material as THREE.SpriteMaterial).opacity = gk;
        s.visible = gk > 0.01;
      }

      // arc flow dot
      if (arcCurve && arcDot) {
        arcT = (arcT + dt * 0.22) % 1;
        arcDot.position.copy(arcCurve.getPointAt(arcT));
      }

      // satellites: drift, dishes track Earth, beacon pulse
      for (const s of sats) {
        s.angle += s.speed * dt;
        s.sat.position.set(Math.cos(s.angle) * s.radius, 0, Math.sin(s.angle) * s.radius);
        s.sat.lookAt(0, 0, 0);
        const bl = Math.sin(now * 0.008 + s.phase * 3);
        s.beaconMat.color.set(bl > 0 ? 0xff2a2a : 0xffffff);
        s.beaconMat.opacity = 0.65 + 0.35 * Math.abs(bl);
      }

      // journey rail state (only on change)
      const st = zoomStage(zoomT);
      if (st !== prevStage) {
        prevStage = st;
        setStage(st);
      }

      renderer.render(scene, camera);
    };
    animate();

    const onVis = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        clock.getDelta();
        animate();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    apiRef.current = {
      setSelection: (from: string, to: string | null) => {
        detail.drawRoute(from, to);
        detail.setPulseCity(from);
        if (to && to !== from) drawArcTo(to);
        else clearArc();
      },
      resetView: () => {
        cancelFly();
        tT = 0;
        panX = 0;
        panZ = 0;
        clearArc();
        setLocked(null);
        lastInteract = performance.now();
      },
      flyTo,
    };
    // initial selection
    detail.drawRoute(currentCityId, selectedCityId);
    detail.setPulseCity(currentCityId);
    if (selectedCityId && selectedCityId !== currentCityId) drawArcTo(selectedCityId);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      ro.disconnect();
      clearArc();
      detail.dispose();
      deep.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints) {
          if (mesh.geometry) mesh.geometry.dispose();
          const mat = (o as THREE.Sprite).material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else if (mat) mat.dispose();
        }
      });
      for (const d of disposables) {
        try {
          d.dispose();
        } catch {
          /* noop */
        }
      }
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* selection changes: route + arc */
  useEffect(() => {
    apiRef.current?.setSelection(currentCityId, selectedCityId);
  }, [currentCityId, selectedCityId]);

  return (
    <div className="globemap">
      <div ref={containerRef} className="globemap__canvas" />
      <div className="globemap__journey" aria-hidden="true">
        <div className="globemap__jtrack" />
        <div
          className="globemap__jfill"
          style={{ height: `${8 + (stage / 4) * 84}%` }}
        />
        <div
          className="globemap__jmarker"
          style={{ top: `${8 + (stage / 4) * 84}%` }}
        />
        {JOURNEY_STAGES.map((s, i) => (
          <div
            key={s.id}
            className={`globemap__jstage${i === stage ? " on" : ""}`}
            style={{ top: `${8 + (i / 4) * 84}%` }}
          >
            <span className="globemap__je">{s.icon}</span>
            <span className="globemap__jl">{s.label}</span>
          </div>
        ))}
      </div>
      <div className="globemap__topbtns">
        <button
          type="button"
          className="globemap__chip"
          onClick={() => apiRef.current?.resetView()}
        >
          ⟲ Reset view
        </button>
        <button
          type="button"
          className="globemap__fly"
          onClick={() => {
            if (flying) apiRef.current?.resetView();
            else apiRef.current?.flyTo();
          }}
        >
          {flying ? "⏸ Cancel flight" : "✈️ Fly to Nigeria"}
        </button>
        {diveId && (
          <button
            type="button"
            className="globemap__fly"
            onClick={() => apiRef.current?.flyTo(diveId)}
          >
            ✈️ Dive to {CITY_DISPLAY[diveId] ?? diveId}
          </button>
        )}
      </div>
      <div className="globemap__hint" aria-hidden="true">
        Drag to spin · scroll / pinch to zoom
      </div>
      {locked && (
        <div className="globemap__lockcard" role="dialog" aria-label={`${locked.name} locked`}>
          <button
            type="button"
            className="globemap__lockx"
            onClick={() => setLocked(null)}
            aria-label="Close"
          >
            ✕
          </button>
          <div className="globemap__lockflag" aria-hidden="true">
            {locked.flag}
          </div>
          <div className="globemap__lockbody">
            <div className="globemap__lockname">{locked.name}</div>
            <div className="globemap__locksub">🔒 International travel coming soon</div>
            <button type="button" className="globemap__locknotify" disabled>
              🔔 Notify me
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
