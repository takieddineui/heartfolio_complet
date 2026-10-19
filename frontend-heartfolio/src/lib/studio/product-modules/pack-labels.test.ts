import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveModuleText } from "@/lib/studio/i18n";
import { packForUnits, unitSavingsCents, unitSelectionModel } from "@/lib/commerce/pack-presentation";
import type { DeliveryPack } from "@/types/commerce";
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

interface SeededPack {
  slug: string;
  priceCents: number;
  status: string;
}

/** product slug -> its packs, from `CATALOG`'s `"packs"` lists, whose tuples
 *  read `("<slug>", <price cents>, <targets>, "<status>")`. */
function seededPacks(): Map<string, SeededPack[]> {
  const source = readFileSync(join(backendRoot(), "seed_catalog.py"), "utf8");
  const products = new Map<string, SeededPack[]>();
  const chunks = source.split(/\n {8}"slug": "/).slice(1);
  for (const chunk of chunks) {
    const slug = chunk.slice(0, chunk.indexOf('"'));
    const packsAt = chunk.indexOf('"packs": [');
    expect(packsAt, `${slug} has a packs list`).toBeGreaterThan(-1);
    const packs = [...chunk.slice(packsAt).matchAll(/\(\s*"([a-z0-9-]+)",\s*(\d+),[\s\S]*?"(active|disabled)",?\s*\)/g)];
    products.set(slug, packs.map((m) => ({ slug: m[1]!, priceCents: Number(m[2]), status: m[3]! })));
  }
  return products;
}

const SEEDED_PACKS = seededPacks();
const SEEDED = new Map([...SEEDED_PACKS].map(([product, packs]) => [product, packs.map((pack) => pack.slug)]));

describe("the seed, as read here", () => {
  it("finds every product and Song Poster's seven packs", () => {
    expect([...SEEDED.keys()]).toEqual(expect.arrayContaining(["love-story-timeline", "song-poster", "reasons-i-love-you"]));
    expect(SEEDED.get("song-poster")).toEqual([
      "printable",
      "wallpaper",
      "printable-plus-wallpaper",
      "live",
      "printable-plus-digital",
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

/**
 * SONG POSTER SELLS LOVE STORY TIMELINE'S COMBO MODEL (19 Oct 2026, owner's
 * decision): Printable, Digital and Printable + Digital; `complete` and the
 * wallpaper combos are disabled, never deleted. The checkout's Printable /
 * Digital toggle appears for any product whose active packs include the combo
 * (`unitSelectionModel`), so this builds the packs the API would send (active
 * only) from the seed itself.
 */
describe("song-poster's checkout", () => {
  const active: DeliveryPack[] = SEEDED_PACKS.get("song-poster")!
    .filter((pack) => pack.status === "active")
    .map((pack) => ({
      id: pack.slug,
      productId: "song-poster",
      nameKey: `packs.${pack.slug}.name`,
      descriptionKey: `packs.${pack.slug}.description`,
      priceCents: pack.priceCents,
      currency: "USD",
      includedTargets: [],
    }));

  it("sells exactly Printable, Digital and Printable + Digital", () => {
    expect(active.map((pack) => [pack.id, pack.priceCents])).toEqual([
      ["printable", 2299],
      ["live", 1599],
      ["printable-plus-digital", 3599],
    ]);
  });

  it("shows the Printable / Digital toggle, both ticked meaning the combo", () => {
    expect(unitSelectionModel(active)?.map((option) => [option.unit, option.pack.id])).toEqual([
      ["printable", "printable"],
      ["digital", "live"],
    ]);
    expect(packForUnits(active, ["printable", "digital"])?.id).toBe("printable-plus-digital");
    expect(unitSavingsCents(active, ["printable", "digital"])).toBe(2299 + 1599 - 3599);
  });
});
