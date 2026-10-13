/**
 * The journeys the Studio offers. A journey is the live experience that tells
 * the one graduation story: its opening, look, wording, interactions, finale
 * and sound effects (the live page's `journeys/` registry owns those).
 *
 * ONLY IMPLEMENTED JOURNEYS ARE LISTED. The data model and the backend are
 * already shared by all five in the product spec; the others are added here
 * (and to `JOURNEYS` in the backend's `graduation_keepsake/data.py`, pinned
 * by `journeys.test.ts`) in the same change that builds their live skin.
 * Offering a journey whose page does not exist would sell a keepsake that
 * cannot be shown.
 */

export interface JourneyOption {
  id: string;
  /** Swatch colour for the Studio's picker. */
  swatch: string;
}

export const JOURNEYS: readonly JourneyOption[] = [{ id: "airline", swatch: "#0f2742" }];

export const DEFAULT_JOURNEY = "airline";

export function isJourney(id: unknown): id is string {
  return typeof id === "string" && JOURNEYS.some((j) => j.id === id);
}
