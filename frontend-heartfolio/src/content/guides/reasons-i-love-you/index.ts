import type { Guide } from "@/lib/guides/types";
import { en } from "./en";
import { fr } from "./fr";

/** How to write reasons you love someone, with examples (the plan's second
 *  guide). English and French, each written in its own language. */
export const reasonsGuide: Guide = {
  id: "reasons-i-love-you",
  products: ["reasons-i-love-you"],
  translations: { en, fr },
};
