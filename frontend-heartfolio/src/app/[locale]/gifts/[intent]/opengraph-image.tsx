import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ogAltTranslator } from "@/lib/og-alt";
import { routing } from "@/i18n/routing";
import { OG_CONTENT_TYPE, OG_SIZE, captureStillDataUrl, ogTextLocale, renderOgImage } from "@/lib/og";
import { enabledIntents, findIntent, productsForIntent } from "@/lib/products/gift-intents";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;


/** The card's alt text in the page's own language (see the home card). */
export function generateImageMetadata({ params }: { params: { locale: string; intent: string } }) {
  const intent = findIntent(params.intent);
  if (!intent) return [];
  const t = ogAltTranslator(params.locale, `GiftIntents.${intent.i18nKey}`);
  return [{ id: "card", alt: t("meta.imageAlt"), size: OG_SIZE, contentType: OG_CONTENT_TYPE }];
}

/**
 * A gift intent's share card (27 Oct 2026; it had none, so the page's own
 * `openGraph` left it imageless): its products' real live pages, in the
 * URL's language, with the page's title and description.
 */
export default async function Image({ params }: { params: Promise<{ locale: string; intent: string }> }) {
  const { locale, intent: slug } = await params;
  const intent = findIntent(slug);
  if (!intent) notFound();
  // See `ogTextLocale`: Arabic cards fall back to English text.
  const textLocale = ogTextLocale(locale);
  const t = await getTranslations({ locale: textLocale, namespace: `GiftIntents.${intent.i18nKey}` });
  const stills = (await Promise.all(productsForIntent(intent).map((product) => captureStillDataUrl(product.id, locale)))).filter(
    (still): still is string => still !== null
  );
  return renderOgImage({ stills, locale: textLocale, eyebrow: "Heartfolio", title: t("meta.title"), subtitle: t("meta.description") });
}
