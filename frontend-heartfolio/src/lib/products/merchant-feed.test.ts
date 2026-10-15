import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import type { ApiDeliveryPack, ApiProduct, ApiProductDetail } from "@/lib/api/products";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import { mergeProductList, toCatalogProduct, type CatalogProduct } from "./catalog";
import { getProductBySlug } from "./registry";
import { buildMerchantFeedItems, renderMerchantFeed } from "./merchant-feed";

function apiProduct(slug: string, overrides: Partial<ApiProduct> = {}): ApiProduct {
  return {
    id: slug,
    slug,
    i18nKey: "loveStoryTimeline",
    category: "timeline",
    status: "available",
    startingPriceCents: 800,
    order: 1,
    tags: [],
    ...overrides,
  } as ApiProduct;
}

function pack(productId: string, slug: string, priceCents: number): ApiDeliveryPack {
  return {
    id: `${productId}-${slug}`,
    productId,
    slug,
    nameKey: `packs.${slug}.name`,
    descriptionKey: `packs.${slug}.description`,
    priceCents,
    currency: "USD",
    includedTargets: [],
    status: "active",
  } as ApiDeliveryPack;
}

const loveStoryPacks: ApiDeliveryPack[] = [
  pack("love-story-timeline", "printable", 1800),
  pack("love-story-timeline", "wallpaper", 800),
  pack("love-story-timeline", "live", 1200),
  pack("love-story-timeline", "complete", 3000),
];

function detail(slug: string, packs: ApiDeliveryPack[], overrides: Partial<ApiProduct> = {}): ApiProductDetail {
  return { product: apiProduct(slug, overrides), deliveryPacks: packs };
}

const copy = () => ({
  name: "Love Story Timeline",
  shortDescription: "Your milestones, told as one continuous story.",
  offeringName: (key: string) => `Offering ${key}`,
});

/** Detail-hydrated, the way the route supplies it. */
const live = (overrides: Partial<ApiProduct> = {}): CatalogProduct[] => [
  toCatalogProduct(getProductBySlug("love-story-timeline")!, detail("love-story-timeline", loveStoryPacks, overrides)),
];

/**
 * The real six-pack production shape (five-tier structure plus the
 * standalone `wallpaper` pack left active alongside it) — the same fixture
 * `catalog.test.ts`'s `getProductPageOfferings` tests use, confirmed against
 * the live backend on 2026-09-22.
 */
const fiveTierPacksWithStandaloneWallpaper: ApiDeliveryPack[] = [
  pack("love-story-timeline", "complete", 3999),
  pack("love-story-timeline", "digital-plus-wallpaper", 2099),
  pack("love-story-timeline", "live", 1599),
  pack("love-story-timeline", "printable", 2299),
  pack("love-story-timeline", "printable-plus-wallpaper", 2799),
  pack("love-story-timeline", "wallpaper", 799),
];

const liveFiveTier = (packs: ApiDeliveryPack[] = fiveTierPacksWithStandaloneWallpaper): CatalogProduct[] => [
  toCatalogProduct(getProductBySlug("love-story-timeline")!, detail("love-story-timeline", packs)),
];

describe("buildMerchantFeedItems", () => {
  it("emits one item per purchasable pack, grouped by product", () => {
    const items = buildMerchantFeedItems(live(), "en", copy);

    expect(items.length).toBeGreaterThan(0);
    // Every item belongs to the same product, and each has a distinct id —
    // Merchant Center rejects a feed with duplicate `g:id` values outright.
    expect(new Set(items.map((i) => i.itemGroupId))).toEqual(new Set(["love-story-timeline"]));
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it("prices each item individually rather than repeating the 'from' figure", () => {
    // The reason items are per-pack: Merchant Center requires an item's
    // price to match the page it links to. One item carrying the cheapest
    // price would mismatch every other pack.
    const prices = new Set(buildMerchantFeedItems(live(), "en", copy).map((i) => i.price));
    expect(prices.size).toBeGreaterThan(1);
  });

  it("formats prices as Merchant Center expects, not as the brand shows them", () => {
    for (const item of buildMerchantFeedItems(live(), "en", copy)) {
      expect(item.price).toMatch(/^\d+\.\d{2} [A-Z]{3}$/);
      expect(item.price).not.toContain("$");
    }
  });

  it("points every item at its own locale's page", () => {
    for (const item of buildMerchantFeedItems(live(), "fr", copy)) {
      expect(item.link).toContain("/fr/products/love-story-timeline");
    }
  });

  it("omits a product Django has taken off sale", () => {
    expect(buildMerchantFeedItems(live({ status: "disabled" }), "en", copy)).toEqual([]);
  });

  it("omits products with no live backend row", () => {
    // A registry-only product has static marketing prices and no Django
    // truth. Listing it would send a shopper to something unbuyable.
    expect(buildMerchantFeedItems(mergeProductList([]), "en", copy)).toEqual([]);
  });

  it("contributes nothing when handed list-only products", () => {
    // The bug that produced an empty feed on the first attempt: the list
    // response has no delivery packs, and launch products carry no static
    // offerings, so a list-only product has nothing to price. Asserted so
    // the route's detail-hydration step cannot be dropped silently.
    const listOnly = mergeProductList([apiProduct("love-story-timeline")]);
    expect(listOnly[0]?.offerings).toEqual([]);
    expect(buildMerchantFeedItems(listOnly, "en", copy)).toEqual([]);
  });

  it("never lists a withdrawn product (§1, §14)", () => {
    // The guarantee is upstream: the route feeds this from
    // `getCatalogProducts()`, which reaches the registry through
    // `getAllProducts()` and therefore cannot return a hidden product —
    // even when Django still lists it, as it does for heart-map.
    //
    // song-poster is hidden again (status alone didn't work as a kill
    // switch — Django's own unchanged "available" row for it overrode the
    // registry's status — so `hidden: true` was added), so heart-map's
    // exclusion — the thing this test actually verifies — is joined by
    // song-poster's own, both via the same `getAllProducts()` filter,
    // regardless of which two products this test's synthetic Django
    // response names.
    const fromCatalog = mergeProductList([apiProduct("love-story-timeline"), apiProduct("heart-map")]);
    expect(fromCatalog.map((p) => p.slug)).toEqual(["love-story-timeline", "reasons-i-love-you", "graduation-keepsake"]);

    const slugs = buildMerchantFeedItems(fromCatalog, "en", copy).map((i) => i.itemGroupId);
    // song-poster added back: hidden again (see above), same as
    // where-we-met/heart-map — a withdrawn product regardless of whether
    // it was ever part of this test's own `fromCatalog` input.
    //
    // star-map: deleted from the registry outright now, not merely
    // hidden — still correctly absent from the feed for the same
    // reason (never in `getAllProducts()` at all).
    for (const withdrawn of ["star-map", "where-we-met", "heart-map", "song-poster"]) {
      expect(slugs).not.toContain(withdrawn);
    }
  });

  it("declares that no GTIN or MPN exists", () => {
    // A made-to-order digital keepsake has no manufacturer identifier.
    // Without this, Merchant Center warns on every item.
    for (const item of buildMerchantFeedItems(live(), "en", copy)) {
      expect(item.identifierExists).toBe(false);
    }
  });
});

/**
 * §"Merchant Center Feed: Close the Combo-Pack + Standalone-Wallpaper Gap"
 * — this fixed two real gaps: the two wallpaper-combo packs had no feed
 * item at all (same root cause as the product page's missing cards), and
 * the standalone `wallpaper` pack rendered as its own item even though it
 * is no longer advertised as its own card anywhere else. Built directly
 * from `product.deliveryPacks`, not from `offerings`/`getProductPageOfferings`
 * — see the header comment on `PACK_SLUG_TO_FEED_OFFERING_KEY` in
 * merchant-feed.ts for why those two are the wrong data source for a feed.
 */
describe("buildMerchantFeedItems — wallpaper-combo packs and the standalone wallpaper pack", () => {
  it("gives each wallpaper-combo pack its own feed item, at its own real price", () => {
    const items = buildMerchantFeedItems(liveFiveTier(), "en", copy);
    const ids = items.map((i) => i.id);

    expect(ids).toContain("love-story-timeline--digital-plus-wallpaper");
    expect(ids).toContain("love-story-timeline--printable-plus-wallpaper");

    const digitalCombo = items.find((i) => i.id === "love-story-timeline--digital-plus-wallpaper")!;
    expect(digitalCombo.price).toBe("20.99 USD");
    expect(digitalCombo.title).toBe("Love Story Timeline — Offering digital_plus_wallpaper");

    const printableCombo = items.find((i) => i.id === "love-story-timeline--printable-plus-wallpaper")!;
    expect(printableCombo.price).toBe("27.99 USD");
    expect(printableCombo.title).toBe("Love Story Timeline — Offering printable_plus_wallpaper");
  });

  it("excludes the standalone wallpaper pack even though it is active and directly purchasable", () => {
    const items = buildMerchantFeedItems(liveFiveTier(), "en", copy);
    expect(items.map((i) => i.id)).not.toContain("love-story-timeline--wallpaper");
  });

  it("emits exactly the five feed-mapped items, not all six active packs", () => {
    const items = buildMerchantFeedItems(liveFiveTier(), "en", copy);
    expect(items).toHaveLength(5);
    expect(new Set(items.map((i) => i.id)).size).toBe(5);
  });

  it("the standalone wallpaper pack's own status has no bearing on the exclusion", () => {
    // Regression guard: the exclusion is slug-based (no entry in
    // PACK_SLUG_TO_FEED_OFFERING_KEY), not an accidental side effect of a
    // status check — disabling the pack must not change anything else.
    const withDisabledWallpaper = fiveTierPacksWithStandaloneWallpaper.map((p) =>
      p.slug === "wallpaper" ? { ...p, status: "disabled" as const } : p
    );
    const items = buildMerchantFeedItems(liveFiveTier(withDisabledWallpaper), "en", copy);
    expect(items).toHaveLength(5);
    expect(items.map((i) => i.id)).not.toContain("love-story-timeline--wallpaper");
  });
});

describe("the two new combo offering keys resolve to real, translated copy", () => {
  // Not the raw key, and not invented text — reused verbatim from Love
  // Story Timeline's own Studio module pack names (already shipped,
  // already translated), added to the same generic `Products.offerings`
  // dictionary the original four types already use.
  const locales = { en, fr, ar } as const;

  it.each(Object.entries(locales))("%s", (locale, messages) => {
    const t = createTranslator({
      locale,
      messages,
      namespace: "Products.offerings",
    } as Parameters<typeof createTranslator>[0]) as (key: string) => string;

    expect(t("digital_plus_wallpaper.name")).not.toBe("digital_plus_wallpaper.name");
    expect(t("printable_plus_wallpaper.name")).not.toBe("printable_plus_wallpaper.name");
    expect(t("digital_plus_wallpaper.name").length).toBeGreaterThan(0);
    expect(t("printable_plus_wallpaper.name").length).toBeGreaterThan(0);
  });
});

describe("buildMerchantFeedItems — the Printable + Digital combo", () => {
  const comboCatalog: ApiDeliveryPack[] = [
    pack("love-story-timeline", "live", 1599),
    pack("love-story-timeline", "printable", 2299),
    pack("love-story-timeline", "printable-plus-digital", 3599),
  ];

  it("gives the combo its own feed item at its own real price, with translated copy", () => {
    const items = buildMerchantFeedItems(liveFiveTier(comboCatalog), "en", copy);
    const combo = items.find((i) => i.id === "love-story-timeline--printable-plus-digital")!;

    expect(combo.price).toBe("35.99 USD");
    expect(combo.title).toBe("Love Story Timeline — Offering printable_plus_digital");
    expect(items).toHaveLength(3);
  });

  it.each(Object.entries({ en, fr, ar }))("%s has real copy for the combo, not the raw key", (locale, messages) => {
    const t = createTranslator({
      locale,
      messages,
      namespace: "Products.offerings",
    } as Parameters<typeof createTranslator>[0]) as (key: string) => string;

    expect(t("printable_plus_digital.name")).not.toBe("printable_plus_digital.name");
    expect(t("printable_plus_digital.description")).not.toBe("printable_plus_digital.description");
  });
});

describe("renderMerchantFeed", () => {
  it("produces a Google-namespaced RSS document", () => {
    const xml = renderMerchantFeed(buildMerchantFeedItems(live(), "en", copy), "en");

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns:g="http://base.google.com/ns/1.0"');
    expect(xml).toContain("<g:item_group_id>");
    expect(xml).toContain("<g:identifier_exists>no</g:identifier_exists>");
  });

  it("escapes characters that would otherwise break the document", () => {
    const items = buildMerchantFeedItems(live(), "en", () => ({
      ...copy(),
      shortDescription: 'Dates & "words" <you> both use',
    }));
    const xml = renderMerchantFeed(items, "en");

    expect(xml).toContain("&amp;");
    expect(xml).toContain("&quot;");
    expect(xml).toContain("&lt;you&gt;");
    // The raw, unescaped form must not survive anywhere in the output.
    expect(xml).not.toContain('"words"');
  });

  it("stays valid when nothing is on sale", () => {
    const xml = renderMerchantFeed([], "en");
    expect(xml).toContain("<channel>");
    expect(xml).not.toContain("<item>");
  });
});
