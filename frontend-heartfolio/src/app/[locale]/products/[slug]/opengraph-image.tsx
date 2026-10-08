import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { OG_CONTENT_TYPE, OG_SIZE, ogTextLocale, renderOgImage } from "@/lib/og";
import { getAllProducts, getProductBySlug, getStartingPrice } from "@/lib/products/registry";
import { formatPrice } from "@/lib/site-config";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "A Heartfolio personalized keepsake";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    getAllProducts().map((product) => ({ locale, slug: product.slug }))
  );
}

/** One card per product per locale — the product's own name, its own
 * line, and its own starting price, so no two share the same image (§32). */
export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  // See `ogTextLocale` — Arabic cards fall back to English text.
  const textLocale = ogTextLocale(locale);
  const product = getProductBySlug(slug);
  if (!product) notFound();

  const t = await getTranslations({ locale: textLocale, namespace: `Products.${product.i18nKey}` });
  const tPage = await getTranslations({ locale: textLocale, namespace: "ProductPage" });
  const starting = getStartingPrice(product);

  return renderOgImage({
    locale: textLocale,
    eyebrow: tPage("eyebrow"),
    title: t("name"),
    subtitle: t("shortDescription"),
    footnote:
      starting !== null
        ? tPage("from", { price: formatPrice(starting, product.currency) })
        : undefined,
  });
}
