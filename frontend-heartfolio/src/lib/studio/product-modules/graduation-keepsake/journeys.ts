/**
 * THE FIVE JOURNEYS: how the graduation story is told.
 *
 * One data shape, five experiences (opening, look, words, interactions,
 * finale, sound effects), the same pattern as Reasons I Love You's four gifts.
 * The creator picks one in the Studio; the graduate only ever gets that one
 * (the prototype's on-page journey switcher was preview scaffolding).
 *
 * The backend keeps the same ids (`JOURNEYS` in `data.py`) and the same colour
 * ids (`COLOURS`); `graduation-module.test.ts` pins both.
 */
export const JOURNEY_IDS = ["airline", "space", "arcade", "museum", "summit"] as const;
export type JourneyId = (typeof JOURNEY_IDS)[number];
export const DEFAULT_JOURNEY: JourneyId = "airline";

export interface JourneyDefinition {
  id: JourneyId;
  icon: string;
  /** The browser's theme colour while this journey is open. */
  theme: string;
}

export const JOURNEYS: Record<JourneyId, JourneyDefinition> = {
  airline: { id: "airline", icon: "✈️", theme: "#0f2742" },
  space: { id: "space", icon: "🚀", theme: "#070b1f" },
  arcade: { id: "arcade", icon: "👾", theme: "#1b1036" },
  museum: { id: "museum", icon: "🖼️", theme: "#23382f" },
  summit: { id: "summit", icon: "⛰️", theme: "#30476b" },
};

export function journeyOrDefault(id: unknown): JourneyId {
  return (JOURNEY_IDS as readonly unknown[]).includes(id) ? (id as JourneyId) : DEFAULT_JOURNEY;
}

/**
 * A person's colour (postcard, party character, cairn stone): one of these
 * eight, never a free hex, because every journey was designed with them.
 * Empty means "by position": the person's place in the list picks one, so a
 * creator who chooses nothing still gets distinct, readable cards (the
 * prototype drew an empty colour as white text on a pale card).
 */
export const COLOUR_IDS = ["coral", "sky", "amber", "mint", "berry", "violet", "forest", "gold"] as const;
export type ColourId = (typeof COLOUR_IDS)[number];
export const COLOURS: Record<ColourId, string> = {
  coral: "#ff6b4a",
  sky: "#2f7fd8",
  amber: "#e69a1e",
  mint: "#2fae86",
  berry: "#c95ab0",
  violet: "#7a5cd6",
  forest: "#1f8a5f",
  gold: "#b8860b",
};

export function colourFor(id: unknown, position: number): string {
  if ((COLOUR_IDS as readonly unknown[]).includes(id)) return COLOURS[id as ColourId];
  return COLOURS[COLOUR_IDS[position % COLOUR_IDS.length]!];
}
