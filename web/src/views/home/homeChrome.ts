/**
 * Home screen chrome helpers (Phase 1 of the reference audit rebuild).
 * Pure functions only — everything here is unit-tested.
 */

/** Mood label derived from the happiness need (0–100). */
export function moodFor(happiness: number): { label: string; emoji: string } {
  const h = Math.max(0, Math.min(100, Math.round(happiness || 0)));
  if (h >= 70) return { label: "Happy", emoji: "😊" };
  if (h >= 40) return { label: "Okay", emoji: "😐" };
  if (h >= 20) return { label: "Meh", emoji: "😟" };
  return { label: "Down", emoji: "😞" };
}

/** Compact counter like the reference ("35.5m · 14k online"). */
export function compactNum(n: number): string {
  const v = Math.max(0, Math.floor(n || 0));
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    return `${m >= 100 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, "")}m`;
  }
  if (v >= 1_000) {
    const k = v / 1_000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `${v}`;
}

export interface ShortcutDef {
  /** Keyboard key (lowercase; "?" for shift+/; "esc" for Escape). */
  key: string;
  /** Short label shown in the dialog, e.g. "H". */
  label: string;
  /** What it does. */
  description: string;
}

/** Keyboard shortcuts — adapted to our tabs (Home / Buy / Map / Phone). */
export const SHORTCUTS: ShortcutDef[] = [
  { key: "h", label: "H", description: "Go to the Home tab" },
  { key: "b", label: "B", description: "Go to the Buy tab" },
  { key: "m", label: "M", description: "Go to the Map tab" },
  { key: "p", label: "P", description: "Open / close the Phone" },
  { key: "n", label: "N", description: "Open notifications" },
  { key: "d", label: "D", description: "Open the Daily app" },
  { key: "j", label: "J", description: "Open the Jobs app" },
  { key: "t", label: "T", description: "Things to do — venues & activities" },
  { key: "?", label: "?", description: "Show this shortcuts list" },
  { key: "esc", label: "Esc", description: "Close dialog / sheet / panel" },
];

/** Format seconds-left on an active shift as "1h 23m" / "45m" / "8m". */
export function shiftCountdown(endsAt: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((endsAt - now) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m left`;
  if (m > 0) return `${m}m left`;
  return `${s}s left`;
}
