import { readFileSync } from "node:fs";
import { join } from "node:path";
import { backendRoot } from "./backend-root";

/**
 * The products `seed_catalog.py` sells an ACTIVE Printable pack for. The
 * seed is the source of truth for which packs exist; the frontend's lists of
 * printable products (captures, the printable-gifts page) are pinned to it.
 */
export function printableProductsFromSeed(): Set<string> {
  const source = readFileSync(join(backendRoot(), "seed_catalog.py"), "utf8");
  const printable = new Set<string>();
  for (const chunk of source.split(/\n {8}"slug": "/).slice(1)) {
    const slug = chunk.slice(0, chunk.indexOf('"'));
    const packs = chunk.slice(chunk.indexOf('"packs": ['));
    if (/\(\s*"printable",\s*\d+,[\s\S]*?"active",?\s*\)/.test(packs.split(/\n {4}\},/)[0] ?? "")) printable.add(slug);
  }
  return printable;
}
