import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveModuleText } from "@/lib/studio/i18n";
import { productModuleRegistry } from "./registry";

/**
 * EVERY SEEDED PACK HAS A NAME (19 Oct 2026). The checkout shows a pack by
 * `moduleT("packs.<slug>.name")` (the key `seed_catalog.py` stores), which
 * falls back to English and then to the RAW KEY: Song Poster's pack cards read
 * `packs.live.name`. The slugs are read from the seed itself, so a pack added
 * there without labels fails here.
 */
function backendRoot(): string {
  const configured = process.env.HEARTFOLIO_BACKEND_PATH;
  const candidates = [
    ...(configured ? [isAbsolute(configured) ? configured : join(process.cwd(), configured)] : []),
    join(process.cwd(), "..", "backend"),
    join(process.cwd(), "..", "..", "backend", "backend"),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "seed_catalog.py"))) return candidate;
  }
  throw new Error(`Cannot locate the Django backend. Set HEARTFOLIO_BACKEND_PATH. Tried: ${candidates.join(" | ")}`);
}

/** product slug -> its pack slugs, from `CATALOG`'s `"packs"` lists, whose
 *  tuples open with `("<slug>", <price cents>`. */
function seededPacks(): Map<string, string[]> {
  const source = readFileSync(join(backendRoot(), "seed_catalog.py"), "utf8");
  const products = new Map<string, string[]>();
  const chunks = source.split(/\n {8}"slug": "/).slice(1);
  for (const chunk of chunks) {
    const slug = chunk.slice(0, chunk.indexOf('"'));
    const packsAt = chunk.indexOf('"packs": [');
    expect(packsAt, `${slug} has a packs list`).toBeGreaterThan(-1);
    products.set(slug, [...chunk.slice(packsAt).matchAll(/\(\s*"([a-z0-9-]+)",\s*\d+/g)].map((m) => m[1]!));
  }
  return products;
}

const SEEDED = seededPacks();

describe("the seed, as read here", () => {
  it("finds every product and Song Poster's six packs", () => {
    expect([...SEEDED.keys()]).toEqual(expect.arrayContaining(["love-story-timeline", "song-poster", "reasons-i-love-you"]));
    expect(SEEDED.get("song-poster")).toEqual([
      "printable",
      "wallpaper",
      "printable-plus-wallpaper",
      "live",
      "digital-plus-wallpaper",
      "complete",
    ]);
  });
});

describe.each([...SEEDED.keys()])("%s", (product) => {
  it("has a name and description for every seeded pack in English, never the raw key", async () => {
    const loader = productModuleRegistry[product];
    expect(loader, `${product} has a Studio module`).toBeDefined();
    const { messages } = await loader!();
    for (const pack of SEEDED.get(product)!) {
      for (const key of [`packs.${pack}.name`, `packs.${pack}.description`]) {
        expect(resolveModuleText(key, "en", messages), key).not.toBe(key);
      }
    }
  });
});

describe("song-poster's packs", () => {
  it.each(["en", "fr", "ar"] as const)("are named and described in %s's own words", async (locale) => {
    const { messages } = await productModuleRegistry["song-poster"]!();
    for (const pack of SEEDED.get("song-poster")!) {
      for (const field of ["name", "description"]) {
        expect(messages[locale]?.[`packs.${pack}.${field}`], `${locale} packs.${pack}.${field}`).toBeTruthy();
      }
    }
  });
});
