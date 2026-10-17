// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";
import { previewPayout, termOptionLabel, BankApp } from "./BankApp";
import type { You } from "../../game/types";
import type { BankOverview } from "../../lib/api";

afterEach(() => cleanup());

/**
 * Phase 4 — Èkó Reserve: pure-helper unit tests + an overview render test
 * with a mocked API. (REST/settlement behavior is covered by
 * server/tests/bank.test.js; live proof comes from the Playwright run.)
 */

const { mockOverview, mockTransactions, mockTopupPacks } = vi.hoisted(() => ({
  mockOverview: vi.fn(),
  mockTransactions: vi.fn(),
  mockTopupPacks: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...orig,
    bankApi: {
      overview: mockOverview,
      bonds: vi.fn(),
      buyBond: vi.fn(),
      // PORT-P2: money
      notes: vi.fn(),
      buyNote: vi.fn(),
      withdrawNoteEarly: vi.fn(),
      credit: vi.fn(),
      creditPay: vi.fn(),
      creditPayAll: vi.fn(),
      housingMove: vi.fn(),
      housingBuy: vi.fn(),
      housingPayDebt: vi.fn(),
      credibility: vi.fn(),
    },
    topupApi: {
      packs: mockTopupPacks,
      purchase: vi.fn(),
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
      flatRate: 0.075,
      bracket: { label: "Tax-free allowance", rate: 0 },
    },
    // PORT-P2: money
    savingsTerms: { weeklyRate: 0.005, cap: 1000000000, minWithdraw: 1000 },
    termNotes: {
      active: [],
      rate: 0.02,
      termDays: 7,
      min: 10000,
      max: 500000000,
    },
    credit: null,
    credibility: {
      total: 12,
      parts: [
        { key: "accountAge", label: "Account age", score: 2, max: 10, detail: "60 days with Èkó Life" },
        { key: "movedWithPlayers", label: "Money moved with players", score: 5, max: 25, detail: "₦50,000 moved" },
        { key: "regularPartners", label: "Regular partners", score: 0, max: 15, detail: "0 partners traded on 3+ days" },
        { key: "streaks", label: "Money streaks", score: 0, max: 15, detail: "0-day active streak" },
        { key: "collected", label: "Money collected", score: 5, max: 15, detail: "₦50,000 received" },
        { key: "jobsBusiness", label: "Jobs and business", score: 0, max: 20, detail: "no jobs or business yet" },
      ],
      recordOnly: true,
    },
    housing: {
      homes: [
        { id: "room_oshodi", name: "Single Room · Oshodi", icon: "🏠", weeklyRent: 8000, buyPrice: 450000 },
        { id: "selfcon_yaba", name: "Self-Contain · Yaba", icon: "🏡", weeklyRent: 15000, buyPrice: 900000 },
      ],
      current: null,
      currentDef: null,
      owned: [],
      rentDebt: 0,
      rentSaturday: false,
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
    mockTopupPacks.mockResolvedValueOnce({ realMoneyEnabled: false, currencyToggle: ["NGN", "USD"], packs: [], notice: "Top-ups are not available yet." });
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
    // PORT-P2: savings vault copy (0.5%/week, ₦1bn cap, ₦1k min withdrawal)
    expect(screen.getByText(/Savings earn 0.5% every game week/)).toBeTruthy();
    // active bond row
    expect(screen.getByText(/Bond #3/)).toBeTruthy();
  });

  it("top-up button calls onTopUp (inert dialog lives in Game)", async () => {
    mockOverview.mockResolvedValueOnce(overviewFixture());
    mockTransactions.mockResolvedValueOnce([]);
    mockTopupPacks.mockResolvedValueOnce({ realMoneyEnabled: false, currencyToggle: ["NGN", "USD"], packs: [], notice: "Top-ups are not available yet." });
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
    mockTopupPacks.mockResolvedValueOnce({ realMoneyEnabled: false, currencyToggle: ["NGN", "USD"], packs: [], notice: "Top-ups are not available yet." });
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
    mockTopupPacks.mockResolvedValueOnce({ realMoneyEnabled: false, currencyToggle: ["NGN", "USD"], packs: [], notice: "Top-ups are not available yet." });
    render(
      <BankApp token="tok" you={baseYou} sendAct={vi.fn()} onTopUp={() => {}} />
    );
    await waitFor(() => expect(screen.getByText("Èkó Reserve")).toBeTruthy());
    expect(screen.getByText("₦2,500")).toBeTruthy();
    expect(screen.getByText(/No interest on arrears, no lockouts/)).toBeTruthy();
  });

  // PORT-P2: money — new sections render from the overview bundle.
  it("renders term notes, credit facility, housing, credibility sections", async () => {
    mockOverview.mockResolvedValueOnce(overviewFixture());
    mockTransactions.mockResolvedValueOnce([]);
    mockTopupPacks.mockResolvedValueOnce({ realMoneyEnabled: false, currencyToggle: ["NGN", "USD"], packs: [], notice: "Top-ups are not available yet." });
    render(
      <BankApp token="<redacted>" you={baseYou} sendAct={vi.fn()} onTopUp={() => {}} />
    );
    await waitFor(() => expect(screen.getByText("Èkó Reserve")).toBeTruthy());
    // term notes: 2%/7d terms + min/max
    expect(screen.getByText(/Lock coins for 7 days at 2%/)).toBeTruthy();
    expect(screen.getByText("Buy 7-day note")).toBeTruthy();
    // credit facility: repayment-only empty state
    expect(screen.getByText(/No credit balance/)).toBeTruthy();
    // housing ladder: homes listed with move/buy
    expect(screen.getByText(/Single Room · Oshodi/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Move in" }).length).toBeGreaterThan(0);
    // credibility: score + record-only promise
    expect(screen.getByText("12/100")).toBeTruthy();
    expect(screen.getByText(/never limits what you can send/)).toBeTruthy();
  });

  it("top-up packs render with disabled Buy buttons and compliance notice", async () => {
    mockOverview.mockResolvedValueOnce(overviewFixture());
    mockTransactions.mockResolvedValueOnce([]);
    mockTopupPacks.mockResolvedValueOnce({
      realMoneyEnabled: false,
      currencyToggle: ["NGN", "USD"],
      packs: [
        { id: "starter", name: "Starter Stack", icon: "🌱", ngn: 1000, usd: 1, coins: 50000, tagline: "Small money, sharp start." },
        { id: "big_moves", name: "Big Moves", icon: "💼", ngn: 10000, usd: 7, coins: 700000, tagline: "Best value.", bestValue: true },
      ],
      notice: "Top-ups are not available yet — they open after the real-money compliance chain is complete.",
    });
    render(
      <BankApp token="<redacted>" you={baseYou} sendAct={vi.fn()} onTopUp={() => {}} />
    );
    await waitFor(() => expect(screen.getByText("Starter Stack")).toBeTruthy());
    expect(screen.getByText("Best value")).toBeTruthy();
    // scope to the Top up section — the housing ladder has its own Buy buttons
    const topupSection = screen.getByLabelText("Top up");
    const buys = within(topupSection).getAllByRole("button", { name: "Buy" });
    expect(buys.length).toBe(2);
    buys.forEach((b) => expect((b as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText(/compliance chain is complete/)).toBeTruthy();
    // ₦/$ toggle
    fireEvent.click(within(topupSection).getByRole("button", { name: "$ USD" }));
    expect(within(topupSection).getByText(/\$1 →/)).toBeTruthy();
  });

  it("credit facility shows balance + Pay now / Pay it all when a loan exists", async () => {
    const ov = overviewFixture();
    ov.credit = { balance: 60000, weeklyDue: 12000, weeksLeft: 5, debitsDone: 0 };
    mockOverview.mockResolvedValueOnce(ov);
    mockTransactions.mockResolvedValueOnce([]);
    mockTopupPacks.mockResolvedValueOnce({ realMoneyEnabled: false, currencyToggle: ["NGN", "USD"], packs: [], notice: "x" });
    render(
      <BankApp token="<redacted>" you={baseYou} sendAct={vi.fn()} onTopUp={() => {}} />
    );
    await waitFor(() => expect(screen.getByText("Èkó Reserve")).toBeTruthy());
    expect(screen.getByText("₦60,000")).toBeTruthy();
    expect(screen.getByText("₦12,000/wk")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pay now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Pay it all/ })).toBeTruthy();
  });

  it("rent debt banner shows when rent debt exists", async () => {
    const ov = overviewFixture();
    ov.housing.rentDebt = 90000;
    mockOverview.mockResolvedValueOnce(ov);
    mockTransactions.mockResolvedValueOnce([]);
    mockTopupPacks.mockResolvedValueOnce({ realMoneyEnabled: false, currencyToggle: ["NGN", "USD"], packs: [], notice: "x" });
    render(
      <BankApp token="<redacted>" you={baseYou} sendAct={vi.fn()} onTopUp={() => {}} />
    );
    await waitFor(() => expect(screen.getByText("Èkó Reserve")).toBeTruthy());
    expect(screen.getByText("₦90,000")).toBeTruthy();
    expect(screen.getByText("Pay debt")).toBeTruthy();
  });
});
