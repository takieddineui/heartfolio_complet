"use client";

import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion/reveal";
import { BotanicalSprig, MoonMark } from "@/components/illustrations/constellation";
import { Link } from "@/i18n/navigation";

type OccasionKey = "anniversary" | "wedding" | "newBaby" | "inMemory" | "newChapter";

const OCCASIONS: {
  key: OccasionKey;
  accentClass: string;
  bgClass: string;
  icon: "heart" | "botanical" | "moon" | "hush" | "chapter";
}[] = [
  { key: "anniversary", accentClass: "text-dusty-terracotta", bgClass: "bg-[#f3ece1]", icon: "heart" },
  { key: "wedding", accentClass: "text-champagne-gold", bgClass: "bg-candle-white", icon: "botanical" },
  { key: "newBaby", accentClass: "text-muted-sage", bgClass: "bg-[#eef0e6]", icon: "moon" },
  { key: "inMemory", accentClass: "text-ink-navy", bgClass: "bg-parchment", icon: "hush" },
  { key: "newChapter", accentClass: "text-champagne-gold", bgClass: "bg-[#f3ece1]", icon: "chapter" },
];

function OccasionGlyph({ icon, className }: { icon: string; className?: string }) {
  if (icon === "botanical") return <BotanicalSprig className={className} />;
  if (icon === "moon") return <MoonMark className={className} />;
  if (icon === "hush")
    return (
      <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
        <line x1="10" y1="20" x2="30" y2="20" stroke="currentColor" strokeWidth="1.1" />
      </svg>
    );
  if (icon === "chapter")
    return (
      <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
        <path d="M8 32 L8 8 L28 8 L32 14 L32 32 Z" stroke="currentColor" strokeWidth="1.1" />
        <path d="M28 8 L28 14 L32 14" stroke="currentColor" strokeWidth="1.1" />
      </svg>
    );
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <path
        d="M20 33s-13-8-13-17a7 7 0 0 1 13-3.6A7 7 0 0 1 33 16c0 9-13 17-13 17Z"
        stroke="currentColor"
        strokeWidth="1.1"
      />
    </svg>
  );
}

/**
 * ---------------------------------------------------------------------
 * OCCASIONS ARE NOW DERIVED, NOT DECLARED (§11)
 * ---------------------------------------------------------------------
 * `OCCASIONS` above still owns each card's *presentation* — its glyph and
 * its colour pairing, which no database has a column for. What it no longer
 * decides is which cards exist: that comes in as `occasions`, computed from
 * the live catalog by `getAvailableOccasions()` on the homepage.
 *
 * The order of `OCCASIONS` is preserved rather than the order of the
 * incoming array, so the section's visual rhythm doesn't reshuffle when the
 * catalog changes.
 *
 * Renders nothing at all when no occasion has a product behind it. The
 * header still links to `/#occasions`, which then resolves to the top of
 * the page — an anchor to a missing section is a far smaller problem than a
 * grid of cards leading to five empty results, and §11's rule is that only
 * backed occasions appear.
 */
export function GiftOccasions({ occasions }: { occasions: string[] }) {
  const t = useTranslations("GiftOccasions");

  const visible = OCCASIONS.filter((occ) => occasions.includes(occ.key));
  if (visible.length === 0) return null;

  return (
    <section id="occasions" className="bg-ink-navy py-24 text-parchment sm:py-30">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <Reveal className="max-w-xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-champagne-gold">
            {t("eyebrow")}
          </p>
          <h2 className="mt-4 font-serif text-3xl leading-tight text-parchment sm:text-4xl md:text-5xl">
            {t("title").split("\n").map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </h2>
          <p className="mt-5 text-base leading-relaxed text-parchment/70">{t("subtitle")}</p>
        </Reveal>

        <RevealGroup className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((occ) => (
            <RevealItem key={occ.key}>
              {/* Was `/create` on every card — an occasion is a way of
                  browsing the collection, not a shortcut into the
                  selection gateway. Pass A §9. */}
              <Link
                href={`/products?occasion=${occ.key}`}
                className={`group flex h-full flex-col justify-between rounded-[var(--radius-lg)] ${occ.bgClass} p-8 text-ink-navy shadow-[var(--shadow-whisper)] transition-shadow duration-300 hover:shadow-[var(--shadow-lift)]`}
              >
                <div>
                  <OccasionGlyph icon={occ.icon} className={`h-9 w-9 ${occ.accentClass}`} />
                  <h3 className="mt-6 font-serif text-xl">{t(`items.${occ.key}.label`)}</h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-soft-charcoal/75">
                    {t(`items.${occ.key}.description`)}
                  </p>
                </div>
                <span className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium">
                  {t(`items.${occ.key}.cta`)}
                  <ArrowRight className="h-3.5 w-3.5 transition-transform rtl:rotate-180 ltr:group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
                </span>
              </Link>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
