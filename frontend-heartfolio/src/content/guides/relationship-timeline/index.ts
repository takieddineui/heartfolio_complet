import type { Guide } from "@/lib/guides/types";
import { en } from "./en";
import { fr } from "./fr";

/** How to build your relationship timeline (the plan's third guide).
 *  English and French, each written in its own language. */
export const relationshipTimelineGuide: Guide = {
  id: "relationship-timeline",
  products: ["love-story-timeline"],
  translations: { en, fr },
};
