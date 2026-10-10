import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Tab-bar contract tests. The vitest setup is node-only (no DOM), so these
 * verify the tab bar at the source level: the TABS structure in TabBar.tsx
 * and the .eko-tabs rules in Game.css. Real-browser screenshots are the
 * visual proof (see workstream A report).
 */

const here = dirname(fileURLToPath(import.meta.url));
const gameTsx = readFileSync(join(here, "TabBar.tsx"), "utf8");
const gameCss = readFileSync(join(here, "Game.css"), "utf8");
const glassCss = readFileSync(join(here, "..", "styles", "glass.css"), "utf8");

const EXPECTED_TABS = [
  { id: "home", label: "Home", icon: "🏠" },
  { id: "city", label: "City", icon: "🌆" },
  { id: "jobs", label: "Jobs", icon: "💼" },
  { id: "needs", label: "Needs", icon: "💚" },
  { id: "daily", label: "Daily", icon: "🎯" },
  { id: "market", label: "Market", icon: "💰" },
  { id: "chat", label: "Chat", icon: "💬" },
  { id: "friends", label: "Friends", icon: "🤝" },
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
  it("has exactly the 9 tabs, in order, with unchanged labels and icons", () => {
    expect(parseTabs(gameTsx)).toEqual(EXPECTED_TABS);
  });

  it("gives every tab a unique id", () => {
    const ids = parseTabs(gameTsx).map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("tab bar styling (Game.css)", () => {
  it("lays all 9 tabs out in a single row — repeat(9, 1fr), not 8", () => {
    const block = ruleBlock(gameCss, ".eko-tabs");
    expect(block).toMatch(/grid-template-columns:\s*repeat\(\s*9\s*,\s*1fr\s*\)/);
    expect(block).not.toMatch(/repeat\(\s*8\s*,/);
  });

  it("renders the liquid active-tab pill inside the tab bar", () => {
    // The pill is a single sliding indicator behind the buttons (FLIP
    // animation lives in Game.tsx); it must exist in the nav exactly once.
    const nav = gameTsx.match(/<nav className="eko-tabs"[\s\S]*?<\/nav>/);
    expect(nav).not.toBeNull();
    const pills = nav![0].match(/className="eko-tabs__pill"/g) ?? [];
    expect(pills).toHaveLength(1);
  });

  it("marks the active tab with white text — the sliding pill carries the green identity", () => {
    const block = ruleBlock(gameCss, ".eko-tabs__btn--active");
    expect(block).toMatch(/color:\s*#fff/);
    // The button itself must not paint a background: the liquid pill sits
    // behind it and would double-render.
    expect(block).not.toMatch(/background:\s*var\(--success\)/);
  });

  it("positions the liquid pill absolutely behind the tab buttons", () => {
    const pill = ruleBlock(gameCss, ".eko-tabs__pill");
    expect(pill).toMatch(/position:\s*absolute/);
    expect(pill).toMatch(/pointer-events:\s*none/);
    const btn = ruleBlock(gameCss, ".eko-tabs__btn");
    expect(btn).toMatch(/position:\s*relative/);
    expect(btn).toMatch(/z-index:\s*1/);
  });

  it("gives the liquid pill the green glass material in glass.css", () => {
    const m = glassCss.match(/\.eko-game\s+\.eko-tabs__pill\s*\{([^}]*)\}/s);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/var\(--glass-tint-green\)/);
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
