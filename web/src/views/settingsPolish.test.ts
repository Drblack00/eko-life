import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Settings polish contract tests (2026-10-12 user request): the toggle
 * switches were chunky bright-cyan iOS clones; they are now slim
 * (44x26), smaller knob, the game's green accent, spring motion. The theme
 * picker cards broke labels mid-word ("Ligh t") — they now render on one
 * line. Source-level (node-only vitest): real-browser screenshots are the
 * visual proof.
 */

const here = dirname(fileURLToPath(import.meta.url));
const gameCss = readFileSync(join(here, "Game.css"), "utf8");
const glassCss = readFileSync(join(here, "..", "styles", "glass.css"), "utf8");
const charPanelTsx = readFileSync(join(here, "CharacterPanel.tsx"), "utf8");
const charPanelCss = readFileSync(join(here, "CharacterPanel.css"), "utf8");

function ruleBlock(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`, "s"));
  if (!m) throw new Error(`CSS rule ${selector} not found`);
  return m[1];
}

describe("switch styling (Game.css)", () => {
  it("uses a slimmer track (44x26) with a smaller knob", () => {
    const track = ruleBlock(gameCss, ".eko-switch");
    expect(track).toMatch(/width:\s*44px/);
    expect(track).toMatch(/height:\s*26px/);
    const knob = ruleBlock(gameCss, ".eko-switch__knob");
    expect(knob).toMatch(/width:\s*18px/);
    expect(knob).toMatch(/height:\s*18px/);
  });

  it("uses the game's green accent (not cyan) for the on state", () => {
    const on = ruleBlock(gameCss, ".eko-switch--on");
    expect(on).toMatch(/background:\s*var\(--palm-500\)/);
    expect(on).not.toMatch(/#22d3ee/);
  });

  it("slides the knob with a transform (spring), not a left jump", () => {
    const knob = ruleBlock(gameCss, ".eko-switch__knob");
    expect(knob).toMatch(/transition:\s*transform/);
    const onKnob = ruleBlock(gameCss, ".eko-switch--on .eko-switch__knob");
    expect(onKnob).toMatch(/transform:\s*translateX\(18px\)/);
  });

  it("keeps the switch accessible (role + aria-checked survive the redesign)", () => {
    expect(charPanelTsx).toMatch(/role="switch"/);
    expect(charPanelTsx).toMatch(/aria-checked=\{soundOn\}/);
    expect(charPanelTsx).toMatch(/aria-checked=\{on\}/);
  });
});

describe("settings row spacing (CharacterPanel.css)", () => {
  it("gives rows breathing room and hairline dividers", () => {
    const row = ruleBlock(charPanelCss, ".eko-char__switchrow");
    expect(row).toMatch(/padding:\s*13px 4px/);
    expect(charPanelCss).toMatch(
      /\.eko-char__switchrow \+ \.eko-char__switchrow\s*\{[^}]*border-top/
    );
  });
});

describe("theme picker styling (glass.css)", () => {
  it("never breaks theme labels mid-word", () => {
    const label = ruleBlock(glassCss, ".eko-theme-picker__label");
    expect(label).toMatch(/white-space:\s*nowrap/);
    expect(label).not.toMatch(/overflow-wrap:\s*anywhere/);
    const hint = ruleBlock(glassCss, ".eko-theme-picker__hint");
    expect(hint).toMatch(/white-space:\s*nowrap/);
  });

  it("keeps the picker options from blowing out the 3-up grid", () => {
    const options = ruleBlock(glassCss, ".eko-theme-picker__options");
    expect(options).toMatch(/repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  });

  it("renders Light / Dark / Auto labels (no mid-word breaks possible)", () => {
    const themeTsx = readFileSync(
      join(here, "..", "theme", "theme.tsx"),
      "utf8"
    );
    expect(themeTsx).toMatch(/label:\s*"Light"/);
    expect(themeTsx).toMatch(/label:\s*"Dark"/);
    expect(themeTsx).toMatch(/label:\s*"Auto"/);
  });
});
