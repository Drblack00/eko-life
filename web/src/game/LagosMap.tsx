import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import waterMaskUrl from "./waterMask.png";
import type { PinLocation } from "./stubLocations";
import "./CityMap.css";

/**
 * LagosMap — production living 3D Lagos.
 * Real geography: water mask derived from satellite analysis, POIs placed by
 * real lat/lng, highways along real corridors. All art procedural/original.
 */

// Map bounds (real lat/lng)
const LON_W = 3.3, LON_E = 3.56, LAT_N = 6.66, LAT_S = 6.38;
// Mask image bounds
const M_LON_W = 3.2959, M_LON_E = 3.6914, M_LAT_N = 6.5773, M_LAT_S = 6.3153;

const lon2u = (lon: number) => (lon - LON_W) / (LON_E - LON_W);
const lat2v = (lat: number) => (LAT_N - lat) / (LAT_N - LAT_S);
const u2x = (u: number) => (u - 0.5) * 200;
const v2z = (v: number) => (v - 0.5) * 220;
const lon2x = (lon: number) => u2x(lon2u(lon));
const lat2z = (lat: number) => v2z(lat2v(lat));

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface POI {
  key: string;
  label: string;
  lat: number;
  lon: number;
  kind: "stadium" | "hospital" | "airport" | "port" | "market" | "mall" | "landmark" | "beach" | "univ" | "hotel";
  tier: number;
}

const POIS: POI[] = [
  { key: "stadium_national", label: "National Stadium", lat: 6.4971, lon: 3.365, kind: "stadium", tier: 0 },
  { key: "stadium_teslim", label: "Teslim Balogun Stadium", lat: 6.4998, lon: 3.3608, kind: "stadium", tier: 1 },
  { key: "stadium_onikan", label: "Mobolaji Johnson Arena", lat: 6.4427, lon: 3.4019, kind: "stadium", tier: 1 },
  { key: "stadium_agege", label: "Agege Stadium", lat: 6.6235, lon: 3.3301, kind: "stadium", tier: 1 },
  { key: "hospital_luth", label: "LUTH", lat: 6.5183, lon: 3.3566, kind: "hospital", tier: 0 },
  { key: "hospital_lasuth", label: "LASUTH", lat: 6.5897, lon: 3.3422, kind: "hospital", tier: 1 },
  { key: "hospital_reddington", label: "Reddington Hospital", lat: 6.433, lon: 3.4204, kind: "hospital", tier: 1 },
  { key: "airport_mmia", label: "Murtala Muhammed Airport", lat: 6.5848, lon: 3.3329, kind: "airport", tier: 0 },
  { key: "port_apapa", label: "Apapa Port", lat: 6.4477, lon: 3.3749, kind: "port", tier: 0 },
  { key: "port_tincan", label: "Tin Can Port", lat: 6.4335, lon: 3.3351, kind: "port", tier: 1 },
  { key: "market_balogun", label: "Balogun Market", lat: 6.4549, lon: 3.3849, kind: "market", tier: 1 },
  { key: "market_computervillage", label: "Computer Village", lat: 6.5942, lon: 3.3402, kind: "market", tier: 1 },
  { key: "mall_ikejacity", label: "Ikeja City Mall", lat: 6.6144, lon: 3.3578, kind: "mall", tier: 1 },
  { key: "mall_palms", label: "Palms Mall", lat: 6.436, lon: 3.4512, kind: "mall", tier: 1 },
  { key: "landmark_theatre", label: "National Theatre", lat: 6.4767, lon: 3.3697, kind: "landmark", tier: 0 },
  { key: "landmark_tbs", label: "Tafawa Balewa Square", lat: 6.4471, lon: 3.4015, kind: "landmark", tier: 1 },
  { key: "landmark_lcc", label: "Lekki Conservation Centre", lat: 6.4411, lon: 3.535, kind: "landmark", tier: 1 },
  { key: "landmark_freedompark", label: "Freedom Park", lat: 6.4488, lon: 3.3965, kind: "landmark", tier: 1 },
  { key: "beach_elegushi", label: "Elegushi Beach", lat: 6.4254, lon: 3.4804, kind: "beach", tier: 1 },
  { key: "beach_tarkwa", label: "Tarkwa Bay", lat: 6.3999, lon: 3.3956, kind: "beach", tier: 1 },
  { key: "univ_unilag", label: "University of Lagos", lat: 6.5215, lon: 3.3847, kind: "univ", tier: 0 },
  { key: "hotel_eko", label: "Eko Hotel", lat: 6.4271, lon: 3.4303, kind: "hotel", tier: 1 },
  { key: "landmark_ekoatlantic", label: "Eko Atlantic", lat: 6.41, lon: 3.415, kind: "landmark", tier: 0 },
];

// Highways as real corridors (lat/lng waypoints)
const HIGHWAYS: Array<Array<[number, number]>> = [
  // Third Mainland Bridge
  [[6.52, 3.362], [6.5, 3.378], [6.475, 3.392], [6.452, 3.402]],
  // Eko Bridge
  [[6.466, 3.372], [6.456, 3.384]],
  // Carter Bridge
  [[6.469, 3.38], [6.459, 3.387]],
  // Lagos-Ibadan Expressway
  [[6.59, 3.362], [6.62, 3.36], [6.66, 3.358]],
  // Apapa-Oshodi Expressway
  [[6.445, 3.365], [6.46, 3.345], [6.5, 3.34], [6.55, 3.342]],
  // Lekki-Epe Expressway
  [[6.43, 3.425], [6.435, 3.46], [6.44, 3.5], [6.445, 3.55]],
  // Agege Motor Road
  [[6.55, 3.342], [6.59, 3.336], [6.62, 3.331]],
  // Ikorodu Road
  [[6.59, 3.365], [6.6, 3.42], [6.61, 3.48]],
  // Lekki-Ikoyi Link Bridge
  [[6.449, 3.438], [6.443, 3.452]],
  // Marina / Broad Street
  [[6.452, 3.385], [6.449, 3.395], [6.447, 3.402]],
];

function makeEmojiTexture(emoji: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const g = c.getContext("2d")!;
  g.font = "96px 'Apple Color Emoji','Segoe UI Emoji',sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(emoji, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePillLabel(text: string, tier: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  const meas = c.getContext("2d")!;
  const font = tier === 0 ? "600 40px system-ui,sans-serif" : "500 34px system-ui,sans-serif";
  meas.font = font;
  c.width = Math.ceil(meas.measureText(text).width) + 52;
  c.height = 68;
  const g = c.getContext("2d")!;
  // Pill 💊 background
  g.fillStyle = "rgba(8,18,34,0.72)";
  g.strokeStyle = "rgba(255,255,255,0.28)";
  g.lineWidth = 2.5;
  g.beginPath();
  g.roundRect(3, 3, c.width - 6, 62, 31);
  g.fill();
  g.stroke();
  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = "rgba(0,0,0,0.4)";
  g.shadowBlur = 6;
  g.fillStyle = "#ffffff";
  g.fillText(text, c.width / 2, 36);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}


/** Tower windows: day map + night emissive (PURE BLACK except window glass). */
function makeTowerTextures(): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const W = 128, H = 256;
  const wins: Array<[number, number, number, number]> = [];
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#b8b2a4"; g.fillRect(0, 0, W, H);
  for (let f = 0; f < 10; f++) {
    for (let col = 0; col < 4; col++) {
      const x = 12 + col * 28, y = 14 + f * 24;
      g.fillStyle = "#2a3f55";
      g.fillRect(x, y, 18, 14);
      wins.push([x, y, 18, 14]);
    }
  }
  const e = document.createElement("canvas");
  e.width = W; e.height = H;
  const ge = e.getContext("2d")!;
  ge.fillStyle = "#000000"; ge.fillRect(0, 0, W, H);
  for (const [x, y, w, h] of wins) {
    ge.fillStyle = "#ffc46b";
    ge.fillRect(x, y, w, h);
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const emissive = new THREE.CanvasTexture(e);
  emissive.colorSpace = THREE.SRGBColorSpace;
  return { map, emissive };
}

/** House walls: day map with windows/door + night emissive (windows ONLY). */
function makeHouseTextures(): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const W = 128, H = 128;
  const wins: Array<[number, number, number, number]> = [
    [22, 26, 26, 22], [80, 26, 26, 22], [22, 68, 26, 22], [80, 68, 26, 22],
  ];
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f2ede2"; g.fillRect(0, 0, W, H);
  for (const [x, y, w, h] of wins) {
    g.fillStyle = "#2a3f55";
    g.fillRect(x, y, w, h);
    g.fillStyle = "#d8d2c4";
    g.fillRect(x + w / 2 - 1.5, y, 3, h);
    g.fillRect(x, y + h / 2 - 1.5, w, 3);
  }
  // Door (stays dark at night)
  g.fillStyle = "#6b4a2f";
  g.fillRect(56, 96, 16, 32);
  const e = document.createElement("canvas");
  e.width = W; e.height = H;
  const ge = e.getContext("2d")!;
  ge.fillStyle = "#000000"; ge.fillRect(0, 0, W, H);
  for (const [x, y, w, h] of wins) {
    // Warm varied glow per window
    const warm = ["#ffc46b", "#ffd98a", "#ffb45e"][(x + y) % 3];
    ge.fillStyle = warm;
    ge.fillRect(x, y, w, h);
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const emissive = new THREE.CanvasTexture(e);
  emissive.colorSpace = THREE.SRGBColorSpace;
  return { map, emissive };
}

export function LagosMap({
  pins,
  onPinSelect,
}: {
  pins: PinLocation[];
  onPinSelect: (pin: PinLocation) => void;
}) {
  // Start the day/night cycle at the real Lagos time.
  const dayT0 = (() => {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Africa/Lagos", hour: "numeric", minute: "numeric", hour12: false,
      }).formatToParts(new Date());
      const h = Number(parts.find((x) => x.type === "hour")?.value || "12");
      const m = Number(parts.find((x) => x.type === "minute")?.value || "0");
      return ((h + m / 60) / 24) % 1;
    } catch {
      return 0.5;
    }
  })();
  const selectRef = useRef(onPinSelect);
  selectRef.current = onPinSelect;
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const rand = mulberry32(77);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    {
      const sc = document.createElement("canvas");
      sc.width = 4; sc.height = 256;
      const sx = sc.getContext("2d")!;
      const grad = sx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, "#6ea8dd"); grad.addColorStop(0.6, "#c3d9ee"); grad.addColorStop(1, "#eef0e8");
      sx.fillStyle = grad; sx.fillRect(0, 0, 4, 256);
      const skyTex = new THREE.CanvasTexture(sc);
      skyTex.colorSpace = THREE.SRGBColorSpace;
      scene.background = skyTex;
    }
    scene.fog = new THREE.Fog(0xd4dee8, 420, 900);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 1500);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.46;

    // Whole-Lagos establishing view.
    camera.position.set(0, 300, 230);
    controls.target.set(0, 0, 10);
    controls.minDistance = 25;
    controls.maxDistance = 600;
    controls.update();

    scene.add(new THREE.HemisphereLight(0xe0f2fe, 0x8a7a5a, 0.9));
    const sun = new THREE.DirectionalLight(0xfff7e6, 1.7);
    sun.position.set(-100, 180, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -160, right: 160, top: 160, bottom: -160, far: 600 });
    sun.shadow.bias = -0.0004;
    scene.add(sun);

    const dummy = new THREE.Object3D();
    const col = new THREE.Color();

    // ---- Water mask ----
    const maskImg = new Image();
    maskImg.src = waterMaskUrl;

    const build = () => {
      const mw = 256, mh = 170;
      const mc = document.createElement("canvas");
      mc.width = mw; mc.height = mh;
      const mg = mc.getContext("2d")!;
      mg.drawImage(maskImg, 0, 0, mw, mh);
      const data = mg.getImageData(0, 0, mw, mh).data;
      const isWaterLL = (lat: number, lon: number): boolean => {
        const px = Math.floor(((lon - M_LON_W) / (M_LON_E - M_LON_W)) * mw);
        const py = Math.floor(((M_LAT_N - lat) / (M_LAT_N - M_LAT_S)) * mh);
        if (px < 0 || px >= mw || py < 0 || py >= mh) return false;
        return data[(py * mw + px) * 4] > 128;
      };

      // ---- Ground ----
      const S = 1024;
      const c = document.createElement("canvas");
      c.width = S; c.height = S;
      const g = c.getContext("2d")!;
      // Urban base
      g.fillStyle = "#8f8a7d"; g.fillRect(0, 0, S, S);
      for (let i = 0; i < 16000; i++) {
        const v = rand();
        g.fillStyle = v < 0.4 ? "rgba(0,0,0,0.07)" : v < 0.75 ? "rgba(255,255,255,0.06)" : "rgba(120,90,60,0.08)";
        const s = 2 + rand() * 5;
        g.fillRect(rand() * S, rand() * S, s, s);
      }
      // Parks
      for (let i = 0; i < 50; i++) {
        const lon = LON_W + rand() * (LON_E - LON_W);
        const lat = LAT_S + rand() * (LAT_N - LAT_S);
        if (isWaterLL(lat, lon)) continue;
        const x = lon2u(lon) * S, y = lat2v(lat) * S;
        const w = 10 + rand() * 36, h = 8 + rand() * 26;
        g.fillStyle = "#5d8148";
        g.beginPath();
        for (let a = 0; a <= 6.4; a += 0.4) {
          const rr = 0.7 + rand() * 0.55;
          const px = x + Math.cos(a) * w * rr, py = y + Math.sin(a) * h * rr;
          a === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
        }
        g.closePath(); g.fill();
      }
      // Water painted from mask
      g.fillStyle = "#14506e";
      const step = 4;
      for (let py = 0; py < S; py += step) {
        for (let px = 0; px < S; px += step) {
          const lon = LON_W + (px / S) * (LON_E - LON_W);
          const lat = LAT_N - (py / S) * (LAT_N - LAT_S);
          if (isWaterLL(lat, lon)) g.fillRect(px, py, step, step);
        }
      }
      // Highways painted
      g.strokeStyle = "#2e2e2e"; g.lineWidth = 7; g.lineCap = "round";
      for (const hw of HIGHWAYS) {
        g.beginPath();
        hw.forEach(([lat, lon], i) => {
          const x = lon2u(lon) * S, y = lat2v(lat) * S;
          i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
        });
        g.stroke();
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(200, 220),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);

      // ---- Buildings ----
      const houseTex = makeHouseTextures();
      const towerTex = makeTowerTextures();
      // Keep-clear radius around landmark POIs (degrees)
      const clearOf = (lat: number, lon: number): boolean => {
        for (const p of POIS) {
          const dLat = (p.lat - lat) * 111;
          const dLon = (p.lon - lon) * 110;
          const clear = p.kind === "stadium" ? 0.6 : p.kind === "port" ? 0.8 : 0.35;
          if (Math.hypot(dLat, dLon) < clear) return false;
        }
        return true;
      };

      // Residential houses: walls + pitched (gable) roofs + compound feel
      const HN = 900;
      const houseBodies = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({
          map: houseTex.map,
          emissiveMap: houseTex.emissive,
          emissive: new THREE.Color(0xffffff),
          emissiveIntensity: 0,
          roughness: 0.92,
        }),
        HN
      );
      // Unit gable roof (triangle extruded)
      const roofShape = new THREE.Shape();
      roofShape.moveTo(-0.5, 0);
      roofShape.lineTo(0.5, 0);
      roofShape.lineTo(0, 0.55);
      roofShape.closePath();
      const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 1, bevelEnabled: false });
      roofGeo.translate(0, 0, -0.5);
      const houseRoofs = new THREE.InstancedMesh(
        roofGeo,
        new THREE.MeshStandardMaterial({ roughness: 0.9 }),
        HN
      );
      const wallPal = [0xe8dcc0, 0xdccfae, 0xf0e6d2, 0xd8c39a, 0xe4d4b8];
      const roofPal = [0xa4553a, 0x8f4a2f, 0x6e4423, 0x7a6a5a, 0x96502e];
      let hp = 0, guard = 0;
      const tankMesh = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.35, 0.35, 0.55, 10),
        new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.6 }),
        300
      );
      let tp = 0;
      while (hp < HN && guard++ < 40000) {
        const lon = LON_W + rand() * (LON_E - LON_W);
        const lat = LAT_S + rand() * (LAT_N - LAT_S);
        if (isWaterLL(lat, lon)) continue;
        if (!clearOf(lat, lon)) continue;
        const w = 1.6 + rand() * 2.2, d = 1.6 + rand() * 2.6;
        const h = 1.2 + rand() * 1.8, rh = 0.7 + rand() * 0.7;
        const rot = (rand() - 0.5) * 0.6;
        const x = lon2x(lon), z = lat2z(lat);
        dummy.position.set(x, h / 2, z);
        dummy.scale.set(w, h, d);
        dummy.rotation.set(0, rot, 0);
        dummy.updateMatrix();
        houseBodies.setMatrixAt(hp, dummy.matrix);
        col.setHex(wallPal[(rand() * wallPal.length) | 0]).multiplyScalar(0.92 + rand() * 0.16);
        houseBodies.setColorAt(hp, col);
        // Pitched roof on top
        dummy.position.set(x, h - 0.02, z);
        dummy.scale.set(w * 1.18, rh, d * 1.18);
        dummy.updateMatrix();
        houseRoofs.setMatrixAt(hp, dummy.matrix);
        col.setHex(roofPal[(rand() * roofPal.length) | 0]).multiplyScalar(0.9 + rand() * 0.2);
        houseRoofs.setColorAt(hp, col);
        // Rooftop water tank (very Lagos)
        if (rand() < 0.3 && tp < 300) {
          dummy.position.set(x + (rand() - 0.5) * w * 0.5, h + rh * 0.55 + 0.28, z + (rand() - 0.5) * d * 0.5);
          dummy.scale.set(1, 1, 1);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          tankMesh.setMatrixAt(tp++, dummy.matrix);
        }
        hp++;
      }
      houseBodies.count = hp; houseBodies.instanceMatrix.needsUpdate = true;
      if (houseBodies.instanceColor) houseBodies.instanceColor.needsUpdate = true;
      houseRoofs.count = hp; houseRoofs.instanceMatrix.needsUpdate = true;
      if (houseRoofs.instanceColor) houseRoofs.instanceColor.needsUpdate = true;
      houseBodies.castShadow = true; houseBodies.receiveShadow = true;
      houseRoofs.castShadow = true;
      scene.add(houseBodies); scene.add(houseRoofs);
      tankMesh.count = tp; tankMesh.instanceMatrix.needsUpdate = true;
      scene.add(tankMesh);

      // Mid/high-rise with windows (denser near VI/Ikeja)
      const TN = 220;
      const towers = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({
          map: towerTex.map,
          emissiveMap: towerTex.emissive,
          emissive: new THREE.Color(0xffffff),
          emissiveIntensity: 0,
          roughness: 0.7,
        }),
        TN
      );
      let twp = 0; guard = 0;
      const hubs: Array<[number, number]> = [[6.4271, 3.4303], [6.59, 3.345], [6.45, 3.39]];
      while (twp < TN && guard++ < 20000) {
        const hub = hubs[(rand() * hubs.length) | 0];
        const lon = hub[1] + (rand() - 0.5) * 0.06;
        const lat = hub[0] + (rand() - 0.5) * 0.06;
        if (lon < LON_W || lon > LON_E || lat < LAT_S || lat > LAT_N) continue;
        if (isWaterLL(lat, lon)) continue;
        if (!clearOf(lat, lon)) continue;
        const w = 5 + rand() * 4, d = 5 + rand() * 4, h = 6 + rand() * 10;
        dummy.position.set(lon2x(lon), h / 2, lat2z(lat));
        dummy.scale.set(w, h, d);
        dummy.rotation.set(0, (rand() - 0.5) * 0.3, 0);
        dummy.updateMatrix();
        towers.setMatrixAt(twp, dummy.matrix);
        twp++;
      }
      towers.count = twp; towers.instanceMatrix.needsUpdate = true;
      towers.castShadow = true;
      scene.add(towers);

      // ---- Roadside billboards (very Lagos) ----
      const adTexts: Array<[string, string, string]> = [
        ["ÈKÓ LIFE", "LIVE LAGOS", "#0ea5e9"],
        ["DANFO EXPRESS", "RIDE THE CITY", "#f59e0b"],
        ["OWAMBE SEASON", "PARTY JOLLOF", "#ec4899"],
        ["ZOBO FRESH", "ICE COLD", "#22c55e"],
        ["NAIJA BET", "WIN BIG", "#8b5cf6"],
      ];
      const billboards = new THREE.Group();
      const adTexes = adTexts.map(([big, small, bg]) => {
        const c = document.createElement("canvas");
        c.width = 512; c.height = 256;
        const g = c.getContext("2d")!;
        const grad = g.createLinearGradient(0, 0, 512, 256);
        grad.addColorStop(0, bg); grad.addColorStop(1, "#111827");
        g.fillStyle = grad; g.fillRect(0, 0, 512, 256);
        g.fillStyle = "#fff"; g.textAlign = "center";
        g.font = "800 72px system-ui,sans-serif";
        g.fillText(big, 256, 110);
        g.font = "600 44px system-ui,sans-serif";
        g.fillStyle = "rgba(255,255,255,0.85)";
        g.fillText(small, 256, 180);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      });
      let bi = 0;
      for (const hw of HIGHWAYS) {
        for (let i = 1; i < hw.length - 1 && bi < 14; i += 1) {
          if (rand() < 0.45) continue;
          const [lat, lon] = hw[i];
          const bx = lon2x(lon) + (rand() - 0.5) * 3;
          const bz = lat2z(lat) + (rand() - 0.5) * 3;
          // Keep off water
          const blon = LON_W + ((bx / 200) + 0.5) * (LON_E - LON_W);
          const blat = LAT_N - ((bz / 220) + 0.5) * (LAT_N - LAT_S);
          if (isWaterLL(blat, blon)) continue;
          const pole = new THREE.Mesh(
            new THREE.CylinderGeometry(0.14, 0.18, 5, 8),
            new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.7 })
          );
          pole.position.set(bx, 2.5, bz);
          pole.castShadow = true;
          const panel = new THREE.Mesh(
            new THREE.BoxGeometry(5.2, 2.6, 0.25),
            new THREE.MeshStandardMaterial({
              map: adTexes[bi % adTexes.length], roughness: 0.6,
            })
          );
          panel.position.set(bx, 6.1, bz);
          panel.rotation.y = rand() * Math.PI;
          panel.castShadow = true;
          // Back of panel (plain)
          const back = new THREE.Mesh(
            new THREE.BoxGeometry(5.2, 2.6, 0.1),
            new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.8 })
          );
          back.position.set(bx, 6.1, bz);
          back.rotation.y = panel.rotation.y + Math.PI;
          back.translateZ(0.12);
          billboards.add(pole, panel, back);
          bi++;
        }
      }
      scene.add(billboards);

      // ---- Landmark models ----
      const landmark = new THREE.Group();
      const addBox = (x: number, y: number, z: number, w: number, h: number, d: number, color: number, ry = 0) => {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, d),
          new THREE.MeshStandardMaterial({ color, roughness: 0.8 })
        );
        m.position.set(x, y, z); m.rotation.y = ry;
        m.castShadow = true;
        landmark.add(m);
        return m;
      };

      // National Stadium: tiered stands + roof + floodlights + pitch + track
      {
        const x = lon2x(3.365), z = lat2z(6.4971);
        // Outer wall (lower bowl)
        const bowl = new THREE.Mesh(
          new THREE.TorusGeometry(2.2, 0.75, 10, 32),
          new THREE.MeshStandardMaterial({ color: 0xd8d3c8, roughness: 0.85 })
        );
        bowl.rotation.x = Math.PI / 2; bowl.scale.set(1.3, 1, 0.42);
        bowl.position.set(x, 0.45, z); bowl.castShadow = true;
        landmark.add(bowl);
        // Upper tier (smaller, stacked)
        const upper = new THREE.Mesh(
          new THREE.TorusGeometry(1.9, 0.55, 10, 32),
          new THREE.MeshStandardMaterial({ color: 0xc9c2b2, roughness: 0.85 })
        );
        upper.rotation.x = Math.PI / 2; upper.scale.set(1.3, 1, 0.5);
        upper.position.set(x, 1.25, z); upper.castShadow = true;
        landmark.add(upper);
        // Main stand roof (curved canopy over one side)
        const roof = new THREE.Mesh(
          new THREE.CylinderGeometry(3.4, 3.4, 0.18, 32, 1, false, Math.PI * 0.7, Math.PI * 0.6),
          new THREE.MeshStandardMaterial({ color: 0x2b6cb0, roughness: 0.6, side: THREE.DoubleSide })
        );
        roof.scale.set(1.3, 1, 0.75);
        roof.position.set(x, 2.1, z); roof.castShadow = true;
        landmark.add(roof);
        // Roof support columns
        for (let i = 0; i < 6; i++) {
          const a = Math.PI * 0.7 + (i / 5) * Math.PI * 0.6;
          const cx = x + Math.cos(a) * 3.4 * 1.3;
          const cz = z + Math.sin(a) * 3.4 * 0.75;
          const colM = new THREE.Mesh(
            new THREE.CylinderGeometry(0.09, 0.09, 2.1, 8),
            new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.7 })
          );
          colM.position.set(cx, 1.05, cz);
          landmark.add(colM);
        }
        // Floodlight pylons (4 corners)
        for (const [fx, fz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          const px = x + fx * 3.6, pz = z + fz * 2.9;
          const pole = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.12, 4.2, 8),
            new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.7 })
          );
          pole.position.set(px, 2.1, pz); pole.castShadow = true;
          landmark.add(pole);
          const head = new THREE.Mesh(
            new THREE.BoxGeometry(0.9, 0.5, 0.25),
            new THREE.MeshStandardMaterial({
              color: 0x333333, emissive: 0xfff6c9, emissiveIntensity: 0.9, roughness: 0.5,
            })
          );
          head.position.set(px, 4.35, pz);
          head.lookAt(x, 0.5, z);
          landmark.add(head);
        }
        // Pitch + running track
        const field = new THREE.Mesh(
          new THREE.CircleGeometry(1.5, 28),
          new THREE.MeshStandardMaterial({ color: 0x4a8c3f, roughness: 1 })
        );
        field.rotation.x = -Math.PI / 2; field.scale.set(1.3, 1, 1);
        field.position.set(x, 0.1, z);
        landmark.add(field);
        // Mowing stripes on the pitch
        for (let i = -3; i <= 3; i++) {
          const stripe = new THREE.Mesh(
            new THREE.PlaneGeometry(0.42, 2.9),
            new THREE.MeshStandardMaterial({
              color: i % 2 === 0 ? 0x55a047 : 0x4a8c3f, roughness: 1,
            })
          );
          stripe.rotation.x = -Math.PI / 2;
          stripe.position.set(x + i * 0.44, 0.11, z);
          landmark.add(stripe);
        }
        const track = new THREE.Mesh(
          new THREE.RingGeometry(1.95, 2.35, 32),
          new THREE.MeshStandardMaterial({ color: 0xb4502e, roughness: 1 })
        );
        track.rotation.x = -Math.PI / 2; track.scale.set(1.3, 1, 1);
        track.position.set(x, 0.09, z);
        landmark.add(track);
      }
      // Teslim Balogun: smaller bowl
      {
        const x = lon2x(3.3608), z = lat2z(6.4998);
        const bowl = new THREE.Mesh(
          new THREE.TorusGeometry(1.4, 0.45, 8, 24),
          new THREE.MeshStandardMaterial({ color: 0xcfc9bc, roughness: 0.85 })
        );
        bowl.rotation.x = Math.PI / 2; bowl.scale.set(1.2, 1, 0.45);
        bowl.position.set(x, 0.35, z); bowl.castShadow = true;
        landmark.add(bowl);
        const field = new THREE.Mesh(
          new THREE.CircleGeometry(1.1, 24),
          new THREE.MeshStandardMaterial({ color: 0x4a8c3f, roughness: 1 })
        );
        field.rotation.x = -Math.PI / 2; field.scale.set(1.2, 1, 1);
        field.position.set(x, 0.12, z);
        landmark.add(field);
      }
      // Hospitals: tower with window strips + podium + red cross + entrance canopy
      const hospital = (lat: number, lon: number, s: number) => {
        const x = lon2x(lon), z = lat2z(lat);
        // Main ward block (white with horizontal window bands)
        addBox(x, 1.5 * s, z, 2.6 * s, 3 * s, 2.2 * s, 0xf5f7fa);
        for (let f = 0; f < 4; f++) {
          addBox(x, (0.7 + f * 0.65) * s, z + 1.12 * s, 2.3 * s, 0.32 * s, 0.06 * s, 0x35506b);
        }
        // Red cross on the facade
        addBox(x, 2.2 * s, z + 1.16 * s, 0.9 * s, 0.28 * s, 0.05 * s, 0xdc2626);
        addBox(x, 2.2 * s, z + 1.16 * s, 0.28 * s, 0.9 * s, 0.05 * s, 0xdc2626);
        // Podium (clinics / reception)
        addBox(x, 0.55 * s, z + 1.9 * s, 3.4 * s, 1.1 * s, 1.6 * s, 0xe8ecf1);
        // Entrance canopy
        addBox(x, 0.85 * s, z + 2.9 * s, 1.6 * s, 0.12 * s, 1.1 * s, 0x2b6cb0);
        // Roof cross
        addBox(x, 3.15 * s, z, 0.8 * s, 0.25 * s, 0.25 * s, 0xdc2626);
        addBox(x, 3.15 * s, z, 0.25 * s, 0.25 * s, 0.8 * s, 0xdc2626);
      };
      hospital(6.5183, 3.3566, 1.2); // LUTH
      hospital(6.5897, 3.3422, 1.0); // LASUTH
      hospital(6.433, 3.4204, 0.8); // Reddington
      // Airport: runway + terminal (realistic scale)
      {
        const x = lon2x(3.3329), z = lat2z(6.5848);
        addBox(x, 0.15, z, 14, 0.3, 2.2, 0x3a3f45, 0.35);
        addBox(x + 1.2, 0.8, z + 2.5, 3.6, 1.6, 2.4, 0xe8e4da, 0.35);
      }
      // Cargo ships at Apapa (realistic scale: ~250m)
      const ship = (lat: number, lon: number, ry: number) => {
        const x = lon2x(lon), z = lat2z(lat);
        addBox(x, 0.5, z, 8, 1, 2.2, 0x274156, ry);
        const cols = [0xef4444, 0x3b82f6, 0x22c55e, 0xf59e0b, 0x8b5cf6];
        for (let i = 0; i < 6; i++) {
          addBox(
            x + Math.cos(ry) * (i - 2.5) * 1.15,
            1.35, z - Math.sin(ry) * (i - 2.5) * 1.15,
            1, 0.7, 1.9, cols[i % cols.length], ry
          );
        }
        addBox(x - Math.cos(ry) * 3.4, 1.6, z + Math.sin(ry) * 3.4, 1.2, 2.2, 2, 0xf0ede6, ry);
      };
      ship(6.443, 3.372, 0.25);
      ship(6.438, 3.362, -0.15);
      ship(6.43, 3.34, 0.1);
      // National Theatre: distinctive saucer (realistic scale)
      {
        const x = lon2x(3.3697), z = lat2z(6.4767);
        const saucer = new THREE.Mesh(
          new THREE.CylinderGeometry(3.2, 2.2, 1.2, 24),
          new THREE.MeshStandardMaterial({ color: 0xd9cfae, roughness: 0.8 })
        );
        saucer.position.set(x, 0.8, z); saucer.castShadow = true;
        landmark.add(saucer);
        const roof = new THREE.Mesh(
          new THREE.ConeGeometry(3.4, 1, 24),
          new THREE.MeshStandardMaterial({ color: 0x8f4a2f, roughness: 0.85 })
        );
        roof.position.set(x, 1.9, z); roof.castShadow = true;
        landmark.add(roof);
      }
      scene.add(landmark);

      // ---- 3D bridges (deck + pillars + railings) ----
      // Lamp material defined here (used by bridge streetlights, glows at night)
      const bridgeLampMat = new THREE.MeshStandardMaterial({
        color: 0x555555, emissive: new THREE.Color(0xffe9a8), emissiveIntensity: 0, roughness: 0.5,
      });
      const bridgeLampHeads: THREE.Mesh[] = [];
      const bridgeHWs = [HIGHWAYS[0], HIGHWAYS[1], HIGHWAYS[2], HIGHWAYS[8]];
      const bridgeGroup = new THREE.Group();
      for (const hw of bridgeHWs) {
        const pts = hw.map(([lat, lon]) => new THREE.Vector3(lon2x(lon), 0, lat2z(lat)));
        const curve = new THREE.CatmullRomCurve3(pts);
        const N = 40;
        let prev: THREE.Vector3 | null = null;
        for (let i = 0; i <= N; i++) {
          const p = curve.getPoint(i / N);
          if (prev) {
            const mx = (p.x + prev.x) / 2, mz = (p.z + prev.z) / 2;
            const len = Math.hypot(p.x - prev.x, p.z - prev.z) + 0.4;
            const ang = Math.atan2(p.x - prev.x, p.z - prev.z);
            // Deck
            const deck = new THREE.Mesh(
              new THREE.BoxGeometry(3.2, 0.5, len),
              new THREE.MeshStandardMaterial({ color: 0x8f959d, roughness: 0.8 })
            );
            deck.position.set(mx, 1.6, mz);
            deck.rotation.y = ang;
            deck.castShadow = true;
            deck.receiveShadow = true;
            bridgeGroup.add(deck);
            // Railings
            for (const side of [-1.45, 1.45]) {
              const rail = new THREE.Mesh(
                new THREE.BoxGeometry(0.18, 0.7, len),
                new THREE.MeshStandardMaterial({ color: 0xd7dce2, roughness: 0.6 })
              );
              rail.position.set(
                mx + Math.cos(ang) * side,
                2.15,
                mz - Math.sin(ang) * side
              );
              rail.rotation.y = ang;
              bridgeGroup.add(rail);
            }
            // Streetlights (lamp head glows at night)
            if (i % 4 === 0) {
              const lamp = new THREE.Mesh(
                new THREE.CylinderGeometry(0.06, 0.08, 2.2, 6),
                new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.7 })
              );
              lamp.position.set(mx + Math.cos(ang) * 1.2, 2.9, mz - Math.sin(ang) * 1.2);
              bridgeGroup.add(lamp);
              const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), bridgeLampMat);
              head.position.set(mx + Math.cos(ang) * 1.2, 4.05, mz - Math.sin(ang) * 1.2);
              bridgeGroup.add(head);
              bridgeLampHeads.push(head);
            }
          }
          // Pillars every 5 segments
          if (i % 5 === 0) {
            const pillar = new THREE.Mesh(
              new THREE.CylinderGeometry(0.5, 0.65, 4.5, 8),
              new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.85 })
            );
            pillar.position.set(p.x, -0.6, p.z);
            bridgeGroup.add(pillar);
          }
          prev = p;
        }
      }
      scene.add(bridgeGroup);

      // ---- Living world: day/night cycle, boats, birds, aircraft ----
      const DAY_LEN = 150; // seconds per full day
      // Sky colors
      const skyDay = new THREE.Color(0x6ea8dd);
      const skyNight = new THREE.Color(0x0a1428);
      const skyDawn = new THREE.Color(0xe8a06a);
      // Make sky a shader-updatable color (replace static texture)
      (scene.background as THREE.CanvasTexture).dispose?.();
      scene.background = new THREE.Color(0x6ea8dd);
      scene.fog = new THREE.Fog(0xd4dee8, 420, 900);
      const fogDay = new THREE.Color(0xd4dee8);
      const fogNight = new THREE.Color(0x0a1428);

      // Moving boats: routes across the lagoon + harbor
      interface BoatRoute { pts: Array<[number, number]>; speed: number; }
      const routes: BoatRoute[] = [
        { pts: [[6.52, 3.40], [6.48, 3.42], [6.45, 3.41], [6.43, 3.43]], speed: 0.008 },
        { pts: [[6.44, 3.37], [6.45, 3.39], [6.47, 3.40]], speed: 0.011 },
        { pts: [[6.50, 3.41], [6.47, 3.425], [6.44, 3.42]], speed: 0.009 },
      ];
      const movingBoats: Array<{ grp: THREE.Group; route: BoatRoute; t: number }> = [];
      const boatHullMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.7 });
      const boatCanopyMat = new THREE.MeshStandardMaterial({ color: 0x2b6cb0, roughness: 0.7 });
      for (const route of routes) {
        for (let k = 0; k < 2; k++) {
          const grp = new THREE.Group();
          // Hull (canoe-like)
          const hull = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 4.2), boatHullMat);
          hull.position.y = 0.25;
          // Canopy
          const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 2.2), boatCanopyMat);
          canopy.position.set(0, 0.9, -0.3);
          // Outboard motor
          const motor = new THREE.Mesh(
            new THREE.BoxGeometry(0.3, 0.6, 0.4),
            new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 })
          );
          motor.position.set(0, 0.4, 2.2);
          grp.add(hull, canopy, motor);
          // Wake (fading trail)
          const wake = new THREE.Mesh(
            new THREE.PlaneGeometry(1.2, 5),
            new THREE.MeshBasicMaterial({
              color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false,
            })
          );
          wake.rotation.x = -Math.PI / 2;
          wake.position.set(0, 0.06, 3.2);
          grp.add(wake);
          scene.add(grp);
          movingBoats.push({ grp, route, t: rand() });
        }
      }
      const routePoint = (route: BoatRoute, t: number): [number, number, number] => {
        const n = route.pts.length - 1;
        const ft = (t % 1) * n;
        const i = Math.min(n - 1, Math.floor(ft));
        const f = ft - i;
        const [lat0, lon0] = route.pts[i];
        const [lat1, lon1] = route.pts[i + 1];
        const lat = lat0 + (lat1 - lat0) * f;
        const lon = lon0 + (lon1 - lon0) * f;
        const ang = Math.atan2(lon1 - lon0, lat1 - lat0);
        return [lat, lon, ang];
      };

      // Birds: flapping gull sprites
      const birdTex = (() => {
        const c = document.createElement("canvas");
        c.width = 64; c.height = 32;
        const g = c.getContext("2d")!;
        g.strokeStyle = "rgba(30,30,40,0.9)";
        g.lineWidth = 4; g.lineCap = "round";
        g.beginPath();
        g.moveTo(6, 22); g.quadraticCurveTo(20, 8, 32, 20); g.quadraticCurveTo(44, 8, 58, 22);
        g.stroke();
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      })();
      const birds: Array<{ spr: THREE.Sprite; cx: number; cz: number; r: number; speed: number; ph: number; h: number }> = [];
      for (let i = 0; i < 14; i++) {
        const spr = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: birdTex, transparent: true, depthTest: false, opacity: 0.85 })
        );
        const s = 2.2 + rand() * 1.5;
        spr.scale.set(s, s / 2, 1);
        spr.renderOrder = 6;
        scene.add(spr);
        birds.push({
          spr,
          cx: (rand() - 0.5) * 160,
          cz: (rand() - 0.5) * 180,
          r: 25 + rand() * 45,
          speed: 0.25 + rand() * 0.35,
          ph: rand() * Math.PI * 2,
          h: 45 + rand() * 35,
        });
      }

      // Aircraft: occasional flyover
      const aircraft = new THREE.Group();
      {
        const mat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4, metalness: 0.3 });
        const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 7, 10), mat);
        fus.rotation.z = Math.PI / 2;
        const wing = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.15, 9), mat);
        const tail = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, 0.15), mat);
        tail.position.set(-3.2, 0.8, 0);
        const tailH = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 3.4), mat);
        tailH.position.set(-3.2, 0.9, 0);
        aircraft.add(fus, wing, tail, tailH);
        // Nav lights
        const navL = new THREE.Mesh(
          new THREE.SphereGeometry(0.18, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0xff3333 })
        );
        navL.position.set(0, 0, 4.6);
        const navR = navL.clone();
        (navR.material as THREE.MeshBasicMaterial) = new THREE.MeshBasicMaterial({ color: 0x33ff33 });
        navR.position.set(0, 0, -4.6);
        aircraft.add(navL, navR);
        aircraft.visible = false;
        scene.add(aircraft);
      }
      let planeT = -1; // -1 = waiting
      let planeTimer = 8; // first flyover after 8s

      // Building lights: WINDOWS ONLY (pure black emissive maps)
      const towerMat = (towers as THREE.InstancedMesh).material as THREE.MeshStandardMaterial;
      const houseMat = (houseBodies as THREE.InstancedMesh).material as THREE.MeshStandardMaterial;
      // Billboard glow at night
      const bbMats: THREE.MeshStandardMaterial[] = [];
      billboards.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (m && m.map) bbMats.push(m);
      });

      // ---- Pale zoom-dependent labels ----
      // Regions (always, pale) + POIs (pale far, pure/crisp near)
      const REGIONS: Array<[string, number, number]> = [
        ["MAINLAND", 3.355, 6.58],
        ["ISLAND", 3.398, 6.448],
        ["LEKKI", 3.49, 6.435],
        ["LAGOS LAGOON", 3.44, 6.52],
        ["ATLANTIC OCEAN", 3.42, 6.365],
      ];
      const labelGroup = new THREE.Group();
      const labelSprites: Array<{ spr: THREE.Sprite; tier: number; region: boolean }> = [];
      const addLabel = (text: string, lon: number, lat: number, tier: number, region: boolean, h: number) => {
        const tex = makePillLabel(text, tier);
        const aspect = (tex.image as HTMLCanvasElement).width / 68;
        const spr = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: tex,
            depthTest: false, transparent: true, opacity: 0.85,
          })
        );
        spr.scale.set(h * aspect, h, 1);
        spr.position.set(lon2x(lon), region ? 22 : 14, lat2z(lat));
        spr.renderOrder = 5;
        labelGroup.add(spr);
        labelSprites.push({ spr, tier, region });
      };
      for (const [name, lon, lat] of REGIONS) addLabel(name, lon, lat, 0, true, 9);
      for (const p of POIS) addLabel(p.label, p.lon, p.lat, p.tier, false, p.tier === 0 ? 7 : 5.5);
      scene.add(labelGroup);

      // ---- Game pins (tap to travel) ----
      // Pin x/z arrive in legacy world space (-86..86); remap to lon/lat.
      const pinToLatLon = (x: number, z: number): [number, number] => {
        const lon = LON_W + ((x + 86) / 172) * (LON_E - LON_W);
        const lat = LAT_N - ((z + 86) / 172) * (LAT_N - LAT_S);
        return [lat, lon];
      };
      const pinSprites: THREE.Sprite[] = [];
      const pinGroup = new THREE.Group();
      const rebuildPins = () => {
        while (pinGroup.children.length) {
          const ch = pinGroup.children.pop()!;
          pinGroup.remove(ch);
        }
        pinSprites.length = 0;
        for (const pin of pinsRef.current) {
          let [lat, lon] = pinToLatLon(pin.x, pin.z);
          // Nudge off water
          let guard = 0;
          while (isWaterLL(lat, lon) && guard++ < 40) lon -= 0.004;
          const spr = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: makeEmojiTexture(pin.emoji || "📍"),
              depthTest: false, transparent: true,
            })
          );
          spr.scale.set(6, 6, 1);
          spr.position.set(lon2x(lon), 6, lat2z(lat));
          spr.renderOrder = 10;
          (spr as any).userData.pin = pin;
          (spr as any).userData.baseY = 6;
          pinSprites.push(spr);
          pinGroup.add(spr);
        }
      };
      rebuildPins();
      scene.add(pinGroup);

      // Tooltip + tap-to-select
      const tooltip = document.createElement("div");
      tooltip.className = "city-map-pin-tip";
      tooltip.hidden = true;
      mount.appendChild(tooltip);
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      const setPointer = (e: PointerEvent) => {
        const r = renderer.domElement.getBoundingClientRect();
        pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
        pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      };
      let downX = 0, downY = 0;
      const onDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY; };
      const onUp = (e: PointerEvent) => {
        if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) return;
        setPointer(e);
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(pinSprites, false)[0];
        if (hit) {
          const pin = (hit.object as THREE.Sprite).userData.pin as PinLocation;
          selectRef.current(pin);
        }
      };
      const el = renderer.domElement;
      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointerup", onUp);

      // Animation: day/night + living world + zoom-tier labels
      const clock = new THREE.Clock();
      let raf = 0;
      // Offset clock so dayT starts at dayT0
      const tOffset = dayT0 * DAY_LEN;
      const animate = () => {
        raf = requestAnimationFrame(animate);
        const t = clock.getElapsedTime() + tOffset;
        const dist = camera.position.distanceTo(controls.target);

        // --- Day/night cycle ---
        const dayT = (t / DAY_LEN) % 1; // 0=midnight, 0.25=sunrise, 0.5=noon, 0.75=sunset
        const sunA = dayT * Math.PI * 2 - Math.PI / 2; // start at sunrise
        const sunH = Math.sin(sunA); // -1..1, >0 = day
        const dayF = THREE.MathUtils.smoothstep(sunH, -0.08, 0.25); // 0 night → 1 day
        const duskF = Math.exp(-Math.pow(sunH / 0.18, 2)); // golden near horizon
        // Sky
        (scene.background as THREE.Color).copy(skyNight).lerp(skyDay, dayF).lerp(skyDawn, duskF * 0.55);
        (scene.fog as THREE.Fog).color.copy(fogNight).lerp(fogDay, dayF);
        // Sun
        const sunDist = 220;
        sun.position.set(Math.cos(sunA) * sunDist, Math.max(sunH, -0.3) * sunDist * 0.9 + 20, 80);
        sun.intensity = 0.12 + dayF * 1.6;
        sun.color.setHex(0xfff7e6).lerp(new THREE.Color(0xff9a5c), duskF * 0.7);
        // Night lights: WINDOWS ONLY on every building + bridge lamps
        const nightF = 1 - dayF;
        towerMat.emissiveIntensity = nightF * 1.6;
        houseMat.emissiveIntensity = nightF * 1.3;
        bridgeLampMat.emissiveIntensity = nightF * 2.2;
        for (const m of bbMats) m.emissiveIntensity = nightF * 0.9;

        // --- Moving boats ---
        for (const b of movingBoats) {
          b.t = (b.t + b.route.speed * (1 / 60)) % 1;
          const [lat, lon, ang] = routePoint(b.route, b.t);
          b.grp.position.set(lon2x(lon), 0.15 + Math.sin(t * 2 + b.t * 9) * 0.08, lat2z(lat));
          b.grp.rotation.y = ang;
        }
        // --- Pin bobbing ---
        pinSprites.forEach((s, i) => {
          s.position.y = (s.userData.baseY as number) + Math.sin(t * 2 + i * 1.7) * 0.45;
        });
        // --- Birds ---
        for (const bd of birds) {
          const a = t * bd.speed + bd.ph;
          bd.spr.position.set(
            bd.cx + Math.cos(a) * bd.r,
            bd.h + Math.sin(t * 0.9 + bd.ph) * 4,
            bd.cz + Math.sin(a) * bd.r
          );
          // Flap: scale y oscillates
          const flap = Math.abs(Math.sin(t * 7 + bd.ph));
          (bd.spr.scale as THREE.Vector3).y = (2.2 * (0.35 + flap * 0.65)) / 2;
          bd.spr.material.opacity = 0.25 + dayF * 0.65;
        }
        // --- Aircraft flyover ---
        planeTimer -= 1 / 60;
        if (planeT < 0 && planeTimer <= 0) {
          planeT = 0;
          aircraft.visible = true;
          const dir = rand() < 0.5 ? 1 : -1;
          aircraft.userData.dir = dir;
          aircraft.userData.z = (rand() - 0.5) * 160;
          aircraft.userData.h = 90 + rand() * 40;
          aircraft.position.set(-140 * dir, aircraft.userData.h, aircraft.userData.z);
          aircraft.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        }
        if (planeT >= 0) {
          planeT += (1 / 60) * 0.03;
          const dir = aircraft.userData.dir as number;
          aircraft.position.x = (-140 + planeT * 300) * dir;
          aircraft.position.y = aircraft.userData.h + Math.sin(t * 0.8) * 2;
          // Blink nav lights at night
          const blink = nightF > 0.5 ? (Math.sin(t * 6) > 0 ? 1 : 0.15) : 1;
          aircraft.children.forEach((ch) => {
            if ((ch as THREE.Mesh).material instanceof THREE.MeshBasicMaterial) {
              ((ch as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = blink;
              ((ch as THREE.Mesh).material as THREE.MeshBasicMaterial).transparent = true;
            }
          });
          if (planeT >= 1) {
            planeT = -1;
            aircraft.visible = false;
            planeTimer = 18 + rand() * 22; // next flyover in 18-40s
          }
        }

        // --- Labels: pale far → pure near ---
        for (const { spr, tier, region } of labelSprites) {
          if (region) {
            spr.visible = true;
            (spr.material as THREE.SpriteMaterial).opacity = dist > 300 ? 0.9 : 0.5;
          } else if (dist > 320) {
            spr.visible = tier === 0;
            (spr.material as THREE.SpriteMaterial).opacity = 0.7;
          } else if (dist > 150) {
            spr.visible = true;
            (spr.material as THREE.SpriteMaterial).opacity = 0.8;
          } else {
            spr.visible = true;
            (spr.material as THREE.SpriteMaterial).opacity = 1.0;
          }
        }
        controls.update();
        renderer.render(scene, camera);
      };
      animate();

      const resize = () => {
        const w = mount.clientWidth || 1, h = mount.clientHeight || 1;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(mount);

      return () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointerup", onUp);
        tooltip.remove();
        renderer.dispose();
        if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      };
    };

    let cleanup: (() => void) | undefined;
    if (maskImg.complete) cleanup = build();
    else maskImg.onload = () => { cleanup = build(); };

    return () => { cleanup?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={mountRef} className="city-map-wrap" style={{ width: "100%", height: "100%", minHeight: 420 }} />;
}
