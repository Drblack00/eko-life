// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { GemHuntCard, gemCountdown } from "./GemHunt";
import type { GemState } from "../../lib/api";

afterEach(() => cleanup());

/**
 * Phase 9 — Daily Gem Hunt: countdown formatting, card rendering,
 * dialog (clue, ladder, finders), and the search flow, with a mocked API.
 * REST behavior is covered by server/tests/gem.test.js.
 */

const { mockState, mockSearch } = vi.hoisted(() => ({
  mockState: vi.fn(),
  mockSearch: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...orig,
    gemApi: {
      state: mockState,
      search: mockSearch,
    },
  };
});

vi.mock("../../lib/sound", () => ({ blip: vi.fn() }));

const GEM: GemState = {
  day: 3,
  clue: "A thousand voices rise as one where the pepper burns beneath the sun.",
  nextGemInMs: 18 * 3600_000 + 14 * 60_000,
  foundCount: 8080,
  firstFinders: ["Ada", "Tunde", "Chi"],
  myFound: false,
  myPrize: null,
  myRank: null,
  nextPrize: 3000,
  prizeLadder: [
    { label: "1st", prize: 50000 },
    { label: "2nd–3rd", prize: 25000 },
    { label: "4th–10th", prize: 10000 },
    { label: "11th+", prize: 3000 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockState.mockResolvedValue(GEM);
});

describe("gemCountdown", () => {
  it("formats like the reference ('New gem in 18h 14m')", () => {
    expect(gemCountdown(18 * 3600_000 + 14 * 60_000)).toBe("New gem in 18h 14m");
    expect(gemCountdown(30 * 60_000)).toBe("New gem in 30m");
    expect(gemCountdown(45_000)).toBe("New gem in 45s");
    expect(gemCountdown(-100)).toBe("New gem in 0s");
  });
});

describe("GemHuntCard", () => {
  it("shows found count and next prize like the reference card", async () => {
    render(<GemHuntCard token="t" />);
    await waitFor(() =>
      expect(screen.getByTestId("gem-card")).toBeTruthy()
    );
    expect(screen.getByText(/8080 found · next prize ₦3,000/)).toBeTruthy();
    expect(screen.getByTestId("gem-card-countdown").textContent).toBe(
      "New gem in 18h 14m"
    );
  });

  it("shows the found state after the player finds the gem", async () => {
    mockState.mockResolvedValue({ ...GEM, myFound: true, myPrize: 25000, myRank: 2 });
    render(<GemHuntCard token="t" />);
    await waitFor(() =>
      expect(screen.getByTestId("gem-card-found").textContent).toContain("₦25,000")
    );
  });

  it("stays hidden when the API fails", async () => {
    mockState.mockRejectedValue(new Error("down"));
    const { container } = render(<GemHuntCard token="t" />);
    await waitFor(() => expect(mockState).toHaveBeenCalled());
    expect(container.querySelector("[data-testid='gem-card']")).toBeNull();
  });
});

describe("gem dialog", () => {
  it("opens on card click and shows clue, ladder, finders", async () => {
    render(<GemHuntCard token="t" />);
    await waitFor(() => screen.getByTestId("gem-card"));
    fireEvent.click(screen.getByTestId("gem-card"));
    expect(screen.getByTestId("gem-clue").textContent).toContain(
      "A thousand voices"
    );
    expect(screen.getByText("1st")).toBeTruthy();
    expect(screen.getByText("₦50,000")).toBeTruthy();
    expect(screen.getByTestId("gem-finders").textContent).toContain("@Ada");
    expect(screen.getByText("🔍 Search this location")).toBeTruthy();
  });

  it("search success shows the prize", async () => {
    mockSearch.mockResolvedValue({ ok: true, found: true, prize: 25000, rank: 3 });
    render(<GemHuntCard token="t" />);
    await waitFor(() => screen.getByTestId("gem-card"));
    fireEvent.click(screen.getByTestId("gem-card"));
    fireEvent.click(screen.getByText("🔍 Search this location"));
    await waitFor(() =>
      expect(screen.getByTestId("gem-result").textContent).toContain("₦25,000")
    );
    expect(screen.getByTestId("gem-result").textContent).toContain("rank #3");
  });

  it("search failure shows the server message", async () => {
    mockSearch.mockRejectedValue(new Error("No gem here — follow the clue. 🕵️"));
    render(<GemHuntCard token="t" />);
    await waitFor(() => screen.getByTestId("gem-card"));
    fireEvent.click(screen.getByTestId("gem-card"));
    fireEvent.click(screen.getByText("🔍 Search this location"));
    await waitFor(() =>
      expect(screen.getByTestId("gem-result").textContent).toContain("No gem here")
    );
  });

  it("shows the already-found state instead of the search button", async () => {
    mockState.mockResolvedValue({ ...GEM, myFound: true, myPrize: 50000, myRank: 1 });
    render(<GemHuntCard token="t" />);
    await waitFor(() => screen.getByTestId("gem-card"));
    fireEvent.click(screen.getByTestId("gem-card"));
    expect(screen.getByTestId("gem-mine").textContent).toContain("rank #1");
  });
});
