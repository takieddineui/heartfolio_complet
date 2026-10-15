import type { PricingConfig } from "@/types/studio";

/** The Studio's display figure only. The price a customer pays is the `live`
 * pack's `price_cents` in Django ($15.99, the same Digital tier as Love Story
 * Timeline, Song Poster and Reasons I Love You). */
export const graduationPricing: PricingConfig = {
  currency: "USD",
  basePriceCents: 1599,
  rules: [],
};
