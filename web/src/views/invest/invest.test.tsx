// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { InvestApp } from "./InvestApp";

afterEach(() => cleanup());

/**
 * PORT-P2 — Invest app: render + buy/collect/sell flows with a mocked API.
 * (REST/settlement behavior is covered by server/tests/invest.test.js.)
 */

const { mockOverview, mockBuy, mockCollect, mockSell } = vi.hoisted(() => ({
  mockOverview: vi.fn(),
  mockBuy: vi.fn(),
  mockCollect: vi.fn(),
  mockSell: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...orig,
    investApi: {
      overview: mockOverview,
      buy: mockBuy,
      collect: mockCollect,
      sell: mockSell,
    },
  };
});

function overviewFixture() {
  return {
    balance: 5000000,
    holdings: [
      {
        id: 7,
        kind: "business",
        def_id: "kiosk",
        principal: 150000,
        accrued: 3600,
        last_yield_day: 3,
        name: "Provision Kiosk",
        icon: "🏪",
        price: 150000,
        value: 153600,
      },
    ],
    totalValue: 153600,
    totalAccrued: 3600,
    defs: {
      land: [
        { id: "plot_ikorodu", name: "Plot · Ikorodu", icon: "🟫", price: 250000, weeklyYield: 0.019 },
      ],
      business: [
        { id: "kiosk", name: "Provision Kiosk", icon: "🏪", price: 150000, dailyYield: 0.012 },
      ],
      haulage: [
        { id: "truck", name: "Haulage Truck", icon: "🚚", price: 18000000, weeklyIncome: 900000 },
      ],
    },
    day: 5,
    isAdmin: false,
  };
}

const you = { money: 5000000, is_admin: false };

describe("InvestApp render", () => {
  it("shows holdings with collect/sell and the buy catalogue", async () => {
    mockOverview.mockResolvedValueOnce(overviewFixture());
    render(<InvestApp token="<redacted>" you={you} />);
    await waitFor(() => expect(screen.getByText("Invest")).toBeTruthy());
    expect(screen.getByText("₦5,000,000")).toBeTruthy();
    expect(screen.getByText("+₦3,600")).toBeTruthy();
    expect(screen.getByText(/Provision Kiosk/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collect" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sell" })).toBeTruthy();
    // land tab is default; switch to business to see the kiosk listing
    fireEvent.click(screen.getByRole("button", { name: /Business/ }));
    expect(screen.getByText(/1.2%\/day/)).toBeTruthy();
  });

  it("collect moves accrued yield (mocked)", async () => {
    mockOverview.mockResolvedValueOnce(overviewFixture());
    mockCollect.mockResolvedValueOnce({ collected: 3600, holding: {}, balance: 5003600 });
    render(<InvestApp token="<redacted>" you={you} />);
    await waitFor(() => expect(screen.getByText("Invest")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Collect" }));
    await waitFor(() => expect(mockCollect).toHaveBeenCalledWith("<redacted>", 7));
    expect(await screen.findByText(/Collected ₦3,600/)).toBeTruthy();
  });

  it("buy calls the API with kind + defId (mocked)", async () => {
    mockOverview.mockResolvedValueOnce(overviewFixture());
    mockBuy.mockResolvedValueOnce({ holding: {}, balance: 4750000 });
    render(<InvestApp token="<redacted>" you={{ money: 50000000, is_admin: false }} />);
    await waitFor(() => expect(screen.getByText("Invest")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Haulage/ }));
    const buyButtons = screen.getAllByRole("button", { name: "Buy" });
    fireEvent.click(buyButtons[0]);
    await waitFor(() => expect(mockBuy).toHaveBeenCalledWith("<redacted>", "haulage", "truck"));
  });

  it("unaffordable assets have disabled Buy buttons", async () => {
    mockOverview.mockResolvedValueOnce(overviewFixture());
    render(<InvestApp token="<redacted>" you={{ money: 1000, is_admin: false }} />);
    await waitFor(() => expect(screen.getByText("Invest")).toBeTruthy());
    // land tab: plot costs ₦250k > ₦1k wallet
    const buyButtons = screen.getAllByRole("button", { name: "Buy" });
    buyButtons.forEach((b) => expect((b as HTMLButtonElement).disabled).toBe(true));
  });
});
