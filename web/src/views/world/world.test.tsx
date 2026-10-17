// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { countdown } from "./worldShared";
import { RideView } from "./RideView";
import { HealthView } from "./HealthView";

afterEach(() => cleanup());

const { mockRideState, mockHealth } = vi.hoisted(() => ({
  mockRideState: vi.fn(),
  mockHealth: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...orig,
    worldApi: {
      rideState: mockRideState,
      rideTravel: vi.fn(),
      health: mockHealth,
      treat: vi.fn(),
    },
  };
});

vi.mock("../../components/Button", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("../../components/Loading", () => ({
  Loading: () => <div>Loading…</div>,
}));

describe("countdown", () => {
  it("formats days/hours/minutes", () => {
    expect(countdown(9 * 86400000 + 4 * 3600000 + 12 * 60000)).toBe("9d 4h 12m");
    expect(countdown(2 * 3600000 + 30 * 60000)).toBe("2h 30m");
    expect(countdown(5 * 60000)).toBe("5m");
    expect(countdown(-100)).toBe("0m");
  });
});

describe("RideView", () => {
  it("renders fare table with rush banner and destinations", async () => {
    mockRideState.mockResolvedValue({
      rush: true,
      rushNote: "Rush hour — fares ×1.5.",
      modes: [
        { id: "trek", name: "Trek", icon: "🚶", blurb: "Legs are free.", fare: 0, minSec: 5, maxSec: 8 },
        { id: "keke", name: "Keke", icon: "🛺", blurb: "Three wheels.", fare: 250, minSec: 6, maxSec: 10 },
      ],
      dests: [{ id: "ikeja_mall", name: "Ikeja City Mall", icon: "🏬" }],
      locationId: "ojuelegba",
    });
    render(<RideView token="t" />);
    await waitFor(() => expect(screen.getByText("🛵 Waka Ride")).toBeTruthy());
    expect(screen.getAllByText(/Rush hour/).length).toBeGreaterThan(0);
    expect(screen.getByText("FREE")).toBeTruthy();
    expect(screen.getByText(/Ikeja City Mall/)).toBeTruthy();
  });
});

describe("HealthView", () => {
  it("shows illness with decay multiplier and providers", async () => {
    mockHealth.mockResolvedValue({
      illness: {
        id: "eko_fever",
        name: "Eko Fever",
        icon: "🤒",
        desc: "Classic.",
        until: Date.now() + 3600000,
        msLeft: 3600000,
      },
      decayMult: 1.6,
      chemistFee: 1500,
      hospitalFee: 8000,
      providers: [
        { id: "chemist", name: "Chemist", icon: "💊", fee: 1500, note: "Quick drugs." },
        { id: "hospital", name: "General Hospital", icon: "🏥", fee: 8000, note: "Cures all." },
      ],
    });
    render(<HealthView token="t" />);
    await waitFor(() => expect(screen.getByText("🏥 Clinic")).toBeTruthy());
    expect(screen.getByText("Eko Fever")).toBeTruthy();
    expect(screen.getByText(/×1\.6/)).toBeTruthy();
    expect(screen.getAllByText("Get treated").length).toBe(2);
  });

  it("shows the healthy state when no illness", async () => {
    mockHealth.mockResolvedValue({
      illness: null,
      decayMult: 1,
      chemistFee: 1500,
      hospitalFee: 8000,
      providers: [],
    });
    render(<HealthView token="t" />);
    await waitFor(() => expect(screen.getByText(/You feel fine/)).toBeTruthy());
  });
});
