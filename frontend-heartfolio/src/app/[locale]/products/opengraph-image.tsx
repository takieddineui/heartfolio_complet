import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { OG_CONTENT_TYPE, OG_SIZE, captureStillDataUrl, ogTextLocale, renderOgImage } from "@/lib/og";
import { getAllProducts } from "@/lib/products/registry";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "The Heartfolio collection";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
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
