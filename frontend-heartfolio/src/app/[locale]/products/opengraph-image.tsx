import { getTranslations } from "next-intl/server";
import { ogAltTranslator } from "@/lib/og-alt";
import { routing } from "@/i18n/routing";
import { OG_CONTENT_TYPE, OG_SIZE, captureStillDataUrl, ogTextLocale, renderOgImage } from "@/lib/og";
import { getAllProducts } from "@/lib/products/registry";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
/**
 * The card's alt text in the page's own language (27 Oct 2026): a single
 * `export const alt` was English on every page. `generateImageMetadata` is
 * the only way to vary it, and it puts the card at `opengraph-image/card`.
 */
export function generateImageMetadata({ params }: { params: { locale: string } }) {
  // The collection's card shows all four keepsakes, as the home page's does.
  const t = ogAltTranslator(params.locale, "Meta");
  return [{ id: "card", alt: t("ogAlt"), size: OG_SIZE, contentType: OG_CONTENT_TYPE }];
}


export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // See `ogTextLocale` — Arabic cards fall back to English text.
  const textLocale = ogTextLocale(locale);
  const t = await getTranslations({ locale: textLocale, namespace: "Collection" });

  // Every visible product's real live page, in the URL's language.
  const stills = (
    await Promise.all(getAllProducts().map((product) => captureStillDataUrl(product.id, locale)))
  ).filter((still): still is string => still !== null);

  return renderOgImage({
    stills,
    locale: textLocale,
    eyebrow: t("eyebrow"),
    title: t("title"),
    subtitle: t("subtitle"),
  });
}
