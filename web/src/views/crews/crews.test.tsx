// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  crestColor,
  formatCrewMeta,
  formatCrewXp,
  formatFounded,
  formatGoalLine,
  formatNairaCompact,
} from "./CrewsApp";

/**
 * Crews: pure-helper unit tests (formatting only — server validation is
 * covered by server/tests/crews.test.js).
 */

describe("formatCrewXp", () => {
  it("compacts thousands and millions", () => {
    expect(formatCrewXp(0)).toBe("0");
    expect(formatCrewXp(940)).toBe("940");
    expect(formatCrewXp(86000)).toBe("86K");
    expect(formatCrewXp(79400)).toBe("79.4K");
    expect(formatCrewXp(3400000)).toBe("3.4M");
    expect(formatCrewXp(5000000)).toBe("5M");
  });

  it("floors fractional input", () => {
    expect(formatCrewXp(999.9)).toBe("999");
  });
});

describe("formatNairaCompact", () => {
  it("prefixes the compact count with ₦", () => {
    expect(formatNairaCompact(10000)).toBe("₦10K");
    expect(formatNairaCompact(3400000)).toBe("₦3.4M");
    expect(formatNairaCompact(5000000)).toBe("₦5M");
  });
});

describe("formatGoalLine", () => {
  it("renders the full goal progress line", () => {
    const now = Date.now();
    const ends = now + 4 * 86400000;
    expect(formatGoalLine(3400000, 5000000, 68, ends, now)).toBe(
      "₦3.4M / ₦5M · 68% · ends in 4 days"
    );
  });

  it("handles today / ended / no deadline", () => {
    const now = Date.now();
    expect(formatGoalLine(10, 100, 10, now + 3600000, now)).toContain("ends today");
    expect(formatGoalLine(10, 100, 10, now - 1000, now)).toContain("ended");
    expect(formatGoalLine(10, 100, 10, 0, now)).toBe("₦10 / ₦100 · 10%");
  });
});

describe("formatCrewMeta", () => {
  it("renders members and rank", () => {
    expect(formatCrewMeta(248, 3)).toBe("248 members · #3 ranked");
    expect(formatCrewMeta(1, 1)).toBe("1 member · #1 ranked");
  });
});

describe("formatFounded", () => {
  it("renders month and year", () => {
    expect(formatFounded(new Date("2026-10-14T12:00:00Z").getTime())).toBe(
      "founded Oct 2026"
    );
  });
});

describe("crestColor", () => {
  it("returns a theme token var and is stable per id", () => {
    const a = crestColor("some-crew-id");
    expect(a).toMatch(/^var\(--/);
    expect(crestColor("some-crew-id")).toBe(a);
  });
});
