import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { timelineThemes } from "@/lib/studio/product-modules/love-story-timeline/themes";
import { LiveKeepsake } from "./live-keepsake";
import { liveThemeStyle, withArabicFace } from "./live-theme";

/**
 * The live keepsake honours the customer's palette and typography.
 *
 * It used to style four of the eight palettes from its own CSS list, so
 * Terracotta, Gilded and Forest Night showed the classic cream, and it ignored
 * the typography axis entirely. These tests pin the cure: one source of
 * colours and fonts (the Studio's own tokens), applied to the page.
 */
const palette = timelineThemes.axes.find((axis) => axis.id === "palette");
const typography = timelineThemes.axes.find((axis) => axis.id === "typography");
if (palette?.kind === "range" || typography?.kind === "range" || !palette || !typography) {
  throw new Error("timelineThemes must define discrete palette and typography axes");
}
const PALETTES = palette.options;
const TYPOGRAPHIES = typography.options;

const ARABIC = '"Heartfolio Live Arabic"';
const tokenOf = (option: (typeof PALETTES)[number], name: string) => (option.tokens as Record<string, string>)[name]!;

describe("liveThemeStyle: every palette", () => {
  it("covers all eight palettes", () => {
    expect(PALETTES.map((option) => option.id)).toEqual([
      "classic", "blush", "midnight", "sage", "terracotta", "monochrome", "gold", "forest",
    ]);
  });

  it.each(PALETTES.map((option) => [option.id, option] as const))("%s gets its own colours", (id, option) => {
    const style = liveThemeStyle({ palette: id, typography: "serif-classic" }) as Record<string, string>;
    expect(style["--paper"]).toBe(tokenOf(option, "--p-bg"));
    expect(style["--ink"]).toBe(tokenOf(option, "--p-text"));
    expect(style["--muted"]).toBe(tokenOf(option, "--p-muted"));
    expect(style["--accent"]).toBe(tokenOf(option, "--p-accent"));
  });

  it("gives all eight a different page colour, so none falls back to another's", () => {
    const papers = PALETTES.map((option) => (liveThemeStyle({ palette: option.id }) as Record<string, string>)["--paper"]);
    expect(new Set(papers).size).toBe(PALETTES.length);
  });

  it("matches the colours the PRINT uses, palette by palette", () => {
    // `PALETTES` in the renderer's data.py is the print's table. The live page,
    // the Studio preview and the print must show the same colours.
    const roots = [
      ...(process.env.HEARTFOLIO_BACKEND_PATH
        ? [isAbsolute(process.env.HEARTFOLIO_BACKEND_PATH)
            ? process.env.HEARTFOLIO_BACKEND_PATH
            : join(process.cwd(), process.env.HEARTFOLIO_BACKEND_PATH)]
        : []),
      join(process.cwd(), "..", "backend"),
      join(process.cwd(), "..", "..", "backend", "backend"),
    ];
    const file = roots
      .map((root) => join(root, "apps", "delivery", "product_renderers", "love_story_timeline", "data.py"))
      .find((candidate) => existsSync(candidate));
    // Throws rather than skipping: a skipped parity check reports drift as green.
    if (!file) throw new Error("Cannot locate the backend's data.py. Set HEARTFOLIO_BACKEND_PATH. Tried: " + roots.join(" | "));
    const python = readFileSync(file, "utf8");
    for (const option of PALETTES) {
      const row = python.match(
        new RegExp(`"${option.id}":\\s*\\{"bg":\\s*"(#[0-9a-f]+)",\\s*"text":\\s*"(#[0-9a-f]+)",\\s*"muted":\\s*"(#[0-9a-f]+)",\\s*"accent":\\s*"(#[0-9a-f]+)"`)
      );
      expect(row, `data.py has no palette row for ${option.id}`).not.toBeNull();
      const style = liveThemeStyle({ palette: option.id }) as Record<string, string>;
      expect([style["--paper"], style["--ink"], style["--muted"], style["--accent"]], option.id).toEqual([
        row![1], row![2], row![3], row![4],
      ]);
    }
  });
});

describe("liveThemeStyle: every typography", () => {
  it.each(TYPOGRAPHIES.map((option) => [option.id, option] as const))("%s gets its own fonts", (id, option) => {
    const style = liveThemeStyle({ palette: "classic", typography: id }) as Record<string, string>;
    // The heading stack is the theme's, plus the Arabic-only face (below).
    expect(style["--live-heading-font"]).toBe(withArabicFace(tokenOf(option, "--poster-heading-font"), ARABIC));
    expect(style["--live-body-font"]).toBe(tokenOf(option, "--poster-body-font"));
    expect(style["--live-heading-style"]).toBe(tokenOf(option, "--poster-heading-style"));
  });

  it("slants the headings of Romantic Italic only, as the print's italic does", () => {
    const styles = Object.fromEntries(
      TYPOGRAPHIES.map((option) => [option.id, (liveThemeStyle({ typography: option.id }) as Record<string, string>)["--live-heading-style"]])
    );
    expect(styles).toEqual({ "serif-classic": "normal", modern: "normal", script: "italic", typewriter: "normal" });
  });

  it("gives the four choices four different looks", () => {
    // Serif Classic and Romantic Italic share their faces; the slant is what
    // tells them apart, so it is part of the look.
    const looks = TYPOGRAPHIES.map((option) => {
      const style = liveThemeStyle({ typography: option.id }) as Record<string, string>;
      return `${style["--live-heading-font"]} / ${style["--live-body-font"]} / ${style["--live-heading-style"]}`;
    });
    expect(new Set(looks).size).toBe(TYPOGRAPHIES.length);
  });
});

describe("Arabic headings keep their designed face", () => {
  it("puts the Arabic face FIRST, ahead of faces that carry Arabic themselves", () => {
    // "Heartfolio Sans" brings Naskh, a reading face; a heading must stay Kufi.
    expect(withArabicFace("'Heartfolio Sans', sans-serif", ARABIC)).toBe(`${ARABIC}, 'Heartfolio Sans', sans-serif`);
    expect(withArabicFace("'JetBrains Mono', monospace", ARABIC)).toBe(`${ARABIC}, 'JetBrains Mono', monospace`);
  });

  it("leads every typography's heading stack", () => {
    for (const option of TYPOGRAPHIES) {
      const stack = (liveThemeStyle({ typography: option.id }) as Record<string, string>)["--live-heading-font"]!;
      expect(stack.startsWith(ARABIC), option.id).toBe(true);
    }
  });

  it("is in every typography's heading stack, never in the body's", () => {
    for (const option of TYPOGRAPHIES) {
      const style = liveThemeStyle({ typography: option.id }) as Record<string, string>;
      expect(style["--live-heading-font"], option.id).toContain(ARABIC);
      expect(style["--live-body-font"], option.id).not.toContain(ARABIC);
    }
  });

  it("is declared for Arabic characters ONLY, from the Kufi file the site already ships", () => {
    const css = readFileSync("src/components/live/live-keepsake.module.css", "utf8");
    const face = css.match(/@font-face\s*\{[^}]*"Heartfolio Live Arabic"[^}]*\}/)?.[0];
    expect(face, "the Arabic alias @font-face is missing").toBeDefined();
    expect(face).toContain("/fonts/noto-kufi-arabic.woff2");
    expect(face).toMatch(/unicode-range:\s*U\+0600-06FF/);
    // No Latin range: if it covered Latin it would turn Romantic Italic and
    // Typewriter back into the same face.
    expect(face).not.toMatch(/U\+0000/);
    expect(existsSync("public/fonts/noto-kufi-arabic.woff2")).toBe(true);
  });
});

describe("liveThemeStyle: bad input never loses the colours", () => {
  const classic = liveThemeStyle({ palette: "classic", typography: "serif-classic" });

  it("falls back to the defaults for nothing at all", () => {
    expect(liveThemeStyle({})).toEqual(classic);
    expect(liveThemeStyle(undefined)).toEqual(classic);
  });

  it("falls back to the defaults for an id that is not an option", () => {
    expect(liveThemeStyle({ palette: "neon", typography: "comic" })).toEqual(classic);
    expect(liveThemeStyle({ palette: 7 as unknown as string })).toEqual(classic);
  });

  it("changes the palette without touching the typography, and the reverse", () => {
    const forestSerif = liveThemeStyle({ palette: "forest", typography: "serif-classic" }) as Record<string, string>;
    const forestMono = liveThemeStyle({ palette: "forest", typography: "typewriter" }) as Record<string, string>;
    expect(forestMono["--paper"]).toBe(forestSerif["--paper"]);
    expect(forestMono["--live-heading-font"]).not.toBe(forestSerif["--live-heading-font"]);
  });
});

describe("the live page applies them", () => {
  beforeEach(() => {
    // jsdom has neither; the page uses both.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    window.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    } as unknown as typeof IntersectionObserver;
  });

  const values = {
    people: [{ name: "Emma" }, { name: "James" }],
    posterTitle: "Our Love Story",
    events: [{ date: "2019-04-12", title: "We met", description: "A coffee shop", photo: { url: "" } }],
    endingText: "Forever",
  };
  const media = { backgroundMusic: null, milestones: [{ video: null, audio: null }] };

  it.each(PALETTES.map((option) => [option.id, option] as const))("renders %s in its own colours", (id, option) => {
    const { container } = render(
      <LiveKeepsake values={values} themeSelections={{ palette: id, typography: "serif-classic" }} media={media} locale="en" />
    );
    const main = container.querySelector("main")!;
    expect(main.style.getPropertyValue("--paper")).toBe(tokenOf(option, "--p-bg"));
    expect(main.style.getPropertyValue("--accent")).toBe(tokenOf(option, "--p-accent"));
  });

  it("renders the chosen typography", () => {
    const { container } = render(
      <LiveKeepsake values={values} themeSelections={{ palette: "classic", typography: "typewriter" }} media={media} locale="en" />
    );
    const main = container.querySelector("main")!;
    expect(main.style.getPropertyValue("--live-heading-font")).toContain("JetBrains Mono");
    expect(main.style.getPropertyValue("--live-heading-font")).toContain("Heartfolio Live Arabic");
  });
});

describe("the live page's CSS", () => {
  const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const live = strip(readFileSync("src/components/live/live-keepsake.module.css", "utf8"));
  const opening = strip(readFileSync("src/components/live/opening-sequence.module.css", "utf8"));

  it("has no per-palette rules of its own (a second list is what dropped three palettes)", () => {
    expect(live).not.toMatch(/data-palette/);
  });

  it("sets the body font from the theme, not a fixed face", () => {
    expect(live).toMatch(/\.root\s*\{[^}]*font-family:\s*var\(--live-body-font\)/);
  });

  it("slants the display text from the theme too", () => {
    expect(live).toMatch(/\.title\s*\{[^}]*font-style:\s*var\(--live-heading-style/);
    expect(live).toMatch(/\.stepTitle\s*\{[^}]*font-style:\s*var\(--live-heading-style/);
    expect(opening).toMatch(/\.title\s*\{[^}]*font-style:\s*var\(--live-heading-style/);
  });

  it("sets the display text from the theme: the title, each milestone's title, and the opening's title", () => {
    expect(live).toMatch(/\.title\s*\{[^}]*font-family:\s*var\(--live-heading-font\)/);
    expect(live).toMatch(/\.stepTitle\s*\{[^}]*font-family:\s*var\(--live-heading-font/);
    expect(opening).toMatch(/\.title\s*\{[^}]*font-family:\s*var\(--live-heading-font/);
  });
});
