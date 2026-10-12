import { describe, expect, it } from "vitest";
import { compactNum, moodFor, shiftCountdown, SHORTCUTS } from "./homeChrome";

describe("moodFor", () => {
  it("maps happiness bands to labels", () => {
    expect(moodFor(100).label).toBe("Happy");
    expect(moodFor(70).label).toBe("Happy");
    expect(moodFor(69).label).toBe("Okay");
    expect(moodFor(40).label).toBe("Okay");
    expect(moodFor(39).label).toBe("Meh");
    expect(moodFor(20).label).toBe("Meh");
    expect(moodFor(19).label).toBe("Down");
    expect(moodFor(0).label).toBe("Down");
  });
  it("clamps out-of-range values", () => {
    expect(moodFor(-5).label).toBe("Down");
    expect(moodFor(500).label).toBe("Happy");
  });
});

describe("compactNum", () => {
  it("formats thousands and millions like the reference", () => {
    expect(compactNum(35_500_000)).toBe("35.5m");
    expect(compactNum(14_000)).toBe("14k");
    expect(compactNum(999)).toBe("999");
    expect(compactNum(1_000)).toBe("1k");
    expect(compactNum(1_500_000)).toBe("1.5m");
    expect(compactNum(0)).toBe("0");
  });
});

describe("shiftCountdown", () => {
  it("formats remaining shift time", () => {
    const now = 1_000_000;
    expect(shiftCountdown(now + 3_700_000, now)).toBe("1h 1m left");
    expect(shiftCountdown(now + 1_800_000, now)).toBe("30m left");
    expect(shiftCountdown(now - 5_000, now)).toBe("0s left");
  });
});

describe("SHORTCUTS", () => {
  it("covers our four tabs plus the essentials", () => {
    const keys = SHORTCUTS.map((s) => s.key);
    for (const k of ["h", "b", "m", "p", "n", "?"]) expect(keys).toContain(k);
  });
});
