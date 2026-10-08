import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { getAllProducts } from "@/lib/products/registry";
import { enabledIntents } from "@/lib/products/gift-intents";
import { SITE_URL } from "@/lib/site-config";

/**
 * Previously this listed three URLs — one homepage per locale — on the
 * wrong domain. Every product page and every policy page was invisible to
 * crawlers. Now each public route is emitted once per locale, with a
 * `languages` alternates block so search engines can pair the three
 * versions of the same page instead of treating them as duplicates.
 */
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
  const lastModified = new Date();

  return ROUTES.flatMap((route) =>
    routing.locales.map((locale) => ({
      url: `${SITE_URL}/${locale}${route.path}`,
      lastModified,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
      alternates: {
        languages: Object.fromEntries(
          routing.locales.map((alt) => [alt, `${SITE_URL}/${alt}${route.path}`])
        ),
      },
    }))
  );
}
