"use client";

import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { CelestialSequence } from "@/components/motion/celestial-sequence";
import { CaptureShowcase, type ShowcaseItem } from "@/components/captures/capture-showcase";
import { getProductCaptures } from "@/lib/captures/manifest";
import type { CatalogProduct } from "@/lib/products/catalog";

export function Hero({ products }: { products: CatalogProduct[] }) {
  const t = useTranslations("Hero");
  const tProducts = useTranslations("Products");
  const locale = useLocale();
  const items: ShowcaseItem[] = products.flatMap((product) => {
    const captures = getProductCaptures(product.id, locale);
    return captures ? [{ id: product.id, name: tProducts(`${product.i18nKey}.name`), captures }] : [];
  });
  const headlineLines = t("headline").split("\n");

  return (
    <section
      id="hero"
      className="relative flex min-h-[92vh] flex-col justify-end overflow-hidden bg-ink-navy text-parchment"
    >
      {/* Night gradient + candlelight vignette (Design System §4) */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 15% 100%, rgba(201,162,75,0.10), transparent 60%), linear-gradient(180deg, #141b2e 0%, #1d2540 55%, #141b2e 100%)",
        }}
      />
      {/*
        Pass B §14/§15: the star field previously covered the entire hero
        at full density (130 stars) plus 5 drifting hearts, scattered
        directly over the headline and the plain-language definition line —
        competing with the words for attention rather than sitting quietly
        behind the artwork. It was also the source of an ugly artifact: a
        heart path stretched by `preserveAspectRatio="none"` across a wide,
        short viewport reads as a distorted maroon blob, not a heart.
        Reduced density, dropped the hearts entirely here (they add nothing
        the headline doesn't already say), and masked so the stars fade out
        over the text column and stay concentrated behind the artwork —
        texture for the composition, not noise over the copy.

        `hidden lg:block`: the mask assumes the two-column desktop layout
        (text on one side, artwork on the other) and fades out accordingly.
        Below `lg` the text runs full-width with no separate art column for
        the stars to sit behind — the mask's "visible" zone landed squarely
        on top of the headline instead, moon included. The plain gradient
        above already gives mobile its night backdrop; verified on a real
        390px viewport (Pass B §19).
      */}
      <div className="pointer-events-none absolute inset-0 hidden h-full w-full opacity-70 [mask-image:linear-gradient(90deg,transparent_0%,transparent_30%,black_62%)] [-webkit-mask-image:linear-gradient(90deg,transparent_0%,transparent_30%,black_62%)] rtl:[mask-image:linear-gradient(270deg,transparent_0%,transparent_30%,black_62%)] rtl:[-webkit-mask-image:linear-gradient(270deg,transparent_0%,transparent_30%,black_62%)] lg:block">
        <CelestialSequence starCount={46} heartCount={0} className="h-full w-full" />
      </div>

      <div className="relative mx-auto grid w-full max-w-7xl items-center gap-x-16 gap-y-14 px-5 pb-20 pt-36 sm:px-8 md:pb-28 lg:grid-cols-[minmax(0,1fr)_auto] lg:pt-28">
        <div>
          {/* No fade-in on any of this text (owner, 27 Oct 2026): the hero
              paragraph is the phone's LCP element, and the entrance animation
              held it back about 1.4 s. It paints with the page. */}
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-champagne-gold/90">
            {t("eyebrow")}
          </p>

          <h1 className="mt-6 max-w-4xl font-serif text-[40px] leading-[1.08] text-parchment sm:text-6xl md:text-7xl">
            {headlineLines.map((line) => (
              <span key={line} className="block text-balance">
                {line}
              </span>
            ))}
          </h1>

          {/* The plain-language definition (Pass A §7). The headline above
              is deliberately emotional rather than descriptive, which meant
              nothing on the page stated in ordinary words what Heartfolio
              actually is — a person skimming, or a model summarising the
              page, had to infer it from context. This says it directly. */}
          <p className="mt-4 max-w-lg font-serif text-xl text-champagne-gold">
            {t("definition")}
          </p>

          <p className="mt-7 max-w-lg text-lg leading-relaxed text-parchment/75">
            {t("subhead")}
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-5">
            {/* The hero now sends people to the collection, not straight
                into a picker — see the product first, create second. */}
            <Button variant="onDark" size="lg" asChild>
              <Link href="/products">
                {t("cta")}
                <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
              </Link>
            </Button>
            <Link
              href="/#how-it-works"
              className="group flex items-center gap-2 text-[15px] text-parchment/75 transition-colors hover:text-parchment"
            >
              {t("ctaSecondary")}
              <ArrowDown className="h-4 w-4 transition-transform group-hover:translate-y-0.5" />
            </Link>
          </div>

          <p className="mt-8 text-xs uppercase tracking-[0.12em] text-parchment/45">
            {t("trust")}
          </p>
        </div>

        {/* The four keepsakes, really playing (lib/captures). Below the
            buttons on a phone, so the headline is still what loads first. */}
        <div className="mx-auto w-[min(62vw,250px)] lg:w-[240px]">
          <CaptureShowcase items={items} label={t("showcaseLabel")} />
        </div>
      </div>
    </section>
  );
}
