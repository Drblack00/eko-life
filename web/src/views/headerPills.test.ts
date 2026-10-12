import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Header pills contract (2026-10-12 user request): the single overstuffed
 * top status pill scrolled horizontally on phones and clipped the
 * notification bell. It is now TWO glass pills in a flex row — a status
 * pill (avatar, name, clock, mood, online) and a compact actions pill
 * (sound, wallet + top-up, bell, governor). No horizontal scrolling
 * anywhere; every button keeps its behavior and aria wiring.
 * Source-level (node-only vitest); real-browser screenshots are the visual
 * proof.
 */

const here = dirname(fileURLToPath(import.meta.url));
const gameTsx = readFileSync(join(here, "Game.tsx"), "utf8");
const chromeCss = readFileSync(join(here, "home", "HomeChrome.css"), "utf8");

function ruleBlock(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`, "s"));
  if (!m) throw new Error(`CSS rule ${selector} not found`);
  return m[1];
}

/** Extract the JSX of the header pills wrapper (balanced div scan). */
function pillsBlock(): string {
  const start = gameTsx.indexOf('className="eko-hud__pills"');
  expect(start).toBeGreaterThan(-1);
  // Walk forward balancing <div / </div> from the wrapper's opening tag.
  const openTagEnd = gameTsx.indexOf(">", start);
  let depth = 1;
  let i = openTagEnd + 1;
  while (depth > 0 && i < gameTsx.length) {
    if (gameTsx.startsWith("<div", i)) depth++;
    else if (gameTsx.startsWith("</div>", i)) depth--;
    i++;
  }
  return gameTsx.slice(start, i);
}

describe("two-pill header structure (Game.tsx)", () => {
  it("renders a pills row with a status pill and an actions pill", () => {
    expect(gameTsx).toContain('className="eko-hud__pills"');
    expect(gameTsx).toContain("eko-top-pill--status");
    expect(gameTsx).toContain("eko-top-pill--actions");
  });

  it("status pill holds avatar, name, clock, mood, online — and nothing actionable else", () => {
    const pills = pillsBlock();
    const statusStart = pills.indexOf("eko-top-pill--status");
    const actionsStart = pills.indexOf("eko-top-pill--actions");
    const status = pills.slice(statusStart, actionsStart);
    expect(status).toContain("eko-top-pill__avatar");
    expect(status).toContain("eko-top-pill__name");
    expect(status).toContain("<Clock");
    expect(status).toContain("eko-top-pill__mood");
    expect(status).toContain("eko-top-pill__online");
    expect(status).not.toContain("eko-notifbell");
    expect(status).not.toContain("eko-hud__gov");
    expect(status).not.toContain("eko-top-pill__wallet");
  });

  it("actions pill holds sound, wallet + top-up, bell, governor", () => {
    const pills = pillsBlock();
    const actionsStart = pills.indexOf("eko-top-pill--actions");
    const actions = pills.slice(actionsStart);
    expect(actions).toContain("eko-top-pill__iconbtn");
    expect(actions).toContain("eko-top-pill__wallet");
    expect(actions).toContain("eko-top-pill__topup");
    expect(actions).toContain("NotificationBell");
    expect(actions).toContain("eko-hud__gov");
  });

  it("every button keeps its behavior and aria wiring", () => {
    const pills = pillsBlock();
    // avatar → character panel
    expect(pills).toMatch(/onClick=\{onOpenCharacter\}/);
    expect(pills).toContain('aria-label="Open my character panel"');
    // sound toggle
    expect(pills).toMatch(/aria-pressed=\{soundOn\}/);
    expect(pills).toMatch(/onClick=\{toggleSound\}/);
    // top-up
    expect(pills).toMatch(/onTopUp\(\)/);
    expect(pills).toContain('aria-label="Top up wallet"');
    // bell keeps the unread count wiring
    expect(pills).toMatch(/<NotificationBell unread=\{unreadNotifications\}/);
    expect(pills).toMatch(/onOpen=\{onOpenNotifications\}/);
    // governor: opens State House, full text preserved in title
    expect(pills).toMatch(/onClick=\{onGovOpen\}/);
    expect(pills).toContain('aria-haspopup="dialog"');
    expect(pills).toMatch(/title=\{governorName \? `State House/);
  });
});

describe("no-clipping CSS contract (HomeChrome.css)", () => {
  it("the top pill no longer scrolls horizontally", () => {
    const pill = ruleBlock(chromeCss, ".eko-top-pill");
    expect(pill).not.toMatch(/overflow-x:\s*auto/);
    expect(pill).not.toMatch(/overflow-x:\s*scroll/);
  });

  it("the pills row is a non-wrapping flex row", () => {
    const row = ruleBlock(chromeCss, ".eko-hud__pills");
    expect(row).toMatch(/display:\s*flex/);
  });

  it("the status pill can shrink and hides overflow instead of scrolling", () => {
    const status = ruleBlock(chromeCss, ".eko-top-pill--status");
    expect(status).toMatch(/min-width:\s*0/);
    expect(status).toMatch(/overflow:\s*hidden/);
  });

  it("the governor button is the shrinkable item with ellipsis", () => {
    const gov = ruleBlock(
      chromeCss,
      ".eko-hud .eko-top-pill--actions .eko-hud__gov"
    );
    expect(gov).toMatch(/flex:\s*0 1 auto/);
    expect(gov).toMatch(/min-width:\s*0|2\.4rem/);
  });

  it("phones show the governor button as a clean icon (text hidden, title keeps full text)", () => {
    const mqStart = chromeCss.indexOf("@media (max-width: 560px)");
    const mq = chromeCss.slice(mqStart);
    expect(mq).toMatch(
      /\.eko-hud \.eko-top-pill--actions \.eko-hud__gov-text\s*\{\s*display:\s*none/
    );
    // JSX still renders the full text for wider screens + screen readers
    expect(gameTsx).toContain("eko-hud__gov-text");
    expect(gameTsx).toContain("No governor");
  });

  it("small screens compact the pills instead of clipping", () => {
    const mqStart = chromeCss.indexOf("@media (max-width: 560px)");
    expect(mqStart).toBeGreaterThan(-1);
    const mq = chromeCss.slice(mqStart);
    expect(mq).toContain(".eko-hud__pills");
    // The ambient clock hides on phones (status bar already shows the time)
    expect(mq).toMatch(/\.eko-hud \.m7-clock\s*\{\s*display:\s*none/);
    expect(mq).toContain(".eko-top-pill--actions .eko-hud__gov");
  });

  it("long wallet balances ellipsize instead of pushing the bell off-screen", () => {
    const wt = ruleBlock(chromeCss, ".eko-top-pill__wallet-text");
    expect(wt).toMatch(/text-overflow:\s*ellipsis/);
    expect(wt).toMatch(/min-width:\s*0/);
    expect(gameTsx).toContain("eko-top-pill__wallet-text");
  });
});
