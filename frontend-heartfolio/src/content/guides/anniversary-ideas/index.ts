import type { Guide } from "@/lib/guides/types";
import { en } from "./en";
import { fr } from "./fr";

/** Anniversary and Valentine's ideas that aren't objects (the plan's first
 *  guide). English and French, each written in its own language. */
export const anniversaryIdeasGuide: Guide = {
  id: "anniversary-ideas",
  products: ["reasons-i-love-you", "love-story-timeline", "song-poster"],
  translations: { en, fr },
};
