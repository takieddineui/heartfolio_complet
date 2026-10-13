import type { PricingConfig } from "@/types/studio";

/**
 * `rules: []`, matching the other modules: the price a customer pays is
 * Django's `DeliveryPack.price_cents`, never anything in this file. Present
 * because `product-state-context.tsx` expects every module to have a
 * `PricingConfig`.
 */
export const graduationPricing: PricingConfig = {
  currency: "USD",
  basePriceCents: 0,
  rules: [],
};
