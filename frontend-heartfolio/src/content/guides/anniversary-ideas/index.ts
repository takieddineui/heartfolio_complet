import type { Guide } from "@/lib/guides/types";
import { en } from "./en";

/** Anniversary and Valentine's ideas that aren't objects (the plan's first
 *  guide). English first; French after the owner's review. */
export const anniversaryIdeasGuide: Guide = {
  id: "anniversary-ideas",
  products: ["reasons-i-love-you", "love-story-timeline", "song-poster"],
  translations: { en },
};
