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
    expect(tsx(theme)).toMatch(/<div className=\{styles\.titleBlock\}>\s*<h1 className=\{styles\.title\} dir=\{lineDirection\(track\)\}>/);
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
      /<div className=\{styles\.foot\}>\s*<span className=\{styles\.footArtist\} dir=\{lineDirection\(artist\)\}>\{artist \|\| " "\}<\/span>\s*<span className=\{styles\.footMark\}>HEARTFOLIO<\/span>/,
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
      /<p className=\{styles\.plaqueFoot\} dir=\{lineDirection\(`\$\{artist \?\? ""\} · HEARTFOLIO`\)\}>\s*<span className=\{styles\.plaqueArtist\}>\{artist \|\| " "\}<\/span>\s*<span className=\{styles\.plaqueMark\}> · HEARTFOLIO<\/span>/,
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

/**
 * THE TITLE BOX HAS ROOM FOR ITS INK (19 Oct 2026). Every title is one line
 * (Sleeve's two) in a box with `overflow: hidden`, about one line tall: an
 * Arabic title's dots and tails were cut in all eight themes (up to 0.14em
 * above and 0.37em below, Ledger's), and Latin descenders too (Ledger's "Gypsy").
 * The box gets padding above and below and gives it back in its margins, so
 * nothing on the poster moves (measured in the browser, /en and /ar).
 */
const TITLE_MARGINS: Record<string, string> = {
  player: "-0.16em calc(7px - 0.4em)",
  ledger: "-0.16em calc(6px - 0.4em)",
  ephemeris: "calc(26px - 0.16em) -0.4em",
  "contact-sheet": "calc(22px - 0.16em) calc(6px - 0.4em)",
  label: "calc(26px - 0.16em) calc(6px - 0.4em)",
  award: "-0.16em -0.4em",
  sleeve: "-0.16em calc(20px - 0.4em)",
  mosaic: "-0.16em calc(3px - 0.4em)",
};

describe.each(ALL_THEMES)("%s: the title box", (theme) => {
  it("has room above and below for its ink, given back by its margins", () => {
    const title = rule(css(theme), "title");
    expect(prop(title, "padding-block")).toBe("0.16em 0.4em");
    expect(prop(title, "margin-block")).toBe(TITLE_MARGINS[theme]);
  });
});

describe("sleeve: a cut title", () => {
  it("keeps its old bottom edge, so the hidden third line never shows", () => {
    const clamped = css("sleeve").match(/\n\.title\[data-clamped\]\s*\{([^}]*)\}/)?.[1];
    expect(clamped, ".title[data-clamped]").toBeDefined();
    expect(prop(clamped!, "padding-bottom")).toBe("0");
    expect(prop(clamped!, "margin-bottom")).toBe("20px");
    expect(tsx("sleeve")).toMatch(/<h1 ref=\{titleRef\} className=\{styles\.title\} data-clamped=\{titleClamped \|\| undefined\} dir=\{lineDirection\(track\)\}>/);
  });
});

/**
 * THE POSTER IS THE SAME ON EVERY SITE LANGUAGE (19 Oct 2026). On /ar every
 * poster inherited right-to-left and mirrored (photo, footer, heart, Sleeve's
 * column) while the print never does. The root is always left-to-right and
 * left-aligned, and each line of the customer's text takes its direction from
 * its first strong letter (`lineDirection`, set as `dir`), as the print's bidi does.
 */
const CUSTOMER_TEXT: Record<string, string[]> = {
  player: ["title", "artist", "message"],
  ledger: ["title", "artist", "dedication", "footArtist"],
  ephemeris: ["title", "artist", "dedication", "footArtist"],
  "contact-sheet": ["title", "artist", "caption", "footArtist"],
  label: ["title", "artist", "dedication", "footArtist"],
  award: ["title", "artist", "plaqueDedication", "plaqueFoot"],
  sleeve: ["artist", "footArtist"],
  mosaic: ["title", "artist", "dedication", "footArtist"],
};

describe.each(ALL_THEMES)("%s: direction", (theme) => {
  it("draws the poster left to right, start-aligned, with the shared root class", () => {
    expect(tsx(theme)).toMatch(/dir="ltr"\s*className=\{`\$\{styles\.sheet\} \$\{posterRoot\.root\}`\}/);
    expect(tsx(theme)).toContain('import posterRoot from "./poster-root.module.css";');
    // Logical, as `rtl.test.ts` requires: the root is `dir="ltr"`, so `start` is its left.
    expect(prop(rule(css(theme), "sheet"), "text-align")).toBe("start");
  });

  it("lets each line of the customer's text take its own direction", () => {
    for (const cls of CUSTOMER_TEXT[theme]!) {
      expect(tsx(theme), cls).toMatch(new RegExp(`className=\\{styles\\.${cls}\\}[^>]*dir=\\{lineDirection\\(`));
    }
  });
});
