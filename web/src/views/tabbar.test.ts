import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Tab-bar contract tests. The vitest setup is node-only (no DOM), so these
 * verify the tab bar at the source level: the TABS structure + FLIP logic in
 * TabBar.tsx and the .eko-tabs rules in Game.css / glass.css. Real-browser
 * screenshots are the visual proof.
 *
 * Contract (icon + text label per tab — 2026-10-11 user verdict, superseding the
 * earlier icons-only dock: each tab shows its icon AND its text label):
 * - exactly 4 tabs: Home, Buy, Map, Phone — icon + visible label each
 *   (buttons also keep aria-label for screen readers);
 * - hand-drawn inline SVG icons: outline artwork for inactive tabs, FILLED
 *   artwork for the active tab (filled house vs outlined rest);
 * - red notification dot on the Phone tab when hasUnread is set;
 * - the selected tab sits in a magnifying liquid-glass bubble, its icon
 *   rendered TAB_ZOOM (1.28x) larger than unselected tabs;
 * - the bubble FLIP-morphs between tabs with a mid-flight liquid stretch
 *   and spring easing; reduced-motion jumps instantly.
 */

const here = dirname(fileURLToPath(import.meta.url));
const tabTsx = readFileSync(join(here, "TabBar.tsx"), "utf8");
const gameCss = readFileSync(join(here, "Game.css"), "utf8");
const glassCss = readFileSync(join(here, "..", "styles", "glass.css"), "utf8");

const EXPECTED_TABS = [
  { id: "home", label: "Home" },
  { id: "buy", label: "Buy" },
  { id: "map", label: "Map" },
  { id: "phone", label: "Phone" },
];

function parseTabs(src: string): Array<{ id: string; label: string }> {
  const m = src.match(/export const TABS[^=]*=\s*\[(.*?)\];/s);
  if (!m) throw new Error("TABS array not found in TabBar.tsx");
  const entries = [
    ...m[1].matchAll(/\{\s*id:\s*"([^"]+)"\s*,\s*label:\s*"([^"]+)"\s*\}/g),
  ];
  return entries.map((e) => ({ id: e[1], label: e[2] }));
}

function ruleBlock(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`, "s"));
  if (!m) throw new Error(`CSS rule ${selector} not found`);
  return m[1];
}

function navMarkup(): string {
  const nav = tabTsx.match(/<nav className="eko-tabs"[\s\S]*?<\/nav>/);
  if (!nav) throw new Error("nav.eko-tabs not found in TabBar.tsx");
  return nav[0];
}

describe("tab bar structure (TabBar.tsx)", () => {
  it("has exactly the 4 tabs, in order, with unchanged ids and labels", () => {
    expect(parseTabs(tabTsx)).toEqual(EXPECTED_TABS);
  });

  it("gives every tab a unique id", () => {
    const ids = parseTabs(tabTsx).map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("renders icon + text label per tab (2026-10-11 user verdict)", () => {
    const nav = navMarkup();
    // Visible label element exists per tab …
    expect(nav).toMatch(/eko-tabs__label/);
    // … rendering the tab's label text …
    expect(nav).toMatch(/\{t\.label\}/);
    // … and the icon sits alongside it.
    expect(nav).toMatch(/eko-tabs__icon/);
  });

  it("keeps aria-labels on the tab buttons for screen readers", () => {
    expect(navMarkup()).toMatch(/aria-label=\{t\.label\}/);
  });

  it("renders hand-drawn inline SVG icons (no emoji)", () => {
    const nav = navMarkup();
    expect(nav).toMatch(/<TabIcon tab=\{t\.id\} active=\{tab === t\.id\} \/>/);
    expect(tabTsx).toMatch(/function TabIcon/);
    expect(tabTsx).toMatch(/viewBox="0 0 24 24"/);
    // No emoji tab icons remain.
    expect(tabTsx).not.toMatch(/"🏠"|"🛒"|"🗺️"|"📱"/);
  });

  it("draws outline artwork for inactive tabs and filled for the active tab", () => {
    // Outline: stroke-based, no fill.
    expect(tabTsx).toMatch(/stroke:\s*"currentColor"/);
    // Filled: solid currentColor paths per tab.
    for (const id of ["home", "buy", "map", "phone"]) {
      expect(tabTsx).toMatch(new RegExp(`${id}:\\s*\\(\\s*<path`));
    }
    expect(tabTsx).toMatch(/fill="currentColor"/);
  });

  it("marks the active tab with aria-current", () => {
    expect(tabTsx).toMatch(/aria-current=\{tab === t\.id \? "page" : undefined\}/);
  });

  it("accepts a hasUnread prop and shows the red dot on the Phone tab", () => {
    expect(tabTsx).toMatch(/hasUnread\?: boolean/);
    expect(tabTsx).toMatch(/hasUnread = false/);
    const nav = navMarkup();
    expect(nav).toMatch(/t\.id === "phone" && hasUnread/);
    expect(nav).toMatch(/eko-tabs__dot/);
  });

  it("exports the selected-tab magnification ratio (1.28x per the reference video)", () => {
    expect(tabTsx).toMatch(/export const TAB_ZOOM = 1\.28/);
  });

  it("sizes the bubble from the icon content, not the button box", () => {
    expect(tabTsx).toMatch(/querySelector\("\.eko-tabs__content"\)/);
  });

  it("morphs the bubble with a mid-flight liquid stretch (FLIP + spring)", () => {
    expect(tabTsx).toMatch(/stretch/);
    expect(tabTsx).toMatch(/squash/);
    expect(tabTsx).toMatch(/cubic-bezier\(0\.32, 1\.45, 0\.45, 1\)/);
  });

  it("jumps instantly under prefers-reduced-motion (no morph)", () => {
    expect(tabTsx).toMatch(/prefers-reduced-motion/);
    expect(tabTsx).toMatch(/reduceMotion/);
  });
});

describe("tab bar styling (Game.css)", () => {
  it("lays all 4 tabs out in a single row — repeat(4, 1fr)", () => {
    const block = ruleBlock(gameCss, ".eko-tabs");
    expect(block).toMatch(/grid-template-columns:\s*repeat\(\s*4\s*,\s*1fr\s*\)/);
  });

  it("sizes the SVG icons (26px) without layout shift", () => {
    const block = ruleBlock(gameCss, ".eko-tabs__icon svg");
    expect(block).toMatch(/width:\s*26px/);
    expect(block).toMatch(/height:\s*26px/);
  });

  it("zooms the active tab's icon to 1.28x via transform (no layout shift)", () => {
    const block = ruleBlock(gameCss, ".eko-tabs__btn--active .eko-tabs__content");
    expect(block).toMatch(/transform:\s*scale\(1\.28\)/);
  });

  it("keeps active and inactive buttons the same box metrics (no layout shift on switch)", () => {
    const active = ruleBlock(gameCss, ".eko-tabs__btn--active");
    expect(active).not.toMatch(/(^|;)\s*padding\s*:/);
    expect(active).not.toMatch(/(^|;)\s*border(?!-radius)\s*:/);
    expect(active).not.toMatch(/min-height/);
    expect(active).not.toMatch(/height/);
    const btn = ruleBlock(gameCss, ".eko-tabs__btn");
    // Fixed button height: the zoom is a transform, so the dock never resizes.
    expect(btn).toMatch(/height:\s*62px/);
  });

  it("gives the active tab the green accent identity at readable contrast", () => {
    const block = ruleBlock(gameCss, ".eko-tabs__btn--active");
    expect(block).toMatch(/color:\s*var\(--palm-700\)/);
  });

  it("renders the unread dot as an absolutely-positioned red badge", () => {
    const block = ruleBlock(gameCss, ".eko-tabs__dot");
    expect(block).toMatch(/position:\s*absolute/);
    expect(block).toMatch(/background:\s*#ef4444/);
    expect(block).toMatch(/border-radius:\s*50%/);
  });

  it("renders the bubble as a single absolutely-positioned lens", () => {
    const pill = ruleBlock(gameCss, ".eko-tabs__pill");
    expect(pill).toMatch(/position:\s*absolute/);
    expect(pill).toMatch(/pointer-events:\s*none/);
    expect(pill).toMatch(/transform-origin:\s*left top/);
    const pills = navMarkup().match(/className="eko-tabs__pill"/g) ?? [];
    expect(pills).toHaveLength(1);
  });

  it("respects the bottom safe-area inset and sits low", () => {
    const block = ruleBlock(gameCss, ".eko-tabs");
    expect(block).toMatch(/var\(--sab\)/);
    expect(block).not.toMatch(/calc\(\s*var\(--space-2\)\s*\+\s*var\(--sab\)\s*\)/);
  });

  it("provides at least 44px touch targets", () => {
    const block = ruleBlock(gameCss, ".eko-tabs__btn");
    const m = block.match(/min-height:\s*(\d+)px/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(44);
  });
});

describe("bubble material (glass.css)", () => {
  it("renders the bubble as a clear refractive lens, not a solid pill", () => {
    const m = glassCss.match(/\.eko-game\s+\.eko-tabs__pill\s*\{([^}]*)\}/s);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/backdrop-filter/);
    // Inner specular highlights = the refraction approximation.
    expect(m![1]).toMatch(/inset 0 1px 1px/);
    // Near-clear tint: the lens magnifies, it doesn't paint.
    expect(m![1]).not.toMatch(/var\(--glass-tint-green\)/);
  });

  it("adds a faint prismatic edge ring to the lens", () => {
    expect(glassCss).toMatch(/\.eko-game\s+\.eko-tabs__pill::before/);
    expect(glassCss).toMatch(/conic-gradient/);
  });

  it("dims the lens appropriately for the night theme", () => {
    expect(glassCss).toMatch(
      /\[data-theme="night"\]\s+\.eko-game\s+\.eko-tabs__pill\s*\{/
    );
  });

  it("gives the active tab a night-theme accent that stays readable", () => {
    const m = glassCss.match(
      /\[data-theme="night"\]\s+\.eko-game\s+\.eko-tabs__btn--active\s*\{([^}]*)\}/s
    );
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/color:\s*#4ade80/);
  });
});
