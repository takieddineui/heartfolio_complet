"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { ArrowUpRight, Clock } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Reveal } from "@/components/motion/reveal";
import { CaptureLoop, PhoneFrame } from "@/components/captures/capture-media";
import { getProductCaptures } from "@/lib/captures/manifest";
import { formatPrice } from "@/lib/site-config";
import { getCatalogStartingPrice, type CatalogProduct } from "@/lib/products/catalog";
import { useProductContent } from "@/lib/products/use-product-content";

/**
 * The collection grid (§9) — used by the landing page and by
 * /products, so a card looks and behaves identically in both places.
 *
 * Each card carries exactly what the brief asks for and nothing more:
 * artwork, name, one emotional line, starting price, availability, CTA.
 * Per-variant prices deliberately stay off the card and live on the
 * product page, so the collection reads calm rather than like a price list.
 *
 * `gridClassName` lets a caller (Featured Keepsakes on the homepage, Pass B
 * §5) choose a different arrangement — e.g. a steady 2-column gallery
 * layout that never leaves one item stranded alone on its own row — without
 * forking the card markup itself. `/products` doesn't pass one, so its
 * existing 3-column catalog grid is unchanged.
 */
export function ProductCollection({
  products,
  gridClassName,
}: {
  products: CatalogProduct[];
  gridClassName?: string;
}) {
  return (
    <div
      className={
        // Two columns from tablet up: the four products sit two by two, so no
        // product is left alone on a row (a third column stranded the
        // fourth). Capped so a desktop card stays card-sized.
        gridClassName ?? "mx-auto grid max-w-5xl gap-10 sm:grid-cols-2 sm:gap-x-10 sm:gap-y-16"
      }
    >
      {products.map((product, i) => (
        <ProductCollectionCard key={product.id} product={product} index={i} />
      ))}
    </div>
  );
}

/** One card — its own component so `useProductContent` is called at a
 * stable top level per item, not inside the parent's `.map()` (which
 * would violate the Rules of Hooks). */
function ProductCollectionCard({ product, index }: { product: CatalogProduct; index: number }) {
  const t = useTranslations("Collection");
  const content = useProductContent(product);
  // Django's starting price for live products; the static marketing figure
  // only for waitlist products, which have no backend row to defer to.
  const starting = getCatalogStartingPrice(product);
  const locale = useLocale();
  const tCaptures = useTranslations("Captures");
  const captures = getProductCaptures(product.id, locale);
  // The card's loop plays while it is hovered or keyboard-focused, never by
  // itself: a grid of moving phones would compete with each other.
  const [active, setActive] = useState(false);

  return (
    <Reveal delay={(index % 3) * 0.08}>
      {/* The card links to the product *page* — presentation before
          creation. The Studio is never entered from a card. */}
      <Link
        href={`/products/${product.slug}`}
        className="group block h-full"
        onMouseEnter={() => setActive(true)}
        onMouseLeave={() => setActive(false)}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
      >
        <motion.article
          whileHover={{ y: -6, rotate: index % 2 === 0 ? -0.6 : 0.6 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="flex h-full flex-col"
        >
          <div className="relative aspect-[4/5] overflow-hidden rounded-[var(--radius-xl)] bg-gradient-to-b from-subtle/35 to-subtle/10 shadow-[var(--shadow-whisper)] transition-shadow duration-300 group-hover:shadow-[var(--shadow-lift)]">
            {/* The product's real live page with sample content, on a phone
                (lib/captures). It replaced drawn stand-ins and, for Reasons
                and Graduation, an empty dark box. */}
            {captures && (
              <div className="absolute inset-0 flex items-center justify-center">
                {/* 47% of a 4:5 card leaves the phone (about 1:2.16) a calm
                    margin above and below; the still's own size sets its
                    height. */}
                <PhoneFrame className="w-[47%]">
                  <CaptureLoop captures={captures} alt={tCaptures("phoneAlt", { name: content.name })} mode="hover" active={active} />
                </PhoneFrame>
              </div>
            )}
            {/*
              Pass B §5: badges were solid-fill stamped pills — "Waitlist",
              "Coming soon", "New" — indistinguishable from software feature
              flags. Softened to a quiet outlined tag with no fill, so a
              status is still legible up close but doesn't compete with the
              artwork the way a bright corner sticker does.
            */}
            {content.badge && (
              <span className="absolute start-4 top-4 rounded-full border border-candle-white/70 bg-ink-navy/20 px-3 py-1 text-[11px] font-medium tracking-wide text-candle-white backdrop-blur-[2px]">
                {content.badge}
              </span>
            )}
            {product.status === "waitlist" && (
              <span className="absolute end-4 top-4 flex items-center gap-1 rounded-full border border-parchment/40 px-3 py-1 text-[11px] font-medium tracking-wide text-parchment/90">
                <Clock className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                {t("statusWaitlist")}
              </span>
            )}
            {(product.status === "coming_soon" || product.status === "disabled") && (
              <span className="absolute end-4 top-4 rounded-full border border-parchment/40 px-3 py-1 text-[11px] font-medium tracking-wide text-parchment/90">
                {t("statusComingSoon")}
              </span>
            )}
            {/* A quiet hover affordance instead of a permanently-visible
                "Explore →" repeated under every card — the whole piece is
                already the link; this just confirms it on approach, the
                way a gallery label appears when you step closer rather
                than shouting from across the room. */}
            <div className="pointer-events-none absolute bottom-4 end-4 flex h-9 w-9 items-center justify-center rounded-full bg-candle-white/90 opacity-0 shadow-[var(--shadow-lift)] transition-opacity duration-300 group-hover:opacity-100">
              <ArrowUpRight className="h-4 w-4 text-ink-navy rtl:-scale-x-100" strokeWidth={1.75} />
            </div>
          </div>

          <div className="mt-5 flex items-start justify-between gap-4">
            <h3 className="font-serif text-xl text-heading">{content.name}</h3>
            {starting !== null && (
              <span className="whitespace-nowrap pt-1 text-sm text-body/70">
                {t("from", { price: formatPrice(starting, product.currency) })}
              </span>
            )}
          </div>
          <p className="mt-1 font-serif italic text-[15px] text-dusty-terracotta">
            {content.shortDescription}
          </p>
          <p className="mt-2 flex-1 text-[15px] leading-relaxed text-body/70">
            {content.fullDescription}
          </p>
        </motion.article>
      </Link>
    </Reveal>
  );
}
