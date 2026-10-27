"use client";

import { useTranslations } from "next-intl";
import { ArrowUpRight } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import { Link } from "@/i18n/navigation";
import { ProductCollection } from "@/components/product/product-collection";
import type { CatalogProduct } from "@/lib/products/catalog";

/**
 * The landing page's collection section (§6, §9).
 *
 * Reframed rather than rebuilt: the section is the same shape, but it now
 * reads as *a collection of keepsakes* instead of a showcase of one hero
 * product, and the card markup moved to `ProductCollection` so this
 * section and /products cannot drift apart. Cards now link to each
 * product's own page rather than dropping people straight into a picker.
 */
export function FeaturedKeepsakes({ products }: { products: CatalogProduct[] }) {
  const t = useTranslations("FeaturedKeepsakes");

  return (
    <section id="keepsakes" className="relative overflow-hidden bg-page py-24 sm:py-30">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <Reveal>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-champagne-gold">
            {t("eyebrow")}
          </p>
          <h2 className="mt-4 max-w-2xl font-serif text-3xl leading-tight text-heading sm:text-4xl md:text-5xl">
            {t("title")
              .split("\n")
              .map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
          </h2>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-body/75">{t("subtitle")}</p>
          <p className="mt-3 text-sm font-medium text-muted-sage">{t("paidOnce")}</p>
        </Reveal>

        <div className="mt-16">
          {/* Two by two: four products, none alone on a row (the
              collection's default grid). */}
          <ProductCollection products={products} />
        </div>

        <Reveal delay={0.1} className="mt-16 flex justify-center">
          <Link href="/products" className="group inline-flex items-center gap-2 font-serif text-lg text-heading">
            <span className="border-b border-champagne-gold pb-0.5">{t("cta")}</span>
            <ArrowUpRight className="h-4 w-4 transition-transform rtl:-scale-x-100 ltr:group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
