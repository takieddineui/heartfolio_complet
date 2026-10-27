import { readFileSync } from "node:fs";
import { join } from "node:path";
import { backendRoot } from "./backend-root";

/**
 * What the backend sells, read from its files: `seed_catalog.py` (the source
 * of truth for products and packs) and the Freemius plan map. For tests that
 * pin a frontend list to the backend (captures, printable gifts, the product
 * checklist).
 */
export type SeedPack = { slug: string; status: "active" | "disabled" };

export function seedPacks(): Record<string, SeedPack[]> {
  const source = readFileSync(join(backendRoot(), "seed_catalog.py"), "utf8");
  const products: Record<string, SeedPack[]> = {};
  for (const chunk of source.split(/\n {8}"slug": "/).slice(1)) {
    const slug = chunk.slice(0, chunk.indexOf('"'));
    const packs = (chunk.slice(chunk.indexOf('"packs": [')).split(/\n {4}\},/)[0] ?? "");
    products[slug] = [...packs.matchAll(/\(\s*"([\w-]+)",\s*\d+,[\s\S]*?"(active|disabled)",?\s*\)/g)].map((m) => ({
      slug: m[1]!,
      status: m[2] as SeedPack["status"],
    }));
  }
  return products;
}

/** The products the seed sells an ACTIVE Printable pack for. */
export function printableProductsFromSeed(): Set<string> {
  return new Set(
    Object.entries(seedPacks())
      .filter(([, packs]) => packs.some((p) => p.slug === "printable" && p.status === "active"))
      .map(([slug]) => slug)
  );
}

/** Every `"<product>:<pack>"` key in `FREEMIUS_PLAN_MAPPING`. */
export function freemiusMappedKeys(): Set<string> {
  const source = readFileSync(join(backendRoot(), "apps", "commerce", "freemius_integration.py"), "utf8");
  const start = source.indexOf("FREEMIUS_PLAN_MAPPING");
  const block = source.slice(start, source.indexOf("\n}", start));
  return new Set([...block.matchAll(/^\s*"([\w-]+:[\w-]+)":\s*\{"plan_id"/gm)].map((m) => m[1]!));
}
