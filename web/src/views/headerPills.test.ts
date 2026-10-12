import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Header contract — "Pill + floating orbs" (user-picked 2026-10-12).
 * The status pill holds the avatar + two stacked text lines (name /
 * mood · online); every action floats as its own glass circle — wallet
 * pill, bell orb, governor orb. The sound toggle lives in Settings
 * (CharacterPanel), not in the header. No horizontal scrolling anywhere;
 * nothing may clip at 390px.
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

describe("orbs header structure (Game.tsx)", () => {
  it("renders a pills row with a status pill and an orbs row", () => {
    expect(gameTsx).toContain('className="eko-hud__pills"');
    expect(gameTsx).toContain("eko-top-pill--status");
    expect(gameTsx).toContain('className="eko-hud__orbs"');
    // The old compact actions pill is gone.
    expect(gameTsx).not.toContain("eko-top-pill--actions");
  });

  it("status pill stacks avatar + name / mood · online — and nothing actionable else", () => {
    const pills = pillsBlock();
    const statusStart = pills.indexOf("eko-top-pill--status");
    const orbsStart = pills.indexOf("eko-hud__orbs");
    const status = pills.slice(statusStart, orbsStart);
    expect(status).toContain("eko-top-pill__avatar");
    expect(status).toContain("eko-top-pill__stack");
    expect(status).toContain("eko-top-pill__name");
    expect(status).toContain("eko-top-pill__meta");
    expect(status).toContain("<Clock");
    expect(status).toContain("eko-top-pill__mood");
    expect(status).toContain("eko-top-pill__online");
    expect(status).not.toContain("eko-notifbell");
    expect(status).not.toContain("eko-orb--gov");
    expect(status).not.toContain("eko-orb--wallet");
  });

  it("orbs row holds wallet pill, bell orb, governor orb", () => {
    const pills = pillsBlock();
    const orbsStart = pills.indexOf("eko-hud__orbs");
    const orbs = pills.slice(orbsStart);
    expect(orbs).toContain("eko-orb--wallet");
    expect(orbs).toContain("eko-orb__wallet-text");
    expect(orbs).toContain("eko-top-pill__topup");
    expect(orbs).toContain("NotificationBell");
    expect(orbs).toContain("eko-orb--gov");
  });

  it("the sound toggle is gone from the header (it lives in Settings)", () => {
    const pills = pillsBlock();
    expect(pills).not.toMatch(/toggleSound/);
    expect(pills).not.toMatch(/aria-pressed=\{soundOn\}/);
    expect(pills).not.toContain("Mute sounds");
  });

  it("governor orb is icon-only; full text stays in title/aria-label", () => {
    const pills = pillsBlock();
    const orbsStart = pills.indexOf("eko-hud__orbs");
    const orbs = pills.slice(orbsStart);
    expect(orbs).not.toContain("eko-hud__gov-text");
    expect(orbs).toMatch(/title=\{governorName \? `State House/);
    expect(orbs).toMatch(/aria-label=\{governorName \? `State House/);
    expect(orbs).toContain('aria-haspopup="dialog"');
    expect(orbs).toMatch(/onClick=\{onGovOpen\}/);
  });

  it("every remaining button keeps its behavior and aria wiring", () => {
    const pills = pillsBlock();
    // avatar → character panel
    expect(pills).toMatch(/onClick=\{onOpenCharacter\}/);
    expect(pills).toContain('aria-label="Open my character panel"');
    // top-up
    expect(pills).toMatch(/onTopUp\(\)/);
    expect(pills).toContain('aria-label="Top up wallet"');
    // bell keeps the unread count wiring
    expect(pills).toMatch(/<NotificationBell unread=\{unreadNotifications\}/);
    expect(pills).toMatch(/onOpen=\{onOpenNotifications\}/);
  });
});

describe("no-clipping CSS contract (HomeChrome.css)", () => {
  it("the header never scrolls horizontally", () => {
    expect(chromeCss).not.toMatch(/overflow-x:\s*(auto|scroll)/);
  });

  it("the pills row is a non-wrapping flex row", () => {
    const row = ruleBlock(chromeCss, ".eko-hud__pills");
    expect(row).toMatch(/display:\s*flex/);
  });

  it("the status pill has generous padding and hides overflow instead of spilling", () => {
    const status = ruleBlock(chromeCss, ".eko-top-pill--status");
    expect(status).toMatch(/min-width:\s*0/);
    expect(status).toMatch(/overflow:\s*hidden/);
    expect(status).toMatch(/padding:\s*0\.55rem 1\.25rem/);
  });

  it("orbs are circles with a fixed size", () => {
    const orb = ruleBlock(chromeCss, ".eko-orb");
    expect(orb).toMatch(/border-radius:\s*50%/);
    expect(orb).toMatch(/width:\s*2\.65rem/);
    expect(orb).toMatch(/height:\s*2\.65rem/);
  });

  it("circles can never be squeezed into ovals: min-width/min-height match the fixed size", () => {
    // iOS Safari quirk: buttons inside an overflowing flex row can shrink
    // despite flex:none. A hard min-size floor keeps every circle round.
    const orb = ruleBlock(chromeCss, ".eko-orb");
    expect(orb).toMatch(/min-width:\s*2\.65rem/);
    expect(orb).toMatch(/min-height:\s*2\.65rem/);
    const avatar = ruleBlock(chromeCss, ".eko-top-pill__avatar");
    expect(avatar).toMatch(/min-width:\s*2\.1rem/);
    expect(avatar).toMatch(/min-height:\s*2\.1rem/);
    const topup = ruleBlock(chromeCss, ".eko-top-pill__topup");
    expect(topup).toMatch(/min-width:\s*1\.6rem/);
    expect(topup).toMatch(/min-height:\s*1\.6rem/);
    // …and the phone media query re-states the floors at the smaller sizes.
    const mqStart = chromeCss.indexOf("@media (max-width: 560px)");
    const mq = chromeCss.slice(mqStart);
    expect(mq).toMatch(/\.eko-orb\s*\{[^}]*min-width:\s*2\.45rem/s);
    expect(mq).toMatch(/\.eko-top-pill__avatar\s*\{[^}]*min-width:\s*1\.8rem/s);
    expect(mq).toMatch(/\.eko-top-pill__topup\s*\{[^}]*min-width:\s*1\.45rem/s);
  });

  it("the governor orb overrides the old pill-style gov button", () => {
    const gov = ruleBlock(chromeCss, ".eko-hud .eko-orb--gov");
    expect(gov).toMatch(/appearance:\s*none/);
    expect(gov).toMatch(/max-width:\s*none/);
    // The circle itself comes from the shared .eko-orb base class.
    const orb = ruleBlock(chromeCss, ".eko-orb");
    expect(orb).toMatch(/border-radius:\s*50%/);
  });

  it("long wallet balances ellipsize instead of pushing orbs off-screen", () => {
    const wt = ruleBlock(chromeCss, ".eko-orb__wallet-text");
    expect(wt).toMatch(/text-overflow:\s*ellipsis/);
    expect(wt).toMatch(/min-width:\s*0/);
    expect(gameTsx).toContain("eko-orb__wallet-text");
  });

  it("phones hide the ambient clock; the meta line compacts instead of clipping", () => {
    const mqStart = chromeCss.indexOf("@media (max-width: 560px)");
    expect(mqStart).toBeGreaterThan(-1);
    const mq = chromeCss.slice(mqStart);
    expect(mq).toMatch(/\.eko-hud \.m7-clock\s*\{\s*display:\s*none/);
    expect(mq).toContain(".eko-hud__orbs");
    expect(mq).toContain(".eko-orb--wallet");
  });

  it("the phone media query keeps the wallet pill auto-width (else the fixed orb width crushes the balance text)", () => {
    const mqStart = chromeCss.indexOf("@media (max-width: 560px)");
    const mq = chromeCss.slice(mqStart);
    const m = mq.match(/\.eko-orb--wallet\s*\{([^}]*)\}/s);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/width:\s*auto/);
  });
});
