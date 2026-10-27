import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ogAltTranslator } from "@/lib/og-alt";
import { routing } from "@/i18n/routing";
import { OG_CONTENT_TYPE, OG_SIZE, captureStillDataUrl, ogTextLocale, renderOgImage } from "@/lib/og";
import { getCatalogStartingPrice } from "@/lib/products/catalog";
import { getCatalogProductDetail } from "@/lib/products/catalog-server";
import { getAllProducts, getProductBySlug } from "@/lib/products/registry";
import { formatPrice } from "@/lib/site-config";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
/**
 * The card's alt text in the page's own language (27 Oct 2026): a single
 * `export const alt` was English on every page. `generateImageMetadata` is
 * the only way to vary it, and it puts the card at `opengraph-image/card`.
 */
export function generateImageMetadata({ params }: { params: { locale: string; slug: string } }) {
  const product = getProductBySlug(params.slug);
  if (!product) return [];
  const names = ogAltTranslator(params.locale, `Products.${product.i18nKey}`);
  const t = ogAltTranslator(params.locale, "Captures");
  return [{ id: "card", alt: t("phoneAlt", { name: names("name") }), size: OG_SIZE, contentType: OG_CONTENT_TYPE }];
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
  // Django's starting price, as the product page shows it; the registry has
  // none (its offerings are empty), so the card carried no price before.
  const { product: catalogProduct } = await getCatalogProductDetail(product);
  const starting = getCatalogStartingPrice(catalogProduct);

  // The product's real live page, in the URL's language (the card's text
  // falls back to English on /ar; the capture need not).
  const still = await captureStillDataUrl(product.id, locale);

  return renderOgImage({
    stills: still ? [still] : [],
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
