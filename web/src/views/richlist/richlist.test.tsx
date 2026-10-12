// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { RichListApp, formatNaira, rankedLeaders } from "./RichListApp";
import type { RichListEntry } from "../../lib/api";

afterEach(() => cleanup());

/**
 * Phase 7 — Èkó Rich List: pure-helper unit tests + a render test with a
 * mocked API. (Ranking SQL behavior is covered by server/tests/richlist.test.js;
 * live proof comes from the Playwright run.)
 */

const { mockList } = vi.hoisted(() => ({
  mockList: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...orig,
    richListApi: { list: mockList },
  };
});

vi.mock("../chat/ProfileSheet", () => ({
  ProfileSheet: () => null,
}));

const LEADERS: RichListEntry[] = [
  { id: 1, username: "rich", avatar: "🧑", color: "#22d3ee", netWorth: 500_000 },
  { id: 2, username: "mid", avatar: "👩", color: "#f472b6", netWorth: 200_000 },
  { id: 3, username: "poor", avatar: "🧔", color: "#a3e635", netWorth: 10_000 },
];

describe("formatNaira (pure)", () => {
  it("formats with ₦ and thousands separators", () => {
    expect(formatNaira(1500000)).toBe("₦1,500,000");
    expect(formatNaira(0)).toBe("₦0");
    expect(formatNaira(999.9)).toBe("₦999");
  });
});

describe("rankedLeaders (pure)", () => {
  it("assigns 1,2,3 in order", () => {
    expect(rankedLeaders(LEADERS).map((l) => l.rank)).toEqual([1, 2, 3]);
  });
  it("shares rank on ties (competition ranking)", () => {
    const tied: RichListEntry[] = [
      { id: 1, username: "a", avatar: "", color: "", netWorth: 100 },
      { id: 2, username: "b", avatar: "", color: "", netWorth: 100 },
      { id: 3, username: "c", avatar: "", color: "", netWorth: 50 },
    ];
    expect(rankedLeaders(tied).map((l) => l.rank)).toEqual([1, 1, 3]);
  });
});

describe("RichListApp render", () => {
  it("shows YOUR RANK header and the ranked rows", async () => {
    mockList.mockResolvedValueOnce({
      leaders: LEADERS,
      yourRank: 2,
      totalPlayers: 3,
    });
    render(
      <RichListApp
        token="t"
        youId={2}
        youUsername="mid"
        sock={{} as never}
        onStartDm={() => {}}
      />
    );
    await waitFor(() => expect(screen.getByText(/YOUR RANK/)).toBeTruthy());
    expect(screen.getByText(/YOUR RANK/).textContent).toContain("#2");
    expect(screen.getByText(/YOUR RANK/).textContent).toContain("of 3");
    expect(screen.getByText("@rich")).toBeTruthy();
    expect(screen.getByText("₦500,000")).toBeTruthy();
    // own row is highlighted
    expect(screen.getByText("you")).toBeTruthy();
  });

  it("shows the honest empty state when fewer than 2 players exist", async () => {
    mockList.mockResolvedValueOnce({ leaders: [], yourRank: 1, totalPlayers: 1 });
    render(
      <RichListApp
        token="t"
        youId={9}
        youUsername="solo"
        sock={{} as never}
        onStartDm={() => {}}
      />
    );
    await waitFor(() =>
      expect(screen.getByText(/Not enough players yet/)).toBeTruthy()
    );
  });

  it("shows an error with Retry on API failure", async () => {
    mockList.mockRejectedValueOnce(new Error("boom"));
    render(
      <RichListApp
        token="t"
        youId={9}
        youUsername="solo"
        sock={{} as never}
        onStartDm={() => {}}
      />
    );
    await waitFor(() => expect(screen.getByText("boom")).toBeTruthy());
    mockList.mockResolvedValueOnce({ leaders: [], yourRank: 1, totalPlayers: 1 });
    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() =>
      expect(screen.getByText(/Not enough players yet/)).toBeTruthy()
    );
  });
});
