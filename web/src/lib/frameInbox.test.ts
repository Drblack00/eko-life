// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFrameInbox } from "./frameInbox";
let frame: FrameRequestCallback;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("coalesces a burst in order and cancels the fallback after the frame", () => {
  const consume = vi.fn();
  const inbox = createFrameInbox<number>(consume);
  inbox.push(1); inbox.push(2); inbox.push(3);
  expect(consume).not.toHaveBeenCalled();
  expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  frame(16);
  expect(consume.mock.calls).toEqual([[1], [2], [3]]);
  vi.advanceTimersByTime(100);
  expect(consume).toHaveBeenCalledTimes(3);
});
it("delivers messages in hidden tabs and drops queued work on teardown", () => {
  const consume = vi.fn();
  const inbox = createFrameInbox<number>(consume);
  inbox.push(1);
  vi.advanceTimersByTime(50);
  expect(consume).toHaveBeenCalledWith(1);
  inbox.push(2); inbox.clear();
  vi.advanceTimersByTime(100);
  frame(100);
  expect(consume).toHaveBeenCalledTimes(1);
});
it("flushes before a connection closes so its final snapshot is not lost", () => {
  const consume = vi.fn();
  const inbox = createFrameInbox<string>(consume);
  inbox.push("final"); inbox.flush();
  expect(consume).toHaveBeenCalledWith("final");
  expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
});
