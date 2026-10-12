// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { formatTimeAgo, badgeClass, GistApp } from "./GistApp";
import { GIST_MAX } from "../../lib/api";
import type { You } from "../../game/types";

afterEach(() => cleanup());

/**
 * Phase 3 — Gist: pure-helper unit tests + a News-tab render test with a
 * mocked API. (REST endpoint behavior is covered by
 * server/tests/gists.test.js; live proof comes from the Playwright run.)
 */

const { mockGistsList, mockHeadlinesList } = vi.hoisted(() => ({
  mockGistsList: vi.fn(),
  mockHeadlinesList: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...orig,
    gistsApi: {
      list: mockGistsList,
      create: vi.fn(),
      like: vi.fn(),
      unlike: vi.fn(),
      remove: vi.fn(),
      comments: vi.fn(),
      addComment: vi.fn(),
      report: vi.fn(),
    },
    headlinesApi: {
      list: mockHeadlinesList,
      refresh: vi.fn(),
    },
  };
});

const you = {
  id: 1,
  username: "tester",
  name: "Tester",
  class: "street_smart",
  avatar: "🧑",
  color: "#22d3ee",
  money: 5000,
  energy: 100,
  health: 100,
  happiness: 60,
  hunger: 100,
  housing: "face-me",
  property: null,
  vehicle: null,
  savings: 0,
  loan: 0,
  cert: 0,
  locationId: "ojuelegba",
  lat: 0,
  lng: 0,
  is_admin: false,
  guest: false,
} as You;

describe("formatTimeAgo", () => {
  it("handles the recent ladder", () => {
    const now = Date.now();
    expect(formatTimeAgo(now - 10_000)).toBe("just now");
    expect(formatTimeAgo(now - 5 * 60_000)).toBe("5m ago");
    expect(formatTimeAgo(now - 2 * 3600_000)).toBe("2h ago");
    expect(formatTimeAgo(now - 3 * 86400_000)).toBe("3d ago");
  });
  it("handles unknown timestamps", () => {
    expect(formatTimeAgo(null)).toBe("a while ago");
    expect(formatTimeAgo(undefined)).toBe("a while ago");
  });
});

describe("badgeClass", () => {
  it("maps every server badge tier to a CSS modifier", () => {
    expect(badgeClass("New Kid")).toBe("eko-gist__badge--newkid");
    expect(badgeClass("Hustler")).toBe("eko-gist__badge--hustler");
    expect(badgeClass("Veteran")).toBe("eko-gist__badge--veteran");
    expect(badgeClass("Legend")).toBe("eko-gist__badge--legend");
    expect(badgeClass("Odogwu")).toBe("eko-gist__badge--odogwu");
  });
  it("falls back safely on unknown input", () => {
    expect(badgeClass("")).toBe("eko-gist__badge--newkid");
  });
});

describe("composer limit", () => {
  it("uses the 280-char contract shared with the server", () => {
    expect(GIST_MAX).toBe(280);
  });
});

describe("prettifyId", () => {
  it("turns raw housing ids into readable labels", async () => {
    const { prettifyId } = await import("./GistApp");
    expect(prettifyId("face-me")).toBe("Face Me");
    expect(prettifyId("face_me")).toBe("Face Me");
    expect(prettifyId("selfcon")).toBe("Selfcon");
  });
});

describe("News tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGistsList.mockResolvedValue({ gists: [], next_cursor: null, tab: "latest" });
    mockHeadlinesList.mockResolvedValue({
      items: [
        {
          id: 1,
          source: "Vanguard",
          title: "Lagos Assembly passes new bill",
          link: "https://www.vanguardngr.com/test-story/",
          snippet: "Lawmakers voted unanimously after a heated debate.",
          published_at: Date.now() - 600_000,
          fetched_at: Date.now(),
        },
        {
          id: 2,
          source: "Punch",
          title: "Super Eagles name squad",
          link: "https://punchng.com/test-squad/",
          snippet: "",
          published_at: Date.now() - 3_600_000,
          fetched_at: Date.now(),
        },
      ],
      next_cursor: null,
      stale: false,
      updated_minutes_ago: 4,
    });
  });

  it("renders headline cards from the mocked response", async () => {
    render(<GistApp token="t" you={you} config={null} />);
    fireEvent.click(screen.getByRole("button", { name: /News/ }));
    await waitFor(() => {
      expect(screen.getByText("Lagos Assembly passes new bill")).toBeTruthy();
    });
    expect(screen.getByText("Vanguard")).toBeTruthy();
    expect(screen.getByText("Punch")).toBeTruthy();
    expect(
      screen.getByText("Lawmakers voted unanimously after a heated debate.")
    ).toBeTruthy();
    expect(screen.getByText(/Updated 4 min ago/)).toBeTruthy();
  });

  it("tapping a card links out to the article URL in a new tab", async () => {
    render(<GistApp token="t" you={you} config={null} />);
    fireEvent.click(screen.getByRole("button", { name: /News/ }));
    const link = await screen.findByRole("link", {
      name: /Lagos Assembly passes new bill/,
    });
    expect(link.getAttribute("href")).toBe("https://www.vanguardngr.com/test-story/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("shows the empty state when there are no headlines", async () => {
    mockHeadlinesList.mockResolvedValue({
      items: [],
      next_cursor: null,
      stale: false,
      updated_minutes_ago: null,
    });
    render(<GistApp token="t" you={you} config={null} />);
    fireEvent.click(screen.getByRole("button", { name: /News/ }));
    await waitFor(() => {
      expect(screen.getByText(/No gists yet — post the first one|Couldn't load headlines/)).toBeTruthy();
    });
  });

  it("shows the retry state when the fetch fails", async () => {
    const { ApiError } = await import("../../lib/api");
    mockHeadlinesList.mockRejectedValue(new ApiError(500, "boom"));
    render(<GistApp token="t" you={you} config={null} />);
    fireEvent.click(screen.getByRole("button", { name: /News/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });
  });
});

describe("Gist feed empty state", () => {
  it("renders the first-post prompt on an empty Latest tab", async () => {
    mockGistsList.mockResolvedValue({ gists: [], next_cursor: null, tab: "latest" });
    render(<GistApp token="t" you={you} config={null} />);
    await waitFor(() => {
      expect(screen.getByText("No gists yet — post the first one.")).toBeTruthy();
    });
  });
});

describe("News tab visibility on phones", () => {
  it("fits all 5 tabs without horizontal scrolling (flex shrink, no overflow-x)", () => {
    const raw = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "GistApp.css"),
      "utf8",
    );
    const tabRule = raw.match(/\.eko-gist__tab\s*\{([^}]*)\}/s);
    expect(tabRule).not.toBeNull();
    expect(tabRule![1]).toMatch(/flex:\s*1 1 0/);
    expect(tabRule![1]).toMatch(/min-width:\s*0/);
    const tabsRule = raw.match(/\.eko-gist__tabs\s*\{([^}]*)\}/s);
    expect(tabsRule).not.toBeNull();
    expect(tabsRule![1]).not.toMatch(/overflow-x:\s*auto/);
    // Labels are ellipsis-safe so long tab names shrink instead of pushing.
    expect(raw).toMatch(/\.eko-gist__tab-label\s*\{[^}]*text-overflow:\s*ellipsis/);
    // On narrow phones the decorative emoji hides so labels get full width.
    expect(raw).toMatch(/\.eko-gist__tab-icon\s*\{\s*display:\s*none/);
  });

  it("renders all 5 tab buttons including News", () => {
    render(<GistApp token="t" you={you} config={null} />);
    const nav = screen.getByRole("navigation", { name: /Gist feed tabs/ });
    const buttons = nav.querySelectorAll("button");
    expect(buttons).toHaveLength(5);
    for (const name of ["Latest", "Trending", "Following", "Me", "News"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("Retry re-runs the headlines load and shows fresh headlines", async () => {
    const { ApiError } = await import("../../lib/api");
    mockHeadlinesList.mockRejectedValueOnce(new ApiError(500, "boom"));
    mockHeadlinesList.mockResolvedValueOnce({
      items: [
        {
          id: 9,
          source: "Vanguard",
          title: "Retry brought the news back",
          link: "https://www.vanguardngr.com/retry/",
          snippet: "",
          published_at: Date.now() - 600_000,
          fetched_at: Date.now(),
        },
      ],
      next_cursor: null,
      stale: false,
      updated_minutes_ago: 0,
    });
    render(<GistApp token="t" you={you} config={null} />);
    fireEvent.click(screen.getByRole("button", { name: /News/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(screen.getByText("Retry brought the news back")).toBeTruthy();
    });
    expect(mockHeadlinesList).toHaveBeenCalledTimes(2);
  });
});
