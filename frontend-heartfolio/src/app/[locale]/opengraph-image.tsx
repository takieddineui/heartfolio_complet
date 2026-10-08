import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { OG_CONTENT_TYPE, OG_SIZE, ogTextLocale, renderOgImage } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Heartfolio — personalized digital keepsakes";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // See `ogTextLocale` — Arabic cards fall back to English text.
  const textLocale = ogTextLocale(locale);
  const t = await getTranslations({ locale: textLocale, namespace: "Meta" });

  return renderOgImage({
    locale: textLocale,
    eyebrow: "Heartfolio",
    title: t("slogan"),
    subtitle: t("description"),
  });
}
