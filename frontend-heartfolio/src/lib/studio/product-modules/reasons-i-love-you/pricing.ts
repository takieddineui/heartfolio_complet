import type { PricingConfig } from "@/types/studio";

/** The Studio's display figure only. The price a customer pays is the
 * `live` pack's `price_cents` in Django ($15.99, the same as Love Story
 * Timeline's and Song Poster's Digital tiers). */
export const reasonsPricing: PricingConfig = {
  currency: "USD",
  basePriceCents: 1599,
  rules: [],
};
