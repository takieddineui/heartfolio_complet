import type { JourneyDefinition } from "./types";

/**
 * Journey id -> lazy loader. Adding a journey is one entry here (plus its id
 * in `lib/studio/product-modules/graduation-keepsake/journeys.ts` and the
 * backend's `JOURNEYS`, pinned by a test). Each loader is a dynamic import,
 * so a recipient's browser fetches only the journey they were sent - its
 * code, its CSS module and, because `@font-face` rules live in that CSS
 * module, only its fonts.
 */
export const JOURNEY_LOADERS: Record<string, () => Promise<JourneyDefinition>> = {
  airline: async () => (await import("./airline")).airline,
};

export function hasJourney(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(JOURNEY_LOADERS, id);
}
