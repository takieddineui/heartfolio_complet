import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { timelineThemes } from "./themes";

/**
 * LOVE STORY TIMELINE'S ARABIC: THE PRINT DRAWS IT IN THE PREVIEW'S FACES.
 *
 * No DejaVu Serif face has an Arabic glyph, so Serif Classic printed every
 * Arabic slot as empty boxes and Romantic Italic its headings (18 Oct 2026).
 * The print (`love_story_timeline/png_renderer.py`) now draws Arabic in the
 * face each typography's preview token gives it: "Heartfolio Serif" draws
 * Arabic in Noto Kufi, "Heartfolio Sans" in Noto Naskh (`globals.css`), and
 * JetBrains Mono has none, so Typewriter keeps DejaVu Sans Mono. This reads
 * `ARABIC_FONT_ROLES` and the rest from the Python and fails if they drift.
 */
function backendRenderers(): string {
  const configured = process.env.HEARTFOLIO_BACKEND_PATH;
  const roots = [
    ...(configured ? [isAbsolute(configured) ? configured : join(process.cwd(), configured)] : []),
    join(process.cwd(), "..", "backend"),
    join(process.cwd(), "..", "..", "backend", "backend"),
  ];
  for (const root of roots) {
    const dir = join(root, "apps", "delivery", "product_renderers");
    if (existsSync(join(dir, "love_story_timeline", "png_renderer.py"))) return dir;
  }
  // Throws rather than skipping: a skipped comparison would report drift as green.
  throw new Error("Cannot locate the backend's renderers. Set HEARTFOLIO_BACKEND_PATH. Tried: " + roots.join(" | "));
}

const RENDERERS = backendRenderers();
const py = readFileSync(join(RENDERERS, "love_story_timeline", "png_renderer.py"), "utf8");
const PRINT_FONTS = join(RENDERERS, "love_story_timeline", "fonts");
const PUBLIC_FONTS = join(__dirname, "..", "..", "..", "..", "..", "public", "fonts");
const globals = readFileSync(join(__dirname, "..", "..", "..", "..", "app", "globals.css"), "utf8");

const prop = (body: string, property: string) => body.match(new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+);`))?.[1]?.trim();

/** The site's @font-face for `family` whose file is Arabic. */
function arabicFace(family: string): { file: string; weight: string; range: string[] } {
  for (const block of globals.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
    const src = block.match(/url\("\/fonts\/([^"]+)"\)/)?.[1];
    if (!block.includes(`font-family: "${family}"`) || !src?.includes("arabic")) continue;
    return { file: src, weight: prop(block, "font-weight")!, range: prop(block, "unicode-range")!.split(",").map((p) => p.trim()) };
  }
  throw new Error(`globals.css has no Arabic face for ${family}`);
}
const SITE = { serif: arabicFace("Heartfolio Serif"), sans: arabicFace("Heartfolio Sans") };

/** `ARABIC_FONT_ROLES` from the Python: typography -> role -> "serif" | "sans" | null. */
const ROLES: Record<string, Record<string, string | null>> = Object.fromEntries(
  [...py.match(/^ARABIC_FONT_ROLES = \{([\s\S]*?)^\}/m)![1]!.matchAll(/"([\w-]+)":\s*\{([^}]*)\}/g)].map((m) => [
    m[1]!,
    Object.fromEntries([...m[2]!.matchAll(/"(\w+)":\s*(?:"(\w+)"|None)/g)].map((r) => [r[1]!, r[2] ?? null])),
  ]),
);
const FACES = Object.fromEntries([...py.match(/^ARABIC_FACES = \{([^}]*)\}/m)![1]!.matchAll(/"(\w+)":\s*"([^"]+)"/g)].map((m) => [m[1]!, m[2]!]));

/** Which Arabic face a preview font token resolves to. */
function tokenKind(token: string): string | null {
  const first = token.split(",")[0]!.trim().replace(/['"]/g, "");
  if (first === "Heartfolio Serif") return "serif";
  if (first === "Heartfolio Sans") return "sans";
  if (first === "JetBrains Mono") return null; // no Arabic: the print keeps DejaVu Sans Mono
  throw new Error(`no Arabic mapping for the token ${token}`);
}

const typography = timelineThemes.axes.find((axis) => axis.id === "typography");
if (!typography || typography.kind === "range") throw new Error("timelineThemes must define a discrete typography axis");
const OPTIONS = typography.options;

describe("Love Story Timeline's Arabic, preview against print", () => {
  it("covers every typography the Studio offers", () => {
    expect(Object.keys(ROLES).sort()).toEqual(OPTIONS.map((option) => option.id).sort());
  });

  for (const option of OPTIONS) {
    it(`${option.id}: headings and body draw Arabic in the face their preview tokens give it`, () => {
      const tokens = option.tokens as Record<string, string>;
      expect(ROLES[option.id]).toEqual({
        heading: tokenKind(tokens["--poster-heading-font"]!),
        body: tokenKind(tokens["--poster-body-font"]!),
      });
    });
  }

  it("draws serif Arabic in the site's Arabic serif and sans Arabic in its Arabic sans, byte for byte", () => {
    expect(FACES).toEqual({ serif: SITE.serif.file, sans: SITE.sans.file });
    for (const file of Object.values(FACES)) {
      expect(readFileSync(join(PRINT_FONTS, file)).equals(readFileSync(join(PUBLIC_FONTS, file)))).toBe(true);
    }
  });

  it("switches face for exactly the code points the site draws in Arabic, less shared punctuation", () => {
    const print = py.match(/^ARABIC_UNICODE_RANGE = "([^"]+)"/m)![1]!.split(",").map((p) => p.trim());
    const shared = ["U+200C-200E", "U+2010-2011", "U+204F", "U+2E41"];
    expect(print).toEqual(SITE.sans.range.filter((part) => !shared.includes(part)));
  });

  it("clamps weights to the faces' declared range", () => {
    const [low, high] = py.match(/^ARABIC_WEIGHT_RANGE = \((\d+), (\d+)\)/m)!.slice(1);
    expect(SITE.serif.weight).toBe(`${low} ${high}`);
    expect(SITE.sans.weight).toBe(`${low} ${high}`);
  });
});
