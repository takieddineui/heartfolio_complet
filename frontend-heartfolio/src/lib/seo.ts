import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import { PINTEREST_DOMAIN_VERIFY, SITE_NAME, SITE_URL } from "@/lib/site-config";

/**
 * Site verification tags for every page, set once by the locale layout. Next
 * renders `other` as `<meta name="…" content="…">`. A page's own `other`
 * would REPLACE this one (metadata merges key by key), which is why
 * `seo-status.test.ts` fails if any other route sets it.
 */
export function siteVerificationMetadata(): Pick<Metadata, "other"> {
  return { other: { "p:domain_verify": PINTEREST_DOMAIN_VERIFY } };
}

/**
 * Builds a correct per-locale `alternates` block.
 *
 * The previous implementation set `canonical: "/"` on *every* page in
 * every locale and listed the same three language URLs regardless of
 * which page you were on — meaning /fr/products/song-poster claimed the
 * homepage as its canonical. That is the single most damaging SEO bug in
 * the codebase. Each page now points at itself, in its own locale, and
 * declares a full hreflang set including `x-default`.
 *
 * @param locale current locale
 * @param path   locale-agnostic path with a leading slash, "" for home
 */
export function buildAlternates(locale: string, path: string = ""): Metadata["alternates"] {
  const clean = path === "/" ? "" : path;
  const languages: Record<string, string> = {};

  for (const loc of routing.locales) {
    languages[loc] = `${SITE_URL}/${loc}${clean}`;
  }
  // x-default points at English — the fallback for any language we do
  // not publish, not a claim that English outranks the others.
  languages["x-default"] = `${SITE_URL}/${routing.defaultLocale}${clean}`;

  return {
    canonical: `${SITE_URL}/${locale}${clean}`,
    languages,
  };
}

/** OG locale strings — `en_US` style, plus the other locales as alternates. */
export function ogLocales(locale: string) {
  const map: Record<string, string> = { en: "en_US", fr: "fr_FR", ar: "ar_AR" };
  return {
    locale: map[locale] ?? "en_US",
    alternateLocale: routing.locales
      .filter((l) => l !== locale)
      .map((l) => map[l])
      .filter((l): l is string => Boolean(l)),
  };
}

/** Absolute URL for an OG image path under /public. */
export function absoluteUrl(path: string) {
  return path.startsWith("http") ? path : `${SITE_URL}${path}`;
}

/**
 * A page that is crawled but never indexed (27 Oct 2026): the Studio,
 * `/create`, `/project`, an order, a gift link, an AR scene. `noindex`, its
 * OWN canonical and no language alternates. They used to inherit the
 * layout's `index, follow` and its canonical (the home page), while
 * robots.txt hid the Studio pages, so Google could index their bare
 * addresses from every product page's link without ever seeing a tag.
 * `follow`: the Studio's links lead to real pages; a private page's do not.
 */
export function noindexMetadata(locale: string, path: string, { follow = true }: { follow?: boolean } = {}): Metadata {
  return {
    robots: { index: false, follow, ...(follow ? {} : { nocache: true }) },
    alternates: { canonical: `${SITE_URL}/${locale}${path}` },
  };
}

/**
 * What a shared gift link (live page, AR scene) or order link shows in a
 * chat or a social post: a neutral card, never the keepsake's content, its
 * `og:url` the page's own address. They used to inherit the HOME page's card,
 * so a recipient's link previewed as the shop, pointing at the home page.
 * The image is `share-card/<kind>` (no content, no ids).
 */
export function neutralShareMetadata(
  locale: string,
  path: string,
  kind: "gift" | "order",
  { title, description }: { title: string; description?: string }
): Metadata {
  const url = `${SITE_URL}/${locale}${path}`;
  const image = { url: `${SITE_URL}/${locale}/share-card/${kind}`, width: 1200, height: 630, alt: title };
  return {
    openGraph: { type: "website", title, ...(description ? { description } : {}), url, siteName: SITE_NAME, images: [image], ...ogLocales(locale) },
    twitter: { card: "summary_large_image", title, ...(description ? { description } : {}), images: [image.url] },
  };
}

/**
 * A page's own share title, description and address, with the site's card
 * (27 Oct 2026). Setting `openGraph` on a page REPLACES the layout's whole
 * block, so a page that set only its title lost the image and locale
 * (`/gifts/printable-gifts`), and a page that set none showed the home
 * page's title and `og:url` (contact, feedback, the legal pages).
 */
export function pageShareMetadata(
  locale: string,
  path: string,
  { title, description, cardAlt }: { title: string; description: string; cardAlt: string }
): Metadata {
  const url = `${SITE_URL}/${locale}${path}`;
  // The site's card (the home page's), so its alt is the home card's own.
  const card = { url: `${SITE_URL}/${locale}/opengraph-image/card`, alt: cardAlt };
  const images = [{ url: card.url, width: 1200, height: 630, alt: card.alt }];
  return {
    openGraph: { type: "website", title, description, url, siteName: SITE_NAME, images, ...ogLocales(locale) },
    twitter: { card: "summary_large_image", title, description, images: [card.url] },
  };
}

/**
 * A collection page's structured data (27 Oct 2026): a CollectionPage whose
 * main entity is a plain ItemList of product LINKS, the form Google reads on
 * listing pages. Each item used to be a nested Product with no image and an
 * `offerCount` of 0, which Google flags as product markup on a page that is
 * not a product's; the products' own pages carry the full Product markup.
 */
export function collectionPageLd({
  name,
  description,
  url,
  items,
}: {
  name: string;
  description: string;
  url: string;
  items: { name: string; url: string }[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    description,
    url,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, url: item.url })),
    },
  };
}
