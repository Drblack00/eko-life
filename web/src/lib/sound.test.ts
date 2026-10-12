import { describe, expect, it, beforeEach } from "vitest";
import { isSoundEnabled, setSoundEnabled, blip, SOUND_EVENT } from "./sound";

/* The project runs unit tests in a node environment (no DOM), so stub
   the browser globals sound.ts touches. */
const store = new Map<string, string>();
const listeners = new Map<string, Array<(e: unknown) => void>>();

beforeEach(() => {
  store.clear();
  listeners.clear();
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
  g.window = {
    dispatchEvent: (e: { type: string }) => {
      for (const fn of listeners.get(e.type) ?? []) fn(e);
      return true;
    },
    addEventListener: (t: string, fn: (e: unknown) => void) => {
      const arr = listeners.get(t) ?? [];
      arr.push(fn);
      listeners.set(t, arr);
    },
    removeEventListener: (t: string, fn: (e: unknown) => void) => {
      listeners.set(t, (listeners.get(t) ?? []).filter((f) => f !== fn));
    },
  };
});

describe("sound preference", () => {
  it("defaults to enabled", () => {
    expect(isSoundEnabled()).toBe(true);
  });
  it("persists the toggle and fires an event", () => {
    const seen: unknown[] = [];
    const w = (globalThis as unknown as { window: Window }).window;
    const on = (e: Event) => seen.push((e as CustomEvent).detail);
    w.addEventListener(SOUND_EVENT, on);
    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);
    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
    expect(seen).toEqual([false, true]);
    w.removeEventListener(SOUND_EVENT, on);
  });
});

describe("blip", () => {
  it("is a silent no-op when disabled", () => {
    setSoundEnabled(false);
    expect(() => blip("coin")).not.toThrow();
  });
  it("does not throw without WebAudio", () => {
    // No AudioContext on the stubbed window → must stay silent.
    expect(() => blip("toast")).not.toThrow();
  });
});
