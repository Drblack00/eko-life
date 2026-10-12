// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  activitiesForLocation,
  activityCostLabel,
  parseVenueHash,
  venueTeaser,
} from "./venues";
import type { ApiLocation, VenueActivity } from "../lib/api";

/** Phase 5: pure client helpers for venue activities. */

const ACTS: VenueActivity[] = [
  {
    id: "a1", name: "Market thing", icon: "🍲", cost: 800,
    needs: { hunger: 10 }, blurb: "b", teaser: "🍲 Market thing", tags: ["market"],
  },
  {
    id: "a2", name: "Free market thing", icon: "🗣️", cost: 0,
    needs: { social: 5 }, blurb: "b", teaser: "🗣️ Free market thing", tags: ["market"],
  },
  {
    id: "a3", name: "Boat thing", icon: "⛴️", cost: 500,
    needs: { fun: 5 }, blurb: "b", teaser: "⛴️ Boat thing", tags: ["boat"],
  },
];

const marketLoc = { id: "m", name: "Market", tags: ["market"] } as ApiLocation;
const dualLoc = { id: "d", name: "Dual", tags: ["market", "boat"] } as ApiLocation;

describe("activitiesForLocation", () => {
  it("matches by tag and preserves order", () => {
    const out = activitiesForLocation(ACTS, marketLoc);
    expect(out.map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("unions multi-tag venues without duplicates", () => {
    const out = activitiesForLocation(ACTS, dualLoc);
    expect(out.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("returns [] for missing catalog, location, or no tag match", () => {
    expect(activitiesForLocation(undefined, marketLoc)).toEqual([]);
    expect(activitiesForLocation(ACTS, null)).toEqual([]);
    expect(
      activitiesForLocation(ACTS, { id: "x", name: "X", tags: ["club"] } as ApiLocation)
    ).toEqual([]);
  });
});

describe("venueTeaser", () => {
  it("returns the first activity's teaser", () => {
    expect(venueTeaser(ACTS, marketLoc)).toBe("🍲 Market thing");
  });

  it("returns null when nothing is offered", () => {
    expect(venueTeaser(ACTS, null)).toBeNull();
    expect(venueTeaser([], marketLoc)).toBeNull();
  });
});

describe("parseVenueHash", () => {
  it("parses #venue=<id>", () => {
    expect(parseVenueHash("#venue=tejuosho")).toBe("tejuosho");
  });

  it("decodes and rejects non-venue hashes", () => {
    expect(parseVenueHash("#venue=my%20place")).toBe("my place");
    expect(parseVenueHash("#map")).toBeNull();
    expect(parseVenueHash("")).toBeNull();
  });
});

describe("activityCostLabel", () => {
  it("labels free and paid costs", () => {
    expect(activityCostLabel(0)).toBe("Free");
    expect(activityCostLabel(2500)).toBe("₦2,500");
  });
});

describe("venueShareLink", () => {
  it("builds a same-origin #venue= link", async () => {
    vi.stubGlobal("location", {
      origin: "https://eko.example",
      pathname: "/",
    } as unknown as Location);
    const { venueShareLink } = await import("./venues");
    expect(venueShareLink("tejuosho")).toBe(
      "https://eko.example/#venue=tejuosho"
    );
    vi.unstubAllGlobals();
  });
});
