import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Tab-bar contract tests. The vitest setup is node-only (no DOM), so these
 * verify the tab bar at the source level: the TABS structure in Game.tsx and
 * the .eko-tabs rules in Game.css. Real-browser screenshots are the visual
 * proof (see workstream A report).
 */

const here = dirname(fileURLToPath(import.meta.url));
const gameTsx = readFileSync(join(here, "Game.tsx"), "utf8");
const gameCss = readFileSync(join(here, "Game.css"), "utf8");

const EXPECTED_TABS = [
  { id: "home", label: "Home", icon: "🏠" },
  { id: "city", label: "City", icon: "🌆" },
  { id: "jobs", label: "Jobs", icon: "💼" },
  { id: "needs", label: "Needs", icon: "💚" },
  { id: "daily", label: "Daily", icon: "🎯" },
  { id: "market", label: "Market", icon: "💰" },
  { id: "chat", label: "Chat", icon: "💬" },
  { id: "me", label: "Me", icon: "🧑" },
];

function parseTabs(src: string): Array<{ id: string; label: string; icon: string }> {
  const m = src.match(/const TABS[^=]*=\s*\[(.*?)\];/s);
  if (!m) throw new Error("TABS array not found in Game.tsx");
  const entries = [
    ...m[1].matchAll(
      /\{\s*id:\s*"([^"]+)"\s*,\s*label:\s*"([^"]+)"\s*,\s*icon:\s*"([^"]+)"\s*\}/g,
    ),
  ];
  return entries.map((e) => ({ id: e[1], label: e[2], icon: e[3] }));
}

function ruleBlock(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`, "s"));
  if (!m) throw new Error(`CSS rule ${selector} not found in Game.css`);
  return m[1];
}

describe("tab bar structure (Game.tsx)", () => {
  it("has exactly the 8 tabs, in order, with unchanged labels and icons", () => {
    expect(parseTabs(gameTsx)).toEqual(EXPECTED_TABS);
  });

  it("gives every tab a unique id", () => {
    const ids = parseTabs(gameTsx).map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("tab bar styling (Game.css)", () => {
  it("lays all 8 tabs out in a single row — repeat(8, 1fr), not 7", () => {
    const block = ruleBlock(gameCss, ".eko-tabs");
    expect(block).toMatch(/grid-template-columns:\s*repeat\(\s*8\s*,\s*1fr\s*\)/);
    expect(block).not.toMatch(/repeat\(\s*7\s*,/);
  });

  it("marks the active tab with a solid pill background", () => {
    const block = ruleBlock(gameCss, ".eko-tabs__btn--active");
    expect(block).toMatch(/background:\s*var\(--success\)/);
  });

  it("keeps active and inactive buttons the same size (no layout shift on switch)", () => {
    const active = ruleBlock(gameCss, ".eko-tabs__btn--active");
    expect(active).not.toMatch(/(^|;)\s*padding\s*:/);
    expect(active).not.toMatch(/(^|;)\s*border(?!-radius)\s*:/);
    expect(active).not.toMatch(/min-height/);
  });

  it("respects the bottom safe-area inset", () => {
    const block = ruleBlock(gameCss, ".eko-tabs");
    expect(block).toMatch(/var\(--sab\)/);
  });

  it("provides at least 44px touch targets", () => {
    const block = ruleBlock(gameCss, ".eko-tabs__btn");
    const m = block.match(/min-height:\s*(\d+)px/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(44);
  });

  it("keeps tab labels on one line (icon-over-label buttons)", () => {
    expect(ruleBlock(gameCss, ".eko-tabs__label")).toMatch(/white-space:\s*nowrap/);
    expect(ruleBlock(gameCss, ".eko-tabs__btn")).toMatch(/flex-direction:\s*column/);
  });
});
