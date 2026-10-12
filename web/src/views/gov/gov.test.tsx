// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { GovApp, formatNaira } from "./GovApp";
import type { GovState } from "../../lib/api";

afterEach(() => cleanup());

/**
 * Phase 8 — Èkó Gov: pure-helper unit tests + render tests with a mocked
 * API. (Server validation is covered by server/tests/gov.test.js; live
 * proof comes from the Playwright run.)
 */

const { mockState, mockRun, mockVote } = vi.hoisted(() => ({
  mockState: vi.fn(),
  mockRun: vi.fn(),
  mockVote: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...orig,
    govApi: {
      state: mockState,
      run: mockRun,
      vote: mockVote,
      pickPolicy: vi.fn(),
      appoint: vi.fn(),
      dismiss: vi.fn(),
    },
  };
});

const BASE_STATE: GovState = {
  election: { id: 1, status: "voting", startDay: 1, endDay: 8, daysLeft: 5 },
  candidates: [
    { playerId: 2, username: "rival", votes: 3 },
    { playerId: 1, username: "me", votes: 1 },
  ],
  myVote: null,
  isCandidate: false,
  governor: null,
  lastWinner: { username: "oldking", electionId: 0 },
  policy: {
    id: null, name: null, icon: "🏛️", desc: null,
    picked: false, defaulted: false, pickDeadline: 0, canPick: false,
    effects: "no economic effect",
  },
  commissioners: [],
  commissionerTitles: [{ title: "Commissioner for Hustle", icon: "💼" }],
  policies: [
    { id: "tax_free", name: "Tax-Free Season", icon: "🕊️", desc: "d", effects: "zero income tax" },
  ],
  runFee: 50000,
  canRun: true,
};

const YOU = { id: 1, username: "me", name: "Me" } as never;

describe("formatNaira (pure)", () => {
  it("formats with ₦ and thousands separators", () => {
    expect(formatNaira(50000)).toBe("₦50,000");
    expect(formatNaira(0)).toBe("₦0");
  });
});

describe("GovApp render", () => {
  it("shows empty governor seat + candidates + run button", async () => {
    mockState.mockResolvedValueOnce(BASE_STATE);
    render(<GovApp token="t" you={YOU} />);
    await waitFor(() => expect(screen.getByText("No governor yet")).toBeTruthy());
    expect(screen.getByText("@rival")).toBeTruthy();
    expect(screen.getByText(/5 days left/)).toBeTruthy();
    expect(screen.getAllByText(/Run for Governor/).length).toBeGreaterThan(0);
    expect(screen.getByText(/oldking/)).toBeTruthy();
  });

  it("shows sitting governor and disables vote after voting", async () => {
    mockState.mockResolvedValueOnce({
      ...BASE_STATE,
      governor: { id: 2, username: "rival" },
      myVote: 2,
    });
    render(<GovApp token="t" you={YOU} />);
    await waitFor(() =>
      expect(screen.getAllByText("@rival").length).toBeGreaterThan(0)
    );
    expect(screen.getByText(/Your vote is in/)).toBeTruthy();
  });

  it("run flow calls the API and shows the notice", async () => {
    mockState.mockResolvedValueOnce(BASE_STATE);
    mockRun.mockResolvedValueOnce({
      ok: true,
      state: { ...BASE_STATE, isCandidate: true, canRun: false },
    });
    render(<GovApp token="t" you={YOU} />);
    await waitFor(() =>
      expect(screen.getAllByText(/Run for Governor/).length).toBeGreaterThan(0)
    );
    fireEvent.click(screen.getByText(/🎤 Run for Governor ·/));
    // confirm dialog
    fireEvent.click(screen.getByText(/Pay ₦50,000 & run/));
    await waitFor(() => expect(mockRun).toHaveBeenCalledWith("t"));
    await waitFor(() =>
      expect(screen.getByText(/You're in the race/)).toBeTruthy()
    );
  });

  it("vote flow calls the API with the candidate id", async () => {
    mockState.mockResolvedValueOnce(BASE_STATE);
    mockVote.mockResolvedValueOnce({
      ok: true,
      state: { ...BASE_STATE, myVote: 2 },
    });
    render(<GovApp token="t" you={YOU} />);
    await waitFor(() => expect(screen.getByText("@rival")).toBeTruthy());
    const voteBtns = screen.getAllByText("Vote");
    fireEvent.click(voteBtns[0]);
    fireEvent.click(screen.getByText("🗳️ Cast my vote"));
    await waitFor(() => expect(mockVote).toHaveBeenCalledWith("t", 2));
  });

  it("shows error + retry when the API fails", async () => {
    mockState.mockRejectedValueOnce(new Error("nope"));
    render(<GovApp token="t" you={YOU} />);
    await waitFor(() => expect(screen.getByText("nope")).toBeTruthy());
    expect(screen.getByText("Retry")).toBeTruthy();
  });
});
