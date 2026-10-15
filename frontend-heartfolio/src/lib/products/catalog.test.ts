import { describe, expect, it } from "vitest";
import type { ApiDeliveryPack, ApiProduct, ApiProductDetail } from "@/lib/api/products";
import {
  getAllProducts,
  getAllProductsIncludingHidden,
  getAvailableOfferings,
  OCCASION_KEYS,
  getProductById,
  getProductBySlug,
  getProductsByOccasion,
} from "./registry";
import { toBackendProductId } from "./product-id";
import {
  getAvailableOccasions,
  getProductPageOfferings,
  mergeProductList,
  toCatalogProduct,
  toRegistryOnlyProduct,
  unmappedPackSlugs,
} from "./catalog";

/**
 * Fixtures are the exact rows from CATALOG-data-sheet.md — the same values
 * being entered into Django admin. If the sheet and these ever disagree,
 * one of them is wrong.
 */
const loveStoryPacks: ApiDeliveryPack[] = [
  pack("love-story-timeline", "printable", 1800, ["print-png"]),
  pack("love-story-timeline", "wallpaper", 800, ["story-png", "landscape-png"]),
  pack("love-story-timeline", "live", 1200, ["__live__"]),
  pack("love-story-timeline", "complete", 3000, [
    "story-png",
    "square-png",
    "landscape-png",
    "portrait-png",
    "print-png",
    "__live__",
  ]),
];

const whereWeMetPacks: ApiDeliveryPack[] = [
  pack("heart-map", "printable", 1800, ["print-png"]),
  pack("heart-map", "wallpaper", 800, ["story-png", "portrait-png"]),
  pack("heart-map", "complete", 2400, ["story-png", "square-png", "portrait-png", "print-png"]),
];

/**
 * The real five-tier structure PLUS the standalone `wallpaper` pack left
 * active alongside it (the Song Poster production shape, confirmed against
 * the live backend on 2026-09-22: `GET /api/v1/products/song-poster/`
 * returns exactly these six packs, all `status: "active"`). Prices match
 * the fixture `pack-presentation.test.ts` already uses for its own primary
 * three, plus the two combo packs and the standalone wallpaper pack this
 * file's own bug report is about.
 */
const fiveTierPacksWithStandaloneWallpaper: ApiDeliveryPack[] = [
  pack("love-story-timeline", "complete", 3999, ["__live__", "print-png", "story-png"]),
  pack("love-story-timeline", "digital-plus-wallpaper", 2099, ["__live__", "story-png"]),
  pack("love-story-timeline", "live", 1599, ["__live__"]),
  pack("love-story-timeline", "printable", 2299, ["print-png"]),
  pack("love-story-timeline", "printable-plus-wallpaper", 2799, ["print-png", "story-png"]),
  pack("love-story-timeline", "wallpaper", 799, ["story-png", "landscape-png"]),
];

function pack(productId: string, slug: string, priceCents: number, includedTargets: string[]): ApiDeliveryPack {
  return {
    id: `${productId}-${slug}`,
    productId,
    slug,
    nameKey: `packs.${slug}.name`,
    descriptionKey: `packs.${slug}.description`,
    priceCents,
    currency: "USD",
    includedTargets,
    status: "active",
  };
}

function apiProduct(slug: string, overrides: Partial<ApiProduct> = {}): ApiProduct {
  return {
    id: `uuid-${slug}`,
    slug,
    i18nKey: slug,
    category: "other",
    status: "available",
    startingPriceCents: 800,
    order: 1,
    tags: [],
    ...overrides,
  };
}

function detail(slug: string, packs: ApiDeliveryPack[]): ApiProductDetail {
  return { product: apiProduct(slug), deliveryPacks: packs };
}

describe("slug boundary", () => {
  it("keeps the public slug and the Django slug distinct", () => {
    // Read from the unfiltered registry: Where We Met is the only product
    // whose two identifiers differ, and it is now hidden (§1), so the
    // boundary it proves has to be asserted against the entry itself.
    const entry = getAllProductsIncludingHidden().find((p) => p.id === "heart-map")!;
    expect(entry.slug).toBe("where-we-met");
    expect(toBackendProductId(entry)).toBe("heart-map");
  });

  it("uses the same value for both where they genuinely coincide", () => {
    const entry = getProductBySlug("love-story-timeline")!;
    expect(toBackendProductId(entry)).toBe("love-story-timeline");
  });

  it("does not publish a product at the Django slug /products/heart-map", () => {
    expect(getProductBySlug("heart-map")).toBeUndefined();
  });
});

/**
 * §1/§14 — the requirement is that a hidden product behaves as if it does
 * not exist. These assert the *absence*, which is the part that fails
 * silently: a regression here doesn't throw, it just quietly republishes a
 * withdrawn product on the homepage or in the sitemap.
 */
describe("withdrawn products (§1, §14)", () => {
  // song-poster REMOVED from this list again on 15 Oct 2026: it is visible
  // (registry.ts), so the owner can test its Studio; it still has no
  // Freemius plan. The history below explains why it was here.
  //
  // song-poster ADDED BACK to this list: the Phase 2 "available" flip
  // (registry.ts's own comment on that entry) has itself been reverted —
  // `status` alone proved not to be a working kill switch (Django's own
  // unchanged "available" row for it overrides the registry's `status`
  // the moment the catalog fetch succeeds; confirmed live, not assumed),
  // so `hidden: true` was added alongside `status: "coming_soon"`.
  // `hidden` has no such override, which is exactly why it belongs in
  // THIS list rather than only changing the assertions below it.
  //
  // star-map removed from this list too, for a different reason: it was
  // DELETED from the registry outright, not merely hidden. "Withdrawn"
  // (this describe block's own premise) means still defined, `hidden:
  // true` — reversible. A deleted entry doesn't fit that any more; see
  // `test_deleted_products_resolve_to_undefined_the_same_way_withdrawn_
  // ones_do` below for what's still worth asserting about it.
  const WITHDRAWN = ["where-we-met"];

  it("keeps them defined, so the decision stays reversible", () => {
    const all = getAllProductsIncludingHidden().map((p) => p.slug);
    for (const slug of WITHDRAWN) expect(all).toContain(slug);
  });

  it("excludes them from every product listing", () => {
    // song-poster hidden again — see WITHDRAWN's own comment above for
    // why. Reasons I Love You joined the visible list on 14 Oct 2026, once
    // its Freemius plan and catalog row existed, and Graduation Keepsake on
    // 15 Oct 2026, once its plan (72194) was mapped.
    const visible = getAllProducts().map((p) => p.slug);
    expect(visible).toEqual(["song-poster", "love-story-timeline", "reasons-i-love-you", "graduation-keepsake"]);
    for (const slug of WITHDRAWN) expect(visible).not.toContain(slug);
  });

  it("refuses to resolve their public slug, so their page 404s", () => {
    // star-map included here even though it's deleted, not hidden — the
    // OBSERVABLE behaviour through the public API is identical either
    // way, and that's the thing actually worth guarding against
    // regressing: a customer hitting /products/star-map must 404
    // regardless of which internal reason (hidden vs. never-existed)
    // currently causes it.
    for (const slug of [...WITHDRAWN, "star-map"]) expect(getProductBySlug(slug)).toBeUndefined();
  });

  it("refuses to resolve their stable id, so their Studio route 404s", () => {
    for (const id of ["star-map", "heart-map"]) {
      expect(getProductById(id)).toBeUndefined();
    }
  });

  it("a deleted product is genuinely absent, not just hidden", () => {
    // The distinction "keeps them defined" (above) draws for withdrawn
    // products does NOT apply to star-map any more — it was removed
    // from the registry array entirely, not flagged hidden. Asserting
    // that directly, rather than only its downstream (identical)
    // 404 behaviour above.
    const all = getAllProductsIncludingHidden().map((p) => p.slug);
    expect(all).not.toContain("star-map");
  });

  it("never surfaces them through an occasion filter", () => {
    for (const occasion of ["anniversary", "wedding", "newBaby", "inMemory", "newChapter"]) {
      const slugs = getProductsByOccasion(occasion).map((p) => p.slug);
      for (const hidden of WITHDRAWN) expect(slugs).not.toContain(hidden);
    }
  });

  it("does not generate a legacy slug redirect into a 404", () => {
    // `next.config.ts` builds redirects from `getAllProducts()`, so hiding a
    // product also withdraws its `previousSlugs` redirect. /products/heart-map
    // must 404 outright rather than 301 to a page that then 404s.
    const oldSlugs = getAllProducts().flatMap((p) => p.previousSlugs ?? []);
    expect(oldSlugs).not.toContain("heart-map");
  });

  it("cannot be revived by Django listing them as available", () => {
    // Django still sells both Where We Met and Song Poster — neither
    // registry.ts edit touched their Django rows — and `mergeProductList`
    // iterates `getAllProducts()`, which already excludes anything
    // `hidden`, before it ever looks at what this synthetic Django
    // response names. Their exclusion here is the thing this test
    // actually verifies.
    const merged = mergeProductList([apiProduct("love-story-timeline"), apiProduct("heart-map")]);
    expect(merged.map((p) => p.slug)).toEqual(["song-poster", "love-story-timeline", "reasons-i-love-you", "graduation-keepsake"]);
    expect(merged.map((p) => p.slug)).not.toContain("where-we-met");
  });
});

describe("toCatalogProduct", () => {
  it("takes prices from Django, in the storefront's display units", () => {
    const entry = getProductBySlug("love-story-timeline")!;
    const merged = toCatalogProduct(entry, detail("love-story-timeline", loveStoryPacks));

    const prices = Object.fromEntries(merged.offerings.map((o) => [o.type, o.price]));
    expect(prices).toEqual({ printable: 18, wallpaper: 8, digital: 12, complete_pack: 30 });
  });

  it("maps the backend's `live` pack onto the storefront's existing Digital offering", () => {
    const entry = getProductBySlug("love-story-timeline")!;
    const merged = toCatalogProduct(entry, detail("love-story-timeline", loveStoryPacks));

    const digital = merged.offerings.find((o) => o.type === "digital");
    expect(digital?.detailsKey).toBe("digitalExperience");
    expect(digital?.i18nKey).toBe("digital");
  });

  it("preserves presentation fields the backend has no column for", () => {
    const entry = getAllProductsIncludingHidden().find((p) => p.id === "heart-map")!;
    const merged = toCatalogProduct(entry, detail("heart-map", whereWeMetPacks));

    expect(merged.slug).toBe("where-we-met");
    expect(merged.id).toBe("heart-map");
    expect(merged.i18nKey).toBe(entry.i18nKey);
    expect(merged.icon).toBe(entry.icon);
    expect(merged.tags).toEqual(entry.tags);
    expect(merged.faqCount).toBe(entry.faqCount);
  });

  it("gives Where We Met no digital offering, because its renderer cannot produce one", () => {
    const entry = getAllProductsIncludingHidden().find((p) => p.id === "heart-map")!;
    const merged = toCatalogProduct(entry, detail("heart-map", whereWeMetPacks));

    expect(merged.offerings.map((o) => o.type).sort()).toEqual(["complete_pack", "printable", "wallpaper"]);
    expect(merged.offerings.find((o) => o.type === "digital")).toBeUndefined();
  });

  it("exposes the delivery packs verbatim, since order creation needs their slugs", () => {
    const entry = getAllProductsIncludingHidden().find((p) => p.id === "heart-map")!;
    const merged = toCatalogProduct(entry, detail("heart-map", whereWeMetPacks));

    expect(merged.deliveryPacks.map((p) => p.slug)).toEqual(["printable", "wallpaper", "complete"]);
    expect(merged.deliveryPacks[0]?.includedTargets).toEqual(["print-png"]);
  });

  it("hides a disabled pack from the storefront without inventing a price", () => {
    const entry = getProductBySlug("love-story-timeline")!;
    const disabled = { ...loveStoryPacks[0]!, status: "disabled" as const };
    const merged = toCatalogProduct(entry, detail("love-story-timeline", [disabled]));

    expect(merged.offerings[0]?.available).toBe(false);
  });

  it("renders a non-round price exactly, not rounded to dollars", () => {
    const entry = getProductBySlug("love-story-timeline")!;
    const odd = pack("love-story-timeline", "printable", 1250, ["print-png"]);
    const merged = toCatalogProduct(entry, detail("love-story-timeline", [odd]));

    expect(merged.offerings[0]?.price).toBe(12.5);
  });

  it("keeps an unmapped pack sellable while not advertising it without copy", () => {
    const entry = getProductBySlug("love-story-timeline")!;
    const withSocial = [...loveStoryPacks, pack("love-story-timeline", "social", 700, ["story-png", "square-png"])];
    const merged = toCatalogProduct(entry, detail("love-story-timeline", withSocial));

    expect(merged.offerings.map((o) => o.type)).not.toContain("social");
    expect(merged.deliveryPacks.map((p) => p.slug)).toContain("social");
    expect(unmappedPackSlugs(withSocial)).toEqual(["social"]);
  });
});

/**
 * §"Product Page: Show Real Five-Tier Pricing" — the bug this fixed: the
 * two combo packs (`digital-plus-wallpaper`, `printable-plus-wallpaper`)
 * rendered NO card at all via the old per-pack `offerings` mapping, and an
 * active standalone `wallpaper` pack rendered as its own card it shouldn't
 * have. `getProductPageOfferings` is the display-layer fix; `offerings`
 * itself (tested above) is deliberately untouched, since the merchant feed
 * and this page's own JSON-LD still read it directly.
 */
describe("getProductPageOfferings", () => {
  const entry = getProductBySlug("love-story-timeline")!;
  const merged = toCatalogProduct(
    entry,
    detail("love-story-timeline", fiveTierPacksWithStandaloneWallpaper)
  );

  it("shows exactly the three primary editions — never a combo pack, never the standalone wallpaper pack", () => {
    const offerings = getProductPageOfferings(merged);
    expect(offerings.map((o) => o.type)).toEqual(["digital", "printable", "complete_pack"]);
  });

  it("prices each primary offering from its own base pack, not its combo", () => {
    const offerings = getProductPageOfferings(merged);
    const byType = Object.fromEntries(offerings.map((o) => [o.type, o.price]));
    expect(byType).toEqual({ digital: 15.99, printable: 22.99, complete_pack: 39.99 });
  });

  it("computes the wallpaper add-on as the real combo price minus the base price, not a hardcoded delta", () => {
    const offerings = getProductPageOfferings(merged);
    const digital = offerings.find((o) => o.type === "digital")!;
    const printable = offerings.find((o) => o.type === "printable")!;
    // Computed from the fixture's own cents, the same way the
    // implementation does (dollar-float subtraction, e.g. 20.99 - 15.99,
    // does not land on exactly 5 — see toCommercePack's own cents-first
    // arithmetic), so a change to either combo's own price here would move
    // this assertion too rather than silently keep agreeing.
    expect(digital.wallpaperAddon).toEqual({ price: (2099 - 1599) / 100, available: true });
    expect(printable.wallpaperAddon).toEqual({ price: (2799 - 2299) / 100, available: true });
  });

  it("gives Complete no wallpaper add-on — it already includes wallpaper targets", () => {
    const complete = getProductPageOfferings(merged).find((o) => o.type === "complete_pack")!;
    expect(complete.wallpaperAddon).toBeNull();
  });

  it("hides the add-on when its combo pack is disabled, without hiding the base offering", () => {
    const withDisabledCombo = fiveTierPacksWithStandaloneWallpaper.map((p) =>
      p.slug === "digital-plus-wallpaper" ? { ...p, status: "disabled" as const } : p
    );
    const disabledMerged = toCatalogProduct(entry, detail("love-story-timeline", withDisabledCombo));
    const digital = getProductPageOfferings(disabledMerged).find((o) => o.type === "digital")!;

    expect(digital.available).toBe(true);
    expect(digital.wallpaperAddon).toEqual({ price: (2099 - 1599) / 100, available: false });
  });

  it("degrades to no add-on at all when a combo pack is missing from the response entirely", () => {
    const withoutCombos = fiveTierPacksWithStandaloneWallpaper.filter(
      (p) => !p.slug.endsWith("-plus-wallpaper")
    );
    const noComboMerged = toCatalogProduct(entry, detail("love-story-timeline", withoutCombos));
    const offerings = getProductPageOfferings(noComboMerged);

    expect(offerings).toHaveLength(3);
    for (const offering of offerings) expect(offering.wallpaperAddon).toBeNull();
  });

  it("falls back to the static registry offerings for a registry-only (waitlist) product", () => {
    // No Django packs exist to group at all — same behaviour the page has
    // always had for a product with no backend row.
    const registryOnly = toRegistryOnlyProduct(entry);
    expect(getProductPageOfferings(registryOnly)).toEqual(getAvailableOfferings(registryOnly));
  });
});

/**
 * The combo model: Printable and Digital sold singly or together, the
 * together option being its own pack. Complete is disabled, so the API (which
 * lists active packs only) no longer returns it — modelled here by leaving it
 * out of the response, exactly as `list_active_delivery_packs_for_product`
 * does.
 */
describe("getProductPageOfferings — the Printable + Digital combo", () => {
  const entry = getProductBySlug("love-story-timeline")!;
  const comboCatalog = [
    pack("love-story-timeline", "printable", 2299, ["print-png"]),
    pack("love-story-timeline", "live", 1599, ["__live__"]),
    pack("love-story-timeline", "printable-plus-digital", 3599, ["print-png", "__live__"]),
    pack("love-story-timeline", "printable-plus-wallpaper", 2799, ["print-png"]),
    pack("love-story-timeline", "digital-plus-wallpaper", 2099, ["__live__"]),
  ];
  const merged = toCatalogProduct(entry, detail("love-story-timeline", comboCatalog));

  it("shows Digital, Printable and the combo, in that order, with no Complete", () => {
    expect(getProductPageOfferings(merged).map((o) => o.type)).toEqual([
      "digital",
      "printable",
      "printable_plus_digital",
    ]);
  });

  it("prices the combo from its own pack, not from the sum of its parts", () => {
    const byType = Object.fromEntries(getProductPageOfferings(merged).map((o) => [o.type, o.price]));
    expect(byType).toEqual({ digital: 15.99, printable: 22.99, printable_plus_digital: 35.99 });
  });

  it("is also a per-pack offering, so the merchant feed and JSON-LD list it", () => {
    expect(merged.offerings.map((o) => o.type)).toContain("printable_plus_digital");
  });
});

describe("mergeProductList", () => {
  it("marks the active product live from Django's answer", () => {
    const merged = mergeProductList([
      apiProduct("love-story-timeline"),
      apiProduct("heart-map"),
    ]);

    const bySlug = Object.fromEntries(merged.map((p) => [p.slug, p]));
    expect(bySlug["love-story-timeline"]?.isLive).toBe(true);
    expect(bySlug["love-story-timeline"]?.status).toBe("available");

    // Withdrawn (§1) — Django still returns heart-map, the storefront
    // still refuses to show it. Covered in full above.
    //
    // song-poster is NOT in this list any more: it is visible now (see
    // catalog.test.ts's own "withdrawn products" describe block above),
    // and simply was never part of THIS test's `apiProduct(...)` input —
    // its absence from `bySlug` here says nothing about withdrawal.
    expect(bySlug["where-we-met"]).toBeUndefined();
    expect(bySlug["star-map"]).toBeUndefined();
  });

  it("returns every registry product even when Django returns nothing", () => {
    const merged = mergeProductList([]);
    expect(merged).toHaveLength(getAllProducts().length);
    expect(merged.every((p) => !p.isLive)).toBe(true);
  });

  it("honours Django taking a product off sale", () => {
    const merged = mergeProductList([apiProduct("love-story-timeline", { status: "disabled" })]);
    expect(merged.find((p) => p.slug === "love-story-timeline")?.status).toBe("disabled");
  });

  it("never activates a product the registry does not publish", () => {
    // Same reasoning as "cannot be revived by Django listing them as
    // available" above: song-poster is hidden again, so heart-map's
    // exclusion — the actual point of this test — is joined by
    // song-poster's own, both via the same `getAllProducts()` filter.
    const merged = mergeProductList([apiProduct("love-story-timeline"), apiProduct("heart-map")]);
    expect(merged.map((p) => p.slug)).toEqual(["song-poster", "love-story-timeline", "reasons-i-love-you", "graduation-keepsake"]);
    expect(merged.map((p) => p.slug)).not.toContain("where-we-met");
  });
});

describe("available occasions (§11)", () => {
  // Finds the requested product BY SLUG, not by taking index [0] of the
  // merged list. The old `[0]` assumed the one product this helper asked
  // about would always be the first (and only) entry `mergeProductList`
  // returned — true only while love-story-timeline was the sole visible
  // registry product, and NOT true for the whole stretch song-poster was
  // also visible (order 2, ahead of love-story-timeline's order 4), when
  // `[0]` would have silently returned SONG POSTER's own (available,
  // unrelated) merged entry instead of whichever product and status this
  // call actually asked for. Left as `.find()` rather than reverted to
  // `[0]` now that song-poster is hidden again: it's the more robust
  // choice regardless of which registry products currently happen to be
  // visible, and reverting it would just recreate the same latent bug
  // the next time visibility changes.
  const live = (slug: string, status: ApiProduct["status"]) =>
    mergeProductList([apiProduct(slug, { status })]).find((p) => p.slug === slug)!;

  it("shows only occasions a purchasable product actually carries", () => {
    // Love Story Timeline is tagged anniversary + wedding and nothing else.
    const occasions = getAvailableOccasions(mergeProductList([apiProduct("love-story-timeline")]));
    expect(occasions).toEqual(["anniversary", "wedding"]);
  });

  it("drops the occasions whose products were withdrawn", () => {
    const occasions = getAvailableOccasions(mergeProductList([apiProduct("love-story-timeline")]));
    for (const orphaned of ["newBaby", "inMemory", "newChapter"]) {
      expect(occasions).not.toContain(orphaned);
    }
  });

  it("keeps the section alive during a backend outage", () => {
    // The reason this is worth asserting: an empty Django response and an
    // unreachable Django both produce a merge with no API data. The registry's
    // own status must still carry the active product through, or a backend
    // cold start would blank the homepage's occasions.
    const occasions = getAvailableOccasions(mergeProductList([]));
    expect(occasions).toEqual(["anniversary", "wedding"]);
  });

  it("shows nothing when Django has taken the last product off sale", () => {
    const disabled = live("love-story-timeline", "disabled");
    expect(getAvailableOccasions([disabled])).toEqual([]);
  });

  it("never returns a key the copy has no translation for", () => {
    const occasions = getAvailableOccasions(mergeProductList([apiProduct("love-story-timeline")]));
    for (const key of occasions) expect(OCCASION_KEYS).toContain(key);
  });
});

describe("offering display order", () => {
  it("keeps the storefront's commercial order, not Django's alphabetical pack order", () => {
    const entry = getProductBySlug("love-story-timeline")!;
    // Exactly how Django returns them: ordered by slug.
    const asDjangoReturnsThem = [...loveStoryPacks].sort((a, b) => a.slug.localeCompare(b.slug));
    expect(asDjangoReturnsThem.map((p) => p.slug)).toEqual(["complete", "live", "printable", "wallpaper"]);

    const merged = toCatalogProduct(entry, detail("love-story-timeline", asDjangoReturnsThem));

    expect(merged.offerings.map((o) => o.type)).toEqual([
      "digital",
      "wallpaper",
      "printable",
      "complete_pack",
    ]);
  });

  it("orders Where We Met's shorter list the same way, without gaps", () => {
    const entry = getAllProductsIncludingHidden().find((p) => p.id === "heart-map")!;
    const merged = toCatalogProduct(entry, detail("heart-map", whereWeMetPacks));
    expect(merged.offerings.map((o) => o.type)).toEqual(["wallpaper", "printable", "complete_pack"]);
  });
});

describe("the frontend registry holds no commercial data for launch products", () => {
  it("carries no offerings, and therefore no prices, for either launch product", () => {
    // Both launch products, whether or not they are currently published.
    for (const id of ["love-story-timeline", "heart-map"]) {
      const entry = getAllProductsIncludingHidden().find((p) => p.id === id)!;
      expect(entry.offerings).toEqual([]);
    }
  });

  it("can never resurrect Where We Met's removed Digital Keepsake from a fallback", () => {
    // The registry-only path is exactly what a cold-start outage renders.
    const entry = getAllProductsIncludingHidden().find((p) => p.id === "heart-map")!;
    const fallback = toRegistryOnlyProduct(entry);

    expect(fallback.offerings).toEqual([]);
    expect(fallback.offerings.find((o) => o.type === "digital")).toBeUndefined();
    expect(fallback.isLive).toBe(false);
    expect(fallback.startingPriceCents).toBeNull();
  });

  // "leaves a withdrawn product's static marketing prices unreachable"
  // removed: it demonstrated a real pattern (a hidden product still
  // carrying static `offerings` data in the registry, but unreachable
  // through the public API) using Star Map as its example. Star Map's
  // registry entry has since been deleted outright — not hidden, gone —
  // and Song Poster (this test's other named example) moved to the
  // Django-owns-pricing pattern (`offerings: []`) when it went visible.
  // No product in the registry still fits what this test demonstrated;
  // keeping it would mean either a runtime crash (its own `.find(...)!`
  // on a product that no longer exists) or inventing a synthetic
  // fixture that reflects nothing real in the actual registry.
});

/**
 * ---------------------------------------------------------------------
 * §7d — dashboard-managed occasions, and the fallback that protects them
 * ---------------------------------------------------------------------
 * Making occasions editable is only safe if an outage cannot be mistaken
 * for an edit. These cover both directions: managed data wins when present,
 * and its absence falls back rather than emptying the section.
 */
describe("managed occasions (§7d)", () => {
  const live = () => mergeProductList([apiProduct("love-story-timeline")]);

  it("uses the dashboard's occasions when Django supplies them", () => {
    const managed = [
      { key: "anniversary", tags: ["anniversary"] },
      { key: "housewarming", tags: ["housewarming"] },
    ];
    // Only the one the product is actually tagged for.
    expect(getAvailableOccasions(live(), managed)).toEqual(["anniversary"]);
  });

  it("lets the dashboard introduce an occasion the code has never heard of", () => {
    // The point of making them editable: adding one must not need a deploy.
    const managed = [{ key: "justBecause", tags: ["timeline"] }];
    expect(getAvailableOccasions(live(), managed)).toEqual(["justBecause"]);
  });

  it("replaces the static list rather than merging with it", () => {
    // Merging would mean an occasion deleted in the dashboard kept showing
    // because the code still knew about it.
    const managed = [{ key: "anniversary", tags: ["anniversary"] }];
    expect(getAvailableOccasions(live(), managed)).not.toContain("wedding");
  });

  it("falls back to the static list when Django sends nothing", () => {
    // An outage, or a backend still on the old response shape. Emptying the
    // homepage's occasions over that would turn a transient problem into
    // what looks like a deliberate content decision.
    expect(getAvailableOccasions(live(), [])).toEqual(["anniversary", "wedding"]);
    expect(getAvailableOccasions(live(), undefined)).toEqual(["anniversary", "wedding"]);
  });

  it("still shows nothing when nothing is purchasable", () => {
    const managed = [{ key: "anniversary", tags: ["anniversary"] }];
    // Both products disabled, not just love-story-timeline: song-poster
    // is a real, separate, independently-available registry product now
    // (Phase 2 integration flip), also genuinely tagged "anniversary" —
    // leaving it enabled here would mean the scenario this test claims
    // to cover ("nothing is purchasable") was no longer what it actually
    // set up.
    // Reasons I Love You is disabled too, for the same reason: it is
    // visible and also tagged "anniversary".
    const disabled = mergeProductList([
      apiProduct("love-story-timeline", { status: "disabled" }),
      apiProduct("song-poster", { status: "disabled" }),
      apiProduct("reasons-i-love-you", { status: "disabled" }),
    ]);
    expect(getAvailableOccasions(disabled, managed)).toEqual([]);
  });
});
