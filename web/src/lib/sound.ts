/**
 * Tiny procedural sound engine (WebAudio, no audio assets).
 *
 * The top status pill's speaker toggle flips this master switch; the
 * preference persists in localStorage. Everything is best-effort:
 * if WebAudio is unavailable the calls are silent no-ops and the game
 * keeps running.
 */

const KEY = "eko-life:sound";
export const SOUND_EVENT = "eko:sound";

export function isSoundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* private mode — preference just won't persist */
  }
  window.dispatchEvent(new CustomEvent(SOUND_EVENT, { detail: on }));
}

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = ctx ?? new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Short UI blip. kinds: tap (neutral), coin (earn/spend), toast (notification). */
export function blip(kind: "tap" | "coin" | "toast" = "tap"): void {
  if (!isSoundEnabled()) return;
  const c = ac();
  if (!c) return;
  try {
    const notes =
      kind === "coin"
        ? [880, 1174.66]
        : kind === "toast"
          ? [659.25, 987.77]
          : [523.25];
    const t0 = c.currentTime;
    notes.forEach((freq, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      const start = t0 + i * 0.09;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      o.connect(g);
      g.connect(c.destination);
      o.start(start);
      o.stop(start + 0.2);
    });
  } catch {
    /* never let sound break the game */
  }
}
