import { useSyncExternalStore } from "react";

/**
 * Èkó Life theme system — 6 switchable chrome themes ("Èkó Way" hub +
 * dock release, 2026-10-27, replacing the 2026-10-13 liquid-glass set).
 * The palettes are the approved hub/dock samples blended with Èkó Life's
 * own design: A Green Glass · B Night Market · C Danfo Pop ·
 * D Owambe Gold · E Adire Indigo (default) · F Clean Day.
 *
 * The active theme id is persisted in localStorage under THEME_STORAGE_KEY
 * and applied as `data-theme` on <html>, which styles/themes.css keys off.
 * Every theme defines the same CSS variable names with different values,
 * so switching is a single attribute change. The themes govern the
 * chrome (hub, dock, panels, settings); the in-world day/night paint is
 * a separate in-game clock system and is untouched.
 *
 * Precedence: explicit user choice only (default "adire-indigo"). A
 * stored id from the retired 5-theme set is not a valid ThemeId, so
 * getTheme() falls back to the new default for those players.
 */

export type ThemeId =
  | "green-glass"
  | "night-market"
  | "danfo-pop"
  | "owambe-gold"
  | "adire-indigo"
  | "clean-day";

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  blurb: string;
  /** [background, panel, accent] — shown as swatch dots in the picker. */
  swatches: [string, string, string];
}

export const THEMES: ThemeMeta[] = [
  {
    id: "adire-indigo",
    name: "Adire Indigo",
    blurb: "Deep indigo night, Èkó cyan, a faint adire dot weave.",
    swatches: ["#05090f", "#0a1622", "#22d3ee"],
  },
  {
    id: "green-glass",
    name: "Green Glass",
    blurb: "Èkó's own green in liquid glass; gold only for coins.",
    swatches: ["#060806", "#0d1510", "#4ade80"],
  },
  {
    id: "night-market",
    name: "Night Market",
    blurb: "Lagos-night blue and warm amber, ankara dock strip.",
    swatches: ["#0a0f1a", "#141c2e", "#f5a623"],
  },
  {
    id: "danfo-pop",
    name: "Danfo Pop",
    blurb: "Floating pill dock, danfo-yellow centre cab.",
    swatches: ["#080806", "#14140f", "#ffd21f"],
  },
  {
    id: "owambe-gold",
    name: "Owambe Gold",
    blurb: "Champagne gold celebration, gold-glass dock bubble.",
    swatches: ["#080604", "#171106", "#fbbf24"],
  },
  {
    id: "clean-day",
    name: "Clean Day",
    blurb: "The light one — off-white glass, soft shadows, green lead.",
    swatches: ["#e9eee1", "#ffffff", "#16a34a"],
  },
];

export const THEME_STORAGE_KEY = "eko-theme";
export const THEME_ATTRIBUTE = "data-theme";
export const DEFAULT_THEME: ThemeId = "adire-indigo";

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
/* ThemePicker — 6-theme swatch picker (Me → Settings, CharacterPanel). */
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
