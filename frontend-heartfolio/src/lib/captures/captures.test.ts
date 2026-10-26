// @vitest-environment node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { getAllProducts } from "@/lib/products/registry";
import { CAPTURE_LOCALES } from "./capture-mode";

/**
 * THE STOREFRONT'S PRODUCT CAPTURES (26 Oct 2026): real recordings of each
 * product's live page with fictional samples, made by
 * `scripts/captures/record.mjs` into `public/captures/` with `manifest.json`.
 *
 * Collection cards used to fall back to an empty dark box for any product
 * without hand-drawn art (Reasons I Love You and Graduation Keepsake both
 * did). This fails if a visible product has no capture in some language, if
 * a file is missing or larger than its budget, or if the folder holds files
 * the manifest does not know (a stale capture would ship unnoticed).
 * Regenerate only when a product changes (owner's decision).
 */

const PUBLIC = join(process.cwd(), "public");
const CAPTURES = join(PUBLIC, "captures");

/** Budgets from the approved plan: loops about 450 KB (hard limit 600),
 *  stills light enough to sit on every card. */
const BUDGET = {
  loop: 600 * 1024,
  posterAvif: 60 * 1024,
  posterJpg: 120 * 1024,
  printAvif: 80 * 1024,
  printJpg: 160 * 1024,
  qrAvif: 60 * 1024,
  qrJpg: 120 * 1024,
};

interface FileEntry {
  src: string;
  bytes: number;
}
interface StillEntry {
  avif: FileEntry;
  jpg: FileEntry;
  width: number;
  height: number;
}
interface LocaleEntry {
  loop: (FileEntry & { width: number; height: number; seconds: number }) | null;
  poster: StillEntry | null;
  print: StillEntry | null;
  qr: StillEntry | null;
}
interface Manifest {
  products: Record<string, Record<string, LocaleEntry>>;
}

const manifest = JSON.parse(readFileSync(join(CAPTURES, "manifest.json"), "utf8")) as Manifest;

function backendRoot(): string {
  const configured = process.env.HEARTFOLIO_BACKEND_PATH;
  const candidates = [
    ...(configured ? [isAbsolute(configured) ? configured : join(process.cwd(), configured)] : []),
    join(process.cwd(), "..", "backend"),
  ];
  const found = candidates.find((candidate) => existsSync(join(candidate, "seed_catalog.py")));
  if (!found) throw new Error(`Cannot locate the Django backend. Set HEARTFOLIO_BACKEND_PATH. Tried: ${candidates.join(" | ")}`);
  return found;
}

/** Products the seed sells a Printable pack for: they get a print capture. */
function printableProducts(): Set<string> {
  const source = readFileSync(join(backendRoot(), "seed_catalog.py"), "utf8");
  const printable = new Set<string>();
  for (const chunk of source.split(/\n {8}"slug": "/).slice(1)) {
    const slug = chunk.slice(0, chunk.indexOf('"'));
    const packs = chunk.slice(chunk.indexOf('"packs": ['));
    if (/\(\s*"printable",\s*\d+,[\s\S]*?"active",?\s*\)/.test(packs.split(/\n {4}\},/)[0] ?? "")) printable.add(slug);
  }
  return printable;
}

const PRINTABLE = printableProducts();
const VISIBLE = getAllProducts().map((product) => product.id);

function expectFile(entry: FileEntry | undefined, budget: number, what: string) {
  expect(entry, what).toBeTruthy();
  const path = join(PUBLIC, entry!.src);
  expect(existsSync(path), `${what}: ${entry!.src} exists`).toBe(true);
  expect(statSync(path).size, `${what}: manifest size is the file's`).toBe(entry!.bytes);
  expect(entry!.bytes, `${what}: ${entry!.bytes} bytes, budget ${budget}`).toBeLessThanOrEqual(budget);
}

describe("product captures", () => {
  it("knows which products sell a print", () => {
    expect([...PRINTABLE].sort()).toEqual(["love-story-timeline", "song-poster"]);
  });

  describe.each(VISIBLE)("%s", (product) => {
    it.each(CAPTURE_LOCALES)("%s: a loop, its still, the QR card, and a print if one is sold", (locale) => {
      const entry = manifest.products[product]?.[locale];
      expect(entry, `${product}/${locale} is in the manifest`).toBeTruthy();

      expectFile(entry!.loop ?? undefined, BUDGET.loop, "loop");
      expect(entry!.loop!.src.endsWith(".mp4")).toBe(true);
      expect(entry!.loop!.seconds).toBeGreaterThanOrEqual(4);
      expect(entry!.loop!.seconds).toBeLessThanOrEqual(9);
      expect(entry!.loop!.width).toBe(600);

      expectFile(entry!.poster?.avif, BUDGET.posterAvif, "still (AVIF)");
      expectFile(entry!.poster?.jpg, BUDGET.posterJpg, "still (JPEG)");
      expectFile(entry!.qr?.avif, BUDGET.qrAvif, "QR card (AVIF)");
      expectFile(entry!.qr?.jpg, BUDGET.qrJpg, "QR card (JPEG)");

      if (PRINTABLE.has(product)) {
        expectFile(entry!.print?.avif, BUDGET.printAvif, "print (AVIF)");
        expectFile(entry!.print?.jpg, BUDGET.printJpg, "print (JPEG)");
      } else {
        expect(entry!.print, "no print for a product that sells none").toBeNull();
      }
    });
  });

  it("holds no file the manifest does not list", () => {
    const listed = new Set<string>(["/captures/manifest.json"]);
    for (const byLocale of Object.values(manifest.products)) {
      for (const entry of Object.values(byLocale)) {
        for (const item of [entry.loop, entry.poster?.avif, entry.poster?.jpg, entry.print?.avif, entry.print?.jpg, entry.qr?.avif, entry.qr?.jpg]) {
          if (item) listed.add(item.src);
        }
      }
    }
    const onDisk: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else onDisk.push(`/${path.slice(PUBLIC.length + 1).replaceAll("\\", "/")}`);
      }
    };
    walk(CAPTURES);
    expect(onDisk.filter((src) => !listed.has(src))).toEqual([]);
  });
});

describe("captureImageUrls (Product JSON-LD)", () => {
  it("gives the phone still, then the print for a printable product, in the page's language", async () => {
    const { captureImageUrls } = await import("./manifest");
    expect(captureImageUrls("song-poster", "fr", "https://x.test")).toEqual([
      "https://x.test/captures/fr/song-poster.jpg",
      "https://x.test/captures/fr/song-poster-print.jpg",
    ]);
    expect(captureImageUrls("reasons-i-love-you", "ar", "https://x.test")).toEqual([
      "https://x.test/captures/ar/reasons-i-love-you.jpg",
    ]);
    expect(captureImageUrls("heart-map", "en", "https://x.test")).toEqual([]);
  });
});

describe("where the captures are used", () => {
  const source = (path: string) => readFileSync(path, "utf8");

  it("cards, the product hero and the formats pictures show captures, not drawn stand-ins", () => {
    for (const path of ["src/components/product/product-collection.tsx", "src/components/product/product-view.tsx", "src/components/product/offering-visual.tsx"]) {
      expect(source(path), path).not.toContain("KeepsakeVisual");
    }
    expect(source("src/components/product/product-collection.tsx")).toContain('mode="hover"');
    expect(source("src/components/product/product-view.tsx")).toContain('mode="inView"');
  });

  it("the formats pictures no longer draw the unsold wallpaper and Complete formats", () => {
    const visual = source("src/components/product/offering-visual.tsx");
    expect(visual).not.toMatch(/type === "(wallpaper|complete_pack)"/);
  });

  it("every share card carries the product captures", () => {
    for (const path of ["src/app/[locale]/opengraph-image.tsx", "src/app/[locale]/products/opengraph-image.tsx", "src/app/[locale]/products/[slug]/opengraph-image.tsx"]) {
      expect(source(path), path).toContain("captureStillDataUrl");
      expect(source(path), path).toMatch(/stills/);
    }
  });

  it("the Product JSON-LD names its images", () => {
    expect(source("src/app/[locale]/products/[slug]/page.tsx")).toContain("image: captureImageUrls(product.id, locale, SITE_URL)");
  });
});
