import type { PricingConfig } from "@/types/studio";

/**
 * `rules: []`, matching `timelinePricing`'s own note: the real price a
 * customer pays comes from Django's `DeliveryPack`, not this file — see
 * that file's comment for the full reasoning. Present because
 * `product-state-context.tsx` expects every product module to have a
 * `PricingConfig`, not because anything here currently prices the
 * product.
 */
export const songPosterPricing: PricingConfig = {
  currency: "USD",
  basePriceCents: 1200,
  rules: [],
};
