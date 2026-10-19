import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/**
 * SONG POSTER'S TITLES AND DEDICATIONS: THE PRINT SETS THEM AS THE PREVIEW DOES.
 *
 * The print (`song_poster/png_renderer.py`) repeats each theme's CSS numbers in
 * `TITLE_LAYOUT` and `DEDICATION_LAYOUT`. Nothing else ties the two together,
 * so this reads both and fails if they disagree (18 Oct 2026, when the print
 * stopped cutting dedications to one line and started fitting titles; and
 * again when it started drawing Arabic in the preview's own faces and its
 * italics in real italic files).
 */
function backendSongPoster(): string {
  const configured = process.env.HEARTFOLIO_BACKEND_PATH;
  const roots = [
    ...(configured ? [isAbsolute(configured) ? configured : join(process.cwd(), configured)] : []),
    join(process.cwd(), "..", "backend"),
    join(process.cwd(), "..", "..", "backend", "backend"),
  ];
  for (const root of roots) {
    const dir = join(root, "apps", "delivery", "product_renderers");
    if (existsSync(join(dir, "song_poster", "png_renderer.py"))) return dir;
  }
  // Throws rather than skipping: a skipped comparison would report drift as green.
  throw new Error("Cannot locate the backend's png_renderer.py. Set HEARTFOLIO_BACKEND_PATH. Tried: " + roots.join(" | "));
}

const RENDERERS = backendSongPoster();
const py = readFileSync(join(RENDERERS, "song_poster", "png_renderer.py"), "utf8");
/** The print's font folder (`_FONT_DIR`, shared with Love Story Timeline). */
const PRINT_FONTS = join(RENDERERS, "love_story_timeline", "fonts");

function pyTable(name: string): Record<string, string[]> {
  const body = py.match(new RegExp(`^${name} = \\{([\\s\\S]*?)^\\}`, "m"));
  if (!body) throw new Error(`png_renderer.py has no ${name}`);
  const rows: Record<string, string[]> = {};
  for (const row of body[1]!.matchAll(/"(\w+)":\s*\(([^)]*)\)/g)) {
    rows[row[1]!] = row[2]!.split(",").map((part) => part.trim().replace(/^"|"$/g, ""));
  }
  return rows;
}

function pyNumber(name: string): number {
  const match = py.match(new RegExp(`^${name}\\s*=\\s*([\\d.]+)`, "m"));
  if (!match) throw new Error(`png_renderer.py has no ${name}`);
  return Number(match[1]);
}

const css = (theme: string) => readFileSync(join(__dirname, `${theme}-theme.module.css`), "utf8");

function rule(source: string, selector: string): string {
  const match = source.match(new RegExp(`(?:^|\\n)\\s*\\.${selector}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`no .${selector} rule`);
  return match[1]!;
}

function prop(body: string, property: string): string | undefined {
  return body.match(new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+);`))?.[1]?.trim();
}

const px = (value: string | undefined) => (value === undefined ? NaN : parseFloat(value));

/** serif, sans or mono, as the print's `_kind` reads a DejaVu file name. */
const fileKind = (file: string) => (file.includes("Mono") ? "mono" : file.includes("Serif") ? "serif" : "sans");
const fileItalic = (file: string) => /Italic|Oblique/.test(file);

/** serif, sans or mono, from the selector's own font-family or the sheet's. */
function cssKind(source: string, body: string): string {
  const family = prop(body, "font-family") ?? prop(rule(source, "sheet"), "font-family")!;
  return family.includes("--font-mono") ? "mono" : family.includes("--font-serif") ? "serif" : "sans";
}

const TITLES = pyTable("TITLE_LAYOUT");
const DEDICATIONS = pyTable("DEDICATION_LAYOUT");
const CSS_FILE: Record<string, string> = {
  player: "player",
  ledger: "ledger",
  ephemeris: "ephemeris",
  contactsheet: "contact-sheet",
  label: "label",
  award: "award",
  sleeve: "sleeve",
  mosaic: "mosaic",
};

describe("titles, preview against print", () => {
  it("covers every theme", () => {
    expect(Object.keys(TITLES).sort()).toEqual(Object.keys(CSS_FILE).sort());
  });

  for (const [theme, [file, size, lines, weight]] of Object.entries(TITLES)) {
    it(`${theme}: same size, weight, kind and number of lines`, () => {
      const source = css(CSS_FILE[theme]!);
      const title = rule(source, "title");
      expect(Number(size)).toBe(px(prop(title, "font-size")));
      // The weight only reaches the Arabic face; DejaVu's weight is its file.
      expect(Number(weight)).toBe(Number(prop(title, "font-weight") ?? 400));
      expect(fileKind(file!)).toBe(cssKind(source, title));
      if (theme === "sleeve") {
        expect(Number(lines)).toBe(Number(prop(title, "-webkit-line-clamp")));
        expect(pyNumber("SLEEVE_TITLE_LINE_HEIGHT")).toBe(Number(prop(title, "line-height")));
      } else {
        expect(Number(lines)).toBe(1);
        expect(prop(title, "white-space")).toBe("nowrap");
        expect(prop(title, "text-overflow")).toBe("ellipsis");
      }
    });
  }

  it("shrinks to 80% of the design size before cutting", () => {
    expect(pyNumber("TITLE_MIN_SCALE")).toBe(0.8);
  });
});

describe("dedications, preview against print", () => {
  /** [CSS file, the dedication's selector]. */
  const SELECTOR: Record<string, [string, string]> = {
    player: ["player", "message"],
    ledger: ["ledger", "dedication"],
    ephemeris: ["ephemeris", "dedication"],
    contactsheet: ["contact-sheet", "caption"],
    label: ["label", "dedication"],
    award: ["award", "plaqueDedication"],
    mosaic: ["mosaic", "dedication"],
  };
  /** `max-width: 56ch` is a width only the preview's own font can measure;
   * these are the widths measured in the browser on 18 Oct 2026. If the CSS
   * or the font changes, re-measure and update both sides. */
  const MEASURED_56CH: Record<string, number> = { ledger: 528.3, ephemeris: 544.7, label: 475.5 };

  it("covers every theme with a written dedication (Sleeve's is ring text)", () => {
    expect(Object.keys(DEDICATIONS).sort()).toEqual(Object.keys(SELECTOR).sort());
  });

  for (const [theme, [width, size, lineHeight, fontFile]] of Object.entries(DEDICATIONS)) {
    it(`${theme}: same width, size, line height, kind and slant, and it wraps`, () => {
      const [file, selector] = SELECTOR[theme]!;
      const source = css(file);
      const body = rule(source, selector);
      expect(Number(size)).toBe(px(prop(body, "font-size")));
      // Italic in the print exactly where the preview's is, in the same kind.
      expect(fileItalic(fontFile!)).toBe(prop(body, "font-style") === "italic");
      expect(fileKind(fontFile!)).toBe(cssKind(source, body));
      // Ledger and Ephemeris set no line height and inherit the page's 1.5.
      expect(Number(lineHeight)).toBe(prop(body, "line-height") === undefined ? 1.5 : Number(prop(body, "line-height")));
      expect(prop(body, "white-space")).toBeUndefined(); // never `nowrap`: the preview wraps it in full
      expect(prop(body, "-webkit-line-clamp")).toBeUndefined();

      let expected: number;
      if (theme in MEASURED_56CH) {
        expect(prop(body, "max-width")).toBe("56ch");
        expected = MEASURED_56CH[theme]!;
      } else if (theme === "player") {
        expected = 800 - 2 * px(prop(rule(source, "bottom"), "inset-inline"));
      } else if (theme === "contactsheet") {
        expected = px(prop(body, "max-width"));
      } else if (theme === "award") {
        const plaque = rule(source, "plaque");
        const [, padX] = prop(plaque, "padding")!.split(/\s+/).map(parseFloat);
        expected = 1200 - 2 * px(prop(plaque, "inset-inline")) - 2 * padX!;
      } else {
        const [, padX] = prop(rule(source, "heroBody"), "padding")!.split(/\s+/).map(parseFloat);
        expected = px(prop(rule(source, "hero"), "width")) - 2 * padX!;
      }
      expect(Number(width)).toBe(expected);
    });
  }
});

describe("Arabic, preview against print", () => {
  const globals = readFileSync(join(__dirname, "..", "..", "..", "..", "app", "globals.css"), "utf8");
  const PUBLIC_FONTS = join(__dirname, "..", "..", "..", "..", "..", "public", "fonts");

  /** The site's @font-face for `family` whose file is Arabic. */
  function arabicFace(family: string): { file: string; weight: string; range: string[] } {
    for (const block of globals.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
      const src = block.match(/url\("\/fonts\/([^"]+)"\)/)?.[1];
      if (!block.includes(`font-family: "${family}"`) || !src?.includes("arabic")) continue;
      return {
        file: src,
        weight: prop(block, "font-weight")!,
        range: prop(block, "unicode-range")!.split(",").map((part) => part.trim()),
      };
    }
    throw new Error(`globals.css has no Arabic face for ${family}`);
  }

  const FACES = Object.fromEntries([...py.match(/^ARABIC_FACES = \{([^}]*)\}/m)![1]!.matchAll(/"(\w+)":\s*"([^"]+)"/g)].map((m) => [m[1]!, m[2]!]));
  const SITE = { serif: arabicFace("Heartfolio Serif"), sans: arabicFace("Heartfolio Sans") };
  /** In the CSS's Arabic range but also in Latin text (U+2010 is a hyphen),
   * so the print does not switch face for them. */
  const SHARED_WITH_LATIN = ["U+200C-200E", "U+2010-2011", "U+204F", "U+2E41"];

  it("draws serif slots in the site's Arabic serif and sans slots in its Arabic sans", () => {
    expect(FACES).toEqual({ serif: SITE.serif.file, sans: SITE.sans.file });
  });

  it("uses the site's own files, byte for byte", () => {
    for (const file of Object.values(FACES)) {
      expect(readFileSync(join(PRINT_FONTS, file)).equals(readFileSync(join(PUBLIC_FONTS, file)))).toBe(true);
    }
  });

  it("switches face for exactly the code points the site draws in Arabic, less shared punctuation", () => {
    const print = py.match(/^ARABIC_UNICODE_RANGE = "([^"]+)"/m)![1]!.split(",").map((part) => part.trim());
    expect(SITE.serif.range).toEqual(SITE.sans.range);
    expect(print).toEqual(SITE.sans.range.filter((part) => !SHARED_WITH_LATIN.includes(part)));
  });

  it("clamps weights to the faces' declared range", () => {
    const [low, high] = py.match(/^ARABIC_WEIGHT_RANGE = \((\d+), (\d+)\)/m)!.slice(1);
    expect(SITE.serif.weight).toBe(`${low} ${high}`);
    expect(SITE.sans.weight).toBe(`${low} ${high}`);
  });
});

describe("the footer artist's gap before HEARTFOLIO", () => {
  it.each(["ledger", "ephemeris", "contact-sheet", "label", "sleeve", "mosaic"])(
    "is the print's FOOT_GAP in %s's preview",
    (theme) => {
      const gap = rule(css(theme), "foot").match(/(?:^|;|\s)gap\s*:\s*([\d.]+)px;/)?.[1];
      expect(Number(gap)).toBe(pyNumber("FOOT_GAP"));
    },
  );
});
