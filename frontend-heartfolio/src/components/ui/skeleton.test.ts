import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * ---------------------------------------------------------------------
 * EVERY DATA-FETCHING ROUTE NEEDS A LOADING STATE
 * ---------------------------------------------------------------------
 * Every route reading the catalog is `force-dynamic`, so Next holds the
 * response until the fetch resolves. Without a `loading.tsx` that gap is a
 * blank page — indistinguishable from a broken one on a slow connection,
 * and the slow connections are exactly the ones that get it.
 *
 * This is a coverage test rather than a rendering one: the failure mode is
 * a new dynamic route being added without a skeleton, which nothing else
 * would notice.
 */
function routeFiles(dir: string, name: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...routeFiles(full, name));
    else if (entry === name) found.push(full);
  }
  return found;
}

describe("loading states", () => {
  it("gives every catalog-fetching route a skeleton", () => {
    const dynamicPages = routeFiles("src/app", "page.tsx").filter((file) => {
      const source = readFileSync(file, "utf8");
      return source.includes("getCatalogProducts") || source.includes("productDetailForRequest");
    });

    expect(dynamicPages.length).toBeGreaterThan(0);

    const missing = dynamicPages.filter((page) => {
      // `dirname`, not string slicing on "/". `join` emits backslashes on
      // Windows, so `lastIndexOf("/")` returned -1 there, `dir` became ""
      // and every route looked skeleton-less — including the five that
      // plainly have one. The test was only ever correct on POSIX.
      const dir = dirname(page);
      try {
        readFileSync(join(dir, "loading.tsx"), "utf8");
        return false;
      } catch {
        return true;
      }
    });

    expect(missing).toEqual([]);
  });

  it("announces itself to assistive technology", () => {
    // A silent skeleton is invisible to anyone not looking at the screen;
    // they get no signal that anything is happening at all.
    for (const file of routeFiles("src/app", "loading.tsx")) {
      expect(readFileSync(file, "utf8"), file).toContain("SkeletonRegion");
    }

    const primitives = readFileSync("src/components/ui/skeleton.tsx", "utf8");
    expect(primitives).toContain('aria-busy="true"');
    expect(primitives).toContain("sr-only");
  });

  it("does not reimplement reduced-motion handling", () => {
    // globals.css already neutralises animation under
    // prefers-reduced-motion; a second implementation here would be one
    // more place for the two to disagree.
    // Comments stripped: the file explains this exact rule in prose, and a
    // check that matched its own reasoning would fail on the wording rather
    // than the code. Third time this trap has appeared in this codebase —
    // §15's RTL guard and §21's AR check both hit it too.
    const primitives = readFileSync("src/components/ui/skeleton.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(primitives).toContain("animate-pulse");
    expect(primitives).not.toContain("prefers-reduced-motion");
  });
});
