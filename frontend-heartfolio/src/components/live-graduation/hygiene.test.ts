import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Rules this page must keep, asserted on the SOURCE because each is the kind
 * of regression that renders perfectly and breaks somewhere else: the Studio
 * embeds this component, so a `position: fixed` or a write to <body> breaks the
 * Studio and not the page; a physical `left`/`right` is correct in English and
 * wrong in Arabic; a stray Google Fonts link is a third-party request on a page
 * a graduate opens on their phone.
 */

const ROOT = join(process.cwd(), "src", "components", "live-graduation");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

const all = files(ROOT).filter((f) => !/\.test\.tsx?$/.test(f));
const css = all.filter((f) => f.endsWith(".css"));
const code = all.filter((f) => /\.tsx?$/.test(f));
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (f: string) => strip(readFileSync(f, "utf8"));

describe("embedding (the Studio's Live tab shares this component)", () => {
  it("positions nothing against the window", () => {
    for (const f of css) expect(read(f), relative(ROOT, f)).not.toMatch(/position:\s*fixed/);
  });

  it("uses no viewport-height units, which would ignore the frame it is in", () => {
    for (const f of css) expect(read(f), relative(ROOT, f)).not.toMatch(/\d(vh|svh|dvh|lvh)\b/);
  });

  it("never reads or writes the document's <html> or <body>", () => {
    for (const f of code) {
      expect(read(f), relative(ROOT, f)).not.toMatch(/document\.(body|documentElement)|classList\.(add|remove|toggle)\(\s*["']hold/);
    }
  });

  it("never listens to the window's scroll (observers rooted at the frame's own scroller instead)", () => {
    for (const f of code) expect(read(f), relative(ROOT, f)).not.toMatch(/addEventListener\(\s*["']scroll["']/);
  });
});

describe("right-to-left", () => {
  it("has no physical left/right in the CSS", () => {
    const physical = /(^|[\s;{])(margin|padding|border)-(left|right)\s*:|(^|[\s;{])(left|right)\s*:|text-align:\s*(left|right)\b|float:\s*(left|right)/m;
    for (const f of css) expect(read(f), relative(ROOT, f)).not.toMatch(physical);
  });
});

describe("fonts", () => {
  it("links no third-party font service", () => {
    for (const f of [...css, ...code]) expect(read(f), relative(ROOT, f)).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });

  it("declares every face in the journey's own module, from a file that exists, with its licence beside it", () => {
    const publicFonts = join(process.cwd(), "public", "fonts");
    for (const f of css) {
      for (const match of readFileSync(f, "utf8").matchAll(/url\("\/fonts\/([^"]+)"\)/g)) {
        expect(existsSync(join(publicFonts, match[1]!)), `${match[1]} is missing from public/fonts`).toBe(true);
      }
    }
    const licences = readdirSync(publicFonts).filter((n) => /OFL/i.test(n));
    for (const family of ["RedHatDisplay", "IBMPlexMono", "GochiHand"]) {
      expect(licences.some((n) => n.startsWith(family)), `${family} licence`).toBe(true);
    }
  });

  it("keeps a journey's fonts out of the shell, so only the chosen journey's are loaded", () => {
    expect(readFileSync(join(ROOT, "live-graduation.module.css"), "utf8")).not.toMatch(/@font-face/);
    const airline = readFileSync(join(ROOT, "journeys", "airline", "airline.module.css"), "utf8");
    expect(airline).toMatch(/@font-face/);
  });

  it("loads journeys lazily", () => {
    const registry = readFileSync(join(ROOT, "journeys", "registry.ts"), "utf8");
    expect(registry).toMatch(/import\("\.\/airline"\)/);
    expect(registry).not.toMatch(/^import .* from "\.\/airline"/m);
  });
});

describe("honest copy", () => {
  it("makes no promise that someone will see the graduate's reply, and ships no reply UI yet", () => {
    for (const f of code) {
      const text = readFileSync(f, "utf8");
      expect(text, relative(ROOT, f)).not.toMatch(/everyone who wrote/i);
      expect(text, relative(ROOT, f)).not.toMatch(/localStorage/);
    }
  });

  it("carries nothing from the prototype's sample person", () => {
    for (const f of [...code, ...css]) expect(readFileSync(f, "utf8"), relative(ROOT, f)).not.toMatch(/\btoast\b.*talent|Maya|Chen|Copenhagen/);
  });
});
