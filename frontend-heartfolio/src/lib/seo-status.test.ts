// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap, { CONTENT_UPDATED } from "@/app/sitemap";
import { routing } from "@/i18n/routing";
import { neutralShareMetadata, noindexMetadata, pageShareMetadata, siteVerificationMetadata } from "@/lib/seo";
import { SITE_URL } from "@/lib/site-config";

/**
 * TECHNICAL SEO, PINNED (27 Oct 2026, after a crawl of every page). The
 * address-level 404s are in `proxy.test.ts`, the length limits in
 * `seo-lengths.test.ts`.
 */
const source = (path: string) => readFileSync(path, "utf8");
const APP = "src/app/[locale]";

describe("a page that does not exist can say so (real 404s)", () => {
  it("no loading boundary wraps every page: the home skeleton lives in (home)", () => {
    // At `[locale]/loading.tsx` it streamed for every page beneath it, so their
    // own notFound() came after a 200 had been sent.
    expect(existsSync(`${APP}/loading.tsx`)).toBe(false);
    expect(existsSync(`${APP}/(home)/loading.tsx`)).toBe(true);
  });

  it("the gift-link and AR pages have no loading boundary of their own either", () => {
    for (const dir of ["live/[liveId]", "ar/[arId]"]) expect(existsSync(`${APP}/${dir}/loading.tsx`), dir).toBe(false);
  });
});

describe("pages kept out of search results", () => {
  const PRIVATE = [
    ["studio/[slug]/page.tsx", "noindexMetadata("],
    ["create/page.tsx", "noindexMetadata("],
    ["project/[projectId]/page.tsx", "noindexMetadata("],
    ["live/[liveId]/page.tsx", "noindexMetadata("],
    ["ar/[arId]/page.tsx", "noindexMetadata("],
    ["orders/[orderId]/[[...token]]/page.tsx", "noindexMetadata("],
  ];

  it.each(PRIVATE)("%s is noindex with its own canonical", (file, call) => {
    expect(source(`${APP}/${file}`)).toContain(call);
  });

  it("noindex means its own canonical, no language alternates", () => {
    const meta = noindexMetadata("fr", "/studio/song-poster");
    expect(meta.robots).toMatchObject({ index: false, follow: true });
    expect(meta.alternates).toEqual({ canonical: `${SITE_URL}/fr/studio/song-poster` });
    expect(noindexMetadata("en", "/live/x", { follow: false }).robots).toMatchObject({ index: false, follow: false });
  });

  it("robots.txt lets crawlers read that noindex, and still keeps out orders and the API", () => {
    const rules = robots().rules as { disallow: string[] };
    for (const path of ["/create", "/studio", "/project"]) {
      for (const locale of ["", ...routing.locales.map((l) => `/${l}`)]) {
        expect(rules.disallow.some((rule) => `${locale}${path}`.startsWith(rule)), `${locale}${path}`).toBe(false);
      }
    }
    expect(rules.disallow).toEqual(expect.arrayContaining(["/api/", "/orders", "/en/orders", "/fr/orders", "/ar/orders"]));
  });
});

describe("share cards", () => {
  it("a gift or order link shares a neutral card at its own address, never the keepsake", () => {
    const meta = neutralShareMetadata("fr", "/live/abc", "gift", { title: "Un cadeau pour toi", description: "x" });
    expect(meta.openGraph).toMatchObject({ url: `${SITE_URL}/fr/live/abc`, title: "Un cadeau pour toi" });
    const image = (meta.openGraph!.images as { url: string }[])[0]!;
    expect(image.url).toBe(`${SITE_URL}/fr/share-card/gift`);
    expect(source(`${APP}/share-card/[kind]/route.tsx`)).not.toMatch(/fetch|liveId|orderId|payload/);
    expect(source(`${APP}/orders/[orderId]/[[...token]]/page.tsx`)).toMatch(/const path = `\/orders\/\$\{orderId\}`/);
  });

  it("a page with its own share title keeps the site's card and gets its own address", () => {
    const meta = pageShareMetadata("ar", "/terms", { title: "T", description: "D", cardAlt: "A" });
    expect(meta.openGraph).toMatchObject({ url: `${SITE_URL}/ar/terms`, title: "T" });
    expect((meta.openGraph!.images as { url: string; alt: string }[])[0]).toMatchObject({ url: `${SITE_URL}/ar/opengraph-image/card`, alt: "A" });
    for (const page of ["contact", "feedback", "terms", "privacy", "refunds"]) {
      expect(source(`${APP}/${page}/page.tsx`), page).toContain("pageShareMetadata(");
    }
  });

  it("every share image's alt text comes from the page's language, not a fixed English line", () => {
    const files = ["opengraph-image.tsx", "products/opengraph-image.tsx", "products/[slug]/opengraph-image.tsx", "gifts/[intent]/opengraph-image.tsx"];
    for (const file of files) {
      const code = source(`${APP}/${file}`);
      expect(code, file).not.toMatch(/^export const alt\b/m);
      expect(code, file).toMatch(/generateImageMetadata[\s\S]*ogAltTranslator[\s\S]*alt:/);
    }
    expect(source(`${APP}/opengraph-image.tsx`)).toContain('t("ogAlt")');
  });
});

describe("Product markup", () => {
  it("states the return policy by its page only: no physical-goods categories for a digital keepsake", () => {
    // Owner's decision (27 Oct 2026): "free return" and "damaged item"
    // describe parcels, so the policy is the link to /refunds and nothing
    // else; the Search Console warning about missing categories is accepted.
    const page = source(`${APP}/products/[slug]/page.tsx`);
    const policy = page.slice(page.indexOf("const returnPolicy = {"), page.indexOf("};", page.indexOf("const returnPolicy = {")));
    expect(policy).toContain("merchantReturnLink: `${SITE_URL}/${locale}/refunds`");
    expect(policy).not.toMatch(/returnPolicyCategory|merchantReturnDays|itemCondition|refundType|returnFees|applicableCountry/);
    expect(page).toContain("hasMerchantReturnPolicy: returnPolicy");
  });
});

describe("the sitemap", () => {
  // The guides have their own hreflang (only the translations that exist)
  // and dates (their own `updated`): `guides.test.ts`.
  const entries = sitemap().filter((entry) => !/^https:\/\/[^/]+\/[a-z]{2}\/guides(\/|$)/.test(entry.url));

  it("names x-default beside every language, as the pages' own tags do", () => {
    for (const entry of entries) {
      const languages = entry.alternates?.languages as Record<string, string>;
      expect(Object.keys(languages).sort(), entry.url).toEqual([...routing.locales, "x-default"].sort());
      expect(languages["x-default"]).toBe(languages[routing.defaultLocale]);
    }
  });

  it("dates each page when its content changed, never the moment it is fetched", () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const [path, date] of Object.entries(CONTENT_UPDATED)) {
      expect(date, path).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(date <= today, `${path} is not in the future`).toBe(true);
    }
    for (const entry of entries) {
      const path = entry.url.replace(/^https:\/\/[^/]+\/[a-z]{2}/, "");
      if (/^\/(terms|privacy|refunds)$/.test(path)) continue; // the date they print, once set
      expect(CONTENT_UPDATED[path], `${path} has a content date`).toBeDefined();
      expect(String(entry.lastModified)).toBe(`${CONTENT_UPDATED[path]}T00:00:00.000Z`);
    }
    expect(source("src/app/sitemap.ts")).not.toMatch(/new Date\(\)/);
  });
});

describe("the home page's route group", () => {
  it("holds the home page and its skeleton only", () => {
    expect(readdirSync(join(APP, "(home)")).sort()).toEqual(["loading.tsx", "page.tsx"]);
  });
});

describe("site verification (Pinterest, 31 Oct 2026)", () => {
  it("the locale layout puts p:domain_verify on every page, in every language", () => {
    expect(siteVerificationMetadata()).toEqual({ other: { "p:domain_verify": "7be136160ca05f467042f9f7e5c8cfeb" } });
    const layout = readFileSync(join(process.cwd(), "src/app/[locale]/layout.tsx"), "utf8");
    expect(layout).toContain("...siteVerificationMetadata()");
    // The layout serves every locale from one generateMetadata.
    expect(routing.locales).toEqual(["en", "fr", "ar"]);
  });

  it("no page or layout sets its own `other`, which would replace the tag", () => {
    const appDir = join(process.cwd(), "src/app");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
      );
    const offenders = walk(appDir)
      .filter((file) => /\.(tsx?)$/.test(file) && !file.includes(".test."))
      .filter((file) => /\bother\s*:/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
