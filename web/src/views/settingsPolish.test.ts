import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Settings polish contract tests (2026-10-12 user request): the toggle
 * switches are iOS-native size (51x31, 27px knob — his pick from samples),
 * the game's green accent, spring motion, and hard min-size floors so iOS
 * Safari can never squeeze the track into a circle. The theme picker cards
 * broke labels mid-word ("Ligh t") — they now render on one line.
 * Source-level (node-only vitest): real-browser screenshots are the visual
 * proof.
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
  it("uses the iOS-native track (51x31) with a 27px knob", () => {
    const track = ruleBlock(gameCss, ".eko-switch");
    expect(track).toMatch(/width:\s*51px/);
    expect(track).toMatch(/height:\s*31px/);
    const knob = ruleBlock(gameCss, ".eko-switch__knob");
    expect(knob).toMatch(/width:\s*27px/);
    expect(knob).toMatch(/height:\s*27px/);
  });

  it("has hard min-size floors so the track can never squeeze into a circle on iOS", () => {
    const track = ruleBlock(gameCss, ".eko-switch");
    expect(track).toMatch(/min-width:\s*51px/);
    expect(track).toMatch(/min-height:\s*31px/);
    const knob = ruleBlock(gameCss, ".eko-switch__knob");
    expect(knob).toMatch(/min-width:\s*27px/);
    expect(knob).toMatch(/min-height:\s*27px/);
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
    expect(onKnob).toMatch(/transform:\s*translateX\(20px\)/);
  });

  it("keeps the switch accessible (role + aria-checked survive the redesign)", () => {
    expect(charPanelTsx).toMatch(/role="switch"/);
    expect(charPanelTsx).toMatch(/aria-checked=\{soundOn\}/);
    expect(charPanelTsx).toMatch(/aria-checked=\{on\}/);
  });

  it("the Me panel has its own Sound effects toggle (it was removed from the top header in v3.6)", () => {
    const gameTsx = readFileSync(join(here, "Game.tsx"), "utf8");
    expect(gameTsx).toMatch(/aria-label="Sound effects"/);
    expect(gameTsx).toMatch(/Sound effects/);
    expect(gameTsx).toMatch(/setSoundEnabled/);
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
