import { describe, expect, it } from "vitest";
import { buildInviteLink, formatLastSeen } from "./Friends";

/**
 * W3 Friends page: unit tests for the pure helpers. (The page itself is
 * REST-backed; endpoint behavior is covered by server/tests/friends_referral.test.js.)
 */

describe("buildInviteLink", () => {
  it("builds the shareable ?ref= link", () => {
    expect(buildInviteLink("ABC123xyz01")).toBe(
      "https://ekolife.onrender.com/?ref=ABC123xyz01"
    );
  });

  it("accepts a custom origin and strips a trailing slash", () => {
    expect(buildInviteLink("K7", "http://localhost:5173/")).toBe(
      "http://localhost:5173/?ref=K7"
    );
  });
});

describe("formatLastSeen", () => {
  it("prefers the live online flag", () => {
    expect(formatLastSeen(null, true)).toBe("Online now");
    expect(formatLastSeen(Date.now() - 99_999, true)).toBe("Online now");
  });

  it("handles unknown timestamps", () => {
    expect(formatLastSeen(null, false)).toBe("Last seen a while ago");
    expect(formatLastSeen(undefined, false)).toBe("Last seen a while ago");
  });

  it("formats minutes, hours, and days", () => {
    const now = Date.now();
    expect(formatLastSeen(now - 30_000, false)).toBe("Active just now");
    expect(formatLastSeen(now - 5 * 60_000, false)).toBe("Active 5m ago");
    expect(formatLastSeen(now - 3 * 3600_000, false)).toBe("Active 3h ago");
    expect(formatLastSeen(now - 2 * 86400_000, false)).toBe("Active 2d ago");
  });

  it("clamps future timestamps to 'just now'", () => {
    expect(formatLastSeen(Date.now() + 60_000, false)).toBe("Active just now");
  });
});
