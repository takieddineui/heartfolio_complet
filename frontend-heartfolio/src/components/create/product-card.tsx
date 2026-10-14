"use client";

import { useTranslations } from "next-intl";
import {
  Sparkles,
  AudioWaveform,
  MapPin,
  GalleryHorizontal,
  Heart,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { getStudioDestination } from "@/lib/products/registry";
import { getCatalogStartingPrice, type CatalogProduct } from "@/lib/products/catalog";
import { formatPrice } from "@/lib/site-config";
import { useProductContent } from "@/lib/products/use-product-content";

const ICONS: Record<string, LucideIcon> = {
  Sparkles,
  AudioWaveform,
  MapPin,
  GalleryHorizontal,
  Heart,
};

export function ProductCard({
  product,
  selected,
  onSelect,
}: {
  product: CatalogProduct;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("Create");
  const content = useProductContent(product);
  const Icon = ICONS[product.icon] ?? Sparkles;
  const destination = getStudioDestination(product);
  const isDisabled = destination.type === "unavailable";

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={isDisabled}
      className={`group relative flex h-full flex-col overflow-hidden rounded-[var(--radius-lg)] border text-start transition-all duration-300 ease-[var(--ease-heartfolio)] ${
        selected
          ? "border-champagne-gold shadow-[var(--shadow-lift)]"
          : "border-subtle shadow-[var(--shadow-whisper)] hover:-translate-y-1 hover:shadow-[var(--shadow-lift)]"
      } ${isDisabled ? "opacity-60" : ""}`}
    >
      <div className="relative flex h-36 w-full items-center justify-center bg-ink-navy">
        <Icon className="h-9 w-9 text-champagne-gold" strokeWidth={1.4} />
        {content.badge && (
          <span className="absolute start-3 top-3 rounded-full bg-candle-white/90 px-3 py-1 text-[11px] font-medium tracking-wide text-ink-navy">
            {content.badge}
          </span>
        )}
        {destination.type === "unavailable" && (
          <span className="absolute end-3 top-3 rounded-full bg-ink-navy/80 px-2.5 py-1 text-[10px] font-medium tracking-wide text-parchment">
            {t("comingSoonTag")}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-serif text-lg text-heading">{content.name}</h3>
          <ProductStartingPrice product={product} />
        </div>
        <p className="mt-2 flex-1 text-[15px] leading-relaxed text-body/70">
          {content.shortDescription}
        </p>
      </div>
    </button>
  );
}

/** The Continue button for the currently-selected product — separate from
 * the card so the Create page can place it once, outside the grid. */
export function ProductContinueButton({ product }: { product: CatalogProduct | undefined }) {
  const t = useTranslations("Create");
  // Always call this hook with a stable namespace (Rules of Hooks — this
  // must run unconditionally every render, not skipped when `product` is
  // undefined). Falls back to any valid i18nKey; the result is simply
  // unused in that case.
  const tProduct = useTranslations(`Products.${product?.i18nKey ?? "loveStoryTimeline"}`);
  const name = product ? tProduct("name") : undefined;

  if (!product) {
    return (
      <Button size="lg" disabled>
        {t("selectPrompt")}
      </Button>
    );
  }

  const destination = getStudioDestination(product);

  if (destination.type === "unavailable") {
    return (
      <Button size="lg" disabled>
        {t("notAvailableYet", { name: name ?? product.id })}
      </Button>
    );
  }

  return (
    <Button size="lg" asChild>
      <Link href={destination.href ?? "/"}>
        {t("startCreating")}
        <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
      </Link>
    </Button>
  );
}

/** Starting price for a card — derived from the product's offerings so it
 * can never disagree with the product page. */
function ProductStartingPrice({ product }: { product: CatalogProduct }) {
  // Django's starting price for a live product; the static marketing figure
  // only for waitlist products, which have no backend row to defer to.
  const starting = getCatalogStartingPrice(product);
  if (starting === null) return null;
  return (
    <span className="whitespace-nowrap text-sm text-body/70">
      {formatPrice(starting, product.currency)}
    </span>
  );
}
