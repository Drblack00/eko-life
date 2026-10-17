// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { HustleApp } from "./HustleApp";
import { hustleApi } from "../../lib/api";

vi.mock("../../lib/api", () => ({ hustleApi: {} }));

const meta: any = {
  categories: [
    { key: "decorator", name: "Decorator", icon: "🛋️", blurb: "" },
    { key: "cook", name: "Cook", icon: "🍲", blurb: "" },
  ],
  startOptions: [
    { key: "now", name: "Right now", blurb: "" },
    { key: "tomorrow", name: "Tomorrow", blurb: "" },
  ],
  minFee: 1000,
  copy: {
    escrow: "The fee is held safe until the job is done.",
    noPay: "Nothing is paid until you hire someone.",
    safety: "Never share your password — hire through jobs.",
    decorator: "Decorators work on a copy of your home from anywhere, even when you are offline.",
  },
  me: { isPro: false, stars: 0, jobsDone: 0, openGigs: 1, workingGigs: 0 },
};

const gig: any = {
  id: 3,
  category: { key: "decorator", name: "Decorator", icon: "🛋️" },
  title: "Freshen up my sitting room",
  details: "Rearrange + new curtains vibe",
  fee: 5000,
  materialsBudget: 0,
  startOption: "Tomorrow",
  startKey: "tomorrow",
  status: "open",
  escrowed: false,
  clientUsername: "client1",
  proUsername: null,
  rating: null,
  createdAt: Date.now(),
  hiredAt: null,
  doneAt: null,
};

const pro: any = {
  userId: 42,
  username: "pro1",
  categories: [{ key: "decorator", name: "Decorator", icon: "🛋️" }],
  rateFrom: 2000,
  tagline: "I turn rooms around fast.",
  services: ["Full room refresh"],
  stars: 4.5,
  jobsDone: 12,
  ratingsCount: 10,
};

function mockAll(over: Record<string, any> = {}) {
  const api = hustleApi as any;
  api.meta = vi.fn().mockResolvedValue(meta);
  api.gigs = vi.fn().mockResolvedValue({ gigs: [gig] });
  api.pros = vi.fn().mockResolvedValue({ pros: [pro] });
  api.myjobs = vi.fn().mockResolvedValue({ posted: [gig], working: [] });
  api.post = vi.fn();
  api.hire = vi.fn();
  api.done = vi.fn();
  api.cancel = vi.fn();
  api.listMe = vi.fn();
  api.unlist = vi.fn();
  api.book = vi.fn();
  api.reportGig = vi.fn();
  Object.assign(api, over);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("HustleApp", () => {
  it("renders the escrow promise and the gig board", async () => {
    mockAll();
    render(<HustleApp token="t" />);
    expect(await screen.findByText("The fee is held safe until the job is done.")).toBeTruthy();
    // Title renders with its category icon: "🛋️ Freshen up my sitting room".
    expect(await screen.findByText(/Freshen up my sitting room/)).toBeTruthy();
    expect(await screen.findByText("₦5,000")).toBeTruthy();
  });

  it("shows the safety copy on the board", async () => {
    mockAll();
    render(<HustleApp token="t" />);
    expect(await screen.findByText("Never share your password — hire through jobs.")).toBeTruthy();
  });

  it("find-a-pro renders pro cards with stars, jobs done, from-rate and Book/Chat", async () => {
    mockAll();
    render(<HustleApp token="t" />);
    fireEvent.click(await screen.findByText("🙋🏾 Find a pro"));
    expect(await screen.findByText("@pro1")).toBeTruthy();
    expect(screen.getByText(/12 jobs done/)).toBeTruthy();
    expect(screen.getByText(/from ₦2,000/)).toBeTruthy();
    expect(screen.getByText("🧰 Book")).toBeTruthy();
    expect(screen.getByText("💬 Chat")).toBeTruthy();
  });

  it("post-a-job shows the decorator copy and the no-pay promise", async () => {
    mockAll();
    render(<HustleApp token="t" />);
    fireEvent.click(await screen.findByText("➕ Post a job"));
    expect(
      await screen.findByText(/Decorators work on a copy of your home/)
    ).toBeTruthy();
    expect(screen.getByText(/Nothing is paid until you hire someone/)).toBeTruthy();
  });

  it("post-a-job validation errors surface as a toast", async () => {
    mockAll({ post: vi.fn().mockRejectedValue(new Error("Fee must be at least ₦1,000.")) });
    render(<HustleApp token="t" />);
    fireEvent.click(await screen.findByText("➕ Post a job"));
    fireEvent.change(await screen.findByPlaceholderText("e.g. Freshen up my sitting room"), {
      target: { value: "Test job" },
    });
    fireEvent.click(screen.getByText("📋 Post the job"));
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/₦1,000/);
  });

  it("my jobs shows posted gigs with hire/cancel actions", async () => {
    mockAll();
    render(<HustleApp token="t" />);
    fireEvent.click(await screen.findByText("📁 My jobs"));
    expect(await screen.findByText("🤝 Hire someone")).toBeTruthy();
    expect(await screen.findByText("Jobs I posted")).toBeTruthy();
  });

  it("hired gigs show the escrow-held badge and release flow", async () => {
    const hired = { ...gig, status: "hired", escrowed: true, proUsername: "pro1" };
    mockAll({ myjobs: vi.fn().mockResolvedValue({ posted: [hired], working: [] }) });
    render(<HustleApp token="t" />);
    fireEvent.click(await screen.findByText("📁 My jobs"));
    expect(await screen.findByText("🔒 Fee held in escrow")).toBeTruthy();
    expect(screen.getByText(/Mark done — release ₦5,000/)).toBeTruthy();
  });
});
