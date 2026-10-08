"use client";

import * as Icons from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/studio/ui/badge";
import { useProductContent } from "@/lib/products/use-product-content";
import { getStartingPrice } from "@/lib/products/registry";
import type { ProductEntry } from "@/lib/products/types";

/**
 * The standalone Studio registry stored a pre-formatted `startingPrice`
 * string ("$12"); the unified Product Registry stores numeric offering
 * prices instead. This derives the identical display string so this
 * header renders exactly as before. Deliberately NOT `formatPrice()`
 * from site-config — that renders "$12 USD", which is the Marketing
 * App's convention and would visibly change this line.
 */
function startingPriceLabel(product: ProductEntry): string {
  const starting = getStartingPrice(product);
  return starting === null ? "—" : `$${starting}`;
}

interface ProductHeaderProps {
  product: ProductEntry;
}

export function ProductHeader({ product }: ProductHeaderProps) {
  const content = useProductContent(product);
  const t = useTranslations("Studio.chrome");

  // `icon` is a string per types.ts so the registry has zero UI-library
  // imports — resolve it against lucide-react here, at the one place that
  // renders it.
  const IconComponent = (Icons as unknown as Record<string, Icons.LucideIcon>)[product.icon] ?? Icons.Sparkles;

  return (
    <div className="space-y-4 border-b border-subtle pb-6">
      {/*
        THE STUDIO HAD NO WAY OUT except the browser's own back button —
        no link anywhere in its chrome. Goes to THIS product's own page
        rather than the catalogue or home: someone editing a Love Story
        Timeline almost always wants to leave to reconsider price or
        description for the SAME product, not browse from scratch, and
        this is also where they most likely started (`getStudioDestination`
        sends an available product's "Create yours" straight here).
      */}
      <Link
        href={`/products/${product.slug}`}
        className="inline-flex items-center gap-1.5 text-sm text-body/60 transition-colors hover:text-champagne-gold"
      >
        <Icons.ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={1.75} />
        {t("back")}
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-champagne-gold/10">
          <IconComponent className="h-5 w-5 text-champagne-gold" strokeWidth={1.75} />
        </div>
        {content.badge && <Badge>{content.badge}</Badge>}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs uppercase tracking-[0.18em] text-body/60">
          {t(`categories.${product.category}`)}
        </p>
        <h1 className="font-serif text-2xl text-heading">{content.name}</h1>
        <p className="text-[15px] leading-relaxed text-body/80">{content.shortDescription}</p>
      </div>

      <p className="text-sm text-body/60">
        {t("startingAt", { price: startingPriceLabel(product) })}
      </p>
    </div>
  );
}
