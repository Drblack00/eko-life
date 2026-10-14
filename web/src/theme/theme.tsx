import { useSyncExternalStore } from "react";

/**
 * Èkó Life theme system — 5 switchable themes for the liquid-glass
 * redesign (2026-10-13).
 *
 * The active theme id is persisted in localStorage under THEME_STORAGE_KEY
 * and applied as `data-theme` on <html>, which styles/themes.css keys off.
 * Every theme defines the same CSS variable names with different values,
 * so switching is a single attribute change.
 *
 * Precedence: explicit user choice only (default "liquid-dark"). The old
 * light/dark/automatic clock system was retired with the redesign.
 */

export type ThemeId = "liquid-dark" | "warm-light" | "midnight-amber" | "sage-calm" | "ocean-glass";

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  blurb: string;
  /** [background, panel, accent] — shown as swatch dots in the picker. */
  swatches: [string, string, string];
}

export const THEMES: ThemeMeta[] = [
  {
    id: "liquid-dark",
    name: "Liquid Dark",
    blurb: "Midnight navy glass with electric blue light.",
    swatches: ["#06101c", "#0d2033", "#168bff"],
  },
  {
    id: "warm-light",
    name: "Warm Light",
    blurb: "Cream mornings, white cards, deep green calm.",
    swatches: ["#faf7f2", "#ffffff", "#1b7a4d"],
  },
  {
    id: "midnight-amber",
    name: "Midnight Amber",
    blurb: "Lagos at night — charcoal and warm amber glow.",
    swatches: ["#0c0a08", "#1a1512", "#f5a623"],
  },
  {
    id: "sage-calm",
    name: "Sage Calm",
    blurb: "Soft sage quiet with a muted green accent.",
    swatches: ["#eef2ec", "#ffffff", "#5a7d5a"],
  },
{ id: "ocean-glass", name: "Ocean Glass", blurb: "Deep ocean gradient with frosted teal glass.", swatches: ["#0d2242", "#0e3a5c", "#2dd4bf"] }, ];

export const THEME_STORAGE_KEY = "eko-theme";
export const THEME_ATTRIBUTE = "data-theme";
export const DEFAULT_THEME: ThemeId = "liquid-dark";

function isThemeId(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v);
}

function storageGet(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null; // private mode / non-browser (vitest node env)
  }
}

function storageSet(value: ThemeId): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    /* private mode — the choice just won't persist */
  }
}

/** Read the persisted theme, falling back to the default. Pure + node-safe. */
export function getTheme(): ThemeId {
  const raw = storageGet();
  return isThemeId(raw) ? raw : DEFAULT_THEME;
}

// ---- Module-level store (tiny pub/sub, no context needed) ----

let current: ThemeId = DEFAULT_THEME;
const listeners = new Set<() => void>();

function applyToDocument(id: ThemeId): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (el.getAttribute(THEME_ATTRIBUTE) !== id) {
    el.setAttribute(THEME_ATTRIBUTE, id);
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ThemeId {
  return current;
}

/** Persist a new theme and apply it immediately. */
export function setTheme(next: ThemeId): void {
  if (!isThemeId(next)) return;
  const changed = next !== current;
  current = next;
  storageSet(next);
  applyToDocument(next);
  if (changed) listeners.forEach((l) => l());
}

/** React hook: [activeThemeId, setTheme]. */
export function useTheme(): [ThemeId, (id: ThemeId) => void] {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return [theme, setTheme];
}

/** Idempotent boot: apply the stored theme before first paint. */
let initialized = false;
export function initTheme(): void {
  if (initialized) return;
  initialized = true;
  current = getTheme();
  applyToDocument(current);
}

// Self-initialize on import so the saved theme is live before the first
// paint of any view. Safe in node: every DOM touch is guarded.
initTheme();

/* ------------------------------------------------------------------ */
/* Deprecated pre-redesign API — kept so theme.test.ts still compiles. */
/* ------------------------------------------------------------------ */

/** @deprecated Retired with the 4-theme redesign; kept for tests. */
export type ThemePreference = "light" | "dark" | "automatic";
/** @deprecated Retired with the 4-theme redesign; kept for tests. */
export type ResolvedTheme = "day" | "night";

/** @deprecated Kept for theme.test.ts (pure, node-safe). */
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

/** @deprecated Kept for theme.test.ts (pure, node-safe). */
export function resolveTheme(
  preference: ThemePreference,
  now = new Date(),
): ResolvedTheme {
  if (preference === "light") return "day";
  if (preference === "dark") return "night";
  const hour = lagosHour(now);
  if (hour != null) {
    return hour >= 6 && hour < 18 ? "day" : "night";
  }
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "night"
    : "day";
}

/** @deprecated Use useTheme() instead. */
export function readPreference(): ThemePreference {
  return "automatic";
}

/** @deprecated Use setTheme() instead. */
export function setThemePreference(_next: ThemePreference): void {
  /* no-op: the 4-theme system replaced preferences */
}

/* ------------------------------------------------------------------ */
/* ThemePicker — 5-theme swatch picker (Me → Settings, CharacterPanel). */
/* ------------------------------------------------------------------ */

/**
 * Compact theme picker: real radio inputs (keyboard + screen reader
 * friendly), 44px+ targets, swatch dots per theme. Styling lives in
 * styles/liquid-glass.css (.lg-theme-picker*).
 */
export function ThemePicker(): React.JSX.Element {
  const [theme, set] = useTheme();
  return (
    <fieldset className="lg-theme-picker">
      <legend className="lg-theme-picker__title">Appearance</legend>
      <div
        className="lg-theme-picker__options"
        role="radiogroup"
        aria-label="Color theme"
      >
        {THEMES.map((t) => {
          const checked = theme === t.id;
          return (
            <label
              key={t.id}
              className={`lg-theme-picker__option${
                checked ? " lg-theme-picker__option--checked" : ""
              }`}
            >
              <input
                type="radio"
                name="eko-theme-id"
                value={t.id}
                checked={checked}
                onChange={() => set(t.id)}
                className="lg-theme-picker__input"
              />
              <span className="lg-theme-picker__swatches" aria-hidden="true">
                {t.swatches.map((c) => (
                  <span
                    key={c}
                    className="lg-theme-picker__swatch"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </span>
              <span className="lg-theme-picker__text">
                <span className="lg-theme-picker__label">{t.name}</span>
                <span className="lg-theme-picker__hint">{t.blurb}</span>
              </span>
              {checked && (
                <span className="lg-theme-picker__check" aria-hidden="true">
                  ✓
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
