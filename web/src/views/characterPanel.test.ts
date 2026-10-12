import { describe, expect, it } from "vitest";
import { feelingsLine, statusLine } from "./CharacterPanel";

describe("character panel: feelings + status lines", () => {
  it("derives feelings from the lowest need", () => {
    expect(feelingsLine({ id: "hunger", label: "Hunger", icon: "🍲" })).toMatch(
      /stomach/i
    );
    expect(feelingsLine({ id: "energy", label: "Energy", icon: "⚡" })).toMatch(
      /fumes/i
    );
    expect(feelingsLine({ id: "fun", label: "Fun", icon: "🎮" })).toMatch(
      /boredom/i
    );
    expect(feelingsLine({ id: "social", label: "Social", icon: "🗣️" })).toMatch(
      /lonely/i
    );
    expect(feelingsLine({ id: "hygiene", label: "Hygiene", icon: "🚿" })).toMatch(
      /bath/i
    );
    expect(feelingsLine({ id: "bladder", label: "Bladder", icon: "🚻" })).toMatch(
      /nature/i
    );
  });

  it("derives status from money and happiness", () => {
    expect(statusLine(200_000, 80)).toMatch(/Soft Life/);
    expect(statusLine(50_000, 60)).toMatch(/Getting There/);
    expect(statusLine(10_000, 60)).toMatch(/Hustle Mode/);
    expect(statusLine(100, 60)).toMatch(/Survival Mode/);
    // low happiness overrides wealth
    expect(statusLine(500_000, 10)).toMatch(/Low Battery/);
  });

  it("never returns empty strings", () => {
    for (const id of ["hunger", "energy", "fun", "social", "hygiene", "bladder", "other"]) {
      expect(feelingsLine({ id, label: id, icon: "" }).length).toBeGreaterThan(0);
    }
    expect(statusLine(0, 0).length).toBeGreaterThan(0);
  });
});
