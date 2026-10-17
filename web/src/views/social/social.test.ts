// PORT-P4: social — group-create validation + icon picker contract.
import { describe, expect, it } from "vitest";
import { groupCreateValid, GROUP_ICONS } from "../chat/RoomsView";

describe("groupCreateValid", () => {
  it("requires a name of at least 2 chars and at least one member", () => {
    expect(groupCreateValid("Owambe Gang", ["tobi"])).toBe(true);
    expect(groupCreateValid("  ", ["tobi"])).toBe(false);
    expect(groupCreateValid("A", ["tobi"])).toBe(false);
    expect(groupCreateValid("Owambe Gang", [])).toBe(false);
    expect(groupCreateValid("", [])).toBe(false);
  });

  it("trims the name before measuring", () => {
    expect(groupCreateValid("  AB  ", ["tobi"])).toBe(true);
  });
});

describe("GROUP_ICONS", () => {
  it("offers exactly 16 emoji icons (mirrors the server picker)", () => {
    expect(GROUP_ICONS).toHaveLength(16);
    expect(new Set(GROUP_ICONS).size).toBe(16);
  });
});
