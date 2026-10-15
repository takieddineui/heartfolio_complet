import type { ThemeEngineConfig } from "@/types/studio";
import { DEFAULT_JOURNEY, JOURNEY_IDS } from "./journeys";

/**
 * One axis: which journey. Switching it in the Studio is how the creator sees
 * all five before choosing; the graduate only ever gets the one chosen. The
 * journeys carry their own colours and fonts, so no tokens are merged here.
 */
export const graduationThemes: ThemeEngineConfig = {
  axes: [
    {
      id: "journey",
      label: "themes.journey.label",
      kind: "select",
      defaultOptionId: DEFAULT_JOURNEY,
      options: JOURNEY_IDS.map((id) => ({ id, label: `journeys.${id}.name` })),
    },
  ],
};
