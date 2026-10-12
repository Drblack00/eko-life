import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Quick-actions contract tests (2026-10-12 user request): the always-visible
 * left-rail quick cards (Goal, Daily, Gem Hunt, Clean screen) were replaced
 * by ONE floating action button that expands a clean overlay panel. Source-
 * level (node-only vitest): real-browser screenshots are the visual proof.
 *
 * Contract:
 * - a single .eko-quickfab button (aria-label "Quick actions",
 *   aria-expanded reflects open state), closed by default;
 * - the panel portals to document.body (transformed ancestors re-anchor
 *   position:fixed — the GemHunt-dialog lesson);
 * - the panel is a role="dialog" with an ✕ close button;
 * - every card's behavior is preserved: goal → onOpenGoals, daily →
 *   onOpenApp("daily"), gem hunt card, clean-screen toggle (aria-pressed);
 * - clean-screen mode hides the FAB and never traps the panel open.
 */

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, "HomeChrome.tsx"), "utf8");
const css = readFileSync(join(here, "HomeChrome.css"), "utf8");

function ruleBlock(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`, "s"));
  if (!m) throw new Error(`CSS rule ${selector} not found`);
  return m[1];
}

function sideCardsSrc(): string {
  const start = tsx.indexOf("function SideCards({");
  if (start < 0) throw new Error("SideCards not found in HomeChrome.tsx");
  // SideCards is followed by the "Combined overlay root" banner comment and
  // then "export function HomeOverlays(".
  const end = tsx.indexOf("\nexport function HomeOverlays(", start);
  if (end < 0) throw new Error("SideCards end not found in HomeChrome.tsx");
  return tsx.slice(start, end);
}

describe("quick-actions FAB (HomeChrome.tsx)", () => {
  it("renders one floating button labeled for accessibility, closed by default", () => {
    const src = sideCardsSrc();
    expect(src).toMatch(/useState\(false\)/);
    expect(src).toMatch(/className="eko-quickfab glass"/);
    expect(src).toMatch(/aria-label="Quick actions"/);
    expect(src).toMatch(/aria-expanded=\{open\}/);
  });

  it("toggles the panel open and closed from the same button", () => {
    const src = sideCardsSrc();
    expect(src).toMatch(/setOpen\(\(o\) => !o\)/);
  });

  it("portals the panel to document.body", () => {
    const src = sideCardsSrc();
    expect(src).toMatch(/createPortal\(/);
    expect(src).toMatch(/document\.body/);
  });

  it("renders the panel as a dialog with a close button", () => {
    const src = sideCardsSrc();
    expect(src).toMatch(/role="dialog"/);
    expect(src).toMatch(/aria-label="Close quick actions"/);
  });

  it("closes on Escape", () => {
    const src = sideCardsSrc();
    expect(src).toMatch(/e\.key === "Escape"/);
  });

  it("keeps every card's behavior: goal, daily, gem hunt, clean toggle", () => {
    const src = sideCardsSrc();
    // Goal card opens the character panel at Goals.
    expect(src).toMatch(/onOpenGoals\(\)/);
    expect(src).toMatch(/aria-label="Open character goals"/);
    // Daily card opens the daily app.
    expect(src).toMatch(/tap\("daily"\)/);
    // Gem hunt card is preserved.
    expect(src).toMatch(/<GemHuntCard token=\{token\} \/>/);
    // Clean-screen toggle keeps its pressed state.
    expect(src).toMatch(/aria-pressed=\{cleanMode\}/);
    expect(src).toMatch(/onToggleClean\(\)/);
  });

  it("hides in clean-screen mode and never traps the panel open", () => {
    const src = sideCardsSrc();
    expect(src).toMatch(/if \(cleanMode\) return null/);
    expect(src).toMatch(/if \(cleanMode\) setOpen\(false\)/);
  });
});

describe("quick-actions styling (HomeChrome.css)", () => {
  it("floats the FAB bottom-left above the dock", () => {
    const fab = ruleBlock(".eko-quickfab");
    expect(fab).toMatch(/position:\s*fixed/);
    expect(fab).toMatch(/left:\s*0\.6rem/);
    expect(fab).toMatch(/bottom:\s*calc\(var\(--sab/);
  });

  it("fixes the panel (and scrim) to the viewport", () => {
    expect(ruleBlock(".eko-quickpanel")).toMatch(/position:\s*fixed/);
    expect(ruleBlock(".eko-quickpanel__scrim")).toMatch(/position:\s*fixed/);
  });

  it("stacks the cards as a plain column inside the panel", () => {
    const stack = ruleBlock(".eko-sidecards");
    expect(stack).toMatch(/display:\s*flex/);
    expect(stack).toMatch(/flex-direction:\s*column/);
    expect(stack).not.toMatch(/position:\s*fixed/);
  });

  it("hides the FAB (not the old rail) in clean-screen mode", () => {
    expect(css).toMatch(/\.eko-game--clean \.eko-hud__stats,\s*\n\.eko-game--clean \.eko-quickfab/);
  });
});
