import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Reasons I Love You's fonts are real and self-hosted (the same guard
 * `typography-fonts.test.ts` gives Love Story Timeline): every family a gift
 * names is registered here, its file exists, its licence ships beside it, and
 * nothing is fetched from Google. The three families whose licences reserve
 * their names (Merienda, Limelight, Marcellus) are the original, unmodified
 * files, not subsets.
 */
const CSS = readFileSync("src/components/live-reasons/reasons-keepsake.module.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const FONTS_DIR = "public/fonts/reasons";

const faces = [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => ({
  family: body!.match(/font-family:\s*"([^"]+)"/)![1]!,
  src: body!.match(/url\("([^"]+)"\)/)![1]!,
  unicodeRange: /unicode-range/.test(body!),
}));
const registered = new Set(faces.map((face) => face.family));

const stacks = [...CSS.matchAll(/--(?:display|note|ui|signature):\s*([^;]+);/g)].map(([, stack]) => stack!);
const firstFamily = (stack: string) => stack.split(",")[0]!.trim().replace(/^"|"$/g, "");

const LICENCES: Record<string, string> = {
  "Young Serif": "LICENSE-youngserif.txt",
  Gaegu: "LICENSE-gaegu.txt",
  Manrope: "LICENSE-manrope.txt",
  Merienda: "LICENSE-merienda.txt",
  Mali: "LICENSE-mali.txt",
  Limelight: "LICENSE-limelight.txt",
  Spectral: "LICENSE-spectral.txt",
  Marcellus: "LICENSE-marcellus.txt",
  "Zilla Slab": "LICENSE-zillaslab.txt",
  Sora: "LICENSE-sora.txt",
  "Homemade Apple": "LICENSE-homemadeapple.txt",
};

describe("the gifts' fonts", () => {
  it("are the prototype's eleven families, each registered", () => {
    expect([...registered].sort()).toEqual(Object.keys(LICENCES).sort());
  });

  it("every gift's display, note, interface and signature face is a registered family", () => {
    expect(stacks.length).toBeGreaterThanOrEqual(13); // 4 gifts x 3 + the signature
    for (const stack of stacks) expect(registered, stack).toContain(firstFamily(stack));
  });

  it("fall through to the site's Arabic faces for Arabic letters", () => {
    for (const stack of stacks) expect(stack, stack).toMatch(/"Heartfolio (Serif|Sans)"/);
  });

  it("every file exists, is served from our own origin, and has its licence beside it", () => {
    for (const face of faces) {
      expect(face.src.startsWith("/fonts/reasons/"), face.src).toBe(true);
      expect(existsSync(join("public", face.src)), face.src).toBe(true);
    }
    for (const [family, licence] of Object.entries(LICENCES)) {
      const text = readFileSync(join(FONTS_DIR, licence), "utf8");
      expect(text, family).toMatch(family === "Homemade Apple" ? /Apache License/ : /SIL Open Font License/);
    }
  });

  it("ships the three reserved-name families whole, not as subsets", () => {
    for (const family of ["Merienda", "Limelight", "Marcellus"]) {
      const face = faces.find((f) => f.family === family)!;
      expect(face.src, family).toMatch(/\.ttf$/);
      expect(face.unicodeRange, family).toBe(false);
      expect(readFileSync(join(FONTS_DIR, LICENCES[family]!), "utf8"), family).toMatch(/Reserved Font Name/);
    }
  });

  it("never loads from Google", () => {
    expect(CSS).not.toMatch(/googleapis|gstatic/);
  });
});
