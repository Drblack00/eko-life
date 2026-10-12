// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { previewPayout, termOptionLabel, BankApp } from "./BankApp";
import type { You } from "../../game/types";
import type { BankOverview } from "../../lib/api";

afterEach(() => cleanup());

/**
 * Phase 4 — Èkó Reserve: pure-helper unit tests + an overview render test
 * with a mocked API. (REST/settlement behavior is covered by
 * server/tests/bank.test.js; live proof comes from the Playwright run.)
 */

const { mockOverview, mockTransactions } = vi.hoisted(() => ({
  mockOverview: vi.fn(),
  mockTransactions: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...orig,
    bankApi: {
      overview: mockOverview,
      bonds: vi.fn(),
      buyBond: vi.fn(),
    },
    api: {
      ...orig.api,
      transactions: mockTransactions,
    },
  };
});

describe("previewPayout (pure)", () => {
  it("computes 5/12/30% flat interest, floored", () => {
    expect(previewPayout(100000, 0.05)).toEqual({ interest: 5000, payout: 105000 });
    expect(previewPayout(100000, 0.12)).toEqual({ interest: 12000, payout: 112000 });
    expect(previewPayout(100000, 0.3)).toEqual({ interest: 30000, payout: 130000 });
    expect(previewPayout(9999, 0.05)).toEqual({ interest: 499, payout: 10498 });
  });
  it("floors fractional principals and clamps negatives", () => {
    expect(previewPayout(5500.9, 0.05)).toEqual({ interest: 275, payout: 5775 });
    expect(previewPayout(-100, 0.05)).toEqual({ interest: 0, payout: 0 });
    expect(previewPayout(NaN, 0.05)).toEqual({ interest: 0, payout: 0 });
  });
});

describe("termOptionLabel (pure)", () => {
  const terms = {
    "7": { rate: 0.05, label: "7-day · 5%" },
    "14": { rate: 0.12, label: "14-day · 12%" },
  };
  it("prefers the server label, falls back to '<n>-day'", () => {
    expect(termOptionLabel(7, terms)).toBe("7-day · 5%");
    expect(termOptionLabel(30, terms)).toBe("30-day");
  });
});

const baseYou = {
  id: 1,
  username: "tester",
  name: "Tester",
  class: "street_smart",
  avatar: "🧑",
  color: "#22d3ee",
  money: 50000,
  energy: 100,
  health: 100,
  happiness: 80,
  hunger: 100,
  housing: "face-me",
  property: null,
  vehicle: null,
  savings: 20000,
  loan: 0,
  cert: 0,
  locationId: "ojuelegba",
  lat: 50,
  lng: 50,
  is_admin: false,
  guest: false,
} as unknown as You;

function overviewFixture(): BankOverview {
  return {
    balance: 50000,
    savings: 20000,
    netWorth: 80000, // 50000 + 20000 + 10000 active bond principal
    lastReceipt: {
      id: 9,
      kind: "bond_buy",
      amount: -10000,
      balance_after: 50000,
      created_at: Date.now(),
    },
    bonds: {
      active: [
        {
          id: 3,
          user_id: 1,
          principal: 10000,
          rate: 0.12,
          start_day: 1,
          term_days: 14,
          matured: false,
          matured_day: null,
          matures_day: 15,
          interest: 1200,
          payout: 11200,
        },
      ],
      matured: [],
      terms: {
        "7": { rate: 0.05, label: "7-day · 5%" },
        "14": { rate: 0.12, label: "14-day · 12%" },
        "30": { rate: 0.3, label: "30-day · 30%" },
      },
      min: 5000,
    },
    tax: {
      weekEarnings: 500000,
      bill: 0,
      rawBill: 0,
      taxMult: 1,
      holiday: false,
      free: 1000000,
      band2: 9000000,
      rate2: 0.2,
      rate3: 0.3,
      bracket: { label: "Tax-free allowance", rate: 0 },
    },
    bills: {
      weeklyBill: 1000,
      weekEndsDay: 7,
      currentWeek: 0,
      arrears: 0,
      arrearsCap: 4000,
      base: 1000,
      propRate: 0.001,
      capWeeks: 4,
    },
    interestWeek: 1500,
    day: 3,
    isAdmin: false,
  };
}

describe("BankApp render", () => {
  it("shows Èkó Reserve with net worth, tax estimate, bill and receipt", async () => {
    mockOverview.mockResolvedValueOnce(overviewFixture());
    mockTransactions.mockResolvedValueOnce([]);
    const sendAct = vi.fn();
    render(
      <BankApp token="tok" you={baseYou} sendAct={sendAct} onTopUp={() => {}} />
    );
    await waitFor(() => expect(screen.getByText("Èkó Reserve")).toBeTruthy());
    // net worth = wallet + savings + active bond principal
    expect(screen.getByText("₦80,000")).toBeTruthy();
    // tax estimate line
    expect(screen.getByText(/Estimated tax this week:/)).toBeTruthy();
    expect(screen.getByText(/Tax-free allowance/)).toBeTruthy();
    // weekly bill + week-end day
    expect(screen.getByText("₦1,000")).toBeTruthy();
    expect(screen.getByText(/ends on game day 7/)).toBeTruthy();
    // last receipt label (KIND_LABELS extended with bond_buy)
    expect(screen.getByText("Bond purchase")).toBeTruthy();
    // savings vault + 2%/day note
    expect(screen.getByText(/Savings earn 2% every game day/)).toBeTruthy();
    // active bond row
    expect(screen.getByText(/Bond #3/)).toBeTruthy();
  });

  it("top-up button calls onTopUp (inert dialog lives in Game)", async () => {
    mockOverview.mockResolvedValueOnce(overviewFixture());
    mockTransactions.mockResolvedValueOnce([]);
    const onTopUp = vi.fn();
    render(
      <BankApp token="tok" you={baseYou} sendAct={vi.fn()} onTopUp={onTopUp} />
    );
    await waitFor(() => expect(screen.getByText("Èkó Reserve")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Top up wallet" }));
    expect(onTopUp).toHaveBeenCalledTimes(1);
  });

  it("deposit/withdraw send the existing WS bank act", async () => {
    mockOverview.mockResolvedValueOnce(overviewFixture());
    mockTransactions.mockResolvedValueOnce([]);
    const sendAct = vi.fn();
    render(
      <BankApp token="tok" you={baseYou} sendAct={sendAct} onTopUp={() => {}} />
    );
    await waitFor(() => expect(screen.getByText("Èkó Reserve")).toBeTruthy());
    const input = screen.getByLabelText("Amount") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: /Deposit ₦5,000/ }));
    expect(sendAct).toHaveBeenCalledWith("bank", { op: "deposit", amount: 5000 });
    // the act clears the input — re-enter before withdrawing
    fireEvent.change(input, { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: /Withdraw ₦5,000/ }));
    expect(sendAct).toHaveBeenCalledWith("bank", { op: "withdraw", amount: 5000 });
  });

  it("shows arrears clearly when present", async () => {
    const ov = overviewFixture();
    ov.bills.arrears = 2500;
    mockOverview.mockResolvedValueOnce(ov);
    mockTransactions.mockResolvedValueOnce([]);
    render(
      <BankApp token="tok" you={baseYou} sendAct={vi.fn()} onTopUp={() => {}} />
    );
    await waitFor(() => expect(screen.getByText("Èkó Reserve")).toBeTruthy());
    expect(screen.getByText("₦2,500")).toBeTruthy();
    expect(screen.getByText(/No interest on arrears, no lockouts/)).toBeTruthy();
  });
});
