import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { timelineThemes } from "./themes";
import { timelineMessages } from "./messages";
import { resolveModuleText } from "@/lib/studio/i18n";

/**
 * THE TYPOGRAPHY TOKENS NAME FONTS THAT ARE REAL.
 *
 * For a long time they named 'Fraunces', 'Inter' and 'JetBrains Mono' while
 * no `@font-face` carried any of those names (the site registers the same
 * files as "Heartfolio Serif"/"Heartfolio Sans", and JetBrains Mono had no
 * file at all). Nothing errored: the browser quietly drew its own fallback, so
 * the Studio preview and the live page looked different on every device and
 * never like what the tokens promised. A font name in a stylesheet is checked
 * by nothing, so this test checks it.
 *
 * Two guards:
 *  1. every family a token names (bar CSS generics and the fallbacks listed
 *     below) is registered in globals.css, and its file exists;
 *  2. each option's KIND of face matches what the print draws for it
 *     (png_renderer.py `FONT_FILES`: italic where the print is italic,
 *     monospace where it is mono, and so on). The faces differ (the print
 *     uses DejaVu); the kind must not drift.
 */
const typography = timelineThemes.axes.find((axis) => axis.id === "typography");
if (!typography || typography.kind === "range") throw new Error("timelineThemes must define a discrete typography axis");
const OPTIONS = typography.options;

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-monospace"]);
/** System faces a stack may name AFTER the real one, as its fallback. */
const SYSTEM_FALLBACKS = new Set(["Georgia"]);

const tokens = (option: (typeof OPTIONS)[number]) => option.tokens as Record<string, string>;
const familiesOf = (stack: string) => stack.split(",").map((family) => family.trim().replace(/^['"]|['"]$/g, ""));

const globalsCss = readFileSync("src/app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const registered = new Map<string, string[]>();
for (const [, body] of globalsCss.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
  const family = body!.match(/font-family:\s*["']([^"']+)["']/)?.[1];
  const src = body!.match(/url\(["']([^"']+)["']\)/)?.[1];
  if (family && src) registered.set(family, [...(registered.get(family) ?? []), src]);
}

function backendFile(...parts: string[]): string {
  const configured = process.env.HEARTFOLIO_BACKEND_PATH;
  const roots = [
    ...(configured ? [isAbsolute(configured) ? configured : join(process.cwd(), configured)] : []),
    join(process.cwd(), "..", "backend"),
    join(process.cwd(), "..", "..", "backend", "backend"),
  ];
  for (const root of roots) {
    const file = join(root, ...parts);
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  // Throws rather than skipping: a skipped comparison reports drift as green.
  throw new Error(`Cannot locate ${parts.join("/")}. Set HEARTFOLIO_BACKEND_PATH. Tried: ${roots.join(" | ")}`);
}

describe("typography tokens name registered fonts", () => {
  it("covers the four options", () => {
    expect(OPTIONS.map((option) => option.id)).toEqual(["serif-classic", "modern", "script", "typewriter"]);
  });

  it.each(OPTIONS.map((option) => [option.id, option] as const))("%s: every named family is registered", (id, option) => {
    for (const token of ["--poster-heading-font", "--poster-body-font"]) {
      const stack = tokens(option)[token];
      expect(stack, `${id} has no ${token}`).toBeTruthy();
      for (const family of familiesOf(stack!)) {
        if (GENERIC.has(family) || SYSTEM_FALLBACKS.has(family)) continue;
        expect(registered.has(family), `${id} ${token} names "${family}", which no @font-face in globals.css registers`).toBe(true);
      }
    }
  });

  it("starts every stack with a registered face, never a system one", () => {
    for (const option of OPTIONS) {
      for (const token of ["--poster-heading-font", "--poster-body-font"]) {
        const first = familiesOf(tokens(option)[token]!)[0]!;
        expect(registered.has(first), `${option.id} ${token} starts with "${first}"`).toBe(true);
      }
    }
  });

  it("has a font file on disk for every registered family the tokens use", () => {
    const used = new Set(
      OPTIONS.flatMap((option) => ["--poster-heading-font", "--poster-body-font"].flatMap((token) => familiesOf(tokens(option)[token]!)))
    );
    for (const family of used) {
      if (!registered.has(family)) continue;
      for (const src of registered.get(family)!) {
        expect(existsSync(join("public", src)), `${family} points at ${src}, which does not exist in public/`).toBe(true);
      }
    }
  });

  it("ships JetBrains Mono's licence beside the font, as the OFL requires", () => {
    expect(existsSync("public/fonts/JetBrainsMono-OFL.txt")).toBe(true);
  });

  it("declares a heading style of normal or italic for every option", () => {
    for (const option of OPTIONS) expect(["normal", "italic"], option.id).toContain(tokens(option)["--poster-heading-style"]);
  });
});

describe("the preview's kind of face matches the print's, option by option", () => {
  const python = backendFile("apps", "delivery", "product_renderers", "love_story_timeline", "png_renderer.py");
  const printFiles = (id: string) => {
    const row = python.match(new RegExp(`"${id}":\\s*\\{"heading":\\s*"([^"]+)",\\s*"body":\\s*"([^"]+)"\\}`));
    if (!row) throw new Error(`png_renderer.py FONT_FILES has no row for ${id}`);
    return { heading: row[1]!, body: row[2]! };
  };
  const kind = (file: string) => (/Mono/.test(file) ? "monospace" : /Sans/.test(file) ? "sans-serif" : "serif");

  /** Which kind of face a stack resolves to, from its first registered family. */
  const previewKind = (stack: string) => {
    const first = familiesOf(stack)[0]!;
    if (first === "JetBrains Mono") return "monospace";
    if (first === "Heartfolio Sans") return "sans-serif";
    if (first === "Heartfolio Serif") return "serif";
    return "unknown";
  };

  it.each(OPTIONS.map((option) => [option.id, option] as const))("%s: heading kind and slant match the print", (id, option) => {
    const print = printFiles(id);
    expect(previewKind(tokens(option)["--poster-heading-font"]!), `${id} heading`).toBe(kind(print.heading));
    expect(tokens(option)["--poster-heading-style"], `${id} slant`).toBe(/Italic/.test(print.heading) ? "italic" : "normal");
  });

  /**
   * KNOWN, DELIBERATELY ACCEPTED (owner, 12 Oct 2026): Serif Classic pairs a
   * serif heading with a SANS body in the preview and on the live page (the
   * Fraunces + Inter pairing the tokens always intended), while the print sets
   * its body in DejaVu Serif. Listed by name so it is a logged limit, not a
   * surprise: the test fails if this set changes in EITHER direction, so
   * closing the gap (or opening a new one) has to touch this line.
   */
  const KNOWN_BODY_KIND_GAPS = ["serif-classic"];

  it("has exactly the known body-kind gaps and no others", () => {
    const gaps = OPTIONS.filter(
      (option) => previewKind(tokens(option)["--poster-body-font"]!) !== kind(printFiles(option.id).body)
    ).map((option) => option.id);
    expect(gaps).toEqual(KNOWN_BODY_KIND_GAPS);
  });
});

describe("the poster CSS applies the tokens", () => {
  const css = readFileSync("src/lib/studio/product-modules/love-story-timeline/renderer.module.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("sets the heading font AND its slant on the names and on each milestone's title", () => {
    for (const selector of [".names", ".eventTitle"]) {
      const escaped = selector.replace(/\./g, "\\.");
      const rule = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      expect(rule, `${selector} must use the heading font`).toMatch(/font-family:\s*var\(--poster-heading-font/);
      expect(rule, `${selector} must use the heading style`).toMatch(/font-style:\s*var\(--poster-heading-style/);
    }
  });

  it("sets the body font on the poster", () => {
    expect(css).toMatch(/\.poster\s*\{[^}]*font-family:\s*var\(--poster-body-font/);
  });
});

describe("the italic option is named for what it draws", () => {
  // The print has always drawn DejaVu Serif ITALIC for this option and the
  // preview slants a serif: there is no script or cursive face. It was labelled
  // "Romantic Script", which promised one; it is "Romantic Italic". The option
  // id stays "script" because saved projects store it.
  const italic = OPTIONS.find((option) => option.id === "script");

  it("keeps the stored id and its slant", () => {
    expect(italic).toBeDefined();
    expect(tokens(italic!)["--poster-heading-style"]).toBe("italic");
  });

  it("is 'Romantic Italic' in English", () => {
    expect(resolveModuleText(italic!.label, "en", timelineMessages)).toBe("Romantic Italic");
  });

  it.each([
    ["fr", "Italique romantique", /script|cursive|manuscrit/i],
    ["ar", "مائل رومانسي", /خط يد|مخطوط/],
  ] as const)("is %s '%s', a real translation that does not promise a script", (locale, expected, promisesScript) => {
    const label = resolveModuleText(italic!.label, locale, timelineMessages);
    expect(label).toBe(expected);
    expect(label).not.toMatch(promisesScript);
  });
});

describe("the typography selector is translated, not an English island", () => {
  // French and Arabic once defined NO typography labels, so the heading and all
  // four options silently fell back to English inside a localized Studio. Look
  // in each locale's OWN dictionary (not through the fallback, which would pass
  // with English) for the heading and every option the axis offers.
  const keys = [typography.label, ...OPTIONS.map((option) => option.label)];

  it.each(["fr", "ar"] as const)("has its own %s entry, different from the English, for every label", (locale) => {
    for (const key of keys) {
      const own = timelineMessages[locale]?.[key];
      expect(own, `${locale} is missing ${key}`).toBeTruthy();
      expect(own, `${locale} ${key} is just the English`).not.toBe(timelineMessages.en![key]);
    }
  });

  it.each(["fr", "ar"] as const)("gives the four %s options four different names", (locale) => {
    const names = OPTIONS.map((option) => resolveModuleText(option.label, locale, timelineMessages));
    expect(new Set(names).size).toBe(OPTIONS.length);
  });
});
