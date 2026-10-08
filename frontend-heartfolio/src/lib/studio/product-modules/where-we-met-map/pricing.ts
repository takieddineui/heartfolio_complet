import type { PricingConfig } from "@/types/studio";

/** No `rules` — this product has no optional paid add-ons in its actual
 * spec (unlike Timeline's premium module), and inventing one just to
 * re-exercise `PricingRule` would be exactly the kind of unjustified
 * product-specific padding this stress test is checking for. An empty
 * array is itself a real case `computeTotal` needs to handle correctly:
 * it does — it returns `basePriceCents` with no line items. */
export const mapPricing: PricingConfig = {
  currency: "USD",
  basePriceCents: 1200,
  rules: [],
};
