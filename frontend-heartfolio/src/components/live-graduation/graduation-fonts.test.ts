import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Graduation Keepsake's fonts are real and self-hosted, the same guard
 * Reasons I Love You's fonts have: every family a journey names is registered,
 * its file exists, its licence ships beside it, Arabic falls through to the
 * site's own faces, and nothing is fetched from Google. The four families
 * whose licences reserve their names are the original, unmodified files.
 */
const CSS = readFileSync("src/components/live-graduation/graduation-keepsake.module.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const DIR = "public/fonts/graduation";

const faces = [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => ({
  family: body!.match(/font-family:\s*"([^"]+)"/)![1]!,
  src: body!.match(/url\("([^"]+)"\)/)![1]!,
  subset: /unicode-range/.test(body!),
}));
const registered = new Set(faces.map((face) => face.family));
const stacks = [...CSS.matchAll(/--(?:display|body|mono|hand):\s*([^;]+);/g)].map(([, stack]) => stack!);
const first = (stack: string) => stack.split(",")[0]!.trim().replace(/^"|"$/g, "");

const LICENCES: Record<string, string> = {
  "Red Hat Display": "LICENSE-redhatdisplay.txt",
  "IBM Plex Mono": "LICENSE-ibmplexmono.txt",
  "Gochi Hand": "LICENSE-gochihand.txt",
  "Exo 2": "LICENSE-exo2.txt",
  "Share Tech Mono": "LICENSE-sharetechmono.txt",
  "Press Start 2P": "LICENSE-pressstart2p.txt",
  VT323: "LICENSE-vt323.txt",
  "Bodoni Moda": "LICENSE-bodonimoda.txt",
  "Libre Franklin": "LICENSE-librefranklin.txt",
  Alegreya: "LICENSE-alegreya.txt",
  "Alegreya Sans": "LICENSE-alegreyasans.txt",
};
const RESERVED = ["IBM Plex Mono", "Gochi Hand", "Share Tech Mono", "Press Start 2P"];

describe("the journeys' fonts", () => {
  it("are the prototype's eleven families, each registered", () => {
    expect([...registered].sort()).toEqual(Object.keys(LICENCES).sort());
  });

  it("every journey's display, body and mono face (and the handwriting) is a registered family", () => {
    expect(stacks.length).toBe(16); // 5 journeys x 3 + the handwriting
    for (const stack of stacks) expect(registered, stack).toContain(first(stack));
  });

  it("fall through to the site's Arabic faces for Arabic letters", () => {
    for (const stack of stacks) expect(stack, stack).toMatch(/"Heartfolio (Serif|Sans)"/);
  });

  it("every file exists, is served from our own origin, and its licence ships beside it", () => {
    for (const face of faces) {
      expect(face.src.startsWith("/fonts/graduation/"), face.src).toBe(true);
      expect(existsSync(join("public", face.src)), face.src).toBe(true);
    }
    for (const [family, licence] of Object.entries(LICENCES)) {
      expect(readFileSync(join(DIR, licence), "utf8"), family).toMatch(/SIL Open Font License/);
    }
  });

  it("ships the four reserved-name families whole, not as subsets", () => {
    for (const family of RESERVED) {
      const own = faces.filter((f) => f.family === family);
      expect(own.length, family).toBeGreaterThan(0);
      for (const face of own) {
        expect(face.src, family).toMatch(/\.ttf$/);
        expect(face.subset, family).toBe(false);
      }
      const licence = readFileSync(join(DIR, LICENCES[family]!), "utf8");
      expect(licence.match(/Reserved Font Name/g)!.length, family).toBeGreaterThan(1);
    }
  });

  it("never loads from Google", () => {
    expect(CSS).not.toMatch(/googleapis|gstatic/);
  });
});
