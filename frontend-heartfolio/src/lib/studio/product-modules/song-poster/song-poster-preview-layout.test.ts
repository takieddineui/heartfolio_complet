import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * SONG POSTER'S PREVIEW STAYS ON ITS POSTER (19 Oct 2026).
 *
 * At 60+60 characters, Player's title row ran 506 units past an 800-unit
 * canvas and Mosaic's 163, pushing the heart off the poster: the title and
 * artist sat in a flex item whose default `min-width: auto` let the one-line
 * title stretch it, so the title's own ellipsis never worked. And Player's
 * waveform, an absolutely positioned <svg>, kept its intrinsic 800-unit width
 * in a 680-unit row. jsdom has no layout, so these pin the rules; the fixes
 * were measured in the browser at 1280, 1440, 1920 and phone width.
 */
const css = (theme: string) => readFileSync(join(__dirname, `${theme}-theme.module.css`), "utf8");
const tsx = (theme: string) => readFileSync(join(__dirname, `${theme}-theme.tsx`), "utf8");

function rule(source: string, selector: string): string {
  const match = source.match(new RegExp(`(?:^|\\n)\\s*\\.${selector}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`no .${selector} rule`);
  return match[1]!;
}

const prop = (body: string, property: string) =>
  body.match(new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+);`))?.[1]?.trim();

describe.each(["player", "mosaic"])("%s: a long title and artist stay on the poster", (theme) => {
  it("wraps the title and artist in a column that may shrink beside the heart", () => {
    expect(tsx(theme)).toMatch(/<div className=\{styles\.titleBlock\}>\s*<h1 className=\{styles\.title\}>/);
    const block = rule(css(theme), "titleBlock");
    expect(prop(block, "min-width")).toBe("0");
    expect(prop(block, "flex")).toBe("1");
  });

  it("cuts the title to one line with an ellipsis", () => {
    const title = rule(css(theme), "title");
    expect(prop(title, "white-space")).toBe("nowrap");
    expect(prop(title, "overflow")).toBe("hidden");
    expect(prop(title, "text-overflow")).toBe("ellipsis");
  });

  it("cuts the artist to one line with an ellipsis, as the print draws it on one line", () => {
    const artist = rule(css(theme), "artist");
    expect(prop(artist, "white-space")).toBe("nowrap");
    expect(prop(artist, "overflow")).toBe("hidden");
    expect(prop(artist, "text-overflow")).toBe("ellipsis");
  });

  it("never lets the heart shrink away", () => {
    expect(prop(rule(css(theme), "heart"), "flex")).toBe("0 0 auto");
  });
});

describe("player: the waveform", () => {
  it("is as wide as its row, not its viewBox", () => {
    expect(prop(rule(css("player"), "eq"), "width")).toBe("100%");
  });
});

/**
 * EVERY ARTIST LINE IS ONE LINE (19 Oct 2026, owner's decision). Six previews
 * wrapped the artist under the title and every footer wrapped it before
 * HEARTFOLIO; the print now fits one line (shrinking, then "…"), so the
 * previews end it with "…" too. The footer keeps 16px before the wordmark (the
 * print's `FOOT_GAP`, pinned against the CSS by the parity test).
 */
const ALL_THEMES = ["player", "ledger", "ephemeris", "contact-sheet", "label", "award", "sleeve", "mosaic"];
const FOOTER_THEMES = ["ledger", "ephemeris", "contact-sheet", "label", "sleeve", "mosaic"];

describe.each(ALL_THEMES)("%s: the artist under the title", (theme) => {
  it("is one line ending with an ellipsis", () => {
    const artist = rule(css(theme), "artist");
    expect(prop(artist, "white-space")).toBe("nowrap");
    expect(prop(artist, "overflow")).toBe("hidden");
    expect(prop(artist, "text-overflow")).toBe("ellipsis");
  });
});

describe("award: the artist under the title", () => {
  it("is held to its column, which shrinks to fit its content otherwise", () => {
    expect(prop(rule(css("award"), "artist"), "max-width")).toBe("100%");
  });
});

describe.each(FOOTER_THEMES)("%s: the footer", (theme) => {
  it("names its artist and wordmark spans", () => {
    expect(tsx(theme)).toMatch(
      /<div className=\{styles\.foot\}>\s*<span className=\{styles\.footArtist\}>\{artist \|\| " "\}<\/span>\s*<span className=\{styles\.footMark\}>HEARTFOLIO<\/span>/,
    );
  });

  it("keeps the artist to one line ending with an ellipsis, 16px short of the wordmark", () => {
    const artist = rule(css(theme), "footArtist");
    expect(prop(artist, "min-width")).toBe("0");
    expect(prop(artist, "white-space")).toBe("nowrap");
    expect(prop(artist, "overflow")).toBe("hidden");
    expect(prop(artist, "text-overflow")).toBe("ellipsis");
    expect(prop(rule(css(theme), "footMark"), "flex-shrink")).toBe("0");
    expect(prop(rule(css(theme), "foot"), "gap")).toBe("16px");
  });
});

describe("award: the plaque's line", () => {
  it("keeps the separator and wordmark whole and cuts the artist", () => {
    expect(tsx("award")).toMatch(
      /<p className=\{styles\.plaqueFoot\}>\s*<span className=\{styles\.plaqueArtist\}>\{artist \|\| " "\}<\/span>\s*<span className=\{styles\.plaqueMark\}> · HEARTFOLIO<\/span>/,
    );
    expect(prop(rule(css("award"), "plaqueFoot"), "display")).toBe("flex");
    const artist = rule(css("award"), "plaqueArtist");
    expect(prop(artist, "min-width")).toBe("0");
    expect(prop(artist, "white-space")).toBe("nowrap");
    expect(prop(artist, "text-overflow")).toBe("ellipsis");
    const mark = rule(css("award"), "plaqueMark");
    expect(prop(mark, "flex-shrink")).toBe("0");
    expect(prop(mark, "white-space")).toBe("pre");
  });
});
