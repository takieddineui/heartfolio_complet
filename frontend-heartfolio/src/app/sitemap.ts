import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { getAllProducts } from "@/lib/products/registry";
import { enabledIntents } from "@/lib/products/gift-intents";
import { LEGAL_LAST_UPDATED, SITE_URL } from "@/lib/site-config";

/**
 * Previously this listed three URLs — one homepage per locale — on the
 * wrong domain. Every product page and every policy page was invisible to
 * crawlers. Now each public route is emitted once per locale, with a
 * `languages` alternates block so search engines can pair the three
 * versions of the same page instead of treating them as duplicates.
 */
/**
 * WHEN EACH PAGE LAST CHANGED IN SUBSTANCE (27 Oct 2026). `lastmod` used to
 * be the time of the request, so every page claimed to change every time it
 * was fetched and Google learns to ignore such a sitemap. These are real
 * dates: UPDATE ONE WHEN THAT PAGE'S CONTENT CHANGES (copy, products shown),
 * not for code changes behind it. The legal pages use the date they print
 * (`LEGAL_LAST_UPDATED`) and leave `lastmod` out until it is set: no date
 * beats a false one. `sitemap.test.ts` pins the rules.
 */
export const CONTENT_UPDATED: Record<string, string> = {
  "": "2026-10-27",
  "/products": "2026-10-27",
  "/products/song-poster": "2026-10-27",
  "/products/love-story-timeline": "2026-10-27",
  "/products/reasons-i-love-you": "2026-10-27",
  "/products/graduation-keepsake": "2026-10-27",
  "/gifts/printable-gifts": "2026-10-27",
  "/contact": "2026-10-08",
  "/feedback": "2026-10-08",
};
const LEGAL_PATHS = new Set(["/terms", "/privacy", "/refunds"]);

const ROUTES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "", priority: 1, changeFrequency: "weekly" },
  { path: "/products", priority: 0.9, changeFrequency: "weekly" },
  ...getAllProducts().map((product) => ({
    path: `/products/${product.slug}`,
    priority: 0.8,
    changeFrequency: "monthly" as const,
  })),
  // §16c — only intents that are switched on AND backed by live products.
  // `enabledIntents()` enforces both, so the sitemap cannot advertise a
  // landing page that 404s or that renders an empty grid.
  ...enabledIntents().map((intent) => ({
    path: `/gifts/${intent.slug}`,
    priority: 0.7,
    changeFrequency: "monthly" as const,
  })),
  { path: "/contact", priority: 0.5, changeFrequency: "yearly" },
  // §7c — indexable, so it belongs here. Its metadata already says
  // `index: true`; a page that claims to be indexable and is absent
  // from the sitemap is a quiet contradiction.
  { path: "/feedback", priority: 0.4, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/refunds", priority: 0.3, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.flatMap((route) => {
    const updated = LEGAL_PATHS.has(route.path) ? LEGAL_LAST_UPDATED : CONTENT_UPDATED[route.path];
    // Every language version, and `x-default` (English), as the pages' own
    // hreflang tags say (`buildAlternates`); the sitemap had no x-default.
    const languages = {
      ...Object.fromEntries(routing.locales.map((alt) => [alt, `${SITE_URL}/${alt}${route.path}`])),
      "x-default": `${SITE_URL}/${routing.defaultLocale}${route.path}`,
    };
    return routing.locales.map((locale) => ({
      url: `${SITE_URL}/${locale}${route.path}`,
      ...(updated ? { lastModified: `${updated}T00:00:00.000Z` } : {}),
      changeFrequency: route.changeFrequency,
      priority: route.priority,
      alternates: { languages },
    }));
  });
}
