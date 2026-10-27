// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every "/#section" link in the header and footer points at a section the
 * home page really has (27 Oct 2026). "Our Story" pointed at "/#why" for a
 * day after the "Why Heartfolio" section was removed: a link to nowhere.
 */
const SECTIONS = "src/components/sections";
const ids = new Set(
  readdirSync(SECTIONS)
    .filter((f) => f.endsWith(".tsx"))
    .flatMap((f) => [...readFileSync(`${SECTIONS}/${f}`, "utf8").matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]!))
);

describe("links to a section of the home page", () => {
  for (const file of ["src/components/layout/header.tsx", "src/components/layout/footer.tsx"]) {
    const anchors = [...readFileSync(file, "utf8").matchAll(/href: "\/#([\w-]+)"/g)].map((m) => m[1]!);
    it(`${file}: every one has its section`, () => {
      expect(anchors.length).toBeGreaterThan(0);
      for (const anchor of anchors) expect(ids.has(anchor), `#${anchor}`).toBe(true);
    });
  }
});
