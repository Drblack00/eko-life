// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_THEME, setTheme, setThemeWithMotion, THEME_ATTRIBUTE } from "./theme";
afterEach(() => { setTheme(DEFAULT_THEME); vi.unstubAllGlobals(); delete (document as Partial<Document>).startViewTransition; });
it("cross-fades supported theme switches without changing the synchronous theme API", () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const start = vi.fn((update: () => void) => { update(); return { ready: Promise.resolve(), finished: Promise.resolve(), skipTransition: vi.fn() }; });
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
  setThemeWithMotion('clean-day');
  expect(start).toHaveBeenCalledOnce();
  expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('clean-day');
  setTheme('night-market');
  expect(start).toHaveBeenCalledOnce();
  expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('night-market');
});
it("applies reduced-motion switches immediately without taking a snapshot", () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const start = vi.fn();
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
  setThemeWithMotion('green-glass');
  expect(start).not.toHaveBeenCalled();
  expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('green-glass');
});

it("cancels stale theme snapshots when choices arrive before their update callbacks", () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const updates: Array<() => void> = [];
  const skip = vi.fn();
  const start = vi.fn((update: () => void) => {
    updates.push(update);
    return { ready: Promise.resolve(), finished: Promise.resolve(), skipTransition: skip };
  });
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
  setThemeWithMotion('clean-day');
  setThemeWithMotion('danfo-pop');
  expect(skip).toHaveBeenCalledOnce();
  updates[1](); updates[0]();
  expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('danfo-pop');
});
