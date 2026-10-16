/**
 * Nigeria detail scene builder — extracted from NigeriaMap.tsx with the
 * mockup's upgrades (520 instanced micro trees, feathered terrain edges,
 * water registry for shimmer). Pure three.js, no React.
 *
 * The returned group is built in flat project() coordinates. The travel
 * globe (GlobeMap) reparents it onto the globe surface at Nigeria's real
 * position; NigeriaMap is no longer the consumer.
 */
import * as THREE from "three";
import {
  HERO_ROUTES,
  PLAYABLE_CITIES,
  findRoad,
  project,
  type NigeriaGeo,
} from "./nigeriaGeo";
import { CITY_DISPLAY } from "./globeMath";

export interface FadeMat {
  m: THREE.Material;
  base: number;
}

export interface NigeriaDetail {
  /** Flat-built detail group (project() coords, y-up). */
  group: THREE.Group;
  /** All non-water materials, for the LOD fade. */
  detailMats: FadeMat[];
  /** Water materials (rivers, lagoon/lake), for the shimmer pass. */
  waterMats: FadeMat[];
  /** State/hub/city labels — faded out when the deep LOD takes over. */
  labelSprites: THREE.Sprite[];
  /** Raycast targets for the 4 playable cities. */
  cityHitMeshes: THREE.Object3D[];
  setPulseCity: (id: string) => void;
  drawRoute: (from: string, to: string | null) => void;
  /** now: ms timestamp, dt: seconds, dk: LOD fade 0..1, deepK: deep fade 0..1. */
  update: (now: number, dt: number, dk: number, deepK: number) => void;
  dispose: () => void;
}

export interface DeepLayer {
  group: THREE.Group;
  deepMats: FadeMat[];
  update: (now: number, dt: number) => void;
  dispose: () => void;
}

const GAME_STATES = ["Lagos", "Edo", "Rivers", "FederalCapitalTerritory"];

function prettyState(n: string): string {
  return n
    .replace("FederalCapitalTerritory", "FCT")
    .replace("AkwaIbom", "Akwa Ibom")
    .replace("CrossRiver", "Cross River");
}

function prettyHub(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function inRing(lon: number, lat: number, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1],
      xj = ring[j][0],
      yj = ring[j][1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

export function buildNigeriaDetail(
  geo: NigeriaGeo,
  currentCityId: string
): NigeriaDetail {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(d: T): T => {
    disposables.push(d);
    return d;
  };
  const detailMats: FadeMat[] = [];
  const waterMats: FadeMat[] = [];
  const labelSprites: THREE.Sprite[] = [];

  // ---- terrain texture: vegetation zones by latitude ----
  const makeTerrainTexture = () => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 512;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0.0, "#d9b77c"); // Sahel tan (north)
    grad.addColorStop(0.3, "#cfa96e");
    grad.addColorStop(0.4, "#b3a05e"); // savanna olive
    grad.addColorStop(0.55, "#8a9448");
    grad.addColorStop(0.68, "#4a7c3a"); // transition
    grad.addColorStop(0.78, "#2a6b35"); // rainforest
    grad.addColorStop(1.0, "#1c5a2d"); // deep forest (south)
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 512);
    for (let i = 0; i < 2400; i++) {
      const y = Math.random() * 512;
      const x = Math.random() * 64;
      const lat = 13.8 - (y / 512) * (13.8 - 4.2);
      g.fillStyle =
        lat < 7.5
          ? "rgba(18,66,28,0.28)"
          : lat < 10.5
            ? "rgba(118,108,58,0.24)"
            : "rgba(158,128,78,0.22)";
      g.fillRect(x, y, 2, 2);
    }
    const tex = track(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };

  // ---- feathered alpha edge: detail patch melts into the Earth texture ----
  const makeFeatherAlpha = () => {
    const S = 512;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, S, S);
    const X = (lon: number) => ((lon - 2.6) / (14.8 - 2.6)) * S;
    const Y = (lat: number) => (1 - (lat - 4.2) / (13.8 - 4.2)) * S;
    const trace = () => {
      for (const ring of geo.outline) {
        if (ring.length < 3) continue;
        g.beginPath();
        ring.forEach(([lon, lat], i) => {
          if (i) g.lineTo(X(lon), Y(lat));
          else g.moveTo(X(lon), Y(lat));
        });
        g.closePath();
        g.fill();
      }
    };
    g.fillStyle = "#ffffff";
    g.shadowColor = "#ffffff";
    g.shadowBlur = 14; // soft outer falloff
    trace();
    g.shadowBlur = 0; // solid interior
    trace();
    return track(new THREE.CanvasTexture(c));
  };

  const terrainTex = makeTerrainTexture();
  const featherTex = makeFeatherAlpha();

  // ---- landmass from the country outline ----
  for (const ring of geo.outline) {
    if (ring.length < 3) continue;
    const shape = new THREE.Shape();
    ring.forEach(([lon, lat], i) => {
      if (i === 0) shape.moveTo(lon, lat);
      else shape.lineTo(lon, lat);
    });
    const sgeo = track(new THREE.ShapeGeometry(shape));
    const pos = sgeo.attributes.position;
    const uv = sgeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const lon = pos.getX(i);
      const lat = pos.getY(i);
      const [x, z] = project(lon, lat);
      pos.setXYZ(i, x, 0, z);
      uv.setXY(i, (lon - 2.6) / (14.8 - 2.6), (lat - 4.2) / (13.8 - 4.2));
    }
    sgeo.computeVertexNormals();
    group.add(
      new THREE.Mesh(
        sgeo,
        track(
          new THREE.MeshBasicMaterial({
            map: terrainTex,
            alphaMap: featherTex,
            transparent: true,
            side: THREE.DoubleSide,
          })
        )
      )
    );
  }

  // sandy coastline rim
  for (const ring of geo.outline) {
    if (ring.length < 3) continue;
    const pts = ring.map(([lon, lat]) => {
      const [x, z] = project(lon, lat);
      return new THREE.Vector3(x, 0.6, z);
    });
    group.add(
      new THREE.LineLoop(
        track(new THREE.BufferGeometry().setFromPoints(pts)),
        track(
          new THREE.LineBasicMaterial({
            color: 0xe8c98a,
            transparent: true,
            opacity: 0.9,
          })
        )
      )
    );
  }

  // ---- state outlines ----
  const gameLine = track(
    new THREE.LineBasicMaterial({ color: 0x46e8d2, transparent: true, opacity: 0.9 })
  );
  const dimLine = track(
    new THREE.LineBasicMaterial({ color: 0x1f6f7e, transparent: true, opacity: 0.45 })
  );
  for (const st of geo.states) {
    const mat = GAME_STATES.includes(st.name) ? gameLine : dimLine;
    for (const ring of st.polys) {
      if (ring.length < 3) continue;
      const pts = ring.map(([lon, lat]) => {
        const [x, z] = project(lon, lat);
        return new THREE.Vector3(x, 0.9, z);
      });
      group.add(
        new THREE.LineLoop(track(new THREE.BufferGeometry().setFromPoints(pts)), mat)
      );
    }
  }

  // ---- rivers ----
  for (const rv of geo.rivers) {
    for (const seg of rv.segs) {
      if (seg.length < 4) continue;
      const pts = seg.map(([lon, lat]) => {
        const [x, z] = project(lon, lat);
        return new THREE.Vector3(x, 0.55, z);
      });
      const curve = new THREE.CatmullRomCurve3(pts);
      const wmat = track(
        new THREE.MeshBasicMaterial({
          color: rv.major ? 0x2f8fe0 : 0x2a7cc6,
          transparent: true,
          opacity: 0.92,
        })
      );
      wmat.userData.phase = Math.random() * Math.PI * 2;
      waterMats.push({ m: wmat, base: 0.92 });
      group.add(
        new THREE.Mesh(
          track(
            new THREE.TubeGeometry(
              curve,
              Math.min(140, seg.length * 2),
              rv.major ? 0.85 : 0.42,
              5,
              false
            )
          ),
          wmat
        )
      );
    }
  }
  const waterBlob = (lon: number, lat: number, rx: number, rz: number) => {
    const [x, z] = project(lon, lat);
    const wmat = track(
      new THREE.MeshBasicMaterial({
        color: 0x2f8fe0,
        transparent: true,
        opacity: 0.9,
      })
    );
    wmat.userData.phase = Math.random() * Math.PI * 2;
    waterMats.push({ m: wmat, base: 0.9 });
    const m = new THREE.Mesh(track(new THREE.CircleGeometry(1, 26)), wmat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.55, z);
    m.scale.set(rx, rz, 1);
    group.add(m);
  };
  waterBlob(3.62, 6.47, 7.5, 3.2); // Lagos Lagoon
  waterBlob(13.75, 13.0, 9, 6); // Lake Chad hint

  // ---- road network: all real routes ----
  for (const [key, r] of Object.entries(geo.roads)) {
    const pts = r.coords.map(([lon, lat]) => {
      const [x, z] = project(lon, lat);
      return new THREE.Vector3(x, 1.15, z);
    });
    const curve = new THREE.CatmullRomCurve3(pts);
    const hero = HERO_ROUTES.includes(key);
    group.add(
      new THREE.Mesh(
        track(new THREE.TubeGeometry(curve, 60, hero ? 0.62 : 0.42, 5, false)),
        track(
          new THREE.MeshBasicMaterial({
            color: hero ? 0xd8c193 : 0x8d8672,
            transparent: true,
            opacity: hero ? 0.85 : 0.5,
          })
        )
      )
    );
  }

  // ---- micro trees (instanced, 3 draw calls): dense where vegetation is ----
  const inNigeria = (lon: number, lat: number): boolean => {
    for (const st of geo.states)
      for (const ring of st.polys)
        if (ring.length > 2 && inRing(lon, lat, ring)) return true;
    return false;
  };
  // water exclusion: lagoon / Lake Chad blobs + river corridors
  const waterBlobs = [
    [3.62, 6.47, 7.5, 3.2],
    [13.75, 13.0, 9, 6],
  ].map(([lon, lat, rx, rz]) => {
    const [bx, bz] = project(lon, lat);
    return [bx, bz, rx, rz] as [number, number, number, number];
  });
  const riverPts: Array<[number, number, number]> = [];
  for (const rv of geo.rivers)
    for (const seg of rv.segs)
      for (let i = 0; i < seg.length; i += 2) {
        const [rx0, rz0] = project(seg[i][0], seg[i][1]);
        riverPts.push([rx0, rz0, rv.major ? 2.4 : 1.6]);
      }
  const inWaterXZ = (x: number, z: number): boolean => {
    for (const [bx, bz, rx, rz] of waterBlobs) {
      const dx = (x - bx) / rx;
      const dz = (z - bz) / rz;
      if (dx * dx + dz * dz < 1) return true;
    }
    for (const [px, pz, r] of riverPts) {
      const dx = x - px;
      const dz = z - pz;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  };
  const hubXZ = Object.values(geo.hubs).map(([lon, lat]) => project(lon, lat));
  const treeSpots: Array<[number, number, number]> = [];
  let guard = 0;
  while (treeSpots.length < 520 && guard++ < 30000) {
    const lon = 2.6 + Math.random() * (14.8 - 2.6);
    const lat = 4.2 + Math.random() * (13.8 - 4.2);
    if (!inNigeria(lon, lat)) continue;
    const [tx, tz] = project(lon, lat);
    if (inWaterXZ(tx, tz)) continue;
    if (
      hubXZ.some(
        ([cx, cz]) => (cx - tx) * (cx - tx) + (cz - tz) * (cz - tz) < 10 * 10
      )
    )
      continue;
    // vegetation density: rainforest south >> savanna > sahel north
    const zone = lat < 7.5 ? 0 : lat < 10.5 ? 1 : 2;
    const p = zone === 0 ? 0.92 : zone === 1 ? 0.5 : 0.12;
    if (Math.random() > p) continue;
    treeSpots.push([lon, lat, zone]);
  }
  {
    const trunkGeo = track(new THREE.CylinderGeometry(0.13, 0.2, 1.0, 5));
    const coneGeo = track(new THREE.ConeGeometry(0.85, 2.1, 6));
    const blobGeo = track(new THREE.IcosahedronGeometry(0.95, 0));
    const trunkMat = track(new THREE.MeshLambertMaterial({ color: 0x6b4a2e }));
    const coneTrees: Array<[number, number, number]> = [];
    const blobTrees: Array<[number, number, number]> = [];
    treeSpots.forEach((s) =>
      (s[2] === 0 && Math.random() < 0.45 ? blobTrees : coneTrees).push(s)
    );
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeSpots.length);
    const cones = new THREE.InstancedMesh(
      coneGeo,
      track(new THREE.MeshLambertMaterial({ color: 0xffffff })),
      Math.max(1, coneTrees.length)
    );
    const blobs = new THREE.InstancedMesh(
      blobGeo,
      track(new THREE.MeshLambertMaterial({ color: 0xffffff })),
      Math.max(1, blobTrees.length)
    );
    const d = new THREE.Object3D();
    const col = new THREE.Color();
    const GREENS = [
      [0x1e6b2f, 0x2a7d3a, 0x359846], // rainforest: deep lush greens
      [0x7d8f3f, 0x8fa04b, 0x6b7d33], // savanna: olive
      [0xa8a05a, 0x99914e, 0xb0a868], // sahel: pale scrub
    ];
    let ti = 0;
    const plant = (
      list: Array<[number, number, number]>,
      mesh: THREE.InstancedMesh,
      canopyY: number
    ) => {
      list.forEach(([lon, lat, zone], i) => {
        const [x, z] = project(lon, lat);
        const s =
          zone === 0
            ? 0.7 + Math.random() * 0.55
            : zone === 1
              ? 0.55 + Math.random() * 0.4
              : 0.4 + Math.random() * 0.28;
        d.position.set(x, 0.5 * s, z);
        d.scale.setScalar(s);
        d.rotation.y = Math.random() * Math.PI;
        d.updateMatrix();
        trunks.setMatrixAt(ti++, d.matrix);
        d.position.y = canopyY * s;
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
        const gg = GREENS[zone];
        col.set(gg[(Math.random() * gg.length) | 0]);
        mesh.setColorAt(i, col);
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    plant(coneTrees, cones, 1.55);
    plant(blobTrees, blobs, 1.35);
    group.add(trunks, cones, blobs);
  }

  // ---- labels ----
  const textSprite = (
    text: string,
    opts: { size?: number; bold?: boolean; color?: string; glow?: string } = {}
  ) => {
    const { size = 24, bold = false, color = "rgba(255,255,255,0.6)", glow } = opts;
    const c = document.createElement("canvas");
    let g = c.getContext("2d")!;
    g.font = `${bold ? "800" : "600"} ${size}px system-ui, sans-serif`;
    const w = Math.ceil(g.measureText(text).width) + 16;
    c.width = w;
    c.height = size + 18;
    g = c.getContext("2d")!;
    g.font = `${bold ? "800" : "600"} ${size}px system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    if (glow) {
      g.shadowColor = glow;
      g.shadowBlur = 10;
    }
    g.fillStyle = color;
    g.fillText(text, w / 2, (size + 18) / 2);
    const tex = track(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(
      track(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
    );
    sp.scale.set(w / 10, (size + 18) / 10, 1);
    return sp;
  };

  for (const st of geo.states) {
    let best = st.polys[0];
    let bl = 0;
    for (const r of st.polys)
      if (r.length > bl) {
        bl = r.length;
        best = r;
      }
    if (!best || best.length === 0) continue;
    let sx = 0,
      sz = 0;
    best.forEach(([lon, lat]) => {
      sx += lon;
      sz += lat;
    });
    const [x, z] = project(sx / best.length, sz / best.length);
    const isGame = GAME_STATES.includes(st.name);
    const sp = textSprite(
      prettyState(st.name),
      isGame
        ? { size: 30, bold: true, color: "#ffffff", glow: "#35e0d0" }
        : { size: 20, color: "rgba(200,220,240,0.5)" }
    );
    sp.position.set(x, isGame ? 7 : 5, z);
    group.add(sp);
    labelSprites.push(sp);
  }

  // ---- transit hub dots ----
  for (const [id, h] of Object.entries(geo.hubs)) {
    if (PLAYABLE_CITIES.includes(id)) continue;
    const [x, z] = project(h[0], h[1]);
    const dot = new THREE.Mesh(
      track(new THREE.SphereGeometry(1.15, 10, 10)),
      track(new THREE.MeshBasicMaterial({ color: 0x9db4d4 }))
    );
    dot.position.set(x, 1.6, z);
    group.add(dot);
    const label = textSprite(prettyHub(id), {
      size: 18,
      color: "rgba(190,210,235,0.55)",
    });
    label.position.set(x, 6, z);
    group.add(label);
    labelSprites.push(label);
  }

  // ---- playable cities ----
  const cityHitMeshes: THREE.Object3D[] = [];
  const cityRings: Record<string, THREE.Mesh> = {};
  for (const id of PLAYABLE_CITIES) {
    const h = geo.hubs[id];
    if (!h) continue;
    const [x, z] = project(h[0], h[1]);
    const isCurrent = id === currentCityId;
    const dot = new THREE.Mesh(
      track(new THREE.SphereGeometry(2.2, 16, 16)),
      track(new THREE.MeshBasicMaterial({ color: isCurrent ? 0xf5a623 : 0x35e0d0 }))
    );
    dot.position.set(x, 2.2, z);
    dot.userData.cityId = id;
    group.add(dot);
    cityHitMeshes.push(dot);
    // bigger invisible hit target for fat fingers
    const hit = new THREE.Mesh(
      track(new THREE.SphereGeometry(6, 8, 8)),
      track(new THREE.MeshBasicMaterial({ visible: false }))
    );
    hit.position.set(x, 2.2, z);
    hit.userData.cityId = id;
    group.add(hit);
    cityHitMeshes.push(hit);
    const ring = new THREE.Mesh(
      track(new THREE.RingGeometry(3.4, 4.4, 40)),
      track(
        new THREE.MeshBasicMaterial({
          color: isCurrent ? 0xf5a623 : 0x35e0d0,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
        })
      )
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 1.1, z);
    group.add(ring);
    cityRings[id] = ring;
    const label = textSprite(CITY_DISPLAY[id] ?? id, {
      size: 30,
      bold: true,
      color: "#ffffff",
      glow: isCurrent ? "#f5a623" : "#35e0d0",
    });
    label.position.set(x, 10, z);
    group.add(label);
    labelSprites.push(label);
  }

  // ---- selected route ----
  let routeMesh: THREE.Mesh | null = null;
  let busDot: THREE.Mesh | null = null;
  let busCurve: THREE.CatmullRomCurve3 | null = null;
  let drawAnim: { t: number; total: number } | null = null;
  let busT = 0;

  const clearRoute = () => {
    if (routeMesh) {
      group.remove(routeMesh);
      routeMesh.geometry.dispose();
      (routeMesh.material as THREE.Material).dispose();
      routeMesh = null;
    }
    if (busDot) {
      group.remove(busDot);
      busDot.geometry.dispose();
      (busDot.material as THREE.Material).dispose();
      busDot = null;
    }
    busCurve = null;
    drawAnim = null;
  };

  const drawRoute = (from: string, to: string | null) => {
    clearRoute();
    if (!to || to === from) return;
    const r = findRoad(geo.roads, from, to);
    if (!r) return;
    const pts = r.coords.map(([lon, lat]) => {
      const [x, z] = project(lon, lat);
      return new THREE.Vector3(x, 1.7, z);
    });
    busCurve = new THREE.CatmullRomCurve3(pts);
    const rgeo = new THREE.TubeGeometry(busCurve, 140, 1.15, 6, false);
    const total = rgeo.index ? rgeo.index.count : 0;
    routeMesh = new THREE.Mesh(
      rgeo,
      new THREE.MeshBasicMaterial({
        color: 0xf5a623,
        transparent: true,
        opacity: 0.95,
      })
    );
    group.add(routeMesh);
    drawAnim = { t: 0, total };
    busDot = new THREE.Mesh(
      new THREE.SphereGeometry(1.7, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffe9b0 })
    );
    group.add(busDot);
  };

  const setPulseCity = (id: string) => {
    for (const [cid, ring] of Object.entries(cityRings)) {
      const mat = ring.material as THREE.MeshBasicMaterial;
      const on = cid === id;
      mat.color.set(on ? 0xf5a623 : 0x35e0d0);
      ring.userData.pulse = on;
    }
  };
  setPulseCity(currentCityId);

  // ---- collect LOD materials (everything except water) ----
  const seen = new Set<THREE.Material>();
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    const ms = Array.isArray(mat) ? mat : [mat];
    for (const m of ms) {
      if (seen.has(m)) continue;
      seen.add(m);
      if ((m as THREE.Material).userData.water) continue;
      m.transparent = true;
      detailMats.push({ m, base: m.opacity });
    }
  });
  // mark water mats so the fade pass skips them (shimmer handles them)
  for (const w of waterMats) w.m.userData.water = true;

  const update = (now: number, dt: number, dk: number, deepK: number) => {
    // water shimmer: pulse around the LOD-scaled base opacity
    for (const w of waterMats) {
      const phase = (w.m.userData.phase as number) ?? 0;
      w.m.opacity = w.base * dk * (0.88 + 0.12 * Math.sin(now * 0.0022 + phase));
    }
    // city ring pulse
    for (const ring of Object.values(cityRings)) {
      if (ring.userData.pulse) {
        const s = 1 + Math.sin(now * 0.004) * 0.18;
        ring.scale.set(s, s, 1);
      }
    }
    // base labels are faded by GlobeMap's LOD pass (detailMats × (1 - deepK))
    void deepK;
    // selected-route draw animation + bus dot
    if (drawAnim && routeMesh) {
      drawAnim.t += dt / 1.5;
      const n = Math.min(1, drawAnim.t);
      routeMesh.geometry.setDrawRange(0, Math.floor(drawAnim.total * n));
      if (n >= 1) drawAnim = null;
    }
    if (busCurve && busDot && !drawAnim) {
      busT = (busT + dt * 0.12) % 1;
      busDot.position.copy(busCurve.getPointAt(busT));
    }
  };

  const dispose = () => {
    clearRoute();
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) {
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
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
  };

  return {
    group,
    detailMats,
    waterMats,
    labelSprites,
    cityHitMeshes,
    setPulseCity,
    drawRoute,
    update,
    dispose,
  };
}

/** Deepest LOD layer: city glow markers + bold labels + venue pins + dust. */
export function buildDeepLayer(geo: NigeriaGeo): DeepLayer {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(d: T): T => {
    disposables.push(d);
    return d;
  };
  const deepMats: FadeMat[] = [];

  const glowSprite = (r: number, g: number, b: number, size: number) => {
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
    const tex = track(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(
      track(
        new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      )
    );
    sp.scale.set(size, size, 1);
    return sp;
  };

  const textSprite = (text: string, size: number, bold: boolean, color: string, glow?: string) => {
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
    const tex = track(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(
      track(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
    );
    sp.scale.set(w / 11, (size + 20) / 11, 1);
    return sp;
  };

  const playable = new Set(["lagos", "benin", "ph", "abuja"]);
  for (const [id, h] of Object.entries(geo.hubs)) {
    const [x, z] = project(h[0], h[1]);
    const isPlayable = playable.has(id);
    const glow = isPlayable
      ? glowSprite(245, 166, 35, 8)
      : glowSprite(150, 195, 255, 5);
    glow.position.set(x, 2.6, z);
    group.add(glow);
    const nm = isPlayable ? (CITY_DISPLAY[id] ?? id) : prettyHub(id);
    const lab = textSprite(
      nm,
      isPlayable ? 36 : 24,
      true,
      isPlayable ? "#ffffff" : "#eaf2ff",
      isPlayable ? "#f5a623" : "#5a7fb8"
    );
    lab.position.set(x, isPlayable ? 11 : 8.5, z);
    group.add(lab);
  }

  // venue emoji pins near Lagos — street-level life at max zoom
  const [lx, lz] = project(3.3792, 6.5244);
  const VENUES: Array<[string, number, number]> = [
    ["🏙️", 6.5, -5.5],
    ["🍲", -5.5, 4.5],
    ["⚽", 2.5, 6.5],
    ["🎭", -4.5, -6.5],
    ["🛍️", 8.5, 1.5],
  ];
  for (const [em, ox, oz] of VENUES) {
    const sp = textSprite(em, 36, false, "#ffffff");
    sp.position.set(lx + ox, 3.2, lz + oz);
    group.add(sp);
  }

  group.traverse((o) => {
    const mesh = o as THREE.Sprite;
    const mat = mesh.material as THREE.Material | undefined;
    if (mat) deepMats.push({ m: mat, base: mat.opacity });
  });

  // ---- dust motes: one Points draw call, deepest zoom only ----
  const DUST_N = 150;
  const dustGeo = track(new THREE.BufferGeometry());
  const dustBase = new Float32Array(DUST_N * 3);
  const dustPhase = new Float32Array(DUST_N);
  for (let i = 0; i < DUST_N; i++) {
    dustBase[i * 3] = (Math.random() * 2 - 1) * 110;
    dustBase[i * 3 + 1] = 2 + Math.random() * 15;
    dustBase[i * 3 + 2] = (Math.random() * 2 - 1) * 95;
    dustPhase[i] = Math.random() * Math.PI * 2;
  }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustBase.slice(), 3));
  const dustCanvas = document.createElement("canvas");
  dustCanvas.width = dustCanvas.height = 64;
  const dg = dustCanvas.getContext("2d")!;
  const dgrad = dg.createRadialGradient(32, 32, 1, 32, 32, 30);
  dgrad.addColorStop(0, "rgba(255,244,214,0.9)");
  dgrad.addColorStop(1, "rgba(255,244,214,0)");
  dg.fillStyle = dgrad;
  dg.fillRect(0, 0, 64, 64);
  const dustTex = track(new THREE.CanvasTexture(dustCanvas));
  const dustMat = track(
    new THREE.PointsMaterial({
      map: dustTex,
      size: 1.6,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    })
  );
  const dust = new THREE.Points(dustGeo, dustMat);
  group.add(dust);

  const update = (now: number, _dt: number) => {
    const pos = dustGeo.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < DUST_N; i++) {
      const ph = dustPhase[i];
      arr[i * 3] = dustBase[i * 3] + Math.sin(now * 0.00021 + ph) * 4;
      arr[i * 3 + 1] = dustBase[i * 3 + 1] + Math.sin(now * 0.00016 + ph * 1.7) * 2;
      arr[i * 3 + 2] = dustBase[i * 3 + 2] + Math.cos(now * 0.00019 + ph) * 4;
    }
    pos.needsUpdate = true;
  };

  const dispose = () => {
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = (o as THREE.Sprite).material as THREE.Material | undefined;
      if (mat) mat.dispose();
    });
    for (const d of disposables) {
      try {
        d.dispose();
      } catch {
        /* noop */
      }
    }
  };

  return { group, deepMats, update, dispose };
}
