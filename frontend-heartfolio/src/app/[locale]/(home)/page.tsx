import { getTranslations, setRequestLocale } from "next-intl/server";
import { jsonLdScript } from "@/lib/json-ld";
import { ProductReviews } from "@/components/product/product-reviews";
import { getCatalogProducts } from "@/lib/products/catalog-server";
import { getFeaturedCatalogProducts } from "@/lib/products/catalog";
import { SITE_NAME, SITE_URL, SUPPORT_EMAIL } from "@/lib/site-config";
import { SiteHeader, MobileStickyCta } from "@/components/layout/header";
import { SiteFooter } from "@/components/layout/footer";
import { Hero } from "@/components/sections/hero";
import { FeaturedKeepsakes } from "@/components/sections/featured-keepsakes";
import { HowItWorks } from "@/components/sections/how-it-works";
import { OpenMoment } from "@/components/sections/open-moment";
import { ByOccasion } from "@/components/sections/by-occasion";
import { Faq } from "@/components/sections/faq";
// Server-safe on purpose — see faq-keys.ts. Importing this from faq.tsx
// (a "use client" file) instead of here is what caused
// `HOMEPAGE_FAQ_KEYS.map is not a function` in production SSR.
import { FAQ_KEYS as HOMEPAGE_FAQ_KEYS } from "@/components/sections/faq-keys";
import { FinalCta } from "@/components/sections/final-cta";

/**
 * Rendered per request.
 *
 * The Featured Keepsakes cards show a starting price, and that price is
 * Django's. Prerendering this page would bake it into the build, which is
 * exactly the staleness the catalog integration exists to remove — and the
 * failure mode is a customer seeing one price on the homepage and another
 * on the product page.
 *
 * TRADE-OFF, deliberately surfaced rather than absorbed: this is the
 * highest-traffic page and it was previously fully static. Two documented
 * alternatives keep most of that benefit — `export const revalidate = N`
 * (static with bounded staleness) or Next's experimental `ppr` /
 * `cacheComponents` (static shell with a dynamic hole for the prices).
 * Switching to the first is a one-line change here. The second is an
 * experimental flag and was not enabled unilaterally on a storefront.
 */
export const dynamic = "force-dynamic";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Meta" });

  // Same data layer as /create and /products. Registry-only products keep
  // their static marketing figures; the two launch products get Django's.
  const { products: catalogProducts, taxonomy } = await getCatalogProducts();
  const featuredProducts = getFeaturedCatalogProducts(catalogProducts);

  /**
   * Organization + WebSite (§29, §30). Written so an AI or a crawler
   * reading only this understands that Heartfolio is a *collection* of
   * personalized digital keepsakes — not a single-product generator.
   * No reviews, ratings or prices are asserted here: those belong on the
   * product pages, where they are actually visible.
   */
  const organizationLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: `${SITE_URL}/${locale}`,
    slogan: t("slogan"),
    description: t("description"),
    email: SUPPORT_EMAIL,
    logo: `${SITE_URL}/icon.svg`,
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: SUPPORT_EMAIL,
      availableLanguage: ["English", "French", "Arabic"],
    },
  };

  /**
   * FAQPage (§16a, §29).
   *
   * The homepage carried six real questions and no structured data for any
   * of them — the product page had FAQPage markup, the homepage did not. So
   * the plainest statements on the site of what this is, what you receive
   * and how printing works were invisible to exactly the readers §16a is
   * about.
   *
   * Built from `HOMEPAGE_FAQ_KEYS`, the same list the visible section
   * renders from, because §29 requires structured data to match what the
   * page actually says. Two hand-maintained lists would drift, and the
   * drift would be invisible until a crawler reported a mismatch.
   */
  const tFaq = await getTranslations({ locale, namespace: "Faq" });
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${SITE_URL}/${locale}#faq`,
    inLanguage: locale,
    mainEntity: HOMEPAGE_FAQ_KEYS.map((key) => ({
      "@type": "Question",
      name: tFaq(`items.${key}.question`),
      acceptedAnswer: { "@type": "Answer", text: tFaq(`items.${key}.answer`) },
    })),
  };

  const websiteLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: `${SITE_URL}/${locale}`,
    name: SITE_NAME,
    description: t("description"),
    inLanguage: locale,
    publisher: { "@id": `${SITE_URL}/#organization` },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript([organizationLd, websiteLd, faqLd]) }}
      />
      <SiteHeader />
      <main id="main-content" className="pb-20 md:pb-0">
        {/* The approved order (27 Oct 2026): what it is, the collection, how
            it is made, the recipient's side, ways in by occasion, then the
            questions. Moods, "Why Heartfolio" and Pricing are gone: they
            described palettes, a lock-screen wallpaper and a price section
            the cards already carry. */}
        <Hero products={featuredProducts} />
        <FeaturedKeepsakes products={featuredProducts} />
        <HowItWorks />
        <OpenMoment />
        <ByOccasion products={featuredProducts} />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
      <ProductReviews reviews={taxonomy.reviews} summary={taxonomy.ratingSummary} />
      <MobileStickyCta />
    </>
  );
}
