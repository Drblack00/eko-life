/**
 * Client unit tests — game/types.ts pure helpers (naira + display parsers).
 * Display-only: none of these may compute or trust money.
 */
import { describe, expect, it } from "vitest";
import {
  furnitureItemId,
  furnitureKey,
  naira,
  normalizeNotification,
  notificationIcon,
  refId,
  refName,
  spawnEmoji,
  spawnLabel,
  spawnMapXY,
} from "./types";

describe("naira()", () => {
  it("formats integer naira with ₦ and grouping", () => {
    expect(naira(1234567)).toBe("₦1,234,567");
    expect(naira(50000)).toBe("₦50,000");
    expect(naira(0)).toBe("₦0");
  });

  it("floors negatives to zero and rounds", () => {
    expect(naira(-99)).toBe("₦0");
    expect(naira(99.6)).toBe("₦100");
  });

  it("treats NaN / junk as zero (never shows garbage)", () => {
    expect(naira(NaN)).toBe("₦0");
    expect(naira(Number("abc"))).toBe("₦0");
  });
});

describe("refName / refId (NamedRef defensive parsing)", () => {
  it("string refs pass through", () => {
    expect(refName("selfcon")).toBe("selfcon");
    expect(refId("selfcon")).toBe("selfcon");
  });

  it("object refs prefer name, then id", () => {
    expect(refName({ id: "b1", name: "Bungalow" })).toBe("Bungalow");
    expect(refName({ id: "b1" })).toBe("b1");
    expect(refId({ id: "b1", name: "Bungalow" })).toBe("b1");
  });

  it("null / empty / missing fall back defensively", () => {
    expect(refName(null)).toBe("—");
    expect(refName(undefined, "n/a")).toBe("n/a");
    expect(refName("")).toBe("—");
    expect(refId(null)).toBe(null);
    expect(refId(undefined)).toBe(null);
    expect(refId({ name: "NoId" })).toBe(null);
  });
});

describe("spawn helpers", () => {
  it("spawnMapXY prefers x/y, falls back to lng/lat", () => {
    expect(spawnMapXY({ id: 1, x: 10, y: 20 })).toEqual({ mx: 10, my: 20 });
    expect(spawnMapXY({ id: 1, lng: 30, lat: 40 })).toEqual({ mx: 30, my: 40 });
    expect(spawnMapXY({ id: 1 })).toBe(null);
    expect(spawnMapXY({ id: 1, x: NaN, y: 5 })).toBe(null);
  });

  it("spawnEmoji prefers server icon, then kind matching", () => {
    expect(spawnEmoji({ id: 1, icon: "🧁" })).toBe("🧁");
    expect(spawnEmoji({ id: 1, kind: "snack" })).toBe("💵");
    expect(spawnEmoji({ id: 1, kind: "soda" })).toBe("🥤");
    expect(spawnEmoji({ id: 1, kind: "cash" })).toBe("💵");
  });

  it("spawnLabel prefers server label, then kind matching", () => {
    expect(spawnLabel({ id: 1, label: "Custom!" })).toBe("Custom!");
    expect(spawnLabel({ id: 1, kind: "snack" })).toBe("Free snack!");
    expect(spawnLabel({ id: 1, kind: "energy" })).toBe("Free energy drink!");
    expect(spawnLabel({ id: 1, kind: "cash", amount: 1500 })).toBe(
      "₦1,500 on the ground!"
    );
    expect(spawnLabel({ id: 1, kind: "cash" })).toBe("Cash on the ground!");
  });
});

describe("furniture helpers", () => {
  it("furnitureItemId tolerates item / itemId / id shapes", () => {
    expect(furnitureItemId({ item: "bed" })).toBe("bed");
    expect(furnitureItemId({ itemId: "tv" })).toBe("tv");
    expect(furnitureItemId({ id: 7 })).toBe("7");
    expect(furnitureItemId({})).toBe("");
  });

  it("furnitureKey prefers the instance id", () => {
    expect(furnitureKey({ id: 7, item: "bed" })).toBe("7");
    expect(furnitureKey({ item: "bed" })).toBe("bed");
  });
});

/* M21 — notification helpers: defensive parse + icons. Display-only. */
describe("normalizeNotification()", () => {
  it("parses a full server payload", () => {
    const n = normalizeNotification({
      id: 12,
      type: "friend_online",
      title: "🟢 Friend online",
      body: "admin is online now.",
      data: { userId: 1, username: "admin" },
      read: 0,
      created_at: 1728000000000,
    });
    expect(n).not.toBeNull();
    expect(n!.id).toBe(12);
    expect(n!.type).toBe("friend_online");
    expect(n!.title).toBe("🟢 Friend online");
    expect(n!.body).toBe("admin is online now.");
    expect(n!.data).toEqual({ userId: 1, username: "admin" });
    expect(n!.read).toBe(false);
    expect(n!.created_at).toBe(1728000000000);
  });

  it("treats read=1/true as read, fills defaults for missing fields", () => {
    const n = normalizeNotification({ id: 3, type: "room_message", read: 1 });
    expect(n!.read).toBe(true);
    expect(n!.title).toBe("Notification");
    expect(n!.body).toBeNull();
    expect(n!.data).toBeNull();
    expect(typeof n!.created_at).toBe("number");
  });

  it("rejects non-objects and id-less payloads", () => {
    expect(normalizeNotification(null)).toBeNull();
    expect(normalizeNotification("nope")).toBeNull();
    expect(normalizeNotification({ type: "friend_online" })).toBeNull();
    expect(normalizeNotification({ id: "abc" })).toBeNull();
  });
});

describe("notificationIcon()", () => {
  it("maps each type to an icon, unknown falls back to the bell", () => {
    expect(notificationIcon("friend_online")).toBe("🟢");
    expect(notificationIcon("room_message")).toBe("💬");
    expect(notificationIcon("money_received")).toBe("💰");
    expect(notificationIcon("whatever")).toBe("🔔");
  });
});
