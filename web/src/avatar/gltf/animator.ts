/**
 * Animation controller for GLTF avatars.
 * Retargets the 46-clip CC0 animation library onto base characters
 * and provides a simple play/stop/crossfade API.
 */

import * as THREE from "three";
import { retargetClip, collectRestPose } from "./retarget";
import { getCachedAssets } from "./loader";

/** All 46 animation clips in the library. */
export const ANIM_LIST = [
  "A_TPose",
  "Crouch_Fwd_Loop",
  "Crouch_Idle_Loop",
  "Dance_Loop",
  "Death01",
  "Driving_Loop",
  "Fixing_Kneeling",
  "Hit_Chest",
  "Hit_Head",
  "Idle_Loop",
  "Idle_Talking_Loop",
  "Idle_Torch_Loop",
  "Interact",
  "Jog_Fwd_Loop",
  "Jump_Land",
  "Jump_Loop",
  "Jump_Start",
  "PickUp_Table",
  "Pistol_Aim_Down",
  "Pistol_Aim_Neutral",
  "Pistol_Aim_Up",
  "Pistol_Idle_Loop",
  "Pistol_Reload",
  "Pistol_Shoot",
  "Punch_Cross",
  "Punch_Enter",
  "Punch_Jab",
  "Push_Loop",
  "Roll",
  "Roll_RM",
  "Sitting_Enter",
  "Sitting_Exit",
  "Sitting_Idle_Loop",
  "Sitting_Talking_Loop",
  "Spell_Simple_Enter",
  "Spell_Simple_Exit",
  "Spell_Simple_Idle_Loop",
  "Spell_Simple_Shoot",
  "Sprint_Loop",
  "Swim_Fwd_Loop",
  "Swim_Idle_Loop",
  "Sword_Attack",
  "Sword_Attack_RM",
  "Sword_Idle",
  "Walk_Formal_Loop",
  "Walk_Loop",
] as const;

export type AnimName = (typeof ANIM_LIST)[number];

/** Cache of retargeted clips per body instance (weak — GC'd with the model). */
const retargetCache = new WeakMap<THREE.Object3D, Map<string, THREE.AnimationClip>>();

/** Retargets all clips for a character instance. Call once per clone. */
export function retargetClipsFor(root: THREE.Object3D): Map<string, THREE.AnimationClip> {
  const cached = retargetCache.get(root);
  if (cached) return cached;

  const assets = getCachedAssets();
  const out = new Map<string, THREE.AnimationClip>();
  if (!assets) {
    retargetCache.set(root, out);
    return out;
  }

  const baseRest = collectRestPose(root);
  for (const clip of assets.animClips) {
    const retargeted = retargetClip(clip, assets.animRest, baseRest, root);
    if (retargeted) out.set(clip.name, retargeted);
  }
  retargetCache.set(root, out);
  return out;
}

export class AvatarAnimator {
  private mixer: THREE.AnimationMixer;
  private clips: Map<string, THREE.AnimationClip>;
  private current: THREE.AnimationAction | null = null;
  private currentName: string | null = null;

  constructor(root: THREE.Object3D) {
    this.mixer = new THREE.AnimationMixer(root);
    this.clips = retargetClipsFor(root);
  }

  /** Number of retargeted clips available. */
  get clipCount(): number {
    return this.clips.size;
  }

  /** Available clip names. */
  get clipNames(): string[] {
    return [...this.clips.keys()];
  }

  /**
   * Plays an animation. Crossfades from the current one.
   * Loops by default for *_Loop clips, plays once otherwise.
   */
  play(name: AnimName | string, opts?: { fade?: number; clamp?: boolean }): void {
    const clip = this.clips.get(name);
    if (!clip) return;
    const fade = opts?.fade ?? 0.25;
    const action = this.mixer.clipAction(clip);
    const isLoop = name.endsWith("_Loop");
    action.setLoop(isLoop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = opts?.clamp ?? !isLoop;
    action.reset();
    if (this.current && this.current !== action) {
      this.current.crossFadeTo(action, fade, false);
    } else {
      action.fadeIn(fade);
    }
    action.play();
    if (this.current && this.current !== action) this.current = action;
    else this.current = action;
    this.currentName = name;
  }

  /** Stops the current animation. */
  stop(fade = 0.2): void {
    if (this.current) {
      this.current.fadeOut(fade);
      this.current = null;
      this.currentName = null;
    }
  }

  get currentClipName(): string | null {
    return this.currentName;
  }

  /** Advances the animation. Call every frame. */
  update(dt: number): void {
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
  }
}
