import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Tab-bar contract tests (liquid-glass redesign, 2026-10-13). The vitest
 * setup is node-only (no DOM), so these verify the tab bar at the source
 * level: the TABS structure in TabBar.tsx and the .mobile-nav rules in
 * styles/liquid-glass.css. Real-browser screenshots are the visual proof.
 *
 * Contract (prototype mobile-nav):
 * - exactly 4 tabs: Home, Buy, Map, Phone — tab ids and routing unchanged;
 * - shared Icon component (stroke SVG, no emoji), icon + visible label;
 * - active tab marked aria-current="page";
 * - red notification dot on the Phone tab when hasUnread is set;
 * - fixed bottom glass bar with safe-area padding.
 *
 * Deviation from the original file (design revert, 2026-10-17): the shared
 * components/Icon was removed from the tree, so TabBar.tsx defines its own
 * Icon with identical artwork — the "shared Icon" assertion below checks
 * the local definition instead of the import line.
 */

const here = dirname(fileURLToPath(import.meta.url));
const tabTsx = readFileSync(join(here, "TabBar.tsx"), "utf8");
const lgCss = readFileSync(join(here, "..", "styles", "liquid-glass.css"), "utf8");

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
  const nav = tabTsx.match(/<nav className="mobile-nav"[\s\S]*?<\/nav>/);
  if (!nav) throw new Error("nav.mobile-nav not found in TabBar.tsx");
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

  it("renders icon + visible label per tab (prototype mobile-nav)", () => {
    const nav = navMarkup();
    // The label renders as visible text inside a <span>.
    expect(nav).toMatch(/<span>\{t\.label\}<\/span>/);
    expect(nav).toMatch(/aria-label=\{t\.label\}/);
  });

  it("uses a stroke-SVG Icon with the old artwork (no emoji)", () => {
    const nav = navMarkup();
    expect(nav).toMatch(/<Icon name=\{TAB_ICONS\[t\.id\]/);
    // The shared components/Icon was removed from the tree; the tab bar
    // defines its own Icon with the same stroke-SVG artwork and API.
    expect(tabTsx).toMatch(/function Icon\(\{ name, size/);
    expect(tabTsx).toMatch(/stroke="currentColor"/);
    expect(tabTsx).toMatch(/strokeWidth=\{?1\.7\}?/);
    // No emoji tab icons remain.
    expect(tabTsx).not.toMatch(/"🏠"|"🛒"|"🗺️"|"📱"/);
  });

  it("marks the active tab with aria-current", () => {
    expect(navMarkup()).toMatch(/aria-current=\{active \? "page" : undefined\}/);
  });

  it("accepts a hasUnread prop and shows the dot on the Phone tab", () => {
    expect(tabTsx).toMatch(/hasUnread\?: boolean/);
    expect(tabTsx).toMatch(/hasUnread = false/);
    const nav = navMarkup();
    expect(nav).toMatch(/t\.id === "phone" && hasUnread/);
    expect(nav).toMatch(/nav-dot/);
  });
});

describe("tab bar styling (liquid-glass.css)", () => {
  it("pins the nav to the bottom of the viewport", () => {
    const block = ruleBlock(lgCss, ".mobile-nav");
    expect(block).toMatch(/position:\s*fixed/);
    expect(block).toMatch(/bottom:\s*0/);
  });

  it("respects the bottom safe-area inset", () => {
    const block = ruleBlock(lgCss, ".mobile-nav");
    expect(block).toMatch(/env\(safe-area-inset-bottom/);
  });

  it("gives the active tab the accent pill treatment", () => {
    const block = ruleBlock(lgCss, '.nav-item[aria-current="page"]');
    expect(block).toMatch(/background:\s*var\(--accent-soft\)/);
  });

  it("renders the unread dot as an absolutely-positioned red badge", () => {
    const block = ruleBlock(lgCss, ".nav-dot");
    expect(block).toMatch(/position:\s*absolute/);
    expect(block).toMatch(/background:\s*#ff657c/);
    expect(block).toMatch(/border-radius:\s*50%/);
  });

  it("provides at least 44px touch targets", () => {
    const block = ruleBlock(lgCss, ".nav-item");
    const m = block.match(/min-height:\s*(\d+)px/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(44);
  });
});
