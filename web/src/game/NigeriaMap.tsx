import { useEffect, useRef } from "react";
import * as THREE from "three";
import {
  HERO_ROUTES,
  PLAYABLE_CITIES,
  findRoad,
  project,
  type NigeriaGeo,
} from "./nigeriaGeo";

/**
 * 3D Nigeria travel map — ported from the approved v2 mockup
 * (~/workspace/eko-life-mockups/travel-3d-nigeria-v2.html).
 *
 * Real state borders, biome terrain, real road network, rivers, ocean,
 * drag-pan + wheel/pinch zoom. Runs on low-end phones:
 * pixelRatio capped at 1.5, instanced trees, RAF paused when hidden.
 */

export const CITY_DISPLAY: Record<string, string> = {
  lagos: "Lagos",
  benin: "Benin City",
  ph: "Port Harcourt",
  abuja: "Abuja",
};

interface NigeriaMapProps {
  currentCityId: string;
  selectedCityId: string | null;
  onSelectCity: (id: string) => void;
  geo: NigeriaGeo;
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

export function NigeriaMap({
  currentCityId,
  selectedCityId,
  onSelectCity,
  geo,
}: NigeriaMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelectCity);
  onSelectRef.current = onSelectCity;

  // Mutable three.js handles, shared between the mount effect and the
  // selection effect.
  const threeRef = useRef<{
    drawRoute: (from: string, to: string | null) => void;
    setPulseCity: (id: string) => void;
    resetView: () => void;
  } | null>(null);

  /* ---------------- mount: build the whole scene once ---------------- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      container.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#93a4bd;font-size:13px;padding:24px;text-align:center">3D map needs WebGL — pick your destination below.</div>';
      return;
    }

    const disposables: Array<{ dispose: () => void }> = [];
    const track = <T extends { dispose: () => void }>(d: T): T => {
      disposables.push(d);
      return d;
    };

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03060c);
    scene.fog = new THREE.Fog(0x03060c, 300, 620);
    const camera = new THREE.PerspectiveCamera(50, 1, 1, 1500);

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

    // lights
    scene.add(new THREE.AmbientLight(0xbfd4ff, 0.75));
    scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x3a2f1d, 0.35));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.25);
    sun.position.set(-90, 150, 70);
    scene.add(sun);

    // camera state (damped pan/zoom)
    const HOME = { dist: 160, tx: -30, tz: 78 };
    let camDist = HOME.dist,
      tDist = HOME.dist;
    let tTX = HOME.tx,
      tTZ = HOME.tz;
    const camTarget = new THREE.Vector3(HOME.tx, 0, HOME.tz);
    const placeCamera = () => {
      camera.position.set(camTarget.x, camDist * 1.5, camTarget.z + camDist);
      camera.lookAt(camTarget.x, 0, camTarget.z);
    };
    placeCamera();

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

    // ---- water texture ----
    const makeWaterTexture = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      const g = c.getContext("2d")!;
      g.fillStyle = "#072a44";
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 110; i++) {
        g.strokeStyle =
          "rgba(90,170,225," + (0.04 + Math.random() * 0.09).toFixed(3) + ")";
        g.lineWidth = 1 + Math.random() * 2.2;
        const y = Math.random() * 256,
          x = Math.random() * 256,
          len = 24 + Math.random() * 70;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + len / 2, y - 7 + Math.random() * 14, x + len, y);
        g.stroke();
      }
      const tex = track(new THREE.CanvasTexture(c));
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(6, 6);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };

    const terrainTex = makeTerrainTexture();
    const waterTex = makeWaterTexture();

    // ---- ocean ----
    const water = new THREE.Mesh(
      track(new THREE.PlaneGeometry(1100, 1100)),
      track(
        new THREE.MeshBasicMaterial({
          map: waterTex,
          transparent: true,
          opacity: 0.96,
        })
      )
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -2.2;
    scene.add(water);
    const shimmer = new THREE.Mesh(
      track(new THREE.PlaneGeometry(1100, 1100)),
      track(
        new THREE.MeshBasicMaterial({
          color: 0x0a3d5c,
          transparent: true,
          opacity: 0.4,
        })
      )
    );
    shimmer.rotation.x = -Math.PI / 2;
    shimmer.position.y = -3.0;
    scene.add(shimmer);

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
      scene.add(
        new THREE.Mesh(
          sgeo,
          track(
            new THREE.MeshBasicMaterial({
              map: terrainTex,
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
      scene.add(
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
      new THREE.LineBasicMaterial({
        color: 0x46e8d2,
        transparent: true,
        opacity: 0.9,
      })
    );
    const dimLine = track(
      new THREE.LineBasicMaterial({
        color: 0x1f6f7e,
        transparent: true,
        opacity: 0.45,
      })
    );
    for (const st of geo.states) {
      const mat = GAME_STATES.includes(st.name) ? gameLine : dimLine;
      for (const ring of st.polys) {
        if (ring.length < 3) continue;
        const pts = ring.map(([lon, lat]) => {
          const [x, z] = project(lon, lat);
          return new THREE.Vector3(x, 0.9, z);
        });
        scene.add(
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
        const tube = new THREE.Mesh(
          track(
            new THREE.TubeGeometry(curve, Math.min(140, seg.length * 2), rv.major ? 0.85 : 0.42, 5, false)
          ),
          track(
            new THREE.MeshBasicMaterial({
              color: rv.major ? 0x2f8fe0 : 0x2a7cc6,
              transparent: true,
              opacity: 0.92,
            })
          )
        );
        scene.add(tube);
      }
    }
    const waterBlob = (lon: number, lat: number, rx: number, rz: number) => {
      const [x, z] = project(lon, lat);
      const m = new THREE.Mesh(
        track(new THREE.CircleGeometry(1, 26)),
        track(
          new THREE.MeshBasicMaterial({
            color: 0x2f8fe0,
            transparent: true,
            opacity: 0.9,
          })
        )
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.55, z);
      m.scale.set(rx, rz, 1);
      scene.add(m);
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
      const tube = new THREE.Mesh(
        track(new THREE.TubeGeometry(curve, 60, hero ? 0.62 : 0.42, 5, false)),
        track(
          new THREE.MeshBasicMaterial({
            color: hero ? 0xd8c193 : 0x8d8672,
            transparent: true,
            opacity: hero ? 0.85 : 0.5,
          })
        )
      );
      scene.add(tube);
    }

    // ---- trees (instanced, by biome) ----
    const inRing = (lon: number, lat: number, ring: Array<[number, number]>) => {
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
    };
    const inNigeria = (lon: number, lat: number) => {
      for (const st of geo.states)
        for (const ring of st.polys)
          if (ring.length > 2 && inRing(lon, lat, ring)) return true;
      return false;
    };
    const hubXZ = Object.values(geo.hubs).map(([lon, lat]) => project(lon, lat));
    const treeSpots: Array<[number, number]> = [];
    let guard = 0;
    while (treeSpots.length < 120 && guard++ < 6000) {
      const lon = 2.6 + Math.random() * (14.8 - 2.6);
      const lat = 4.2 + Math.random() * (13.8 - 4.2);
      if (!inNigeria(lon, lat)) continue;
      const [tx, tz] = project(lon, lat);
      if (
        hubXZ.some(
          ([cx, cz]) => (cx - tx) * (cx - tx) + (cz - tz) * (cz - tz) < 12 * 12
        )
      )
        continue;
      const p = lat < 7.5 ? 0.85 : lat < 10.5 ? 0.28 : 0.08;
      if (Math.random() > p) continue;
      treeSpots.push([lon, lat]);
    }
    const trunks = new THREE.InstancedMesh(
      track(new THREE.CylinderGeometry(0.22, 0.34, 1.6, 5)),
      track(new THREE.MeshLambertMaterial({ color: 0x6b4a2e })),
      treeSpots.length
    );
    const canopies = new THREE.InstancedMesh(
      track(new THREE.ConeGeometry(1.5, 3.4, 6)),
      track(new THREE.MeshLambertMaterial({ color: 0xffffff })),
      treeSpots.length
    );
    {
      const d = new THREE.Object3D();
      const col = new THREE.Color();
      treeSpots.forEach(([lon, lat], i) => {
        const [x, z] = project(lon, lat);
        const s =
          lat < 7.5
            ? 0.9 + Math.random() * 0.6
            : lat < 10.5
              ? 0.65 + Math.random() * 0.4
              : 0.4 + Math.random() * 0.3;
        d.position.set(x, 0, z);
        d.scale.setScalar(s);
        d.rotation.y = Math.random() * Math.PI;
        d.updateMatrix();
        trunks.setMatrixAt(i, d.matrix);
        d.position.y = 1.6 * s + 1.7 * s;
        d.updateMatrix();
        canopies.setMatrixAt(i, d.matrix);
        col.set(
          lat < 7.5
            ? Math.random() < 0.5
              ? 0x1e6b2f
              : 0x2a7d3a
            : lat < 10.5
              ? 0x7d8f3f
              : 0xa8a05a
        );
        canopies.setColorAt(i, col);
      });
      if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
    }
    scene.add(trunks);
    scene.add(canopies);

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
      scene.add(sp);
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
      scene.add(dot);
      const label = textSprite(prettyHub(id), {
        size: 18,
        color: "rgba(190,210,235,0.55)",
      });
      label.position.set(x, 6, z);
      scene.add(label);
    }

    // ---- playable cities ----
    const cityHitMeshes: THREE.Mesh[] = [];
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
      scene.add(dot);
      cityHitMeshes.push(dot);
      // bigger invisible hit target for fat fingers
      const hit = new THREE.Mesh(
        track(new THREE.SphereGeometry(6, 8, 8)),
        track(new THREE.MeshBasicMaterial({ visible: false }))
      );
      hit.position.set(x, 2.2, z);
      hit.userData.cityId = id;
      scene.add(hit);
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
      scene.add(ring);
      cityRings[id] = ring;
      const label = textSprite(CITY_DISPLAY[id] ?? id, {
        size: 30,
        bold: true,
        color: "#ffffff",
        glow: isCurrent ? "#f5a623" : "#35e0d0",
      });
      label.position.set(x, 10, z);
      scene.add(label);
    }

    // ---- selected route ----
    let routeMesh: THREE.Mesh | null = null;
    let busDot: THREE.Mesh | null = null;
    let busCurve: THREE.CatmullRomCurve3 | null = null;
    let drawAnim: { t: number; total: number } | null = null;
    let busT = 0;

    const clearRoute = () => {
      if (routeMesh) {
        scene.remove(routeMesh);
        routeMesh.geometry.dispose();
        (routeMesh.material as THREE.Material).dispose();
        routeMesh = null;
      }
      if (busDot) {
        scene.remove(busDot);
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
      scene.add(routeMesh);
      drawAnim = { t: 0, total };
      busDot = new THREE.Mesh(
        new THREE.SphereGeometry(1.7, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xffe9b0 })
      );
      scene.add(busDot);
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

    // ---- pan / zoom controls ----
    const cvs = renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const pointerNDC = new THREE.Vector2();
    const activePtrs = new Map<number, [number, number]>();
    let lastPinch = 0;
    let downAt = 0;
    let downX = 0;
    let downY = 0;

    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
    const panBy = (dx: number, dy: number) => {
      const k = camDist * 0.0021;
      tTX = clamp(tTX - dx * k, -120, 120);
      tTZ = clamp(tTZ - dy * k, -95, 95);
    };

    cvs.addEventListener("pointerdown", (e) => {
      try {
        cvs.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
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
        panBy(dx, dy);
      } else if (activePtrs.size === 2) {
        const p = [...activePtrs.values()];
        const d = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
        if (lastPinch > 0 && d > 0) tDist = clamp((tDist * lastPinch) / d, 70, 480);
        lastPinch = d;
        panBy(dx / 2, dy / 2);
      }
    });
    const ptrUp = (e: PointerEvent) => {
      const wasSingle = activePtrs.size === 1;
      activePtrs.delete(e.pointerId);
      lastPinch = 0;
      // tap (not drag) → raycast city markers
      if (
        wasSingle &&
        performance.now() - downAt < 450 &&
        Math.hypot(e.clientX - downX, e.clientY - downY) < 10
      ) {
        const rect = cvs.getBoundingClientRect();
        pointerNDC.set(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        raycaster.setFromCamera(pointerNDC, camera);
        const hits = raycaster.intersectObjects(cityHitMeshes, false);
        if (hits.length > 0) {
          const id = hits[0].object.userData.cityId as string;
          if (id && id !== currentCityId) onSelectRef.current(id);
        }
      }
    };
    cvs.addEventListener("pointerup", ptrUp);
    cvs.addEventListener("pointercancel", ptrUp);
    cvs.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        tDist = clamp(tDist * Math.pow(1.0016, e.deltaY), 70, 480);
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
      camDist += (tDist - camDist) * 0.14;
      camTarget.x += (tTX - camTarget.x) * 0.14;
      camTarget.z += (tTZ - camTarget.z) * 0.14;
      placeCamera();
      waterTex.offset.x = (now * 0.000008) % 1;
      waterTex.offset.y = (now * 0.000005) % 1;
      (shimmer.material as THREE.MeshBasicMaterial).opacity =
        0.35 + 0.15 * Math.sin(now * 0.0012);
      for (const ring of Object.values(cityRings)) {
        if (ring.userData.pulse) {
          const s = 1 + Math.sin(now * 0.004) * 0.18;
          ring.scale.set(s, s, 1);
        }
      }
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

    threeRef.current = {
      drawRoute,
      setPulseCity,
      resetView: () => {
        tDist = HOME.dist;
        tTX = HOME.tx;
        tTZ = HOME.tz;
      },
    };

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      ro.disconnect();
      clearRoute();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) {
          const m = mesh as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
          const mat = m.material as THREE.Material | THREE.Material[] | undefined;
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
      threeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- selection changes: redraw route ---------------- */
  useEffect(() => {
    threeRef.current?.drawRoute(currentCityId, selectedCityId);
    threeRef.current?.setPulseCity(currentCityId);
  }, [currentCityId, selectedCityId]);

  return (
    <div ref={containerRef} style={{ position: "absolute", inset: 0 }}>
      <button
        type="button"
        className="nigeria-map__reset"
        onClick={() => threeRef.current?.resetView()}
        aria-label="Reset map view"
      >
        ⟲ Reset view
      </button>
    </div>
  );
}
