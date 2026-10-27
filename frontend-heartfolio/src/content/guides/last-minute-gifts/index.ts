import type { Guide } from "@/lib/guides/types";
import { en } from "./en";
import { fr } from "./fr";

/** Last-minute gifts that still feel personal (the plan's fourth guide).
 *  English and French, each written in its own language. */
export const lastMinuteGuide: Guide = {
  id: "last-minute-gifts",
  products: ["reasons-i-love-you", "song-poster", "graduation-keepsake"],
  translations: { en, fr },
};
