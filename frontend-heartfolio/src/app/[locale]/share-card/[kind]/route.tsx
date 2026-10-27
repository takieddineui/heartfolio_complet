import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ogTextLocale, renderOgImage } from "@/lib/og";

/**
 * The neutral share card of a gift link (live page, AR scene) or an order
 * link (27 Oct 2026): "A gift for you" or "Your order", in the URL's language
 * (the order's, for a gift link), and nothing about the keepsake itself. No
 * id reaches this route, so it cannot reveal anything (`seo.ts`,
 * `neutralShareMetadata`). Arabic cards use the English text, as every share
 * card does (`ogTextLocale`: the image renderer cannot shape Arabic).
 */
const KINDS = { gift: "live", order: "order" } as const;

export async function GET(_request: Request, { params }: { params: Promise<{ locale: string; kind: string }> }) {
  const { locale, kind } = await params;
  if (!(kind in KINDS)) notFound();
  const textLocale = ogTextLocale(locale);
  const titles = await getTranslations({ locale: textLocale, namespace: "PageTitles" });
  const share = await getTranslations({ locale: textLocale, namespace: "ShareCards" });
  return renderOgImage({
    locale: textLocale,
    eyebrow: "Heartfolio",
    title: titles(KINDS[kind as keyof typeof KINDS]),
    subtitle: share(`${kind}.description`),
  });
}
