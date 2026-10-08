import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ---------------------------------------------------------------------
 * THE STUDIO MUST NOT ASSUME LEFT-TO-RIGHT (§15)
 * ---------------------------------------------------------------------
 * `<html dir>` is set to `rtl` for Arabic, so logical Tailwind utilities
 * (`border-e`, `end-4`, `text-start`) flip automatically while their
 * physical counterparts (`border-r`, `right-4`, `text-left`) do not. Four
 * places got this wrong: the sidebar divider drew down the outer edge of the
 * screen instead of between the panel and the canvas, the checkout close
 * button sat in the far corner, and two text alignments faced away from
 * their content.
 *
 * Nothing about that breaks functionally, which is exactly why it survived —
 * it is invisible unless someone opens the Studio in Arabic. A test is
 * cheaper than remembering to.
 *
 * BLOCK-DIRECTION SIDES ARE FINE. `border-t` and `border-b` are top and
 * bottom; they do not flip under `dir="rtl"` and are not flagged.
 */

/** `border-r`, `pl-3`, `right-4`, `text-left`, `rounded-l`, `ml-auto`, … */
const PHYSICAL = new RegExp(
  "^(?:[a-z0-9-]+:)*(?:" +
    "border-[lr]|" +
    "(?:left|right)-[\\w./[\\]%-]+|" +
    "(?:pl|pr|ml|mr)-[\\w./[\\]%-]+|" +
    "text-(?:left|right)|" +
    "rounded-[lr][a-z]*|" +
    "-?translate-x-[\\w./[\\]%-]+" +
    ")$"
);

function studioFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...studioFiles(full));
    else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts")) found.push(full);
  }
  return found;
}

function physicalClassesIn(source: string): string[] {
  const cleaned = source
    // Comments explain this rule and would otherwise trip it.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    // Import specifiers are quoted strings too, and directory names like
    // "left-panel/..." would read as utilities.
    .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?$/gm, "");

  const offenders: string[] = [];
  for (const match of cleaned.matchAll(/"([^"\n]*)"/g)) {
    const literal = match[1] ?? "";
    for (const token of literal.split(/\s+/)) {
      if (token && PHYSICAL.test(token)) offenders.push(token);
    }
  }
  return offenders;
}

describe("Studio RTL safety", () => {
  it("uses logical sides everywhere in the Studio", () => {
    const offenders: string[] = [];

    for (const file of studioFiles("src/components/studio")) {
      for (const token of physicalClassesIn(readFileSync(file, "utf8"))) {
        offenders.push(`${file}: ${token}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("recognises a physical side when it sees one", () => {
    // Without this, a broken regex would make the test above pass silently
    // and the guard would be worthless.
    expect(physicalClassesIn('<div className="lg:border-r p-4" />')).toEqual(["lg:border-r"]);
    expect(physicalClassesIn('<div className="absolute right-4 top-4" />')).toEqual(["right-4"]);
    expect(physicalClassesIn('<div className="text-left" />')).toEqual(["text-left"]);
    // Tailwind fractions contain a slash. The first version of this
    // pattern excluded "/" to avoid matching import paths like
    // "left-panel/...", which meant `left-1/2` slipped through — found
    // when the §20 watermark used exactly that. Import lines are stripped
    // above, so the slash can be allowed here safely.
    expect(physicalClassesIn('<div className="absolute left-1/2" />')).toEqual(["left-1/2"]);

    // And does not flag what is genuinely fine.
    expect(physicalClassesIn('<div className="border-b border-t text-end ps-4 end-4" />')).toEqual([]);
  });

  it("uses logical sides in the product renderers' CSS too", () => {
    // The original §15 pass covered Studio chrome only, and missed the
    // poster itself — `renderer.module.css` was still using `text-align:
    // left`, `border-left` and `padding-left`. That is worse than editor
    // furniture getting it wrong: those pixels are the delivered artwork,
    // and they now go into six print files rather than one.
    const PHYSICAL_CSS =
      /(?:^|[\s;{])(?:text-align\s*:\s*(?:left|right)|(?:border|padding|margin)-(?:left|right)\s*:|(?:^|[\s;{])(?:left|right)\s*:)/;

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith(".css")) {
          const css = readFileSync(full, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
          for (const line of css.split("\n")) {
            if (PHYSICAL_CSS.test(line)) offenders.push(`${full}: ${line.trim()}`);
          }
        }
      }
    };
    walk("src/lib/studio/product-modules");

    expect(offenders).toEqual([]);
  });
});
