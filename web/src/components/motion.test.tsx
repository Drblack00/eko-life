// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";
import { ViewStage } from "./ViewStage";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("keeps a closing dialog inert for its exit and cancels removal on rapid reopen", () => {
  vi.useFakeTimers();
  const props = { onClose: () => {}, title: 'Details', children: <p>Current details</p> };
  const { rerender } = render(<Dialog {...props} open />);
  rerender(<Dialog {...props} open={false} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByText('Current details').closest('[inert]')).not.toBeNull();
  act(() => vi.advanceTimersByTime(100));
  rerender(<Dialog {...props} open />);
  act(() => vi.advanceTimersByTime(200));
  expect(screen.getByRole('dialog')).toBeTruthy();
  rerender(<Dialog {...props} open={false} />);
  act(() => vi.advanceTimersByTime(220));
  expect(screen.queryByText('Current details')).toBeNull();
});
it("exits one view before mounting the next, and cancels intermediate navigation", () => {
  vi.useFakeTimers();
  const { rerender } = render(<ViewStage viewKey="a"><p>First</p></ViewStage>);
  rerender(<ViewStage viewKey="b"><p>Second</p></ViewStage>);
  expect(screen.queryByText('Second')).toBeNull();
  expect(screen.getByText('First').closest('[inert]')).not.toBeNull();
  rerender(<ViewStage viewKey="c"><p>Third</p></ViewStage>);
  act(() => vi.advanceTimersByTime(160));
  expect(screen.getByText('Third')).toBeTruthy();
  expect(screen.queryByText('First')).toBeNull();
  expect(screen.queryByText('Second')).toBeNull();
});

it("retains sheet contents when its owner clears selection during close", async () => {
  vi.useFakeTimers();
  const { Sheet } = await import('./Sheet');
  const { rerender } = render(<Sheet open onClose={() => {}} label="Venue"><p>Venue details</p></Sheet>);
  rerender(<Sheet open={false} onClose={() => {}} label="Location">{null}</Sheet>);
  expect(screen.getByText('Venue details')).toBeTruthy();
  act(() => vi.advanceTimersByTime(220));
  expect(screen.queryByText('Venue details')).toBeNull();
});

it("keeps dialog focus stable across callback updates and restores its opener", () => {
  const opener = document.createElement('button'); document.body.appendChild(opener); opener.focus();
  const first = vi.fn(), latest = vi.fn();
  const { rerender } = render(<Dialog open onClose={first} title="Focus"><button>Action</button></Dialog>);
  const action = screen.getByRole('button', { name: 'Action' }); action.focus();
  rerender(<Dialog open onClose={latest} title="Focus"><button>Action</button></Dialog>);
  expect(document.activeElement).toBe(action);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(latest).toHaveBeenCalledOnce(); expect(first).not.toHaveBeenCalled();
  rerender(<Dialog open={false} onClose={latest} title="Focus">{null}</Dialog>);
  expect(document.activeElement).toBe(opener);
  opener.remove();
});

it("switches reduced-motion views immediately instead of leaving an invisible exit delay", () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const { rerender } = render(<ViewStage viewKey="a">First</ViewStage>);
  rerender(<ViewStage viewKey="b">Second</ViewStage>);
  expect(screen.getByText('Second')).toBeTruthy();
  expect(screen.queryByText('First')).toBeNull();
});
