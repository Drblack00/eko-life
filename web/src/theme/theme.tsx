import { useSyncExternalStore } from "react";

/**
 * Èkó Life theme system (Worker A).
 *
 * Three preferences: "light" | "dark" | "automatic", persisted in
 * localStorage under THEME_STORAGE_KEY. The resolved theme ("day" | "night")
 * is applied as `data-theme` on <html>, which the token stylesheets
 * (styles/tokens.css, styles/glass.css) already key off — so every view
 * (home, buy, map, phone slide-over, sheets, toasts, dialogs) follows it.
 *
 * Precedence (highest first):
 *   1. Explicit user choice ("light" / "dark") — always wins.
 *   2. "automatic" → the in-game clock, which is real wall time in
 *      Africa/Lagos (see views/v2/m7/Clock.tsx): 06:00–17:59 → day,
 *      otherwise night. Computed locally via Intl — no network, no
 *      coupling to game state.
 *   3. "automatic" with the Lagos clock unavailable (no Intl/timezone
 *      data — practically never in Chromium) → the phone's
 *      prefers-color-scheme.
 *
 * The module self-initializes on import (idempotent): Game.tsx imports the
 * ThemePicker below, so the theme is applied before the first game view
 * paints without touching App.tsx / main.tsx. Automatic mode re-evaluates
 * every 60s, on visibility change, and when the OS color scheme changes.
 */

export type ThemePreference = "light" | "dark" | "automatic";
export type ResolvedTheme = "day" | "night";

export const THEME_STORAGE_KEY = "eko-life:theme";
export const THEME_ATTRIBUTE = "data-theme";

const REEVALUATE_MS = 60_000;

const PREFERENCES: ThemePreference[] = ["light", "dark", "automatic"];

function isPreference(v: unknown): v is ThemePreference {
  return typeof v === "string" && (PREFERENCES as string[]).includes(v);
}

function storageGet(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null; // private mode / non-browser (vitest node env)
  }
}

function storageSet(value: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    /* private mode — the choice just won't persist */
  }
}

/** Current Africa/Lagos wall-clock hour (0–23), or null when unavailable. */
export function lagosHour(now = new Date()): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Lagos",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(now);
    const hour = parts.find((p) => p.type === "hour");
    if (!hour) return null;
    const n = parseInt(hour.value, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/* Unused — dark theme disabled. */
void 0;

/** Resolve a preference to a concrete theme (pure — safe in tests). */
export function resolveTheme(
  _preference: ThemePreference,
  _now = new Date(),
): ResolvedTheme {
  // Bright cartoon theme forced always — the dark theme is disabled.
  // The user wants the lagoslife.app bright design everywhere.
  return "day";
}

export function readPreference(): ThemePreference {
  const raw = storageGet();
  return isPreference(raw) ? raw : "automatic";
}

// ---- Module-level store (tiny pub/sub, no context needed) ----

let preference: ThemePreference = readPreference();
let resolved: ResolvedTheme = resolveTheme(preference);
const listeners = new Set<() => void>();

function applyToDocument(theme: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (el.getAttribute(THEME_ATTRIBUTE) !== theme) {
    el.setAttribute(THEME_ATTRIBUTE, theme);
  }
}

function reevaluate(): void {
  const next = resolveTheme(preference);
  if (next !== resolved) {
    resolved = next;
    applyToDocument(resolved);
    listeners.forEach((l) => l());
  } else {
    applyToDocument(resolved);
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getPreferenceSnapshot(): ThemePreference {
  return preference;
}

function getResolvedSnapshot(): ResolvedTheme {
  return resolved;
}

/** Persist a new preference and apply it immediately. */
export function setThemePreference(next: ThemePreference): void {
  if (!isPreference(next) || next === preference) return;
  preference = next;
  storageSet(next);
  reevaluate();
  listeners.forEach((l) => l());
}

/**
 * React hook for the current theme. `preference` drives the picker UI;
 * `resolved` ("day" | "night") reflects what's on <html>.
 */
export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
} {
  const pref = useSyncExternalStore(subscribe, getPreferenceSnapshot);
  const res = useSyncExternalStore(subscribe, getResolvedSnapshot);
  return { preference: pref, resolved: res, setPreference: setThemePreference };
}

/** Idempotent boot: apply the stored/resolved theme and start watchers. */
let initialized = false;
export function initTheme(): void {
  if (initialized) return;
  initialized = true;
  preference = readPreference();
  reevaluate();
  if (typeof window === "undefined") return;
  window.setInterval(() => {
    if (preference === "automatic") reevaluate();
  }, REEVALUATE_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && preference === "automatic") reevaluate();
  });
  if (typeof window.matchMedia === "function") {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (preference === "automatic") reevaluate();
    };
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
    } else if (typeof mq.addListener === "function") {
      mq.addListener(onChange);
    }
  }
}

// Self-initialize on import so the theme is live before the first paint of
// any view (Game.tsx imports ThemePicker from this module). Safe in node:
// every DOM touch is guarded.
initTheme();

const PREFERENCE_LABELS: Array<{
  id: ThemePreference;
  label: string;
  hint: string;
}> = [
  { id: "light", label: "Light", hint: "Always" },
  { id: "dark", label: "Dark", hint: "Always" },
  /* "Auto" (not "Automatic"): the 3-up grid is narrow on phones and the
     full word forces mid-word breaks. The note below spells it out. */
  { id: "automatic", label: "Auto", hint: "Game clock" },
];

/**
 * Theme picker for Me → Settings. Real radio inputs (keyboard + screen
 * reader friendly), 44px+ targets. Styling lives in styles/glass.css
 * (.eko-theme-picker*) so it follows the glass language in both themes.
 */
export function ThemePicker(): React.JSX.Element {
  const { preference, setPreference } = useTheme();
  return (
    <fieldset className="eko-theme-picker">
      <legend className="eko-theme-picker__title">Theme</legend>
      <div
        className="eko-theme-picker__options"
        role="radiogroup"
        aria-label="Color theme"
      >
        {PREFERENCE_LABELS.map((opt) => {
          const checked = preference === opt.id;
          return (
            <label
              key={opt.id}
              className={`eko-theme-picker__option${
                checked ? " eko-theme-picker__option--checked" : ""
              }`}
            >
              <input
                type="radio"
                name="eko-theme-preference"
                value={opt.id}
                checked={checked}
                onChange={() => setPreference(opt.id)}
                className="eko-theme-picker__input"
              />
              <span
                className="eko-theme-picker__swatch"
                data-tone={opt.id}
                aria-hidden="true"
              />
              <span className="eko-theme-picker__text">
                <span className="eko-theme-picker__label">{opt.label}</span>
                <span className="eko-theme-picker__hint">{opt.hint}</span>
              </span>
            </label>
          );
        })}
      </div>
      <p className="eko-theme-picker__note">
        Automatic follows the in-game clock — light by day, dark by night.
      </p>
    </fieldset>
  );
}
