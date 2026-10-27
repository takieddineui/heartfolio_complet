import { cache } from "react";
import type { Metadata } from "next";
import { jsonLdScript } from "@/lib/json-ld";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader, MobileStickyCta } from "@/components/layout/header";
import { SiteFooter } from "@/components/layout/footer";
import { ProductView } from "@/components/product/product-view";
import { ProductReviews } from "@/components/product/product-reviews";
import { RelatedGuides } from "@/components/guides/related-guides";
import { getProductBySlug } from "@/lib/products/registry";
import { getCatalogProductDetail } from "@/lib/products/catalog-server";
import { getCatalogStartingPrice, getProductPageOfferings } from "@/lib/products/catalog";
import { formatPrice, SITE_NAME, SITE_URL } from "@/lib/site-config";
import { absoluteUrl, buildAlternates, ogLocales } from "@/lib/seo";
import { captureImageUrls } from "@/lib/captures/manifest";

/**
 * Rendered per request, not prerendered.
 *
 * Prices, availability and delivery packs come from Django (see
 * `lib/products/catalog-server.ts`), and a price baked into a build
 * is a price that goes stale the moment the catalog changes. `generateStaticParams`
 * was removed for the same reason — it would have prerendered this route at
 * build time with whatever the catalog said then.
 *
 * The presentational half (copy, artwork, i18n) still comes from the static
 * registry, so nothing here waits on the network to know what to draw.
 */
export const dynamic = "force-dynamic";

type Params = Promise<{ locale: string; slug: string }>;

/**
 * ---------------------------------------------------------------------
 * ONE CATALOG READ PER REQUEST (§13)
 * ---------------------------------------------------------------------
 * `generateMetadata` and the page body both need Django's price now — the
 * first to write it into the meta description, the second to render the
 * offerings. Next runs them in the same render pass, so without this they
 * would be two `no-store` round-trips to the backend for every product-page
 * view, and worse, two *independent* answers: a catalog change landing
 * between them would publish a meta description quoting one price while
 * the page below it showed another.
 *
 * React's `cache()` memoizes per request, so both callers see one result.
 * Keyed on the registry entry's object identity, which is stable —
 * `getProductBySlug` returns the same instance from the module-level array
 * both times.
 */
const productDetailForRequest = cache(getCatalogProductDetail);

/**
 * The product's meta description, with Django's price interpolated (§13).
 *
 * Shared because it has two consumers that must not disagree: the `<meta>`
 * tag and the `Product` JSON-LD `description`. §29 requires structured data
 * to match what the page actually says, and duplicating the price/no-price
 * choice in two places is how that quietly stops being true.
 *
 * `t` is a namespaced translator for this product; `startingPrice` is null
 * when no price is available.
 */
function describeProduct(
  t: (key: string, values?: Record<string, string>) => string,
  startingPrice: number | null,
  currency: string
): string {
  return startingPrice === null
    ? t("meta.descriptionNoPrice")
    : t("meta.description", { price: formatPrice(startingPrice, currency) });
}

/**
 * Per-product metadata (§28, §32). Every title and description is written
 * for the specific keepsake and translated per locale — no "Heartfolio
 * Product" placeholders, and no reusing the homepage OG image (see the
 * `ogImage` TODOs in the registry for the art still to be produced).
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, slug } = await params;
  const product = getProductBySlug(slug);
  if (!product) notFound();

  const t = await getTranslations({ locale, namespace: `Products.${product.i18nKey}` });
  const title = t("meta.title");
  const path = `/products/${product.slug}`;

  /**
   * §13: the price in this description comes from Django, never from the
   * copy. It used to read "From $12 USD" in all three locales — a number
   * that was already wrong (the cheapest live pack is $8) and that would go
   * wrong again the moment the catalog changed.
   *
   * When no price is available — a cold-start outage, or Django reporting
   * the product isn't purchasable — the description falls back to a variant
   * written without the clause. It does NOT guess, and it does not emit a
   * half-finished sentence: a meta description is what a search result
   * shows, so a fabricated or malformed price is worse than none.
   */
  const { product: catalogProduct } = await productDetailForRequest(product);
  const description = describeProduct(
    t,
    getCatalogStartingPrice(catalogProduct),
    catalogProduct.currency
  );

  return {
    title,
    description,
    alternates: buildAlternates(locale, path),
    openGraph: {
      type: "website",
      title,
      description,
      siteName: SITE_NAME,
      url: `${SITE_URL}/${locale}${path}`,
      // The card is generated by the `opengraph-image` file alongside this
      // route, per product and locale, with the product's real capture on a
      // phone; `ogImage` in the registry would override it (none does).
      ...(product.ogImage
        ? { images: [{ url: absoluteUrl(product.ogImage), width: 1200, height: 630, alt: t("meta.imageAlt") }] }
        : {}),
      ...ogLocales(locale),
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ProductPage({ params }: { params: Params }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const entry = getProductBySlug(slug);
  if (!entry) notFound();

  // Commercial data (status, prices, packs) from Django; presentation from
  // the registry. `CatalogProduct` extends `ProductEntry`, so every component
  // below — ProductView included — receives exactly the shape it already
  // expected and renders unchanged.
  const { product, source, printSizes, reviews, ratingSummary } = await productDetailForRequest(entry);
  // Only a genuine cold-start outage suppresses the offerings; a cached
  // catalog is real data and renders normally.
  const catalogUnavailable = source === "unavailable";

  const t = await getTranslations({ locale, namespace: `Products.${product.i18nKey}` });
  const tOffer = await getTranslations({ locale, namespace: "Products.offerings" });
  const tPage = await getTranslations({ locale, namespace: "ProductPage" });

  // The same three primary editions the page itself renders (§29:
  // structured data must match visible content) — not the straight
  // per-pack `offerings` the merchant feed still uses, which would
  // advertise the now-hidden standalone wallpaper offer here and still
  // omit the two combo tiers.
  const offerings = getProductPageOfferings(product);
  const faq = t.raw("faq") as { question: string; answer: string }[];
  const url = `${SITE_URL}/${locale}/products/${product.slug}`;

  /**
   * Structured data (§29). Every claim below is also visible on the page:
   * the offerings and their prices are rendered, the FAQ entries are
   * rendered, the breadcrumb is rendered. There are deliberately NO
   * aggregateRating or review nodes — Heartfolio has no published reviews,
   * and inventing them would be both false and a rich-results violation.
   */
  /**
   * The refund policy, by its page only (owner, 27 Oct 2026): no refund once
   * the keepsake is delivered, except when it is broken or not as described
   * and the customer writes within 14 days. Google's return categories
   * ("free return", "damaged item") describe physical goods and would
   * misrepresent a digital one, so the markup is just the link to `/refunds`;
   * the Search Console warning about missing categories is accepted.
   */
  const returnPolicy = {
    "@type": "MerchantReturnPolicy",
    merchantReturnLink: `${SITE_URL}/${locale}/refunds`,
  };

  const productLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: t("name"),
    // Same string as the <meta> tag above — see `describeProduct`. Calling
    // `t("meta.description")` bare here would have emitted the literal
    // message key into the JSON-LD, because the message now needs {price}.
    description: describeProduct(t, getCatalogStartingPrice(product), product.currency),
    url,
    // The product itself: its real live page and, for printable products,
    // its print, with fictional sample content (`lib/captures`). Google's
    // product results want an image; there was none until 26 Oct 2026.
    image: captureImageUrls(product.id, locale, SITE_URL),
    brand: { "@type": "Brand", name: SITE_NAME },
    /**
     * §7c — included ONLY when reviews actually exist.
     *
     * Google treats an aggregate rating with nothing behind it as a
     * structured-data violation, and the penalty lands on the domain rather
     * than the page. Emitting `ratingCount: 0`, or a default 5.0 to make
     * the markup look complete, is precisely that failure. `ratingSummary`
     * is null until something is published, and the spread adds nothing.
     */
    ...(ratingSummary
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: ratingSummary.average,
            reviewCount: ratingSummary.count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
    category: "Personalized digital keepsake",
    offers: offerings.map((offering) => ({
      "@type": "Offer",
      name: tOffer(`${offering.i18nKey}.name`),
      price: offering.price.toFixed(2),
      priceCurrency: offering.currency,
      url,
      // Digital goods: no shipping, delivered as a download.
      itemCondition: "https://schema.org/NewCondition",
      availability:
        product.status === "available"
          ? "https://schema.org/InStock"
          : "https://schema.org/PreOrder",
      hasMerchantReturnPolicy: returnPolicy,
    })),
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: tPage("breadcrumbHome"),
        item: `${SITE_URL}/${locale}`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: tPage("breadcrumbProducts"),
        item: `${SITE_URL}/${locale}/products`,
      },
      { "@type": "ListItem", position: 3, name: t("name"), item: url },
    ],
  };

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript([productLd, breadcrumbLd, faqLd]),
        }}
      />
      <SiteHeader />
      <ProductView
        product={product}
        catalogUnavailable={catalogUnavailable}
        printSizes={printSizes}
      />
      <RelatedGuides productId={product.id} locale={locale} />
      <ProductReviews reviews={reviews} summary={ratingSummary} />
      <SiteFooter />
      <MobileStickyCta />
    </>
  );
}
