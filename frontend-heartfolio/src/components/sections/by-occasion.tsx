"use client";

import { useLocale, useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion/reveal";
import { Link } from "@/i18n/navigation";
import { CaptureStill, PhoneFrame } from "@/components/captures/capture-media";
import { getProductCaptures } from "@/lib/captures/manifest";
import type { CatalogProduct } from "@/lib/products/catalog";

/**
 * By occasion: three ways in, each naming the keepsakes made for it. It
 * replaced the five-occasion block (anniversary, wedding, new baby, memorial,
 * housewarming), three of which had no product. Only products the catalog
 * shows are linked, and an occasion left with none is not drawn.
 */
const OCCASIONS = [
  { key: "love", still: "reasons-i-love-you", products: ["love-story-timeline", "reasons-i-love-you", "song-poster"] },
  { key: "graduation", still: "graduation-keepsake", products: ["graduation-keepsake"] },
  { key: "song", still: "song-poster", products: ["song-poster"] },
] as const;

export function ByOccasion({ products }: { products: CatalogProduct[] }) {
  // The eyebrow is the occasions block's, already translated.
  const tHeading = useTranslations("GiftOccasions");
  const t = useTranslations("ByOccasion");
  const tProducts = useTranslations("Products");
  const tCaptures = useTranslations("Captures");
  const locale = useLocale();

  const byId = new Map(products.map((product) => [product.id, product]));
  const occasions = OCCASIONS.map((occasion) => ({
    ...occasion,
    links: occasion.products.flatMap((id) => {
      const product = byId.get(id);
      return product ? [{ id, slug: product.slug, name: tProducts(`${product.i18nKey}.name`) }] : [];
    }),
  })).filter((occasion) => occasion.links.length > 0);
  if (occasions.length === 0) return null;

  return (
    <section id="occasions" className="bg-page py-24 sm:py-30">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <Reveal className="max-w-xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-champagne-gold">{tHeading("eyebrow")}</p>
          <h2 className="mt-4 font-serif text-3xl leading-tight text-heading sm:text-4xl md:text-5xl">{t("title")}</h2>
          <p className="mt-5 text-base leading-relaxed text-body/75">{t("subtitle")}</p>
        </Reveal>

        <RevealGroup className="mt-16 grid gap-6 md:grid-cols-3">
          {occasions.map((occasion) => {
            const still = getProductCaptures(occasion.still, locale)?.poster;
            const stillName = occasion.links.find((link) => link.id === occasion.still)?.name ?? occasion.links[0]!.name;
            return (
              <RevealItem key={occasion.key} className="flex flex-col overflow-hidden rounded-[var(--radius-lg)] bg-card shadow-[var(--shadow-whisper)]">
                {still && (
                  // A window onto the top of the keepsake's phone: the
                  // still's upper part, enough to know it at a glance.
                  <div className="relative flex h-56 justify-center overflow-hidden bg-gradient-to-b from-subtle/35 to-subtle/10 pt-8">
                    <PhoneFrame className="w-[46%] max-w-[170px] self-start">
                      <CaptureStill still={still} alt={tCaptures("phoneAlt", { name: stillName })} />
                    </PhoneFrame>
                  </div>
                )}
                <div className="flex flex-1 flex-col p-8">
                  <h3 className="font-serif text-2xl text-heading">{t(`items.${occasion.key}.label`)}</h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-body/75">{t(`items.${occasion.key}.description`)}</p>
                  <ul className="mt-6 space-y-2">
                    {occasion.links.map((link) => (
                      <li key={link.id}>
                        <Link
                          href={`/products/${link.slug}`}
                          className="group inline-flex items-center gap-1.5 text-sm font-medium text-heading hover:text-champagne-gold"
                        >
                          {link.name}
                          <ArrowRight className="h-3.5 w-3.5 transition-transform rtl:rotate-180 ltr:group-hover:translate-x-1 rtl:group-hover:-translate-x-1" aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </RevealItem>
            );
          })}
        </RevealGroup>
      </div>
    </section>
  );
}
