"use client";

import { useTranslations } from "next-intl";
import { useProductState } from "@/lib/studio/product-state-context";
import { formatCents } from "@/lib/studio/pricing-engine";

/**
 * The price the customer will actually be charged, from Django.
 *
 * NOT SHOWN UNTIL A PACK IS CHOSEN. This used to fall back to the cheapest
 * available pack while editing, under the label "Total" — which read as a
 * final figure for a purchase the customer had not yet configured, and
 * then changed once they picked a pack in checkout. There is no honest
 * total before a pack exists, so nothing is rendered.
 *
 * Previously it rendered `pricingEngine.computeTotal()` over a hardcoded
 * `basePriceCents` in the product module, which was a frontend-invented
 * number that could disagree with what Paddle charged.
 *
 * The per-rule line items are gone with it: they itemised deltas of that
 * invented total (e.g. "+$3 premium module") and have no counterpart in the
 * catalog. Layout, classes and typography are untouched.
 */
export function PricingSummary() {
  const t = useTranslations("Studio.panels.pricing");
  const { selectedPack, locale } = useProductState();

  if (!selectedPack) return null;

  return (
    <div className="space-y-1.5 rounded-[var(--radius-md)] bg-champagne-gold/10 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-body/70">{t("total")}</span>
        <span className="font-serif text-xl text-heading">
          {formatCents(selectedPack.priceCents, selectedPack.currency, locale)}
        </span>
      </div>
    </div>
  );
}
