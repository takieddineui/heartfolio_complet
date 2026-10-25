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

  it.each(["/en/products/song-poster", "/ar/products/love-story-timeline", "/fr/studio/graduation-keepsake", "/en/studio/reasons-i-love-you", "/en/products", "/fr/privacy"])(
    "%s is left alone",
    (path) => {
      expect(rewriteOf(path) ?? "").not.toContain("__not-found__");
    }
  );
});
