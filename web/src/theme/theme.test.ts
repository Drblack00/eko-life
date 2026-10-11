import { describe, expect, it } from "vitest";
import { lagosHour, resolveTheme } from "./theme";

/**
 * Theme precedence contract (node-safe: resolveTheme/lagosHour are pure).
 *
 * 1. Explicit "light"/"dark" always wins, regardless of the hour.
 * 2. "automatic" follows the in-game clock = Africa/Lagos wall time:
 *    06:00–17:59 → day, otherwise night.
 * 3. "automatic" with the Lagos clock unavailable → prefers-color-scheme
 *    (can't easily simulate in node; covered by code inspection).
 */

function lagosDate(hour: number): Date {
  // Build a Date whose Africa/Lagos wall time has the given hour.
  // Lagos is UTC+1 year-round (no DST), so shift from UTC directly.
  return new Date(Date.UTC(2026, 9, 11, hour - 1, 30, 0));
}

describe("theme precedence", () => {
  it("explicit light/dark always wins, whatever the hour", () => {
    expect(resolveTheme("light", lagosDate(3))).toBe("day");
    expect(resolveTheme("light", lagosDate(14))).toBe("day");
    expect(resolveTheme("dark", lagosDate(3))).toBe("night");
    expect(resolveTheme("dark", lagosDate(14))).toBe("night");
  });

  it("automatic follows the Lagos in-game clock: day 06:00–17:59", () => {
    expect(resolveTheme("automatic", lagosDate(6))).toBe("day");
    expect(resolveTheme("automatic", lagosDate(12))).toBe("day");
    expect(resolveTheme("automatic", lagosDate(17))).toBe("day");
  });

  it("automatic follows the Lagos in-game clock: night otherwise", () => {
    expect(resolveTheme("automatic", lagosDate(0))).toBe("night");
    expect(resolveTheme("automatic", lagosDate(5))).toBe("night");
    expect(resolveTheme("automatic", lagosDate(18))).toBe("night");
    expect(resolveTheme("automatic", lagosDate(23))).toBe("night");
  });

  it("reads the Africa/Lagos hour, not the machine's local hour", () => {
    const d = lagosDate(10);
    expect(lagosHour(d)).toBe(10);
  });
});
