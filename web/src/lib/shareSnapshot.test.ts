import { expect, it } from "vitest";
import { shareSnapshot } from "./shareSnapshot";
it("retains room and avatar identities across unrelated need updates", () => {
  const previous = { energy: 40, furniture: [{ id: 'bed', placed: true }], avatar: { hair: 'a' } };
  const incoming = JSON.parse(JSON.stringify({ ...previous, energy: 39 }));
  const next = shareSnapshot(previous, incoming);
  expect(next).not.toBe(previous);
  expect(next.energy).toBe(39);
  expect(next.furniture).toBe(previous.furniture);
  expect(next.avatar).toBe(previous.avatar);
  expect(shareSnapshot(next, JSON.parse(JSON.stringify(next)))).toBe(next);
});
it("propagates actual edits, additions, removals and null without mutating snapshots", () => {
  const previous = { furniture: [{ id: 'bed', x: 1 }, { id: 'tv', x: 2 }], old: true };
  const incoming = { furniture: [{ id: 'bed', x: 3 }, { id: 'tv', x: 2 }] };
  const next = shareSnapshot<object>(previous, incoming) as typeof incoming;
  expect(next).toEqual(incoming);
  expect(next.furniture[0]).not.toBe(previous.furniture[0]);
  expect(next.furniture[1]).toBe(previous.furniture[1]);
  expect(previous.furniture[0].x).toBe(1);
  expect(shareSnapshot(previous.furniture, [])).toEqual([]);
  expect(shareSnapshot<object | null>(previous, null)).toBeNull();
});
