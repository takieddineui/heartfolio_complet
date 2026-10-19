import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE POSTER KEEPS ITS FONTS AND SPACING ON /ar (19 Oct 2026). globals.css's
 * Arabic rules (`.font-arabic` swapping the font variables, `:lang(ar)` line
 * heights) reached into the poster and moved it; `poster-root.module.css`
 * restores the default stacks. These must stay the site's own: this pins them
 * to globals.css's @theme values.
 */
const root = readFileSync(join(__dirname, "poster-root.module.css"), "utf8");
const globals = readFileSync(join(__dirname, "..", "..", "..", "..", "app", "globals.css"), "utf8");

const value = (source: string, name: string) => source.match(new RegExp(`${name}:\s*([^;]+);`))?.[1]?.replace(/\s+/g, " ").trim();
const theme = globals.match(/@theme\s*\{([\s\S]*?)\n\}/)![1]!;

describe("the poster root", () => {
  it.each(["--font-serif", "--font-sans"])("restores the site's own %s", (name) => {
    expect(value(root, name)).toBe(value(theme, name));
  });

  it("restores the site's mono stack, with the site's Arabic sans after its first face", () => {
    const [first, ...rest] = value(theme, "--font-mono")!.split(", ");
    expect(value(root, "--font-mono")).toBe([first, '"Heartfolio Sans"', ...rest].join(", "));
  });

  it("sets the page's own line height, which /ar's body rule would replace", () => {
    expect(root).toMatch(/\.root \{[^}]*line-height: 1\.5;/);
  });

  it("lets every paragraph and heading inherit, at no specificity, against /ar's base-layer rules", () => {
    expect(root).toMatch(/:where\(\.root\) :where\(p, li, h1, h2, h3\) \{\s*line-height: inherit;\s*\}/);
    // The rules it answers, so a change there is noticed here.
    expect(globals).toMatch(/:lang\(ar\) body,\s*:lang\(ar\) p,\s*:lang\(ar\) li \{\s*line-height: 1\.9;/);
    expect(globals).toMatch(/\.font-arabic \{[^}]*--font-serif:/);
  });

  it("keeps a right-to-left line of the customer's text aligned to the poster's start, as the print does", () => {
    expect(root).toMatch(/:where\(\.root\) :where\(\[dir="rtl"\]\) \{\s*text-align: end;\s*\}/);
  });
});
