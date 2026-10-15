import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetCatalogCacheForTests,
  getCatalogProductDetail,
  getCatalogProducts,
} from "./catalog-server";
import { getAllProductsIncludingHidden } from "./registry";

/**
 * Where We Met is withdrawn from the storefront (§1) but Django still
 * sells it, and it is still the only product whose public slug differs
 * from its Django slug — which is exactly the boundary these tests exist
 * to protect. So it is fetched from the unfiltered registry here: hiding
 * a product is a storefront decision and must not quietly delete the
 * coverage proving the slug translation works.
 */
const whereWeMetEntry = () =>
  getAllProductsIncludingHidden().find((entry) => entry.id === "heart-map")!;

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const LIVE_LIST = [
  { id: "u1", slug: "love-story-timeline", i18nKey: "loveStoryTimeline", category: "timeline", status: "available", startingPriceCents: 800, order: 4, tags: [] },
  { id: "u2", slug: "heart-map", i18nKey: "whereWeMet", category: "map", status: "available", startingPriceCents: 800, order: 3, tags: [] },
];

const WWM_DETAIL = {
  product: LIVE_LIST[1],
  deliveryPacks: [
    { id: "p1", productId: "heart-map", slug: "printable", nameKey: "packs.printable.name", descriptionKey: "packs.printable.description", priceCents: 1800, currency: "USD", includedTargets: ["print-png"], status: "active" },
  ],
};

describe("getCatalogProducts", () => {
  beforeEach(() => __resetCatalogCacheForTests());
  afterEach(() => vi.restoreAllMocks());

  it("serves live Django data and never bakes it into a build cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(LIVE_LIST));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getCatalogProducts();

    expect(result.source).toBe("live");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store" });
    expect(result.products.find((p) => p.slug === "love-story-timeline")?.isLive).toBe(true);
  });

  it("falls back to the last good catalog when Django is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(LIVE_LIST)));
    await getCatalogProducts(); // warms the cache

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const result = await getCatalogProducts();

    expect(result.source).toBe("cache");
    expect(result.products.find((p) => p.slug === "love-story-timeline")?.isLive).toBe(true);
  });

  it("falls back on a 5xx too, not just a dropped connection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(LIVE_LIST)));
    await getCatalogProducts();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 503 })));
    expect((await getCatalogProducts()).source).toBe("cache");
  });

  it("does NOT serve stale products when Django deliberately returns an empty catalog", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(LIVE_LIST)));
    await getCatalogProducts(); // cache holds two live products

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([])));
    const result = await getCatalogProducts();

    // An empty answer is a real answer: nothing is for sale.
    expect(result.source).toBe("live");
    expect(result.isEmptyCatalog).toBe(true);
    expect(result.products.every((p) => !p.isLive)).toBe(true);
  });

  it("reports unavailable rather than inventing prices on a cold start with no backend", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const result = await getCatalogProducts();

    expect(result.source).toBe("unavailable");
    expect(result.products.every((p) => !p.isLive)).toBe(true);
  });

  it("never returns a withdrawn product, whatever Django says (§1, §14)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(LIVE_LIST)));

    // song-poster is hidden again (status alone didn't work as a kill
    // switch — Django's own unchanged "available" row for it overrode the
    // registry's status — so `hidden: true` was added), so heart-map's
    // exclusion — the thing this test actually verifies — is joined by
    // song-poster's own, both via the same registry `isVisible` filter,
    // regardless of LIVE_LIST naming only love-story-timeline and heart-map.
    const slugs = (await getCatalogProducts()).products.map((p) => p.slug);
    expect(slugs).toEqual(["song-poster", "love-story-timeline", "reasons-i-love-you", "graduation-keepsake"]);
    for (const withdrawn of ["where-we-met", "heart-map"]) expect(slugs).not.toContain(withdrawn);
  });

  it("does not 404 the live product when Django is unreachable", async () => {
    // The reason visibility is a static flag rather than Django's status:
    // an outage and a withdrawal must not look the same. A cold start with
    // nothing cached still has to publish the active product's page.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    // The one visible registry product falls back to registry-only data
    // when Django is unreachable — song-poster is excluded here for the
    // same `hidden` reason as the test above, not because of this outage.
    const result = await getCatalogProducts();
    expect(result.source).toBe("unavailable");
    expect(result.products.map((p) => p.slug)).toEqual(["song-poster", "love-story-timeline", "reasons-i-love-you", "graduation-keepsake"]);
  });
});

describe("getCatalogProductDetail", () => {
  beforeEach(() => __resetCatalogCacheForTests());
  afterEach(() => vi.restoreAllMocks());

  it("requests the Django slug, not the public slug", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(WWM_DETAIL));
    vi.stubGlobal("fetch", fetchMock);

    await getCatalogProductDetail(whereWeMetEntry());

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/api/v1/products/heart-map/");
    expect(url).not.toContain("where-we-met");
  });

  it("treats a 404 as 'not on sale', not as a transient failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(WWM_DETAIL)));
    await getCatalogProductDetail(whereWeMetEntry()); // warm cache

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    const result = await getCatalogProductDetail(whereWeMetEntry());

    expect(result.source).toBe("live");
    expect(result.product.isLive).toBe(false);
    expect(result.product.deliveryPacks).toEqual([]);
  });

  it("serves the cached detail when the request genuinely fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(WWM_DETAIL)));
    await getCatalogProductDetail(whereWeMetEntry());

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    const result = await getCatalogProductDetail(whereWeMetEntry());

    expect(result.source).toBe("cache");
    expect(result.product.deliveryPacks).toHaveLength(1);
  });
});

/**
 * §7d — the response shape changed, and the two sides deploy separately.
 */
describe("response shape tolerance (§7d)", () => {
  it("reads the old bare-array response without losing the catalog", () => {
    // The frontend ships before the backend: the frontend is new, the backend still
    // returns an array. A storefront with no products during that window
    // would be a real outage.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(LIVE_LIST)));
    return getCatalogProducts().then((result) => {
      expect(result.products.length).toBeGreaterThan(0);
      expect(result.taxonomy.occasions).toEqual([]);
    });
  });

  it("reads the new object response and carries the taxonomy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        ok({
          products: LIVE_LIST,
          occasions: [{ key: "anniversary", tags: ["anniversary"], order: 1 }],
          printSizes: [{ key: "a4", baseWidthPx: 2480, baseHeightPx: 3508, order: 1 }],
        })
      )
    );

    const result = await getCatalogProducts();
    expect(result.products.length).toBeGreaterThan(0);
    expect(result.taxonomy.occasions.map((o) => o.key)).toEqual(["anniversary"]);
    expect(result.taxonomy.printSizes.map((s) => s.key)).toEqual(["a4"]);
  });

  it("keeps the last known taxonomy through an outage", async () => {
    /**
     * Written expecting an empty taxonomy, and corrected after the test
     * failed — the module cache had already been warmed by the test above,
     * and it served the last good taxonomy instead of nothing.
     *
     * That is the better behaviour and worth pinning: an instance that has
     * seen a good response once should keep showing those occasions through
     * a blip rather than falling back to the static list, which may by then
     * be out of date with what the dashboard says.
     *
     * The genuinely-never-succeeded case returns an empty taxonomy, which
     * callers read as "use the static definitions" — covered by
     * `getAvailableOccasions` in catalog.test.ts, where the cache is not in
     * play.
     */
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const result = await getCatalogProducts();
    expect(result.source).toBe("cache");
    expect(result.taxonomy.occasions.map((o) => o.key)).toEqual(["anniversary"]);
  });
});

describe("BACKEND_API_ORIGIN has no fallback", () => {
  beforeEach(() => __resetCatalogCacheForTests());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends catalog requests to the configured origin, and only to it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(LIVE_LIST));
    vi.stubGlobal("fetch", fetchMock);

    await getCatalogProducts();

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://backend.test/api/v1/products/");
  });

  it("throws, rather than serving a silently empty storefront, when it is unset", async () => {
    vi.stubEnv("BACKEND_API_ORIGIN", "");
    const fetchMock = vi.fn().mockResolvedValue(ok(LIVE_LIST));
    vi.stubGlobal("fetch", fetchMock);

    // Not `source: "unavailable"` — that is the OUTAGE fallback, and a missing
    // setting is not an outage.
    await expect(getCatalogProducts()).rejects.toThrow(/BACKEND_API_ORIGIN is not set/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not let a warm cache hide the missing setting either", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(LIVE_LIST)));
    await getCatalogProducts(); // warms the cache while the origin is set

    vi.stubEnv("BACKEND_API_ORIGIN", "");
    await expect(getCatalogProducts()).rejects.toThrow(/BACKEND_API_ORIGIN/);
  });

  it("throws from the product-detail fetch too, instead of falling back to registry-only", async () => {
    vi.stubEnv("BACKEND_API_ORIGIN", "");
    const fetchMock = vi.fn().mockResolvedValue(ok(WWM_DETAIL));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCatalogProductDetail(whereWeMetEntry())).rejects.toThrow(/BACKEND_API_ORIGIN is not set/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an origin that is not an http(s) URL", async () => {
    vi.stubEnv("BACKEND_API_ORIGIN", "api:8000");
    await expect(getCatalogProducts()).rejects.toThrow(/not a valid URL|http:\/\/ or https:\/\//);
  });
});
