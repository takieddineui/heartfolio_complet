// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";

// next-intl's middleware does not load under vitest (its ESM import of
// `next/server`); what is tested here is the rewrite in front of it, so it
// is a pass-through.
vi.mock("next-intl/middleware", () => ({ default: () => () => NextResponse.next() }));

const { default: proxy } = await import("./proxy");

/**
 * A REAL 404 FOR AN UNPUBLISHED PRODUCT (25 Oct 2026). Hidden or unknown
 * `/products/<slug>` and `/studio/<slug>` URLs answered 200 with
 * `index, follow`. The proxy now rewrites them to a path no route matches
 * (root not-found, status 404), carrying the URL's locale for the page's
 * language; published products pass through untouched.
 */
const rewriteOf = (path: string) => proxy(new NextRequest(`http://localhost${path}`)).headers.get("x-middleware-rewrite");
const localeSentWith = (path: string) =>
  proxy(new NextRequest(`http://localhost${path}`)).headers.get("x-middleware-request-x-next-intl-locale");

describe("unpublished products answer 404", () => {
  it.each([
    "/en/products/heart-map",
    "/fr/products/not-a-product",
    "/ar/studio/heart-map",
    "/fr/studio/not-a-product",
    "/en/products/heart-map/opengraph-image",
  ])("%s is rewritten to the not-found page, in its language", (path) => {
    expect(rewriteOf(path)).toMatch(new RegExp(`/${path.slice(1, 3)}/__not-found__$`));
    expect(localeSentWith(path)).toBe(path.slice(1, 3));
  });

  it.each(["/en/products/song-poster", "/ar/products/love-story-timeline", "/fr/studio/graduation-keepsake", "/en/studio/reasons-i-love-you", "/en/products", "/fr/privacy", "/en/products/opengraph-image", "/ar/products/twitter-image"])(
    "%s is left alone",
    (path) => {
      expect(rewriteOf(path) ?? "").not.toContain("__not-found__");
    }
  );
});

/**
 * THE CAPTURE PAGE IS LOCKED (26 Oct 2026). `/<locale>/capture/<product>`
 * renders sample keepsakes for the storefront's recordings; it must be a real
 * 404 everywhere except a development server started with
 * `HEARTFOLIO_CAPTURE=1` (`lib/captures/capture-mode.ts`).
 */
describe("the capture page", () => {
  it.each(["/en/capture/love-story-timeline", "/ar/capture/song-poster", "/fr/capture"])(
    "%s answers 404 when capture mode is off",
    (path) => {
      vi.stubEnv("HEARTFOLIO_CAPTURE", "");
      expect(rewriteOf(path)).toMatch(new RegExp(`/${path.slice(1, 3)}/__not-found__$`));
      vi.unstubAllEnvs();
    }
  );

  it("answers 404 in a production build even with the flag set", () => {
    vi.stubEnv("HEARTFOLIO_CAPTURE", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(rewriteOf("/en/capture/love-story-timeline")).toMatch(/\/en\/__not-found__$/);
    vi.unstubAllEnvs();
  });

  it("opens on a development server started for captures", () => {
    vi.stubEnv("HEARTFOLIO_CAPTURE", "1");
    vi.stubEnv("NODE_ENV", "development");
    expect(rewriteOf("/en/capture/love-story-timeline") ?? "").not.toContain("__not-found__");
    vi.unstubAllEnvs();
  });

  it("does not catch other paths that merely start the same way", () => {
    vi.stubEnv("HEARTFOLIO_CAPTURE", "");
    expect(rewriteOf("/en/captured-moments") ?? "").not.toContain("__not-found__");
    vi.unstubAllEnvs();
  });
});

/**
 * REAL 404s FOR GIFT INTENTS AND PRIVATE IDS (27 Oct 2026). An unknown
 * `/gifts/<slug>` was a 200 "this page doesn't exist", indexable; so were
 * `/live`, `/ar`, `/orders` and `/project` with an id that is not a UUID.
 */
describe("addresses no page can answer are 404", () => {
  const ID = "6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b";
  it.each([
    "/en/gifts/not-a-gift",
    "/fr/gifts/printable",
    "/ar/gifts/anniversary-gifts",
    "/en/live/not-a-uuid",
    "/fr/ar/123",
    "/en/orders/abc/token",
    "/ar/project/drafts",
    `/en/live/${ID}x`,
  ])("%s is rewritten to the not-found page, in its language", (path) => {
    expect(rewriteOf(path)).toMatch(new RegExp(`/${path.slice(1, 3)}/__not-found__$`));
    expect(localeSentWith(path)).toBe(path.slice(1, 3));
  });

  it.each([
    "/en/gifts/printable-gifts",
    "/ar/gifts/printable-gifts/opengraph-image",
    `/en/live/${ID}`,
    `/fr/live/${ID}/opengraph-image`,
    `/ar/ar/${ID.toUpperCase()}`,
    `/en/orders/${ID}`,
    `/fr/orders/${ID}/v1:some-signed-token`,
    `/en/project/${ID}`,
  ])("%s is left alone", (path) => {
    expect(rewriteOf(path) ?? "").not.toContain("__not-found__");
  });
});
