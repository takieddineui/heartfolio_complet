import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/layout/header";
import { SiteFooter } from "@/components/layout/footer";
import { ProductCollection } from "@/components/product/product-collection";
import { getCatalogProducts } from "@/lib/products/catalog-server";
import { findIntent, productsForIntent } from "@/lib/products/gift-intents";
import { buildAlternates } from "@/lib/seo";
import { SITE_URL } from "@/lib/site-config";

/**
 * §16c — a gift-intent landing page.
 *
 * `generateStaticParams` builds only intents that are switched on AND have
 * live products behind them, so a page cannot exist for an intent with
 * nothing to show. Anything else 404s: `findIntent` reads the same enabled
 * set, so an intent disabled or emptied later stops resolving rather than
 * rendering an empty grid under a promising headline.
 *
 * The products come from the catalog exactly as `/products` gets them, which
 * means the §14 guarantee is inherited — a hidden product cannot surface
 * here any more than it can on the collection page.
 */
/**
 * RENDERED PER REQUEST, like every other page that reads live prices.
 *
 * This route originally declared `generateStaticParams`, and the build made
 * the consequence visible: the `no-store` catalog fetch threw
 * `Dynamic server usage` during prerendering, was caught by the fallback in
 * `getCatalogProducts`, and would have baked an EMPTY product grid into the
 * static shell — a landing page promising printable gifts above nothing at
 * all, on every deploy.
 *
 * Validity is enforced by `findIntent` instead, which reads the same enabled
 * set `generateStaticParams` would have: an unknown, disabled or emptied
 * intent 404s rather than rendering.
 *
 * (The same mistake was made and fixed on `/products`. Any route reading the
 * catalog has to be dynamic — prices are never baked into a build.)
 */
export const dynamic = "force-dynamic";

type Params = Promise<{ locale: string; intent: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, intent: slug } = await params;
  const intent = findIntent(slug);
  if (!intent) return {};

  const t = await getTranslations({ locale, namespace: `GiftIntents.${intent.i18nKey}` });
  return {
    title: t("meta.title"),
    description: t("meta.description"),
    alternates: buildAlternates(locale, `/gifts/${intent.slug}`),
    robots: { index: true, follow: true },
    openGraph: {
      title: t("meta.title"),
      description: t("meta.description"),
      url: `${SITE_URL}/${locale}/gifts/${intent.slug}`,
      type: "website",
    },
  };
}

export default async function GiftIntentPage({ params }: { params: Params }) {
  const { locale, intent: slug } = await params;
  setRequestLocale(locale);

  const intent = findIntent(slug);
  if (!intent) notFound();

  const t = await getTranslations({ locale, namespace: `GiftIntents.${intent.i18nKey}` });
  const { products: catalogProducts } = await getCatalogProducts();

  // The registry decides which products belong here; the catalog supplies
  // their live prices and availability.
  const eligible = new Set(productsForIntent(intent).map((product) => product.slug));
  const products = catalogProducts.filter((product) => eligible.has(product.slug));

  return (
    <>
      <SiteHeader />
      <main className="bg-page">
        <section className="py-20 sm:py-28">
          <div className="mx-auto max-w-3xl px-5 text-center sm:px-8">
            <h1 className="font-serif text-4xl leading-tight text-heading sm:text-5xl">
              {t("title")}
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-body/75">{t("intro")}</p>
          </div>
        </section>
        <ProductCollection products={products} />
      </main>
      <SiteFooter />
    </>
  );
}
