import { describe, expect, it } from "vitest";
import { loadProductModule } from "./module-loader";
import type { ProductEntry } from "@/lib/products/types";
import { productModuleRegistry } from "./product-modules/registry";

/**
 * Fixture updated during the Phase 2 merge for two contract changes, both
 * deliberate (see `lib/products/product-id.ts` and `module-loader.ts`):
 *
 * 1. `ProductEntry` is now the Marketing App's — numeric `offerings[]`
 *    instead of a pre-formatted `startingPrice` string, and no
 *    `thumbnail` (the Studio never rendered it; it draws the lucide icon).
 * 2. Module resolution is keyed by the stable `id`, not the public `slug`,
 *    because Where We Met publishes as `where-we-met` while its module and
 *    Django catalog entry are both `heart-map`.
 *
 * Every assertion below is the original one; only the identity field the
 * fixture sets has changed.
 */
function makeProduct(overrides: Partial<ProductEntry> = {}): ProductEntry {
  return {
    id: "test-product",
    slug: "test-product",
    i18nKey: "product.test",
    category: "timeline",
    currency: "USD",
    ogImage: null,
    icon: "",
    featured: false,
    status: "available",
    order: 0,
    tags: [],
    faqCount: 0,
    offerings: [
      { type: "digital", i18nKey: "digital", price: 12, currency: "USD", available: true, media: null },
    ],
    ...overrides,
  };
}

describe("loadProductModule", () => {
  it("resolves the real Love Story Timeline module generically, with no product-specific code in the loader itself (N.2)", async () => {
    const product = makeProduct({ id: "love-story-timeline", slug: "love-story-timeline", i18nKey: "product.timeline" });
    const resolved = await loadProductModule(product);

    expect(resolved.productId).toBe("love-story-timeline");
    expect(resolved.renderer.kind).toBe("component");
  });

  it("resolves a product whose public slug differs from its stable id (where-we-met -> heart-map)", async () => {
    // The exact integration boundary: the URL says `where-we-met`, the
    // module registry and the Django catalog both say `heart-map`.
    const product = makeProduct({ id: "heart-map", slug: "where-we-met", i18nKey: "whereWeMet", category: "map" });
    const resolved = await loadProductModule(product);

    expect(resolved.productId).toBe("heart-map");
    expect(resolved.renderer.kind).toBe("component");
  });

  it("falls back to the default empty mock module for a product with no registered Product Module", async () => {
    const product = makeProduct({ id: "some-future-product", slug: "some-future-product" });
    const resolved = await loadProductModule(product);

    expect(resolved.productId).toBe("some-future-product");
    expect(resolved.renderer.kind).toBe("unset");
    expect(resolved.formSchema.sections).toEqual([]);
  });

  it("derives the fallback base price from the product's cheapest available offering", async () => {
    const product = makeProduct({
      id: "priced-fallback",
      slug: "priced-fallback",
      offerings: [
        { type: "printable", i18nKey: "printable", price: 30, currency: "USD", available: true, media: null },
        { type: "digital", i18nKey: "digital", price: 24.5, currency: "USD", available: true, media: null },
      ],
    });
    const resolved = await loadProductModule(product);
    expect(resolved.pricing.basePriceCents).toBe(2450);
  });

  it("a newly-registered mock product module resolves through the exact same call, unmodified (N.6)", async () => {
    productModuleRegistry["__loader_test_mock__"] = async () => ({
      formSchema: { sections: [] },
      themes: { axes: [] },
      renderer: { kind: "unset" as const },
      pricing: { currency: "USD", basePriceCents: 0, rules: [] },
      delivery: { mode: "export" as const, export: { targets: {} } },
      messages: {},
      createInitialState: () => ({}),
      createInitialThemeSelections: () => ({}),
    });

    try {
      const product = makeProduct({ id: "__loader_test_mock__", slug: "__loader_test_mock__" });
      const resolved = await loadProductModule(product);
      expect(resolved.productId).toBe("__loader_test_mock__");
    } finally {
      delete productModuleRegistry["__loader_test_mock__"];
    }
  });
});
