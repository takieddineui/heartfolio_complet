// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { getProductCaptures } from "@/lib/captures/manifest";
import { GUIDES } from "@/lib/guides/registry";
import { GUIDE_COVERAGE_PENDING } from "@/lib/guides/coverage";
import { productModuleRegistry } from "@/lib/studio/product-modules/registry";
import { SITE_URL } from "@/lib/site-config";
import { getAllProducts, getAllProductsIncludingHidden } from "./registry";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import { freemiusMappedKeys, printableProductsFromSeed, seedPacks } from "../../../test/seed-catalog";

/**
 * THE PRODUCT CHECKLIST, AUTOMATED WHERE IT CAN BE (27 Oct 2026). The steps
 * are in ADDING-A-PRODUCT.md; this fails for a visible product that skipped
 * one, and for a withdrawn product still showing anywhere. Other guards cover
 * the rest in depth (captures budgets, pack labels, lengths, fonts): this is
 * the one place that names every product against every step.
 */
const MESSAGES = { en, fr, ar } as Record<string, { Products: Record<string, Record<string, unknown>> }>;
const visible = getAllProducts();
const withdrawn = getAllProductsIncludingHidden().filter((p) => !visible.some((v) => v.id === p.id));
const packs = seedPacks();
const mapped = freemiusMappedKeys();
const printable = printableProductsFromSeed();
const recorder = readFileSync("scripts/captures/record.mjs", "utf8");
const recordedProducts = JSON.parse(/^const PRODUCTS = (\[[^\]]*\]);/m.exec(recorder)![1]!.replace(/'/g, '"')) as string[];
const livePayload = readFileSync("src/components/live/live-payload.tsx", "utf8");
const sitemapUrls = new Set(sitemap().map((e) => e.url));
const guideProducts = new Set(GUIDES.flatMap((g) => g.products));

describe.each(visible.map((p) => [p.id, p] as const))("visible product %s", (id, product) => {
  it("has a Studio module", () => {
    expect(productModuleRegistry[product.slug] ?? productModuleRegistry[id]).toBeDefined();
  });

  it("is named and described in every language, with its page's title and descriptions", () => {
    for (const locale of ["en", "fr", "ar"]) {
      const copy = MESSAGES[locale]!.Products[product.i18nKey] as Record<string, unknown> & { meta?: Record<string, string> };
      expect(copy, `${locale}: Products.${product.i18nKey}`).toBeDefined();
      for (const key of ["name", "shortDescription"]) expect(copy[key], `${locale}.${key}`).toBeTruthy();
      for (const key of ["title", "description", "descriptionNoPrice"]) expect(copy.meta?.[key], `${locale}.meta.${key}`).toBeTruthy();
    }
  });

  it("is sold: active packs in the seed, every one with a Freemius plan", () => {
    const active = (packs[product.slug] ?? []).filter((p) => p.status === "active");
    expect(active.length, "active packs in seed_catalog.py").toBeGreaterThan(0);
    for (const pack of active) expect(mapped.has(`${product.slug}:${pack.slug}`), `${product.slug}:${pack.slug} in FREEMIUS_PLAN_MAPPING`).toBe(true);
  });

  it("carries the `printable` tag exactly when it sells a Printable pack", () => {
    expect(product.tags.includes("printable")).toBe(printable.has(product.slug));
  });

  it("has real captures in every language, from the recording script", () => {
    expect(recordedProducts, "record.mjs PRODUCTS").toContain(id);
    expect(recorder, "record.mjs SCENARIOS").toContain(`"${id}": {`);
    for (const locale of ["en", "fr", "ar"]) {
      const captures = getProductCaptures(id, locale);
      expect(captures?.loop && captures.poster && captures.qr, `${locale} captures`).toBeTruthy();
    }
  });

  it("opens on the live page when it sells the Digital version", () => {
    if (!(packs[product.slug] ?? []).some((p) => p.slug === "live" && p.status === "active")) return;
    // Love Story Timeline is the page's default branch.
    if (id !== "love-story-timeline") expect(livePayload, "live-payload.tsx dispatch").toContain(`productId: "${id}"`);
  });

  it("is in the sitemap, in every language", () => {
    for (const locale of ["en", "fr", "ar"]) expect(sitemapUrls.has(`${SITE_URL}/${locale}/products/${product.slug}`), locale).toBe(true);
  });

  it("is linked from a guide, or its guide is planned (GUIDE_COVERAGE_PENDING, with a reason)", () => {
    expect(guideProducts.has(id) || Boolean(GUIDE_COVERAGE_PENDING[id])).toBe(true);
  });
});

describe("the pending-guide list", () => {
  it("names only visible products not yet in a guide", () => {
    for (const id of Object.keys(GUIDE_COVERAGE_PENDING)) {
      expect(visible.some((p) => p.id === id), `${id} is visible`).toBe(true);
      expect(guideProducts.has(id), `${id} now has a guide: remove it from the list`).toBe(false);
    }
  });
});

describe.each(withdrawn.map((p) => [p.id, p] as const))("withdrawn product %s", (id, product) => {
  it("is sold nowhere: no active pack in the seed", () => {
    expect((packs[product.slug] ?? []).filter((p) => p.status === "active")).toEqual([]);
  });

  it("shows nowhere: not in the sitemap, a guide or the recordings", () => {
    for (const url of sitemapUrls) expect(url).not.toContain(`/products/${product.slug}`);
    expect(guideProducts.has(id)).toBe(false);
    expect(recordedProducts).not.toContain(id);
    expect(getProductCaptures(id, "en")).toBeNull();
  });
});

it("knows at least one withdrawn product, so the withdrawal checks really run", () => {
  expect(withdrawn.map((p) => p.id)).toContain("heart-map");
});
