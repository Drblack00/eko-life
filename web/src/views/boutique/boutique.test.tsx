// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BoutiqueApp } from "./BoutiqueApp";
import type { You } from "../../game/types";

afterEach(() => cleanup());

/**
 * Phase 6 — Boutique: shop rendering, occasion filter, buy/wear flows
 * with a mocked API. The 3D try-on preview is stubbed (WebGL is
 * unavailable in jsdom); renderer coverage lives in the studio tests.
 * REST behavior is covered by server/tests/boutique.test.js.
 */

const { mockCatalog, mockBuy } = vi.hoisted(() => ({
  mockCatalog: vi.fn(),
  mockBuy: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...orig,
    boutiqueApi: {
      catalog: mockCatalog,
      buy: mockBuy,
    },
  };
});

vi.mock("../avatar/editor/StudioPreview", () => ({
  StudioPreview: () => <div data-testid="tryon-stub" />,
}));

vi.mock("../avatar/avatarModel", () => ({
  buildAvatarLook: () => ({ group: {}, update: undefined }),
}));

vi.mock("../../avatar/persistence", () => ({
  fetchAppearance: vi.fn(async () => ({
    appearance: { clothing: {} },
    revision: 3,
  })),
  saveAppearance: vi.fn(async () => ({})),
  AppearanceValidationError: class extends Error {},
}));

const ITEMS = [
  { id: "bq_dashiki", outfitId: "dashiki", name: "Dashiki Royale", price: 45000, occasion: "traditional", blurb: "Heritage.", owned: false },
  { id: "bq_tuxedo", outfitId: "tuxedo", name: "Black Tie Tuxedo", price: 550000, occasion: "office", blurb: "Sharp.", owned: true },
  { id: "bq_streetwear", outfitId: "streetwear", name: "Streetwear Drop", price: 60000, occasion: "street", blurb: "Fresh.", owned: false },
];

const YOU = {
  character_id: 7,
  money: 100000,
  avatar_look: null,
} as unknown as You;

beforeEach(() => {
  vi.clearAllMocks();
  mockCatalog.mockResolvedValue({ items: ITEMS, balance: 100000 });
});

describe("BoutiqueApp shop", () => {
  it("renders the item grid with prices and owned flags", async () => {
    render(<BoutiqueApp token="t" you={YOU} />);
    expect(await screen.findByText("Dashiki Royale")).toBeTruthy();
    expect(screen.getByText("₦45,000")).toBeTruthy();
    expect(screen.getByText("Owned ✓")).toBeTruthy();
  });

  it("filters by occasion chips", async () => {
    render(<BoutiqueApp token="t" you={YOU} />);
    await screen.findByText("Dashiki Royale");
    fireEvent.click(screen.getByText("Office"));
    expect(screen.queryByText("Dashiki Royale")).toBeNull();
    expect(screen.getByText("Black Tie Tuxedo")).toBeTruthy();
    fireEvent.click(screen.getByText("All"));
    expect(screen.getByText("Dashiki Royale")).toBeTruthy();
  });

  it("buy flow marks the item owned and updates the balance", async () => {
    mockBuy.mockResolvedValue({
      item: { ...ITEMS[0], owned: true },
      balance: 55000,
    });
    render(<BoutiqueApp token="t" you={YOU} />);
    await screen.findByText("Dashiki Royale");
    fireEvent.click(screen.getByText("Dashiki Royale"));
    const buyBtn = await screen.findByText("Buy · ₦45,000");
    fireEvent.click(buyBtn);
    await waitFor(() => expect(mockBuy).toHaveBeenCalledWith("t", "bq_dashiki"));
    expect(await screen.findByText(/is yours/)).toBeTruthy();
  });

  it("unaffordable items show how much more is needed", async () => {
    mockCatalog.mockResolvedValue({ items: ITEMS, balance: 1000 });
    render(<BoutiqueApp token="t" you={YOU} />);
    await screen.findByText("Dashiki Royale");
    fireEvent.click(screen.getByText("Dashiki Royale"));
    expect(await screen.findByText("Need ₦44,000 more")).toBeTruthy();
  });

  it("wardrobe tab lists owned items with Wear buttons", async () => {
    render(<BoutiqueApp token="t" you={YOU} />);
    await screen.findByText("Dashiki Royale");
    fireEvent.click(screen.getByText("My wardrobe (1)"));
    expect(screen.getByText("Black Tie Tuxedo")).toBeTruthy();
    expect(screen.getByText("Wear")).toBeTruthy();
    expect(screen.queryByText("Dashiki Royale")).toBeNull();
  });
});
