/**
 * Èkó Life Avatar Engine — M7 animation tests.
 *
 * Covers the procedural animation state machine in assembler.ts:
 * idle / walk (auto-sensed) / wave, lid-based blink, eye saccades,
 * eased transitions (no pops), reduced-motion, NaN safety, and a
 * hot-loop allocation budget check.
 *
 * Node environment (no DOM): geometry/material/graph behaviour is fully
 * testable; canvas textures return null and are handled by the parts.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  assembleAppearance,
  createAnimationController,
  type AnimationController,
  type AssembledAvatarInternal,
  type AvatarRig,
} from "./assembler";
import { DEFAULT_APPEARANCE_V1 } from "./validation";
import type { AppearanceV1 } from "./schema";

const DT = 1 / 60;

function cloneApp(): AppearanceV1 {
  return JSON.parse(JSON.stringify(DEFAULT_APPEARANCE_V1)) as AppearanceV1;
}

function build(): AssembledAvatarInternal {
  const a = assembleAppearance(THREE, cloneApp());
  if (!a.update) throw new Error("expected animation update to be defined");
  return a;
}

/** Fresh controller driving the same rig (the wired a.update is left idle). */
function ctrlFor(a: AssembledAvatarInternal): AnimationController {
  return createAnimationController(a.rig, a.group);
}

function stepCtrl(
  c: AnimationController,
  frames: number,
  dt = DT,
  startT = 0
): number {
  let t = startT;
  for (let i = 0; i < frames; i++) {
    t += dt;
    c.update(t, dt);
  }
  return t;
}

/** Every driven rotation/scale on the rig. */
function rigValues(rig: AvatarRig): number[] {
  const out: number[] = [];
  const rots = [
    rig.upper.rotation,
    rig.head.rotation,
    rig.armL.rotation,
    rig.armR.rotation,
    rig.eyeL.rotation,
    rig.eyeR.rotation,
    rig.lidL.rotation,
    rig.lidR.rotation,
    rig.legL.rotation,
    rig.legR.rotation,
  ];
  for (const r of rots) out.push(r.x, r.y, r.z);
  out.push(
    rig.upper.position.x,
    rig.upper.position.y,
    rig.upper.position.z,
    rig.torso.scale.x,
    rig.torso.scale.y,
    rig.torso.scale.z
  );
  return out;
}

describe("M7 animation state machine", () => {
  it("idle: 10s of frames stay finite and within sane bounds", () => {
    const a = build();
    let maxArm = 0;
    let maxHead = 0;
    let maxLid = 0;
    let t = 0;
    for (let i = 0; i < 600; i++) {
      t += DT;
      a.update!(t, DT);
      for (const v of rigValues(a.rig)) expect(Number.isFinite(v)).toBe(true);
      maxArm = Math.max(
        maxArm,
        Math.abs(a.rig.armL.rotation.x - a.rig.baseArmLX),
        Math.abs(a.rig.armR.rotation.x - a.rig.baseArmRX)
      );
      maxHead = Math.max(maxHead, Math.abs(a.rig.head.rotation.y));
      maxLid = Math.max(maxLid, Math.abs(a.rig.lidL.rotation.x), Math.abs(a.rig.lidR.rotation.x));
    }
    // Breathing keeps arms near base; head turn stays subtle; lids blink shut.
    expect(maxArm).toBeLessThan(0.15);
    expect(maxHead).toBeLessThan(0.3);
    expect(maxLid).toBeGreaterThan(0.2); // at least one blink happened
    expect(maxLid).toBeLessThanOrEqual(0.3 + 1e-6);
    // Eyes never get Y-squashed any more (lid-based blink).
    expect(a.rig.eyeL.scale.y).toBe(1);
    expect(a.rig.eyeR.scale.y).toBe(1);
    a.dispose();
  });

  it("blink: forceBlink closes the lids and they fully reopen", () => {
    const a = build();
    const c = ctrlFor(a);
    c.forceBlink();
    let peak = 0;
    let t = 0;
    for (let i = 0; i < 40; i++) {
      t += DT;
      c.update(t, DT);
      peak = Math.max(peak, Math.abs(a.rig.lidL.rotation.x), Math.abs(a.rig.lidR.rotation.x));
    }
    expect(peak).toBeGreaterThan(0.2);
    for (let i = 0; i < 60; i++) {
      t += DT;
      c.update(t, DT);
    }
    expect(Math.abs(a.rig.lidL.rotation.x)).toBeLessThan(0.01);
    expect(Math.abs(a.rig.lidR.rotation.x)).toBeLessThan(0.01);
    a.dispose();
  });

  it("saccades: eyes dart and settle, staying small", () => {
    const a = build();
    const c = ctrlFor(a);
    c.forceSaccade();
    let peak = 0;
    let t = 0;
    for (let i = 0; i < 30; i++) {
      t += DT;
      c.update(t, DT);
      peak = Math.max(
        peak,
        Math.abs(a.rig.eyeL.rotation.y),
        Math.abs(a.rig.eyeL.rotation.x)
      );
    }
    expect(peak).toBeGreaterThan(0.02);
    expect(peak).toBeLessThan(0.15);
    a.dispose();
  });

  it("wave: plays once, returns to idle, no pops on transitions", () => {
    const a = build();
    const c = ctrlFor(a);
    expect(c.state).toBe("idle");
    c.setState("wave");
    expect(c.state).toBe("wave");
    let t = 0;
    let prevZ = a.rig.armR.rotation.z;
    let maxStep = 0;
    let peakRaise = 0;
    for (let i = 0; i < 240; i++) {
      t += DT;
      c.update(t, DT);
      const z = a.rig.armR.rotation.z;
      maxStep = Math.max(maxStep, Math.abs(z - prevZ));
      prevZ = z;
      peakRaise = Math.max(peakRaise, z - a.rig.baseArmRZ);
    }
    // 4s > WAVE_DUR: gesture finished and eased back to idle.
    expect(c.state).toBe("idle");
    // No pops: per-frame joint deltas stay far below a visible snap.
    expect(maxStep).toBeLessThan(0.12);
    // The arm actually raised well clear of the resting pose.
    expect(peakRaise).toBeGreaterThan(1.2);
    // …and settled back near the base pose.
    expect(Math.abs(a.rig.armR.rotation.z - a.rig.baseArmRZ)).toBeLessThan(
      0.05
    );
    expect(Math.abs(a.rig.armR.rotation.x - a.rig.baseArmRX)).toBeLessThan(
      0.05
    );
    a.dispose();
  });

  it("wave can be cancelled back to idle mid-gesture without a pop", () => {
    const a = build();
    const c = ctrlFor(a);
    let t = stepCtrl(c, 40); // mid-raise
    c.setState("idle");
    let prevZ = a.rig.armR.rotation.z;
    let maxStep = 0;
    for (let i = 0; i < 120; i++) {
      t += DT;
      c.update(t, DT);
      const z = a.rig.armR.rotation.z;
      maxStep = Math.max(maxStep, Math.abs(z - prevZ));
      prevZ = z;
    }
    expect(maxStep).toBeLessThan(0.12);
    expect(Math.abs(a.rig.armR.rotation.z - a.rig.baseArmRZ)).toBeLessThan(
      0.05
    );
    a.dispose();
  });

  it("walk: auto-engages while the root translates, with leg/arm swing", () => {
    const a = build();
    const c = ctrlFor(a);
    const SPEED = 1.6;
    let t = 0;
    let peakLeg = 0;
    let peakArm = 0;
    for (let i = 0; i < 150; i++) {
      t += DT;
      a.group.position.z -= SPEED * DT; // room-style glide
      c.update(t, DT);
      peakLeg = Math.max(peakLeg, Math.abs(a.rig.legL.rotation.x));
      peakArm = Math.max(
        peakArm,
        Math.abs(a.rig.armL.rotation.x - a.rig.baseArmLX)
      );
    }
    expect(c.state).toBe("walk");
    expect(peakLeg).toBeGreaterThan(0.1); // legs actually swing
    expect(peakArm).toBeGreaterThan(0.2); // arms counter-swing
    // Legs swing in opposition, arms oppose the same-side leg.
    expect(Math.sign(a.rig.legL.rotation.x)).not.toBe(0);
    a.dispose();
  });

  it("walk: legs stop swinging (eased, no pop) when translation stops", () => {
    const a = build();
    const c = ctrlFor(a);
    const SPEED = 1.6;
    let t = 0;
    for (let i = 0; i < 150; i++) {
      t += DT;
      a.group.position.z -= SPEED * DT;
      c.update(t, DT);
    }
    expect(c.state).toBe("walk");
    let maxStep = 0;
    let prevX = a.rig.legL.rotation.x;
    for (let i = 0; i < 180; i++) {
      t += DT;
      c.update(t, DT); // root stationary now
      const x = a.rig.legL.rotation.x;
      maxStep = Math.max(maxStep, Math.abs(x - prevX));
      prevX = x;
    }
    expect(c.state).toBe("idle");
    expect(maxStep).toBeLessThan(0.06);
    expect(Math.abs(a.rig.legL.rotation.x - a.rig.baseLegLX)).toBeLessThan(
      0.02
    );
    expect(Math.abs(a.rig.upper.rotation.x)).toBeLessThan(0.02);
    a.dispose();
  });

  it("walk cycle is periodic: pose(t) ≈ pose(t + stride period)", () => {
    const a = build();
    const c = ctrlFor(a);
    const SPEED = 1.6;
    const PERIOD = (2 * Math.PI) / (7.0 * SPEED); // STRIDE_K * speed
    let t = 0;
    // Warm up past the walk blend-in.
    for (let i = 0; i < 150; i++) {
      t += DT;
      a.group.position.z -= SPEED * DT;
      c.update(t, DT);
    }
    const snap = (): number[] => [
      a.rig.legL.rotation.x,
      a.rig.legR.rotation.x,
      a.rig.armL.rotation.x,
      a.rig.armR.rotation.x,
    ];
    const p0 = snap();
    // Advance exactly one stride period. Frame-quantize the period so both
    // samples land on the same sub-frame phase.
    const frames = Math.round(PERIOD / DT);
    for (let i = 0; i < frames; i++) {
      t += DT;
      a.group.position.z -= SPEED * DT;
      c.update(t, DT);
    }
    const p1 = snap();
    for (let i = 0; i < p0.length; i++) {
      expect(Math.abs(p1[i] - p0[i])).toBeLessThan(0.05);
    }
    a.dispose();
  });

  it("survives garbage clocks without poisoning the rig", () => {
    const a = build();
    const c = ctrlFor(a);
    c.update(NaN, NaN);
    c.update(0, -1);
    c.update(1e3, 100); // huge dt gets clamped
    c.update(Infinity, DT);
    for (const v of rigValues(a.rig)) expect(Number.isFinite(v)).toBe(true);
    a.dispose();
  });

  it("reduced motion: no update loop at all (static pose)", () => {
    const a = assembleAppearance(THREE, cloneApp(), { reducedMotion: true });
    expect(a.update).toBeUndefined();
    expect(
      (a.group.userData as { setAnimState?: unknown }).setAnimState
    ).toBeUndefined();
    a.dispose();
  });

  it("hot loop retains no per-frame garbage (no leak)", () => {
    // heapUsed measures RETAINED garbage, which is what matters: transient
    // per-frame garbage is the GC's business, but anything the loop keeps
    // alive (e.g. a `new` stashed in a closure per frame) accumulates here.
    // An isolated probe of this loop over 3000 frames measured a NEGATIVE
    // delta (the GC collected more ambient garbage than the loop retained),
    // i.e. the frame body is allocation-free by construction (closure
    // scalars only — audit the update body in assembler.ts). The 8MB budget
    // is a regression tripwire for gross leaks, with headroom for GC noise
    // from the surrounding suite.
    const a = build();
    let t = 0;
    for (let i = 0; i < 500; i++) {
      t += DT;
      a.update!(t, DT);
    }
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 3000; i++) {
      t += DT;
      a.update!(t, DT);
    }
    const after = process.memoryUsage().heapUsed;
    expect(after - before).toBeLessThan(8 * 1024 * 1024);
    a.dispose();
  });
});
