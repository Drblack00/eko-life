/**
 * Client unit tests — lib/api.ts response normalization
 * (leaderboard / news / presence pickers + pure catalog helpers).
 * Uses fetch mocks; no DOM, no network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  asList,
  priceOf,
  speedOf,
  travelFare,
} from "./api";

function jsonRes(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetch(...responses: Array<ReturnType<typeof jsonRes>>) {
  const fn = vi.fn();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("api.leaderboard — normalization", () => {
  it("normalizes money, drops invalid rows, caps at 10", async () => {
    const leaders = Array.from({ length: 12 }, (_, i) => ({
      username: `u${i}`,
      money: i === 5 ? "junk" : i === 7 ? -50 : i * 1000,
    }));
    leaders.push({ username: 42, money: 999 } as never); // bad row
    mockFetch(jsonRes({ leaders }));
    const out = await api.leaderboard("tok");
    expect(out).not.toBeNull();
    expect(out!.length).toBe(10);
    expect(out![0]).toEqual({ id: undefined, username: "u0", money: 0 });
    expect(out![5]).toEqual({ id: undefined, username: "u5", money: 0 }); // junk → 0
    expect(out![7]).toEqual({ id: undefined, username: "u7", money: 0 }); // negative → 0
    expect(out![3]).toEqual({ id: undefined, username: "u3", money: 3000 });
    expect(out!.every((l) => typeof l.username === "string")).toBe(true);
  });

  it("accepts keyed-object leaders and numeric ids", async () => {
    mockFetch(
      jsonRes({ leaders: { a: { id: 3, username: "alpha", money: 777 } } })
    );
    const out = await api.leaderboard("tok");
    expect(out).toEqual([{ id: 3, username: "alpha", money: 777 }]);
  });

  it("returns null for empty / missing leaders", async () => {
    mockFetch(jsonRes({ leaders: [] }));
    expect(await api.leaderboard("tok")).toBe(null);
    mockFetch(jsonRes({}));
    expect(await api.leaderboard("tok")).toBe(null);
    mockFetch(jsonRes(null));
    expect(await api.leaderboard("tok")).toBe(null);
  });

  it("falls back to the public endpoint when auth is rejected", async () => {
    const fetchMock = mockFetch(
      jsonRes({ error: "Forbidden" }, false, 403),
      jsonRes({ leaders: [{ username: "pub", money: 5 }] })
    );
    const out = await api.leaderboard("tok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out).toEqual([{ id: undefined, username: "pub", money: 5 }]);
  });

  it("returns null when both auth and public endpoints fail", async () => {
    mockFetch(
      jsonRes({ error: "Forbidden" }, false, 403),
      jsonRes({ error: "nope" }, false, 404)
    );
    expect(await api.leaderboard("tok")).toBe(null);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net down")));
    expect(await api.leaderboard("tok")).toBe(null);
  });
});

describe("api.news — normalization", () => {
  it("truncates long text, keeps ts only when numeric, drops bad rows", async () => {
    const long = "x".repeat(300);
    mockFetch(
      jsonRes({
        news: [
          { id: 1, text: long, ts: "not-a-number" },
          { text: "short", ts: 123456 },
          { note: "no text" },
        ],
      })
    );
    const out = await api.news();
    expect(out).not.toBeNull();
    expect(out!.length).toBe(2);
    expect(out![0].text.length).toBe(220);
    expect(out![0].ts).toBeUndefined();
    expect(out![1]).toEqual({ id: undefined, text: "short", ts: 123456 });
  });

  it("accepts keyed-object news and caps at 20", async () => {
    const news: Record<string, { text: string }> = {};
    for (let i = 0; i < 30; i++) news[`n${i}`] = { text: `item ${i}` };
    mockFetch(jsonRes({ news }));
    const out = await api.news();
    expect(out!.length).toBe(20);
  });

  it("returns null for empty news or network failure", async () => {
    mockFetch(jsonRes({ news: [] }));
    expect(await api.news()).toBe(null);
    mockFetch(jsonRes({}));
    expect(await api.news()).toBe(null);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net down")));
    expect(await api.news()).toBe(null);
  });
});

describe("api.presence — normalization", () => {
  it("drops invalid rows, clamps coords to 0..100, keeps avatars only when strings", async () => {
    mockFetch(
      jsonRes({
        presence: [
          { id: 1, username: "a", x: 10, y: 20, avatar: "🙂", color: "#fff" },
          { id: 2, username: "b", x: 150, y: -30 }, // clamped
          { id: 3, x: 5, y: 5 }, // no username → dropped
          { id: 4, username: "d", x: 5, y: NaN }, // non-finite → dropped
          { id: 5, username: "e", x: 5, y: 5, avatar: 123, color: 456 }, // bad strings
          { id: "6", username: "f", x: 5, y: 5 }, // id not a number → dropped
        ],
      })
    );
    const out = await api.presence();
    expect(out).not.toBeNull();
    expect(out!.length).toBe(3);
    expect(out![0]).toEqual({
      id: 1,
      username: "a",
      x: 10,
      y: 20,
      avatar: "🙂",
      color: "#fff",
    });
    expect(out![1].x).toBe(100);
    expect(out![1].y).toBe(0);
    expect(out![2]).toEqual({
      id: 5,
      username: "e",
      x: 5,
      y: 5,
      avatar: undefined,
      color: undefined,
    });
  });

  it("caps at 200 dots and returns null when nothing usable", async () => {
    const presence = Array.from({ length: 250 }, (_, i) => ({
      id: i,
      username: `p${i}`,
      x: i % 100,
      y: i % 100,
    }));
    mockFetch(jsonRes({ presence }));
    expect((await api.presence())!.length).toBe(200);
    mockFetch(jsonRes({ presence: [] }));
    expect(await api.presence()).toBe(null);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net down")));
    expect(await api.presence()).toBe(null);
  });
});

describe("asList", () => {
  it("passes arrays through, converts keyed objects, nulls to []", () => {
    expect(asList([1, 2])).toEqual([1, 2]);
    expect(asList({ a: 1, b: 2 })).toEqual([1, 2]);
    expect(asList(null)).toEqual([]);
    expect(asList(undefined)).toEqual([]);
  });
});

describe("priceOf / speedOf / travelFare", () => {
  it("priceOf tolerates price | cost and floors at 0", () => {
    expect(priceOf({ price: 500 })).toBe(500);
    expect(priceOf({ cost: 800 })).toBe(800);
    expect(priceOf({})).toBe(0);
    expect(priceOf({ price: -5 })).toBe(0);
  });

  it("speedOf tolerates speedMult | speed | mult, defaults to 1", () => {
    expect(speedOf({ speedMult: 2.2 })).toBe(2.2);
    expect(speedOf({ mult: 1.6 })).toBe(1.6);
    expect(speedOf({ speed: 3 })).toBe(3);
    expect(speedOf({})).toBe(1);
    expect(speedOf({ speedMult: 0 })).toBe(1);
    expect(speedOf({ speedMult: NaN })).toBe(1);
  });

  it("travelFare mirrors the server fare rules (display only)", () => {
    const mainland = { id: "m1", name: "M", region: "mainland" } as never;
    const mainland2 = { id: "m2", name: "M2", region: "mainland" } as never;
    const island = { id: "i1", name: "I", region: "island" } as never;
    const lagoon = { id: "l1", name: "L", region: "lagoon" } as never;
    const fares = { sameRegion: 0, crossRegion: 200, boat: 500 };
    expect(travelFare(mainland, mainland, fares)).toBe(0); // same id
    expect(travelFare(mainland, mainland2, fares)).toBe(0); // same region
    expect(travelFare(mainland, island, fares)).toBe(200); // cross region
    expect(travelFare(mainland, lagoon, fares)).toBe(500); // lagoon leg → boat
    expect(travelFare(null, island, fares)).toBe(200); // missing → cross default
    expect(travelFare(mainland, island)).toBe(200); // no fares → server defaults
  });
});
