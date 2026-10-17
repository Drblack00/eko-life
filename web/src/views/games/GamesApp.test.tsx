// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { GamesApp } from "./GamesApp";
import { gamesApi } from "../../lib/api";

vi.mock("../../lib/api", () => ({ gamesApi: {} }));

const catalogue: any = {
  games: [
    {
      key: "zanga",
      name: "Zanga Billiards",
      icon: "🎱",
      tagline: "Pot every ball, then talk.",
      seats: 2,
      variants: ["stacking", "blitz"],
      rules: ["Race to 5."],
    },
    {
      key: "seedcircle",
      name: "Seed Circle",
      icon: "🌰",
      tagline: "Harvest last, win first.",
      seats: 2,
      variants: ["rollover"],
      rules: ["Most seeds wins."],
    },
  ],
  stakes: [0, 1000, 5000, 20000],
  venues: [{ key: "cue-house", name: "Surulere Cue House", icon: "🎱", blurb: "" }],
  variants: {
    stacking: { key: "stacking", name: "Stacking", icon: "🔥", blurb: "" },
    blitz: { key: "blitz", name: "Blitz", icon: "⚡", blurb: "" },
    rollover: { key: "rollover", name: "Rollover", icon: "🔁", blurb: "" },
  },
  houseCutPct: 5,
  cpuName: "Èkó CPU",
  myBalance: 2000,
  note: "Matches are played against Èkó CPU.",
};

const table: any = {
  id: 7,
  game: { key: "zanga", name: "Zanga Billiards", icon: "🎱", tagline: "" },
  venue: { key: "cue-house", name: "Surulere Cue House", icon: "🎱" },
  stake: 5000,
  variant: null,
  creatorUsername: "someone",
  friendInvite: null,
  seatsTaken: 1,
  seatsTotal: 2,
  seats: ["someone"],
  winnerTakes: 9500,
  createdAt: Date.now(),
  needMore: 3000, // viewer has 2000
};

function mockAll(over: Record<string, any> = {}) {
  const api = gamesApi as any;
  api.catalogue = vi.fn().mockResolvedValue(catalogue);
  api.tables = vi.fn().mockResolvedValue({ tables: [table], myBalance: 2000 });
  api.live = vi.fn().mockResolvedValue({ live: [] });
  api.fame = vi.fn().mockResolvedValue({
    game: { key: "zanga", name: "Zanga Billiards", icon: "🎱" },
    leaders: [],
    me: null,
    emptyCopy: "You haven't played a money game of Zanga Billiards yet.",
  });
  api.join = vi.fn();
  api.leave = vi.fn();
  api.start = vi.fn();
  api.create = vi.fn();
  api.watch = vi.fn();
  Object.assign(api, over);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GamesApp", () => {
  it("renders the hall, game chips, and tables", async () => {
    mockAll();
    render(<GamesApp token="t" />);
    expect(await screen.findByText("🎱 Games Hall")).toBeTruthy();
    // "Zanga Billiards" renders with its icon ("🎱 Zanga Billiards") in the
    // filter chip and the table card — regex matches the full text content.
    expect((await screen.findAllByText(/Zanga Billiards/)).length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByText("1 of 2 seated")).toBeTruthy();
  });

  it("disables join with 'need ₦X more' when unaffordable", async () => {
    mockAll();
    render(<GamesApp token="t" />);
    const btn = (await screen.findByText("Need ₦3,000 more")) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("shows the v1 CPU note and house-cut copy", async () => {
    mockAll();
    render(<GamesApp token="t" />);
    expect(await screen.findByText(/Èkó CPU \(placeholder AI\)/)).toBeTruthy();
    expect(await screen.findByText(/the house keeps 5%/)).toBeTruthy();
  });

  it("create rail shows the stake math before creating", async () => {
    mockAll();
    render(<GamesApp token="t" />);
    fireEvent.click(await screen.findByText("➕ Create"));
    // default stake 5000 → winner takes 9500
    expect(await screen.findByText(/the winner takes ₦9,500/)).toBeTruthy();
    expect(screen.getByText("🎱 Create · ₦5,000")).toBeTruthy();
  });

  it("hall of fame shows the empty state when the viewer has no money games", async () => {
    mockAll();
    render(<GamesApp token="t" />);
    fireEvent.click(await screen.findByText("🏛️ Hall of Fame"));
    expect(
      await screen.findByText("You haven't played a money game of Zanga Billiards yet.")
    ).toBeTruthy();
  });

  it("join surfaces server errors as a toast", async () => {
    mockAll({ join: vi.fn().mockRejectedValue(new Error("You need ₦3,000 more to sit here.")) });
    // affordable table this time
    const api = gamesApi as any;
    api.tables = vi.fn().mockResolvedValue({
      tables: [{ ...table, needMore: 0 }],
      myBalance: 20000,
    });
    render(<GamesApp token="t" />);
    fireEvent.click(await screen.findByText("Join"));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/need ₦3,000 more/);
    });
  });
});
