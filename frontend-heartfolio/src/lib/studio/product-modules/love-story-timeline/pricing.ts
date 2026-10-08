import type { PricingConfig } from "@/types/studio";

/**
 * Kept, DESPITE HAVING NO ACTIVE RULES, because `pricingEngine` still runs
 * this config every render — `product-state-context.tsx` calls
 * `computeTotal()` unconditionally and stores the result, even though the
 * only thing that used to read it (`PricingSummary`) was migrated to the
 * real Django `DeliveryPack` price and no longer touches it (see that
 * component's own comment).
 *
 * The Premium add-on's `+$3.00` rule — the only rule this file ever had —
 * is removed along with the feature. `rules: []` is left explicit rather
 * than deleting the file: `product-state-context.tsx` still expects a
 * `PricingConfig` shape to exist per product module, and this is scoped to
 * "remove Premium add-on," not "remove the pricing-preview engine," which
 * is a separate, larger cleanup this change does not make unilaterally.
 */
export const timelinePricing: PricingConfig = {
  currency: "USD",
  basePriceCents: 1200,
  rules: [],
};
