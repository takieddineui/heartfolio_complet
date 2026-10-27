import { notFound } from "next/navigation";
import { OG_CONTENT_TYPE, OG_SIZE, captureStillDataUrl, ogTextLocale, renderOgImage } from "@/lib/og";
import { findGuide } from "@/lib/guides/registry";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/** The card's alt text is the guide's own title, in its own language (no
 *  request needed: `generateImageMetadata` also runs at build time). */
export function generateImageMetadata({ params }: { params: { locale: string; slug: string } }) {
  const found = findGuide(params.locale, params.slug);
  if (!found) return [];
  return [{ id: "card", alt: found.translation.title, size: OG_SIZE, contentType: OG_CONTENT_TYPE }];
}

/**
 * A guide's share card: its title and description beside the keepsakes it is
 * about, as they really look. Arabic cards fall back to the English layout
 * (`ogTextLocale`), as every share card does.
 */
export default async function Image({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const found = findGuide(locale, slug);
  if (!found) notFound();
  const stills = (await Promise.all(found.guide.products.map((product) => captureStillDataUrl(product, locale)))).filter(
    (still): still is string => still !== null
  );
  // The renderer cannot shape Arabic, so an Arabic guide's card carries its
  // English translation's text (and none, rather than broken letters, if it
  // has no English one).
  const textLocale = ogTextLocale(locale);
  const text = textLocale === locale ? found.translation : found.guide.translations.en;
  return renderOgImage({
    stills,
    locale: textLocale,
    eyebrow: "Heartfolio",
    title: text?.title ?? "Heartfolio",
    subtitle: text?.description,
  });
}
