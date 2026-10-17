// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MyCareer } from "./MyCareer";
import { CareersBrowser } from "./CareersBrowser";
import type { CareerListing, CareerStatus } from "./api";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const STATUS: CareerStatus = {
  employed: true,
  careerId: "software",
  careerName: "Software Engineering",
  careerIcon: "💻",
  rank: 2,
  rankOf: 5,
  rankTitle: "Junior Developer",
  payPerShift: 10933,
  energyCost: 30,
  performance: 85,
  shiftsAtRank: 2,
  shiftsNeeded: 4,
  promotionReady: false,
  nextRank: { title: "Mid-Level Engineer", payPerShift: 12067, shiftsNeeded: 4 },
  ladder: [
    { title: "Code Intern", payPerShift: 9800, minShifts: 3, current: false },
    { title: "Junior Developer", payPerShift: 10933, minShifts: 4, current: true },
    { title: "Mid-Level Engineer", payPerShift: 12067, minShifts: 5, current: false },
    { title: "Senior Engineer", payPerShift: 13200, minShifts: 6, current: false },
    { title: "Engineering Lead", payPerShift: 14200, minShifts: 6, current: false },
  ],
  schedule: "Mon–Fri · 9:00–17:00",
  scheduleStrip: [
    { day: "Mon", work: true }, { day: "Tue", work: true }, { day: "Wed", work: true },
    { day: "Thu", work: true }, { day: "Fri", work: true }, { day: "Sat", work: false },
    { day: "Sun", work: false },
  ],
  dayOffToday: false,
  autoStart: true,
  onShift: true,
  shiftEndsAt: Date.now() + 30 * 60 * 1000,
  shiftRoleId: "p3_software_r1",
  pendingEvent: null,
};

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => handler(url, init),
    })),
  );
}

describe("MyCareer", () => {
  it("renders the current career, rank, pay and ladder", async () => {
    mockFetch((url) => (url.includes("/api/careers/me") ? STATUS : {}));
    render(<MyCareer token="t" send={() => {}} />);
    await waitFor(() => expect(screen.getByText("Software Engineering")).toBeTruthy());
    expect(screen.getByText(/Junior Developer · Rank 2 of 5/)).toBeTruthy();
    expect(screen.getByText("₦10,933/shift")).toBeTruthy();
    expect(screen.getByText("85%")).toBeTruthy();
    expect(screen.getByText("Mid-Level Engineer")).toBeTruthy();
    expect(screen.getByText("2/4")).toBeTruthy();
  });

  it("shows the Promote button only when promotionReady", async () => {
    mockFetch((url) =>
      url.includes("/api/careers/me") ? { ...STATUS, promotionReady: true } : {},
    );
    render(<MyCareer token="t" send={() => {}} />);
    await waitFor(() => expect(screen.getByText("Promote")).toBeTruthy());
  });

  it("renders the pending work event with choice buttons (no payoffs shown)", async () => {
    const withEvent: CareerStatus = {
      ...STATUS,
      pendingEvent: {
        id: "gen_outage_123",
        title: "NEPA took light!",
        flavor: "The mains just died.",
        choices: [
          { id: "gen_fix", label: "Kick-start the generator yourself" },
          { id: "gen_panic", label: "Complain loudly about PHCN" },
        ],
        expiresAt: Date.now() + 240000,
      },
    };
    const calls: string[] = [];
    mockFetch((url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return url.includes("/api/careers/me") ? withEvent : { ok: true };
    });
    render(<MyCareer token="t" send={() => {}} />);
    await waitFor(() => expect(screen.getByText("NEPA took light!")).toBeTruthy());
    // the server never ships deltas — the UI must not render them either
    expect(screen.queryByText(/\+15/)).toBeNull();
    fireEvent.click(screen.getByText("Kick-start the generator yourself"));
    await waitFor(() =>
      expect(calls.some((c) => c.includes("POST /api/careers/respond"))).toBe(true),
    );
  });

  it("shows the unemployed empty state with a browse CTA", async () => {
    mockFetch((url) => (url.includes("/api/careers/me") ? { employed: false } : {}));
    const onBrowse = vi.fn();
    render(<MyCareer token="t" send={() => {}} onBrowse={onBrowse} />);
    await waitFor(() => expect(screen.getByText("No career yet")).toBeTruthy());
    fireEvent.click(screen.getByText("Browse careers"));
    expect(onBrowse).toHaveBeenCalled();
  });

  it("clock-in sends shift_start for the current rank role", async () => {
    mockFetch((url) => (url.includes("/api/careers/me") ? { ...STATUS, onShift: false } : {}));
    const send = vi.fn();
    render(<MyCareer token="t" send={send} />);
    await waitFor(() => expect(screen.getByText(/Clock in/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Clock in/));
    expect(send).toHaveBeenCalledWith({ t: "act", a: "shift_start", job: "p3_software_r1" });
  });
});

const LISTING: CareerListing = {
  id: "software",
  name: "Software Engineering",
  icon: "💻",
  blurb: "Ship code from a Yaba tech hub.",
  path: "tech",
  energyCost: 30,
  workplaceId: "sangotedo_tech",
  certRequired: false,
  skillLock: { skill: "coding", level: 2 },
  schedule: "Mon–Fri · 9:00–17:00",
  scheduleStrip: [],
  payBand: [9800, 14200],
  ranks: [
    { title: "Code Intern", payPerShift: 9800, minShifts: 3 },
    { title: "Junior Developer", payPerShift: 10933, minShifts: 4 },
    { title: "Mid-Level Engineer", payPerShift: 12067, minShifts: 5 },
    { title: "Senior Engineer", payPerShift: 13200, minShifts: 6 },
    { title: "Engineering Lead", payPerShift: 14200, minShifts: 6 },
  ],
};

describe("CareersBrowser", () => {
  it("lists careers with pay band, schedule and skill locks", async () => {
    mockFetch((url) => (url.includes("/api/careers") ? { careers: [LISTING] } : {}));
    render(<CareersBrowser token="t" skills={{ coding: 2 }} />);
    await waitFor(() => expect(screen.getByText("Software Engineering")).toBeTruthy());
    expect(screen.getByText("₦9,800–₦14,200/shift")).toBeTruthy();
    expect(screen.getByText(/coding Lv 2 ✓/)).toBeTruthy();
    expect(screen.getByText("Apply")).toBeTruthy();
  });

  it("locks careers the viewer does not qualify for", async () => {
    mockFetch((url) => (url.includes("/api/careers") ? { careers: [LISTING] } : {}));
    render(<CareersBrowser token="t" skills={{ coding: 0 }} />);
    await waitFor(() => expect(screen.getByText(/coding Lv 2 needed/)).toBeTruthy());
    expect(screen.getByText(/🔒/).textContent).toMatch(/coding Lv 2 needed/);
  });

  it("filters by search query", async () => {
    const nurse: CareerListing = {
      ...LISTING,
      id: "nursing",
      name: "Nursing",
      skillLock: { skill: "fitness", level: 2 },
    };
    mockFetch((url) => (url.includes("/api/careers") ? { careers: [LISTING, nurse] } : {}));
    render(<CareersBrowser token="t" skills={{ coding: 2, fitness: 2 }} />);
    await waitFor(() => expect(screen.getByText("Software Engineering")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Search careers"), { target: { value: "nurs" } });
    await waitFor(() => expect(screen.queryByText("Software Engineering")).toBeNull());
    expect(screen.getByText("Nursing")).toBeTruthy();
  });
});
