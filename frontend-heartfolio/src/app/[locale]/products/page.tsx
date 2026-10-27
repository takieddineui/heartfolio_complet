import { cache } from "react";
import type { Metadata } from "next";
import { jsonLdScript } from "@/lib/json-ld";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader, MobileStickyCta } from "@/components/layout/header";
import { SiteFooter } from "@/components/layout/footer";
import { ProductCollection } from "@/components/product/product-collection";
import { getCatalogProducts } from "@/lib/products/catalog-server";
import { filterCatalogByOccasion, getCatalogStartingPrice } from "@/lib/products/catalog";
import type { CatalogProduct } from "@/lib/products/catalog";
import { formatPrice, SITE_NAME, SITE_URL } from "@/lib/site-config";
import { buildAlternates, collectionPageLd, ogLocales } from "@/lib/seo";
import { Link } from "@/i18n/navigation";

/**
 * ---------------------------------------------------------------------
 * RENDERED PER REQUEST (§13)
 * ---------------------------------------------------------------------
 * This route previously declared `generateStaticParams`, which asked Next to
 * prerender it per locale at build time. That was already only half-true —
 * reading `?occasion=` forced the *component* dynamic — but `generateMetadata`
 * is not covered by that, and it now reads the catalog to write a live "from"
 * price into the description.
 *
 * The build made the consequence visible rather than hiding it: the `no-store`
 * catalog fetch threw `Dynamic server usage` during prerendering, was caught
 * by the fallback in `getCatalogProducts`, and would have baked the *priceless*
 * description into the static shell — a silently degraded meta description on
 * the storefront's main listing page, on every deploy.
 *
 * So the route is explicitly dynamic, matching `/products/[slug]` and the
 * homepage, and for the same stated reason: a price baked into a build
 * is a price that goes stale the moment the catalog changes.
 */
export const dynamic = "force-dynamic";

/** Same per-request memoization as the product route — see the note there. */
const catalogForRequest = cache(getCatalogProducts);

/**
 * The collection's own "from" price (§13): the cheapest currently
 * purchasable pack across the whole storefront, not a number typed into the
 * copy. Null when nothing is on sale or the catalog is unreachable, in which
 * case the description drops the clause rather than inventing one.
 */
function cheapestAcrossCatalog(products: CatalogProduct[]): { price: number; currency: string } | null {
  let cheapest: { price: number; currency: string } | null = null;

  for (const product of products) {
    if (product.status !== "available") continue;
    const price = getCatalogStartingPrice(product);
    if (price === null) continue;
    if (cheapest === null || price < cheapest.price) {
      cheapest = { price, currency: product.currency };
    }
  }
  return cheapest;
}

/**
 * The collection's meta description, priced or not. Shared by the `<meta>`
 * tag and the `CollectionPage` JSON-LD so the two cannot drift (§29).
 */
function describeCollection(
  t: (key: string, values?: Record<string, string>) => string,
  cheapest: { price: number; currency: string } | null
): string {
  return cheapest === null
    ? t("meta.descriptionNoPrice")
    : t("meta.description", { price: formatPrice(cheapest.price, cheapest.currency) });
}

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<{ occasion?: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Collection" });

  const { products } = await catalogForRequest();
  const description = describeCollection(t, cheapestAcrossCatalog(products));

  return {
    title: t("meta.title"),
    description,
    alternates: buildAlternates(locale, "/products"),
    openGraph: {
      type: "website",
      title: t("meta.title"),
      description,
      siteName: SITE_NAME,
      url: `${SITE_URL}/${locale}/products`,
      // No explicit `images` here on purpose: the `opengraph-image` file
      // convention alongside this route generates the card, and an
      // explicit entry would override it (and point at /og-image.png,
      // which does not exist in this repository).
      ...ogLocales(locale),
    },
    // Its own title on Twitter/X too; it showed the site's (27 Oct 2026).
    twitter: { card: "summary_large_image", title: t("meta.title"), description },
  };
}

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { locale } = await params;
  const { occasion } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "Collection" });
  const tProducts = await getTranslations({ locale, namespace: "Products" });
  // Commercial data from Django, presentation from the registry — the same
  // data layer /create uses. This route was already rendered per request
  // (it reads `?occasion=`), so nothing about its rendering mode changed.
  const { products: allProducts } = await catalogForRequest();

  /**
   * Minimal occasion filtering (Pass A §9) — no dedicated route, no
   * per-occasion schema, just this page reading its own query string.
   * If the occasion has no matching product yet (In Memory, New Chapter —
   * both depend on products that don't exist), fall back to the full
   * collection with an honest note rather than an empty grid, which would
   * read as broken rather than "more is coming."
   */
  const filtered = occasion ? filterCatalogByOccasion(allProducts, occasion) : allProducts;
  const isFiltered = Boolean(occasion) && filtered.length > 0;
  const isEmptyFilter = Boolean(occasion) && filtered.length === 0;
  const products = isEmptyFilter ? allProducts : filtered;

  let occasionLabel: string | null = null;
  if (occasion) {
    try {
      const tOccasions = await getTranslations({ locale, namespace: "GiftOccasions" });
      occasionLabel = tOccasions(`items.${occasion}.label`);
    } catch {
      occasionLabel = null;
    }
  }

  /** An ItemList of the collection — the same products, in the same
   * order, as the grid below it (§29). Reflects whatever is actually
   * showing, filtered or not. */
  const collectionLd = collectionPageLd({
    name: t("meta.title"),
    // Priced via the same helper as the <meta> tag; a bare call would emit
    // the raw message key, since the string now interpolates {price}.
    description: describeCollection(t, cheapestAcrossCatalog(allProducts)),
    url: `${SITE_URL}/${locale}/products`,
    items: products.map((product) => ({
      name: tProducts(`${product.i18nKey}.name`),
      url: `${SITE_URL}/${locale}/products/${product.slug}`,
    })),
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(collectionLd) }}
      />
      <SiteHeader />
      <main id="main-content" className="pb-20 md:pb-0">
        <section className="bg-page py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="max-w-2xl">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-champagne-gold">
                {t("eyebrow")}
              </p>
              {isFiltered && occasionLabel ? (
                <>
                  <h1 className="mt-4 font-serif text-4xl leading-[1.1] text-heading sm:text-5xl">
                    {t("occasionHeading", { occasion: occasionLabel })}
                  </h1>
                  <Link
                    href="/products"
                    className="mt-3 inline-block text-sm text-body/60 underline decoration-champagne-gold decoration-1 underline-offset-4 hover:text-heading"
                  >
                    {t("occasionViewAll")}
                  </Link>
                </>
              ) : (
                <h1 className="mt-4 font-serif text-4xl leading-[1.1] text-heading sm:text-5xl">
                  {t("title")}
                </h1>
              )}
              <p className="mt-5 text-lg leading-relaxed text-body/75">{t("subtitle")}</p>
              <p className="mt-4 text-sm leading-relaxed text-body/60">{t("digitalNote")}</p>
              {isEmptyFilter && (
                <p className="mt-4 text-sm leading-relaxed text-dusty-terracotta">
                  {t("occasionFallback")}
                </p>
              )}
            </div>

            <div className="mt-16">
              <ProductCollection products={products} />
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
      <MobileStickyCta />
    </>
  );
}

