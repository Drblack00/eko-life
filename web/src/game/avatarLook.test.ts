/**
 * Client unit tests — sanitizeAvatarLook (M15 avatar studio).
 * Pure logic: no DOM, no Three.js.
 */
import { describe, expect, it } from "vitest";
import {
  AVATAR_LOOK_DEFAULTS,
  AVATAR_LOOK_FALLBACK_OPTIONS,
  sanitizeAvatarLook,
} from "./types";

const FULL = {
  body: "man",
  skin: "deep",
  hair: "afro",
  outfit: "native",
  fabric: "ankara",
  topColor: "#f472b6",
  bottomColor: "#1e3a8a",
};

describe("sanitizeAvatarLook", () => {
  it("passes a fully valid look through unchanged", () => {
    expect(sanitizeAvatarLook(FULL, AVATAR_LOOK_FALLBACK_OPTIONS)).toEqual(FULL);
  });

  it("falls back field-by-field on invalid ids", () => {
    const out = sanitizeAvatarLook(
      {
        body: "alien",
        skin: "nope",
        hair: "mohawk",
        outfit: "tuxedo",
        fabric: "silk",
        topColor: "red",
        bottomColor: "#zzzzzz",
      },
      AVATAR_LOOK_FALLBACK_OPTIONS
    );
    expect(out).toEqual(AVATAR_LOOK_DEFAULTS);
  });

  it("fills missing fields from defaults (partial look)", () => {
    const out = sanitizeAvatarLook(
      { body: "man", topColor: "#f472b6" },
      AVATAR_LOOK_FALLBACK_OPTIONS
    );
    expect(out).toEqual({
      ...AVATAR_LOOK_DEFAULTS,
      body: "man",
      topColor: "#f472b6",
    });
  });

  it("returns defaults for null / undefined / non-object input", () => {
    expect(sanitizeAvatarLook(null, AVATAR_LOOK_FALLBACK_OPTIONS)).toEqual(
      AVATAR_LOOK_DEFAULTS
    );
    expect(sanitizeAvatarLook(undefined, AVATAR_LOOK_FALLBACK_OPTIONS)).toEqual(
      AVATAR_LOOK_DEFAULTS
    );
    expect(sanitizeAvatarLook("afro", AVATAR_LOOK_FALLBACK_OPTIONS)).toEqual(
      AVATAR_LOOK_DEFAULTS
    );
    expect(sanitizeAvatarLook(42, AVATAR_LOOK_FALLBACK_OPTIONS)).toEqual(
      AVATAR_LOOK_DEFAULTS
    );
  });

  it("rejects colours not on the allowlist, accepts case-insensitive matches", () => {
    const out = sanitizeAvatarLook(
      { topColor: "#F472B6", bottomColor: "#123456" },
      AVATAR_LOOK_FALLBACK_OPTIONS
    );
    // Canonical list entry is returned for the case-insensitive hit.
    expect(out.topColor).toBe("#f472b6");
    // Valid hex but not offered → default.
    expect(out.bottomColor).toBe(AVATAR_LOOK_DEFAULTS.bottomColor);
  });

  it("accepts any valid hex when no colour list is given", () => {
    const out = sanitizeAvatarLook(
      { topColor: "#123456", bottomColor: "#abcdef" },
      { defaults: AVATAR_LOOK_DEFAULTS }
    );
    expect(out.topColor).toBe("#123456");
    expect(out.bottomColor).toBe("#abcdef");
  });

  it("normalises body case and rejects unknown bodies", () => {
    const opts = AVATAR_LOOK_FALLBACK_OPTIONS;
    expect(sanitizeAvatarLook({ body: "MAN" }, opts).body).toBe("man");
    expect(sanitizeAvatarLook({ body: "woman" }, opts).body).toBe("woman");
    expect(sanitizeAvatarLook({ body: "robot" }, opts).body).toBe(
      AVATAR_LOOK_DEFAULTS.body
    );
  });

  it("respects custom defaults from the server options", () => {
    const custom = {
      ...AVATAR_LOOK_FALLBACK_OPTIONS,
      defaults: { ...AVATAR_LOOK_DEFAULTS, body: "man" as const, hair: "bald" },
    };
    expect(sanitizeAvatarLook({}, custom)).toEqual(custom.defaults);
  });

  it("trims whitespace and ignores non-string field junk", () => {
    const out = sanitizeAvatarLook(
      { hair: "  afro  ", skin: 7, topColor: null },
      AVATAR_LOOK_FALLBACK_OPTIONS
    );
    expect(out.hair).toBe("afro");
    expect(out.skin).toBe(AVATAR_LOOK_DEFAULTS.skin);
    expect(out.topColor).toBe(AVATAR_LOOK_DEFAULTS.topColor);
  });
});
